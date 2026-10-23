import {
  ACCSYN_BACKEND_MASTER_HOSTNAME,
  ACCSYN_PORT,
  CLEARANCE_ADMIN,
  CLEARANCE_NONE,
  CLEARANCE_SUPPORT,
  CLIENT_STATE_DISABLED,
  CLIENT_STATE_ONLINE,
  CLIENT_TYPE_APP,
  CLIENT_TYPE_SERVER,
  CLIENT_TYPE_USERSERVER,
  UNIQUE_ENTITY_TYPES,
  isJobCreateType,
} from "./constants";
import { AccsynError } from "./error";
import { parseJson, stringify } from "./json";
import {
  base64Encode,
  deviceLabel,
  fileExists,
  isNode,
  loadEnvFile,
  machineHostname,
  maybeCompress,
  readEnv,
  readJsonFile,
  urlQuote,
} from "./platform";
import { decodeQuery } from "./query";
import { VERSION } from "./version";

const ENTITY_ID = /^[a-z0-9]{24}$/;

/** JSON object returned by the accsyn backend. */
export interface Entity {
  id?: string;
  [key: string]: unknown;
}

export type JsonObject = Record<string, unknown>;
export type CreateData = string | JsonObject | JsonObject[];
export type FilePath = string | JsonObject | string[];

export interface SessionOptions {
  /** Workspace code. Falls back to ACCSYN_WORKSPACE, ACCSYN_DOMAIN, then ACCSYN_ORG. */
  workspace?: string;
  /** User email. Falls back to ACCSYN_API_USER. */
  username?: string;
  /** API key. Falls back to ACCSYN_API_KEY. */
  apiKey?: string;
  /** Override the workspace hostname. */
  hostname?: string;
  /** Override the workspace port. Defaults to 443. */
  port?: number;
  /** Proxy setting. Falls back to ACCSYN_PROXY. SOCKS proxies are not supported. */
  proxy?: string;
  /** Print REST traffic to the console. */
  verbose?: boolean;
  /** Pretty-print JSON in verbose logs. */
  prettyJson?: boolean;
  /** Response timeout in seconds. Defaults to 120. */
  timeout?: number;
  /** Connection timeout in seconds. Defaults to 10. Recorded for parity; fetch uses `timeout` as the abort deadline. */
  connectTimeout?: number;
  /** @deprecated Use `workspace`. */
  domain?: string;
  /** Path to a .env file. Falls back to ACCSYN_CREDENTIALS_PATH, then ./.env on Node. */
  pathEnvfile?: string;
  /** Talk to a local backend on 127.0.0.1:8181. Falls back to AS_DEV. */
  dev?: boolean;
}

export interface CreateOptions {
  /** Parent id when creating sub-entities such as tasks. */
  entityId?: string;
  /** Allow duplicate tasks and retry the existing task. */
  allowDuplicates?: boolean;
  /** Replace duplicate tasks instead of retrying them. */
  replaceDuplicates?: boolean;
}

export interface FindOptions {
  entityId?: string;
  attributes?: string[];
  finished?: boolean;
  inactive?: boolean;
  /** @deprecated Use `inactive`. */
  offline?: boolean;
  archived?: boolean;
  limit?: number;
  skip?: number;
  /** When querying attributes, return create attributes. */
  create?: boolean;
  /** When querying attributes, return update attributes. */
  update?: boolean;
  singleEntityQuery?: boolean;
}

export interface FileListOptions {
  recursive?: boolean;
  maxDepth?: number;
  getSize?: boolean;
  filesOnly?: boolean;
  directoriesOnly?: boolean;
  include?: string | string[];
  exclude?: string | string[];
}

export interface SettingScope {
  entityType?: string;
  entityId?: string | null;
  integration?: string;
  data?: JsonObject | null;
}

export interface SettingsOptions {
  entityType?: string | null;
  entityId?: string | null;
  recursive?: boolean;
  upstream?: boolean;
  omitDefaults?: boolean;
  share?: string;
}

export interface LogOptions {
  entityType?: string | null;
  entityId?: string | null;
  search?: string;
  sort?: string;
  sortReverse?: boolean;
  /**
   * Accepted for parity with the Python API. The backend does not read `page`, `limit` and `skip`, use
   * `paginationStart` and `paginationSize` instead.
   */
  paginationPage?: number;
  paginationLimit?: number;
  paginationSkip?: number;
  /**
   * First row to return, counted from 1 in the sort order (oldest first by default). `-1` returns the last page,
   * that is the newest `paginationSize` rows.
   */
  paginationStart?: number;
  /** Number of rows to return. All rows are returned when omitted. */
  paginationSize?: number;
}

export interface ProcessLogOptions {
  /** URI of the task to read the log of. Defaults to the first task of the job that has been processed. */
  uri?: string;
  /** Zero-based try (attempt) number. Defaults to the latest try. */
  tryNum?: number;
  /** Fetch the master process log, the main process. Defaults to true. */
  master?: boolean;
  /** Fetch the slave process log, the file server party process. Can only be done by operators, for transfer jobs. */
  slave?: boolean;
}

export interface AccessOptions {
  entityType?: string;
  entityId?: string;
  recursive?: boolean;
}

interface ResolvedProxy {
  type: "accsyn";
  hostname: string;
  port: number;
}

/**
 * accsyn API session.
 *
 * Create one with {@link Session.connect} and reuse it. Workspace backends rate-limit REST traffic per IP.
 */
export class Session {
  readonly username: string;
  readonly timeout: number;
  readonly connectTimeout: number;

  private readonly workspace: string;
  private readonly apiKey: string;
  private readonly verboseLogs: boolean;
  private readonly prettyJson: boolean;
  private readonly proxySetting?: string;
  private readonly dev: boolean;
  private hostname: string;
  private port: number;
  private userId?: string;
  private sessionId?: string;
  private role = CLEARANCE_NONE;
  private lastMessage: string | null = null;
  private machine = "unknown";

