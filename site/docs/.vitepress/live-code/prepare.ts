import { transform } from "sucrase";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { parse } from "es-module-lexer/minimal/js";
import MagicString from "magic-string";
import type { Example } from "./protocol.ts";

export function prepare(
  source: string,
  language: string,
  format: Example["format"],
  dependencyUrl: string,
) {
  if (!["ts", "typescript", "js", "javascript"].includes(language)) {
    throw new Error("Live examples support JavaScript and TypeScript only.");
  }
  const typescript = language === "ts" || language === "typescript";
  const filename = `example.${format === "commonjs" ? "c" : ""}${
    typescript ? "ts" : "js"
  }`;
  const { code, sourceMap } = transform(source, {
    transforms: typescript ? ["typescript"] : [],
    disableESTransforms: true,
    keepUnusedImports: true,
    filePath: filename,
    sourceMapOptions: { compiledFilename: "example.js" },
  });
  const map = new TraceMap(JSON.stringify(sourceMap));
  const rewritten = new MagicString(code);
  const loader = `__grammy_import_${crypto.randomUUID().replaceAll("-", "")}`;
  let dynamic = false;
  for (const specifier of parse(code)[0]) {
    if (specifier.d === -2) continue; // Keep native import.meta.
    if (specifier.d >= 0) {
      // Preserve native asynchronous loading and namespace identity, including
      // computed specifiers and import options. The helper only resolves names.
      rewritten.overwrite(specifier.ss, specifier.d, loader);
      dynamic = true;
      continue;
    }
    checkDependency(specifier.n!);
    // Static ranges exclude quotes. Leave declarations intact for native linking.
    rewritten.overwrite(
      specifier.s - 1,
      specifier.e + 1,
      JSON.stringify(dependencyUrl),
    );
  }
  if (dynamic) {
    // Append a hoisted declaration so a CommonJS "use strict" stays a directive.
    rewritten.append(`\nasync function ${loader}(specifier, options) {
  const name = \`\${specifier}\`;
  if (${JSON.stringify(dependencies)}.includes(name)) {
    return import(${JSON.stringify(dependencyUrl)}, options);
  }
  throw new Error("Unsupported dependency " + JSON.stringify(name) + ${
      JSON.stringify(dependencyHelp)
    });
}`);
  }
  const importMap = new TraceMap(
    rewritten.generateMap({ hires: true }).toString(),
  );
  return {
    code: `${rewritten}\n//# sourceURL=grammy-live-example`,
    describe(error: unknown): string {
      const e = error instanceof Error ? error : new Error(String(error));
      // Native modules have no wrapper. Function adds two lines for CommonJS.
      // Both maps stay in memory; sourceURL is a constant, never source or a token.
      const match = e.stack?.match(/grammy-live-example:(\d+):(\d+)/);
      const generated = match && originalPositionFor(importMap, {
        line: Math.max(1, Number(match[1]) - (format === "commonjs" ? 2 : 0)),
        column: Math.max(0, Number(match[2]) - 1),
      });
      const pos = generated?.line && originalPositionFor(map, {
        line: generated.line,
        column: generated.column ?? 0,
      });
      return `${e.name}: ${e.message}${
        pos && pos.line
          ? ` (${filename}:${pos.line}:${(pos.column ?? 0) + 1})`
          : ""
      }`;
    },
  };
}

export function checkDependency(specifier: string) {
  if (!dependencies.includes(specifier)) {
    throw new Error(
      `Unsupported dependency ${JSON.stringify(specifier)}${dependencyHelp}`,
    );
  }
}

const dependencies = [
  "grammy",
  "npm:grammy",
  "npm:grammy@1.46.0",
  "grammy/web",
];
const dependencyHelp =
  ". Available: grammy (1.46.0), grammy/web, npm:grammy, npm:grammy@1.46.0.";
