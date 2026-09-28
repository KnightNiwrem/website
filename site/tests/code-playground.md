# Runnable documentation examples

The POC currently enables the English homepage quickstart with `::: code-group playground`.
This is the initial placement, not a restriction on where the integration can be used.
Any documentation page, including translations, can opt in one or more code groups using the same marker.
Unmarked groups and fences keep their existing rendering.

## Authoring

Mark a code group whose first fence contains a complete, browser-compatible JavaScript or TypeScript program:

````md
::: code-group playground

```js [JavaScript]
import { InlineKeyboard } from "grammy";

console.log(new InlineKeyboard().text("Hello", "hello").inline_keyboard);
```

:::
````

The first fence is the single source for the copyable example and the editor; its contents are passed through unchanged.
Supported fence languages are `js`, `javascript`, `ts`, and `typescript`.
Additional fences are copyable platform alternatives, not files combined into a project or independently runnable tabs.
Wrap a single example in the same container to opt it in.
Each marked group gets its own editor and execution frame.
Examples using `Bot` can use a visitor-provided token to communicate with Telegram; library-only examples can display their results in the console without a token.
Incomplete snippets need their setup included before opting in, and Node/Deno-specific APIs are unavailable in the browser.
The current POC does not add hidden setup or a multi-file project format.

The homepage's first TypeScript fence includes `new Bot("")` and `bot.start()`; its JavaScript and Deno tabs remain copyable platform alternatives.

Visitors activate the editor, paste their own BotFather token into the example, press Run, and message their bot in Telegram.
The console prints the bot's Telegram link once startup succeeds.
The bot runs in the visitor's browser while the page is open; it needs no deployed bot server.
Run recreates the execution frame, replacing the previous bot.
Stop and close removes the whole playground, aborts its polling requests, and discards the token and edits.
Navigation also removes the playground.

## Integration

The build-time [LiveCodes SDK](https://livecodes.io/docs/sdk/js-ts/) creates the embed URL; a Vue component creates its iframe only on activation.
This preserves VitePress's code-group tabs, copy buttons, and highlighting.
Versions are pinned: SDK 0.14.1, hosted app v49, and grammY browser entry 1.46.0.
The editor, compiler, and package are downloaded from LiveCodes/CDNs after activation.
No package-manager or framework upgrade is needed.

`grammy` resolves through a small browser adapter that re-exports the real browser package and subclasses its `Bot` to configure transport and log startup.
The bot gets its identity and updates from Telegram, calls real grammY polling and handlers, and sends real API requests.
There are no production response mocks, supplied bot identities, or synthetic updates.

[Telegram accepts form-encoded API parameters](https://core.telegram.org/bots/api#making-requests).
Its JSON POST requests require a browser CORS preflight that fails in the tested environment.
The adapter uses grammY's [custom fetch option](https://grammy.dev/ref/core/apiclientoptions#fetch) to encode JSON payloads as `application/x-www-form-urlencoded` instead.
Strings remain strings; nested objects and arrays are JSON-serialized, and cancellation signals and API responses are preserved.
File uploads using `InputFile` are explicitly unsupported by this small adapter.

Use a new test bot: normal `bot.start()` removes any configured webhook, and concurrent polling elsewhere can cause conflicts.
The UI explains that the token is accessible to the hosted editor and executed code, that code containing it must not be shared/exported, and that the page must stay open.
Automatic execution, saving, and unsaved-project recovery are disabled.
Iframe isolation does not hide the token from the editor or dependencies.
The embed does not grant download permission; this does not prevent copying, sharing, or network access by the executed code.
Browsers may suspend background tabs, so this is a place to try a bot, not persistent hosting.

LiveCodes v49 can suppress an identical rerun within 500 ms and clear the result.
Run again after a short pause to recover; the browser test spaces ordinary reruns by 650 ms and requires fresh startup output.
The external TypeScript loader can also return 404 for some legacy declaration files without preventing execution.

## Validation and reproduction

From `site/`:

```sh
deno ci
deno task genapi
deno task build
deno fmt --check
deno task lint
deno task test
deno task serve --host 127.0.0.1 --port 4173
```

The focused tests exercise VitePress's actual Markdown renderer and verify multiple independent opt-in JS/TS groups on documentation and translated pages, exact source preservation, unchanged unmarked rendering, and clear errors for unsupported marked languages.
Transport tests verify real fetch delegation, form encoding of nested parameters, unchanged responses, and abort-signal propagation.
The Check workflow installs the locked dependencies and runs `deno task test` on pushes to main and pull request changes.
Both test suites run with TypeScript checking enabled; `@types/node` supplies the Node API declarations required by VitePress and Playwright.

With the production preview running, use another terminal in `site/`:

```sh
deno run -A npm:playwright@1.63.0 install firefox
deno task test:browser
```

The browser suite is a TypeScript `Deno.test`, using the pinned Playwright npm package through Deno's compatibility layer.
The site lockfile manages the dependency; no separate npm installation or Node command is needed.
The test lives under `site/tests/`, so the site's formatting and lint tasks cover it.
Run it explicitly against a served production build because it requires browser binaries and access to LiveCodes/CDNs and Telegram.
The host needs Playwright's browser system libraries.
`TEST_URL`, `TEST_OUTPUT`, and `TEST_ENGINE` override the default local URL, `/tmp/grammy-live-bot-evidence`, and Firefox engine.
Chromium testing requires a working OS sandbox; the test does not disable it.
No headed environment is required.

The browser test uses the homepage quickstart as its current end-to-end fixture; its assertions do not restrict other pages or examples from opting in.
It distinguishes two kinds of evidence:

- **Real Telegram transport:** an unmocked `getMe` with the deliberately invalid token `0:INVALID` returns a readable HTTP 401 from the embedded editor.
  This verifies cross-origin transport and error display, not authenticated bot operation.
- **HTTP fixture tests:** only inside Playwright, responses for a separate dummy token are intercepted to exercise the actual grammY startup, polling loop, middleware, and outgoing `sendMessage` requests.
  Tests verify two edited replies, no automatic reruns, no overlapping polls or duplicate replies, Stop/navigation cancellation, token reset, static tabs and clipboard contents, keyboard controls, and a 390 px viewport.
  Screenshots named `fixture-*` depict this test setup and are not evidence of real Telegram delivery.

No real token is requested or used by these tests.
Authenticated polling and actual Telegram message delivery remain unverified until a visitor tests with their own bot.
A manual acceptance check is: use a new BotFather token, Run, send the bot a Telegram message, edit its reply, Run again, confirm the new reply in Telegram, then Stop and confirm it no longer replies.
Physical-mobile and cross-browser compatibility are not inferred from Firefox viewport emulation.

The browser script retains deliberate example errors and one known VitePress 1.6.4 outline timer error in its logs.
That outline error was reproduced with the same clipboard/back/resize sequence on unchanged commit `83d953d8`; its debounced callback accesses an unmounted marker.
Other page errors fail the test.
