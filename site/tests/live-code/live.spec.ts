/// <reference lib="dom" />
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Deliberately synthetic. No real token or destination belongs in automated fixtures.
const TOKEN = "123456789:AUTOMATED_TEST_PLACEHOLDER";
const fixture = "http://127.0.0.1:4174";

async function telegram(
  page: Page,
  options: { webhook?: boolean; delay?: boolean; failReply?: boolean } = {},
) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  let delivered = false;
  await page.route("https://api.telegram.org/**", async (route) => {
    const method = route.request().url().split("/").pop()!;
    const payload = route.request().postDataJSON();
    calls.push({ method, payload });
    let result: unknown = true;
    if (method === "getWebhookInfo") {
      if (options.delay) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
      result = {
        url: options.webhook ? "https://deployed.invalid/hook" : "",
        pending_update_count: 0,
      };
    } else if (method === "getMe") {
      result = {
        id: 123456789,
        is_bot: true,
        first_name: "Test",
        username: "synthetic_test_bot",
      };
    } else if (method === "getUpdates") {
      if (!delivered && payload.timeout) {
        delivered = true;
        result = [{
          update_id: 42,
          message: {
            message_id: 1,
            date: 1,
            chat: { id: 123, type: "private" },
            text: "hello",
          },
        }];
      } else {
        if (payload.timeout) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        result = [];
      }
    } else if (method === "sendMessage") {
      result = {
        message_id: 2,
        date: 1,
        chat: { id: 123, type: "private" },
        text: payload.text,
      };
    }
    await route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(
        options.failReply && method === "sendMessage"
          ? { ok: false, error_code: 403, description: `Failure ${TOKEN}` }
          : { ok: true, result },
      ),
    }).catch(() => {}); // Termination can cancel a delayed mock response.
  });
  return calls;
}

async function activate(page: Page, url = "/", index = 0) {
  await page.goto(url);
  const block = page.locator(".live-code").nth(index);
  await block.getByRole("button", { name: "Edit and run", exact: true })
    .click();
  await expect(block.getByRole("textbox", { name: "Example source" }).first())
    .toBeVisible();
  await block.getByLabel("Test bot token").fill(TOKEN);
  return block;
}

test("production HTML stays readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173");
  await expect(page.locator(".live-code pre").first()).toContainText(
    'import { Bot } from "grammy"',
  );
  await expect(page.locator(".live-code pre")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Edit and run" })).toHaveCount(
    0,
  );
  await context.close();
});

test("initial load and activation do not execute or load runtime", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Edit and run", exact: true }))
    .toBeVisible();
  expect(requests.some((url) => /LiveEditor[.-]/.test(url))).toBe(false);
  const block = await activate(page);
  expect(
    requests.some((url) => /runner.worker-|\/prepare-|\/runtime-/.test(url)),
  ).toBe(false);
  expect(requests.some((url) => /LiveEditor[.-]/.test(url))).toBe(true);
  expect(requests.some((url) => url.startsWith("https://api.telegram.org/")))
    .toBe(false);
  await block.getByRole("button", { name: "Deno", exact: true }).click();
  await expect(block.locator("textarea:visible")).toHaveValue(/"npm:grammy"/);
  await expect(block.getByRole("status")).toHaveText("Ready");
});

test("API-only examples keep nested JSON values and remain stoppable", async ({ page }) => {
  const calls = await telegram(page);
  const block = await activate(page);
  await block.locator("textarea:visible").fill(
    `import { Api } from "grammy/web";
const client = new Api("");
await client.sendMessage(123, "Nested payload", {
  reply_markup: { inline_keyboard: [[{ text: "Open", url: "https://grammy.dev" }]] },
});`,
  );
  await block.getByRole("button", { name: "Run", exact: true }).click();
  await expect(block.getByRole("status")).toHaveText("Code executed");
  expect(
    calls.find((call) => call.method === "sendMessage")?.payload.reply_markup,
  ).toEqual({
    inline_keyboard: [[{ text: "Open", url: "https://grammy.dev" }]],
  });
  await block.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(block.getByRole("status")).toHaveText("Stopped");
});

test("parse errors and later timer failures surface without leaking tokens", async ({ page }) => {
  const calls = await telegram(page);
  const block = await activate(page);
  await block.locator("textarea:visible").fill("const = ;");
  await block.getByRole("button", { name: "Run", exact: true }).click();
  await expect(block.getByRole("status")).toHaveText("Error");
  expect(calls.length).toBe(0);
  await block.locator("textarea:visible").fill(
    `setTimeout(() => { throw Error("${TOKEN}"); }, 20);`,
  );
  await block.getByRole("button", { name: "Run", exact: true }).click();
  await expect(block.getByRole("status")).toHaveText("Error");
  await expect(block.getByLabel("Run output")).toContainText("[token]");
  await expect(block.getByLabel("Run output")).not.toContainText(TOKEN);
});

