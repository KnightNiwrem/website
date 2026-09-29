// Turns the code of a live example into code that a worker runs with the
// semantics it has in Node.js or Deno:
//
// - TypeScript is an ES module whose types are removed like `tsc` removes them,
//   including imports that are only used as types.
// - JavaScript is CommonJS if it compiles as such, and an ES module otherwise,
//   like a `.js` file without a `"type"` field in Node.js.
// - ES modules run as native modules. Import specifiers are the only change,
//   because workers resolve neither bare specifiers nor import maps.
//
// Nothing here has side effects, so that it can be unit tested.
import { TraceMap, traceSegment } from "@jridgewell/trace-mapping";
import { init, parse } from "es-module-lexer/minimal/js";
import { transform } from "sucrase";
import { GRAMMY_VERSION } from "./version.ts";

export type Language = "ts" | "js";

/** 1-based position in a source text */
export interface Position {
  line: number;
  column: number;
}

/** Error that is found before the example runs, with its position if known */
export class SourceError extends Error {
  constructor(name: string, message: string, readonly at?: Position) {
    super(message);
    this.name = name;
  }
}

/** Function of a CommonJS module, called like Node.js calls it */
export type CommonJS = (
  this: unknown,
  exports: unknown,
  require: (specifier: string) => unknown,
  module: { exports: unknown },
) => void;

export type Prepared =
  & ({ format: "commonjs"; run: CommonJS } | { format: "module"; code: string })
  & {
    /** Maps a position in the running code to the displayed source. */
    original(at: Position): Position;
  };

export interface Resolver {
  /** Returns the URL of a supported module, or throws an explanation. */
  url(specifier: string): string;
  /** Returns the URL of a module that throws the message when evaluated. */
  failing(message: string): string;
}

/** Resolves once `prepare` can be used. */
export const ready: Promise<void> = init();

// `new Function` puts two lines before the body.
const FUNCTION_LINES = 2;

/**
 * Prepares an example. `name` identifies it in stack traces. Throws a
 * {@link SourceError} for syntax errors and unsupported static imports, which
 * fail before any code runs in Node.js and Deno, too.
 */
export function prepare(
  source: string,
  language: Language,
  name: string,
  resolver: Resolver,
): Prepared {
  const sourceURL = `\n//# sourceURL=${name}`;
  if (language === "js") {
    let commonjs = true;
    try {
      compile(source);
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      // For example `import` or top-level `await`, so it is a module.
      commonjs = false;
    }
    if (commonjs) {
      // CommonJS can use `import()`.
      const { code, original } = rewrite(source, resolver, { commonjs: true });
      return {
        format: "commonjs",
        run: compile(code + sourceURL),
        original: (at) =>
          original({ line: at.line - FUNCTION_LINES, column: at.column }),
      };
    }
  }
  const stripped = language === "ts" ? strip(source, "ts") : undefined;
  const { code, original } = rewrite(stripped?.code ?? source, resolver, {
    map: stripped?.map,
    source,
    language,
  });
  return { format: "module", code: code + sourceURL, original };
}

function compile(body: string): CommonJS {
  // Like Node.js's module wrapper, but code cannot end the function early.
  return new Function("exports", "require", "module", body) as CommonJS;
}

/**
 * Replaces the import specifiers in `code` by URLs, and returns a function
 * that maps positions in the result to `source`, of which `code` is the
 * stripped form described by `map`.
 */
