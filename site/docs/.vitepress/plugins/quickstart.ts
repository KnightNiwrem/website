import type MarkdownIt from "$types/markdown-it";
import { readFileSync } from "node:fs";
import { getPlaygroundUrl } from "livecodes";

const harness = readFileSync(
  new URL("../shared/quickstart-demo.js", import.meta.url),
  "utf8",
);

// Keep the handler in Markdown as the single source for the copyable and live
// examples. Only the token and polling setup differs in this browser demo.
export function demoSource(source: string): string {
  const setup = /const bot = new Bot\(""\);[^\n]*/;
  const start = /bot\.start\(\);\s*$/;
  if (
    !source.startsWith('import { Bot } from "grammy";\n') ||
    !setup.test(source) || !start.test(source)
  ) {
    throw new Error("Quickstart demo needs an empty-token Bot and bot.start()");
  }
  return source
    .replace(
      'import { Bot } from "grammy";',
      'import { createDemo } from "@grammy/docs-demo";',
    )
    .replace(setup, "const { bot, send } = createDemo();")
    .replace(
      start,
      '// Send a simulated message to your bot. No token needed.\nawait send("Hello!");\n',
    );
}

export function quickstart(md: MarkdownIt) {
  const open = md.renderer.rules["container_code-group_open"]!;
  const close = md.renderer.rules["container_code-group_close"]!;
  md.renderer.rules["container_code-group_open"] = (
    tokens,
    idx,
    options,
    env,
    self,
  ) => {
    if (tokens[idx].info.trim() !== "code-group quickstart") {
      return open(tokens, idx, options, env, self);
    }
    const end = tokens.findIndex((token, i) =>
      i > idx && token.type === "container_code-group_close" &&
      token.level === tokens[idx].level
    );
    const source = tokens.slice(idx + 1, end).find((token) =>
      token.type === "fence"
    )?.content;
    if (!source || end < 0) throw new Error("Quickstart needs a code group");
    tokens[end].meta = { quickstart: true };
    const url = getPlaygroundUrl({
      appUrl: "https://v49.livecodes.io",
      loading: "eager", // The component creates the iframe only after activation.
      params: { embed: true },
      config: {
        mode: "simple",
        activeEditor: "script",
        editor: "codemirror",
        wordWrap: true,
        autoupdate: false,
        autosave: false,
        recoverUnsaved: false,
        tools: { enabled: ["console"], active: "console", status: "full" },
        script: { language: "typescript", content: demoSource(source) },
        imports: {
          grammy: "https://cdn.jsdelivr.net/npm/grammy@1.46.0/out/web.mjs",
          "@grammy/docs-demo": `data:text/javascript;base64,${btoa(harness)}`,
        },
        types: {
          grammy: "https://cdn.jsdelivr.net/npm/grammy@1.46.0/out/mod.d.ts",
          "@grammy/docs-demo": {
            url: `data:text/plain;base64,${
              btoa(
                'import { Bot } from "grammy";\nexport function createDemo(): { bot: Bot; send(text: string): Promise<void> };',
              )
            }`,
            declareAsModule: true,
          },
        },
      },
    });
    return `<QuickstartPlayground url="${md.utils.escapeHtml(url)}">\n` +
      open(tokens, idx, options, env, self);
  };
  md.renderer.rules["container_code-group_close"] = (
    tokens,
    idx,
    options,
    env,
    self,
  ) =>
    close(tokens, idx, options, env, self) +
    (tokens[idx].meta?.quickstart ? "</QuickstartPlayground>\n" : "");
}
