<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import type { PrismEditor } from "prism-code-editor";
import { mountEditor } from "./editor.ts";
import { createRun } from "./runner.ts";
import type { Example, WorkerEvent } from "./protocol.ts";

const props = defineProps<{ examples: Example[] }>();
const id = useId();
const hosts = ref<HTMLElement[]>([]);
const active = ref(0);
const sources = ref(props.examples.map((e) => e.source));
const token = ref("");
const state = ref("Ready");
const busy = ref(false);
const stopping = ref(false);
const output = ref<string[]>([]);
const username = ref("");
const editors: PrismEditor[] = [];
const revision = ref<{ index: number; source: string }>();
const changed = computed(() => busy.value && revision.value &&
  (revision.value.index !== active.value || revision.value.source !== sources.value[active.value]));
let run: ReturnType<typeof createRun> | undefined;
let disposed = false;

onMounted(() => {
  props.examples.forEach((example, index) => {
    editors[index] = mountEditor(hosts.value[index], example.source, example.language,
      (value) => sources.value[index] = value);
  });
  addEventListener("pagehide", leave);
});
onBeforeUnmount(() => {
  disposed = true;
  leave();
  removeEventListener("pagehide", leave);
  editors.forEach((editor) => { editor.textarea.blur(); editor.remove(); });
  token.value = "";
});
function leave() { void stop(); }

function receive(event: WorkerEvent) {
  if (disposed) return;
  if (event.type === "running") {
    state.value = "Running";
    username.value = /^[a-zA-Z0-9_]+$/.test(event.username) ? event.username : "";
  } else if (event.type === "executed" && state.value === "Starting…") {
    state.value = "Code executed";
  } else if (event.type === "error") {
    state.value = "Error";
    busy.value = false;
    output.value = [...output.value, event.text].slice(-30);
  } else if (event.type === "log") {
    output.value = [...output.value, event.text].slice(-30);
  }
}
async function start() {
  if (busy.value || stopping.value) return;
  busy.value = true;
  state.value = "Starting…";
  output.value = [];
  username.value = "";
  await run?.stop();
  if (disposed || !busy.value) return;
  revision.value = { index: active.value, source: sources.value[active.value] };
  run = createRun(revision.value.source, props.examples[active.value].language,
    props.examples[active.value].format, token.value.trim(), receive);
  void run.start();
}
async function stop() {
  stopping.value = true;
  busy.value = false;
  state.value = "Stopping…";
  await run?.stop();
  state.value = "Stopped";
  stopping.value = false;
  username.value = "";
}
async function copy() {
  try {
    await navigator.clipboard.writeText(sources.value[active.value]);
    output.value = [...output.value.slice(-29), "Copied current source."];
  } catch {
    output.value = [...output.value.slice(-29), "Copy unavailable. Select and copy the source in the editor."];
  }
}
</script>

<template>
  <section aria-label="Live grammY example" class="live-editor">
    <div class="live-actions" aria-label="Example alternatives">
      <button v-for="(example, index) in examples" :key="index"
        :aria-pressed="active === index" @click="active = index">
        {{ example.label }}
      </button>
    </div>
    <div v-for="(_, index) in examples" v-show="active === index" :key="index"
      :ref="(el) => { if (el) hosts[index] = el as HTMLElement; }" />
    <div class="live-actions">
      <button @click="copy">Copy source</button>
      <button @click="editors[active].extensions.history?.go(-1)">Undo</button>
      <button @click="editors[active].extensions.history?.go(1)">Redo</button>
      <button @click="editors[active].setOptions({ value: examples[active].source })">Reset source</button>
    </div>
    <p>
      Use a dedicated test bot from <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">BotFather</a>.
      Leave <code>new Bot("")</code> empty: this browser runner supplies the token below.
      Run connects directly to Telegram using grammY 1.46.0.
      Bots with an existing webhook are refused; webhook changes and dropping pending updates are disabled here.
    </p>
    <label :for="`${id}-token`">Test bot token</label>
    <input :id="`${id}-token`" v-model="token" type="password" autocomplete="off"
      autocapitalize="off" spellcheck="false" :disabled="busy || stopping" />
    <p class="live-note">
      The token and edits stay in memory. Code you run can read the token; only run code you trust.
      Avoid pasting tokens into source or sharing network logs.
    </p>
    <div class="live-actions">
      <button :disabled="!token.trim() || busy || stopping" @click="start">Run</button>
      <button :disabled="!busy || stopping" @click="stop">Stop</button>
      <span role="status">{{ state }}</span>
      <a v-if="username && busy" :href="`https://t.me/${username}`" target="_blank" rel="noreferrer">Open bot in Telegram</a>
    </div>
    <p v-if="changed" role="status">The previous revision is still running. Stop and Run to use the displayed source.</p>
    <p class="live-note">
      Keep this page open, switch to Telegram, and send your bot a message.
      Phones may pause this page in the background; return here if the reply is delayed.
      If polling does not recover, Stop and Run again. This page cannot reliably host a bot in the background.
      Stop cannot undo requests Telegram already processed; interrupted updates may repeat on restart.
    </p>
    <pre v-if="output.length" class="live-output" aria-label="Run output" aria-live="polite">{{ output.join("\n") }}</pre>
  </section>
</template>

<style scoped>
.live-editor { margin: 16px 0; }
.live-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0; }
button[aria-pressed="true"] { border-color: var(--vp-c-brand-1); }
input { display: block; width: 100%; padding: 10px; border: 1px solid var(--vp-c-divider); border-radius: 6px; font-size: 16px; }
.live-note { color: var(--vp-c-text-2); font-size: 14px; }
.live-output { max-height: 16rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; background: var(--vp-c-bg-soft); }
</style>
