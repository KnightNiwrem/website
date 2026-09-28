# Live documentation examples

The global `<LiveCode>` component enables editing and execution of existing Markdown code fences.
The English homepage is the first consumer; other pages can opt in with the same wrapper.

## Authoring

Wrap one JavaScript or TypeScript fence, or one `::: code-group` containing alternative examples, with blank lines around the component tags:

````md
<LiveCode>

```ts
import { Bot } from "grammy";

const bot = new Bot("");
bot.on("message", (ctx) => ctx.reply("Hello!"));
bot.start();
```

</LiveCode>
````

Examples run as native ES modules by default, including support for top-level `await`.
For a CommonJS fence, use `<LiveCode commonjs>`.
For mixed alternatives, select CommonJS tabs by label, such as `<LiveCode :commonjs="['JavaScript']">` on the homepage.
Each tab is a separate example, with its own edits and history.

The static fence supplies the initial editor text and remains readable without JavaScript.
Copy and Run use the current editor text; Reset restores the original fence.
Visitors enter a test bot token in the separate field, which supplies empty `Bot` or `Api` constructor arguments.
Execution requires an explicit Run action; after editing or switching tabs, use Stop and Run to execute the displayed source.

## Runtime limits

- `grammy`, `npm:grammy`, `npm:grammy@1.46.0`, and `grammy/web` all resolve to the same bundled `grammy/web` 1.46.0 adapter.
  Other packages, relative imports, and multi-file projects are unsupported.
- TypeScript syntax is removed locally; the editor supplies highlighting and undo without type checking or IDE completion.
  CommonJS runs in a synchronous wrapper and cannot use top-level `await`.
- Each Run creates a module worker; HTTPS or localhost, Web Locks, and `AbortSignal.any` are required.
  Node and Deno runtime APIs are unavailable, and `import.meta.url` identifies an in-memory blob module.
- The adapter permits one Bot per run, rejects custom API client configuration and existing webhooks, prevents webhook changes and dropping pending updates, and excludes concurrent use of the same token across blocks and same-origin tabs.
- Stop allows 1.5 seconds for graceful shutdown before terminating the worker.
  It cannot undo requests already processed by Telegram, and interrupted updates may repeat or have partial effects.
- Tokens and edited source stay in memory, and displayed errors redact credentials.
  Executed code can access the token and network; the worker is not a security sandbox for untrusted code.
- Navigation stops the run; visibility changes alone do not.
  Mobile browsers can suspend background execution, so visitors may need to return and restart after switching to Telegram.

If deployment introduces a CSP, the page needs `worker-src 'self'`.
The worker script response needs `default-src 'none'; script-src 'self' blob:; connect-src https://api.telegram.org` for ESM examples.
Serving CommonJS examples additionally requires `'unsafe-eval'` in the worker's `script-src`.

## Tests

From `site/`:

```sh
deno ci
deno task genapi
deno task test:live:browser
deno task test:live:build
deno task test:live
deno check docs/.vitepress/live-code/*.ts tests/live-code/*.ts
deno fmt --check
deno task lint
```

`test:live:build` builds both the documentation and the isolated [fixture site](./fixture/index.md).
`test:live` serves those existing builds and runs Playwright; rebuild after source changes to avoid testing stale output.
The fixture has three independent live blocks covering TypeScript ESM, CommonJS, and JavaScript ESM, plus a navigation destination.
Its source is committed; its generated `dist`, `cache`, and `.temp` directories are ignored.
It is separate from the public documentation build.
Set `GRAMMY_TEST_BROWSER` to an installed Chromium executable when the default Playwright browser is unavailable.

The browser suite covers static rendering, lazy loading, source parity, module semantics, mapped errors, CSP, webhook protection, Stop/rerun behavior, token coordination, navigation, and touch-emulated editing.
Telegram HTTP calls are intercepted with isolated mocks and synthetic credentials; no real token is needed.
Screenshots, traces, and video are disabled.
These tests do not establish real Telegram delivery or physical-phone behavior.
Before rollout, separately verify an authorized test bot's incoming message/reply loop and Stop, and test soft-keyboard input, selection, paste, IME, scrolling, and browser/Telegram switching on physical Android and iOS devices.
