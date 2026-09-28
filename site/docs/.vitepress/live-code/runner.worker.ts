/// <reference lib="webworker" />
import { redact } from "./protocol.ts";
import type { WorkerCommand, WorkerEvent } from "./protocol.ts";

let token = "";
let stopping = false;
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
    emit({ type: "stopped" });
    self.close();
    return;
  }
  token = data.token;
  try {
    const [{ prepare, dependencyRegistry }, { runtime }] = await Promise.all([
      import("./prepare.ts"),
      import("./runtime.ts"),
    ]);
    if (stopping) return;
    const prepared = prepare(data.source, data.language);
    describe = prepared.describe;
    instance = runtime(token, emit);
    instance.setDescribe(describe);
    await instance.preflight();
    if (stopping) return;
    const AsyncFunction =
      Object.getPrototypeOf(async function () {}).constructor;
    const execute = new AsyncFunction(
      "require",
      "module",
      "exports",
      `${prepared.code}\n//# sourceURL=grammy-live-example`,
    );
    const module = { exports: {} };
    await execute(dependencyRegistry(instance.exports), module, module.exports);
    emit({ type: "executed" });
  } catch (error) {
    fail(error);
  }
};
