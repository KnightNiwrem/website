import { createMarkdownRenderer } from "vitepress";
import { demoSource, quickstart } from "./quickstart.ts";

const homepage = Deno.readTextFileSync(
  new URL("../../README.md", import.meta.url),
);
const codeGroup = homepage.match(/::: code-group quickstart[\s\S]*?\n:::/)![0];
const source = codeGroup.match(/```ts \[TypeScript\]\n([\s\S]*?)```/)![1];

Deno.test("Quickstart preserves authored handlers and fails if setup drifts", () => {
  const edited = source.replaceAll("Hi there!", "New reply!");
  const demo = demoSource(edited);
  if (
    !demo.includes('ctx.reply("New reply!")') ||
    !demo.includes('await send("Hello!");') || demo.includes("bot.start()") ||
    demo.includes("BotFather")
  ) throw new Error("Incorrect runnable source");
  for (
    const invalid of [
      source.replace('"grammy"', '"other"'),
      source.replace('new Bot("")', 'new Bot("TOKEN")'),
      source.replace("bot.start();", ""),
    ]
  ) {
    let threw = false;
    try {
      demoSource(invalid);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("Unsupported setup must fail at build time");
  }
});

Deno.test("Only marked code group gets one playground; static rendering is unchanged", async () => {
  const md = await createMarkdownRenderer(".", {
    lineNumbers: true,
    config: quickstart,
  });
  const env = { path: "README.md", relativePath: "README.md" };
  const plain = md.render(
    codeGroup.replace("code-group quickstart", "code-group"),
    env,
  );
  const marked = md.render(codeGroup, env);
  if (
    (marked.match(/<QuickstartPlayground /g) || []).length !== 1 ||
    !marked.includes("</QuickstartPlayground>") ||
    marked.match(/class="copy"/g)?.length !== 3 ||
    !marked.includes("line-numbers-wrapper") ||
    plain.includes("QuickstartPlayground")
  ) throw new Error("Code group integration changed static controls");
  // Strip randomized tab IDs before comparing the original code-group HTML.
  const normalize = (html: string) =>
    html.replace(/<\/?QuickstartPlayground[^>]*>\n/g, "")
      .replace(/(?:group|tab)-[\w-]+/g, "random-id");
  if (normalize(plain) !== normalize(marked)) {
    throw new Error("Copyable code-group markup changed");
  }
  if (
    md.render("```sh\nnpm install grammy\n```", env).includes(
      "QuickstartPlayground",
    )
  ) {
    throw new Error("Playground leaked to an unmarked block");
  }
});