  private constructor(options: SessionOptions, credentials: { workspace: string; username: string; apiKey: string }) {
    this.workspace = credentials.workspace;
    this.username = credentials.username;
    this.apiKey = credentials.apiKey;
    this.verboseLogs = options.verbose ?? false;
    this.prettyJson = options.prettyJson ?? false;
    this.proxySetting = options.proxy ?? readEnv("ACCSYN_PROXY");
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_FALLBACK;
    this.connectTimeout = options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT_FALLBACK;
    this.dev = options.dev ?? ["true", "1"].includes((readEnv("AS_DEV") ?? "false").toLowerCase());
    this.hostname = options.hostname ?? (this.dev ? "127.0.0.1" : "");
    this.port = options.port ?? (this.dev ? 8181 : ACCSYN_PORT);
  }

  /**
   * Authenticate and open a session.
   *
   * On Node, omitted credentials are read from the environment or a `.env` file.
   */
  static async connect(options: SessionOptions = {}): Promise<Session> {
    await loadCredentialsFile(options);
    const workspace = firstValue(options.workspace, options.domain, readEnv("ACCSYN_WORKSPACE"), readEnv("ACCSYN_DOMAIN"), readEnv("ACCSYN_ORG"));
    if (!workspace) {
      throw new AccsynError("Please supply your accsyn workspace code or set ACCSYN_WORKSPACE environment!");
    }
    const username = firstValue(options.username, readEnv("ACCSYN_API_USER"));
    if (!username) {
      throw new AccsynError("Please supply your accsyn user name (E-mail) or set ACCSYN_API_USER environment!");
    }
    const apiKey = firstValue(options.apiKey, readEnv("ACCSYN_API_KEY"));
    if (!apiKey) {
      throw new AccsynError("Please supply your accsyn API KEY or set ACCSYN_API_KEY environment!");
    }
    const session = new Session(options, { workspace, username, apiKey });
    session.verbose(`Creating accsyn JavaScript API session (v${VERSION})`);
    session.machine = await machineHostname();
    if (!options.hostname) {
      if (!session.dev) {
        const response = await session.rest(
          "GET",
          ACCSYN_BACKEND_MASTER_HOSTNAME,
          "J3PKTtDvolDMBtTy6AFGA",
          { ident: workspace },
          { headers: {} }
        );
        const result = (response.result ?? {}) as JsonObject;
        if (typeof result.hostname !== "string") {
          throw new AccsynError(`No API endpoint hostname was provided for workspace ${workspace}!`);
        }
        session.hostname = result.hostname;
        if (options.port == null && typeof result.port === "number") {
          session.port = result.port;
        }
      }
    }
    await session.login();
    return session;
  }

  /** Hostname of this computer. Returns `unknown` in the browser. */
  static async getHostname(): Promise<string> {
    return machineHostname();
  }

  /** Error message from the last failed API call, if any. */
  getLastMessage(): string | null {
    return this.lastMessage;
  }

  /**
   * Create an entity.
   *
   * `data` may be an object, a list of tasks, a JSON string, or (on Node) a path to a JSON file.
   */
  async create(entityType: string, data: CreateData, options: CreateOptions = {}): Promise<Entity | Entity[]> {
    const type = requireText(entityType, "You must provide the entity type to create!").toLowerCase();
    let payload = await normalizeCreateData(data);
    let uri = "create";
    if (type === "task" && !("tasks" in payload)) {
      payload = { tasks: payload };
    }
    if (type === "file") {
      uri = "add";
    }
    if (isJobCreateType(type)) {
      if (options.allowDuplicates != null) {
        payload.allow_duplicates = options.allowDuplicates;
      }
      if (options.replaceDuplicates != null) {
        payload.replace_duplicates = options.replaceDuplicates;
      }
    }
    return this.finishCreate(type, uri, payload, options);
  }

