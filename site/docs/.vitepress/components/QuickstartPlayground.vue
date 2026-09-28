<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{ url: string }>();
const active = ref(false);
watch(() => props.url, () => active.value = false);
</script>

<template>
  <div class="quickstart-playground">
    <div v-if="!active"><slot /></div>
    <button type="button" @click="active = !active" :aria-expanded="active">
      {{ active ? "Close playground" : "Edit and run in your browser" }}
    </button>
    <template v-if="active">
      <p class="instructions">
        Edit the reply, then press Run (or Shift+Enter) to send a simulated message.
        This TypeScript demo uses grammY with simulated Telegram replies and needs
        no bot token. Only text replies are supported. Closing resets your edits.
      </p>
      <iframe
        :src="url"
        title="Editable grammY quickstart"
        sandbox="allow-same-origin allow-scripts allow-downloads"
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
.quickstart-playground button {
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 6px;
  padding: 6px 12px;
  margin: 8px 0;
  color: var(--vp-c-brand-1);
}
.quickstart-playground button:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 3px;
}
.quickstart-playground iframe {
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
