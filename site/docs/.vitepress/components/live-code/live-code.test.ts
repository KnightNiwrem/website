// Run with `deno task test`. Browser behavior is covered separately.
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertMatch,
  assertThrows,
} from "@std/assert";
import {
  compile,
  locate,
  parseSpecifier,
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
/** Runs an example with a fake module registry and returns what it required. */
async function run(source: string, language: "ts" | "js") {
  const required: string[] = [];
  const fn = compile(source, language, `example.${language}`);
  const module = { exports: {} as Record<string, unknown> };
  await fn(
    (s) => {
      required.push(s);
      return { Bot: class {}, __esModule: true };
    },
    module,
    module.exports,
  );
  return { required, exports: module.exports };
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

Deno.test("compile keeps line numbers of TypeScript", () => {
  const source = `import { Bot, type Context } from "grammy";
interface C { a: number }
type MyContext = Context & { config: C };
const bot = new Bot<MyContext>("");
throw new Error("here");`;
  const fn = compile(source, "ts", "example.ts");
  return fn(() => ({ Bot: class {} }), { exports: {} }, {}).then(
    () => assert(false),
    (err) => assertEquals(locate(err.stack, "example.ts")?.line, 5),
  );
});

Deno.test("compile runs all three homepage variants", async () => {
  const bot = (calls: string[]) =>
    class {
      on(filter: string) {
        calls.push(`on:${filter}`);
      }
      start() {
        calls.push("start");
      }
    };
  for (
    const [language, line] of [
      ["ts", 'import { Bot } from "grammy";'],
      ["js", 'const { Bot } = require("grammy");'],
      ["ts", 'import { Bot } from "npm:grammy";'],
    ] as const
  ) {
    const calls: string[] = [];
    const specifiers: string[] = [];
    const fn = compile(homepage(line), language, `example.${language}`);
    await fn(
      (s) => {
        specifiers.push(s);
        return { Bot: bot(calls), __esModule: true };
      },
      { exports: {} },
      {},
    );
    assertEquals(calls, ["on:message", "start"]);
    assertEquals(specifiers, [line.match(/"(.+)"/)![1]]);
  }
});

Deno.test("compile leaves CommonJS unchanged", async () => {
  // Sloppy mode: assigning an undeclared variable works like in Node.js.
  const { exports } = await run(
    `undeclared = 1; module.exports.x = undeclared;`,
    "js",
  );
  assertEquals(exports.x, 1);
});

Deno.test("compile accepts ES modules in JavaScript blocks", async () => {
  const { required } = await run(
    `import { Bot } from "grammy"; new Bot();`,
    "js",
  );
  assertEquals(required, ["grammy"]);
});

Deno.test("compile supports top-level await and exports", async () => {
  const { exports } = await run(
    `const x: number = await Promise.resolve(2);\nexport const y = x * 2;`,
    "ts",
  );
  assertEquals(exports.y, 4);
});

Deno.test("compile reports syntax errors with positions", () => {
  const err = assertThrows(
    () =>
      compile(
        `const a = 1;\nbot.on("message", (ctx) => ctx.reply("x");\n`,
        "ts",
        "example.ts",
      ),
    SourceError,
  );
  assertEquals(err.line, 2);
  assert(err.column! > 0);
  assertMatch(err.message, /Unexpected token/);
});

Deno.test("locate adjusts columns on the first line", () => {
  const fn = compile(`throw new Error("x");`, "js", "example.js");
  return fn(() => ({}), { exports: {} }, {}).then(
    () => assert(false),
    (err) =>
      assertEquals(locate(err.stack, "example.js"), { line: 1, column: 7 }),
  );
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
  assertInstanceOf(new SourceError("x"), Error);
});
