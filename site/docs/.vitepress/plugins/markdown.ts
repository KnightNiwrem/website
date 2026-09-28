import type MarkdownIt from "$types/markdown-it";
import { betterLineBreaks } from "./index.ts";
import { quickstart } from "./quickstart.ts";

export const markdown = (md: MarkdownIt) => {
  md.use(betterLineBreaks);
  md.use(quickstart);
};