  /** Query entities, `entitytypes`, or `attributes`. */
  async find(query: string, options: FindOptions = {}): Promise<Entity[] | Entity | null> {
    if (!query || typeof query !== "string") {
      throw new AccsynError("Invalid query type supplied, must be of string type!");
    }
    const decoded = decodeQuery(query);
    let retval: Entity[] | null = null;
    if (decoded.entitytype === "entitytypes") {
      const response = await this.event("GET", "entitytypes", {});
      retval = (response.result ?? null) as Entity[] | null;
    } else if (decoded.entitytype === "attributes") {
      if (!decoded.expression) {
        throw new AccsynError('Please query which entity to obtain attributes for (i.e. "attributes WHERE entitytype=job")');
      }
      const parts = decoded.expression.split("=");
      if (!(parts.length === 2 && parts[0].trim() === "entitytype")) {
        throw new AccsynError('Please query attributes by expressions on the form "attributes WHERE entitytype=job"');
      }
      const entityType = parts[1].trim().replace(/'/g, "").replace(/"/g, "");
      assertOptionalBoolean(options.create, "Create must be a boolean!");
      assertOptionalBoolean(options.update, "Update must be a boolean!");
      const response = await this.event("GET", "attributes", {
        entitytype: entityType,
        create: options.create ?? false,
        update: options.update ?? false,
      });
      retval = (response.result ?? null) as Entity[] | null;
    } else {
      if (options.attributes) {
        if (!Array.isArray(options.attributes) || options.attributes.some((attribute) => typeof attribute !== "string" || attribute.trim().length === 0)) {
          throw new AccsynError("Attributes must be a list of non-empty strings!");
        }
      }
      assertOptionalBoolean(options.inactive, "Inactive must be a boolean!");
      assertOptionalBoolean(options.finished, "Finished must be a boolean!");
      assertOptionalBoolean(options.archived, "Archived must be a boolean!");
      assertOptionalInteger(options.limit, "Limit must be an integer!");
      assertOptionalInteger(options.skip, "Skip must be an integer!");
      const data: JsonObject = {};
      if (options.entityId != null) {
        data.parent = options.entityId;
      }
      if (options.finished != null) {
        data.finished = options.finished;
      }
      if (options.inactive != null) {
        data.inactive = options.inactive;
      } else if (options.offline != null) {
        this.warn("The 'offline' parameter is deprecated, use 'inactive' instead.");
        data.inactive = options.offline;
      }
      if (options.archived != null) {
        data.archived = options.archived;
      }
      if (options.limit) {
        data.limit = options.limit;
      }
      if (options.skip) {
        data.skip = options.skip;
      }
      if (options.attributes) {
        data.attributes = options.attributes.map((attribute) => attribute.trim());
      }
      if (options.singleEntityQuery) {
        data.single_entity_query = true;
      }
      const response = await this.event("GET", `${decoded.entitytype}/find`, data, { query: decoded.expression });
      retval = (response.result ?? null) as Entity[] | null;
    }
    if (options.singleEntityQuery) {
      if (retval && retval.length > 0) {
        if (retval.length > 1) {
          this.warn(`Multiple entities retrieved(${retval.length}), returning first one.`);
        }
        return retval[0];
      }
      return null;
    }
    return retval;
  }

  /** Return a single entity, or null. */
  async findOne(query: string, options: Omit<FindOptions, "singleEntityQuery" | "limit" | "skip" | "create" | "update"> = {}): Promise<Entity | null> {
    if (!query || typeof query !== "string") {
      throw new AccsynError("Invalid query type supplied, must be of string type!");
    }
    const found = await this.find(query, {
      ...options,
      inactive: options.inactive || options.offline,
      singleEntityQuery: true,
    });
    return found as Entity | null;
  }

  /** Fetch an entity by type and 24-character id, including inactive and archived records. */
  async getEntity(entityType: string, entityId: string): Promise<Entity | null> {
    requireText(entityType, "Invalid entity type supplied, must be of string type!");
    requireText(entityId, "Invalid entity ID supplied, must be of string type!");
    if (!ENTITY_ID.test(entityId)) {
      throw new AccsynError("Invalid entity ID supplied!");
    }
    const response = await this.event("GET", `${entityType}/find`, {}, { entityId });
    const result = (response.result ?? []) as Entity[];
    if (result.length === 0) {
      return null;
    }
    if (result.length > 1) {
      this.warn(`Multiple entities retrieved(${result.length}), returning first one.`);
    }
    return result[0];
  }

  /** Support report for an entity query. */
  async report(query: string): Promise<string> {
    const decoded = decodeQuery(query);
    const response = await this.event("GET", `${decoded.entitytype}/report`, {}, { query: decoded.expression });
    return String(response.report ?? "");
  }

  /** Metrics for an entity query, typically a job. */
  async metrics(query: string, attributes?: string[] | null, time?: string | null): Promise<JsonObject> {
    const decoded = decodeQuery(query);
    const data: JsonObject = { attributes: attributes ?? null };
    if (time != null) {
      data.time = time;
    }
    const response = await this.event("GET", `${decoded.entitytype}/metrics`, data, { query: decoded.expression });
    return (response.result ?? {}) as JsonObject;
  }

  /** Update one entity. ACLs must be changed with {@link Session.grant}. */
  async update(entityType: string, entityId: string, data: JsonObject): Promise<Entity | undefined> {
    const type = requireText(entityType, "Invalid entity type supplied, must be of string type!").toLowerCase();
    if (type === "acl") {
      throw new AccsynError("ACLs cannot be updated, use the grant function to grant access.");
    }
    requireText(entityId, "Invalid entity ID supplied, must be of string type!");
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length === 0) {
      throw new AccsynError("Invalid data supplied, must be dict and have content!");
    }
    const response = await this.event("PUT", `${type}/edit`, data, { entityId });
    return resultList(response)[0];
  }

  /** Update tasks beneath a job. `entityType` must be `task`. */
  async updateMany(entityType: string, entityId: string, data: JsonObject[]): Promise<Entity[] | undefined> {
    const type = requireText(entityType, "Invalid entity type supplied, must be of string type!").toLowerCase();
    if (type !== "task") {
      throw new AccsynError("Only multiple 'task' entities can be updated!");
    }
    requireText(entityId, "Entity ID must be provided and must be of string type!");
    if (!ENTITY_ID.test(entityId)) {
      throw new AccsynError("Invalid parent entity ID supplied!");
    }
    if (!Array.isArray(data) || data.length === 0) {
      throw new AccsynError("Invalid data supplied, must be a list!");
    }
    const response = await this.event("PUT", `${type}/edit`, data, { entityId });
    return resultList(response);
  }

  /** Assign a server or client to a volume or share. */
  async assign(parentType: string, entityType: string, data: JsonObject): Promise<unknown> {
    const parent = requireText(parentType, "Invalid parent entity type supplied, must be of string type!").toLowerCase();
    const type = requireText(entityType, "Invalid entity type supplied, must be of string type!").toLowerCase();
    requireRecord(data, "Invalid assignment data supplied, must be a dict with values!");
    if ((parent === "volume" || parent === "share") && (type === "server" || type === "client")) {
      const shareId = String(data.volume ?? data.share ?? "");
      if (!ENTITY_ID.test(shareId)) {
        throw new AccsynError("Please supply parent entity ID as 'volume' with assignment data!");
      }
      const clientId = String(data.server ?? data.client ?? "");
      if (!ENTITY_ID.test(clientId)) {
        throw new AccsynError("Please supply entity ID as 'server' with assignment data!");
      }
      const response = await this.event("PUT", "share/server", { client: clientId }, { entityId: shareId });
      return response.result;
    }
    throw new AccsynError("Unsupported assignment operation!");
  }

  /** List servers assigned to a volume or share. */
  async assignments(entityType: string, entityId: string): Promise<Entity[]> {
    const type = requireText(entityType, "Invalid parent entity type supplied, must be of string type!").toLowerCase();
    if (type === "volume" || type === "share") {
      const response = await this.event("GET", `${entityType}/servers`, {}, { entityId });
      return resultList(response);
    }
    throw new AccsynError("Unsupported assignment operation!");
  }

