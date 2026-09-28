# Lightweight live grammY examples

Recommend **Prism Code Editor 5.4.0, integrated directly with Vue, plus a fresh dedicated worker per Run** for this repository's short examples.
Bundle **grammY 1.46.0** and **Sucrase 3.35.1** locally, loading them only on Run.
The prototype preserves the static site and executes the visitor's edited source with real grammY against Telegram.
Keep this as a draft pending real message-loop and physical-phone verification.

The necessary custom pieces are a fence wrapper, editor controls, source preparation, a worker controller, and a small grammY adapter for credentials, webhook protection, and shutdown.
These total approximately 650 lines including Vue templates and styles; tests and research utilities are separate.
There is no package installer, filesystem, server execution, Node emulation, or Telegram emulator in the product.

**Repository findings and scope**

Inspected at website commit `83d953d8d8c714cf2a748859fea9a4d3cd69f704` on September 28, 2026.
The lockfile resolves VitePress 1.6.4, Vite 5.4.21, Vue 3.5.38, Shiki 2.5.0, and Sass 1.101.0.
The homepage still has three alternatives: TypeScript ESM, JavaScript CommonJS, and TypeScript with `npm:grammy`.
The getting-started guide adds command handlers and longer comments but needs the same execution facilities.
The Markdown extension currently only improves line breaks; the theme registers Vue components.
Netlify's configuration contains cache headers and redirects, with no CSP or isolation headers.

Only the English homepage opts in publicly.
An isolated [ordinary documentation-page fixture](./fixture/index.md) adapts the getting-started example, uses a renamed `helper` variable and an aliased import, and contains two independent live blocks preceded by an unrelated fence.
It is built separately and does not become part of the documentation deployment.
No homepage path, code-block index, exact source string, or variable named `bot` is embedded in the implementation.

Authors wrap **one fence or one group of alternative fences**:

````md
<LiveCode>

```ts
import { Bot } from "grammy";
const example = new Bot("");
example.on("message", (ctx) => ctx.reply("Hello!"));
example.start();
```

</LiveCode>
````

For a group, put the existing `::: code-group` and its fences inside the wrapper.
Keep blank lines around the component tags.
The static fences remain the source of truth, including normal VitePress highlighting, tabs, line numbers, and copy buttons.
Activation reads their rendered code text and labels; then each alternative retains its own editor and history.
Copy source and Run both read the current editor revision, without inserting the token into it.
No execution occurs on activation, edits, tab switches, or theme changes.

**Editor comparison**

| Option                  | Findings and decision                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prism Code Editor 5.4.0 | Textarea with a highlighted overlay; selected core, TypeScript/JavaScript grammar, history, layout CSS, and small site-colored token styles. No Vue wrapper or completion package. Its upstream documentation reports mobile Safari/Chrome/Firefox testing. Small enough for short documentation examples; physical keyboard/IME testing remains necessary.                              |
| CodeMirror 6            | Viable alternative with a richer state/extension model and mobile support as a design goal. Direct Vue integration would create one `EditorView` on mount, observe transactions, and destroy it on unmount. Measured line numbers, selection drawing, history/keymaps, syntax highlighting, line wrapping, and `javascript({ typescript: true })`; no large Vue wrapper or `basicSetup`. |
| Plain textarea          | No editor dependency; native text entry is an attractive fallback. Loses syntax highlighting and needs its own handling for consistent editing/history controls. Reasonable if even Prism's cost or phone behavior is unacceptable.                                                                                                                                                      |
| Monaco                  | Its current FAQ still explicitly says mobile browsers are unsupported. Its IDE language services are not required here. Excluded on product fit, without comparing an advertised core size to complete competing bundles.                                                                                                                                                                |