function rewrite(code: string, resolver: Resolver, options: {
  commonjs?: boolean;
  map?: TraceMap;
  source?: string;
  language?: Language;
}) {
  const { commonjs = false, map, source = code, language = "js" } = options;
  // The lexer expects a module, but CommonJS may `return` at the top level.
  const wrapper = commonjs ? "function f() {" : "";
  let imports;
  try {
    [imports] = parse(commonjs ? `${wrapper}${code}\n}` : code);
  } catch {
    throw new SourceError(
      "SyntaxError",
      "The example is not a valid module.",
      syntaxErrorAt(source, language),
    );
  }
  // Specifiers are replaced within lines, so only columns move.
  const shifts: { line: number; end: number; delta: number }[] = [];
  let out = "";
  let last = 0;
  for (const { n, d, s: start, e: end } of imports) {
    // `import.meta` and `import()` of a computed specifier have no name.
    if (n === undefined) continue;
    const s = start - wrapper.length;
    const e = end - wrapper.length;
    const dynamic = d > -1;
    let url: string;
    try {
      url = resolver.url(n);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!dynamic) {
        throw new SourceError(
          "Error",
          message,
          stripped(positionOf(code, s), map),
        );
      }
      url = resolver.failing(message);
    }
    // The range of a dynamic import includes the quotes, a static one does not.
    const replacement = dynamic ? JSON.stringify(url) : url;
    out += code.slice(last, s) + replacement;
    last = e;
    const at = positionOf(out, out.length);
    shifts.push({
      line: at.line,
      end: at.column,
      delta: replacement.length - (e - s),
    });
  }
  out += code.slice(last);
  return {
    code: out,
    original(at: Position): Position {
      let column = at.column;
      for (const s of shifts) {
        if (s.line === at.line && s.end <= at.column) column -= s.delta;
      }
      return stripped({ line: at.line, column }, map);
    },
  };
}

/** Maps a position in type-stripped code back to the source. */
function stripped(at: Position, map: TraceMap | undefined): Position {
  if (map === undefined) return at;
  const segment = traceSegment(map, at.line - 1, at.column - 1);
  if (segment === null) return at;
  const [generated, , line, column] = segment;
  // Removing types keeps lines, and Sucrase maps every token.
  if (column === undefined || line !== at.line - 1) return at;
  return { line: at.line, column: column + at.column - generated };
}

/** Removes TypeScript syntax, or only parses JavaScript. */
function strip(source: string, language: Language) {
  try {
    const result = transform(source, {
      transforms: language === "ts" ? ["typescript"] : [],
      disableESTransforms: true,
      filePath: `example.${language}`,
      sourceMapOptions: { compiledFilename: "example.js" },
    });
    return {
      code: result.code,
      map: new TraceMap({ ...result.sourceMap!, version: 3 }),
    };
  } catch (err) {
    const { message, loc } = err as {
      message: string;
      loc?: { line: number; column: number };
    };
    throw new SourceError(
      "SyntaxError",
      message.replace(/ \(\d+:\d+\)$/, ""),
      loc && { line: loc.line, column: loc.column + 1 },
    );
  }
}

/**
 * Finds the position of a syntax error. Browsers do not report where the
 * syntax error of a module is, so this parses the source again.
 */
export function syntaxErrorAt(
  source: string,
  language: Language,
): Position | undefined {
  try {
    strip(source, language);
  } catch (err) {
    if (err instanceof SourceError) return err.at;
  }
  return undefined;
}

function positionOf(code: string, index: number): Position {
  const lines = code.slice(0, index).split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/**
 * Finds the position in the displayed source where an error was thrown, from
 * the first stack frame that points into the example.
 */
export function locate(
  stack: string | undefined,
  name: string,
  prepared: Prepared,
): Position | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // V8 writes `example.ts:3:7`, or `example.js, <anonymous>:3:7` for code
  // compiled at runtime.
  const match = new RegExp(`${escaped}(?:, <anonymous>)?:(\\d+):(\\d+)`)
    .exec(stack ?? "");
  if (match === null) return undefined;
  return prepared.original({
    line: Number(match[1]),
    column: Number(match[2]),
  });
}

// Modules that examples can import

export const SPECIFIERS = ["grammy", "grammy/types", "grammy/web"] as const;
export type Specifier = typeof SPECIFIERS[number];

/**
 * Returns which supported module a specifier refers to, or throws an error
 * that explains why it cannot be imported. `npm:` specifiers may name a
 * version range, which the bundled grammY version has to satisfy.
 */
