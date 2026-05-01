import { apiFetch } from "@/lib/api";
import type { Room } from "@rumi/protocol";
import type { ListRoomsResponse } from "@rumi/protocol";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type RoomEntry = Room & { pendingInvite: boolean };

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
  setSort: (sort: RoomSort) => void;
  setSearch: (search: string) => void;
  setViewMode: (mode: ViewMode) => void;
  filtered: () => RoomEntry[];
  fetch: () => Promise<void>;
  addRoom: (room: Room) => void;
  removeRoom: (slug: string) => void;
  updateRoom: (room: Room) => void;
}

export const useRoomsStore = create<RoomsState>()(
  persist(
    (set, get) => ({
      rooms: [],
      status: "idle",
      sort: "updated",
      search: "",
      viewMode: "grid",
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
      addRoom: (room) =>
        set((s) => ({ rooms: sortRooms([{ ...room, pendingInvite: false }, ...s.rooms], s.sort) })),
      removeRoom: (slug) => set({ rooms: get().rooms.filter((r) => r.slug !== slug) }),
      updateRoom: (room) =>
        set((s) => ({
          rooms: sortRooms(
            s.rooms.map((r) => (r.slug === room.slug ? { ...r, ...room } : r)),
            s.sort,
          ),
        })),
    }),
    {
      name: "rumi-rooms-prefs",
      partialize: (state) => ({ sort: state.sort, viewMode: state.viewMode }),
    },
  ),
);