  /** Remove a server assignment from a volume or share. */
  async deassign(parentType: string, entityType: string, data: JsonObject): Promise<unknown> {
    const parent = requireText(parentType, "Invalid parent entity type supplied, must be of string type!").toLowerCase();
    const type = requireText(entityType, "Invalid entity type supplied, must be of string type!").toLowerCase();
    requireRecord(data, "Invalid de-assignment data supplied, must be a dict with values!");
    if ((parent === "volume" || parent === "share") && type === "server") {
      const shareId = String(data.volume ?? data.share ?? "");
      if (!ENTITY_ID.test(shareId)) {
        throw new AccsynError("Please supply parent entity ID as 'volume' with de-assignment data!");
      }
      const clientId = String(data.server ?? data.client ?? "");
      if (!ENTITY_ID.test(clientId)) {
        throw new AccsynError("Please supply entity ID as 'server' with de-assignment data!");
      }
      const response = await this.event("DELETE", `${parent}/server`, { client: clientId }, { entityId: shareId });
      return response.result;
    }
    throw new AccsynError("Unsupported de-assignment operation!");
  }

  /**
   * Grant a user access to a delivery, request, stream, or share.
   * `entityType` must be `user`. `entityId` may be an id or, for unique types, a code such as an email.
   */
  async grant(entityType: string, entityId: string, targetType: string, targetId: string, data?: JsonObject | null): Promise<unknown> {
    const type = requireText(entityType, "Invalid entity type supplied, must be of string type!").toLowerCase();
    let ident = requireText(entityId, "Invalid entity ID supplied, must be of string type!").toLowerCase();
    ident = await this.resolveCode(type, ident, data);
    const target = requireText(targetType, "Invalid target entity type supplied, must be of string type!").toLowerCase();
    let targetIdent = requireText(targetId, "Invalid entity type supplied, must be of string type!").toLowerCase();
    targetIdent = await this.resolveTargetCode(target, targetIdent);
    if (data != null && (typeof data !== "object" || Array.isArray(data))) {
      throw new AccsynError("Invalid grant access data supplied, must be a dict!");
    }
    if (type !== "user") {
      throw new AccsynError("Unsupported grant entity type (supported: user)!");
    }
    if (target === "delivery" || target === "request" || target === "stream") {
      const response = await this.event(
        "PUT",
        "job/recipient/add",
        { recipient: ident, invite: (data ?? {}).invite !== false },
        { entityId: targetIdent }
      );
      return response.result;
    }
    if (target === "volume" || target === "folder" || target === "home" || target === "collection") {
      const grantData = data && Object.keys(data).length > 0 ? data : { read: true, write: true };
      const response = await this.event("POST", "acl/create", {
        entity: `user:${ident}`,
        target: `share:${targetIdent}`,
        invite: grantData.invite !== false,
        read: grantData.read === true,
        write: grantData.write === true,
        notify: grantData.notify === true,
        message: grantData.message ?? "",
        path: grantData.path ?? "/",
      });
      return resultList(response)[0];
    }
    throw new AccsynError(
      "Unsupported grant target type for user (supported: delivery, request, stream, job, volume, folder, home, collection, share)!"
    );
  }

  /** List recipients on a delivery, or ACL entries on a share. */
  async access(targetType: string, targetId: string, options: AccessOptions = {}): Promise<Entity[]> {
    const target = requireText(targetType, "Invalid parent target type supplied, must be of string type!").toLowerCase();
    const ident = requireText(targetId, "Invalid target id supplied, must be of string type!").toLowerCase();
    if (!ENTITY_ID.test(ident)) {
      throw new AccsynError("Please supply a valid entity ID!");
    }
    if (target === "delivery" || target === "request" || target === "stream") {
      const response = await this.event("GET", "job/recipients", {}, { entityId: ident });
      return resultList(response);
    }
    if (target === "volume" || target === "folder" || target === "home" || target === "collection" || target === "share") {
      let query = `acl WHERE target=share:${ident}`;
      if (options.entityType) {
        query += options.entityId ? ` AND entity=${options.entityType}:${options.entityId}` : ` AND entity=${options.entityType}:*`;
      }
      const response = await this.event("GET", "acl/find", { recursive: options.recursive ?? false }, { query });
      return resultList(response).map((acl) => ({
        user: String(acl.entity ?? "").split(":")[1],
        user_hr: acl.entity_hr ?? "",
        share: String(acl.target ?? "").split(":")[1],
        share_hr: acl.target_hr ?? "",
        read: acl.read,
        write: acl.write,
        acknowledged: acl.acknowledged ?? false,
        path: acl.path ?? "/",
      }));
    }
    throw new AccsynError("Unsupported access operation!");
  }

  /**
   * Revoke a user's access.
   * Returns false when no matching recipient or ACL exists.
   */
  async revoke(entityType: string, entityId: string, targetType: string, targetId: string): Promise<unknown> {
    const type = requireText(entityType, "Invalid entity type supplied, must be of string type!").toLowerCase();
    let ident = requireText(entityId, "Invalid entity id supplied, must be of string type!").toLowerCase();
    const target = requireText(targetType, "Invalid target entity type supplied, must be of string type!").toLowerCase();
    if (!ENTITY_ID.test(ident)) {
      if ((UNIQUE_ENTITY_TYPES as readonly string[]).includes(type)) {
        const response = await this.event("GET", `${type}/find`, {}, { query: `code='${ident}'` });
        const result = resultList(response);
        if (result.length > 0 && typeof result[0].id === "string") {
          ident = result[0].id;
        } else if (target !== "delivery" && target !== "request" && target !== "stream" && target !== "job") {
          throw new AccsynError(`No ${type} found with code '${ident}' found!`);
        }
      } else {
        throw new AccsynError(`Please supply a valid ${type} ID! Hint: ${type} does not support unique API code attribute lookup!`);
      }
    }
    const targetIdent = requireText(targetId, "Invalid target entity id supplied, must be of string type!").toLowerCase();
    if (!ENTITY_ID.test(targetIdent)) {
      throw new AccsynError("Please supply a valid entity ID!");
    }
    if (type !== "user") {
      throw new AccsynError("Unsupported revoke access entity type!");
    }
    if (target === "delivery" || target === "request" || target === "stream" || target === "job") {
      const recipients = resultList(await this.event("GET", "job/recipients", {}, { entityId: targetIdent }));
      const present = recipients.some((recipient) => recipient.user === ident || recipient.user_hr === ident);
      if (!present) {
        return false;
      }
      const response = await this.event("DELETE", "job/recipient", { recipient: ident }, { entityId: targetIdent });
      return response.result;
    }
    if (target === "volume" || target === "folder" || target === "home" || target === "collection" || target === "share") {
      const found = await this.event("GET", "acl/find", {}, { query: `acl WHERE entity=user:${ident} AND target=share:${targetIdent}` });
      const acls = resultList(found);
      if (acls.length === 0) {
        return false;
      }
      const response = await this.event("DELETE", "acl/delete", {}, { entityId: String(acls[0].id) });
      return response.result;
    }
    throw new AccsynError("Unsupported revoke access target type!");
  }

