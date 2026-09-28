import * as grammy from "grammy/web";
import type { WorkerEvent } from "./protocol.ts";

/** Browser adaptations are deliberately confined to the supplied Bot/Api classes. */
export function runtime(token: string, emit: (event: WorkerEvent) => void) {
  const abort = new AbortController();
  let stopping = false;
  let bot: grammy.Bot | undefined;
  let polling: Promise<void> | undefined;

  const browserFetch: typeof fetch = (url, init) => {
    return fetch(url, {
      ...init,
      signal: AbortSignal.any([
        abort.signal,
        ...(init?.signal ? [init.signal] : []),
      ]),
    });
  };
  const client = { fetch: browserFetch, sensitiveLogs: false };
  const checkToken = (value: string) => {
    if (value && value !== token) {
      throw new Error(
        "Leave the constructor token empty and use the bot token field.",
      );
    }
    return token;
  };
  const guard: grammy.Transformer = (previous, method, payload, signal) => {
    if (method === "deleteWebhook") {
      if (
        (payload as { drop_pending_updates?: boolean }).drop_pending_updates
      ) {
        throw new Error(
          "Dropping pending updates is disabled in live examples.",
        );
      }
      // start() always calls deleteWebhook. Skip that mutation, even after the
      // preflight: a webhook installed concurrently must remain untouched.
      return Promise.resolve({ ok: true, result: true }) as ReturnType<
        typeof previous
      >;
    }
    if (method === "setWebhook") {
      throw new Error("Webhook changes are disabled in live examples.");
    }
    return previous(method, payload, signal);
  };
  class BrowserApi extends grammy.Api {
    constructor(value: string, options?: grammy.ApiClientOptions) {
      if (options && Object.keys(options).length) {
        throw new Error(
          "Custom API client options are not supported in live examples.",
        );
      }
      super(checkToken(value), client);
      this.config.use(guard);
    }
  }
  class BrowserBot extends grammy.Bot {
    constructor(value: string, config?: grammy.BotConfig<grammy.Context>) {
      if (bot) throw new Error("Use one Bot instance per live run.");
      if (config?.client) {
        throw new Error(
          "Custom API client options are not supported in live examples.",
        );
      }
      super(checkToken(value), { ...config, client });
      this.api.config.use(guard);
      // grammY's default handler logs the complete error before throwing.
      // Preserve the failure while keeping payloads and tokens out of console output.
      this.catch((error) => {
        throw error.error;
      });
      bot = this;
    }
    override start(options?: grammy.PollingOptions) {
      if (stopping) return Promise.reject(new Error("Run stopped."));
      if (polling) return polling;
      polling = super.start({
        ...options,
        onStart: async (info) => {
          await options?.onStart?.(info);
          if (!stopping) {
            emit({ type: "running", username: info.username ?? "" });
          }
        },
      });
      // Attach a handler even when the example does not await start().
      // The worker owns reporting and cleanup; the original promise still rejects.
      polling.catch((error) => emit({ type: "error", text: describe(error) }));
      return polling;
    }
  }
  let describe = (error: unknown) => String(error);
  return {
    exports: { ...grammy, Bot: BrowserBot, Api: BrowserApi },
    setDescribe(value: typeof describe) {
      describe = value;
    },
    async preflight() {
      const api = new BrowserApi("");
      const webhook = await api.getWebhookInfo(abort.signal);
      if (webhook.url) {
        throw new Error(
          "This bot has an existing webhook. Use a dedicated test bot; the webhook was not changed.",
        );
      }
    },
    async stop() {
      if (stopping) return;
      // Allow grammY's final offset confirmation and in-flight middleware to
      // finish before aborting other requests. The host bounds this grace period.
      const cleanup = bot?.isRunning() ? bot.stop() : Promise.resolve();
      stopping = true;
      try {
        await cleanup;
        await polling;
      } finally {
        abort.abort();
      }
    },
  };
}
