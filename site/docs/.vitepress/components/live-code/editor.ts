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
  /** Undoes (-1) or redoes (1) an edit, if possible. */
  go(offset: -1 | 1): void;
  can(offset: -1 | 1): boolean;
  focus(): void;
  destroy(): void;
}

export function mountEditor(
  parent: HTMLElement,
  value: string,
  language: Language,
  label: string,
  onChange: (value: string) => void,
  /** Called when undo or redo may have become possible or impossible. */
  onHistory: () => void,
): EditorHandle {
  addStyle("live-code-editor", layout + theme);
  // Wrapping long lines saves scrolling sideways on narrow screens.
  const narrow = matchMedia("(max-width: 639px)");
  const history = editHistory();
  const editor = createEditor(
    parent,
    {
      language: language === "ts" ? "typescript" : "javascript",
      value,
      lineNumbers: true,
      tabSize: 2,
      insertSpaces: true,
      wordWrap: narrow.matches,
      onUpdate(value) {
        onChange(value);
        // Undo and redo update the history only after this.
        queueMicrotask(onHistory);
      },
    },
    history,
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
  // Runs after the history has recorded typed input.
  textarea.addEventListener("input", onHistory);
  const wrap = () => editor.setOptions({ wordWrap: narrow.matches });
  narrow.addEventListener("change", wrap);
  return {
    get value() {
      return editor.value;
    },
    setValue(value) {
      editor.setOptions({ value });
      onChange(value);
    },
    go(offset) {
      history.go(offset);
    },
    can(offset) {
      return history.has(offset);
    },
    focus() {
      textarea.focus();
    },
    destroy() {
      narrow.removeEventListener("change", wrap);
      editor.remove();
    },
  };
}
