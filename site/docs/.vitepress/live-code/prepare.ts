import { transform } from "sucrase";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";

export function prepare(source: string, language: string) {
  if (!["ts", "typescript", "js", "javascript"].includes(language)) {
    throw new Error("Live examples support JavaScript and TypeScript only.");
  }
  const { code, sourceMap } = transform(source, {
    transforms: language === "js" || language === "javascript"
      ? ["imports"]
      : ["typescript", "imports"],
    disableESTransforms: true,
    preserveDynamicImport: false,
    keepUnusedImports: true,
    filePath: "example.ts",
    sourceMapOptions: { compiledFilename: "example.js" },
  });
  const map = new TraceMap(JSON.stringify(sourceMap));
  return {
    code,
    describe(error: unknown): string {
      const e = error instanceof Error ? error : new Error(String(error));
      // AsyncFunction adds two wrapper lines. No source or source map is put in a URL.
      const match = e.stack?.match(/grammy-live-example:(\d+):(\d+)/);
      const pos = match && originalPositionFor(map, {
        line: Math.max(1, Number(match[1]) - 2),
        column: Math.max(0, Number(match[2]) - 1),
      });
      return `${e.name}: ${e.message}${
        pos?.line ? ` (example.ts:${pos.line}:${(pos.column ?? 0) + 1})` : ""
      }`;
    },
  };
}

export function dependencyRegistry(grammy: object) {
  return (specifier: string) => {
    if (
      ["grammy", "npm:grammy", "npm:grammy@1.46.0", "grammy/web"].includes(
        specifier,
      )
    ) {
      return grammy;
    }
    throw new Error(
      `Unsupported dependency ${
        JSON.stringify(specifier)
      }. Available: grammy (1.46.0), grammy/web, npm:grammy, npm:grammy@1.46.0.`,
    );
  };
}
