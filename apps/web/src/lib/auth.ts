import type { User as SupabaseUser } from "@supabase/supabase-js";
import { create } from "zustand";
import { supabase } from "./supabase";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  provider: string | null;
  identities: Array<{ provider: string }>;
}

interface SessionState {
  user: SessionUser | null;
  token: string | null;
  status: "loading" | "authenticated" | "anonymous";
  _set: (s: Partial<Omit<SessionState, "_set">>) => void;
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  token: null,
  status: "loading",
  // biome-ignore lint/suspicious/noExplicitAny: Zustand partial setter needs any for Omit compatibility
  _set: (s) => set(s as any),
}));

function pickNonEmpty(...vs: (string | null | undefined)[]): string | null {
  for (const v of vs) if (v?.trim()) return v.trim();
  return null;
}

export function extractProfile(u: SupabaseUser): SessionUser {
  const m = (u.user_metadata ?? {}) as Record<string, string | null | undefined>;
  // Identities live on the TOP-LEVEL `user.identities` field — app_metadata
  // only carries `provider`/`providers` strings. Reading identities from
  // app_metadata always produced [], rendering every provider as unlinked in
  // the settings Linked Accounts section.
  const identities = (u.identities ?? []).map((i) => ({ provider: i.provider }));
  const provider =
    identities[0]?.provider ?? (u.app_metadata?.provider as string | undefined) ?? null;
  return {
    id: u.id,
    email: (u.email ?? "").toLowerCase(),
    displayName:
      pickNonEmpty(m.full_name, m.name, m.user_name, u.email?.split("@")[0]) ?? "Unknown",
    avatarUrl: pickNonEmpty(m.avatar_url, m.picture),
    provider,
    identities,
  };
}

export async function initAuth() {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.email) {
    useSession.getState()._set({
      user: extractProfile(data.session.user),
      token: data.session.access_token,
      status: "authenticated",
    });
  } else {
    if (data.session && !data.session.user.email) {
      await supabase.auth.signOut();
    }
    useSession.getState()._set({ status: "anonymous" });
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    // Wrap so an exception inside extractProfile (e.g. malformed user
    // metadata on a legacy account) can't tank the entire auth subscription
    // — without this guard subsequent token refreshes would silently never
    // update useSession.
    try {
      if (session?.user.email) {
        useSession.getState()._set({
          user: extractProfile(session.user),
          token: session.access_token,
          status: "authenticated",
        });
      } else {
        if (session && !session.user.email) {
          // Fire-and-forget signOut can reject when the token is already
          // revoked or the network is down; swallow so we don't surface an
          // UnhandledPromiseRejection.
          void supabase.auth.signOut().catch(() => {});
        }
        useSession.getState()._set({ user: null, token: null, status: "anonymous" });
      }
    } catch (err) {
      console.error("auth state change handler failed", err);
      useSession.getState()._set({ user: null, token: null, status: "anonymous" });
    }
  });
}

// Coerce a `next` redirect target to a safe internal path. Mirrors the check
// in routes/auth/callback.tsx so we never round-trip an attacker-controlled
// off-origin URL through the OAuth callback.
function safeNext(next: string): string {
  if (!next.startsWith("/")) return "/dashboard";
  if (next.startsWith("//") || next.startsWith("/\\")) return "/dashboard";
  return next;
}

export async function signInWithProvider(provider: "github" | "google", next = "/dashboard") {
  const safe = safeNext(next);
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safe)}`;
  await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
}

export async function linkProvider(provider: "github" | "google", next = "/settings") {
  const safe = safeNext(next);
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safe)}`;
  const { error } = await supabase.auth.linkIdentity({ provider, options: { redirectTo } });
  if (error) throw error;
}

export async function signOut() {
  // signOut() can reject when the refresh token has already been revoked
  // server-side or the network is unreachable. Either way, we want the user
  // to land on the public home and a fresh page load to clear any in-memory
  // session state — don't leave them on a half-broken settings page.
  try {
    await supabase.auth.signOut();
  } catch {
    // best-effort — local state is wiped by the redirect below
  }
  window.location.href = "/";
}
