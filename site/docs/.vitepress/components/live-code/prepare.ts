// Prepares the source text shown in a documentation code block for running in
// a worker, while keeping the semantics it would have in a typical setup:
//
// - TypeScript is an ES module. Types are removed like `tsc` does (including
//   imports that are only used as types), and nothing else is changed.
// - JavaScript is CommonJS if it parses as such, and an ES module otherwise.
//   This matches how Node.js runs a `.js` file without a `"type"` field.
// - ES modules run as native modules. Only import specifiers are replaced by
//   URLs, since workers resolve neither bare specifiers nor import maps.
//
// Nothing here talks to the network, so it can be tested without a browser.
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { init, parse } from "es-module-lexer/minimal/js";
import { transform } from "sucrase";
import type { Language } from "./protocol.ts";

/**
 * Error in the example source, with a 1-based position if known. Its name is
 * what a typical runtime would report, such as `SyntaxError`.
 */
export class SourceError extends Error {
  constructor(
    name: string,
    message: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(message);
    this.name = name;
  }
}

/** CommonJS module function, called like Node.js does. */
export type CommonJSFunction = (
  this: unknown,
  exports: Record<string, unknown>,
  require: (specifier: string) => unknown,
  module: { exports: Record<string, unknown> },
) => void;

export interface Position {
  line: number;
  column: number;
}

export type Prepared =
  | { format: "commonjs"; run: CommonJSFunction }
  | { format: "module"; code: string; sourceMap?: TraceMap };

export interface Modules {
  /** Returns the URL of a supported module, or throws an explanation. */
  resolve(specifier: string): string;
  /** Returns the URL of a module that throws the given message. */
  failing(message: string): string;
}

// Kept on the same line as the first source line so that line numbers in stack
// traces match the displayed source.
const HEADER = "(function (exports, require, module) {";

/** Resolves once the module lexer can be used. */
export const ready: Promise<void> = init();

/**
 * Prepares an example. `sourceURL` names it in stack traces. Throws a
 * {@link SourceError} for syntax errors and unsupported static imports, which
 * would also fail before any code runs in a typical setup.
 */
export function prepare(
  source: string,
  language: Language,
  sourceURL: string,
  modules: Modules,
): Prepared {
  if (language === "js") {
    let script = true;
    try {
      evaluate(source, sourceURL);
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      // Not CommonJS, e.g. because of `import` or top-level `await`.
      script = false;
    }
    if (script) {
      // CommonJS can still use `import()`.
      const code = rewrite(source, source, undefined, "js", modules);
      return { format: "commonjs", run: evaluate(code, sourceURL) };
    }
  }
  let code = source;
  let sourceMap: TraceMap | undefined;
  if (language === "ts") {
    const result = strip(source, true);
    code = result.code;
    sourceMap = new TraceMap(result.sourceMap as never);
  }
  return {
    format: "module",
    code: `${rewrite(code, source, sourceMap, language, modules)}\n` +
      `//# sourceURL=${sourceURL}`,
    sourceMap,
  };
}

function evaluate(body: string, sourceURL: string): CommonJSFunction {
  // Indirect eval compiles the function in global scope without calling it.
  return (0, eval)(`${HEADER}${body}\n})\n//# sourceURL=${sourceURL}`);
}

/** Replaces import specifiers by the URLs of the modules. */
function rewrite(
  code: string,
  source: string,
  sourceMap: TraceMap | undefined,
  language: Language,
  modules: Modules,
): string {
  let imports;
  try {
    [imports] = parse(code);
  } catch {
    // Not valid module syntax; find out where with Sucrase.
    throw findSyntaxError(source, language) ??
      new SourceError("SyntaxError", "The example is not a valid module.");
  }
  let out = "";
  let last = 0;
  for (const i of imports) {
    // Skip `import.meta` and dynamic imports of computed specifiers.
    if (i.n === undefined) continue;
    const dynamic = i.d > -1;
    let url: string;
    try {
      url = modules.resolve(i.n);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!dynamic) {
        const at = original(sourceMap, positionOf(code, i.s));
        throw new SourceError("Error", message, at.line, at.column);
      }
      // Dynamic imports fail when they are evaluated.
      url = modules.failing(message);
    }
    // Dynamic import ranges include the quotes of the string literal.
    out += code.slice(last, i.s) + (dynamic ? JSON.stringify(url) : url);
    last = i.e;
  }
  return out + code.slice(last);
}

