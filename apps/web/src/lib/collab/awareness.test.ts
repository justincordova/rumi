import { describe, expect, it } from "bun:test";
import { buildLocalAwareness } from "./awareness";

describe("buildLocalAwareness", () => {
  it("returns user fields for authenticated user", () => {
    const result = buildLocalAwareness({
      id: "u1",
      email: "alice@example.com",
      displayName: "Alice",
      avatarUrl: "https://img.example.com/a.jpg",
    });
    expect(result.user_id).toBe("u1");
    expect(result.display_name).toBe("Alice");
    expect(result.avatar_url).toBe("https://img.example.com/a.jpg");
    expect(result.color).toBeDefined();
  });
  it("returns guest defaults for null user", () => {
    const result = buildLocalAwareness(null);
    expect(result.user_id).toBeUndefined();
    expect(result.display_name).toBe("Guest");
  });
  it("returns guest id when guestId provided", () => {
    const result = buildLocalAwareness(null, "abc123");
    expect(result.user_id).toBe("guest:abc123");
    expect(result.display_name).toBe("Guest");
  });
  it("color is deterministic for same user id", () => {
    const a = buildLocalAwareness({
      id: "u1",
      email: "a@b.com",
      displayName: "A",
      avatarUrl: null,
    });
    const b = buildLocalAwareness({
      id: "u1",
      email: "a@b.com",
      displayName: "A",
      avatarUrl: null,
    });
    expect(a.color).toBe(b.color);
  });
});
