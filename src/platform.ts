import { DEFAULT_EVENT_PAYLOAD_COMPRESS_SIZE_THRESHOLD } from "./constants";
import { estimateSize, stringify } from "./json";

interface NodeProcess {
  env: Record<string, string | undefined>;
  platform?: string;
  versions?: { node?: string };
}

export function nodeProcess(): NodeProcess | undefined {
  const candidate = (globalThis as { process?: NodeProcess }).process;
  if (candidate?.versions?.node) {
    return candidate;
  }
  return undefined;
}

export function isNode(): boolean {
  return nodeProcess() !== undefined;
}

export function readEnv(name: string): string | undefined {
  return nodeProcess()?.env[name];
}

export function base64Encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return bytesToBase64(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  const bufferCtor = (globalThis as { Buffer?: { from(input: Uint8Array): { toString(encoding: string): string } } }).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(bytes).toString("base64");
  }
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/** Match urllib.parse.quote with safe="/". */
export function urlQuote(value: string): string {
  let encoded = "";
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) {
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.\/]/.test(char)) {
      encoded += char;
    } else {
      encoded += `%${byte.toString(16).toUpperCase()}`;
    }
  }
  return encoded;
}

export async function machineHostname(): Promise<string> {
  if (!isNode()) {
    return "unknown";
  }
  const os = await import("node:os");
  return os.hostname();
}

export function deviceLabel(version: string, hostname: string): string {
  const proc = nodeProcess();
  const platform = proc?.platform ?? "browser";
  return `JavaScriptAPI v${version} @ ${platform} ${hostname}(${platform})`;
}

export async function loadEnvFile(path: string, override: boolean): Promise<void> {
  const proc = nodeProcess();
  if (!proc) {
    return;
  }
  const fs = await import("node:fs");
  if (!fs.existsSync(path)) {
    return;
  }
  const text = fs.readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.length >= 2) {
      const quoted =
        (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
      if (quoted) {
        value = value.slice(1, -1);
      }
    }
    if (override || proc.env[key] === undefined) {
      proc.env[key] = value;
    }
  }
}

export async function readJsonFile(path: string): Promise<unknown> {
  const fs = await import("node:fs/promises");
  const text = await fs.readFile(path, "utf8");
  return JSON.parse(text);
}

export async function fileExists(path: string): Promise<boolean> {
  if (!isNode()) {
    return false;
  }
  const fs = await import("node:fs/promises");
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export async function gzipBase64(text: string): Promise<string> {
  const input = new TextEncoder().encode(text);
  if (typeof CompressionStream !== "undefined") {
    const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("gzip"));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return bytesToBase64(compressed);
  }
  const zlib = await import("node:zlib");
  return bytesToBase64(zlib.gzipSync(input));
}

export async function maybeCompress(data: unknown): Promise<{ data?: unknown; gz_data?: string }> {
  if (data != null && estimateSize(data) > DEFAULT_EVENT_PAYLOAD_COMPRESS_SIZE_THRESHOLD) {
    const json = stringify(data);
    return { gz_data: await gzipBase64(json) };
  }
  return { data };
}
