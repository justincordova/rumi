import { describe, expect, it, mock } from "bun:test";
import { AuthError } from "@/lib/errors";

// Mock the JWKS module before importing verify, so it uses our mock.
const mockJwtVerify = mock(async (_token: string, _jwks: unknown, _opts: unknown) => {
  throw new Error("not configured");
});

mock.module("jose", () => ({
  createRemoteJWKSet: mock(() => "mock-jwks"),
  jwtVerify: mockJwtVerify,
}));

const { verifyJwt } = await import("./verify");

describe("verifyJwt", () => {
  it("returns user on valid token", async () => {
    mockJwtVerify.mockImplementationOnce(async () => ({
      payload: { sub: "user-uuid-123", email: "Test@Example.com" },
    }));

    const result = await verifyJwt("valid.token");
    expect(result.id).toBe("user-uuid-123");
    expect(result.email).toBe("test@example.com"); // lowercased
  });

  it("throws unauthorized on invalid token", async () => {
    mockJwtVerify.mockImplementationOnce(async () => {
      throw new Error("signature verification failed");
    });

    await expect(verifyJwt("bad.token")).rejects.toBeInstanceOf(AuthError);
  });

  it("throws unauthorized on missing sub claim", async () => {
    mockJwtVerify.mockImplementationOnce(async () => ({
      payload: { email: "user@example.com" },
    }));

    await expect(verifyJwt("token")).rejects.toBeInstanceOf(AuthError);
  });

  it("throws unauthorized on missing email claim", async () => {
    mockJwtVerify.mockImplementationOnce(async () => ({
      payload: { sub: "user-uuid-123" },
    }));

    await expect(verifyJwt("token")).rejects.toBeInstanceOf(AuthError);
  });
});
