<script setup lang="ts">
// Makes the code blocks in its slot editable and runnable. A code group's
// tabs are alternatives, so Run only runs the active tab.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import type { Editor } from "./editor.ts";
import type { Format, Language } from "./prepare.ts";
import type { FromWorker, ToWorker } from "./worker.ts";
import { GRAMMY_VERSION } from "./version.ts";
import css from "./LiveCode.scss?inline";

const props = withDefaults(defineProps<{
  /** Module format of JavaScript fences. TypeScript always runs as ESM. */
  jsFormat?: Format;
}>(), { jsFormat: "esm" });

interface Block {
  el: HTMLElement;
  code: HTMLElement;
  label: string;
  language: Language;
  original: string;
  editor?: Editor;
}
interface Entry {
  level: "log" | "info" | "warn" | "error" | "status";
  text: string;
}

const root = shallowRef<HTMLElement>();
const blocks = shallowRef<Block[]>([]);
// Code shown in each block
const sources = ref<string[]>([]);
const activeIndex = ref(0);
const editing = ref(false);
const output = ref<Entry[]>([]);
// What the worker runs, if it runs
const running = ref<{ index: number; source: string }>();
// Changes when undo or redo may have become possible or impossible
const historyTick = ref(0);
let worker: Worker | undefined;
let observer: MutationObserver | undefined;

const active = computed(() => blocks.value[activeIndex.value]);
const can = (offset: -1 | 1) =>
  historyTick.value >= 0 && !!active.value?.editor?.can(offset);
const changed = computed(() =>
  sources.value[activeIndex.value] !== active.value?.original
);
const stale = computed(() =>
  running.value !== undefined &&
  (running.value.index !== activeIndex.value ||
    running.value.source !== sources.value[activeIndex.value])
);

function languageOf(className: string): Language | undefined {
  const name = /(?:^|\s)language-(\w+)/.exec(className)?.[1];
  if (name === "ts" || name === "typescript") return "ts";
  if (name === "js" || name === "javascript") return "js";
  return undefined;
}

/** Returns what VitePress's copy button copies. */
function textOf(pre: HTMLElement) {
  const clone = pre.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".vp-copy-ignore, .diff.remove").forEach((n) =>
    n.remove()
  );
  return clone.textContent ?? "";
}

onMounted(() => {
  if (!document.getElementById("live-code-style")) {
    const style = document.createElement("style");
    style.id = "live-code-style";
    style.textContent = css;
    document.head.append(style);
  }
  const found: Block[] = [];
  for (
    const el of root.value!.querySelectorAll<HTMLElement>(
      'div[class*="language-"]',
    )
  ) {
    const pre = el.querySelector<HTMLElement>(":scope > pre");
    const code = pre?.querySelector("code");
    const language = languageOf(el.className);
    if (!pre || !code || !language) continue;
    // In a code group, blocks are in the same order as the tab labels.
    const group = el.closest(".vp-code-group");
    const tab = group?.querySelectorAll(".tabs label")[
      [...el.parentElement!.children].indexOf(el)
    ];
    found.push({
      el,
      code,
      label: tab?.textContent?.trim() ||
        (language === "ts" ? "TypeScript" : "JavaScript"),
      language,
      original: textOf(pre),
    });
  }
  blocks.value = found;
  sources.value = found.map((b) => b.original);
  // Code groups switch tabs by moving the `active` class.
  const update = () => {
    activeIndex.value = Math.max(
      0,
      found.findIndex((b) => b.el.classList.contains("active")),
    );
  };
  update();
  observer = new MutationObserver(update);
  for (const b of found) {
    observer.observe(b.el, { attributes: true, attributeFilter: ["class"] });
  }
});

onBeforeUnmount(() => {
  worker?.terminate();
  observer?.disconnect();
  for (const b of blocks.value) b.editor?.destroy();
});

