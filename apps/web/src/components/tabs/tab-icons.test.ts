import { describe, expect, it } from "bun:test";
import { Code2, FileText, PenLine } from "lucide-react";
import { getTabIcon } from "./tab-icons";

describe("getTabIcon", () => {
  it("returns PenLine for drawing tab", () => {
    expect(getTabIcon("drawing", null)).toBe(PenLine);
  });
  it("returns FileText for markdown tab", () => {
    expect(getTabIcon("tab", "markdown")).toBe(FileText);
  });
  it("returns Code2 for code tab with language", () => {
    expect(getTabIcon("tab", "typescript")).toBe(Code2);
  });
  it("returns Code2 for tab with null language", () => {
    expect(getTabIcon("tab", null)).toBe(Code2);
  });
});