for (const label of ["TypeScript", "JavaScript", "Deno"]) {
  test(`${label}: edited source uses real grammY against an isolated HTTP mock`, async ({ page }) => {
    const calls = await telegram(page);
    const block = await activate(page);
    await block.getByRole("button", { name: label, exact: true }).click();
    const source = block.locator("textarea:visible");
    await source.fill(
      (await source.inputValue()).replaceAll("Hi there!", "Edited reply"),
    );
    await block.getByRole("button", { name: "Run", exact: true }).click();
    await expect(block.getByRole("status").first()).toHaveText("Running");
    await expect.poll(() =>
      calls.find((call) => call.method === "sendMessage")?.payload.text
    ).toBe("Edited reply");
    expect(calls.some((call) => call.method === "deleteWebhook")).toBe(false);
    await source.fill(
      (await source.inputValue()) + "\n// changed while running",
    );
    await expect(
      block.getByText("The previous revision is still running", {
        exact: false,
      }),
    ).toBeVisible();
    await block.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(block.getByRole("status").first()).toHaveText("Stopped");
    await expect.poll(() =>
      calls.some((call) =>
        call.method === "getUpdates" && call.payload.offset === 43 &&
        call.payload.limit === 1
      )
    ).toBe(true);
    const count = calls.length;
    await page.waitForTimeout(250);
    expect(calls.length).toBe(count);
  });
}

test("existing webhook refuses startup without mutations", async ({ page }) => {
  const calls = await telegram(page, { webhook: true });
  const block = await activate(page);
  await block.getByRole("button", { name: "Run", exact: true }).click();
  await expect(block.getByLabel("Run output")).toContainText(
    "existing webhook",
  );
  expect(calls.map((c) => c.method)).toEqual(["getWebhookInfo"]);
});

for (const allowEval of [true, false]) {
  test(`worker response CSP: unsafe-eval ${allowEval ? "allowed" : "blocked"}`, async ({ page }) => {
    await telegram(page);
    await page.route("**/runner.worker-*.js", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "content-security-policy": `default-src 'none'; script-src 'self'${
            allowEval ? " 'unsafe-eval'" : ""
          }; connect-src https://api.telegram.org`,
        },
      });
    });
    const block = await activate(page);
    await block.getByRole("button", { name: "Run", exact: true }).click();
    await expect(block.getByRole("status")).toHaveText(
      allowEval ? "Running" : "Error",
    );
    if (allowEval) {
      await block.getByRole("button", { name: "Stop", exact: true }).click();
    } else {await expect(block.getByLabel("Run output")).toContainText(
        "unsafe-eval",
      );}
  });
}

test("Stop during initialization prevents later work", async ({ page }) => {
  const calls = await telegram(page, { delay: true });
  const block = await activate(page);
  await block.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() => calls.length).toBe(1);
  await block.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(block.getByRole("status")).toHaveText("Stopped");
  await page.waitForTimeout(2700);
  expect(calls.map((c) => c.method)).toEqual(["getWebhookInfo"]);
});

test("Stop lets in-flight middleware finish within the grace period", async ({ page }) => {
  const calls = await telegram(page);
  const block = await activate(page);
  await block.locator("textarea:visible").fill(`import { Bot } from "grammy";
const example = new Bot("");
example.on("message", async ctx => {
  console.log("Handling update");
  await new Promise(resolve => setTimeout(resolve, 500));
  await ctx.reply("Finished handler");
});
example.start();`);
  await block.getByRole("button", { name: "Run", exact: true }).click();
  await expect(block.getByLabel("Run output")).toContainText("Handling update");
  await block.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(block.getByRole("status")).toHaveText("Stopped");
  expect(calls.find((call) => call.method === "sendMessage")?.payload.text)
    .toBe("Finished handler");
});

