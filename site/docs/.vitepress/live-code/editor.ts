/// <reference lib="dom" />
import { createEditor } from "prism-code-editor";
import { editHistory } from "prism-code-editor/commands";
import "prism-code-editor/prism/languages/typescript";
import "prism-code-editor/layout.css";
import "./editor.css";

export function mountEditor(
  parent: HTMLElement,
  source: string,
  language: string,
  onUpdate: (value: string) => void,
) {
  const editor = createEditor(parent, {
    value: source,
    language: language === "js" ? "javascript" : "typescript",
    wordWrap: true,
    onUpdate,
  }, editHistory());
  editor.textarea.setAttribute("aria-label", "Example source");
  editor.textarea.setAttribute("autocapitalize", "off");
  editor.textarea.setAttribute("autocomplete", "off");
  editor.textarea.spellcheck = false;
  return editor;
}
