// Styles of live examples are added when they are used, instead of being
// part of the stylesheet that every page of the site loads.

/** Adds a stylesheet to the page once. */
export function addStyle(id: string, css: string) {
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.append(style);
}
