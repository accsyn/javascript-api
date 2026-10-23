import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccsynError } from "../src/error";
import { decodeQuery } from "../src/query";
import { Session } from "../src/session";

const USER_ID = "a".repeat(24);
const ENTITY_ID = "b".repeat(24);
const SHARE_ID = "c".repeat(24);
const ENV_KEYS = [
  "ACCSYN_WORKSPACE",
  "ACCSYN_DOMAIN",
  "ACCSYN_ORG",
  "ACCSYN_API_USER",
  "ACCSYN_API_KEY",
  "ACCSYN_PROXY",
  "ACCSYN_CREDENTIALS_PATH",
  "AS_DEV",
];

interface Call {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
}

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

async function connect(
  handler?: (call: Call) => unknown,
  options: { hostname?: string; dev?: boolean } = { hostname: "acme.accsyn.com" }
) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    const call: Call = {
      url: String(url),
      method: (init.method ?? "GET").toUpperCase(),
      body: typeof init.body === "string" ? init.body : undefined,
      headers: headerRecord(init.headers),
    };
    calls.push(call);
    if (call.url.includes("J3PKTtDvolDMBtTy6AFGA")) {
      return jsonResponse({ result: { hostname: "acme.accsyn.com", port: 443 } });
    }
    if (call.url.includes("/api/login")) {
      return jsonResponse({ result: { role: "admin", id: USER_ID, session_id: "sess-1" } });
    }
    const custom = handler?.(call);
    return jsonResponse(custom ?? { result: [{ id: ENTITY_ID }] });
  });
  const session = await Session.connect({
    workspace: "acme",
    username: "user@example.com",
    apiKey: "secret",
    pathEnvfile: "/no/such/accsyn.env",
    ...options,
  });
  return { session, calls };
}

function eventOf(call: Call): Record<string, unknown> {
  if (call.body) {
    return JSON.parse(call.body) as Record<string, unknown>;
  }
  const query = call.url.split("?")[1] ?? "";
  return JSON.parse(decodeURIComponent(query)) as Record<string, unknown>;
}

function events(calls: Call[]): Array<Record<string, unknown>> {
  return calls.filter((call) => call.url.includes("/event")).map(eventOf);
}

describe("decodeQuery", () => {
  it("splits entity and expression", () => {
    expect(decodeQuery("Job WHERE code='My_Transfer'")).toEqual({
      entitytype: "job",
      expression: "code='my_transfer'",
    });
    expect(decodeQuery("entitytypes")).toEqual({ entitytype: "entitytypes" });
  });
});

describe("Session.connect", () => {
  it("logs in with basic auth and stores the session", async () => {
    const { calls } = await connect();
    const login = calls.find((call) => call.url.includes("/api/login"));
    expect(login?.method).toBe("PUT");
    expect(login?.headers.authorization).toBe(
      `basic ${Buffer.from("user@example.com").toString("base64")}:${Buffer.from("secret").toString("base64")}`
    );
    expect(login?.headers["x-accsyn-workspace"]).toBe("acme");
    expect(login?.headers["x-accsyn-device"]).toContain("JavaScriptAPI v");
  });

  it("uses the local backend when dev is set", async () => {
    const { calls } = await connect(undefined, { dev: true });
    expect(calls.some((call) => call.url.includes("master.accsyn.com"))).toBe(false);
    const login = calls.find((call) => call.url.includes("/api/login"));
    expect(login?.url.startsWith("http://127.0.0.1:8181/")).toBe(true);
  });

  it("lets an explicit dev option override AS_DEV", async () => {
    process.env.AS_DEV = "true";
    const { calls } = await connect(undefined, { dev: false, hostname: "acme.accsyn.com" });
    const login = calls.find((call) => call.url.includes("/api/login"));
    expect(login?.url.startsWith("https://acme.accsyn.com:443/")).toBe(true);
  });

  it("resolves the workspace hostname from master without credentials", async () => {
    const { calls } = await connect(undefined, {});
    const master = calls.find((call) => call.url.includes("master.accsyn.com"));
    expect(master?.url).toContain("J3PKTtDvolDMBtTy6AFGA");
    expect(master?.headers.authorization).toBeUndefined();
    expect(calls.some((call) => call.url.includes("acme.accsyn.com") && call.url.includes("/api/login"))).toBe(true);
  });

  it("reads credentials from the environment", async () => {
    process.env.ACCSYN_WORKSPACE = "acme";
    process.env.ACCSYN_API_USER = "user@example.com";
    process.env.ACCSYN_API_KEY = "secret";
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("/api/login")) {
        return jsonResponse({ result: { role: "employee", id: USER_ID, session_id: "sess-1" } });
      }
      return jsonResponse({ result: [] });
    });
    const session = await Session.connect({ hostname: "acme.accsyn.com", pathEnvfile: "/no/such/accsyn.env" });
    expect(session.username).toBe("user@example.com");
  });

  it("refuses to connect without credentials", async () => {
    await expect(Session.connect({ pathEnvfile: "/no/such/accsyn.env" })).rejects.toBeInstanceOf(AccsynError);
  });

  it("surfaces backend messages and keeps the last message", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse({ message: "Invalid API key" }));
    await expect(
      Session.connect({
        workspace: "acme",
        username: "user@example.com",
        apiKey: "secret",
        hostname: "acme.accsyn.com",
        pathEnvfile: "/no/such/accsyn.env",
      })
    ).rejects.toThrow("Invalid API key");
  });

  it("keeps the last failed call message", async () => {
    const { session } = await connect(() => ({ message: "nope" }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(session.find("job")).rejects.toThrow("nope");
    expect(session.getLastMessage()).toBe("nope");
  });
});

