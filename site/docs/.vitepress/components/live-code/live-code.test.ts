// Run with `deno task test`. Browser behavior is covered separately.
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertMatch,
  assertThrows,
} from "@std/assert";
import {
  findSyntaxError,
  locate,
  type Modules,
  parseSpecifier,
  prepare,
  type Prepared,
  ready,
  satisfies,
  SourceError,
} from "./prepare.ts";
import {
  botKey,
  GRAMMY_VERSION,
  languageOf,
  redact,
  REDACTED,
} from "./protocol.ts";

await ready;

const dataURL = (code: string) =>
  `data:text/javascript;base64,${btoa(unescape(encodeURIComponent(code)))}`;

// Stands in for grammY: records calls on a global.
const FAKE_GRAMMY = dataURL(`
const record = (call) => globalThis.calls.push(call);
export class Bot {
  constructor(token) { record("new:" + token); }
  on(filter) { record("on:" + filter); }
  start() { record("start"); }
}
export class InputFile {}
export default { Bot };
`);

const modules: Modules = {
  resolve(specifier) {
    if (/^(npm:)?grammy(\/(web|types))?$/.test(specifier)) return FAKE_GRAMMY;
    throw new Error(`Cannot import "${specifier}" here.`);
  },
  failing: (message) => dataURL(`throw new Error(${JSON.stringify(message)});`),
};

let runs = 0;

/** Prepares and runs an example, returning what it recorded. */
async function run(source: string, language: "ts" | "js") {
  const g = globalThis as { calls?: string[] };
  g.calls = [];
  const prepared = prepare(source, language, `example.${language}`, modules);
  let exports: Record<string, unknown> = {};
  if (prepared.format === "commonjs") {
    const module = { exports };
    const required: string[] = [];
    prepared.run.call(module.exports, module.exports, (s: string) => {
      required.push(s);
      return import(modules.resolve(s));
    }, module);
    exports = module.exports;
  } else {
    // A unique URL per run, like the worker's blob URLs.
    exports = await import(dataURL(`${prepared.code}\n// ${++runs}`));
  }
  return { prepared, exports, calls: g.calls };
}

const homepage = (importLine: string) =>
  `${importLine}

const bot = new Bot(""); // <-- put your bot token between the "" (https://t.me/BotFather)

// Reply to any message with "Hi there!".
bot.on("message", (ctx) => ctx.reply("Hi there!"));

bot.start();
`;

Deno.test("languageOf maps VitePress classes", () => {
  assertEquals(languageOf("language-ts vp-adaptive-theme active"), "ts");
  assertEquals(languageOf("language-typescript"), "ts");
  assertEquals(languageOf("language-js line-numbers-mode"), "js");
  assertEquals(languageOf("language-sh"), undefined);
  assertEquals(languageOf("vp-code-group"), undefined);
});

Deno.test("TypeScript and Deno variants run as native ES modules", async () => {
  for (
    const line of [
      'import { Bot } from "grammy";',
      'import { Bot } from "npm:grammy";',
    ]
  ) {
    const { prepared, calls } = await run(homepage(line), "ts");
    assertEquals(prepared.format, "module");
    assertEquals(calls, ["new:", "on:message", "start"]);
  }
});

Deno.test("JavaScript that parses as CommonJS stays CommonJS", () => {
  const prepared = prepare(
    homepage('const { Bot } = require("grammy");'),
    "js",
    "example.js",
    modules,
  );
  assertEquals(prepared.format, "commonjs");
  // Sloppy mode and `this === module.exports`, like in Node.js.
  const module = { exports: {} as Record<string, unknown> };
  const cjs = prepare(
    `undeclared = 1; this.x = undeclared;`,
    "js",
    "example.js",
    modules,
  ) as Extract<Prepared, { format: "commonjs" }>;
  cjs.run.call(module.exports, module.exports, () => ({}), module);
  assertEquals(module.exports.x, 1);
});

