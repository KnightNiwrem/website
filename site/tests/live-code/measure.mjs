// Usage: node tests/live-code/measure.mjs /tmp/grammy-live-research [/path/to/baseline/dist]
// The comparison packages are intentionally installed outside the website.
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitepress"));
const { build } = createRequire(viteRequire.resolve("vite"))("esbuild");
const site = resolve(import.meta.dirname, "../..");
const comparison = resolve(process.argv[2]);
const size = (bytes) => ({
  raw: bytes.length,
  gzip: gzipSync(bytes, { level: 9 }).length,
  brotli: brotliCompressSync(bytes).length,
});
const entries = {
  "Prism core + history": [
    'import {createEditor} from "prism-code-editor"; import {editHistory} from "prism-code-editor/commands"; export const mount = p => createEditor(p,{language:"text",value:""},editHistory());',
    site,
  ],
  "Prism + JS/TS + history + styles (selected)": [
    'export {mountEditor} from "./docs/.vitepress/live-code/editor.ts";',
    site,
  ],
  "CodeMirror minimal + JS/TS + history + styles": [
    'import {EditorView,keymap,lineNumbers,drawSelection} from "@codemirror/view"; import {history,defaultKeymap,historyKeymap} from "@codemirror/commands"; import {syntaxHighlighting,defaultHighlightStyle} from "@codemirror/language"; import {javascript} from "@codemirror/lang-javascript"; export const mount = parent => new EditorView({parent,extensions:[lineNumbers(),drawSelection(),history(),keymap.of([...defaultKeymap,...historyKeymap]),syntaxHighlighting(defaultHighlightStyle),javascript({typescript:true}),EditorView.lineWrapping,EditorView.theme({"&":{fontSize:"16px"}})]});',
    comparison,
  ],
  "Sucrase compiler": ['export {transform} from "sucrase";', site],
  "Source map reader": [
    'export {TraceMap,originalPositionFor} from "@jridgewell/trace-mapping";',
    site,
  ],
  "grammY browser namespace": [
    'import * as grammy from "grammy/web"; export {grammy};',
    site,
  ],
};
for (const [name, [contents, resolveDir]] of Object.entries(entries)) {
  const result = await build({
    stdin: { contents, resolveDir },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    write: false,
    outdir: "/tmp/grammy-live-measure",
  });
  console.log(
    JSON.stringify({
      name,
      files: result.outputFiles.map((file) => ({
        type: file.path.endsWith(".css") ? "css" : "js",
        ...size(file.contents),
      })),
    }),
  );
}
function files(root, path = root) {
  return readdirSync(path).flatMap((name) => {
    const file = resolve(path, name);
    return statSync(file).isDirectory() ? files(root, file) : [file];
  });
}
const dist = resolve(site, "docs/.vitepress/dist");
for (
  const file of files(dist).filter((file) =>
    /\/(LiveEditor[.-]|prepare-|runtime-|runner.worker-)/.test(file)
  )
) {
  console.log(
    JSON.stringify({ name: relative(dist, file), ...size(readFileSync(file)) }),
  );
}
// Initial HTML declares its styles, entry module, and modulepreloads. Dynamic
// page-prefetching is excluded. Compress each transfer independently.
function initial(root) {
  const html = readFileSync(resolve(root, "index.html"), "utf8");
  const names = new Set(
    Array.from(
      html.matchAll(/(?:href|src)="(\/assets\/[^" ]+\.(?:js|css))"/g),
      (m) => m[1],
    ),
  );
  const total = { raw: 0, gzip: 0, brotli: 0 };
  for (const name of names) {
    const n = size(readFileSync(resolve(root, `.${name}`)));
    for (const key of Object.keys(total)) total[key] += n[key];
  }
  return { files: names.size, ...total };
}
console.log(
  JSON.stringify({ name: "initial page JS + CSS", ...initial(dist) }),
);
if (process.argv[3]) {
  console.log(
    JSON.stringify({
      name: "baseline initial page JS + CSS",
      ...initial(resolve(process.argv[3])),
    }),
  );
}
