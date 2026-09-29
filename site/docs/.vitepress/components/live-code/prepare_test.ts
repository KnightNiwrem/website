// Run with `deno task test`. Examples run against the real `grammy/web` build,
// but without network access.
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertThrows,
} from "@std/assert";
import * as web from "grammy/web";
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
  satisfies,
  SourceError,
  SPECIFIERS,
  syntaxErrorAt,
} from "./prepare.ts";
import { GRAMMY_VERSION } from "./version.ts";

await ready;

const dataURL = (code: string) =>
  `data:text/javascript;base64,${
    btoa(String.fromCharCode(...new TextEncoder().encode(code)))
  }`;

const GLOBAL = "__liveCodeTest";
const MODULES = modules(web);
Object.assign(globalThis, { [GLOBAL]: MODULES });
const URLS = Object.fromEntries(
  SPECIFIERS.map((s) => [s, dataURL(facade(s, MODULES[s], GLOBAL))]),
);
const resolver = {
  url: (specifier: string) => URLS[resolve(specifier)],
  failing: (message: string) =>
    dataURL(`throw new Error(${JSON.stringify(message)});`),
};

let runs = 0;

/** Prepares and runs an example like the worker does. */
async function run(source: string, language: Language) {
  const prepared = prepare(source, language, `example.${language}`, resolver);
  if (prepared.format === "commonjs") {
    const module = { exports: {} as Record<string, unknown> };
    prepared.run.call(
      module.exports,
      module.exports,
      (s) => MODULES[resolve(s)].value,
      module,
    );
    return { prepared, exports: module.exports };
  }
  // Every run gets a new module, like the worker's blob URLs.
  const exports = await import(dataURL(`${prepared.code}\n// ${++runs}`));
  return { prepared, exports: exports as Record<string, unknown> };
}

function homepage(language: string) {
  const readme = Deno.readTextFileSync(
    new URL("../../../README.md", import.meta.url),
  );
  const block = new RegExp("```\\w+ \\[" + language + "\\]\\n([^`]*)```")
    .exec(readme)?.[1];
  assert(block !== undefined, `${language} example on the homepage`);
  // Put in a token and do not connect to Telegram.
  return block.replace('new Bot("")', 'new Bot("123:fake")')
    .replace("bot.start();", "globalThis.homepageBot = bot;");
}

Deno.test("all homepage variants run with the real grammY", async () => {
  for (
    const [label, language, format] of [
      ["TypeScript", "ts", "module"],
      ["JavaScript", "js", "commonjs"],
      ["Deno", "ts", "module"],
    ] as const
  ) {
    const g = globalThis as { homepageBot?: unknown };
    delete g.homepageBot;
    const { prepared } = await run(homepage(label), language);
    assertEquals(prepared.format, format, label);
    const bot = g.homepageBot;
    assert(bot instanceof web.Bot);
    assertEquals(bot.token, "123:fake");
  }
});

Deno.test("grammY is untouched", async () => {
  // `new Bot("")` throws like in any runtime.
  await assertRejects(
    () => run('import { Bot } from "grammy";\nnew Bot("");', "ts"),
    Error,
    "Empty token!",
  );
  const { exports } = await run(
    'import { Bot } from "grammy/web";\nexport { Bot };',
    "js",
  );
  assertEquals(exports.Bot, web.Bot);
});

Deno.test("exports match what Deno provides for the same import", async () => {
  const real: Record<string, Record<string, unknown>> = {
    "grammy": await import("grammy"),
    "grammy/types": await import("grammy/types"),
    "grammy/web": await import("grammy/web"),
  };
  for (const specifier of SPECIFIERS) {
    const ours = await import(URLS[specifier]);
    const theirs = real[specifier];
    assertEquals(
      Object.keys(ours).sort(),
      Object.keys(theirs).sort(),
      specifier,
    );
    assertEquals(typeof ours.default, typeof theirs.default, specifier);
    if (theirs.default !== undefined) {
      assertEquals(
        Object.keys(ours.default).sort(),
        Object.keys(theirs.default as object).sort(),
      );
      assertEquals(ours.default.__esModule, true);
      assertEquals(ours["module.exports"], ours.default);
    }
  }
});

