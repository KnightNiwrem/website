// Runs one live example in a dedicated worker. The page creates a new worker
// for every run and terminates it afterwards, so nothing leaks between runs.
//
// A worker keeps a busy example from freezing the page and can always be
// terminated. It is NOT a security sandbox: the example can read the token and
// make any request the page itself could make.
import * as grammy from "grammy/web";
import {
  compile,
  locate,
  parseSpecifier,
  satisfies,
  SourceError,
} from "./prepare.ts";
import {
  botKey,
  type FromWorker,
  GRAMMY_VERSION,
  type Language,
  redact,
  type ToWorker,
} from "./protocol.ts";
const scope = globalThis as unknown as {
  postMessage(message: FromWorker): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<ToWorker>) => void,
  ): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(
    type: "unhandledrejection",
    listener: (event: PromiseRejectionEvent) => void,
  ): void;
};

let token = "";
let sourceURL = "example.ts";
let stopping = false;
const tokens = new Set<string>();
const bots = new Set<{ isRunning(): boolean; stop(): Promise<void> }>();
const reported = new WeakSet<object>();

function post(message: FromWorker) {
  scope.postMessage(message);
}

// Requests that the page has to answer, see `ToWorker["reply"]`.
let nextId = 0;
const pending = new Map<
  number,
  (reply: { ok: boolean; message?: string }) => void
>();
async function ask(
  message: { type: "claim"; bot: string } | {
    type: "webhook";
    host: string;
    pending: number;
  },
) {
  const id = nextId++;
  const reply = await new Promise<{ ok: boolean; message?: string }>(
    (resolve) => {
      pending.set(id, resolve);
      post({ ...message, id });
    },
  );
  if (!reply.ok) throw new Error(reply.message);
}

/**
 * grammY's `Bot` with three additions that are visible in the page:
 * 1. `new Bot("")` uses the token entered next to the example. The docs
 *    ask readers to put their token between these quotes.
 * 2. `bot.start()` makes sure that no other example on the page polls the same
 *    bot, and asks before starting a bot that has a webhook, because
 *    `bot.start()` deletes it.
 * 3. The page is told when polling starts and stops.
 */
class Bot<
  C extends grammy.Context = grammy.Context,
  A extends grammy.Api = grammy.Api,
> extends grammy.Bot<C, A> {
  constructor(botToken: string, config?: grammy.BotConfig<C>) {
    if (botToken === "") {
      if (token === "") {
        throw new Error(
          'No bot token: enter one in the token field, or put it between the "" in `new Bot("")`.',
        );
      }
      botToken = token;
    }
    tokens.add(botToken);
    super(botToken, config);
    bots.add(this);
  }

  override async start(options?: grammy.PollingOptions) {
    if (stopping) return;
    await ask({ type: "claim", bot: botKey(this.token) });
    const webhook = await this.api.getWebhookInfo();
    if (webhook.url) {
      await ask({
        type: "webhook",
        host: hostOf(webhook.url),
        pending: webhook.pending_update_count,
      });
    }
    if (stopping) return;
    const onStart = options?.onStart;
    const running = super.start({
      ...options,
      onStart: async (me) => {
        post({ type: "polling", username: me.username });
        await onStart?.(me);
      },
    });
    running.then(
      () => post({ type: "stopped-polling", username: this.botInfo.username }),
      (err) => {
        if (stopping) return;
        report(err);
        if (this.isInited()) {
          post({ type: "stopped-polling", username: this.botInfo.username });
        }
      },
    );
    return await running;
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "an unknown host";
  }
}

const grammyModule = moduleOf({ ...grammy, Bot });
// `grammy/types` only adds `InputFile` to the Bot API types, which are
// erased at runtime. The web build of `InputFile` is the one to use here.
const typesModule = moduleOf({ InputFile: grammy.InputFile });
const modules: Record<string, object> = {
  "grammy": grammyModule,
  "grammy/web": grammyModule,
  "grammy/types": typesModule,
};
const versions: Record<string, string> = { grammy: GRAMMY_VERSION };

function moduleOf(exports: Record<string, unknown>) {
  // Like transpiled ES modules in Node.js, so that interop helpers use the
  // named exports directly.
  return Object.defineProperty(exports, "__esModule", { value: true });
}

