// One run of a live example: owns a worker from start to cleanup.
import {
  type FromWorker,
  type Language,
  redact,
  type ToWorker,
} from "./protocol.ts";

/** How long `stop` waits for bots to stop before terminating the worker. */
const GRACE_MS = 3000;

export interface SessionHandlers {
  log(
    level: "log" | "info" | "warn" | "error",
    text: string,
    at?: { line?: number; column?: number },
  ): void;
  /** The top-level code of the example has finished. */
  evaluated(): void;
  polling(username: string, active: boolean): void;
  /** Asks the visitor whether a bot with a webhook may be started. */
  confirmWebhook(host: string, pending: number): Promise<boolean>;
  /** Called once when the run is over and all resources are released. */
  ended(reason: string): void;
}

// Bots that are polling in this page, by bot ID. Telegram only allows one
// `getUpdates` loop per bot, so a new run takes the bot over from an old one,
// which is also what happens on Telegram's side when a second loop starts.
const claims = new Map<string, Session>();
const OTHER_TAB = "Stopped, because the same bot was started in another tab.";

// Runs in other tabs of this site are asked to stop the same way.
const channel = typeof BroadcastChannel === "undefined"
  ? undefined
  : new BroadcastChannel("grammy-live-code");
channel?.addEventListener("message", ({ data }) => {
  if (data?.type === "take-over") claims.get(data.bot)?.stop(OTHER_TAB);
});

export class Session {
  #worker: Worker;
  #token: string;
  #handlers: SessionHandlers;
  #releases: (() => void)[] = [];
  #stopped?: Promise<void>;
  #gracefullyStopped!: () => void;
  #ended = false;

  constructor(
    source: string,
    language: Language,
    token: string,
    handlers: SessionHandlers,
  ) {
    this.#token = token;
    this.#handlers = handlers;
    this.#worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
      name: "grammY live example",
    });
    this.#worker.addEventListener("message", (e) => this.#receive(e.data));
    this.#worker.addEventListener("error", (e) => {
      e.preventDefault();
      this.#log("error", `The example could not be started: ${e.message}`);
      this.stop("Failed to start.", false);
    });
    this.#send({ type: "run", source, language, token });
  }

  get ended() {
    return this.#ended;
  }

  /**
   * Stops the run: bots are asked to stop gracefully first, then the worker
   * is terminated even if the example does not respond. Requests that were
   * already sent to Telegram cannot be undone.
   */
  stop(reason = "Stopped.", graceful = true): Promise<void> {
    this.#stopped ??= (async () => {
      let clean = true;
      if (graceful) {
        const done = new Promise<void>((r) => this.#gracefullyStopped = r);
        this.#send({ type: "stop" });
        const timeout = new Promise<boolean>((r) =>
          setTimeout(r, GRACE_MS, false)
        );
        clean = await Promise.race([done.then(() => true), timeout]);
      }
      this.#worker.terminate();
      this.#end();
      this.#handlers.ended(
        clean
          ? reason
          : `${reason} The example did not stop in time and was terminated.`,
      );
    })();
    return this.#stopped;
  }

  #end() {
    this.#ended = true;
    for (const release of this.#releases.splice(0)) release();
  }

  #send(message: ToWorker) {
    if (!this.#ended) this.#worker.postMessage(message);
  }

  #log(
    level: "log" | "info" | "warn" | "error",
    text: string,
    at?: { line?: number; column?: number },
  ) {
    // The worker redacts too; this also covers text created on the page.
    this.#handlers.log(level, redact(text, [this.#token]), at);
  }

  async #receive(message: FromWorker) {
    if (this.#ended) return;
    switch (message.type) {
      case "log":
        this.#log(message.level, message.text);
        break;
      case "error":
        this.#log("error", message.text, message);
        break;
      case "evaluated":
        this.#handlers.evaluated();
        break;
      case "polling":
        this.#handlers.polling(message.username, true);
        break;
      case "stopped-polling":
        this.#handlers.polling(message.username, false);
        break;
      case "crashed":
        this.stop("Stopped, because of an uncaught error.");
        break;
      case "stopped":
        this.#gracefullyStopped?.();
        break;
      case "claim":
      case "webhook": {
        let reply: ToWorker;
        try {
          if (message.type === "claim") await this.#claim(message.bot);
          else if (
            !await this.#handlers.confirmWebhook(message.host, message.pending)
          ) {
            throw new Error(
              "Not started, because the bot's webhook was kept.",
            );
          }
          reply = { type: "reply", id: message.id, ok: true };
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err);
          reply = { type: "reply", id: message.id, ok: false, message: text };
        }
        this.#send(reply);
        break;
      }
    }
  }

  async #claim(bot: string) {
    const holder = claims.get(bot);
    if (holder !== undefined && holder !== this) {
      await holder.stop(
        "Stopped, because another example started the same bot.",
      );
    }
    // Tabs hold a Web Lock per bot while they use it. Web Locks are only
    // available in secure contexts; elsewhere, Telegram's 409 error remains.
    if (navigator.locks !== undefined) {
      const name = `grammy-live-code:${bot}`;
      if (!await this.#lock(name, { ifAvailable: true })) {
        // Ask the other tab to stop, and take the lock if it does not.
        channel?.postMessage({ type: "take-over", bot });
        const signal = AbortSignal.timeout(GRACE_MS + 1000);
        if (!await this.#lock(name, { signal }).catch(() => false)) {
          await this.#lock(name, { steal: true });
        }
      }
    }
    if (this.#ended) return;
    claims.set(bot, this);
    this.#releases.push(() => {
      if (claims.get(bot) === this) claims.delete(bot);
    });
  }

  /** Requests a lock that is held until the run ends. */
  #lock(name: string, options: LockOptions): Promise<boolean> {
    let granted = false;
    return new Promise((resolve, reject) => {
      navigator.locks.request(name, options, (lock) => {
        if (lock === null) {
          resolve(false);
          return;
        }
        granted = true;
        resolve(true);
        return new Promise<void>((release) => {
          if (this.#ended) release();
          else this.#releases.push(release);
        });
      }).catch((err) => {
        // Before the lock is granted, the request was aborted. Afterwards,
        // another tab took it over.
        if (!granted) reject(err);
        else this.stop(OTHER_TAB);
      });
    });
  }
}
