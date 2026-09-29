// Turns the source text shown in a documentation code block into a function
// that a worker can call. Nothing here talks to the network or the DOM, so it
// can be unit-tested without a browser.
import { transform } from "sucrase";
import type { Language } from "./protocol.ts";

/** Error in the example source, with a 1-based position if known. */
export class SourceError extends Error {
  constructor(
    message: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

/** Parameters of the compiled function, see {@link compile}. */
export type ExampleFunction = (
  require: (specifier: string) => unknown,
  module: { exports: Record<string, unknown> },
  exports: Record<string, unknown>,
) => Promise<void>;

// Kept on the same line as the first source line so that line numbers in stack
// traces match the displayed source.
const HEADER = "(async function (require, module, exports) {";

/** Number of characters that precede the source on its first line. */
export const FIRST_LINE_OFFSET = HEADER.length;

/**
 * Compiles an example without running it.
 *
 * TypeScript is stripped by Sucrase, and ES module syntax is turned into
 * `require` calls. Sucrase keeps every statement on its original line.
 * JavaScript that is already valid CommonJS is compiled unchanged, so it keeps
 * sloppy-mode semantics like in Node.js. Top-level `await` is accepted in both.
 */
export function compile(
  source: string,
  language: Language,
  sourceURL: string,
): ExampleFunction {
  if (language === "js") {
    try {
      return evaluate(source, sourceURL);
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      // Not a CommonJS script, e.g. because it uses `import`.
    }
  }
  let code: string;
  try {
    code = transform(source, {
      transforms: language === "ts" ? ["typescript", "imports"] : ["imports"],
      disableESTransforms: true,
    }).code;
  } catch (err) {
    const loc = (err as { loc?: { line: number; column: number } }).loc;
    const message = String((err as Error).message ?? err)
      .replace(/ \(\d+:\d+\)$/, "");
    throw new SourceError(message, loc?.line, loc?.column);
  }
  return evaluate(code, sourceURL);
}

function evaluate(body: string, sourceURL: string): ExampleFunction {
  // Indirect eval runs in global scope and compiles the function expression
  // without calling it. The `sourceURL` names the file in stack traces.
  return (0, eval)(`${HEADER}${body}\n})\n//# sourceURL=${sourceURL}`);
}

/**
 * Finds the position in the example source where an error was thrown, by
 * looking for the first stack frame that points into `sourceURL`.
 */
export function locate(
  stack: string | undefined,
  sourceURL: string,
): { line: number; column: number } | undefined {
  if (!stack) return undefined;
  const escaped = sourceURL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // V8 writes `example.ts:3:7` or, for eval, `example.ts, <anonymous>:3:7`.
  const match = new RegExp(`${escaped}(?:, <anonymous>)?:(\\d+):(\\d+)`)
    .exec(stack);
  if (!match) return undefined;
  const line = Number(match[1]);
  let column = Number(match[2]);
  if (line === 1) column = Math.max(1, column - FIRST_LINE_OFFSET);
  return { line, column };
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
export function satisfies(version: string, range: string): boolean | undefined {
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
