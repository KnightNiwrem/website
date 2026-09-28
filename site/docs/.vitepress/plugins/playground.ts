import type MarkdownIt from "$types/markdown-it";
import { readFileSync } from "node:fs";
import { getPlaygroundUrl } from "livecodes";

const moduleUrl = (file: string) =>
  `data:text/javascript;base64,${
    btoa(readFileSync(new URL(file, import.meta.url), "utf8"))
  }`;

export function playground(md: MarkdownIt) {
  const open = md.renderer.rules["container_code-group_open"]!;
  const close = md.renderer.rules["container_code-group_close"]!;
  md.renderer.rules["container_code-group_open"] = (
    tokens,
    idx,
    options,
    env,
    self,
  ) => {
    if (tokens[idx].info.trim() !== "code-group playground") {
      return open(tokens, idx, options, env, self);
    }
    const end = tokens.findIndex((token, i) =>
      i > idx && token.type === "container_code-group_close" &&
      token.level === tokens[idx].level
    );
    const fence = tokens.slice(idx + 1, end).find((token) =>
      token.type === "fence"
    );
    if (!fence?.content || end < 0) {
      throw new Error("Playground needs a code group with a runnable example");
    }
    const language = fence.info.trim().split(/\s+/)[0];
    if (!["js", "javascript", "ts", "typescript"].includes(language)) {
      throw new Error(
        "Playground's first fence must be JavaScript or TypeScript",
      );
    }
    tokens[end].meta = { playground: true };
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
        // Each group uses its first fence verbatim as a standalone program.
        script: {
          language: ["js", "javascript"].includes(language)
            ? "javascript"
            : "typescript",
          content: fence.content,
        },
        imports: {
          grammy: moduleUrl("../shared/browser-grammy.js"),
          "@grammy/browser":
            "https://cdn.jsdelivr.net/npm/grammy@1.46.0/out/web.mjs",
          "@grammy/browser-fetch": moduleUrl("../shared/telegram-fetch.js"),
        },
        types: {
          grammy: "https://cdn.jsdelivr.net/npm/grammy@1.46.0/out/mod.d.ts",
        },
      },
    });
    return `<CodePlayground url="${md.utils.escapeHtml(url)}">\n` +
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
    (tokens[idx].meta?.playground ? "</CodePlayground>\n" : "");
}
