import { describe, expect, it } from "bun:test";

// Mock @/lib/env before anything imports it
import { mock } from "bun:test";
mock.module("@/lib/env", () => ({
  env: {
    VITE_API_URL: "http://localhost:3000",
    VITE_SUPABASE_URL: "https://test.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    VITE_WS_URL: "ws://localhost:3000/ws",
  },
}));

const { renderMarkdown } = await import("./render");

describe("renderMarkdown", () => {
  it("renders H1 heading", async () => {
    const html = await renderMarkdown("# Hello World");
    expect(html).toContain("<h1");
    expect(html).toContain("Hello World");
  });

  it("renders unordered list", async () => {
    const html = await renderMarkdown("- item one\n- item two");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
  });

  it("renders GFM table", async () => {
    const html = await renderMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table");
  });

  it("renders GFM task list with checkbox", async () => {
    const html = await renderMarkdown("- [ ] task one\n- [x] task done");
    expect(html).toContain('type="checkbox"');
  });

  it("strips <script> tags (sanitization)", async () => {
    const html = await renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
  });

  it("strips onerror attribute (sanitization)", async () => {
    const html = await renderMarkdown('<img src="x" onerror="alert(1)" />');
    expect(html).not.toContain("onerror");
  });
});