  /** Deactivate an entity, keeping it for audit. */
  async deactivateOne(entityType: string, entityId: string): Promise<unknown> {
    const type = requireText(entityType, "Invalid entity type supplied, must be of string type!").toLowerCase();
    requireText(entityId, "Invalid entity ID supplied, must be of string type!");
    const response = await this.event("DELETE", `${type}/deactivate`, {}, { entityId });
    return response.result;
  }

  /** Archive an entity. ACLs must be removed with {@link Session.revoke}. */
  async deleteOne(entityType: string, entityId: string, data?: JsonObject | null): Promise<unknown> {
    const type = requireText(entityType, "Invalid entity type supplied, must be of string type!").toLowerCase();
    if (type === "acl") {
      throw new AccsynError("ACLs cannot be deleted, use the revoke function to revoke access.");
    }
    requireText(entityId, "Invalid entity ID supplied, must be of string type!");
    const response = await this.event("DELETE", `${type}/delete`, data ?? null, { entityId });
    return response.result;
  }

  /** Delete files beneath a collection. */
  async deleteMany(entityType: string, entityId: string, data: JsonObject): Promise<unknown> {
    const type = requireText(entityType, "Invalid entity type supplied, must be of string type!").toLowerCase();
    requireText(entityId, "Invalid entity ID supplied, must be of string type!");
    if (!ENTITY_ID.test(entityId)) {
      throw new AccsynError("Invalid parent entity ID supplied!");
    }
    requireRecord(data, "Invalid data supplied, must be dict and have content!");
    if (type !== "collection") {
      throw new AccsynError(`Unsupported entity type for deletion: ${type}`);
    }
    const response = await this.event("DELETE", `${type}/file/remove`, data, { entityId });
    return response.result;
  }

  /** Bring a deactivated entity back. `entityIdent` may be an id or a code. */
  async activateOne(entityType: string, entityIdent: string): Promise<unknown> {
    const type = requireText(entityType, "Invalid entity type supplied, must be of string type!").toLowerCase();
    const ident = requireText(entityIdent, "Invalid entity identification supplied, must be of string type!").toLowerCase();
    const isId = ENTITY_ID.test(ident);
    const response = await this.event("POST", `${type}/activate`, {}, {
      entityId: isId ? ident : null,
      query: isId ? null : ident,
    });
    return response.result;
  }

  /** List files on a share. `path` uses the form `share=<share>/<path>`. */
  async ls(path: FilePath, options: FileListOptions = {}): Promise<unknown> {
    assertPath(path);
    const data: JsonObject = {
      op: "ls",
      path,
      download: true,
      recursive: options.recursive ?? false,
      getsize: options.getSize ?? false,
    };
    if (options.maxDepth) {
      data.maxdepth = options.maxDepth;
    }
    if (options.directoriesOnly) {
      data.directories_only = true;
    }
    if (options.filesOnly) {
      data.files_only = true;
    }
    if (options.include) {
      data.include = options.include;
    }
    if (options.exclude) {
      data.exclude = options.exclude;
    }
    const response = await this.event("GET", "workspace/file", data);
    return response.result;
  }

  /** Size of a file or directory on a share. */
  async getSize(path: FilePath, include?: string | string[], exclude?: string | string[]): Promise<unknown> {
    assertPath(path);
    const data: JsonObject = { op: "getsize", path };
    if (include) {
      data.include = include;
    }
    if (exclude) {
      data.exclude = exclude;
    }
    const response = await this.event("GET", "workspace/file", data);
    return response.result;
  }

  /** Whether a share path exists. */
  async exists(path: FilePath): Promise<unknown> {
    assertPath(path);
    const response = await this.event("GET", "workspace/file", { op: "exists", path });
    return response.result;
  }

  /** Create a directory on a share. */
  async mkdir(path: FilePath): Promise<unknown> {
    assertPath(path);
    const response = await this.event("POST", "workspace/file", { op: "mkdir", path });
    return response.result;
  }

  /** Rename a file or directory within the same parent directory. */
  async rename(path: FilePath, pathTo: FilePath): Promise<unknown> {
    assertPath(path);
    assertPath(pathTo);
    const response = await this.event("PUT", "workspace/file", { op: "rename", path, path_to: pathTo });
    return response.result;
  }

  /** Move a file or directory on a share. */
  async move(pathSrc: FilePath, pathDst: FilePath): Promise<unknown> {
    assertPath(pathSrc);
    assertPath(pathDst);
    const response = await this.event("PUT", "workspace/file", { op: "move", path: pathSrc, path_to: pathDst });
    return response.result;
  }

  /** Delete a file or directory on a share. Set `force` to remove a non-empty directory. */
  async delete(path: FilePath, force = false): Promise<unknown> {
    assertPath(path);
    const response = await this.event("POST", "workspace/file", { op: "delete", path, force });
    return response.result;
  }

