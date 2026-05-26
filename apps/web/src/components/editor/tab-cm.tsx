import { LANGUAGES } from "@/lib/markdown/languages";
import { usePrefs } from "@/lib/prefs";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type React from "react";
import { useEffect, useRef } from "react";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import { rumiHighlightStyle } from "./decorations";
import { markdownShortcutKeymap, rumiEditorTheme } from "./extensions";

function buildLangExtension(language: string | null): Extension | Promise<Extension> {
  if (!language) return [];
  return LANGUAGES[language]?.cmExtension() ?? [];
}

interface Props {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  language: string | null;
  readOnly: boolean;
  /** Optional external ref the parent can use to dispatch commands (e.g. the
   *  markdown toolbar's bold/italic actions). Without this, MarkdownTab's
   *  toolbar viewRef stays null forever and every button silently no-ops. */
  externalViewRef?: React.MutableRefObject<EditorView | null>;
}

export function TabCm({ ydoc, provider, language, readOnly, externalViewRef }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const wrapCompartment = useRef(new Compartment());
  const sizeCompartment = useRef(new Compartment());
  const fontSize = usePrefs((s) => s.fontSize);
  const wordWrap = usePrefs((s) => s.wordWrap);

  // Mount once per (ydoc, provider). language and readOnly reconfigure via separate effects.
  // biome-ignore lint/correctness/useExhaustiveDependencies: language/readOnly intentionally excluded — they use compartment reconfigure
  useEffect(() => {
    if (!ref.current) return;
    const ytext = ydoc.getText("content");
    const undoManager = new Y.UndoManager(ytext);
    const view = new EditorView({
      parent: ref.current,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...markdownShortcutKeymap]),
          wrapCompartment.current.of(wordWrap ? EditorView.lineWrapping : []),
          dropCursor(),
          drawSelection(),
          placeholder("Start writing…"),
          syntaxHighlighting(rumiHighlightStyle),
          rumiEditorTheme,
          sizeCompartment.current.of(EditorView.theme({ "&": { fontSize: `${fontSize}px` } })),
          langCompartment.current.of([]),
          readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
          yCollab(ytext, provider.awareness, { undoManager }),
        ],
      }),
    });
    viewRef.current = view;
    if (externalViewRef) externalViewRef.current = view;

    // Apply initial language async if needed. Guarded by a cancellation token
    // because the dynamic import resolution can race with a follow-up effect
    // (e.g. rapid language switch) — without the guard a stale ext can be
    // dispatched onto a destroyed view.
    let cancelled = false;
    Promise.resolve(buildLangExtension(language)).then((ext) => {
      if (cancelled || !viewRef.current) return;
      view.dispatch({ effects: langCompartment.current.reconfigure(ext) });
    });

    return () => {
      cancelled = true;
      view.destroy();
      viewRef.current = null;
      if (externalViewRef) externalViewRef.current = null;
    };
  }, [ydoc, provider]); // language and readOnly reconfigure via separate effects

  // Reconfigure when language changes. Same cancellation pattern — if the
  // user picks `python` then immediately `go`, the python import may resolve
  // last and reconfigure back to python without this guard.
  useEffect(() => {
    let cancelled = false;
    const view = viewRef.current;
    if (!view) return;
    Promise.resolve(buildLangExtension(language)).then((ext) => {
      if (cancelled || !viewRef.current) return;
      view.dispatch({ effects: langCompartment.current.reconfigure(ext) });
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  // Reconfigure when readOnly changes.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  // Reconfigure when word wrap changes.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.current.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    });
  }, [wordWrap]);

  // Reconfigure when font size changes.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: sizeCompartment.current.reconfigure(
        EditorView.theme({ "&": { fontSize: `${fontSize}px` } }),
      ),
    });
  }, [fontSize]);

  return (
    <div
      ref={ref}
      className="h-full font-mono"
      style={{ fontFeatureSettings: "var(--editor-font-feature-settings, normal)" }}
    />
  );
}
