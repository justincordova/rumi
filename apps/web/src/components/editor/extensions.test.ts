import { describe, expect, it } from "bun:test";
import { EditorState, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdownShortcutKeymap, prefixLine, wrapSelection } from "./extensions";

/**
 * These commands only touch `view.state` and `view.dispatch`, so a stub keeps
 * the test out of happy-dom. Constructing a real EditorView needs a DOM and
 * would test CodeMirror rather than our guard.
 */
function makeView(doc: string, readOnly: boolean) {
  let state = EditorState.create({
    doc,
    selection: { anchor: 0, head: doc.length },
    extensions: [EditorState.readOnly.of(readOnly)],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch: (tr: Transaction) => {
      state = tr.state;
    },
  };
  return {
    view: view as unknown as EditorView,
    doc: () => state.doc.toString(),
  };
}

describe("markdown editing commands respect readOnly", () => {
  // `EditorState.readOnly` blocks DOM-level input but NOT a programmatic
  // dispatch, so each command has to check it itself. A read-only guest that
  // slips through mutates the shared Y.Text via yCollab and diverges from the
  // server copy.
  it("wrapSelection is a no-op when readOnly", () => {
    const { view, doc } = makeView("hello", true);
    expect(wrapSelection(view, "**")).toBe(false);
    expect(doc()).toBe("hello");
  });

  it("prefixLine is a no-op when readOnly", () => {
    const { view, doc } = makeView("hello", true);
    expect(prefixLine(view, "# ")).toBe(false);
    expect(doc()).toBe("hello");
  });

  it("every markdown shortcut is a no-op when readOnly", () => {
    for (const binding of markdownShortcutKeymap) {
      const { view, doc } = makeView("hello", true);
      expect(binding.run?.(view)).toBe(false);
      expect(doc()).toBe("hello");
    }
  });

  it("still edits when writable", () => {
    const bold = makeView("hello", false);
    expect(wrapSelection(bold.view, "**")).toBe(true);
    expect(bold.doc()).toBe("**hello**");

    const heading = makeView("hello", false);
    expect(prefixLine(heading.view, "# ")).toBe(true);
    expect(heading.doc()).toBe("# hello");
  });
});
