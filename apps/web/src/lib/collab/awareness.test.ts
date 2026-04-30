import { describe, expect, it } from "bun:test";
import { buildLocalAwareness } from "./awareness";

// `user_id` and `color` are intentionally absent from the client-built awareness
// payload — the server stamps both from the verified JWT (or hashed socketId
// for guests) so clients cannot impersonate other users in presence.
describe("buildLocalAwareness", () => {
  it("returns cosmetic fields for authenticated user", () => {
    const result = buildLocalAwareness({
      id: "u1",
      email: "alice@example.com",
      displayName: "Alice",
      avatarUrl: "https://img.example.com/a.jpg",
    });
    expect(result.display_name).toBe("Alice");
    expect(result.avatar_url).toBe("https://img.example.com/a.jpg");
    // Identity and color are NOT set by the client.
    expect("user_id" in result).toBe(false);
    expect("color" in result).toBe(false);
  });

  it("returns guest display name for null user", () => {
    const result = buildLocalAwareness(null);
    expect(result.display_name).toBe("Guest");
    expect("user_id" in result).toBe(false);
  });

  it("ignores any client-supplied guest id", () => {
    // Even if the caller passes a guestId, it is not echoed into the payload —
    // the server is the only authority for guest identity.
    const result = buildLocalAwareness(null, "abc123");
    expect("user_id" in result).toBe(false);
    expect(result.display_name).toBe("Guest");
  });
});