async function edit() {
  editing.value = true;
  const { mountEditor } = await import("./editor.ts");
  blocks.value.forEach((b, i) => {
    const host = document.createElement("div");
    host.className = "live-code-editor";
    b.code.parentElement!.after(host);
    b.editor = mountEditor(host, {
      value: sources.value[i],
      typescript: b.language === "ts",
      label: `${b.label} code`,
      onChange(value) {
        sources.value[i] = value;
        // The copy button copies the hidden code block.
        b.code.textContent = value;
      },
      onHistory: () => historyTick.value++,
    });
    b.el.classList.add("live-code-editing");
  });
  active.value?.editor?.focus();
}

function go(offset: -1 | 1) {
  active.value?.editor?.go(offset);
  historyTick.value++;
}

function log(level: Entry["level"], text: string) {
  output.value.push({ level, text });
  if (output.value.length > 200) output.value.shift();
}

function end(message: string) {
  worker?.terminate();
  worker = undefined;
  running.value = undefined;
  log("status", message);
}

function run() {
  const index = activeIndex.value;
  const block = blocks.value[index];
  const source = sources.value[index];
  worker?.terminate();
  output.value = [];
  running.value = { index, source };
  log("status", `Running the ${block.label} code.`);
  const current = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
    name: "grammY live example",
  });
  worker = current;
  current.onmessage = ({ data }: MessageEvent<FromWorker>) => {
    if (data.type === "log") {
      log(data.level, data.text);
      return;
    }
    const at = data.line === undefined
      ? ""
      : `line ${data.line}${data.column === undefined ? "" : `:${data.column}`}: `;
    log("error", `${block.label}, ${at}${data.text}`);
    end("Stopped because of the uncaught error.");
  };
  current.onerror = (event) => {
    event.preventDefault();
    end(`The example could not be started: ${event.message}`);
  };
  current.postMessage({
    source,
    language: block.language,
    format: block.language === "js" ? props.jsFormat : "esm",
  } satisfies ToWorker);
}
</script>

<template>
  <div ref="root" class="live-code">
    <slot />
    <div v-if="blocks.length > 0" class="live-code-panel">
      <button v-if="!editing" type="button" class="live-code-primary" @click="edit">
        Edit and run this example
      </button>
      <template v-else>
        <!-- Keeping the focus in the editor keeps the keyboard open on phones. -->
        <div class="live-code-buttons">
          <button type="button" :disabled="!can(-1)" @mousedown.prevent @click="go(-1)">
            Undo
          </button>
          <button type="button" :disabled="!can(1)" @mousedown.prevent @click="go(1)">
            Redo
          </button>
          <button
            type="button"
            :disabled="!changed"
            @mousedown.prevent
            @click="active?.editor?.replace(active.original)"
          >
            Reset
          </button>
        </div>
        <p class="live-code-note">
          Runs in your browser with grammY {{ GRAMMY_VERSION }} and talks to
          Telegram directly. Put the token of a test bot between the quotes in
          <code>new Bot("")</code>; the Copy button then copies it, too. The
          code can read the token, and <code>bot.start()</code> deletes the
          bot's webhook. On a phone, your browser may pause this page while
          you are in Telegram; the bot catches up when you come back.
        </p>
        <div class="live-code-buttons">
          <button type="button" class="live-code-primary live-code-run" @click="run">
            Run {{ active?.label }}
          </button>
          <button
            type="button"
            class="live-code-stop"
            :disabled="running === undefined"
            @click="end('Stopped.')"
          >
            Stop
          </button>
        </div>
        <p v-if="stale" class="live-code-stale">
          The running code differs from the code shown. Run it again to use
          the code shown.
        </p>
        <ol v-if="output.length > 0" class="live-code-output" aria-live="polite">
          <li v-for="(entry, i) in output" :key="i" :class="entry.level">
            {{ entry.text }}
          </li>
        </ol>
      </template>
    </div>
  </div>
</template>
