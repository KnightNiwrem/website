import { redact } from "./protocol.ts";
import type { WorkerCommand, WorkerEvent } from "./protocol.ts";

/** One worker per run. Web Locks prevent same-token competition across blocks/tabs. */
export function createRun(
  source: string,
  language: string,
  token: string,
  receive: (event: WorkerEvent) => void,
) {
  let worker: Worker | undefined;
  let cancelled = false;
  let release: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped: Promise<void> | undefined;
  let finishStop: (() => void) | undefined;
  const done = () => {
    worker?.terminate();
    worker = undefined;
    clearTimeout(timer);
    release?.();
    release = undefined;
    finishStop?.();
  };
  const stop = () => {
    if (stopped) return stopped;
    cancelled = true;
    stopped = new Promise<void>((resolve) => finishStop = resolve);
    if (worker) {
      worker.postMessage({ type: "stop" } satisfies WorkerCommand);
      timer = setTimeout(() => {
        done();
        receive({
          type: "log",
          text:
            "Worker force-stopped. Already processed Telegram requests cannot be undone; unconfirmed updates may repeat on restart.",
        });
      }, 1500);
    } else done();
    return stopped;
  };
  const start = async () => {
    try {
      if (!navigator.locks || !crypto.subtle) {
        throw new Error(
          "Live runs need HTTPS and a browser supporting Web Locks.",
        );
      }
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(token),
      );
      const key = Array.from(
        new Uint8Array(hash),
        (n) => n.toString(16).padStart(2, "0"),
      ).join("");
      if (cancelled) return;
      await navigator.locks.request(
        `grammy-live-${key}`,
        { ifAvailable: true },
        async (lock) => {
          if (cancelled) return;
          if (!lock) {
            throw new Error(
              "This bot is already running in another live block or tab. Stop that run first.",
            );
          }
          const released = new Promise<void>((resolve) => release = resolve);
          worker = new Worker(new URL("./runner.worker.ts", import.meta.url), {
            type: "module",
          });
          worker.onmessage = ({ data }: MessageEvent<WorkerEvent>) => {
            if (data.type === "stopped") {
              done();
              return;
            }
            if (cancelled) return;
            if (data.type === "log" || data.type === "error") {
              data = { ...data, text: redact(data.text, token) };
            }
            receive(data);
            if (data.type === "error") void stop();
          };
          worker.onerror = (event) => {
            event.preventDefault();
            receive({
              type: "error",
              text:
                "Worker failed to load or execute. Check your browser’s worker/CSP support.",
            });
            void stop();
          };
          worker.postMessage(
            { type: "run", source, language, token } satisfies WorkerCommand,
          );
          await released;
        },
      );
    } catch (error) {
      if (!cancelled) {
        receive({ type: "error", text: redact(String(error), token) });
      }
      done();
    }
  };
  return { start, stop };
}