Deno.test("JavaScript with module syntax or top-level await is a module", () => {
  assertEquals(
    prepare(`import { Bot } from "grammy";`, "js", "example.js", modules)
      .format,
    "module",
  );
  assertEquals(
    prepare(`await 1;`, "js", "example.js", modules).format,
    "module",
  );
  assertEquals(
    prepare(`console.log(import.meta.url);`, "js", "example.js", modules)
      .format,
    "module",
  );
});

Deno.test("module semantics are kept", async () => {
  // Imports are hoisted, modules are strict, and bindings are read-only.
  const { exports } = await run(
    `export const before = typeof Bot;
export const self = this;
export let strict = false;
try { undeclaredInModule = 1; } catch { strict = true; }
export let readOnly = false;
try { Bot = 1; } catch { readOnly = true; }
export const value: number = await Promise.resolve(2);
import { Bot } from "grammy";
import * as all from "grammy";
export const namespace = Object.prototype.toString.call(all);`,
    "ts",
  );
  assertEquals(exports.before, "function");
  assertEquals(exports.self, undefined);
  assertEquals(exports.strict, true);
  assertEquals(exports.readOnly, true);
  assertEquals(exports.value, 2);
  assertEquals(exports.namespace, "[object Module]");
});

Deno.test("imports only used as types are removed like tsc does", async () => {
  const { calls } = await run(
    `import { Bot, type Context } from "grammy";
import type { Message } from "grammy/types";
import { Chat } from "grammy/types";
const c: Chat | Message | Context | undefined = undefined;
new Bot("x");`,
    "ts",
  );
  assertEquals(calls, ["new:x"]);
});

Deno.test("unsupported static imports fail before any code runs", () => {
  const err = assertThrows(
    () =>
      prepare(
        `const a: number = 1; console.log(a);\nimport { run } from "@grammyjs/runner";\nrun();`,
        "ts",
        "example.ts",
        modules,
      ),
    SourceError,
  );
  assertMatch(err.message, /Cannot import "@grammyjs\/runner" here/);
  assertEquals([err.line, err.column], [2, 21]);
});

Deno.test("unsupported dynamic imports fail when evaluated", async () => {
  const { exports } = await run(
    `export const ok = (await import("grammy")).Bot !== undefined;
export const failed = await import("express").then(() => "", (e) => e.message);`,
    "js",
  );
  assertEquals(exports.ok, true);
  assertMatch(String(exports.failed), /Cannot import "express" here/);
});

Deno.test("CommonJS can use import()", async () => {
  const prepared = prepare(
    `module.exports = import("grammy");`,
    "js",
    "example.js",
    modules,
  );
  assertEquals(prepared.format, "commonjs");
  const module = { exports: {} as unknown };
  (prepared as Extract<Prepared, { format: "commonjs" }>).run.call(
    module.exports,
    {},
    () => ({}),
    module as never,
  );
  assert(
    typeof (await (module.exports as Promise<{ Bot: unknown }>)).Bot ===
      "function",
  );
});

Deno.test("syntax errors are reported with positions", () => {
  const err = assertThrows(
    () =>
      prepare(
        `const a = 1;\nbot.on("message", (ctx) => ctx.reply("x");\n`,
        "ts",
        "example.ts",
        modules,
      ),
    SourceError,
  );
  assertEquals(err.line, 2);
  assert(err.column! > 0);
  assertMatch(err.message, /Unexpected token/);
  assertEquals(err.name, "SyntaxError");
  const js = findSyntaxError(`import x from "grammy";\nconst = 1;`, "js");
  assertEquals(js?.line, 2);
});

