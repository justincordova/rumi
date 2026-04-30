import { useSession } from "./auth";

export function getGuestId(): string {
  let id = localStorage.getItem("rumi_guest_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("rumi_guest_id", id);
  }
  return id;
}

export function useIsGuest(): boolean {
  return useSession((s) => s.status !== "authenticated");
}
