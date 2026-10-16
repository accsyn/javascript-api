export const ACCSYN_BACKEND_DOMAIN = "accsyn.com";
export const ACCSYN_BACKEND_MASTER_HOSTNAME = `master.${ACCSYN_BACKEND_DOMAIN}`;
export const ACCSYN_PORT = 443;
export const DEFAULT_EVENT_PAYLOAD_COMPRESS_SIZE_THRESHOLD = 100 * 1024;
export const DEFAULT_CONNECT_TIMEOUT = 10;
export const DEFAULT_TIMEOUT = 2 * 60;

export const CLEARANCE_SUPPORT = "support";
export const CLEARANCE_ADMIN = "admin";
export const CLEARANCE_EMPLOYEE = "employee";
export const CLEARANCE_STANDARD = "standard";
export const CLEARANCE_NONE = "none";

export const CLIENT_TYPE_APP = 0;
export const CLIENT_TYPE_SERVER = 1;
export const CLIENT_TYPE_USERSERVER = 2;
export const CLIENT_TYPE_BROWSER = 3;
export const CLIENT_TYPE_COMPUTE_LANE = 4;
export const CLIENT_TYPE_ACCSYN_VPX = 5;

export const CLIENT_STATE_INIT = "init";
export const CLIENT_STATE_ONLINE = "online";
export const CLIENT_STATE_OFFLINE = "offline";
export const CLIENT_STATE_DISABLED = "disabled";
export const CLIENT_STATE_DISABLED_OFFLINE = "disabled-offline";

export const JOB_TYPE_TRANSFER = 1;
export const JOB_TYPE_QUEUE = 2;
export const JOB_TYPE_COMPUTE = 3;
export const JOB_TYPE_DELIVERY = 7;
export const JOB_TYPE_REQUEST = 8;
export const JOB_TYPE_STREAM = 10;

export const UNIQUE_ENTITY_TYPES = [
  "user",
  "workspace",
  "share",
  "volume",
  "folder",
  "home",
  "collection",
  "site",
  "engine",
  "queue",
] as const;

const JOB_CREATE_TYPES = new Set([
  "transfer",
  "compute",
  "delivery",
  "request",
  "stream",
  "job",
  "task",
]);

export function isJobCreateType(entityType: string): boolean {
  return JOB_CREATE_TYPES.has(entityType);
}
