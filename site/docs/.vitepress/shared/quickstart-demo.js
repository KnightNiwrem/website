import { Bot } from "grammy";

// Real grammY middleware; only delivery to/from Telegram is simulated.
export function createDemo() {
  const identity = {
    id: 123456,
    is_bot: true,
    first_name: "Quickstart bot",
    username: "grammy_docs_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  };
  const bot = new Bot("123456:LOCAL_DEMO_ONLY", {
    botInfo: identity,
    client: {
      fetch: () => {
        throw new Error("Network access is disabled for this demo bot");
      },
    },
  });
  let messageId = 0;
  bot.api.config.use((_prev, method, payload) => {
    if (method !== "sendMessage") {
      throw new Error(`Unsupported demo API method: ${method}`);
    }
    if (
      payload.chat_id !== 42 || typeof payload.text !== "string" ||
      Object.keys(payload).some((key) =>
        !["chat_id", "text"].includes(key) && payload[key] !== undefined
      )
    ) {
      throw new Error("Demo supports text replies to chat 42 only");
    }
    console.log(`Bot: ${payload.text}`);
    return Promise.resolve({
      ok: true,
      result: {
        message_id: ++messageId,
        date: 1700000000,
        from: identity,
        chat: { id: 42, type: "private", first_name: "Visitor" },
        text: payload.text,
      },
    });
  });
  bot.start = () => {
    throw new Error("Polling is disabled; use await send(text) in this demo");
  };
  let updateId = 0;
  async function send(text) {
    if (typeof text !== "string" || !text.length) {
      throw new Error("send(text) needs a non-empty string");
    }
    console.log(`You: ${text}`);
    const command = text.match(/^\/\S+/)?.[0];
    await bot.handleUpdate({
      update_id: ++updateId,
      message: {
        message_id: updateId,
        date: 1700000000,
        from: { id: 42, is_bot: false, first_name: "Visitor" },
        chat: { id: 42, type: "private", first_name: "Visitor" },
        text,
        ...(command
          ? {
            entities: [{
              type: "bot_command",
              offset: 0,
              length: command.length,
            }],
          }
          : {}),
      },
    });
  }
  return { bot, send };
}
