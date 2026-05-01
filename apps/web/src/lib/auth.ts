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
  const identities = (u.app_metadata?.identities as Array<{ provider: string }> | undefined) ?? [];
  const provider = identities[0]?.provider ?? null;
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
    if (session?.user.email) {
      useSession.getState()._set({
        user: extractProfile(session.user),
        token: session.access_token,
        status: "authenticated",
      });
    } else {
      if (session && !session.user.email) {
        void supabase.auth.signOut();
      }
      useSession.getState()._set({ user: null, token: null, status: "anonymous" });
    }
  });
}

export async function signInWithProvider(provider: "github" | "google", next = "/dashboard") {
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
}

export async function linkProvider(provider: "github" | "google", next = "/settings") {
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const { error } = await supabase.auth.linkIdentity({ provider, options: { redirectTo } });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}
