import { defineConfig } from "vitepress";
import { markdown } from "../../../../docs/.vitepress/plugins/markdown.ts";

export default defineConfig({
  title: "Live example regression fixture",
  cleanUrls: true,
  markdown: { lineNumbers: true, config: markdown },
  vite: { worker: { format: "es" } },
});
