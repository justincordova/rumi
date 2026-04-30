import { describe, expect, it } from "bun:test";
import { usePrefs } from "./prefs";

describe("prefs store", () => {
  it("defaults to dark + lato + geist-mono", () => {
    const s = usePrefs.getState();
    expect(s.theme).toBe("dark");
    expect(s.uiFont).toBe("lato");
    expect(s.editorFont).toBe("geist-mono");
  });
});