test("hung source can be stopped and rerun", async ({ page }) => {
  await telegram(page);
  const block = await activate(page);
  await block.locator("textarea:visible").fill(
    'console.log("Entering loop"); while (true) {}',
  );
  await block.getByRole("button", { name: "Run", exact: true }).click();
  await expect(block.getByLabel("Run output")).toContainText("Entering loop");
  await block.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(block.getByRole("status")).toHaveText("Stopped");
  await expect(block.getByLabel("Run output")).toContainText("force-stopped");
  await block.getByRole("button", { name: "Reset source" }).click();
  await block.getByRole("button", { name: "Run", exact: true }).click();
  await expect(block.getByRole("status")).toHaveText("Running");
  await block.getByRole("button", { name: "Stop", exact: true }).click();
});

test("async errors are redacted and source locations refer to the editor", async ({ page }) => {
  await telegram(page);
  const block = await activate(page);
  await block.locator("textarea:visible").fill(
    `const x: number = 1;\nawait Promise.resolve();\nthrow new Error("secret ${TOKEN}");`,
  );
  await block.getByRole("button", { name: "Run", exact: true }).click();
  await expect(block.getByLabel("Run output")).toContainText("example.ts:3:");
  await expect(block.getByLabel("Run output")).not.toContainText(TOKEN);
});

test("unsupported imports and post-start handler failures release the run", async ({ page }) => {
  await telegram(page, { failReply: true });
  const block = await activate(page);
  await block.locator("textarea:visible").fill(
    'const dependency = await import("node:fs");',
  );
  await block.getByRole("button", { name: "Run", exact: true }).click();
  await expect(block.getByLabel("Run output")).toContainText(
    'Unsupported dependency "node:fs"',
  );
  await block.getByRole("button", { name: "Reset source" }).click();
  await block.getByRole("button", { name: "Run", exact: true }).click();
  await expect(block.getByRole("status")).toHaveText("Error");
  await expect(block.getByLabel("Run output")).toContainText("403");
  await expect(block.getByLabel("Run output")).not.toContainText(TOKEN);
});

test("second page, multiple blocks, cross-tab exclusion, and navigation cleanup", async ({ page, context }) => {
  const calls = await telegram(page);
  const first = await activate(page, fixture);
  await first.getByRole("button", { name: "Run", exact: true }).click();
  await expect.poll(() =>
    calls.find((c) => c.method === "sendMessage")?.payload.text
  ).toBe("Got another message!");
  const second = page.locator(".live-code").nth(1);
  await second.getByRole("button", { name: "Edit and run", exact: true })
    .click();
  await second.getByLabel("Test bot token").fill(TOKEN);
  await second.getByRole("button", { name: "Run", exact: true }).click();
  await expect(second.getByLabel("Run output")).toContainText(
    "already running",
  );
  const tab = await context.newPage();
  await telegram(tab);
  const other = await activate(tab, fixture);
  await other.getByRole("button", { name: "Run", exact: true }).click();
  await expect(other.getByLabel("Run output")).toContainText("already running");
  await page.getByRole("link", { name: "Leave this page" }).click();
  await expect(page.getByRole("heading", { name: "Navigation destination" }))
    .toBeVisible();
  await expect.poll(() =>
    calls.some((c) => c.method === "getUpdates" && c.payload.limit === 1)
  ).toBe(true);
  await other.getByRole("button", { name: "Run", exact: true }).click();
  await expect(other.getByRole("status")).toHaveText("Running");
  await other.getByRole("button", { name: "Stop", exact: true }).click();
  await tab.close();
});

test("touch layout supports edits, selection, undo, copy, composition events and tabs (not a physical phone test)", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const block = await activate(page, "http://127.0.0.1:4173");
  const source = block.locator("textarea:visible");
  const original = await source.inputValue();
  await source.fill(
    "// punctuation: []{}();\nconst greeting = 'こんにちは';\n",
  );
  await source.press("Control+End");
  await source.pressSequentially("// typed");
  await block.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(source).not.toHaveValue(/typed$/);
  await block.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(source).toHaveValue(/typed$/);
  await source.evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(0, 14);
  });
  expect(
    await source.evaluate((el: HTMLTextAreaElement) =>
      el.selectionEnd - el.selectionStart
    ),
  ).toBe(14);
  await source.dispatchEvent("compositionstart", { data: "" });
  await source.dispatchEvent("compositionend", { data: "日本語" });
  await block.getByRole("button", { name: "Copy source" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    await source.inputValue(),
  );
  await block.getByRole("button", { name: "Deno", exact: true }).click();
  await expect(block.locator("textarea:visible")).toHaveValue(/npm:grammy/);
  await block.getByRole("button", { name: "TypeScript", exact: true }).click();
  await expect(block.locator("textarea:visible")).not.toHaveValue(original);
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= innerWidth
    ),
  ).toBe(true);
  await context.close();
});
