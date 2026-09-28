// Usage: deno task test:live:measure /tmp/grammy-live-research [/path/to/baseline/dist]
// The comparison packages are intentionally installed outside the website.
import { relative, resolve } from "@std/path";
import { build } from "esbuild";
// Deno supplies node:zlib; no Node executable is needed for compression.
import { brotliCompressSync, gzipSync } from "node:zlib";

if (!Deno.args[0]) throw new Error("Pass the comparison dependency directory.");
const site = resolve(import.meta.dirname!, "../..");
const comparison = resolve(Deno.args[0]);
const size = (bytes: Uint8Array) => ({
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
  "ES module lexer (JS build)": [
    'export {parse} from "es-module-lexer/minimal/js";',
    site,
  ],
  "Source rewriting + maps": ['export {default} from "magic-string";', site],
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
function files(path: string): string[] {
  return Array.from(Deno.readDirSync(path)).flatMap((entry) => {
    const file = resolve(path, entry.name);
    return entry.isDirectory ? files(file) : [file];
  });
}
const dist = resolve(site, "docs/.vitepress/dist");
for (
  const file of files(dist).filter((file) =>
    /\/(LiveEditor[.-]|prepare-|runtime-|runner.worker-)/.test(file)
  )
) {
  console.log(
    JSON.stringify({
      name: relative(dist, file),
      ...size(Deno.readFileSync(file)),
    }),
  );
}
// Initial HTML declares its styles, entry module, and modulepreloads. Dynamic
// page-prefetching is excluded. Compress each transfer independently.
function initial(root: string) {
  const html = Deno.readTextFileSync(resolve(root, "index.html"));
  const names = new Set(
    Array.from(
      html.matchAll(/(?:href|src)="(\/assets\/[^" ]+\.(?:js|css))"/g),
      (m) => m[1],
    ),
  );
  const total = { raw: 0, gzip: 0, brotli: 0 };
  for (const name of names) {
    const n = size(Deno.readFileSync(resolve(root, `.${name}`)));
    for (const key of ["raw", "gzip", "brotli"] as const) total[key] += n[key];
  }
  return { files: names.size, ...total };
}
console.log(
  JSON.stringify({ name: "initial page JS + CSS", ...initial(dist) }),
);
if (Deno.args[1]) {
  console.log(
    JSON.stringify({
      name: "baseline initial page JS + CSS",
      ...initial(resolve(Deno.args[1])),
    }),
  );
}
