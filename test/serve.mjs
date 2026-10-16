import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const port = Number(process.env.PORT || 8282);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
};

function parseEnvFile(path) {
  const values = {};
  if (!existsSync(path)) {
    return values;
  }
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.length >= 2) {
      const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
      if (quoted) {
        value = value.slice(1, -1);
      }
    }
    values[key] = value;
  }
  return values;
}

const fileEnv = parseEnvFile(join(root, ".env"));

function credential(name) {
  return fileEnv[name] || process.env[name] || "";
}

function flag(name) {
  const raw = Object.prototype.hasOwnProperty.call(fileEnv, name) ? fileEnv[name] : process.env[name];
  return ["true", "1"].includes(String(raw ?? "").trim().toLowerCase());
}

function send(response, status, body, contentType) {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/env") {
    send(
      response,
      200,
      JSON.stringify({
        ACCSYN_WORKSPACE: credential("ACCSYN_WORKSPACE"),
        ACCSYN_API_USER: credential("ACCSYN_API_USER"),
        ACCSYN_API_KEY: credential("ACCSYN_API_KEY"),
        AS_DEV: flag("AS_DEV"),
      }),
      "application/json; charset=utf-8"
    );
    return;
  }

  if (url.pathname === "/") {
    response.writeHead(302, { location: "/test/index.html" });
    response.end();
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/.env" || pathname.endsWith("/.env")) {
    send(response, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }
  const relative = pathname.replace(/^\/+/, "");
  const filePath = normalize(join(root, relative));
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    send(response, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }
  if (!existsSync(filePath)) {
    send(response, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }
  try {
    send(response, 200, readFileSync(filePath), CONTENT_TYPES[extname(filePath)] || "application/octet-stream");
  } catch {
    send(response, 404, "Not found", "text/plain; charset=utf-8");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`accsyn JavaScript API test: http://127.0.0.1:${port}/`);
});
