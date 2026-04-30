import { describe, expect, it } from "bun:test";
import type { Room } from "@rumi/protocol";

type RoomEntry = Room & { pendingInvite: boolean };

function sortRooms(rooms: RoomEntry[], sort: "updated" | "created" | "name"): RoomEntry[] {
  return [...rooms].sort((a, b) => {
    if (sort === "name") return (a.name ?? a.slug).localeCompare(b.name ?? b.slug);
    if (sort === "created")
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

const baseRoom = (overrides: Partial<RoomEntry> = {}): RoomEntry => ({
  id: "00000000-0000-0000-0000-000000000001",
  slug: "test-room",
  name: "Test Room",
  ownerId: "00000000-0000-0000-0000-000000000002",
  visibility: "open",
  guestAccess: "none",
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  pendingInvite: false,
  ...overrides,
});

describe("sortRooms", () => {
  const rooms = [
    baseRoom({
      slug: "charlie",
      name: "Charlie",
      createdAt: "2025-01-03T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    }),
    baseRoom({
      slug: "alpha",
      name: "Alpha",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-03T00:00:00Z",
    }),
    baseRoom({
      slug: "bravo",
      name: "Bravo",
      createdAt: "2025-01-02T00:00:00Z",
      updatedAt: "2025-01-02T00:00:00Z",
    }),
  ];

  it("sorts by name ascending", () => {
    const sorted = sortRooms(rooms, "name");
    expect(sorted.map((r) => r.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("sorts by created descending", () => {
    const sorted = sortRooms(rooms, "created");
    expect(sorted.map((r) => r.name)).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  it("sorts by updated descending", () => {
    const sorted = sortRooms(rooms, "updated");
    expect(sorted.map((r) => r.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...rooms];
    sortRooms(rooms, "name");
    expect(rooms).toEqual(copy);
  });

  it("falls back to slug when name is null", () => {
    const withNull = [
      baseRoom({ slug: "zulu", name: null }),
      baseRoom({ slug: "alpha", name: "Alpha" }),
    ];
    const sorted = sortRooms(withNull, "name");
    expect(sorted[0].slug).toBe("alpha");
    expect(sorted[1].slug).toBe("zulu");
  });
});
