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
  // Catch supabase.auth.signOut() rejections (revoked token, network down):
  // if we let the rejection propagate, the shared refreshInFlight promise
  // rejects with a non-ApiError, and every queued apiFetch caller's
  // `instanceof ApiError` check falls through.
  await supabase.auth.signOut().catch(() => {});
  return { ok: false };
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function apiFetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const token = useSession.getState().token;
  const headers = new Headers(opts.headers);
  if (opts.body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${env.VITE_API_URL}${path}`, {
      ...opts,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    // Deliberate cancellation (AbortController.abort()) must propagate as
    // an AbortError so callers like useNotifications can distinguish it
    // from a real network failure. Wrapping it as an ApiError would
    // produce misleading "Network request failed" toasts on legitimate
    // visibility-change cancellations.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    // Real network failure (DNS, offline, CORS preflight, etc.). Without
    // this branch the raw TypeError propagates as a non-ApiError and every
    // call site's `instanceof ApiError` check falls through to a generic
    // "server error" message with no signal it's a connectivity issue.
    throw new ApiError("network_error", "Network request failed", 0, err);
  }

  if (res.status === 401 && !opts._retried) {
    if (!refreshInFlight) {
      refreshInFlight = runRefresh().finally(() => {
        refreshInFlight = null;
      });
    }
    const { ok } = await refreshInFlight;
    if (ok) {
      // If the caller's signal was aborted while we were awaiting the
      // refresh, surface the abort instead of issuing a retry that will
      // immediately fail. Matches the AbortError contract above.
      if (opts.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return apiFetch<T>(path, { ...opts, _retried: true });
    }
    throw new ApiError("unauthorized", "Session expired", 401);
  }
  if (res.status === 204) return undefined as T;

  // Body may be empty (some servers return no body on 5xx) or non-JSON (a
  // proxy returning an HTML error page). Parse defensively so the helper
  // always throws a typed ApiError instead of a SyntaxError from .json().
  const text = await res.text();
  const json = text ? safeParseJson(text) : null;

  if (!res.ok) {
    const body = json as ErrorEnvelope | null;
    const code = body?.error?.code ?? "server_error";
    const message = body?.error?.message ?? res.statusText ?? "Request failed";
    throw new ApiError(code, message, res.status, json ?? undefined);
  }
  return json as T;
}
