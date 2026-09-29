// Authenticated end-to-end check of a live example with the REAL Telegram Bot
// API. It needs a dedicated test bot and a person with Telegram at hand.
//
//   read -rs LIVE_CODE_TEST_TOKEN && export LIVE_CODE_TEST_TOKEN
//   # optional, a chat that agreed to receive a test message:
//   export LIVE_CODE_TEST_CHAT_ID=123456789
//   deno run -A manual_telegram.ts
//
// The token is only read from the environment. It is never printed, and all
// output passes through `redact`. Each check is reported separately.
import { chromium } from "playwright";
import { redact } from "../../docs/.vitepress/components/live-code/protocol.ts";

const BASE = Deno.env.get("LIVE_CODE_BASE_URL") ?? "http://localhost:4173";
const token = Deno.env.get("LIVE_CODE_TEST_TOKEN") ?? "";
const chatId = Deno.env.get("LIVE_CODE_TEST_CHAT_ID");
if (!/^\d+:[\w-]{30,}$/.test(token)) {
  console.error(
    "Set LIVE_CODE_TEST_TOKEN to the token of a dedicated test bot.",
  );
  Deno.exit(1);
}

const log = (...args: unknown[]) =>
  console.log(redact(args.map(String).join(" "), [token]));
const results: Record<string, string> = {
  "1 authenticated getMe": "not reached",
  "2 outbound message accepted by Telegram": chatId
    ? "not reached"
    : "skipped (no LIVE_CODE_TEST_CHAT_ID)",
  "3 real incoming message handled and replied to": "not reached",
  "4 no Telegram requests after Stop": "not reached",
};

interface Seen {
  method: string;
  at: number;
  request: Record<string, unknown>;
  response?: { ok: boolean; result?: unknown; description?: string };
}
const seen: Seen[] = [];

const browser = await chromium.launch({ headless: !Deno.env.get("HEADED") });
try {
  const context = await browser.newContext();
  context.on("response", async (response) => {
    const url = response.url();
    if (!url.startsWith("https://api.telegram.org/")) return;
    const entry: Seen = {
      method: url.split("/").pop()!,
      at: Date.now(),
      request: (() => {
        try {
          return response.request().postDataJSON() ?? {};
        } catch {
          return {};
        }
      })(),
    };
    seen.push(entry);
    entry.response = await response.json().catch(() => undefined);
  });
  const page = await context.newPage();
  await page.goto(BASE + "/");
  const root = page.locator(".live-code").first();
  await root.getByRole("button", { name: "Edit and run this example" }).click();
  const editor = root.locator(".live-code-editing textarea:visible");
  await editor.waitFor();
  if (chatId) {
    const source = await editor.inputValue();
    await editor.fill(source.replace(
      "bot.start();",
      `await bot.api.sendMessage(${
        JSON.stringify(chatId)
      }, "grammY live code test ${new Date().toISOString()}");\nbot.start();`,
    ));
  }
  await page.getByLabel(/Bot token/).fill(token);
  await root.locator(".live-code-run").click();

  const wait = async (what: string, fn: () => boolean, seconds: number) => {
    const end = Date.now() + seconds * 1000;
    while (!fn()) {
      if (Date.now() > end) throw new Error(`Timed out: ${what}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  const output = () =>
    root.locator(".live-code-output").innerText().catch(() => "");

  // 1: the bot authenticated with Telegram
  await wait(
    "getMe",
    () => seen.some((s) => s.method === "getMe" && s.response),
    30,
  );
  const me = seen.find((s) => s.method === "getMe")!.response!;
  results["1 authenticated getMe"] = me.ok
    ? `ok, @${(me.result as { username: string }).username}`
    : `failed: ${me.description}`;
  if (!me.ok) throw new Error(results["1 authenticated getMe"]);
  const username = (me.result as { username: string }).username;

  // 2: an outbound message was accepted (delivery is confirmed by a person)
  if (chatId) {
    await wait(
      "sendMessage",
      () => seen.some((s) => s.method === "sendMessage" && s.response),
      30,
    );
    const sent = seen.find((s) => s.method === "sendMessage")!.response!;
    results["2 outbound message accepted by Telegram"] = sent.ok
      ? `ok, message_id ${
        (sent.result as { message_id: number }).message_id
      } (check that it arrived in the chat)`
      : `failed: ${sent.description}`;
  }

  // 3: a person sends a message, the handler replies to it
  await wait("polling", () => seen.some((s) => s.method === "getUpdates"), 30);
  log(`Now send any text message to @${username} from Telegram (3 minutes).`);
  const since = seen.length;
  let chat: number | undefined;
  await wait("incoming message and reply", () => {
    for (const s of seen.slice(since)) {
      if (s.method === "getUpdates" && s.response?.ok) {
        const updates = s.response.result as {
          message?: { chat: { id: number } };
        }[];
        chat ??= updates.find((u) => u.message)?.message?.chat.id;
      }
    }
    return chat !== undefined &&
      seen.slice(since).some((s) =>
        s.method === "sendMessage" && s.request.chat_id === chat &&
        s.request.text === "Hi there!" && s.response?.ok === true
      );
  }, 180);
  results["3 real incoming message handled and replied to"] =
    "ok, a getUpdates response contained the message and the handler's sendMessage reply to that chat succeeded (check the reply in Telegram)";

  // 4: after Stop, the page makes no more requests
  await root.locator(".live-code-stop").click();
  await root.locator(".live-code-status", { hasText: "Not running" }).waitFor({
    timeout: 10_000,
  });
  const stoppedAt = Date.now();
  log(`Stopped. Send @${username} another message now; waiting 60 seconds.`);
  await new Promise((r) => setTimeout(r, 60_000));
  const after = seen.filter((s) => s.at > stoppedAt).map((s) => s.method);
  // Read-only check outside the browser: the new message was not consumed.
  const info = await fetch(
    `https://api.telegram.org/bot${token}/getWebhookInfo`,
  )
    .then((r) => r.json());
  results["4 no Telegram requests after Stop"] = after.length === 0
    ? `ok, pending_update_count is ${info.result?.pending_update_count} (at least 1 if a message was sent after Stop; a later run receives it)`
    : `failed, requests after Stop: ${after.join(", ")}`;
  log("Output shown on the page:\n" + (await output()));
} catch (err) {
  log(`Stopped early: ${err instanceof Error ? err.message : err}`);
} finally {
  await browser.close();
  for (const [check, result] of Object.entries(results)) {
    log(`${check}: ${result}`);
  }
}
