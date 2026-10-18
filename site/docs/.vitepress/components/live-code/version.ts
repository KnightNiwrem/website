// Shared by the page and the worker. Kept in its own module because the page
// must not import anything else that the worker uses.

/** Version of grammY that live examples run with, as pinned in deno.jsonc */
export const GRAMMY_VERSION = "1.46.0";