Deno.test("locate maps errors to the displayed source", () => {
  // Columns of TypeScript are mapped back across removed types.
  const source =
    `const a: number = 1;\nconst b: Map<string, number> = new Map(); throw new Error("x");`;
  const prepared = prepare(source, "ts", "example.ts", modules);
  const generated = prepared.format === "module" &&
    prepared.code.split("\n")[1].indexOf("new Error") + 1;
  const column = source.split("\n")[1].indexOf("new Error") + 1;
  assert(generated && generated < column);
  assertEquals(
    locate(
      `Error: x\n    at example.ts:2:${generated}`,
      "example.ts",
      prepared,
    ),
    { line: 2, column },
  );
  // CommonJS: the function header on the first line is not counted.
  const cjs = prepare(`throw new Error("x");`, "js", "example.js", modules);
  let stack = "";
  try {
    (cjs as Extract<Prepared, { format: "commonjs" }>).run.call(
      {},
      {},
      () => ({}),
      { exports: {} },
    );
  } catch (e) {
    stack = (e as Error).stack!;
  }
  assertEquals(locate(stack, "example.js", cjs), { line: 1, column: 7 });
});

Deno.test("parseSpecifier understands bare and npm: specifiers", () => {
  assertEquals(parseSpecifier("grammy"), {
    name: "grammy",
    subpath: "",
    version: undefined,
  });
  assertEquals(parseSpecifier("grammy/types"), {
    name: "grammy",
    subpath: "/types",
    version: undefined,
  });
  assertEquals(parseSpecifier("npm:grammy"), {
    name: "grammy",
    subpath: "",
    version: undefined,
  });
  assertEquals(parseSpecifier("npm:grammy@^1.46/types"), {
    name: "grammy",
    subpath: "/types",
    version: "^1.46",
  });
  assertEquals(parseSpecifier("npm:/grammy@1"), {
    name: "grammy",
    subpath: "",
    version: "1",
  });
  assertEquals(parseSpecifier("npm:@grammyjs/runner@2"), {
    name: "@grammyjs/runner",
    subpath: "",
    version: "2",
  });
  assertEquals(parseSpecifier("@grammyjs/runner"), {
    name: "@grammyjs/runner",
    subpath: "",
    version: undefined,
  });
  for (
    const s of [
      "./bot.ts",
      "../x",
      "/abs",
      "https://deno.land/x/grammy/mod.ts",
      "jsr:@std/assert",
      "node:fs",
      "grammy@1",
    ]
  ) {
    assertEquals(parseSpecifier(s), undefined, s);
  }
});

Deno.test("satisfies handles common npm version syntax", () => {
  const yes = [
    "1",
    "1.46",
    "1.46.0",
    "^1.0.0",
    "^1.46",
    "~1.46.0",
    "1.x",
    "*",
    "v1.46.0",
    "=1.46.0",
    "^1",
  ];
  const no = ["2", "1.45", "1.46.1", "^1.47", "~1.45.0", "^2.0.0", "0.x"];
  for (const r of yes) assertEquals(satisfies("1.46.0", r), true, r);
  for (const r of no) assertEquals(satisfies("1.46.0", r), false, r);
  assertEquals(satisfies("0.2.5", "^0.2.3"), true);
  assertEquals(satisfies("0.3.0", "^0.2.3"), false);
  assertEquals(satisfies("1.46.0", ">=1.0.0"), undefined);
  assertEquals(satisfies("1.46.0", "1 || 2"), undefined);
});

Deno.test("redact removes known and token-shaped strings", () => {
  const token = "123456789:AAHfakefakefakefakefakefakefakefake_-x";
  assertEquals(redact(`url /bot${token}/getMe`), `url /bot${REDACTED}/getMe`);
  assertEquals(
    redact("custom-secret-token!", ["custom-secret-token"]),
    `${REDACTED}!`,
  );
  assertEquals(redact("user 123456789 said hi"), "user 123456789 said hi");
});

Deno.test("botKey uses the public bot ID only", () => {
  assertEquals(botKey("123456789:secret"), "123456789");
  const key = botKey("not a token");
  assertMatch(key, /^h[0-9a-z]+$/);
  assert(!key.includes("token"));
});

Deno.test("GRAMMY_VERSION matches deno.jsonc", async () => {
  const config = await Deno.readTextFile(
    new URL("../../../../deno.jsonc", import.meta.url),
  );
  assertMatch(
    config,
    new RegExp(`"npm:grammy@${GRAMMY_VERSION.replaceAll(".", "\\.")}"`),
  );
  assertInstanceOf(new SourceError("Error", "x"), Error);
});
