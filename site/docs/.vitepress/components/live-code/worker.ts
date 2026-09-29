// Runs one live example. The page starts a new worker for every run and
// terminates it to stop the example, like starting and killing a process.
//
// The example imports the bundled `grammy/web` unchanged. A worker keeps busy
// code from freezing the page, but it is no security boundary: the example can
// read the token and make any request the page could make.
import * as grammy from "grammy/web";
import {
  facade,
  type Language,
  locate,
  modules,
  prepare,
  type Prepared,
  ready,
  redact,
  resolve,
  SourceError,
  type Specifier,
  syntaxErrorAt,
} from "./prepare.ts";

/** Message from the page that starts the example */
export interface ToWorker {
  source: string;
  language: Language;
}

export type FromWorker =
  | { type: "log"; level: "log" | "info" | "warn" | "error"; text: string }
  /** An uncaught error, which ends the example like it ends a process */
  | { type: "error"; text: string; line?: number; column?: number };

const scope = globalThis as unknown as {
  postMessage(message: FromWorker): void;
};

const MODULES = modules(grammy);
const urls = new Map<Specifier, string>();
// Specifiers by URL, to name modules in messages like in the source
const names = new Map<string, string>();
let name = "example";
let prepared: Prepared | undefined;

function blob(code: string) {
  return URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
}

/** Loads the modules that examples import, via a global removed afterwards. */
async function load() {
  const global = "__grammyLiveCode";
  Object.defineProperty(globalThis, global, {
    value: MODULES,
    configurable: true,
  });
  try {
    for (const [specifier, module] of Object.entries(MODULES)) {
      const url = blob(facade(specifier as Specifier, module, global));
      await import(/* @vite-ignore */ url);
      urls.set(specifier as Specifier, url);
    }
  } finally {
    delete (globalThis as Record<string, unknown>)[global];
  }
}

const resolver = {
  url(specifier: string) {
    const url = urls.get(resolve(specifier))!;
    names.set(url, specifier);
    return url;
  },
  failing: (message: string) =>
    blob(`throw new Error(${JSON.stringify(message)});`),
};

function require(specifier: string) {
  return MODULES[resolve(specifier)].value;
}

function text(value: unknown): string {
  let result: string;
  if (typeof value === "string") result = value;
  else if (value instanceof Error) result = String(value);
  else if (typeof value === "function") result = `[Function ${value.name}]`;
  else if (typeof value !== "object" || value === null) result = String(value);
  else {
    try {
      result = JSON.stringify(
        value,
        (_, v) => typeof v === "bigint" ? `${v}n` : v,
        2,
      );
    } catch {
      result = String(value);
    }
  }
  for (const [url, specifier] of names) {
    result = result.replaceAll(url, specifier);
  }
  return redact(result);
}

// Shows console output on the page, and keeps it in the developer tools.
for (const level of ["log", "info", "warn", "error", "debug"] as const) {
  const original = console[level];
  console[level] = (...args: unknown[]) => {
    original.apply(console, args);
    scope.postMessage({
      type: "log",
      level: level === "debug" ? "log" : level,
      text: args.map(text).join(" ").slice(0, 10_000),
    });
  };
}

function fail(error: unknown) {
  // Errors in middleware are wrapped, and only the cause was thrown by the
  // example.
  const cause = error instanceof grammy.BotError ? error.error : error;
  const at = error instanceof SourceError
    ? error.at
    : prepared && cause instanceof Error
    ? locate(cause.stack, name, prepared)
    : undefined;
  scope.postMessage({ type: "error", text: text(error), ...at });
}

addEventListener("error", (event) => {
  event.preventDefault();
  fail(event.error ?? event.message);
});
addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  fail(event.reason);
});

addEventListener("message", async (event) => {
  const { source, language } = (event as MessageEvent<ToWorker>).data;
  name = `example.${language}`;
  try {
    await ready;
    await load();
    prepared = prepare(source, language, name, resolver);
  } catch (error) {
    fail(error);
    return;
  }
  try {
    if (prepared.format === "commonjs") {
      const module = { exports: {} };
      prepared.run.call(module.exports, module.exports, require, module);
    } else {
      await import(/* @vite-ignore */ blob(prepared.code));
    }
  } catch (error) {
    // Browsers do not report where a module has a syntax error.
    const at = error instanceof SyntaxError &&
        locate(error.stack, name, prepared) === undefined
      ? syntaxErrorAt(source, language)
      : undefined;
    fail(
      at === undefined
        ? error
        : new SourceError("SyntaxError", (error as Error).message, at),
    );
  }
}, { once: true });
