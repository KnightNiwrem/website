// Browser tests for live code blocks, run against a production build:
//
//   cd site && LIVE_CODE_FIXTURES=1 deno task build && deno task serve
//   cd site/tests/live-code && deno test -A browser_test.ts
//
// Most tests answer Telegram requests with a MOCK (see mock_telegram.ts). They
// check the lifecycle on the page, NOT that bots work with real Telegram. The
// tests named "real Telegram" send unauthenticated requests with fake tokens.
// Authenticated end-to-end checks are in manual_telegram.ts.
import { assert, assertEquals, assertMatch } from "@std/assert";
import {
  type Browser,
  type BrowserContextOptions,
  chromium,
  devices,
  type Locator,
  type Page,
  type Request,
} from "playwright";
import { MOCK_TOKEN, MOCK_USERNAME, MockTelegram } from "./mock_telegram.ts";

const BASE = Deno.env.get("LIVE_CODE_BASE_URL") ?? "http://localhost:4173";
const FIXTURE = "/__fixtures__/live-code";
// Well-formed, but not a real token.
const FAKE_TOKEN = "1234567890:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

async function until<T>(
  what: string,
  fn: () => T | Promise<T>,
  timeout = 10_000,
): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  while (true) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function setup(
  browser: Browser,
  options: BrowserContextOptions & { mock?: boolean } = {},
) {
  const { mock: useMock = true, ...contextOptions } = options;
  const context = await browser.newContext(contextOptions);
  const mock = new MockTelegram();
  if (useMock) await mock.install(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { context, page, mock, errors };
}

/** Opens a live example and returns helpers for it. */
async function open(page: Page, path = "/", index = 0, tap = false) {
  if (!page.url().endsWith(path)) await page.goto(BASE + path);
  const root = page.locator(".live-code").nth(index);
  const button = root.getByRole("button", {
    name: "Edit and run this example",
  });
  await (tap ? button.tap() : button.click());
  const editor = root.locator(".live-code-editing textarea:visible");
  await editor.waitFor();
  return {
    root,
    editor,
    output: root.locator(".live-code-output"),
    status: root.locator(".live-code-status"),
    run: () => root.locator(".live-code-run").click(),
    stop: () => root.locator(".live-code-stop").click(),
    text: () => root.locator(".live-code-output").innerText().catch(() => ""),
    idle: () =>
      until(
        "the run to end",
        async () =>
          (await root.locator(".live-code-status").innerText()).startsWith(
            "Not running",
          ),
      ),
  };
}

async function polling(status: Locator) {
  await until(
    "polling",
    async () => (await status.innerText()).includes(`@${MOCK_USERNAME}`),
  );
}

const replace = (editor: Locator, from: string, to: string) =>
  editor.inputValue().then((v) => {
    assert(v.includes(from));
    return editor.fill(v.replace(from, to));
  });

Deno.test({
  name: "live code in Chromium",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const browser = await chromium.launch();
    try {
      await t.step(
        "static HTML shows the code without JavaScript",
        async () => {
          const { context, page } = await setup(browser, {
            javaScriptEnabled: false,
          });
          await page.goto(BASE + "/");
          const code = await page.locator(".vp-code-group .active pre")
            .innerText();
          assertMatch(
            code,
            /bot\.on\("message", \(ctx\) => ctx\.reply\("Hi there!"\)\);/,
          );
          assertEquals(await page.locator(".live-code-panel").count(), 0);
          await context.close();
        },
      );

      await t.step("code is loaded only when needed", async () => {
        const { context, page } = await setup(browser);
        const loaded: string[] = [];
        page.on("request", (r) => loaded.push(new URL(r.url()).pathname));
        const has = (name: string) =>
          loaded.some((p) => p.includes(`/${name}`));
        await page.goto(BASE + "/guide/getting-started");
        await page.waitForLoadState("networkidle");
        assert(
          !has("chunks/LiveCode.") && !has("chunks/editor.") &&
            !has("worker-"),
        );
        await page.goto(BASE + "/");
        await page.waitForLoadState("networkidle");
        assert(
          has("chunks/LiveCode.") && !has("chunks/editor.") &&
            !has("worker-"),
        );
        const live = await open(page);
        assert(has("chunks/editor.") && !has("worker-"));
        await page.getByLabel(/Bot token/).fill(MOCK_TOKEN);
        await live.run();
        await polling(live.status);
        assert(has("worker-"));
        await live.stop();
        await live.idle();
        await context.close();
      });

      await t.step(
        "homepage example replies and stops (mock API)",
        async () => {
          const { context, page, mock, errors } = await setup(browser);
          const live = await open(page);
          await page.getByLabel(/Bot token/).fill(MOCK_TOKEN);
          await live.run();
          await polling(live.status);
          const methods = mock.calls.map((c) => c.method);
          assertEquals(methods.slice(0, 1), ["getWebhookInfo"]);
          assert(
            methods.includes("deleteWebhook") && methods.includes("getMe"),
          );
          const id = mock.message("hello");
          const [reply] = await until(
            "a reply",
            () => mock.sent().length > 0 ? mock.sent() : undefined,
          );
          assertEquals(reply.body.text, "Hi there!");
          assertEquals(reply.body.chat_id, 4242);
          await live.stop();
          await live.idle();
          // `bot.stop()` confirmed the handled update.
          const last = mock.sent("getUpdates").at(-1)!;
          assertEquals(last.body.offset, id + 1);
          const count = mock.calls.length;
          await new Promise((r) => setTimeout(r, 2500));
          assertEquals(mock.calls.length, count, "requests after Stop");
          assertMatch(await live.text(), /Stopped\./);
          assertEquals(errors, []);
          await context.close();
        },
      );

      await t.step(
        "every code group tab runs its own variant (mock API)",
        async () => {
          const { context, page, mock } = await setup(browser);
          const live = await open(page);
          await page.getByLabel(/Bot token/).fill(MOCK_TOKEN);
          for (const tab of ["JavaScript", "Deno", "TypeScript"]) {
            await page.locator(".vp-code-group label", { hasText: tab })
              .click();
            await until(
              "tab switch",
              async () =>
                (await live.root.locator(".live-code-run").innerText())
                  .includes(
                    tab,
                  ),
            );
            assertMatch(
              await live.editor.inputValue(),
              tab === "JavaScript"
                ? /require\("grammy"\)/
                : tab === "Deno"
                ? /"npm:grammy"/
                : /from "grammy"/,
            );
            const before = mock.sent().length;
            await live.run();
            await polling(live.status);
            mock.message(`hello ${tab}`);
            await until(
              `a reply from ${tab}`,
              () => mock.sent().length > before,
            );
            await live.stop();
            await live.idle();
          }
          await context.close();
        },
      );

      await t.step(
        "edited code runs, copies and shows when it is stale (mock API)",
        async () => {
          const { context, page, mock } = await setup(browser);
          await context.grantPermissions(["clipboard-read", "clipboard-write"]);
          const live = await open(page);
          await page.getByLabel(/Bot token/).fill(MOCK_TOKEN);
          await replace(live.editor, 'reply("Hi there!")', 'reply("Edited!")');
          await page.locator(".vp-code-group .active button.copy").click({
            force: true,
          });
          const copied = await page.evaluate(() =>
            navigator.clipboard.readText()
          );
          assertMatch(copied, /ctx\.reply\("Edited!"\)/);
          await live.run();
          await polling(live.status);
          const first = mock.message("one");
          await until(
            "edited reply",
            () => mock.sent().some((c) => c.body.text === "Edited!"),
          );
          const stale = live.root.locator(".live-code-warning", {
            hasText: "different code",
          });
          assertEquals(await stale.count(), 0);
          await replace(
            live.editor,
            'reply("Edited!")',
            'reply("Edited twice!")',
          );
          await stale.waitFor();
          await live.run(); // restart
          await until("restart", async () => (await stale.count()) === 0);
          await polling(live.status);
          mock.message("two");
          await until(
            "second reply",
            () => mock.sent().some((c) => c.body.text === "Edited twice!"),
          );
          // The update handled before the restart was confirmed, not redelivered.
          assertEquals(
            mock.sent().filter((c) => c.body.text === "Edited!").length,
            1,
          );
          assert(
            mock.sent("getUpdates").some((c) => c.body.offset === first + 1),
          );
          // Switching tabs also makes the running code differ from the shown one.
          await page.locator(".vp-code-group label", { hasText: "JavaScript" })
            .click();
          await stale.waitFor();
          await page.locator(".vp-code-group label", { hasText: "TypeScript" })
            .click();
          await live.root.getByRole("button", { name: "Reset code" }).click();
          assertMatch(
            await live.editor.inputValue(),
            /ctx\.reply\("Hi there!"\)/,
          );
          await page.locator(".vp-code-group .active button.copy").click({
            force: true,
          });
          assertMatch(
            await page.evaluate(() => navigator.clipboard.readText()),
            /"Hi there!"/,
          );
          await live.stop();
          await live.idle();
          await context.close();
        },
      );

      await t.step(
        "asks before bot.start() deletes a webhook (mock API)",
        async () => {
          const { context, page, mock } = await setup(browser);
          mock.webhookUrl = "https://example.com/secret-path-123";
          const live = await open(page);
          await page.getByLabel(/Bot token/).fill(MOCK_TOKEN);
          await live.run();
          const dialog = live.root.getByRole("alertdialog");
          await dialog.waitFor();
          const text = await dialog.innerText();
          assertMatch(text, /example\.com/);
          assert(!text.includes("secret-path"));
          await dialog.getByRole("button", { name: "Cancel" }).click();
          await live.idle();
          assertMatch(await live.text(), /webhook was kept/);
          assertEquals(mock.sent("deleteWebhook").length, 0);
          await live.run();
          await dialog.getByRole("button", { name: "Delete webhook and start" })
            .click();
          await polling(live.status);
          assertEquals(mock.sent("deleteWebhook").length, 1);
          await live.stop();
          await live.idle();
          await context.close();
        },
      );

      await t.step(
        "second page: one poller per bot across blocks (mock API)",
        async () => {
          const { context, page, mock } = await setup(browser);
          // Long polls in flight, as seen by the browser.
          let polls = 0;
          let maxPolls = 0;
          const isPoll = (r: Request) =>
            r.url().endsWith("/getUpdates") && r.postDataJSON()?.timeout > 0;
          context.on("request", (r) => {
            if (isPoll(r)) maxPolls = Math.max(maxPolls, ++polls);
          });
          const done = (r: Request) => isPoll(r) && polls--;
          context.on("requestfinished", done);
          context.on("requestfailed", done);
          const first = await open(page, FIXTURE, 0);
          await page.getByLabel(/Bot token/).first().fill(MOCK_TOKEN);
          await first.run();
          await polling(first.status);
          const second = await open(page, FIXTURE, 1);
          // The token is shared by all examples on the page.
          assertEquals(
            await second.root.getByLabel(/Bot token/).inputValue(),
            MOCK_TOKEN,
          );
          await second.run();
          await polling(second.status);
          await first.idle();
          assertMatch(
            await first.text(),
            /another example started the same bot/,
          );
          await until(
            "onStart log",
            async () =>
              (await second.text()).includes(`Started as @${MOCK_USERNAME}`),
          );
          mock.message("/start");
          await until(
            "typed context reply",
            () => mock.sent().some((c) => c.body.text === "Welcome"),
          );
          assertEquals(maxPolls, 1);
          await second.stop();
          await second.idle();
          await context.close();
        },
      );

      await t.step(
        "another tab cannot poll the same bot (mock API)",
        async () => {
          const { context, page } = await setup(browser);
          const first = await open(page);
          await page.getByLabel(/Bot token/).fill(MOCK_TOKEN);
          await first.run();
          await polling(first.status);
          const other = await context.newPage();
          const second = await open(other);
          await other.getByLabel(/Bot token/).fill(MOCK_TOKEN);
          await second.run();
          await second.idle();
          assertMatch(
            await second.text(),
            /already running in another tab\. Stop it there first\./,
          );
          // The first tab keeps running, then releases the bot on Stop.
          assertMatch(await first.status.innerText(), /Running/);
          await first.stop();
          await first.idle();
          await second.run();
          await polling(second.status);
          await second.stop();
          await second.idle();
          await context.close();
        },
      );

      await t.step("unsupported imports are rejected (mock API)", async () => {
        const { context, page, mock } = await setup(browser);
        const live = await open(page, FIXTURE, 2);
        await page.getByLabel(/Bot token/).first().fill(MOCK_TOKEN);
        await live.run();
        await live.idle();
        assertMatch(
          await live.text(),
          /line 2:\d+: Error: Cannot import "@grammyjs\/runner" here/,
        );
        assertEquals(mock.calls.length, 0);
        await context.close();
      });

      await t.step(
        "hung code is terminated and the page stays responsive",
        async () => {
          const { context, page, mock } = await setup(browser);
          const live = await open(page);
          await live.editor.fill("while (true) {}\n");
          await live.run();
          await until(
            "start",
            async () => (await live.status.innerText()).includes("Starting"),
          );
          await new Promise((r) => setTimeout(r, 500));
          assertEquals(await page.evaluate(() => 1 + 1), 2);
          const stopped = Date.now();
          await live.stop();
          await live.idle();
          assert(Date.now() - stopped < 5000);
          assertMatch(
            await live.text(),
            /did not stop in time and was terminated/,
          );
          assertEquals(mock.calls.length, 0);
          await context.close();
        },
      );

      await t.step(
        "stopping during start-up does not start polling (mock API)",
        async () => {
          const { context, page, mock } = await setup(browser);
          mock.getMeDelayMs = 2000;
          const live = await open(page);
          await page.getByLabel(/Bot token/).fill(MOCK_TOKEN);
          await live.run();
          await until("getMe", () => mock.sent("getMe").length > 0);
          await live.stop();
          await live.idle();
          await new Promise((r) => setTimeout(r, 3000));
          // Only the offset confirmation of `bot.stop()`, never a long poll.
          assertEquals(
            mock.sent("getUpdates").filter((c) => c.body.timeout !== undefined),
            [],
          );
          await context.close();
        },
      );

      await t.step(
        "errors in handlers name the line and end the run (mock API)",
        async () => {
          const { context, page, mock } = await setup(browser);
          const live = await open(page);
          await page.getByLabel(/Bot token/).fill(MOCK_TOKEN);
          await replace(
            live.editor,
            '(ctx) => ctx.reply("Hi there!")',
            '() => { throw new Error("boom"); }',
          );
          await live.run();
          await polling(live.status);
          mock.message("hi");
          await live.idle();
          const text = await live.text();
          assertMatch(
            text,
            /TypeScript, line 6:\d+: Error while handling update 1: Error: boom/,
          );
          assertMatch(text, /Stopped, because of an uncaught error\./);
          await context.close();
        },
      );

      await t.step("leaving the page stops the bot (mock API)", async () => {
        const { context, page, mock } = await setup(browser);
        const live = await open(page);
        await page.getByLabel(/Bot token/).fill(MOCK_TOKEN);
        await live.run();
        await polling(live.status);
        await page.getByRole("link", { name: "Documentation" }).first().click();
        await page.waitForURL(/\/guide\/$/);
        await until("polling to end", () => mock.polling === 0);
        const count = mock.calls.length;
        await new Promise((r) => setTimeout(r, 2500));
        assertEquals(mock.calls.length, count);
        await context.close();
      });

      await t.step("tokens are redacted and never stored", async () => {
        const { context, page } = await setup(browser);
        const live = await open(page);
        await page.getByLabel(/Bot token/).fill(MOCK_TOKEN);
        await live.editor.fill(
          'import { Bot } from "grammy";\nconst bot = new Bot("");\nconsole.log("token", bot.token, `https://api.telegram.org/bot${bot.token}/getMe`);\n',
        );
        await live.run();
        await until("log", async () => (await live.text()).includes("token"));
        const text = await live.text();
        assertMatch(
          text,
          /token \[bot token\] https:\/\/api\.telegram\.org\/bot\[bot token\]\/getMe/,
        );
        const secret = MOCK_TOKEN.split(":")[1];
        assert(!(await live.root.innerText()).includes(secret));
        assert(!page.url().includes(secret));
        const stored = await page.evaluate(() =>
          JSON.stringify({ ...localStorage }) +
          JSON.stringify({ ...sessionStorage })
        );
        assert(!stored.includes(secret));
        await live.stop();
        await context.close();
      });

      await t.step(
        "real Telegram: fake token is rejected with a readable 401",
        async () => {
          const { context, page } = await setup(browser, { mock: false });
          const requests: string[] = [];
          context.on("request", (r) => {
            if (r.url().startsWith("https://api.telegram.org/")) {
              requests.push(`${r.method()} ${r.headers()["content-type"]}`);
            }
          });
          const live = await open(page);
          await page.getByLabel(/Bot token/).fill(FAKE_TOKEN);
          await live.run();
          await live.idle();
          assertMatch(
            await live.text(),
            /Call to 'getWebhookInfo' failed! \(401: Unauthorized\)/,
          );
          assertEquals(requests, ["POST application/json"]);
          assert(
            !(await live.root.innerText()).includes(FAKE_TOKEN.split(":")[1]),
          );
          await context.close();
        },
      );

      await t.step(
        "real Telegram: malformed token fails the CORS preflight",
        async () => {
          const { context, page } = await setup(browser, { mock: false });
          const live = await open(page);
          await page.getByLabel(/Bot token/).fill("123:abc");
          await live.root.locator(".live-code-warning", {
            hasText: "does not look like",
          }).waitFor();
          await live.run();
          await live.idle();
          assertMatch(
            await live.text(),
            /Network request for 'getWebhookInfo' failed!/,
          );
          await context.close();
        },
      );

      for (const name of ["Pixel 7", "iPhone 15"] as const) {
        await t.step(
          `phone layout and touch editing, emulated ${name} (mock API)`,
          async () => {
            const { context, page, mock } = await setup(browser, {
              ...devices[name],
            });
            const live = await open(page, "/", 0, true);
            const noHorizontalScroll = () =>
              page.evaluate(() =>
                document.documentElement.scrollWidth <= innerWidth
              );
            assert(await noHorizontalScroll());
            await live.editor.tap();
            const handle = await live.editor.elementHandle();
            // Put the cursor at the end of the reply text and type there.
            await live.editor.evaluate((el: HTMLTextAreaElement) => {
              const i = el.value.indexOf('reply("Hi there!') +
                'reply("Hi there!'.length;
              el.setSelectionRange(i, i);
            });
            await page.keyboard.type(" ¿Qué tal?");
            // IME composition, as with a Japanese keyboard.
            const cdp = await context.newCDPSession(page);
            await cdp.send("Input.imeSetComposition", {
              text: "せかい",
              selectionStart: 3,
              selectionEnd: 3,
            });
            await cdp.send("Input.insertText", { text: "世界" });
            const value = await live.editor.inputValue();
            assertMatch(value, /ctx\.reply\("Hi there! ¿Qué tal\?世界"\)/);
            // The editor was not recreated while typing.
            assert(await page.evaluate((el) => el!.isConnected, handle));
            const lines = await live.root.locator(
              ".live-code-editing .pce-line",
            ).allInnerTexts();
            assert(lines.some((l) => l.includes("¿Qué tal?世界")));
            const fontSize = (l: Locator) =>
              l.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
            assert(await fontSize(live.editor) >= 16);
            await page.getByLabel(/Bot token/).tap();
            assert(await fontSize(page.getByLabel(/Bot token/)) >= 16);
            await page.getByLabel(/Bot token/).fill(MOCK_TOKEN);
            for (
              const button of [
                live.root.locator(".live-code-run"),
                live.root.locator(".live-code-stop"),
              ]
            ) {
              const box = (await button.boundingBox())!;
              assert(
                box.height >= 40 && box.x >= 0 &&
                  box.x + box.width <= page.viewportSize()!.width,
              );
            }
            await live.root.locator(".live-code-run").tap();
            await polling(live.status);
            mock.message("hi");
            await until(
              "reply",
              () =>
                mock.sent().some((c) =>
                  c.body.text === "Hi there! ¿Qué tal?世界"
                ),
            );
            const link = live.root.getByRole("link", {
              name: `Open @${MOCK_USERNAME}`,
            });
            assertEquals(
              await link.getAttribute("href"),
              `https://t.me/${MOCK_USERNAME}`,
            );
            assert(await noHorizontalScroll());
            await live.root.locator(".live-code-stop").tap();
            await live.idle();
            await context.close();
          },
        );
      }

      await t.step(
        "desktop keyboard: multi-line typing, undo, paste",
        async () => {
          const { context, page } = await setup(browser);
          await context.grantPermissions(["clipboard-read", "clipboard-write"]);
          const live = await open(page);
          const original = await live.editor.inputValue();
          await live.editor.focus();
          await page.keyboard.press("Control+End");
          await page.keyboard.type(
            '\nbot.command("ping", (ctx) => ctx.reply("pong"));',
          );
          assertMatch(
            await live.editor.inputValue(),
            /\nbot\.command\("ping", \(ctx\) => ctx\.reply\("pong"\)\);$/,
          );
          for (let i = 0; i < 100; i++) {
            if ((await live.editor.inputValue()) === original) break;
            await page.keyboard.press("Control+z");
          }
          assertEquals(await live.editor.inputValue(), original);
          await page.keyboard.press("Control+Shift+z");
          assert((await live.editor.inputValue()) !== original, "redo");
          await page.evaluate(() =>
            navigator.clipboard.writeText("// pasted\n")
          );
          await page.keyboard.press("Control+Home");
          await page.keyboard.press("Control+v");
          assertMatch(await live.editor.inputValue(), /^\/\/ pasted\nimport/);
          await context.close();
        },
      );
    } finally {
      await browser.close();
    }
  },
});
