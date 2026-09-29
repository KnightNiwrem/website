// Editor for live examples, loaded when a visitor starts editing.
//
// Prism Code Editor highlights code on top of a native <textarea>, so typing,
// selection, the clipboard, IME composition and autocorrect are handled by the
// browser itself, which matters most on phones.
import { createEditor } from "prism-code-editor";
import "prism-code-editor/prism/languages/typescript";
import "prism-code-editor/languages/clike";
import {
  defaultKeymap,
  editHistory,
  editorCommands,
} from "prism-code-editor/commands";
import { matchBrackets } from "prism-code-editor/match-brackets";
import { insertText } from "prism-code-editor/utils";
import layout from "prism-code-editor/layout.css?inline";

export interface Editor {
  readonly value: string;
  /** Replaces the code as one edit that can be undone. */
  replace(value: string): void;
  /** Undoes (-1) or redoes (1) an edit, if possible. */
  go(offset: -1 | 1): void;
  can(offset: -1 | 1): boolean;
  focus(): void;
  destroy(): void;
}

export function mountEditor(parent: HTMLElement, options: {
  value: string;
  typescript: boolean;
  label: string;
  onChange(value: string): void;
  /** Called when undo or redo may have become possible or impossible */
  onHistory(): void;
}): Editor {
  if (!document.getElementById("live-code-editor-style")) {
    const style = document.createElement("style");
    style.id = "live-code-editor-style";
    style.textContent = layout;
    document.head.append(style);
  }
  // Wrapping long lines saves scrolling sideways on narrow screens.
  const narrow = matchMedia("(max-width: 639px)");
  const history = editHistory();
  const editor = createEditor(
    parent,
    {
      language: options.typescript ? "typescript" : "javascript",
      value: options.value,
      tabSize: 2,
      insertSpaces: true,
      lineNumbers: true,
      wordWrap: narrow.matches,
      onUpdate(value) {
        options.onChange(value);
        // Undo and redo update the history only after this.
        queueMicrotask(options.onHistory);
      },
    },
    history,
    editorCommands(defaultKeymap),
    matchBrackets(),
  );
  const { textarea } = editor;
  textarea.setAttribute("aria-label", options.label);
  textarea.setAttribute("autocapitalize", "off");
  textarea.setAttribute("autocorrect", "off");
  textarea.spellcheck = false;
  // Added after the history's listener, which records typed input.
  textarea.addEventListener("input", options.onHistory);
  const wrap = () => editor.setOptions({ wordWrap: narrow.matches });
  narrow.addEventListener("change", wrap);
  return {
    get value() {
      return editor.value;
    },
    replace(value) {
      insertText(editor, value, 0, editor.value.length, 0);
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
