import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { xml } from "@codemirror/lang-xml";
import { html } from "@codemirror/lang-html";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { useDarkMode } from "../utils/useDarkMode";
import type { CodeEditorProps, CodeLanguage } from "./CodeEditor";

/** Match the surrounding monospaced UI: small font, comfortable line height. */
const baseExtensions = [
  EditorView.theme({
    "&": { fontSize: "12px" },
    ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, monospace", lineHeight: "1.55" },
    ".cm-gutters": { backgroundColor: "transparent", border: "none" },
    ".cm-line": { padding: "0 4px" },
  }),
  EditorView.lineWrapping,
];

function langExtension(language: CodeLanguage) {
  switch (language) {
    case "json":
      return [json()];
    case "javascript":
      return [javascript()];
    case "xml":
      return [xml()];
    case "html":
      return [html()];
    case "graphql":
      // Stock CodeMirror 6 doesn't include a graphql language module; use
      // javascript() as a close-enough fallback (braces, strings, comments).
      return [javascript()];
    case "plain":
      return [];
  }
}

/**
 * Concrete CodeMirror 6 implementation. Imported lazily by `CodeEditor`
 * so the ~600 kB CodeMirror chunk is split out of the initial bundle.
 *
 * - Theme follows the app's dark / light mode via `useDarkMode`.
 * - Gutter / line numbers default on; disable via `showGutter={false}` for
 *   compact one-line fields.
 * - `height="auto"` makes the editor grow with content (with a sensible min).
 */
export default function CodeEditorImpl({
  value,
  onChange,
  language,
  height = 220,
  showGutter = true,
  placeholder,
  readOnly = false,
  autoFocus = false,
  className,
}: CodeEditorProps) {
  const isDark = useDarkMode();
  const extensions = useMemo(() => [...baseExtensions, ...langExtension(language)], [language]);

  const containerStyle =
    height === "auto"
      ? { minHeight: 80 }
      : { height: typeof height === "number" ? `${height}px` : height };

  return (
    <div
      style={containerStyle}
      className={`rounded-apple border border-border-light overflow-hidden bg-surface ${className ?? ""}`}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={isDark ? oneDark : undefined}
        height={height === "auto" ? undefined : `${height}px`}
        basicSetup={{
          lineNumbers: showGutter,
          foldGutter: showGutter,
          highlightActiveLine: !readOnly,
          highlightActiveLineGutter: !readOnly,
          autocompletion: !readOnly,
          tabSize: 2,
        }}
        placeholder={placeholder}
        editable={!readOnly}
        autoFocus={autoFocus}
      />
    </div>
  );
}
