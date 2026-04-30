import { describe, expect, it, mock } from "bun:test";

// Mock @/lib/env before any imports that depend on it
mock.module("@/lib/env", () => ({
  env: {
    VITE_API_URL: "http://localhost:3000",
    VITE_SUPABASE_URL: "https://test.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    VITE_WS_URL: "ws://localhost:3000/ws",
  },
}));

// Mock supabase client (needed for auth.ts import)
mock.module("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => {},
    },
  },
}));

const { extractProfile } = await import("./auth");

describe("extractProfile", () => {
  it("extracts GitHub profile (name + user_name + avatar_url)", () => {
    const result = extractProfile({
      id: "user-id-1",
      email: "Justin@Example.com",
      user_metadata: {
        name: "Justin Cordova",
        user_name: "jcordova",
        avatar_url: "https://avatars.githubusercontent.com/u/123",
      },
      // biome-ignore lint/suspicious/noExplicitAny: test stub for SupabaseUser
    } as any);
    expect(result.id).toBe("user-id-1");
    expect(result.email).toBe("justin@example.com");
    expect(result.displayName).toBe("Justin Cordova");
    expect(result.avatarUrl).toBe("https://avatars.githubusercontent.com/u/123");
  });

  it("extracts Google profile (full_name + picture)", () => {
    const result = extractProfile({
      id: "user-id-2",
      email: "user@gmail.com",
      user_metadata: {
        full_name: "Google User",
        picture: "https://lh3.googleusercontent.com/photo.jpg",
      },
      // biome-ignore lint/suspicious/noExplicitAny: test stub for SupabaseUser
    } as any);
    expect(result.displayName).toBe("Google User");
    expect(result.avatarUrl).toBe("https://lh3.googleusercontent.com/photo.jpg");
  });

  it("falls back to email prefix when metadata is empty", () => {
    const result = extractProfile({
      id: "user-id-3",
      email: "hello@example.com",
      user_metadata: {},
      // biome-ignore lint/suspicious/noExplicitAny: test stub for SupabaseUser
    } as any);
    expect(result.displayName).toBe("hello");
    expect(result.avatarUrl).toBeNull();
  });
});
