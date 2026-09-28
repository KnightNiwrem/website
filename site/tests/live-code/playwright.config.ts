import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: "/tmp/grammy-live-test-results",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    launchOptions: {
      executablePath: process.env.GRAMMY_TEST_BROWSER || undefined,
    },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: [
    {
      command: "deno -A npm:vitepress serve docs --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173",
      cwd: "../..",
    },
    {
      command:
        "deno -A npm:vitepress serve tests/live-code/fixture --host 127.0.0.1 --port 4174",
      url: "http://127.0.0.1:4174",
      cwd: "../..",
    },
  ],
});