  /** Pre-process a publish file list. Directory sizes are filled in when omitted. */
  async prepublish(data: JsonObject[]): Promise<unknown> {
    if (!Array.isArray(data)) {
      throw new AccsynError("None or empty data supplied!");
    }
    const response = await this.event("PUT", "workspace/publish/preprocess", {
      files: data,
      size: publishSize(data),
    });
    return response.result;
  }

  /** Read one setting value. */
  async getSetting(name?: string | null, options: SettingScope = {}): Promise<unknown> {
    const eventData: JsonObject = {
      entitytype: options.entityType ?? "workspace",
      name: name ?? null,
    };
    if (options.integration) {
      eventData.integration = options.integration;
    }
    eventData.data = options.data ?? null;
    const response = await this.event("GET", "setting", eventData, { entityId: options.entityId });
    return response.result;
  }

  /** Read the settings object for an entity. Defaults to the workspace. */
  async getSettings(options: SettingsOptions = {}): Promise<JsonObject> {
    const payload: JsonObject = {
      entitytype: options.entityType ? options.entityType.toLowerCase().trim() : options.entityType ?? null,
      recursive: options.recursive ?? false,
      upstream: options.upstream ?? false,
      omit_defaults: options.omitDefaults ?? true,
    };
    if (options.share) {
      payload.share = options.share;
    }
    const response = await this.event("GET", "setting", payload, { entityId: options.entityId });
    return (response.result ?? {}) as JsonObject;
  }

  /** Set a setting. `value` must already be a string; serialize objects and dates first. */
  async setSetting(entityType: string, name: string, value: string, entityId?: string | null): Promise<boolean> {
    const type = requireText(entityType, "Invalid entity type supplied, must be of string type!").toLowerCase();
    requireText(name, "Invalid name supplied, must be of string type!");
    if (typeof value !== "string") {
      throw new AccsynError("Invalid value supplied, must be of string type!");
    }
    const response = await this.event("PUT", "setting", { entitytype: type, name, value }, { entityId });
    return Boolean(response.result);
  }

  /** Delete a setting. */
  async deleteSetting(entityType: string, name: string, entityId?: string | null): Promise<boolean> {
    const type = requireText(entityType, "Invalid entity type supplied, must be of string type!").toLowerCase();
    requireText(name, "Invalid name supplied, must be of string type!");
    const response = await this.event("DELETE", "setting", { entitytype: type, name }, { entityId });
    return Boolean(response.result);
  }

  /** Backend disk logs for an entity scope. */
  async logs(options: LogOptions = {}): Promise<JsonObject> {
    const payload: JsonObject = {
      entitytype: options.entityType ? options.entityType.toLowerCase().trim() : "workspace",
      sort: options.sort || "date",
      sort_reverse: options.sortReverse ?? false,
    };
    if (options.search) {
      payload.search = options.search;
    }
    const pagination: JsonObject = {};
    if (options.paginationPage != null) {
      if (!Number.isInteger(options.paginationPage)) {
        throw new AccsynError("pagination_page must be an integer!");
      }
      pagination.page = options.paginationPage;
    }
    if (options.paginationLimit != null) {
      if (!Number.isInteger(options.paginationLimit)) {
        throw new AccsynError("pagination_limit must be an integer!");
      }
      pagination.limit = options.paginationLimit;
    }
    if (options.paginationSkip != null) {
      if (!Number.isInteger(options.paginationSkip)) {
        throw new AccsynError("pagination_skip must be an integer!");
      }
      pagination.skip = options.paginationSkip;
    }
    if (options.paginationStart != null) {
      if (!Number.isInteger(options.paginationStart)) {
        throw new AccsynError("pagination_start must be an integer!");
      }
      pagination.start = options.paginationStart;
    }
    if (options.paginationSize != null) {
      if (!Number.isInteger(options.paginationSize)) {
        throw new AccsynError("pagination_size must be an integer!");
      }
      pagination.size = options.paginationSize;
    }
    if (Object.keys(pagination).length > 0) {
      payload.pagination = pagination;
    }
    const response = await this.event("GET", "log/find", payload, { entityId: options.entityId });
    return response ?? { result: [] };
  }

  /**
   * The detailed process log (console output) of a job task, for example the detailed transfer log.
   *
   * The console output is in `text_master` for the master process and `text_slave` for the slave process. The returned
   * try is in `try`, the total number of tries in `try_count` and earlier tries in `process_history`, if any.
   *
   * @param entityId ID of the job to read the process log of.
   */
  async processLogs(entityId: string, options: ProcessLogOptions = {}): Promise<JsonObject> {
    const jobId = requireText(entityId, "Invalid job ID supplied, must be of string type!");
    const payload: JsonObject = {};
    if (options.uri) {
      payload.uri = options.uri;
    }
    if (options.tryNum != null) {
      if (!Number.isInteger(options.tryNum)) {
        throw new AccsynError("try_num must be an integer!");
      }
      payload.try = options.tryNum;
    }
    if (options.master ?? true) {
      payload.master = true;
    }
    if (options.slave === true) {
      payload.slave = true;
    }
    const response = await this.event("GET", "job/process_log", payload, { entityId: jobId });
    return response ?? {};
  }

  /** Fetch the user API key. Often disabled server-side. */
  async getApiKey(): Promise<string> {
    const response = await this.event("GET", "user/api_key", {});
    return String(response.api_key ?? "");
  }

  /** Whether the desktop app is online on this machine for the logged-in user. */
  async appIsRunning(): Promise<boolean | null> {
    const response = await this.event("GET", "client/find", {}, {
      query: `user=${this.userId} AND code=${this.machine} AND type=${CLIENT_TYPE_APP}`,
    });
    return clientOnline(resultList(response));
  }

  /** Whether a server or user-server daemon is online on this machine for the logged-in user. */
  async daemonIsRunning(): Promise<boolean | null> {
    const response = await this.event("GET", "client/find", {}, {
      query: `user=${this.userId} AND code=${this.machine} AND (type=${CLIENT_TYPE_SERVER} OR type=${CLIENT_TYPE_USERSERVER})`,
    });
    return clientOnline(resultList(response));
  }

