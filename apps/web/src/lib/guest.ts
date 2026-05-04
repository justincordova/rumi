import { useSession } from "./auth";

// Safari private mode and some embedded webviews throw on localStorage access.
// Fall back to an in-memory id so guest connections still work for the session.
let memoryFallback: string | null = null;

export function getGuestId(): string {
  try {
    let id = localStorage.getItem("rumi_guest_id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("rumi_guest_id", id);
    }
    return id;
  } catch {
    if (!memoryFallback) memoryFallback = crypto.randomUUID();
    return memoryFallback;
  }
}

export function useIsGuest(): boolean {
  return useSession((s) => s.status !== "authenticated");
}