Primary sources: [Prism README and compatibility](https://github.com/jonpyt/prism-code-editor), [CodeMirror basic integration](https://codemirror.net/examples/basic/), [CodeMirror system guide](https://codemirror.net/docs/guide/), and [Monaco FAQ](https://github.com/microsoft/monaco-editor#faq).
Prism's main branch was `aa749ed369b3b453df2736831a37d510a742cb64` (September 25, 2026); npm reported 5.4.0 as current, last modified September 6.
This is evidence of recent maintenance, not a guarantee of long-term support.

Inspected and rendered with `markdown-it-prism-code-editor` 0.1.0.
Its plugin replaces `md.options.highlight`; its documented integration also replaces the fence renderer.
With this repository's VitePress renderer, simply adding the plugin preserved two tabs/copy buttons but replaced Shiki and produced a Prism `div` inside `pre > code`.
Adopting its recommended wrapperless fence would additionally replace VitePress's fence wrappers.
The [plugin documentation](https://github.com/jonpyt/prism-code-editor/tree/main/markdown-it-plugin) and installed source confirm it supplies editors/highlighting, not a Telegram runner.
The prototype therefore leaves the Markdown pipeline intact.

**Measured costs**

Decimal KB, minified browser bundles, gzip level 9 and Brotli default compression.
The isolated comparison uses esbuild 0.21.5, ES2022, and equivalent editing/highlighting/history scope.
CodeMirror package versions: view 6.43.13, state 6.7.6, commands 6.11.1, language 6.12.4, lang-javascript 6.2.5.
Dependency builds are informative breakdowns; their compressed sizes are not additive predictions of Rollup output.

| Isolated dependency build                                        | Raw KB | Gzip KB | Brotli KB |
| ---------------------------------------------------------------- | -----: | ------: | --------: |
| Prism core + history                                             |  10.90 |    5.40 |      4.88 |
| Selected Prism + JS/TS + history (JS)                            |  16.64 |    7.51 |      6.83 |
| Selected Prism layout + token styles (CSS)                       |   2.62 |    0.93 |      0.77 |
| Comparable minimal CodeMirror + JS/TS, including injected styles | 407.25 |  138.65 |    117.63 |
| Sucrase compiler                                                 | 205.94 |   47.41 |     40.18 |
| Source map reader                                                |   6.37 |    2.96 |      2.70 |
| grammY browser namespace                                         | 107.16 |   27.18 |     23.31 |

Actual production output, rounded:

| Transfer stage           |            Gzip KB | Notes                                                                                |
| ------------------------ | -----------------: | ------------------------------------------------------------------------------------ |
| Baseline initial JS/CSS  |              86.89 | HTML-declared entry, preloads, and styles                                            |
| Prototype initial JS/CSS |              89.91 | Increment approximately 3.02 KB; no editor JS, compiler, grammY, or worker execution |
| Edit and run activation  |               8.09 | Editor JS and Vue controls/controller                                                |
| Run: worker entry        |               0.81 | Worker lifecycle and sanitized messages                                              |
| Run: preparation         |              49.44 | Compiler, import registry, source map handling                                       |
| Run: runtime             | Approximately 28.6 | Real grammY plus browser adapter                                                     |

VitePress 1.6.4 deliberately combines CSS into one stylesheet, so the editor's small styles arrive initially.
The initial increase also includes extra Vue helpers and a larger homepage lean chunk because the fences are now a component slot.
Fonts, images, third-party widgets, and speculative link prefetching are outside this JS/CSS comparison.
The browser regression test verifies editor JS is absent before activation and runtime chunks are absent until Run.

**Execution and lifecycle**

Sucrase parses and transpiles TypeScript and ESM imports to CommonJS; it also rewrites dynamic imports to the supplied `require` registry.
Accepted runtime specifiers are exactly `grammy`, `grammy/web`, `npm:grammy`, and `npm:grammy@1.46.0`.
Other dependencies fail with an explicit diagnostic; there is no regex matching a particular import line, network package resolution, Node runtime, or Deno runtime.
Type-only imports disappear during compilation.
Top-level await, ordinary CommonJS, aliased imports, parse errors, and asynchronous errors are covered.
Sucrase is a transpiler, not a type checker; the editor highlights syntax and supplies undo, not IDE completion or TypeScript diagnostics.
See the [Sucrase transform documentation](https://github.com/alangpierce/sucrase#transforms).

The pinned npm package exports `grammy/web` as `out/web.mjs`, and the worker imports that explicit browser distribution.
The release commit is `055a5a440f04d0b9fd5fd75a6d14dac4c2b83553` ([grammY v1.46.0](https://github.com/grammyjs/grammY/tree/v1.46.0)).
All code needed to compile/run is bundled with the site; source and tokens do not go to a compiler service.
Native ESM with a parsed specifier rewrite could remove the CommonJS evaluation layer, but would still need TypeScript preparation, a strategy for the CommonJS tab, and worker-local dependency resolution.
[Document import maps do not apply in workers](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap).

Main-thread evaluation would be slightly shorter but could freeze Run/Stop and the entire documentation UI.
A dedicated worker provides a tested hard-stop path for `while (true) {}` and clears its timers and resources on termination.
It is not a hostile-code security sandbox: executed code can read the token, call browser APIs, and send network requests.
[Worker lifecycle API](https://developer.mozilla.org/en-US/docs/Web/API/Worker) supports this limited isolation claim.

The browser adapter supplies the input token to empty `Bot`/`Api` constructors, allows one Bot per run, and rejects custom API client configuration.
It checks `getWebhookInfo` before evaluating source and refuses an existing webhook.
grammY's [polling startup](https://github.com/grammyjs/grammY/blob/v1.46.0/src/bot.ts) normally calls `deleteWebhook`; the adapter makes that call a no-op even if a webhook is installed after the check.
It also rejects `setWebhook` and `drop_pending_updates: true`.
These explicit browser adaptations are shown beside Run; dedicated test bots remain the intended workflow.
An unrelated deployment or different browser origin can still create polling conflicts, which Telegram reports.

Each run holds a Web Lock keyed by an in-memory SHA-256 digest of its token, excluding same-token runs in other blocks and same-origin tabs.
Different tokens and blocks have separate workers and Bot instances.
HTTPS (or localhost), Web Locks, module workers, and `AbortSignal.any` are required; lock acquisition fails clearly where unavailable.
Edits and tab switches mark the previous revision as still running.
Stop first calls grammY's `stop()`, waits for its polling promise and in-flight middleware, then aborts remaining adapter requests and terminates the worker.
The controller terminates unresponsive code after a 1.5-second grace period.
Errors, initialization cancellation, reruns, Vue unmount/navigation, and `pagehide` all release the run.
Visibility changes alone do not stop it.
API-only source reports “Code executed” and keeps Stop available for timers/resources.

grammY's stop confirms the last attempted update with a final `getUpdates` offset of `lastTriedUpdateId + 1`, before middleware necessarily finishes.
Tests verify that final request and graceful completion of a delayed handler.
A forced interruption can leave an unconfirmed update to repeat, or a confirmed handler with partial effects; there is no exactly-once guarantee or persisted offset.
Stopping cannot undo a request already processed by Telegram.
[Telegram documents confirmation by increasing the offset](https://core.telegram.org/bots/api#getupdates).

Tokens and edited source stay in memory; no share URL, local storage, analytics event, screenshot, trace, or HAR is created by the runner.
Errors and bounded console messages redact the supplied token, token-shaped strings, and Telegram API URLs before reaching the UI.
Source locations use an in-memory map and a constant source name; source maps are not put in data URLs.
Browser developer tools can still expose network request URLs containing the token, and user-authored code can deliberately disclose it.

**CORS and CSP evidence**

Observed with Chromium 153.0.8010.12 on Linux ARM64 using real `grammy/web`, not a standalone GET:
the default JSON `getMe` POST produced an OPTIONS response of 204 and a readable CORS response of 401 with an intentionally invalid token.
The readable error became a `GrammyError`.
A separate form-encoded invalid-token probe also produced a readable 401.
After explicit authorization to use `BOT_TOKEN`, browser-based authenticated `getMe` and `getWebhookInfo` both succeeded; no existing webhook was present.
Only those read-only authenticated methods were authorized, so polling and sends were not attempted.
Real authenticated polling preflight/response behavior, message delivery, and cancellation are still unverified.
Mock tests exercise grammY's actual JSON POST path, nested payloads, failures, cancellation, and offset confirmation but do not establish real Telegram operation.

There is no evidence requiring a proxy or alternate encoding.
The implementation retains grammY's JSON transport and does not use `no-cors`.
Telegram documents [JSON and form request encodings](https://core.telegram.org/bots/api#making-requests); the comparative form probe serializes nested values as JSON, but form encoding is not used in the product.

The static worker URL needs `worker-src 'self'` if a page CSP is introduced.
On the worker script's HTTP response, the relevant policy is `default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src https://api.telegram.org`.
The local AsyncFunction evaluation needs `unsafe-eval`; no blob worker, WASM compiler, CDN script, or cross-origin isolation is required.
Tests apply that worker response policy and separately verify failure without `unsafe-eval`.
The page need not allow eval for this editor/runner; any future whole-site CSP must separately accommodate VitePress and existing site integrations.
Do not forward token-bearing blocked-request URLs to a CSP reporting service.
See [MDN on worker CSP](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy).

**Verification boundaries and mobile**

| Check                                                 | Result                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| Production build and separate fixture build           | Passed                                                            |
| Formatting, repository lint, runtime TypeScript check | Passed                                                            |
| Production headless regression tests                  | 17 tests; isolated HTTP mocks explicitly identified in test names |
| Authenticated getMe + webhook status in a browser     | Verified; read-only authorization                                 |
| Actual outbound Telegram delivery                     | Unverified; not authorized                                        |
| Genuine incoming update and handler reply             | Unverified; not authorized                                        |
| Cessation of real Telegram work after Stop            | Unverified; lifecycle verified with mocks only                    |
| Physical Android/iOS keyboard and app switching       | Unavailable                                                       |

Automation covers multiline input, punctuation and Unicode, text selection, editor undo/redo, copied source, synthetic composition events, alternative tabs, visible Run/Stop, and a 390px touch-emulated layout without horizontal overflow.
This does not simulate an actual soft keyboard, native paste menu, selection handles, or real IME composition.
Before rollout, test those operations plus long-code scrolling on physical Android Chrome and iOS Safari.
Start in the browser, switch to Telegram, send a real authorized message, return, and verify delayed replies, reconnect behavior, Stop, and repeated updates after restart.
Test short and extended background intervals, screen lock, low-power mode, and browser back navigation.

Browsers can freeze/discard pages and workers when backgrounded; the UI says to return to the page and explicitly restart if polling does not recover.
grammY retries network failures, but reliable recovery across mobile suspension is an inference until measured on devices.
There is no background-hosting promise, visibility-triggered stop, or service-worker workaround.
[Chrome's page lifecycle guidance](https://developer.chrome.com/docs/web-platform/page-lifecycle-api) explains why a service worker is not a guarantee of indefinite execution.

**Reproduction**

From `site/`, using Deno 2.9.6 and Node 24.21.0 in this investigation:

```sh
deno ci
deno task genapi
deno task test:live:build
node node_modules/@playwright/test/cli.js install chromium
deno task test:live
deno check docs/.vitepress/live-code/*.ts
deno fmt --check
deno task lint
node tests/live-code/cors-probe.mjs
```

An initial baseline build failed on 513 missing API-reference links before `genapi`; after generating the 883 reference files, the unchanged baseline and prototype both built successfully.
Both emitted the same existing VueUse pure-annotation warnings.
The investigation environment needed network permission and locally downloaded Chromium system libraries; no network or browser-origin security checks were disabled.
Set `GRAMMY_TEST_BROWSER` to an installed Chromium executable where Playwright's default browser is unavailable, and provide any required system library path normally.
Browser tests start and stop their own local production preview servers.
No graphical desktop is required.

For the read-only authenticated check, explicitly supply `BOT_TOKEN` through your local secret environment and run `node tests/live-code/cors-probe.mjs --auth-status`.
That mode only calls getMe/getWebhookInfo and prints sanitized status fields.
Never put the token in the command line or the source file.

For size reproduction, install comparison dependencies outside the checkout:

```sh
npm install --prefix /tmp/grammy-live-research --no-audit --no-fund \
  @codemirror/view@6.43.13 @codemirror/state@6.7.6 \
  @codemirror/commands@6.11.1 @codemirror/language@6.12.4 \
  @codemirror/lang-javascript@6.2.5 markdown-it-prism-code-editor@0.1.0
node tests/live-code/measure.mjs /tmp/grammy-live-research /tmp/grammy-live-baseline-dist
```

The optional final argument is a saved baseline production dist, built from the original commit after generating its API reference.
Omit it to measure only the current build.
The user's original investigation prompt remains untracked and is not included in the patch.
