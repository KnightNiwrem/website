import { Bot as GrammyBot } from "@grammy/browser";
import { telegramFetch } from "@grammy/browser-fetch";
export * from "@grammy/browser";

// Use real grammY, real bot identity, real polling, and real API responses.
// Only request encoding and a startup status message differ from the npm entry.
export class Bot extends GrammyBot {
  constructor(token, options = {}) {
    if (!token?.trim()) {
      throw new Error(
        'Paste your BotFather token between the quotes in new Bot("")',
      );
    }
    super(token.trim(), {
      ...options,
      client: { fetch: telegramFetch, ...options.client },
    });
  }

  async start(options = {}) {
    console.info("Connecting to Telegram...");
    await super.start({
      ...options,
      onStart: async (info) => {
        console.info(
          `Bot running: https://t.me/${info.username}\nSend it a message in Telegram. Keep this page open.`,
        );
        await options.onStart?.(info);
      },
    });
  }
}
