<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{ url: string }>();
const active = ref(false);
watch(() => props.url, () => active.value = false);
</script>

<template>
  <div class="code-playground">
    <div v-if="!active"><slot /></div>
    <button type="button" @click="active = !active" :aria-expanded="active">
      {{ active ? "Stop and close playground" : "Edit and run in your browser" }}
    </button>
    <template v-if="active">
      <p class="instructions">
        Edit the example and press Run (or Shift+Enter).
        Results and errors appear in the console.
        For bot examples, create a test bot with <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">BotFather</a>,
        paste its token into the code, and message your bot in Telegram after running it.
        Keep this page open. Run restarts the example.
        Stop and close ends execution and discards your edits.
      </p>
      <p class="instructions">
        Use a bot that is not already running elsewhere. The token is accessible
        to the LiveCodes editor and the code you run. Do not share or export code
        containing your token. Automatic saving is disabled.
      </p>
      <iframe
        :src="url"
        title="Editable grammY example"
        sandbox="allow-same-origin allow-scripts"
        referrerpolicy="no-referrer"
      />
      <p class="provider">
        Powered by <a href="https://livecodes.io" target="_blank" rel="noreferrer">LiveCodes</a>.
        If the editor does not load, close it to return to the example.
      </p>
    </template>
  </div>
</template>

<style scoped>
.code-playground button {
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 6px;
  padding: 6px 12px;
  margin: 8px 0;
  color: var(--vp-c-brand-1);
}
.code-playground button:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 3px;
}
.code-playground iframe {
  width: 100%;
  height: 540px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
}
.instructions,
.provider {
  font-size: 14px;
  line-height: 1.6;
}
</style>
