// Editor for live examples. Loaded only when a visitor starts editing.
//
// Prism Code Editor highlights code in a layer on top of a native <textarea>,
// so typing, selection, clipboard, undo, IME composition and autocorrect are
// handled by the browser itself, which matters most on phones.
import { createEditor } from "prism-code-editor";
import "prism-code-editor/prism/languages/typescript";
import "prism-code-editor/languages/clike";
import {
  defaultKeymap,
  editHistory,
  editorCommands,
} from "prism-code-editor/commands";
import { matchBrackets } from "prism-code-editor/match-brackets";
import layout from "prism-code-editor/layout.css?inline";
import theme from "./editor.scss?inline";
import type { Language } from "./protocol.ts";
import { addStyle } from "./style.ts";

export interface EditorHandle {
  readonly value: string;
  setValue(value: string): void;
  focus(): void;
  destroy(): void;
}

export function mountEditor(
  parent: HTMLElement,
  value: string,
  language: Language,
  label: string,
  onChange: (value: string) => void,
): EditorHandle {
  addStyle("live-code-editor", layout + theme);
  const editor = createEditor(
    parent,
    {
      language: language === "ts" ? "typescript" : "javascript",
      value,
      lineNumbers: true,
      tabSize: 2,
      insertSpaces: true,
      onUpdate: onChange,
    },
    editHistory(),
    // Tab indents. Ctrl+M (Ctrl+Shift+M on macOS) toggles whether Tab moves
    // the focus instead, like in VS Code.
    editorCommands(defaultKeymap),
    matchBrackets(),
  );
  const textarea = editor.textarea;
  textarea.setAttribute("aria-label", label);
  textarea.setAttribute("autocapitalize", "off");
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("autocorrect", "off");
  textarea.spellcheck = false;
  return {
    get value() {
      return editor.value;
    },
    setValue(value) {
      editor.setOptions({ value });
      onChange(value);
    },
    focus() {
      textarea.focus();
    },
    destroy() {
      editor.remove();
    },
  };
}
