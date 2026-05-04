import type { ErrorEnvelope } from "@rumi/protocol";
import { useSession } from "./auth";
import { env } from "./env";
import { supabase } from "./supabase";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    /** Full parsed response body (envelope + any extra fields the server returned). */
    public body?: unknown,
  ) {
    super(message);
  }
}

interface FetchOpts extends Omit<RequestInit, "body"> {
  body?: unknown;
  _retried?: boolean;
}

// Single-flight refresh so a burst of concurrent 401s doesn't trigger N
// parallel `refreshSession()` calls (and N parallel `signOut()` calls if the
// refresh token is revoked). All callers await the same promise; the first
// one drives the refresh, the rest piggyback on the result.
let refreshInFlight: Promise<{ ok: boolean }> | null = null;

async function runRefresh(): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.auth.refreshSession();
  if (!error && data.session) {
    useSession.getState()._set({ token: data.session.access_token });
    return { ok: true };
  }
  // Refresh failed — sign out exactly once and let all queued callers fail.
  await supabase.auth.signOut();
  return { ok: false };
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
    if (!refreshInFlight) {
      refreshInFlight = runRefresh().finally(() => {
        refreshInFlight = null;
      });
    }
    const { ok } = await refreshInFlight;
    if (ok) {
      return apiFetch<T>(path, { ...opts, _retried: true });
    }
    throw new ApiError("unauthorized", "Session expired", 401);
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json();
  if (!res.ok) {
    const body = json as ErrorEnvelope;
    throw new ApiError(body.error.code, body.error.message, res.status, json);
  }
  return json as T;
}