describe("Session methods", () => {
  it("creates a transfer and a file", async () => {
    const { session, calls } = await connect();
    const created = await session.create("Transfer", { source: "share=vol/a" }, { allowDuplicates: true });
    expect(created).toEqual({ id: ENTITY_ID });
    let event = events(calls).at(-1)!;
    expect(event.audience).toBe("api");
    expect(event.uri).toBe("transfer/create");
    expect(event.session).toBe("sess-1");
    expect((event.data as { allow_duplicates: boolean }).allow_duplicates).toBe(true);

    await session.create("file", { filename: "a.txt" });
    event = events(calls).at(-1)!;
    expect(event.uri).toBe("file/add");
  });

  it("wraps task lists and compresses large payloads", async () => {
    const { session, calls } = await connect();
    await session.create("task", [{ filename: "x".repeat(110_000) }], { entityId: ENTITY_ID });
    const event = events(calls).at(-1)!;
    expect(event.uri).toBe("task/create");
    expect(event.id).toBe(ENTITY_ID);
    expect(event.data).toBeUndefined();
    const decoded = JSON.parse(gunzipSync(Buffer.from(String(event.gz_data), "base64")).toString("utf8")) as {
      tasks: Array<{ filename: string }>;
    };
    expect(decoded.tasks[0].filename).toHaveLength(110_000);
  });

  it("queries, updates, and reports", async () => {
    const { session, calls } = await connect((call) => {
      const event = eventOf(call);
      if (event.uri === "job/report") {
        return { report: "ok" };
      }
      if (event.uri === "job/metrics") {
        return { result: { speed: 1 } };
      }
      if (String(event.uri).endsWith("/edit")) {
        return { result: [{ id: ENTITY_ID, status: "paused" }] };
      }
      return { result: [{ id: ENTITY_ID, code: "JOB" }] };
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const rows = await session.find("Job WHERE code='JOB'", { finished: true, attributes: ["code"], limit: 5 });
    expect(rows).toEqual([{ id: ENTITY_ID, code: "JOB" }]);
    expect(events(calls).at(-1)?.uri).toBe("job/find");

    const one = await session.findOne("job WHERE id=1");
    expect(one).toEqual({ id: ENTITY_ID, code: "JOB" });

    await session.find("share", { offline: true });
    expect(console.warn).toHaveBeenCalled();

    const entity = await session.getEntity("job", ENTITY_ID);
    expect(entity?.id).toBe(ENTITY_ID);

    expect(await session.report("job WHERE code='JOB'")).toBe("ok");
    expect(await session.metrics("job WHERE code='JOB'", ["speed"], "-1d")).toEqual({ speed: 1 });
    expect(await session.update("job", ENTITY_ID, { status: "paused" })).toEqual({ id: ENTITY_ID, status: "paused" });
    expect(await session.updateMany("task", ENTITY_ID, [{ id: SHARE_ID, status: "paused" }])).toEqual([
      { id: ENTITY_ID, status: "paused" },
    ]);
    await expect(session.update("acl", ENTITY_ID, { read: true })).rejects.toThrow(/grant/);
    await expect(session.updateMany("job", ENTITY_ID, [{ id: SHARE_ID }])).rejects.toThrow(/task/);
  });

  it("assigns, grants, lists access, and revokes", async () => {
    const { session, calls } = await connect((call) => {
      const event = eventOf(call);
      if (event.uri === "user/find" || event.uri === "volume/find") {
        return { result: [{ id: event.uri === "user/find" ? USER_ID : SHARE_ID }] };
      }
      if (String(event.uri).endsWith("/servers")) {
        return { result: [{ id: ENTITY_ID }] };
      }
      if (event.uri === "job/recipients") {
        return { result: [{ user: USER_ID, user_hr: "user@example.com" }] };
      }
      if (event.uri === "acl/find") {
        return {
          result: [
            {
              id: ENTITY_ID,
              entity: `user:${USER_ID}`,
              entity_hr: "user@example.com",
              target: `share:${SHARE_ID}`,
              target_hr: "projects",
              read: true,
              write: false,
              path: "/incoming",
            },
          ],
        };
      }
      if (event.uri === "acl/create") {
        return { result: [{ id: ENTITY_ID, read: true }] };
      }
      return { result: true };
    });

    expect(await session.assign("share", "server", { share: SHARE_ID, server: ENTITY_ID })).toBe(true);
    expect(events(calls).at(-1)?.uri).toBe("share/server");
    expect(await session.assignments("volume", SHARE_ID)).toEqual([{ id: ENTITY_ID }]);
    expect(await session.deassign("volume", "server", { volume: SHARE_ID, server: ENTITY_ID })).toBe(true);

    const granted = await session.grant("user", "User@Example.com", "volume", "projects");
    expect(granted).toEqual({ id: ENTITY_ID, read: true });
    const acl = events(calls).find((event) => event.uri === "acl/create");
    expect(acl?.data).toMatchObject({ entity: `user:${USER_ID}`, target: `share:${SHARE_ID}`, read: true, write: true });

    const access = await session.access("volume", SHARE_ID, { recursive: true });
    expect(access[0]).toMatchObject({ user: USER_ID, share: SHARE_ID, path: "/incoming" });

    expect(await session.revoke("user", USER_ID, "delivery", ENTITY_ID)).toBe(true);
    expect(await session.revoke("user", USER_ID, "share", SHARE_ID)).toBe(true);
  });

  it("deactivates, deletes, activates, and runs file operations", async () => {
    const { session, calls } = await connect(() => ({ result: true }));
    expect(await session.deactivateOne("share", SHARE_ID)).toBe(true);
    expect(events(calls).at(-1)?.uri).toBe("share/deactivate");
    expect(await session.deleteOne("job", ENTITY_ID, { force: true })).toBe(true);
    expect(await session.deleteMany("collection", SHARE_ID, { files: ["a"] })).toBe(true);
    expect(events(calls).at(-1)?.uri).toBe("collection/file/remove");
    await session.activateOne("user", "editor@example.com");
    expect(events(calls).at(-1)?.query).toBe("editor@example.com");

    expect(await session.ls("share=projects/in", { recursive: true, filesOnly: true })).toBe(true);
    expect(events(calls).at(-1)?.data).toMatchObject({ op: "ls", recursive: true, files_only: true });
    expect(await session.getSize("share=projects/in", "*.mov")).toBe(true);
    expect(await session.exists("share=projects/in")).toBe(true);
    expect(await session.mkdir("share=projects/in")).toBe(true);
    expect(await session.rename("share=projects/a", "share=projects/b")).toBe(true);
    expect(await session.move("share=projects/a", "share=projects/c")).toBe(true);
    expect(events(calls).at(-1)?.data).toMatchObject({ op: "move" });
    expect(await session.delete("share=projects/a", true)).toBe(true);
    expect(events(calls).at(-1)?.data).toMatchObject({ op: "delete", force: true });
    await expect(session.deleteOne("acl", ENTITY_ID)).rejects.toThrow(/revoke/);
  });

  it("preprocesses publishes and reads settings and logs", async () => {
    const { session, calls } = await connect((call) => {
      const event = eventOf(call);
      if (event.uri === "workspace/publish/preprocess") {
        return { result: { ok: true } };
      }
      if (event.uri === "setting" && call.method === "GET") {
        return { result: event.data && (event.data as { name?: string }).name ? "dark" : { theme: "dark" } };
      }
      if (event.uri === "log/find") {
        return { result: [{ text: "hello" }] };
      }
      return { result: true };
    });
    const files = [{ filename: "a", is_dir: true, files: [{ filename: "b", size: 4 }] }] as Array<Record<string, unknown>>;
    expect(await session.prepublish(files)).toEqual({ ok: true });
    expect(files[0].size).toBe(4);
    expect(await session.getSetting("theme", { entityType: "user", entityId: USER_ID })).toBe("dark");
    expect(await session.getSettings({ entityType: "workspace", upstream: true })).toEqual({ theme: "dark" });
    expect(await session.setSetting("workspace", "theme", "dark")).toBe(true);
    await expect(session.setSetting("workspace", "theme", { dark: true } as unknown as string)).rejects.toThrow(/string/);
    expect(await session.deleteSetting("workspace", "theme")).toBe(true);
    const logs = await session.logs({ search: "hello", paginationLimit: 10 });
    expect(logs.result).toEqual([{ text: "hello" }]);
    expect(events(calls).at(-1)?.data).toMatchObject({
      entitytype: "workspace",
      search: "hello",
      pagination: { limit: 10 },
    });
    await session.logs({ entityType: "job", entityId: ENTITY_ID, paginationStart: -1, paginationSize: 50 });
    expect(events(calls).at(-1)?.data).toMatchObject({
      entitytype: "job",
      pagination: { start: -1, size: 50 },
    });
    await expect(session.logs({ paginationSize: 1.5 })).rejects.toThrow(/pagination_size/);
  });

  it("reads process logs of a job", async () => {
    const { session, calls } = await connect((call) => {
      const event = eventOf(call);
      if (event.uri === "job/process_log") {
        return { uri: "task/1", try: 1, try_count: 2, text_master: "console output" };
      }
      return { result: true };
    });
    const last = () => events(calls).at(-1);

    // The master log is fetched by default, for the first processed task and the latest try.
    const response = await session.processLogs(ENTITY_ID);
    expect(response.text_master).toBe("console output");
    expect(last()).toMatchObject({ uri: "job/process_log", id: ENTITY_ID });
    expect(last()?.data).toEqual({ master: true });
    expect(calls.at(-1)?.method).toBe("GET");

    await session.processLogs(ENTITY_ID, { uri: "task/1", tryNum: 0 });
    expect(last()?.data).toEqual({ uri: "task/1", try: 0, master: true });

    await session.processLogs(ENTITY_ID, { master: false, slave: true });
    expect(last()?.data).toEqual({ slave: true });

    await expect(session.processLogs("")).rejects.toThrow(/job ID/);
    await expect(session.processLogs(ENTITY_ID, { tryNum: 1.5 })).rejects.toThrow(/try_num/);
  });

  it("checks clients, api keys, and integrations", async () => {
    const { session } = await connect((call) => {
      const event = eventOf(call);
      if (event.uri === "user/api_key") {
        return { api_key: "fetched" };
      }
      if (event.uri === "client/find") {
        return { result: [{ status: "online" }] };
      }
      return { result: { ran: true } };
    });
    expect(await session.getApiKey()).toBe("fetched");
    expect(await session.appIsRunning()).toBe(true);
    expect(await session.daemonIsRunning()).toBe(true);
    expect(await session.integration("ftrack", "scan", { project: "P" })).toEqual({ ran: true });
    expect(await Session.getHostname()).toBeTypeOf("string");
  });

  it("decodes backend timestamps", async () => {
    const { session } = await connect(() => ({ result: [{ id: ENTITY_ID, created: "2020-01-02T03:04:05" }] }));
    const entity = await session.getEntity("job", ENTITY_ID);
    expect(entity?.created).toBeInstanceOf(Date);
    expect((entity?.created as Date).toISOString()).toBe("2020-01-02T03:04:05.000Z");
  });
});