Deno.test("JavaScript is CommonJS if it compiles as such", async () => {
  const { prepared, exports } = await run(
    `undeclared = 1;
this.self = this === module.exports;
exports.sloppy = undeclared;
exports.require = typeof require;
return;
exports.after = true;`,
    "js",
  );
  assertEquals(prepared.format, "commonjs");
  assertEquals(exports, { self: true, sloppy: 1, require: "function" });
  // Code cannot leave the module function, like in Node.js.
  const err = assertThrows(
    () => prepare("}); (function () {", "js", "example.js", resolver),
    SourceError,
  );
  assertEquals(err.name, "SyntaxError");
});

Deno.test("JavaScript with module syntax is a module", () => {
  for (
    const code of [
      'import { Bot } from "grammy";',
      "export const a = 1;",
      "await null;",
      "console.log(import.meta.url);",
    ]
  ) {
    assertEquals(
      prepare(code, "js", "example.js", resolver).format,
      "module",
      code,
    );
  }
});

Deno.test("ES modules keep their semantics", async () => {
  const { exports } = await run(
    `export const hoisted = typeof Bot;
export const self = this;
export let strict = false;
try { undeclaredInModule = 1; } catch { strict = true; }
export let readOnly = false;
try { Bot = 1; } catch (e) { readOnly = e instanceof TypeError; }
export const awaited: number = await Promise.resolve(2);
import { Bot } from "grammy";
import grammy, * as namespace from "npm:grammy@^1.0";
import * as webNamespace from "grammy/web";
export const tag = Object.prototype.toString.call(namespace);
export const same = grammy.Bot === Bot && namespace.Bot === Bot &&
  webNamespace.Bot === Bot && (await import("grammy")).Bot === Bot;
export const webDefault = "default" in webNamespace;`,
    "ts",
  );
  assertEquals(exports.hoisted, "function");
  assertEquals(exports.self, undefined);
  assertEquals(exports.strict, true);
  assertEquals(exports.readOnly, true);
  assertEquals(exports.awaited, 2);
  assertEquals(exports.tag, "[object Module]");
  assertEquals(exports.same, true);
  assertEquals(exports.webDefault, false);
});

Deno.test("imports only used as types are removed like tsc does", async () => {
  const { exports } = await run(
    `import { Bot, type Context } from "grammy";
import type { Message } from "grammy/types";
import { Chat } from "grammy/types";
let c: Chat | Message | Context | undefined;
export const ok = typeof Bot;`,
    "ts",
  );
  assertEquals(exports.ok, "function");
});

Deno.test("unsupported static imports fail before any code runs", () => {
  const err = assertThrows(
    () =>
      prepare(
        `console.log("ran");\nconst a: number = 1; import { run } from "@grammyjs/runner";\nrun();`,
        "ts",
        "example.ts",
        resolver,
      ),
    SourceError,
    'Cannot import "@grammyjs/runner" here.',
  );
  assertEquals(err.at, { line: 2, column: 43 });
  assertThrows(
    () => prepare('import "npm:grammy@2";', "js", "example.js", resolver),
    SourceError,
    "Live examples run grammY 1.46.0.",
  );
});

Deno.test("unsupported dynamic imports fail when evaluated", async () => {
  const { exports } = await run(
    `export const failed = await import("express").then(() => "", (e) => e.message);`,
    "js",
  );
  assertMatch(String(exports.failed), /^Cannot import "express" here\./);
});

Deno.test("CommonJS can use import()", async () => {
  const { prepared, exports } = await run(
    `exports.grammy = import("grammy");`,
    "js",
  );
  assertEquals(prepared.format, "commonjs");
  assertEquals((await exports.grammy as typeof web).Bot, web.Bot);
});

Deno.test("syntax errors have positions", () => {
  const err = assertThrows(
    () =>
      prepare(
        `const a: number = 1;\nbot.on("message", (ctx) => ctx.reply("x");`,
        "ts",
        "example.ts",
        resolver,
      ),
    SourceError,
  );
  assertEquals(err.name, "SyntaxError");
  assertEquals(err.at?.line, 2);
  assertEquals(
    syntaxErrorAt('import { Bot } from "grammy";\nconst = 1;', "js")?.line,
    2,
  );
  assertEquals(syntaxErrorAt("const a = 1;", "js"), undefined);
});

