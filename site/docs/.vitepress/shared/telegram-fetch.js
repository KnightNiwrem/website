// Telegram supports form-encoded parameters. Unlike JSON POSTs, these requests
// do not need a CORS preflight, which api.telegram.org does not support.
// https://core.telegram.org/bots/api#making-requests
export function telegramFetch(url, init = {}) {
  const headers = new Headers(init.headers);
  if (headers.get("content-type") !== "application/json") {
    throw new Error(
      "File uploads are not supported in this browser playground",
    );
  }
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(JSON.parse(init.body ?? "{}"))) {
    if (value != null) {
      body.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
  }
  headers.delete("content-type"); // fetch sets application/x-www-form-urlencoded.
  headers.delete("connection"); // Forbidden browser request header.
  return fetch(url, { ...init, headers, body });
}