  /** Call an integration utility. */
  async integration(name: string, operation: string, data: JsonObject): Promise<unknown> {
    if (!name) {
      throw new AccsynError("No name provided");
    }
    if (!operation) {
      throw new AccsynError("No operation provided");
    }
    const response = await this.event("PUT", `workspace/integration/${name}/utility`, { operation, data });
    return response.result;
  }

  private async finishCreate(type: string, uri: string, payload: JsonObject, options: CreateOptions): Promise<Entity | Entity[]> {
    const response = await this.event("POST", `${type}/${uri}`, payload, { entityId: options.entityId });
    if (Array.isArray(response.result)) {
      const result = response.result as Entity[];
      return result.length === 1 ? result[0] : result;
    }
    return response as unknown as Entity;
  }

  private async login(): Promise<void> {
    const response = await this.rest("PUT", this.hostname, "/api/login", {}, {
      headers: {
        Authorization: basicAuth(this.username, this.apiKey),
        "X-Accsyn-Workspace": this.workspace,
      },
    });
    const result = response.result as JsonObject | undefined;
    if (!result) {
      throw new AccsynError("No result was provided!");
    }
    this.role = String(result.role ?? CLEARANCE_NONE);
    this.userId = String(result.id);
    this.sessionId = String(result.session_id);
  }

  private async resolveCode(entityType: string, ident: string, data?: JsonObject | null): Promise<string> {
    if (ENTITY_ID.test(ident)) {
      return ident;
    }
    if ((UNIQUE_ENTITY_TYPES as readonly string[]).includes(entityType)) {
      const response = await this.event("GET", `${entityType}/find`, {}, { query: `code='${ident}'` });
      const result = resultList(response);
      if (result.length > 0 && typeof result[0].id === "string") {
        return result[0].id;
      }
      if ((data ?? {}).invite === false) {
        throw new AccsynError(`No ${entityType} found with code '${ident}', and invite is not allowed!`);
      }
      this.warn(`No ${entityType} found with code '${ident}', will be invited!`);
      return ident;
    }
    throw new AccsynError(`Please supply a valid ${entityType} ID!`);
  }

  private async resolveTargetCode(targetType: string, ident: string): Promise<string> {
    if (ENTITY_ID.test(ident)) {
      return ident;
    }
    if ((UNIQUE_ENTITY_TYPES as readonly string[]).includes(targetType)) {
      const response = await this.event("GET", `${targetType}/find`, {}, { query: `code='${ident}'` });
      const result = resultList(response);
      if (result.length === 0 || typeof result[0].id !== "string") {
        throw new AccsynError(`No ${targetType} found with code '${ident}'!`);
      }
      return result[0].id;
    }
    throw new AccsynError(`Please supply a valid ${targetType} ID!`);
  }

  private async event(
    method: string,
    uri: string,
    data: JsonObject | JsonObject[] | null,
    options: { query?: string | null; entityId?: string | null } = {}
  ): Promise<JsonObject> {
    if (!this.userId) {
      throw new AccsynError("Login before posting event!");
    }
    const event: JsonObject = {
      audience: "api",
      workspace: this.workspace,
      eid: await newEventId(),
      session: this.sessionId,
      uri,
      ident: this.username,
      created: new Date(),
      hostname: this.machine,
    };
    const compressed = await maybeCompress(data);
    if (compressed.gz_data) {
      event.gz_data = compressed.gz_data;
      this.verbose(`Compressed event payload`);
    } else {
      event.data = data;
    }
    if (options.query) {
      event.query = options.query;
    }
    if (options.entityId) {
      event.id = options.entityId;
    }
    return this.rest(method, this.hostname, "/event", event);
  }

  private async rest(
    method: string,
    hostname: string | undefined,
    uri: string,
    data: JsonObject | null,
    options: { headers?: Record<string, string>; port?: number; ssl?: boolean } = {}
  ): Promise<JsonObject> {
    const proxy = resolveProxy(this.proxySetting);
    let ssl = options.ssl ?? true;
    let port = options.port ?? this.port ?? ACCSYN_PORT;
    let host = hostname || `${this.workspace}.${"accsyn.com"}`;
    if (proxy) {
      ssl = false;
    }
    if (this.dev && !uri.startsWith("registry")) {
      ssl = false;
      port = 8181;
    }
    if (proxy) {
      this.verbose(`Using accsyn proxy @ ${proxy.hostname}:${proxy.port}`);
      host = proxy.hostname;
      port = proxy.port;
    }
    const path = `/api/v3${uri.startsWith("/") ? uri : `/${uri}`}`;
    let url = `http${ssl ? "s" : ""}://${host}:${port}${path}`;
    const payload = data ?? {};
    const upper = method.toUpperCase();
    const headers: Record<string, string> = {
      ...(options.headers ?? (this.apiKey
        ? {
            Authorization: basicAuth(this.username, this.apiKey),
            "X-Accsyn-Workspace": this.workspace,
          }
        : {})),
      "X-Accsyn-Device": deviceLabel(VERSION, this.machine),
    };
    const init: RequestInit = { method: upper, headers };
    if (upper === "GET" || upper === "DELETE") {
      url += `?${urlQuote(stringify(payload))}`;
    } else {
      headers["Content-Type"] = "application/json";
      init.body = stringify(payload);
    }
    const rendered = this.prettyJson ? JSON.stringify(JSON.parse(stringify(payload)), null, 2) : stringify(payload);
    this.verbose(`REST ${upper} ${url}, data: ${rendered}`);
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.timeout * 1000),
      });
    } catch (error) {
      const message = `Could not reach ${host}:${port}! Make sure accsyn backend(${host}) can be reached from you location and no firewall is blocking outgoing TCP traffic at port ${port}. Details: ${error instanceof Error ? error.message : String(error)}`;
      this.fail(message);
    }
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = parseJson(text);
    } catch {
      const message = `The ${url} REST ${upper} operation failed! Details: ${text}`;
      this.warn(message);
      this.fail(message);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      this.fail(`The ${url} REST ${upper} operation failed! Details: ${text}`);
    }
    const body = parsed as JsonObject;
    if ("exception" in body) {
      const message = `${uri} caused an exception! Please contact ${this.workspace} admin for further support.`;
      this.warn(message);
      if (this.role === CLEARANCE_ADMIN || this.role === CLEARANCE_SUPPORT) {
        this.warn(String(body.exception));
      }
      this.fail(message);
    }
    if ("message" in body) {
      const message = String(body.message_hr || body.message);
      this.warn(message);
      this.fail(message);
    }
    return body;
  }

  private fail(message: string): never {
    this.lastMessage = message;
    throw new AccsynError(message);
  }

  private warn(message: string): void {
    this.lastMessage = message;
    console.warn(message);
  }

  private verbose(message: string): void {
    if (this.verboseLogs) {
      const line = this.prettyJson ? message : message;
      console.info(`[ACCSYN_API] ${line}`);
    }
  }
}