/** Returns the position where the prepared example throws. */
async function thrownAt(source: string, language: Language) {
  let prepared: Prepared | undefined;
  try {
    ({ prepared } = await run(source, language));
  } catch (err) {
    prepared ??= prepare(source, language, `example.${language}`, resolver);
    // Deno ignores `sourceURL` in data: URLs, which it also shortens.
    const stack = (err as Error).stack?.replace(
      /data:text\/javascript;base64,[\w+/=.]+/g,
      `example.${language}`,
    );
    return locate(stack, `example.${language}`, prepared);
  }
  throw new Error("did not throw");
}

Deno.test("errors point at the displayed source", async () => {
  // Types before the error are removed, which moves it in the running code.
  const ts =
    `const a: string = "x"; const b: Map<string, number> = new Map(); throw new Error("x");`;
  assertEquals(await thrownAt(`// first\n${ts}`, "ts"), {
    line: 2,
    column: ts.indexOf("new Error") + 1,
  });
  // So does a replaced import specifier.
  const dynamic =
    `const g: unknown = await import("grammy"); throw new Error("x");`;
  assertEquals(await thrownAt(dynamic, "ts"), {
    line: 1,
    column: dynamic.indexOf("new Error") + 1,
  });
  // CommonJS runs in a function, which adds lines.
  assertEquals(await thrownAt(`const a = 1;\n  throw new Error("x");`, "js"), {
    line: 2,
    column: 9,
  });
});

Deno.test("resolve accepts grammY specifiers only", () => {
  for (
    const [specifier, expected] of [
      ["grammy", "grammy"],
      ["grammy/web", "grammy/web"],
      ["grammy/types", "grammy/types"],
      ["npm:grammy", "grammy"],
      ["npm:grammy@1.46.0/types", "grammy/types"],
      ["npm:grammy@^1.30/web", "grammy/web"],
    ]
  ) assertEquals(resolve(specifier), expected, specifier);
  for (
    const specifier of [
      "grammy@1",
      "grammy/out/mod.js",
      "@grammyjs/runner",
      "npm:grammy@2",
      "npm:grammy@>=1",
      "https://deno.land/x/grammy/mod.ts",
      "jsr:@grammyjs/grammy",
      "node:fs",
      "./bot.ts",
    ]
  ) assertThrows(() => resolve(specifier), Error, "Cannot import", specifier);
});

Deno.test("satisfies handles npm version ranges", () => {
  const yes = [
    "",
    "*",
    "x",
    "1",
    "1.x",
    "1.46",
    "1.46.0",
    "v1.46.0",
    "=1.46.0",
    "^1",
    "^1.0.0",
    "^1.46",
    "~1",
    "~1.46",
    "~1.46.0",
  ];
  const no = [
    "2",
    "1.45",
    "1.46.1",
    "^1.47",
    "~1.45.0",
    "^2.0.0",
    "0.x",
    ">=1",
  ];
  for (const r of yes) assertEquals(satisfies("1.46.0", r), true, r);
  for (const r of no) assertEquals(satisfies("1.46.0", r), false, r);
  assertEquals(satisfies("0.2.5", "^0.2.3"), true);
  assertEquals(satisfies("0.3.0", "^0.2.3"), false);
  assertEquals(satisfies("0.0.4", "^0.0.3"), false);
  assertEquals(satisfies("1.2.0", "~1.1.9"), false);
});

Deno.test("redact removes bot tokens, also inside URLs", () => {
  const token = "123456789:AAHfakefakefakefakefakefakefakefake_-x";
  assertEquals(
    redact(`${token} https://api.telegram.org/bot${token}/getMe`),
    "[bot token] https://api.telegram.org/bot[bot token]/getMe",
  );
  assertEquals(redact("user 123456789 said hi"), "user 123456789 said hi");
});

Deno.test("GRAMMY_VERSION is the bundled version", async () => {
  const config = await Deno.readTextFile(
    new URL("../../../../deno.jsonc", import.meta.url),
  );
  assert(config.includes(`"npm:grammy@${GRAMMY_VERSION}"`));
  const pkg = JSON.parse(
    await Deno.readTextFile(
      new URL("../../../../node_modules/grammy/package.json", import.meta.url),
    ),
  );
  assertEquals(pkg.version, GRAMMY_VERSION);
});
