import { apiFetch } from "@/lib/api";
import type {
  ListRoomsResponse,
  ListTrashedRoomsResponse,
  Room,
  TrashedRoom,
} from "@rumi/protocol";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type RoomEntry = Room & { pendingAccess: boolean; pendingWhitelistId?: string };
export type TrashedRoomEntry = TrashedRoom;

export type RoomSort = "updated" | "created" | "name";
export type ViewMode = "grid" | "list";

function sortRooms(rooms: RoomEntry[], sort: RoomSort): RoomEntry[] {
  return [...rooms].sort((a, b) => {
    if (sort === "name") return (a.name ?? a.slug).localeCompare(b.name ?? b.slug);
    if (sort === "created")
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function filterRooms(rooms: RoomEntry[], query: string): RoomEntry[] {
  if (!query.trim()) return rooms;
  const q = query.toLowerCase();
  return rooms.filter(
    (r) => (r.name ?? r.slug).toLowerCase().includes(q) || r.slug.toLowerCase().includes(q),
  );
}

interface RoomsState {
  rooms: RoomEntry[];
  status: "idle" | "loading" | "ready" | "error";
  sort: RoomSort;
  search: string;
  viewMode: ViewMode;
  trashed: TrashedRoomEntry[];
  trashStatus: "idle" | "loading" | "ready" | "error";
  setSort: (sort: RoomSort) => void;
  setSearch: (search: string) => void;
  setViewMode: (mode: ViewMode) => void;
  filtered: () => RoomEntry[];
  fetch: () => Promise<void>;
  fetchTrash: () => Promise<void>;
  addRoom: (room: Room) => void;
  removeRoom: (slug: string) => void;
  updateRoom: (room: Room) => void;
  removeTrashedRoom: (slug: string) => void;
}

export const useRoomsStore = create<RoomsState>()(
  persist(
    (set, get) => ({
      rooms: [],
      status: "idle",
      sort: "updated",
      search: "",
      viewMode: "grid",
      trashed: [],
      trashStatus: "idle",
      setSort: (sort) => set({ sort, rooms: sortRooms(get().rooms, sort) }),
      setSearch: (search) => set({ search }),
      setViewMode: (viewMode) => set({ viewMode }),
      filtered: () => filterRooms(get().rooms, get().search),
      fetch: async () => {
        set({ status: "loading" });
        try {
          const data = await apiFetch<ListRoomsResponse>("/api/rooms");
          set({ rooms: sortRooms(data.rooms as RoomEntry[], get().sort), status: "ready" });
        } catch {
          set({ status: "error" });
        }
      },
      fetchTrash: async () => {
        set({ trashStatus: "loading" });
        try {
          const data = await apiFetch<ListTrashedRoomsResponse>("/api/rooms/trash");
          set({ trashed: data.rooms, trashStatus: "ready" });
        } catch {
          set({ trashStatus: "error" });
        }
      },
      addRoom: (room) =>
        set((s) => ({ rooms: sortRooms([{ ...room, pendingAccess: false }, ...s.rooms], s.sort) })),
      removeRoom: (slug) => set({ rooms: get().rooms.filter((r) => r.slug !== slug) }),
      // Upsert, not map. The store is only populated by the dashboard's
      // `fetch()`, so on a direct `/r/<slug>` load (bookmark, refresh, shared
      // link) `rooms` is empty and a plain map silently discarded the PATCH
      // response — leaving the room page rendering the stale loader copy after
      // a successful rename / visibility / guest-access change. Every caller
      // passes the result of an owner-only PATCH, so the viewer is a confirmed
      // member and `pendingAccess: false` is correct.
      updateRoom: (room) =>
        set((s) => {
          const known = s.rooms.some((r) => r.slug === room.slug);
          const next = known
            ? s.rooms.map((r) => (r.slug === room.slug ? { ...r, ...room } : r))
            : [...s.rooms, { ...room, pendingAccess: false }];
          return { rooms: sortRooms(next, s.sort) };
        }),
      removeTrashedRoom: (slug) => set({ trashed: get().trashed.filter((r) => r.slug !== slug) }),
    }),
    {
      name: "rumi-rooms-prefs",
      partialize: (state) => ({ sort: state.sort, viewMode: state.viewMode }),
    },
  ),
);
