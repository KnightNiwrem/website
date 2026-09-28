<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import type { Example } from "./protocol.ts";

const root = ref<HTMLElement>();
const ready = ref(false);
const loading = ref(false);
const error = ref("");
const editor = shallowRef();
const examples = ref<Example[]>([]);
let disposed = false;
onMounted(() => ready.value = true);
onBeforeUnmount(() => disposed = true);

async function activate() {
  loading.value = true;
  error.value = "";
  try {
    // Read the rendered fences, including their original text and tab labels.
    // The wrapper works on any page and never assumes a particular bot variable.
    const labels = root.value!.querySelectorAll(".vp-code-group .tabs label");
    examples.value = Array.from(root.value!.querySelectorAll("pre > code"))
      .map((code, i) => ({
        source: code.textContent ?? "",
        language: code.closest("[class*='language-']")?.className
            .match(/language-(\w+)/)?.[1] ?? "ts",
        label: labels[i]?.textContent?.trim() || `Example ${i + 1}`,
      }));
    if (!examples.value.length) throw new Error("No code fences found.");
    const module = await import("./LiveEditor.vue");
    if (!disposed) editor.value = module.default;
  } catch {
    error.value = "The editor could not load. Please try again.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div ref="root" class="live-code">
    <div v-show="!editor"><slot /></div>
    <button v-if="ready && !editor" :disabled="loading" @click="activate">
      {{ loading ? "Loading editor…" : "Edit and run" }}
    </button>
    <p v-if="error" role="alert">{{ error }}</p>
    <component :is="editor" v-if="editor" :examples="examples" />
  </div>
</template>

<style>
.live-code button {
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  padding: 8px 14px;
  min-height: 44px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
}
.live-code button:disabled { opacity: .5; cursor: default; }
.live-code button:focus-visible, .live-code input:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
</style>
