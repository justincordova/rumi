import { describe, expect, it, mock } from "bun:test";
import { AuthError } from "@/lib/errors";

// Mock DB client before any imports
mock.module("@/db/client", () => ({ db: {} }));

// Mock JWKS/jose
mock.module("jose", () => ({
  createRemoteJWKSet: mock(() => "mock-jwks"),
  jwtVerify: mock(async () => ({
    payload: { sub: "user-id", email: "user@example.com" },
  })),
}));

const baseRoom = {
  id: "room-id",
  slug: "test",
  ownerId: "owner-id",
  visibility: "open" as const,
  guestAccess: "none" as const,
  deletedAt: null,
};

const ownerMember = { roomId: "room-id", userId: "user-id", role: "owner" as const };
const regularMember = { roomId: "room-id", userId: "user-id", role: "member" as const };
const baseTab = {
  id: "00000000-0000-0000-0000-000000000001",
  roomId: "room-id",
  type: "tab" as const,
  language: "markdown",
  name: "Welcome",
  ordinal: 0,
};

// Build db mock for each test
function makeDbMock(
  opts: {
    room?: typeof baseRoom | null;
    member?: typeof ownerMember | null;
    tab?: typeof baseTab | null;
    insertResult?: unknown;
  } = {},
) {
  const room = opts.room !== undefined ? opts.room : baseRoom;
  const member = opts.member !== undefined ? opts.member : ownerMember;
  const tab = opts.tab !== undefined ? opts.tab : baseTab;

  return {
    query: {
      rooms: { findFirst: async () => room },
      roomMembers: { findFirst: async () => member },
      tabs: { findFirst: async () => tab },
    },
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => opts.insertResult ?? [],
      }),
    }),
  };
}

const { onAuthenticate } = await import("./authorize");

// Patch the db import in authorize.ts after loading it
import { db as _db } from "@/db/client";

describe("onAuthenticate", () => {
  it("resolves control doc (room:<id>) with tabId: null", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).query = makeDbMock().query;
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).insert = makeDbMock().insert;
    const result = await onAuthenticate({
      token: "eyJvalid.token",
      documentName: "room:room-id",
    } as Parameters<typeof onAuthenticate>[0]);
    expect(result.tabId).toBeNull();
    expect(result.roomId).toBe("room-id");
  });

  it("resolves tab uuid with tabId set", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).query = makeDbMock().query;
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).insert = makeDbMock().insert;
    const result = await onAuthenticate({
      token: "eyJvalid.token",
      documentName: "00000000-0000-0000-0000-000000000001",
    } as Parameters<typeof onAuthenticate>[0]);
    expect(result.tabId).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("authenticated member → readOnly: false", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).query = makeDbMock({ member: ownerMember }).query;
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).insert = makeDbMock().insert;
    const result = await onAuthenticate({
      token: "eyJvalid.token",
      documentName: "room:room-id",
    } as Parameters<typeof onAuthenticate>[0]);
    expect(result.readOnly).toBe(false);
  });

  it("authenticated member on private room → readOnly: false", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).query = makeDbMock({
      room: { ...baseRoom, visibility: "private" as const },
      member: regularMember,
    }).query;
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).insert = makeDbMock().insert;
    const result = await onAuthenticate({
      token: "eyJvalid.token",
      documentName: "room:room-id",
    } as Parameters<typeof onAuthenticate>[0]);
    expect(result.readOnly).toBe(false);
  });

  it("non-member on private room → throws forbidden", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).query = makeDbMock({
      room: { ...baseRoom, visibility: "private" as const },
      member: null,
    }).query;
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).insert = makeDbMock().insert;
    await expect(
      onAuthenticate({
        token: "eyJvalid.token",
        documentName: "room:room-id",
      } as Parameters<typeof onAuthenticate>[0]),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("soft-deleted room → throws not_found", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).query = makeDbMock({ room: null }).query;
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).insert = makeDbMock().insert;
    await expect(
      onAuthenticate({
        token: "eyJvalid.token",
        documentName: "room:room-id",
      } as Parameters<typeof onAuthenticate>[0]),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("missing tab → throws not_found", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).query = makeDbMock({ tab: null }).query;
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).insert = makeDbMock().insert;
    await expect(
      onAuthenticate({
        token: "eyJvalid.token",
        documentName: "00000000-0000-0000-0000-000000000001",
      } as Parameters<typeof onAuthenticate>[0]),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("guest with guest_access=none → throws forbidden", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).query = makeDbMock({ room: { ...baseRoom, guestAccess: "none" as const } }).query;
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).insert = makeDbMock().insert;
    await expect(
      onAuthenticate({
        token: "",
        documentName: "room:room-id",
      } as Parameters<typeof onAuthenticate>[0]),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("guest with guest_access=view → readOnly: true", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).query = makeDbMock({ room: { ...baseRoom, guestAccess: "view" as const } }).query;
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).insert = makeDbMock().insert;
    const result = await onAuthenticate({
      token: "",
      documentName: "room:room-id",
    } as Parameters<typeof onAuthenticate>[0]);
    expect(result.readOnly).toBe(true);
  });

  it("guest with guest_access=edit → readOnly: false", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).query = makeDbMock({ room: { ...baseRoom, guestAccess: "edit" as const } }).query;
    // biome-ignore lint/suspicious/noExplicitAny: test patching
    (_db as any).insert = makeDbMock().insert;
    const result = await onAuthenticate({
      token: "",
      documentName: "room:room-id",
    } as Parameters<typeof onAuthenticate>[0]);
    expect(result.readOnly).toBe(false);
  });
});
