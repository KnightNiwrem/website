import DefaultTheme from "vitepress/theme-without-fonts";
import type { EnhanceAppContext } from "vitepress";
import { defineAsyncComponent } from "vue";

export default {
  ...DefaultTheme,
  enhanceApp(ctx: EnhanceAppContext) {
    // Registered like in the documentation's theme.
    ctx.app.component(
      "LiveCode",
      defineAsyncComponent(() =>
        import(
          "../../../../../docs/.vitepress/components/live-code/LiveCode.vue"
        )
      ),
    );
  },
};
