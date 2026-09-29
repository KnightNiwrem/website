<!-- markdownlint-disable no-inline-html -->

# Live Code Fixture

This test site is separate from the documentation. It checks that `<LiveCode>`
works for blocks other than the homepage example.

## Code Group From the Getting Started Page

Copied from
[Getting Started](https://grammy.dev/guide/getting-started#getting-started-on-node-js).

<LiveCode>

::: code-group

```ts [TypeScript]
import { Bot } from "grammy";

// Create an instance of the `Bot` class and pass your bot token to it.
const bot = new Bot(""); // <-- put your bot token between the ""

// You can now register listeners on your bot object `bot`.
// grammY will call the listeners when users send messages to your bot.

// Handle the /start command.
bot.command("start", (ctx) => ctx.reply("Welcome! Up and running."));
// Handle other messages.
bot.on("message", (ctx) => ctx.reply("Got another message!"));

// Now that you specified how to handle messages, you can start your bot.
// This will connect to the Telegram servers and wait for messages.

// Start the bot.
bot.start();
```

```js [JavaScript]
const { Bot } = require("grammy");

// Create an instance of the `Bot` class and pass your bot token to it.
const bot = new Bot(""); // <-- put your bot token between the ""

// You can now register listeners on your bot object `bot`.
// grammY will call the listeners when users send messages to your bot.

// Handle the /start command.
bot.command("start", (ctx) => ctx.reply("Welcome! Up and running."));
// Handle other messages.
bot.on("message", (ctx) => ctx.reply("Got another message!"));

// Now that you specified how to handle messages, you can start your bot.
// This will connect to the Telegram servers and wait for messages.

// Start the bot.
bot.start();
```

:::

</LiveCode>

## Single Block With Types

The summary from
[Context](https://grammy.dev/guide/context#customizing-the-context-object),
completed with an import and `start()`.

<LiveCode>

```ts
import { Bot, type Context } from "npm:grammy";

const BOT_DEVELOPER = 123456; // bot developer chat identifier

// Define custom context type.
interface BotConfig {
  botDeveloper: number;
  isDeveloper: boolean;
}
type MyContext = Context & {
  config: BotConfig;
};

const myBot = new Bot<MyContext>("");

// Set custom properties on context objects.
myBot.use(async (ctx, next) => {
  ctx.config = {
    botDeveloper: BOT_DEVELOPER,
    isDeveloper: ctx.from?.id === BOT_DEVELOPER,
  };
  await next();
});

// Define handlers for custom context objects.
myBot.command("start", async (ctx) => {
  if (ctx.config.isDeveloper) await ctx.reply("Hi mom!");
  else await ctx.reply("Welcome");
});

await myBot.start({
  onStart: (me) => console.log(`Started as @${me.username}`),
});
```

</LiveCode>

## Unsupported Import

From the [runner plugin](https://grammy.dev/plugins/runner).

<LiveCode>

```ts
import { Bot } from "grammy";
import { run } from "@grammyjs/runner";

// Create a bot.
const bot = new Bot("");

// Add the usual middleware, yada yada
bot.on("message", (ctx) => ctx.reply("Got your message."));

// Run it concurrently!
run(bot);
```

</LiveCode>