/** Removes TypeScript syntax, or only checks the syntax of JavaScript. */
function strip(source: string, typescript: boolean) {
  try {
    return transform(source, {
      transforms: typescript ? ["typescript"] : [],
      disableESTransforms: true,
      filePath: typescript ? "example.ts" : "example.js",
      sourceMapOptions: { compiledFilename: "example.js" },
    });
  } catch (err) {
    const loc = (err as { loc?: { line: number; column: number } }).loc;
    const message = String((err as Error).message ?? err)
      .replace(/ \(\d+:\d+\)$/, "");
    throw new SourceError("SyntaxError", message, loc?.line, loc?.column);
  }
}

/**
 * Browsers do not tell where a module has a syntax error, so this parses the
 * source again with Sucrase to find it.
 */
export function findSyntaxError(
  source: string,
  language: Language,
): SourceError | undefined {
  try {
    strip(source, language === "ts");
  } catch (err) {
    if (err instanceof SourceError) return err;
  }
  return undefined;
}

function positionOf(code: string, index: number): Position {
  const before = code.slice(0, index).split("\n");
  return { line: before.length, column: before[before.length - 1].length + 1 };
}

/** Maps a position in the prepared code back to the displayed source. */
function original(sourceMap: TraceMap | undefined, at: Position): Position {
  if (sourceMap === undefined) return at;
  const pos = originalPositionFor(sourceMap, {
    line: at.line,
    column: at.column - 1,
  });
  // Types are removed without changing lines, so only columns are mapped.
  // Columns after a replaced import specifier on the same line are not exact.
  return {
    line: at.line,
    column: pos.line === at.line ? pos.column + 1 : at.column,
  };
}

/**
 * Finds the position in the example source where an error was thrown, by
 * looking for the first stack frame that points into `sourceURL`.
 */
export function locate(
  stack: string | undefined,
  sourceURL: string,
  prepared?: Prepared,
): Position | undefined {
  if (!stack) return undefined;
  const escaped = sourceURL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // V8 writes `example.ts:3:7` or, for eval, `example.ts, <anonymous>:3:7`.
  const match = new RegExp(`${escaped}(?:, <anonymous>)?:(\\d+):(\\d+)`)
    .exec(stack);
  if (!match) return undefined;
  const at = { line: Number(match[1]), column: Number(match[2]) };
  if (prepared?.format === "commonjs") {
    if (at.line === 1) at.column = Math.max(1, at.column - HEADER.length);
    return at;
  }
  return original(prepared?.sourceMap, at);
}

export interface Specifier {
  /** Package name, such as `grammy` or `@grammyjs/runner` */
  name: string;
  /** Version or range after `@`, only for `npm:` specifiers */
  version?: string;
  /** Subpath after the package name, such as `/types`, or `""` */
  subpath: string;
}

/**
 * Parses a bare package specifier (`grammy/types`) or a Deno `npm:` specifier
 * (`npm:grammy@1.46/types`). Returns `undefined` for relative paths, URLs,
 * `node:` and `jsr:` specifiers, and anything else that does not name an npm
 * package.
 */
export function parseSpecifier(specifier: string): Specifier | undefined {
  const npm = specifier.startsWith("npm:");
  const rest = npm ? specifier.slice(4).replace(/^\//, "") : specifier;
  const match =
    /^((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)(?:@([^/]+))?(\/.*)?$/i
      .exec(rest);
  if (!match || (!npm && match[2] !== undefined)) return undefined;
  return { name: match[1], version: match[2], subpath: match[3] ?? "" };
}

/**
 * Checks whether a version requested in an `npm:` specifier is satisfied by
 * the bundled version. Supports exact and partial versions (`1`, `1.46`,
 * `1.x`), `^` and `~`. Returns `undefined` for syntax it does not understand.
 */
export function satisfies(
  version: string,
  range: string,
): boolean | undefined {
  const m = /^(\^|~|=|v)?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/
    .exec(range.trim());
  if (!m) return undefined;
  const [op, ...parts] = [m[1] ?? "", m[2], m[3], m[4]];
  const have = version.split(".").map(Number);
  const want = parts.map((p) =>
    p === undefined || p === "x" || p === "*" ? undefined : Number(p)
  );
  const fixed = want.findIndex((p) => p === undefined);
  const len = fixed === -1 ? 3 : fixed;
  const cmp = compare(have, want, len);
  switch (op) {
    case "^": {
      // Everything left of the first non-zero part is fixed.
      const lock = want.findIndex((p, i) => (p ?? 0) !== 0 || i === len - 1);
      return cmp >= 0 && compare(have, want, Math.min(lock + 1, len)) === 0;
    }
    case "~":
      return cmp >= 0 && compare(have, want, Math.min(2, len)) === 0;
    default:
      return cmp === 0;
  }
}

function compare(have: number[], want: (number | undefined)[], len: number) {
  for (let i = 0; i < len; i++) {
    const d = have[i] - (want[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}
