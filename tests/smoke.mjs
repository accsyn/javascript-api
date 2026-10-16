import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);

const esm = await import(pathToFileURL(new URL("./dist/index.js", root).pathname).href);
const cjs = require(new URL("./dist/index.cjs", root).pathname);

if (typeof esm.Session.connect !== "function") {
  throw new Error("ESM entry is missing Session.connect");
}
if (typeof cjs.Session.connect !== "function") {
  throw new Error("CJS entry is missing Session.connect");
}
if (typeof esm.AccsynError !== "function") {
  throw new Error("ESM entry is missing AccsynError");
}

console.log(`accsyn ${esm.VERSION} entry ok`);
