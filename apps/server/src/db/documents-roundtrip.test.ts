import { describe, expect, it } from "bun:test";
import * as Y from "yjs";

describe("Yjs encode/decode", () => {
  it("round-trips a Y.Text document", () => {
    const a = new Y.Doc();
    a.getText("content").insert(0, "hello world");
    const bytes = Y.encodeStateAsUpdate(a);
    const b = new Y.Doc();
    Y.applyUpdate(b, bytes);
    expect(b.getText("content").toString()).toBe("hello world");
  });

  it("round-trips a Y.Map document (drawing-shape)", () => {
    const a = new Y.Doc();
    const m = a.getMap("tldraw");
    m.set("shape:1", { type: "rect", x: 10, y: 20 });
    const bytes = Y.encodeStateAsUpdate(a);
    const b = new Y.Doc();
    Y.applyUpdate(b, bytes);
    // biome-ignore lint/suspicious/noExplicitAny: accessing dynamic Yjs map value
    expect((b.getMap("tldraw").get("shape:1") as any).type).toBe("rect");
  });
});
