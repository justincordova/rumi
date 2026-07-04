let scriptEl: HTMLScriptElement | null = null;

function hasAnalyticsConsent(): boolean {
  try {
    const consent = JSON.parse(localStorage.getItem("rumi_cookie_consent") ?? "null") as {
      analytics?: boolean;
    } | null;
    return !!consent?.analytics;
  } catch {
    return false;
  }
}

export function maybeLoadAnalytics() {
  const domain = import.meta.env.VITE_PLAUSIBLE_DOMAIN as string | undefined;
  if (!hasAnalyticsConsent() || !domain) {
    unloadAnalytics();
    return;
  }
  // Clear the ignore flag a previous revocation may have set — Plausible's
  // script checks it before sending anything.
  try {
    localStorage.removeItem("plausible_ignore");
  } catch {
    // storage unavailable — ignore
  }
  if (scriptEl) return;
  scriptEl = document.createElement("script");
  scriptEl.defer = true;
  scriptEl.dataset.domain = domain;
  scriptEl.src = "https://plausible.io/js/script.js";
  document.head.appendChild(scriptEl);
}

function unloadAnalytics() {
  if (scriptEl) {
    scriptEl.remove();
    scriptEl = null;
  }
  // Removing the <script> tag does NOT stop tracking: the already-executed
  // script keeps `window.plausible` defined and its history-API pageview
  // hooks installed until a full reload. Two belts:
  // 1. `plausible_ignore` — honored by Plausible's own send path, so even the
  //    installed auto-pageview hooks stop transmitting.
  // 2. Clearing the global so our trackEvent calls become no-ops immediately.
  try {
    localStorage.setItem("plausible_ignore", "true");
  } catch {
    // storage unavailable — ignore
  }
  // biome-ignore lint/suspicious/noExplicitAny: Plausible global
  (window as any).plausible = undefined;
}

export function trackEvent(name: string, props?: Record<string, string>) {
  // Re-check consent at call time — revocation must take effect immediately,
  // not at the next page load.
  if (!hasAnalyticsConsent()) return;
  // biome-ignore lint/suspicious/noExplicitAny: Plausible global
  const plausible = (window as any).plausible;
  if (typeof plausible === "function") plausible(name, { props });
}
