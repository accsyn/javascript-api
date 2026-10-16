import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const docRoot = process.env.ACCSYN_DOC_ROOT;
if (!docRoot) {
  throw new Error("ACCSYN_DOC_ROOT is not set. Point it at the accsyn docs repository.");
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedPath = resolve(root, ".typedoc-out/index.md");
const pagePath = resolve(docRoot, "docs/developer/javascript-api.md");
const start = "<!-- api-reference:start -->";
const end = "<!-- api-reference:end -->";

const generated = readFileSync(generatedPath, "utf8").replace(/\r\n/g, "\n").trim();
const demoted = generated
  .split("\n")
  .map((line) => (/^#{1,6} /.test(line) ? `#${line}` : line))
  .join("\n")
  .replace(/^## accsyn\n+/, "## API reference\n\n");

const block = `${start}\n\n${demoted}\n\n${end}`;
let page = readFileSync(pagePath, "utf8").replace(/\r\n/g, "\n");
if (!page.includes(start) || !page.includes(end)) {
  throw new Error(`Missing ${start} / ${end} markers in ${pagePath}`);
}
page = page.replace(new RegExp(`${start}[\\s\\S]*${end}`), block);
if (!page.endsWith("\n")) {
  page += "\n";
}
writeFileSync(pagePath, page);
console.log(`Appended API reference to ${pagePath}`);
