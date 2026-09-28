import { createMarkdownRenderer } from "vitepress";
import { playground } from "./playground.ts";
import { decompress } from "livecodes";
import { telegramFetch } from "../shared/telegram-fetch.js";
import { strict as assert } from "node:assert";

const keyboardSource = 'import { InlineKeyboard } from "grammy";\n' +
  'console.log(new InlineKeyboard().text("Hello", "hello").inline_keyboard);\n';
const botSource = 'import { Bot } from "grammy";\n' +
  'const bot = new Bot("");\n' +
  'bot.on("message", (ctx) => ctx.reply("Hello"));\n' +
  "bot.start();\n";
const group = (source: string, language = "ts", marker = "playground") =>
  `::: code-group ${marker}\n\n\`\`\`${language} [Example]\n${source}\`\`\`\n\n:::\n`;
const configs = (html: string) =>
  [...html.matchAll(/<CodePlayground url="([^"]+)"/g)].map((match) => {
    const url = new URL(match[1].replaceAll("&amp;", "&"));
    const encoded = new URLSearchParams(url.hash.slice(1)).get("config")!;
    const decoded = decompress(encoded.slice("code/".length));
    assert.notEqual(decoded, null, "Playground config must be decodable");
    return JSON.parse(decoded!);
  });

Deno.test("Playgrounds are opt-in and preserve static code-group controls", async () => {
  const md = await createMarkdownRenderer(".", {
    lineNumbers: true,
    config: playground,
  });
  const env = { path: "guide/example.md", relativePath: "guide/example.md" };
  const codeGroup = group(botSource).replace(
    "\n:::\n",
    '\n```js [Alternative]\nconst { Bot } = require("grammy");\n```\n\n:::\n',
  );
  const plain = md.render(
    codeGroup.replace("code-group playground", "code-group"),
    env,
  );
  const marked = md.render(codeGroup, env);
  assert.equal(configs(marked)[0].script.content, botSource);

  if (
    (marked.match(/<CodePlayground /g) || []).length !== 1 ||
    !marked.includes("</CodePlayground>") ||
    marked.match(/class="copy"/g)?.length !== 2 ||
    !marked.includes("line-numbers-wrapper") ||
    plain.includes("CodePlayground")
  ) throw new Error("Code group integration changed static controls");
  // Strip randomized tab IDs before comparing the original code-group HTML.
  const normalize = (html: string) =>
    html.replace(/<\/?CodePlayground[^>]*>\n/g, "")
      .replace(/(?:group|tab)-[\w-]+/g, "random-id");
  if (normalize(plain) !== normalize(marked)) {
    throw new Error("Copyable code-group markup changed");
  }
  if (
    md.render("```sh\nnpm install grammy\n```", env).includes(
      "CodePlayground",
    )
  ) {
    throw new Error("Playground leaked to an unmarked block");
  }
});

Deno.test("Multiple playgrounds retain independent JS/TS sources on any page", async () => {
  const md = await createMarkdownRenderer(".", { config: playground });
  const markdown = group(keyboardSource, "js") +
    group("npm install grammy\n", "sh", "") + group(botSource, "ts");
  for (const path of ["guide/keyboards.md", "es/guide/examples.md"]) {
    const html = md.render(markdown, { path, relativePath: path });
    const examples = configs(html);
    assert.deepEqual(examples.map((config) => config.script), [
      { language: "javascript", content: keyboardSource },
      { language: "typescript", content: botSource },
    ]);
    assert.equal((html.match(/<\/CodePlayground>/g) || []).length, 2);
    assert.equal((html.match(/class="copy"/g) || []).length, 3);
    for (const config of examples) {
      assert.equal(config.autoupdate, false);
      assert.equal(config.autosave, false);
      assert.equal(config.recoverUnsaved, false);
    }
  }
});

Deno.test("Marked unsupported languages fail with an author-facing error", async () => {
  const md = await createMarkdownRenderer(".", { config: playground });
  assert.throws(
    () => md.render(group("npm install grammy\n", "sh")),
    /first fence must be JavaScript or TypeScript/,
  );
});

Deno.test("Telegram transport preserves parameters, response, and abort signal", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const response = new Response(
    '{"ok":false,"error_code":401,"description":"Unauthorized"}',
    { status: 401 },
  );
  let calls = 0;
  globalThis.fetch = (_url, init) => {
    calls++;
    const body = init!.body as URLSearchParams;
    const headers = new Headers(init!.headers);
    if (
      _url !== "https://api.telegram.org/bot0:INVALID/sendMessage" ||
      init!.method !== "POST" || init!.signal !== controller.signal ||
      headers.has("connection") || headers.has("content-type") ||
      body.get("text") !== "Hi & + \n世界" || body.get("chat_id") !== "42" ||
      body.get("disable_notification") !== "false" ||
      body.get("reply_markup") !==
        '{"inline_keyboard":[[{"text":"Hi","callback_data":"hello"}]]}' ||
      body.get("allowed_updates") !== '["message"]' || body.has("unused")
    ) {
      throw new Error(
        "Form encoding changed the request or cancellation signal",
      );
    }
    return Promise.resolve(response);
  };
  try {
    const actual = await telegramFetch(
      "https://api.telegram.org/bot0:INVALID/sendMessage",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          connection: "keep-alive",
        },
        signal: controller.signal,
        body: JSON.stringify({
          text: "Hi & + \n世界",
          chat_id: 42,
          disable_notification: false,
          reply_markup: {
            inline_keyboard: [[{ text: "Hi", callback_data: "hello" }]],
          },
          allowed_updates: ["message"],
          unused: null,
        }),
      },
    );
    if (actual !== response || calls !== 1) {
      throw new Error("Response was intercepted or fetch was skipped");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Unsupported file uploads fail clearly", () => {
  let message = "";
  try {
    telegramFetch("https://api.telegram.org/bot0:INVALID/sendDocument", {
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body: "test",
    });
  } catch (error) {
    message = (error as Error).message;
  }
  if (!message.includes("File uploads are not supported")) {
    throw new Error("Missing upload limitation");
  }
});