function require(specifier: string): unknown {
  const spec = parseSpecifier(specifier);
  const module = spec && modules[spec.name + spec.subpath];
  if (spec === undefined || module === undefined) {
    throw new Error(
      `Cannot import "${specifier}" here. Examples run in your browser, where only these modules are available: ${
        Object.keys(modules).join(", ")
      } (and the same with npm:).`,
    );
  }
  if (spec.version !== undefined) {
    const have = versions[spec.name];
    if (!satisfies(have, spec.version)) {
      throw new Error(
        `Cannot import "${specifier}" here. Examples run with ${spec.name}@${have}.`,
      );
    }
  }
  return module;
}

function describe(err: unknown): string {
  if (err instanceof grammy.GrammyError) {
    return `${err.message}`;
  }
  if (err instanceof grammy.HttpError) {
    return `${err.message} ${describe(err.error)}`;
  }
  if (err instanceof grammy.BotError) {
    return `Error while handling update ${err.ctx.update.update_id}: ${
      describe(err.error)
    }`;
  }
  if (err instanceof Error) {
    const text = `${err.name}: ${err.message}`;
    if (
      err instanceof ReferenceError &&
      /\b(process|Deno|Buffer|__dirname|__filename)\b/.test(err.message)
    ) {
      return `${text} (Node.js and Deno APIs are not available in the browser.)`;
    }
    return text;
  }
  return String(err);
}

function report(err: unknown) {
  if (typeof err === "object" && err !== null) {
    if (reported.has(err)) return;
    reported.add(err);
  }
  // Middleware errors are wrapped, and only the cause points into the example.
  const cause = err instanceof grammy.BotError ? err.error : err;
  const at = err instanceof SourceError
    ? { line: err.line, column: err.column }
    : locate(cause instanceof Error ? cause.stack : undefined, sourceURL);
  post({ type: "error", text: redact(describe(err), tokens), ...at });
}

/** Uncaught errors end the example, like they end a Node.js or Deno process. */
function crash(err: unknown) {
  if (stopping) return;
  report(err);
  post({ type: "crashed" });
}

function format(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return describe(value);
  if (typeof value === "function") return `[Function ${value.name}]`;
  if (typeof value !== "object" || value === null) return String(value);
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (_key, v) => {
      if (typeof v === "bigint") return `${v}n`;
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }
      return v;
    }, 2);
  } catch {
    return String(value);
  }
}

for (const level of ["log", "info", "warn", "error", "debug"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    const text = redact(args.map(format).join(" "), tokens).slice(0, 10_000);
    original(text);
    post({ type: "log", level: level === "debug" ? "log" : level, text });
  };
}

scope.addEventListener("error", (event: ErrorEvent) => {
  event.preventDefault();
  crash(event.error ?? event.message);
});
scope.addEventListener(
  "unhandledrejection",
  (event: PromiseRejectionEvent) => {
    event.preventDefault();
    crash(event.reason);
  },
);

async function run(source: string, language: Language, botToken: string) {
  token = botToken;
  if (token !== "") tokens.add(token);
  sourceURL = `example.${language}`;
  let example;
  try {
    example = compile(source, language, sourceURL);
  } catch (err) {
    crash(err);
    return;
  }
  const module = { exports: {} };
  try {
    await example(require, module, module.exports);
    if (!stopping) post({ type: "evaluated" });
  } catch (err) {
    crash(err);
  }
}

async function stop() {
  stopping = true;
  // `bot.stop()` aborts the pending `getUpdates` call and then confirms the
  // updates that were already handled, so they are not delivered again.
  await Promise.allSettled(
    [...bots].filter((bot) => bot.isRunning()).map((bot) => bot.stop()),
  );
  post({ type: "stopped" });
}

scope.addEventListener("message", ({ data }: MessageEvent<ToWorker>) => {
  switch (data.type) {
    case "run":
      run(data.source, data.language, data.token);
      break;
    case "stop":
      stop();
      break;
    case "reply":
      pending.get(data.id)?.(data);
      pending.delete(data.id);
      break;
  }
});