const DEFAULT_TIMEOUT_FALLBACK = 120;
const DEFAULT_CONNECT_TIMEOUT_FALLBACK = 10;

function basicAuth(username: string, apiKey: string): string {
  return `basic ${base64Encode(username)}:${base64Encode(apiKey)}`;
}

function firstValue(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value != null && value !== "");
}

async function loadCredentialsFile(options: SessionOptions): Promise<void> {
  if (!isNode()) {
    return;
  }
  const envFile = options.pathEnvfile || readEnv("ACCSYN_CREDENTIALS_PATH");
  if (envFile) {
    await loadEnvFile(envFile, true);
    return;
  }
  await loadEnvFile(".env", true);
}

async function normalizeCreateData(data: CreateData): Promise<JsonObject> {
  if (typeof data === "string") {
    if (data.trim().length === 0) {
      throw new AccsynError("You must provide the data to create!");
    }
    try {
      const parsed = JSON.parse(data) as unknown;
      if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
          throw new AccsynError("Empty create data submitted!");
        }
        return { tasks: parsed as JsonObject[] };
      }
      if (!parsed || typeof parsed !== "object") {
        throw new AccsynError("Empty create data submitted!");
      }
      return parsed as JsonObject;
    } catch (error) {
      if (error instanceof AccsynError) {
        throw error;
      }
      if (await fileExists(data)) {
        const parsed = await readJsonFile(data);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new AccsynError("Empty create data submitted!");
        }
        return parsed as JsonObject;
      }
      throw new AccsynError("Cannot build JSON payload data, not a valid JSON string or path to a JSON file!");
    }
  }
  if (Array.isArray(data)) {
    if (data.length === 0) {
      throw new AccsynError("Empty create data submitted!");
    }
    return { tasks: data };
  }
  if (!data || Object.keys(data).length === 0) {
    throw new AccsynError("Empty create data submitted!");
  }
  return { ...data };
}

function requireText(value: string, message: string): string {
  if (!value || typeof value !== "string") {
    throw new AccsynError(message);
  }
  return value.trim();
}

function requireRecord(data: JsonObject, message: string): void {
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length === 0) {
    throw new AccsynError(message);
  }
}

function assertOptionalBoolean(value: boolean | undefined, message: string): void {
  if (value != null && typeof value !== "boolean") {
    throw new AccsynError(message);
  }
}

function assertOptionalInteger(value: number | undefined, message: string): void {
  if (value != null && !Number.isInteger(value)) {
    throw new AccsynError(message);
  }
}

function assertPath(path: FilePath): void {
  if (typeof path === "string" && path.length > 0) {
    return;
  }
  if (Array.isArray(path) && path.length > 0) {
    return;
  }
  if (path && typeof path === "object" && !Array.isArray(path) && Object.keys(path).length > 0) {
    return;
  }
  throw new AccsynError("No path supplied, or not a string/list/dict!");
}

function resultList(response: JsonObject): Entity[] {
  return Array.isArray(response.result) ? (response.result as Entity[]) : [];
}

function clientOnline(clients: Entity[]): boolean | null {
  if (clients.length === 0) {
    return null;
  }
  let online: boolean | null = null;
  for (const client of clients) {
    online = client.status === CLIENT_STATE_ONLINE || client.status === CLIENT_STATE_DISABLED;
    if (online) {
      break;
    }
  }
  return online;
}

function publishSize(files: JsonObject[]): number {
  let total = 0;
  for (const file of files) {
    if (!("size" in file)) {
      file.size = file.is_dir === true && Array.isArray(file.files) ? publishSize(file.files as JsonObject[]) : 0;
    }
    total += Number(file.size) || 0;
  }
  return total;
}

async function newEventId(): Promise<string> {
  const webCrypto = globalThis.crypto as Crypto | undefined;
  if (webCrypto?.randomUUID) {
    return webCrypto.randomUUID();
  }
  const nodeCrypto = await import("node:crypto");
  return nodeCrypto.randomUUID();
}

function resolveProxy(setting: string | undefined): ResolvedProxy | undefined {
  if (!setting) {
    return undefined;
  }
  const parts = setting.split(":");
  if (parts.length === 1) {
    return { type: "accsyn", hostname: parts[0], port: 80 };
  }
  if (parts.length === 2 && parts[0] !== "socks" && parts[0] !== "socks5") {
    return { type: "accsyn", hostname: parts[0], port: Number(parts[1]) };
  }
  if (parts.length === 3) {
    const [type, hostname, portRaw] = parts;
    if (type === "socks" || type === "socks5") {
      throw new AccsynError("SOCKS proxies are not supported by the JavaScript API.");
    }
    if (type !== "accsyn") {
      throw new AccsynError(`Unknown proxy type "${type}"!`);
    }
    return { type: "accsyn", hostname, port: Number(portRaw) };
  }
  if (parts[0] === "socks" || parts[0] === "socks5") {
    throw new AccsynError("SOCKS proxies are not supported by the JavaScript API.");
  }
  throw new AccsynError(`Unknown proxy type "${parts[0]}"!`);
}
