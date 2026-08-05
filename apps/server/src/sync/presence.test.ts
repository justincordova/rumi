import { describe, expect, it } from "bun:test";
import { PRESENCE_COLORS, colorFor } from "./presence";

const COLORS: readonly string[] = PRESENCE_COLORS;

describe("colorFor", () => {
  it("returns a value from the palette", () => {
    const result = colorFor("user-abc");
    expect(COLORS).toContain(result);
  });

  // The value is consumed as a raw CSS color: an inline `background` on the
  // presence avatar fallback and tldraw's SVG cursor `color`. A CSS
  // custom-property reference (the previous `hsl(var(--presence-N))`) is
  // invalid in both and silently resolves to nothing.
  it("returns a literal color, not a CSS var reference", () => {
    for (const id of ["user-abc", "user-123", "", "guest:xyz"]) {
      expect(colorFor(id)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it("is deterministic — same input always same output", () => {
    const a = colorFor("user-123");
    const b = colorFor("user-123");
    expect(a).toBe(b);
  });
  it("different inputs can produce different colors", () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(colorFor(`user-${i}`));
    }
    expect(results.size).toBeGreaterThan(1);
  });
  it("handles empty string", () => {
    expect(COLORS).toContain(colorFor(""));
  });
});
