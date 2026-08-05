import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_EDITOR_FONT, DEFAULT_UI_FONT, EDITOR_FONTS, UI_FONTS } from "./fonts";

const fontsCss = readFileSync(join(import.meta.dir, "../styles/fonts.css"), "utf8");

/**
 * The Font picker in appearance-items.tsx enumerates EDITOR_FONTS directly, so
 * anything listed here is offered to the user. An entry with no @font-face
 * silently falls back to the generic stack: the menu shows a checkmark and the
 * preference persists while the editor renders in a different font.
 */
describe("EDITOR_FONTS", () => {
  it("only lists families that fonts.css actually loads", () => {
    for (const [key, font] of Object.entries(EDITOR_FONTS)) {
      const named = font.stack.match(/"([^"]+)"/)?.[1];
      if (!named) continue; // generic-only stack (System Mono) needs no import
      const slug = named
        .toLowerCase()
        .replace(/ variable$/, "")
        .replace(/\s+/g, "-");
      expect(fontsCss.toLowerCase()).toContain(slug);
      expect(key).toBeTruthy();
    }
  });

  it("has a default that exists in the map", () => {
    expect(EDITOR_FONTS[DEFAULT_EDITOR_FONT]).toBeDefined();
    expect(UI_FONTS[DEFAULT_UI_FONT]).toBeDefined();
  });
});
