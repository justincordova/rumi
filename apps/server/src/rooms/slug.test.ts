import { describe, expect, it } from "bun:test";
import { fallbackSlug, generateSlug } from "./slug";

describe("generateSlug", () => {
  it("returns a lowercase string with hyphens", () => {
    const slug = generateSlug();
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)+$/);
  });
  it("is non-empty", () => {
    expect(generateSlug().length).toBeGreaterThan(0);
  });
  it("returns different values on successive calls", () => {
    const a = generateSlug();
    const b = generateSlug();
    expect(a).not.toBe(b);
  });

  it("varies the numeric suffix across calls (entropy not frozen at module load)", () => {
    const suffixes = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const parts = generateSlug().split("-");
      suffixes.add(parts[parts.length - 1] as string);
    }
    // A frozen module-level NumberDictionary would yield exactly one suffix.
    expect(suffixes.size).toBeGreaterThan(1);
  });
});

describe("fallbackSlug", () => {
  it("appends a 4-char hex suffix", () => {
    const slug = fallbackSlug();
    const parts = slug.split("-");
    const suffix = parts[parts.length - 1];
    expect(suffix).toMatch(/^[0-9a-f]{4}$/);
  });
  it("includes the base slug as prefix", () => {
    const slug = fallbackSlug();
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)+-[0-9a-f]{4}$/);
  });
});
