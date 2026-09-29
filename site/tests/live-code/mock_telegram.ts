// A MOCK of the Telegram Bot API for automated browser tests of the live code
// lifecycle. It answers requests that Playwright intercepts, so no request
// reaches Telegram. Passing tests that use it say nothing about whether live
// examples work with the real Telegram servers.
import type { BrowserContext, Route } from "playwright";

export const MOCK_TOKEN = "1111111111:MOCKMOCKMOCKMOCKMOCKMOCKMOCKMOCKMOC";
export const MOCK_USERNAME = "mock_live_code_bot";

export interface Call {
  method: string;
  body: Record<string, unknown>;
  at: number;
}

export class MockTelegram {
  calls: Call[] = [];
  webhookUrl = "";
  getMeDelayMs = 0;
  /** Number of `getUpdates` requests waiting for updates right now */
  polling = 0;
  #updates: unknown[] = [];
  #nextUpdateId = 1;
  #wake = new Set<() => void>();

  async install(context: BrowserContext) {
    await context.route("https://api.telegram.org/**", (r) => this.#handle(r));
  }

  sent(method = "sendMessage") {
    return this.calls.filter((c) => c.method === method);
  }

  /** Queues an incoming text message from a user. */
  message(text: string, chatId = 4242) {
    const id = this.#nextUpdateId++;
    this.#updates.push({
      update_id: id,
      message: {
        message_id: id,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: "private", first_name: "Tester" },
        from: { id: chatId, is_bot: false, first_name: "Tester" },
        text,
        ...(text.startsWith("/")
          ? {
            entities: [{
              type: "bot_command",
              offset: 0,
              length: text.split(" ")[0].length,
            }],
          }
          : {}),
      },
    });
    for (const wake of this.#wake) wake();
    return id;
  }

  async #handle(route: Route) {
    const request = route.request();
    const method = new URL(request.url()).pathname.split("/").pop()!;
    let body: Record<string, unknown> = {};
    try {
      body = request.postDataJSON() ?? {};
    } catch {
      // not JSON
    }
    this.calls.push({ method, body, at: Date.now() });
    let result: unknown = true;
    switch (method) {
      case "getWebhookInfo":
        result = {
          url: this.webhookUrl,
          has_custom_certificate: false,
          pending_update_count: this.#updates.length,
        };
        break;
      case "deleteWebhook":
        this.webhookUrl = "";
        break;
      case "getMe":
        await new Promise((r) => setTimeout(r, this.getMeDelayMs));
        result = {
          id: 1111111111,
          is_bot: true,
          first_name: "Mock",
          username: MOCK_USERNAME,
          can_join_groups: true,
          can_read_all_group_messages: false,
          supports_inline_queries: false,
        };
        break;
      case "getUpdates": {
        // An offset confirms all updates before it, like in the real API.
        const offset = Number(body.offset ?? 0);
        this.#updates = this.#updates.filter((u) =>
          (u as { update_id: number }).update_id >= offset
        );
        const deadline = Date.now() +
          Math.min(Number(body.timeout ?? 0), 2) * 1000;
        this.polling++;
        try {
          while (this.#updates.length === 0 && Date.now() < deadline) {
            await new Promise<void>((resolve) => {
              const wake = () => {
                this.#wake.delete(wake);
                resolve();
              };
              this.#wake.add(wake);
              setTimeout(wake, deadline - Date.now());
            });
          }
        } finally {
          this.polling--;
        }
        result = this.#updates.slice(0, Number(body.limit ?? 100));
        break;
      }
      case "sendMessage":
        result = {
          message_id: this.calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: body.chat_id, type: "private" },
          text: body.text,
        };
        break;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ ok: true, result }),
    }).catch(() => {
      // The page aborted the request, e.g. `bot.stop()` or a terminated worker.
    });
  }
}
