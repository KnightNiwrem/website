<script lang="ts">
import { ref } from "vue";

// Shared by all live examples on the site, and only kept in memory: it is
// never persisted, put into a URL or sent anywhere but to Telegram.
const token = ref("");
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from "vue";
import type { EditorHandle } from "./editor.ts";
import { GRAMMY_VERSION, type Language, languageOf } from "./protocol.ts";
import { addStyle } from "./style.ts";
import css from "./LiveCode.scss?inline";
import type { Session } from "./session.ts";


interface Block {
  el: HTMLElement;
  code: HTMLElement;
  label: string;
  language: Language;
  original: string;
  originalHTML: string;
  editor?: EditorHandle;
}
interface Entry {
  level: "log" | "info" | "warn" | "error" | "status";
  text: string;
}

const MAX_ENTRIES = 200;
const TOKEN_SHAPE = /^\d+:[\w-]{30,}$/;

const root = shallowRef<HTMLElement>();
const blocks = shallowRef<Block[]>([]);
const sources = ref<string[]>([]);
const activeIndex = ref(0);
const opened = ref(false);
const state = ref<"idle" | "starting" | "running" | "stopping">("idle");
const polling = ref<string[]>([]);
const output = ref<Entry[]>([]);
const running = ref<{ index: number; source: string }>();
const webhook = ref<
  { host: string; pending: number; answer(ok: boolean): void }
>();
let session: Session | undefined;
// Incremented by every run and stop, so that a slower earlier call can tell
// that it was superseded while it was waiting.
let runs = 0;
let observer: MutationObserver | undefined;
let hiddenAt: number | undefined;

const active = computed(() => blocks.value[activeIndex.value]);
// Changes whenever the edit history of an editor changes.
const historyTick = ref(0);
const canUndo = computed(() => historyTick.value >= 0 && active.value?.editor?.can(-1));
const canRedo = computed(() => historyTick.value >= 0 && active.value?.editor?.can(1));
const edited = computed(() =>
  active.value !== undefined &&
  sources.value[activeIndex.value] !== active.value.original
);
const stale = computed(() =>
  running.value !== undefined && state.value !== "idle" &&
  (running.value.index !== activeIndex.value ||
    running.value.source !== sources.value[activeIndex.value])
);
const tokenWarning = computed(() =>
  token.value.trim() !== "" && !TOKEN_SHAPE.test(token.value.trim())
);

/** Same text as VitePress's copy button would copy. */
function textOf(pre: HTMLElement) {
  const clone = pre.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".vp-copy-ignore, .diff.remove").forEach((n) =>
    n.remove()
  );
  return clone.textContent ?? "";
}

function findBlocks(el: HTMLElement): Block[] {
  const found: Block[] = [];
  for (const block of el.querySelectorAll<HTMLElement>('div[class*="language-"]')) {
    const pre = block.querySelector<HTMLElement>(":scope > pre");
    const code = pre?.querySelector<HTMLElement>("code");
    const language = languageOf(block.className);
    if (!pre || !code || !language) continue;
    // Inside a code group, the tab label names the block.
    const group = block.closest(".vp-code-group");
    const index = group ? [...block.parentElement!.children].indexOf(block) : -1;
    const tab = group?.querySelectorAll(".tabs label")[index];
    const label = tab?.textContent?.trim() ||
      (language === "ts" ? "TypeScript" : "JavaScript");
    const original = textOf(pre);
    found.push({
      el: block,
      code,
      label,
      language,
      original,
      originalHTML: code.innerHTML,
    });
  }
  return found;
}

function updateActive() {
  const i = blocks.value.findIndex((b) => b.el.classList.contains("active"));
  activeIndex.value = Math.max(i, 0);
}

onMounted(() => {
  if (!root.value) return;
  addStyle("live-code", css);
  blocks.value = findBlocks(root.value);
  sources.value = blocks.value.map((b) => b.original);
  updateActive();
  // Code group tabs are switched by VitePress by moving the `active` class.
  observer = new MutationObserver(updateActive);
  for (const b of blocks.value) {
    observer.observe(b.el, { attributes: true, attributeFilter: ["class"] });
  }
  // VitePress's copy button copies the hidden <pre>, so update it first.
  root.value.addEventListener("click", syncCopiedText, true);
  document.addEventListener("visibilitychange", onVisibilityChange);
});

onBeforeUnmount(() => {
  runs++;
  observer?.disconnect();
  document.removeEventListener("visibilitychange", onVisibilityChange);
  session?.stop("Stopped, because you left the page.");
  for (const b of blocks.value) b.editor?.destroy();
});

function syncCopiedText(event: Event) {
  const button = (event.target as Element).closest?.("button.copy");
  const block = blocks.value.find((b) => b.el.contains(button));
  if (!button || !block?.editor) return;
  if (block.editor.value === block.original) {
    block.code.innerHTML = block.originalHTML;
  } else {
    block.code.textContent = block.editor.value;
  }
}

async function open() {
  opened.value = true;
  const { mountEditor } = await import("./editor.ts");
  blocks.value.forEach((b, i) => {
    const host = document.createElement("div");
    host.className = "live-code-editor";
    b.code.parentElement!.after(host);
    b.editor = mountEditor(
      host,
      sources.value[i],
      b.language,
      `${b.label} code of this example`,
      (value) => sources.value[i] = value,
      () => historyTick.value++,
    );
    b.el.classList.add("live-code-editing");
  });
  active.value?.editor?.focus();
}

function go(offset: -1 | 1) {
  active.value?.editor?.go(offset);
  historyTick.value++;
}

