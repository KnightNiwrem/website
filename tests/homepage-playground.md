# Homepage quickstart playground

Only the English homepage opts in, using `::: code-group quickstart`.
The first (TypeScript) fence supplies the handler source for both the original copyable code and the editor.
The JavaScript and Deno tabs remain copyable platform alternatives.
The build fails if the expected import, empty-token construction, or polling statement changes without updating the adapter.

The build-time [LiveCodes SDK](https://livecodes.io/docs/sdk/js-ts/) creates an embed URL; the Vue component creates its iframe only after activation.
Using the SDK for the whole group preserves VitePress's tabs, copy buttons, and highlighting without installing a renderer for every fence.
The SDK is pinned to 0.14.1, the hosted app to v49, and grammY's browser module to 1.46.0.
No framework or package-manager upgrade is required.
The editor, compiler, and grammY module require external LiveCodes/CDN access after activation.
CodeMirror provides editing, wrapping, and TypeScript support; the helper's declarations are supplied through LiveCodes's custom types configuration.

The editor visibly replaces the token/polling boilerplate with `createDemo()` and `await send("Hello!")`.
The helper executes real grammY handlers with a synthetic bot identity and private text updates, including command entities.
It intercepts `sendMessage`, prints `You:` and `Bot:` lines, and returns a synthetic Telegram response.
Other API methods and additional message options fail explicitly; polling and the helper bot's network transport are disabled.
This is not a Telegram emulator or a real Telegram connection.
Visitors should not put real tokens in the editor; arbitrary edited code can still access the network.
Each Run recreates the result iframe; closing or navigating away removes the entire playground and discards edits.

LiveCodes v49 has an upstream limitation: immediately repeating an unchanged run within 500 ms can clear the result without executing it again.
Pressing Run again after a short pause recovers.
The normal browser assertions deliberately space runs by 650 ms and require a fresh console event as well as visible output, so stale output cannot pass a rerun assertion.

## Checks

From `site/`, using the repository's Deno toolchain:

```sh
deno ci
deno task genapi
deno task build
deno fmt --check
deno task lint
deno test --no-check -A docs/.vitepress/plugins/quickstart_test.ts
deno task serve --host 127.0.0.1 --port 4173
```

The focused tests execute VitePress's actual Markdown renderer.
`--no-check` avoids the existing VitePress declarations' implicit `@types/node` dependency, which is not installed in the site's manual `node_modules` setup.

Install browser tooling outside the site and run the browser script from the repository root:

```sh
npm install --prefix /tmp/grammy-browser-tests playwright@1.63.0
/tmp/grammy-browser-tests/node_modules/.bin/playwright install firefox
PLAYWRIGHT_MODULE=/tmp/grammy-browser-tests/node_modules/playwright/index.mjs \
  node tests/homepage-playground.mjs
```

The host must supply Playwright's browser system libraries.
Set `TEST_URL`, `TEST_OUTPUT`, and `TEST_ENGINE` to override the default local URL, `/tmp/grammy-homepage-evidence` artifact directory, and Firefox engine.
`TEST_ENGINE=chromium` requires Chromium's browser binary and a working OS sandbox; the script does not disable it.
No headed environment or Telegram token is required.
The script saves behavioral assertions, requests, console/errors, and desktop/mobile screenshots.
It exercises lazy loading, all three static tabs and clipboard contents, two source edits, explicit execution, runtime errors, unsupported API calls, polling rejection, rerun/navigation cleanup, the unchanged getting-started guide, keyboard access, a 390 px viewport, and absence of Telegram requests.
Viewport emulation does not establish physical-mobile or cross-browser compatibility.
The browser script records and recognizes one existing VitePress 1.6.4 outline error after quickly leaving a scrolled guide: its debounced callback accesses an unmounted marker (`n.value.style`).
The same clipboard/back/resize sequence reproduced this error on the unchanged `83d953d8` build.
Intentional example errors and this exact baseline error are retained in the log; other page errors fail the test.
