import DefaultTheme from "vitepress/theme";
import LiveCode from "../../../../../docs/.vitepress/live-code/LiveCode.vue";
export default {
  ...DefaultTheme,
  enhanceApp({ app }) {
    app.component("LiveCode", LiveCode);
  },
};
