// Default: unauthenticated network check. Never put credentials in this file.
// --auth-status explicitly uses BOT_TOKEN for getMe/getWebhookInfo only.
// No mode polls or sends messages. No screenshots, traces, or HAR are recorded.
import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve } from "node:path";

const authenticated = process.argv.includes("--auth-status");
const token = authenticated ? process.env.BOT_TOKEN : "";
if (authenticated && !token) {
  throw new Error("BOT_TOKEN is required for --auth-status.");
}
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitepress"));
const { build } = createRequire(viteRequire.resolve("vite"))("esbuild");
const bundle = await build({
  stdin: {
    contents: 'import {Api} from "grammy/web"; globalThis.GrammyApi = Api;',
    resolveDir: resolve(import.meta.dirname, "../.."),
  },
  bundle: true,
  write: false,
  format: "iife",
});
const server = createServer((request, response) => {
  response.setHeader(
    "Content-Type",
    request.url === "/probe.js" ? "text/javascript" : "text/html",
  );
  response.end(
    request.url === "/probe.js"
      ? bundle.outputFiles[0].text
      : '<script src="/probe.js"></script>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.GRAMMY_TEST_BROWSER || undefined,
  });
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.responseReceived", ({ response }) => {
    if (response.url.startsWith("https://api.telegram.org/")) {
      // Deliberately omit URLs, headers containing credentials, and response bodies.
      console.log(
        JSON.stringify({
          status: response.status,
          allowOrigin: response.headers["access-control-allow-origin"],
        }),
      );
    }
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  console.log(JSON.stringify(
    await page.evaluate(async ({ authenticated, token }) => {
      if (authenticated) {
        const api = new globalThis.GrammyApi(token, { timeoutSeconds: 10 });
        try {
          await api.getMe();
          const webhook = await api.getWebhookInfo();
          return {
            authenticatedGetMe: true,
            existingWebhook: Boolean(webhook.url),
            pendingUpdateCount: webhook.pending_update_count,
          };
        } catch (error) {
          return {
            authenticatedGetMe: false,
            errorType: error.name,
            code: error.error_code,
          };
        }
      }
      const results = [];
      for (const encoding of ["json", "form"]) {
        let response;
        const api = new globalThis.GrammyApi(
          "123456789:INVALID_DEDICATED_CORS_PROBE",
          {
            timeoutSeconds: 10,
            fetch: async (url, init) => {
              if (encoding === "form") {
                const payload = JSON.parse(init.body);
                init = {
                  ...init,
                  headers: {},
                  body: new URLSearchParams(
                    Object.entries(payload).map((
                      [key, value],
                    ) => [
                      key,
                      typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value),
                    ]),
                  ),
                };
              }
              const result = await fetch(url, init);
              response = {
                status: result.status,
                type: result.type,
                readable: !!(await result.clone().json()),
              };
              return result;
            },
          },
        );
        try {
          await api.getMe();
        } catch (error) {
          results.push({
            encoding,
            response,
            errorType: error.name,
            code: error.error_code,
          });
        }
      }
      return results;
    }, { authenticated, token }),
  ));
} catch {
  // Browser tooling exceptions can contain evaluate arguments; never print them.
  console.error(
    "Browser probe failed; details suppressed to protect credentials.",
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.close();
}
