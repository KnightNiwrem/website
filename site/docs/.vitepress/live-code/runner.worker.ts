/// <reference lib="webworker" />
import { redact } from "./protocol.ts";
import type { WorkerCommand, WorkerEvent } from "./protocol.ts";

let token = "";
let stopping = false;
const urls: string[] = [];
const moduleUrl = (source: string) => {
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  urls.push(url);
  return url;
};
let instance: ReturnType<typeof import("./runtime.ts").runtime> | undefined;
let describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const emit = (event: WorkerEvent) => {
  if (event.type === "error" || event.type === "log") {
    event = { ...event, text: redact(event.text, token) };
  }
  self.postMessage(event);
};
const fail = (error: unknown) => {
  if (!stopping) emit({ type: "error", text: describe(error) });
};
self.addEventListener("error", (event) => {
  event.preventDefault();
  fail(event.error ?? new Error(event.message));
});
self.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  fail(event.reason);
});
// Keep console output bounded and sanitized. The host also caps retained entries.
let logs = 0;
for (
  const method of [
    "log",
    "info",
    "warn",
    "error",
    "debug",
    "dir",
    "dirxml",
    "table",
    "trace",
  ] as const
) {
  console[method] = (...values: unknown[]) => {
    if (++logs <= 100) {
      emit({
        type: "log",
        text: values.map((v) => String(v)).join(" "),
      });
    }
  };
}
self.onmessage = async ({ data }: MessageEvent<WorkerCommand>) => {
  if (data.type === "stop") {
    stopping = true;
    try {
      await instance?.stop();
    } catch { /* Host retains hard-stop fallback. */ }
    urls.forEach((url) => URL.revokeObjectURL(url));
    emit({ type: "stopped" });
    self.close();
    return;
  }
  token = data.token;
  try {
    const [{ prepare, checkDependency }, { runtime }] = await Promise.all([
      import("./prepare.ts"),
      import("./runtime.ts"),
    ]);
    if (stopping) return;
    instance = runtime(token, emit);
    // A module facade exposes the pinned browser runtime under its real named
    // exports. Its one-use handoff is private to this worker and then removed.
    const key = `grammy-live-${crypto.randomUUID()}`;
    Object.defineProperty(globalThis, key, {
      value: instance.exports,
      configurable: true,
    });
    const dependencyUrl = moduleUrl([
      `const grammy = globalThis[${JSON.stringify(key)}];`,
      `delete globalThis[${JSON.stringify(key)}];`,
      ...Object.keys(instance.exports).map((name) =>
        `export const ${name} = grammy[${JSON.stringify(name)}];`
      ),
    ].join("\n"));
    const prepared = prepare(
      data.source,
      data.language,
      data.format,
      dependencyUrl,
    );
    describe = prepared.describe;
    instance.setDescribe(describe);
    await instance.preflight();
    if (stopping) return;
    // Initialize the facade once, so later dynamic imports work after the handoff
    // has been removed. Keep its URL alive until Stop for those later imports.
    try {
      await import(/* @vite-ignore */ dependencyUrl);
    } finally {
      delete (globalThis as unknown as Record<string, unknown>)[key];
    }
    if (stopping) return;
    if (data.format === "commonjs") {
      // Only explicitly authored CommonJS receives a synchronous CJS wrapper.
      // Top-level await is consequently rejected here, as it is in a .cjs file.
      const execute = new Function(
        "require",
        "module",
        "exports",
        prepared.code,
      );
      const module = { exports: {} };
      execute.call(
        module.exports,
        (specifier: string) => {
          checkDependency(specifier);
          return instance!.exports;
        },
        module,
        module.exports,
      );
    } else {
      await import(/* @vite-ignore */ moduleUrl(prepared.code));
    }
    emit({ type: "executed" });
  } catch (error) {
    fail(error);
  }
};