export function resolve(specifier: string): Specifier {
  const match = /^(npm:)?grammy(?:@([^/]*))?(\/types|\/web)?$/.exec(specifier);
  if (match === null || (match[1] === undefined && match[2] !== undefined)) {
    throw new Error(
      `Cannot import "${specifier}" here. Live examples can only import ${
        SPECIFIERS.join(", ")
      } (also with npm:).`,
    );
  }
  if (match[2] !== undefined && !satisfies(GRAMMY_VERSION, match[2])) {
    throw new Error(
      `Cannot import "${specifier}" here. Live examples run grammY ${GRAMMY_VERSION}.`,
    );
  }
  return `grammy${match[3] ?? ""}` as Specifier;
}

/**
 * Checks whether a version satisfies an npm version range. Supports exact and
 * partial versions (`1`, `1.46`, `1.x`, `*`) with an optional `^`, `~` or `=`.
 * Other ranges count as not satisfied.
 */
export function satisfies(version: string, range: string): boolean {
  const match = /^(\^|~|=)?v?(\d+|[x*])(?:\.(\d+|[x*]))?(?:\.(\d+|[x*]))?$/i
    .exec(range.trim() || "*");
  if (match === null) return false;
  const have = version.split(".").map(Number);
  // Numbers up to the first wildcard
  const want: number[] = [];
  for (const part of match.slice(2)) {
    if (part === undefined || !/^\d+$/.test(part)) break;
    want.push(Number(part));
  }
  // How many leading numbers must be equal
  let fixed = want.length;
  if (match[1] === "~") fixed = Math.min(fixed, 2);
  if (match[1] === "^") {
    const nonZero = want.findIndex((n) => n !== 0);
    if (nonZero !== -1) fixed = nonZero + 1;
  }
  for (let i = 0; i < want.length; i++) {
    if (have[i] !== want[i]) return i >= fixed && have[i] > want[i];
  }
  return true;
}

// Exports of the supported modules, shaped like Node.js and Deno provide them

export interface Module {
  /** What `require` returns, and the source of the named exports */
  value: object;
  /** Whether Node.js and Deno load the module as CommonJS */
  commonjs: boolean;
}

/**
 * Builds the supported modules from the namespace of `grammy/web`. Node.js
 * and Deno load `grammy` and `grammy/types` as CommonJS, and `grammy/web` as an
 * ES module. At runtime, `grammy/types` only contains `InputFile`.
 */
export function modules(web: object): Record<Specifier, Module> {
  const { InputFile } = web as { InputFile: unknown };
  return {
    "grammy": { value: commonJS(web), commonjs: true },
    "grammy/types": { value: commonJS({ InputFile }), commonjs: true },
    "grammy/web": { value: web, commonjs: false },
  };
}

/** Exports object like the one that TypeScript compiles to CommonJS */
function commonJS(values: object): object {
  const exports = {};
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(exports, name, {
      enumerable: true,
      get: () => value,
    });
  }
  return Object.defineProperty(exports, "__esModule", { value: true });
}

/**
 * Returns the code of an ES module that provides a module to an example. It
 * reads the module from `globalThis[global][specifier]`. Like in Node.js and
 * Deno, the default export of CommonJS is its exports object, which is also
 * exported as `module.exports`.
 */
export function facade(specifier: Specifier, module: Module, global: string) {
  const value = module.value as Record<string, unknown>;
  const names = Object.keys(value);
  if (module.commonjs) names.push("__esModule", "default", "module.exports");
  const bindings = names.map((name, i) => {
    const read = name === "default" || name === "module.exports"
      ? "m"
      : `m[${JSON.stringify(name)}]`;
    return `const e${i} = ${read};`;
  });
  return [
    `const m = globalThis[${JSON.stringify(global)}][${
      JSON.stringify(specifier)
    }].value;`,
    ...bindings,
    `export { ${
      names.map((n, i) => `e${i} as ${JSON.stringify(n)}`).join(", ")
    } };`,
  ].join("\n");
}

// Output

const TOKEN = /(?<!\d)\d{4,}:[\w-]{30,}/g;

/** Replaces everything shaped like a bot token. */
export function redact(text: string): string {
  return text.replace(TOKEN, "[bot token]");
}
