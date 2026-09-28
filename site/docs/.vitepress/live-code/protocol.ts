export interface Example {
  source: string;
  language: string;
  label: string;
  format: "module" | "commonjs";
}

export type WorkerCommand =
  | {
    type: "run";
    source: string;
    language: string;
    format: Example["format"];
    token: string;
  }
  | { type: "stop" };

export type WorkerEvent =
  | { type: "running"; username: string }
  | { type: "executed" }
  | { type: "log" | "error"; text: string }
  | { type: "stopped" };

// Also sanitize token-shaped strings entered directly in edited source.
// Never forward Error objects, payloads, or unsanitized network URLs to the UI.
export function redact(text: string, token = ""): string {
  if (token) text = text.split(token).join("[token]");
  return text.replace(/\b\d{5,}:[A-Za-z0-9_-]+/g, "[token]")
    .replace(/https?:\/\/api\.telegram\.org\/\S+/g, "[Telegram API URL]")
    .slice(0, 2000);
}
