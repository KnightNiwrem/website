// Test site for live code blocks, built separately from the documentation:
//   deno -A npm:vitepress build tests/live-code/fixture
import { defineConfig } from "vitepress";
import { markdown } from "../../../../docs/.vitepress/plugins/index.ts";

export default defineConfig({
  title: "Live code fixture",
  cleanUrls: true,
  markdown: { lineNumbers: true, typographer: true, config: markdown },
  vite: {
    css: { preprocessorOptions: { scss: { api: "modern-compiler" } } },
  },
});
