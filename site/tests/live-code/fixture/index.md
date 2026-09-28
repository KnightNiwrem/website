# Reusable live example fixture

This ordinary code block precedes the opt-in blocks.

```ts
const unrelated = "Do not execute me";
```

The first opt-in example adapts the command/reply example from the getting-started guide, with a different variable name and real TypeScript syntax.

<LiveCode>

```ts
import { Bot as TelegramBot } from "npm:grammy@1.46.0";

const greeting: string = "Welcome! Up and running.";
const helper = new TelegramBot("");
helper.command("start", (ctx) => ctx.reply(greeting));
helper.on("message", (ctx) => ctx.reply("Got another message!"));
await helper.start();
```

</LiveCode>

Another independent opt-in block checks token coordination.

<LiveCode>

```js
const { Bot } = require("grammy");
const another = new Bot("");
another.on("message", (ctx) => ctx.reply("Second block"));
another.start();
```

</LiveCode>

[Leave this page](./other)
