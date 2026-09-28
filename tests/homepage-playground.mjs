import assert from "node:assert/strict";
import fs from "node:fs";

// Install Playwright separately; keep browser tooling out of the site bundle.
const { firefox, chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const engine = process.env.TEST_ENGINE || "firefox";
const evidence = process.env.TEST_OUTPUT || "/tmp/grammy-homepage-evidence";
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
await context.route("https://api.telegram.org/**", (r) => {
  telegram.push(r.request().url());
  return r.abort();
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
const component = page.locator(".quickstart-playground");
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
  const activate = page.getByRole("button", {
    name: "Edit and run in your browser",
  });
  await activate.waitFor();
  await page.waitForTimeout(1500);
  check(
    "One homepage playground, unloaded",
    await component.count() === 1 &&
      await component.locator("iframe").count() === 0,
  );
  check(
    "No LiveCodes or CDN requests before activation",
    !requests.some((r) => /livecodes|jsdelivr/.test(r.url)),
  );
  check(
    "Static line numbers retained",
    await component.locator(".line-numbers-wrapper").count() === 3,
  );
  const group = component.locator(".vp-code-group");
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
  phase = "active";
  await editor().waitFor({ timeout: 60000 });
  const source = await editor().innerText();
  await page.waitForTimeout(1500);
  check("No initial execution", !(await output()).includes("Bot:"));
  await run("Bot: Hi there!");
  check(
    "Real grammY handler replies to simulated message",
    (await output()).includes("You: Hello!"),
  );
  await edit(source.replaceAll("Hi there!", "First edit!"));
  await page.waitForTimeout(1500);
  check(
    "Edits do not execute automatically",
    !(await output()).includes("First edit!"),
  );
  await run("Bot: First edit!", true);
  check("First edited handler runs using keyboard");
  await edit(source.replaceAll("Hi there!", "Second edit!"));
  await run("Bot: Second edit!");
  check(
    "Second edit replaces previous output",
    !(await output()).includes("First edit!"),
  );
  await run("Bot: Second edit!");
  check(
    "Rerun has one reply, without duplicate handlers",
    (await output()).split("Bot: Second edit!").length === 2,
  );
  await component.screenshot({ path: `${evidence}/desktop.png` });
  await edit(source + '\nthrow new Error("VISIBLE_RUNTIME_ERROR");');
  await run("VISIBLE_RUNTIME_ERROR");
  check("Runtime errors visible");
  await component.screenshot({ path: `${evidence}/runtime-error.png` });
  await edit(source + "\nawait bot.api.getMe();");
  await run("Unsupported demo API method: getMe");
  check("Unsupported Telegram calls fail visibly");
  await edit(source + "\nawait bot.start();");
  await run("Polling is disabled");
  check("Polling cannot start");
  phase = "cleanup";
  await edit(source + '\nsetInterval(() => console.log("TICK_OLD"), 200);');
  await run("TICK_OLD");
  await edit(source + '\nsetInterval(() => console.log("TICK_NEW"), 200);');
  await run("TICK_NEW");
  await page.waitForTimeout(500);
  let marker = events.length;
  await page.waitForTimeout(800);
  check(
    "Rerun destroys old timers",
    !events.slice(marker).some((e) => e.text === "TICK_OLD") &&
      events.slice(marker).some((e) => e.text === "TICK_NEW"),
  );
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole("link", { name: "Get Started", exact: true }).click();
  await page.waitForURL("**/guide/getting-started");
  await page.waitForTimeout(500);
  marker = events.length;
  await page.waitForTimeout(800);
  check(
    "SPA navigation destroys playground and timers",
    await component.count() === 0 && !events.slice(marker).some((e) =>
      /^TICK_/.test(e.text || "")
    ) && timeOrigin === await page.evaluate(() => performance.timeOrigin),
  );
  check(
    "Getting-started guide stays static",
    await page.locator(".vp-code-group").count() === 2,
  );
  await page.locator(".vp-code-group").first().getByText("Yarn", {
    exact: true,
  }).click();
  await copy(page.locator(".language-sh.active"), "yarn add grammy");
  await page.goBack();
  await activate.waitFor();
  check(
    "Returning to homepage starts unloaded",
    await component.locator("iframe").count() === 0,
  );
  phase = "mobile";
  await page.setViewportSize({ width: 390, height: 844 });
  await activate.click();
  await editor().waitFor({ timeout: 60000 });
  await edit(source.replaceAll("Hi there!", "Mobile edit!"));
  await run("Bot: Mobile edit!", true);
  check("390px viewport supports editing and keyboard run");
  check(
    "No horizontal page overflow",
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= innerWidth + 1
    ),
  );
  await component.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/mobile.png` });
  await page.getByRole("button", { name: "Close playground" }).focus();
  await page.keyboard.press("Enter");
  check(
    "Keyboard close destroys iframe and restores tabs",
    await component.locator("iframe").count() === 0 &&
      await group.count() === 1,
  );
  await page.goto(base + "/es/");
  check("Translated homepage remains static", await component.count() === 0);
  check("No Telegram request attempted", telegram.length === 0);
  check(
    "Pinned grammY browser module fetched",
    requests.some((r) =>
      r.url === "https://cdn.jsdelivr.net/npm/grammy@1.46.0/out/web.mjs"
    ),
  );
  const intentionalErrors = [
    "VISIBLE_RUNTIME_ERROR",
    "Unsupported demo API method: getMe",
    "Polling is disabled; use await send(text) in this demo",
  ];
  // Reproduced on unchanged 83d953d8: VitePress 1.6.4's debounced outline
  // scroll callback accesses its marker after the guide has unmounted.
  const baselineOutlineError = (e) =>
    e.phase === "mobile" &&
    e.text === 'can\'t access property "style", n.value is null' &&
    /\/assets\/chunks\/theme\.[^/]+\.js:2:7100/.test(e.stack || "");
  if (events.some(baselineOutlineError)) {
    console.log(
      "BASELINE: VitePress outline timer error (also reproduced without playground)",
    );
  }
  check(
    "No unexpected page errors",
    !events.some((e) =>
      e.type === "pageerror" && !intentionalErrors.includes(e.text) &&
      !baselineOutlineError(e)
    ),
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
