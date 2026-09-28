import type MarkdownIt from "$types/markdown-it";
import { betterLineBreaks } from "./index.ts";
import { playground } from "./playground.ts";

export const markdown = (md: MarkdownIt) => {
  md.use(betterLineBreaks);
  md.use(playground);
};
