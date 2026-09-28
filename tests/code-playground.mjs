import assert from "node:assert/strict";
import fs from "node:fs";

// Install Playwright separately; keep browser tooling out of the site bundle.
const { firefox, chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const engine = process.env.TEST_ENGINE || "firefox";
const evidence = process.env.TEST_OUTPUT || "/tmp/grammy-live-bot-evidence";
const base = process.env.TEST_URL || "http://127.0.0.1:4173";
fs.mkdirSync(evidence, { recursive: true });
const browser = await { firefox, chromium }[engine].launch({
  headless: true,
  ...(engine === "chromium" ? { chromiumSandbox: true } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const requests = [], events = [], checks = [], telegram = [];
let phase = "initial";
const dummyToken = "0:LOCAL_TEST_TOKEN";
const fixture = {
  enabled: false,
  updates: [],
  sent: [],
  getMe: 0,
  maxPolls: 0,
};
const activePolls = new Set();
context.on("request", (request) => {
  if (request.url().includes("/getUpdates")) {
    activePolls.add(request);
    fixture.maxPolls = Math.max(fixture.maxPolls, activePolls.size);
  }
});
context.on("requestfinished", (request) => activePolls.delete(request));
context.on("requestfailed", (request) => activePolls.delete(request));
context.on("request", (r) => requests.push({ phase, url: r.url() }));
context.on("response", (r) => {
  if (r.status() >= 400) {
    events.push({ phase, type: "http", url: r.url(), status: r.status() });
  }
});
context.on(
  "requestfailed",
  (r) =>
    events.push({
      phase,
      type: "requestfailed",
      url: r.url(),
      error: r.failure(),
    }),
);
page.on(
  "console",
  (m) =>
    events.push({
      phase,
      type: m.type(),
      text: m.text(),
      location: m.location(),
    }),
);
page.on(
  "pageerror",
  (e) =>
    events.push({ phase, type: "pageerror", text: e.message, stack: e.stack }),
);
// Only this test substitutes HTTP responses. Production always fetches Telegram.
// The deliberately invalid-token getMe request below is NOT intercepted.
await context.route("https://api.telegram.org/**", async (route) => {
  const request = route.request();
  const method = new URL(request.url()).pathname.split("/").pop();
  const params = Object.fromEntries(
    new URLSearchParams(request.postData() || ""),
  );
  telegram.push({
    phase,
    method,
    url: request.url(),
    verb: request.method(),
    params,
    contentType: request.headers()["content-type"],
  });
  if (
    phase === "real-telegram" &&
    request.url() === "https://api.telegram.org/bot0:INVALID/getMe"
  ) {
    return route.continue();
  }
  if (!fixture.enabled || !request.url().includes(`/bot${dummyToken}/`)) {
    events.push({ type: "unexpected-telegram-request", url: request.url() });
    return route.abort();
  }
  let result;
  switch (method) {
    case "getMe":
      fixture.getMe++;
      result = {
        id: 123456,
        is_bot: true,
        first_name: "HTTP fixture bot",
        username: "grammy_http_fixture_bot",
      };
      break;
    case "deleteWebhook":
      result = true;
      break;
    case "getUpdates":
      // Telegram acknowledges updates using offset, not by consuming a reply.
      // A cancelled request must not remove updates intended for the next run.
      fixture.updates = fixture.updates.filter((update) =>
        update.update_id >= Number(params.offset || 0)
      );
      await new Promise((resolve) => setTimeout(resolve, 450));
      result = fixture.updates.filter((update) =>
        update.update_id >= Number(params.offset || 0)
      );
      break;
    case "sendMessage":
      fixture.sent.push(params);
      result = {
        message_id: fixture.sent.length,
        date: 1700000000,
        chat: { id: 42, type: "private" },
        text: params.text,
      };
      break;
    default:
      events.push({ type: "unexpected-fixture-method", method });
      return route.abort();
  }
  await route.fulfill({
    status: 200,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
    body: JSON.stringify({ ok: true, result }),
  }).catch(() => {});
});
let updateId = 0;
const deliver = (text) =>
  fixture.updates.push({
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: 1700000000,
      from: { id: 42, is_bot: false, first_name: "Test visitor" },
      chat: { id: 42, type: "private" },
      text,
    },
  });
const check = (name, value = true) => {
  assert(value, name);
  checks.push(name);
  console.log("PASS", name);
};
const until = async (fn, message) => {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await page.waitForTimeout(100);
  }
  throw new Error(message);
};
// Exercise the POC's example without limiting how many other blocks may opt in.
const component = page.locator("#quickstart ~ .code-playground").first();
const app = () =>
  component.frameLocator("iframe").frameLocator('iframe[name="app"]');
const editor = () => app().locator(".cm-content");
const output = () => app().locator("#console").innerText();
const edit = async (source) => {
  await editor().click();
  await editor().press("Control+a");
  await page.keyboard.insertText(source);
};
const run = async (expected, keyboard = false) => {
  // LiveCodes v49 suppresses identical reruns within 500ms.
  await page.waitForTimeout(650);
  const before = events.length;
  if (keyboard) await editor().press("Shift+Enter");
  else await app().locator("#run-button").click();
  await until(
    async () =>
      (await output()).includes(expected) &&
      events.slice(before).some((e) => e.text?.includes(expected)),
    `Missing fresh result: ${expected}`,
  );
};
const copy = async (block, expected) => {
  await block.hover();
  await block.locator("button.copy").click();
  await until(
    () =>
      block.locator("button.copy").evaluate((e) =>
        e.classList.contains("copied")
      ),
    "Missing copy feedback",
  );
  await page.evaluate(() => {
    const input = document.createElement("textarea");
    input.id = "clipboard-assertion";
    document.body.append(input);
    input.focus();
  });
  await page.locator("#clipboard-assertion").press("Control+v");
  check(
    `Copy ${expected}`,
    (await page.locator("#clipboard-assertion").inputValue()).includes(
      expected,
    ),
  );
  await page.locator("#clipboard-assertion").evaluate((e) => e.remove());
};
try {
  await page.goto(base + "/");
  const activate = component.getByRole("button", {
    name: "Edit and run in your browser",
  });
  const stop = component.getByRole("button", {
    name: "Stop and close playground",
  });
  await activate.waitFor();
  await page.waitForTimeout(1200);
  check(
    "Homepage example is initially unloaded",
    await component.locator("iframe").count() === 0,
  );
  check(
    "No playground/CDN/Telegram requests before activation",
    !requests.some((r) => /livecodes|jsdelivr|api.telegram/.test(r.url)),
  );
  check(
    "Static line numbers retained",
    await component.locator(".line-numbers-wrapper").count() === 3,
  );
  const group = component.locator(".vp-code-group");
  const authored = await group.locator(".language-ts.active pre code")
    .innerText();
  for (
    const [tab, expected] of [["TypeScript", 'from "grammy"'], [
      "JavaScript",
      'require("grammy")',
    ], ["Deno", 'from "npm:grammy"']]
  ) {
    await group.getByText(tab, { exact: true }).click();
    await copy(group.locator(".blocks > .active"), expected);
  }
  await activate.focus();
  await page.keyboard.press("Enter");
  await editor().waitFor({ timeout: 60000 });
  const source = (await editor().locator(".cm-line").allTextContents()).join(
    "\n",
  );
  check(
    "Editor retains original Bot construction and polling",
    source.trim() === authored.trim() && source.includes("bot.start();"),
  );
  await page.waitForTimeout(1500);
  check(
    "Activation does not execute or contact Telegram",
    telegram.length === 0 &&
      !(await output()).includes("Connecting to Telegram"),
  );
  await run("Paste your BotFather token");
  check("Missing token fails visibly without requests", telegram.length === 0);
  phase = "real-telegram";
  await edit(
    source.replace('new Bot("")', 'new Bot("0:INVALID")').replace(
      "bot.start();",
      "await bot.api.getMe();",
    ),
  );
  await run("Unauthorized");
  check(
    "REAL Telegram returns readable invalid-token 401 in embedded editor",
    events.some((e) =>
      e.type === "http" && e.status === 401 &&
      e.url === "https://api.telegram.org/bot0:INVALID/getMe"
    ),
  );
  check(
    "Real request used form POST without OPTIONS",
    telegram.length === 1 && telegram[0].verb === "POST" &&
      telegram[0].contentType.startsWith("application/x-www-form-urlencoded"),
  );
  await component.screenshot({ path: `${evidence}/real-invalid-token.png` });
  phase = "http-fixture";
  fixture.enabled = true;
  const runnable = source.replace('new Bot("")', `new Bot("${dummyToken}")`);
  await edit(runnable);
  await run("Bot running: https://t.me/grammy_http_fixture_bot");
  await until(() => activePolls.size > 0, "Polling did not start");
  deliver("Hello!");
  await until(
    () => fixture.sent.length === 1,
    "First handler did not call sendMessage",
  );
  check(
    "HTTP fixture: real grammY polls and sends the original reply",
    fixture.sent[0].text === "Hi there!" && fixture.sent[0].chat_id === "42",
  );
  const firstIdentity = fixture.getMe;
  await edit(runnable.replaceAll("Hi there!", "First edit!"));
  await page.waitForTimeout(1200);
  deliver("Still running old source");
  await until(
    () => fixture.sent.length === 2,
    "Existing bot stopped during editing",
  );
  check(
    "Edits do not restart the bot automatically",
    fixture.getMe === firstIdentity && fixture.sent[1].text === "Hi there!",
  );
  await run("Bot running: https://t.me/grammy_http_fixture_bot", true);
  deliver("Edited once");
  await until(() => fixture.sent.length === 3, "First edited reply missing");
  check(
    "HTTP fixture: first edited handler runs via keyboard",
    fixture.sent[2].text === "First edit!",
  );
  await edit(runnable.replaceAll("Hi there!", "Second edit!"));
  await run("Bot running: https://t.me/grammy_http_fixture_bot");
  deliver("Edited twice");
  await until(() => fixture.sent.length === 4, "Second edited reply missing");
  check(
    "HTTP fixture: second edit changes actual sendMessage payload",
    fixture.sent[3].text === "Second edit!",
  );
  await run("Bot running: https://t.me/grammy_http_fixture_bot");
  deliver("After rerun");
  await until(() => fixture.sent.length === 5, "Rerun reply missing");
  await page.waitForTimeout(900);
  check(
    "HTTP fixture: reruns have no duplicate handlers or overlapping polls",
    fixture.sent.length === 5 && fixture.maxPolls === 1,
  );
  await component.screenshot({ path: `${evidence}/fixture-desktop.png` });
  await edit('throw new Error("VISIBLE_RUNTIME_ERROR");');
  await run("VISIBLE_RUNTIME_ERROR");
  await until(
    () => activePolls.size === 0,
    "Old polling remained after runtime error",
  );
  let count = telegram.length;
  await page.waitForTimeout(1000);
  check(
    "Runtime error is visible and previous bot is gone",
    telegram.length === count,
  );
  await component.screenshot({ path: `${evidence}/runtime-error.png` });
  await edit(runnable);
  await run("Bot running: https://t.me/grammy_http_fixture_bot");
  await until(() => activePolls.size > 0, "Polling did not resume");
  await stop.focus();
  await page.keyboard.press("Enter");
  await until(
    () => activePolls.size === 0,
    "Stop did not abort the outstanding poll",
  );
  count = telegram.length;
  await page.waitForTimeout(1100);
  check(
    "Keyboard Stop aborts polling and prevents further calls",
    telegram.length === count &&
      await component.locator("iframe").count() === 0,
  );
  await activate.click();
  await editor().waitFor({ timeout: 60000 });
  check(
    "Reopening discards token and edits",
    !(await editor().innerText()).includes(dummyToken) &&
      (await editor().innerText()).includes('new Bot("")'),
  );
  await edit(runnable);
  await run("Bot running: https://t.me/grammy_http_fixture_bot");
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole("link", { name: "Get Started", exact: true }).click();
  await page.waitForURL("**/guide/getting-started");
  await until(
    () => activePolls.size === 0,
    "SPA navigation left a poll running",
  );
  count = telegram.length;
  await page.waitForTimeout(1000);
  check(
    "SPA navigation destroys the bot and stops requests",
    telegram.length === count &&
      timeOrigin === await page.evaluate(() => performance.timeOrigin),
  );
  const installation = page.locator(".vp-code-group").filter({
    has: page.getByText("Yarn", { exact: true }),
  });
  check(
    "Unmarked shell installation example remains static",
    await installation.evaluate((el) => !el.closest(".code-playground")),
  );
  await installation.getByText("Yarn", {
    exact: true,
  }).click();
  await copy(installation.locator(".language-sh.active"), "yarn add grammy");
  await page.goBack();
  await activate.waitFor();
  phase = "mobile";
  await page.setViewportSize({ width: 390, height: 844 });
  await activate.click();
  await editor().waitFor({ timeout: 60000 });
  await edit(runnable.replaceAll("Hi there!", "Mobile reply!"));
  await run("Bot running: https://t.me/grammy_http_fixture_bot", true);
  const before = fixture.sent.length;
  deliver("Mobile input");
  await until(() => fixture.sent.length === before + 1, "Mobile reply missing");
  check(
    "HTTP fixture: mobile editing and keyboard run send changed reply",
    fixture.sent.at(-1).text === "Mobile reply!",
  );
  check(
    "No horizontal page overflow",
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= innerWidth + 1
    ),
  );
  await component.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/fixture-mobile.png` });
  await stop.click();
  await until(() => activePolls.size === 0, "Mobile poll remained");
  check(
    "Only the invalid-token getMe reached real Telegram",
    telegram.filter((r) => r.phase === "real-telegram").length === 1 &&
      !events.some((e) => e.type.startsWith("unexpected-")),
  );
  const expected = (e) =>
    e.text?.includes("Paste your BotFather token") ||
    e.text?.includes("Unauthorized") || e.text === "VISIBLE_RUNTIME_ERROR";
  const baseline = (e) =>
    e.phase === "mobile" &&
    e.text === 'can\'t access property "style", n.value is null' &&
    /\/assets\/chunks\/theme\.[^/]+\.js:2:7100/.test(e.stack || "");
  if (events.some(baseline)) {
    console.log("BASELINE: existing VitePress outline timer error");
  }
  check(
    "No unexpected page errors",
    !events.some((e) => e.type === "pageerror" && !expected(e) && !baseline(e)),
  );
} catch (error) {
  console.error(error);
  events.push({ type: "test-failure", text: error.stack });
  await page.screenshot({ path: `${evidence}/failure.png`, fullPage: true })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    `${evidence}/browser-${engine}.json`,
    JSON.stringify(
      {
        engine,
        version: browser.version(),
        checks,
        requests,
        events,
        telegram,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
