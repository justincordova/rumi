import type { ErrorEnvelope } from "@rumi/protocol";
import { useSession } from "./auth";
import { env } from "./env";
import { supabase } from "./supabase";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

interface FetchOpts extends Omit<RequestInit, "body"> {
  body?: unknown;
  _retried?: boolean;
}

export async function apiFetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const token = useSession.getState().token;
  const headers = new Headers(opts.headers);
  if (opts.body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${env.VITE_API_URL}${path}`, {
    ...opts,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && !opts._retried) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      useSession.getState()._set({ token: data.session.access_token });
      return apiFetch<T>(path, { ...opts, _retried: true });
    }
    // Refresh failed — sign out and short-circuit
    await supabase.auth.signOut();
    throw new ApiError("unauthorized", "Session expired", 401);
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json();
  if (!res.ok) {
    const body = json as ErrorEnvelope;
    throw new ApiError(body.error.code, body.error.message, res.status);
  }
  return json as T;
}