function reset() {
  active.value?.editor?.setValue(active.value.original);
}

function log(level: Entry["level"], text: string) {
  output.value.push({ level, text });
  if (output.value.length > MAX_ENTRIES) output.value.shift();
}

async function run() {
  const id = ++runs;
  const index = activeIndex.value;
  const block = blocks.value[index];
  if (!block) return;
  const source = sources.value[index];
  state.value = "starting";
  await session?.stop("Restarted with the current code.");
  const { Session } = await import("./session.ts");
  if (id !== runs) return;
  output.value = [];
  polling.value = [];
  state.value = "starting";
  running.value = { index, source };
  const current: Session = new Session(source, block.language, token.value.trim(), {
    log(level, text, at) {
      if (at?.line !== undefined) {
        text = `${block.label}, line ${at.line}${
          at.column !== undefined ? `:${at.column}` : ""
        }: ${text}`;
      }
      log(level, text);
    },
    evaluated() {
      if (state.value === "starting") state.value = "running";
    },
    polling(username, on) {
      state.value = "running";
      polling.value = on
        ? [...new Set([...polling.value, username])]
        : polling.value.filter((u) => u !== username);
      log(
        "status",
        on ? `@${username} is waiting for messages.` : `@${username} stopped.`,
      );
    },
    confirmWebhook(host, pending) {
      return new Promise((resolve) => {
        webhook.value = {
          host,
          pending,
          answer(ok) {
            webhook.value = undefined;
            resolve(ok);
          },
        };
      });
    },
    ended(reason) {
      webhook.value?.answer(false);
      log("status", reason);
      if (session === current) {
        session = undefined;
        state.value = "idle";
        polling.value = [];
      }
    },
  });
  session = current;
}

function stop() {
  runs++;
  if (session === undefined) {
    state.value = "idle";
    return;
  }
  state.value = "stopping";
  session.stop();
}

function onVisibilityChange() {
  if (session === undefined) return;
  if (document.hidden) {
    hiddenAt = Date.now();
  } else if (hiddenAt !== undefined) {
    const seconds = Math.round((Date.now() - hiddenAt) / 1000);
    hiddenAt = undefined;
    if (seconds >= 5) {
      log(
        "info",
        `Welcome back after ${seconds} s. If your browser paused this page in the meantime, the bot is catching up on messages now.`,
      );
    }
  }
}

const statusText = computed(() => {
  switch (state.value) {
    case "starting":
      return "Starting…";
    case "stopping":
      return "Stopping…";
    case "running":
      return polling.value.length > 0
        ? "Running. Send your bot a message in Telegram."
        : "Running.";
    default:
      return "Not running.";
  }
});
</script>

<template>
  <div ref="root" class="live-code">
    <slot />
    <div v-if="blocks.length > 0" class="live-code-panel">
        <button v-if="!opened" type="button" class="live-code-open" @click="open">
          Edit and run this example
        </button>
        <template v-else>
          <div class="live-code-actions">
            <!-- Keep the focus in the editor, so that phones keep the keyboard open. -->
            <button
              type="button"
              :disabled="!canUndo"
              @mousedown.prevent
              @click="go(-1)"
            >
              Undo
            </button>
            <button
              type="button"
              :disabled="!canRedo"
              @mousedown.prevent
              @click="go(1)"
            >
              Redo
            </button>
            <button type="button" :disabled="!edited" @click="reset">
              Reset code
            </button>
          </div>
          <p class="live-code-note">
            Runs in your browser with grammY {{ GRAMMY_VERSION }} and talks to
            Telegram directly. Use a test bot: the code can read the token, and
            <code>bot.start()</code> removes a webhook. The token stays in this
            page's memory. On a phone, your browser may pause this page while
            you are in Telegram; the bot catches up when you come back.
          </p>
          <label class="live-code-token">
            <span>Bot token for <code>new Bot("")</code></span>
            <input
              v-model="token"
              type="password"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="123456:ABC-DEF…"
            />
          </label>
          <p v-if="tokenWarning" class="live-code-warning">
            This does not look like a bot token from @BotFather.
          </p>
          <div class="live-code-actions">
            <button type="button" class="live-code-run" @click="run">
              {{ state === "idle" ? "Run" : "Restart" }} {{ active?.label }}
            </button>
            <button
              type="button"
              class="live-code-stop"
              :disabled="state === 'idle' || state === 'stopping'"
              @click="stop"
            >
              Stop
            </button>
          </div>
          <p class="live-code-status" role="status">
            {{ statusText }}
            <template v-for="username in polling" :key="username">
              <a :href="`https://t.me/${username}`" target="_blank" rel="noreferrer">
                Open @{{ username }}
              </a>
            </template>
          </p>
          <p v-if="stale" class="live-code-warning">
            The running bot uses different code than shown above. Restart to
            apply your changes.
          </p>
          <div v-if="webhook" class="live-code-confirm" role="alertdialog">
            <p>
              This bot has a webhook on {{ webhook.host }}.
              <code>bot.start()</code> will delete it, so that server stops
              receiving updates until the webhook is set again.
              <template v-if="webhook.pending > 0">
                {{ webhook.pending }} pending updates will be delivered to this
                example.
              </template>
            </p>
            <button type="button" @click="webhook.answer(true)">
              Delete webhook and start
            </button>
            <button type="button" @click="webhook.answer(false)">Cancel</button>
          </div>
          <ol v-if="output.length > 0" class="live-code-output" aria-live="polite">
            <li v-for="(entry, i) in output" :key="i" :class="entry.level">
              {{ entry.text }}
            </li>
          </ol>
        </template>
    </div>
  </div>
</template>
