// Shared by the page and the worker. The page loads this module with every
// live example, so it must stay small and must not import the transpiler.

/** Version of grammY that examples run with, as pinned in deno.jsonc. */
export const GRAMMY_VERSION = "1.46.0";

export type Language = "ts" | "js";

/** Maps the `language-*` class of a VitePress code block to a language. */
export function languageOf(className: string): Language | undefined {
  const lang = /(?:^|\s)language-([\w-]+)/.exec(className)?.[1];
  switch (lang) {
    case "ts":
    case "typescript":
    case "mts":
      return "ts";
    case "js":
    case "javascript":
    case "cjs":
    case "mjs":
      return "js";
  }
  return undefined;
}

// Messages exchanged between a run session on the page and its worker.

export type ToWorker =
  | { type: "run"; source: string; language: Language; token: string }
  | { type: "stop" }
  | { type: "reply"; id: number; ok: boolean; message?: string };

export type FromWorker =
  | { type: "log"; level: "log" | "info" | "warn" | "error"; text: string }
  | { type: "error"; text: string; line?: number; column?: number }
  /** Top-level code of the example has finished running. */
  | { type: "evaluated" }
  /** A bot is about to call `bot.start()`; the page answers with a reply. */
  | { type: "claim"; id: number; bot: string }
  /** A bot has a webhook; the page asks the visitor and answers with a reply. */
  | { type: "webhook"; id: number; host: string; pending: number }
  | { type: "polling"; username: string }
  | { type: "stopped-polling"; username: string }
  /** An error was not caught, which ends the program like in Node.js. */
  | { type: "crashed" }
  /** Answer to `stop` once all bots are stopped gracefully. */
  | { type: "stopped" };

const TOKEN_PATTERN = /(?<!\d)\d{4,}:[\w-]{30,}/g;
export const REDACTED = "[bot token]";

/**
 * Removes bot tokens from text before it is displayed. Known tokens are
 * removed wherever they appear, and anything shaped like a bot token is
 * removed as well.
 */
export function redact(text: string, known: Iterable<string> = []): string {
  for (const token of known) {
    if (token.length >= 8) text = text.split(token).join(REDACTED);
  }
  return text.replace(TOKEN_PATTERN, REDACTED);
}

/**
 * Key that identifies a bot for coordination between runs. Telegram rejects
 * concurrent `getUpdates` calls per bot, so this is the public bot ID (the
 * part of the token before the colon), never the secret part.
 */
export function botKey(token: string): string {
  const id = /^(\d+):/.exec(token)?.[1];
  if (id) return id;
  // Not a well-formed token; fall back to a non-reversible short hash.
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h = Math.imul(h ^ token.charCodeAt(i), 0x01000193);
  }
  return `h${(h >>> 0).toString(36)}`;
}
