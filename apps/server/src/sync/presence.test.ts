import { describe, expect, it } from "bun:test";
import { colorFor } from "./presence";

const COLORS = Array.from({ length: 5 }, (_, i) => `hsl(var(--presence-${i + 1}))`);

describe("colorFor", () => {
  it("returns a value from the palette", () => {
    const result = colorFor("user-abc");
    expect(COLORS).toContain(result);
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
