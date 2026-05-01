let scriptEl: HTMLScriptElement | null = null;

export function maybeLoadAnalytics() {
  let consent: { analytics?: boolean } | null = null;
  try {
    consent = JSON.parse(localStorage.getItem("rumi_cookie_consent") ?? "null");
  } catch {
    consent = null;
  }
  const domain = import.meta.env.VITE_PLAUSIBLE_DOMAIN as string | undefined;
  if (!consent?.analytics || !domain) {
    unloadAnalytics();
    return;
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
}

export function trackEvent(name: string, props?: Record<string, string>) {
  // biome-ignore lint/suspicious/noExplicitAny: Plausible global
  const plausible = (window as any).plausible;
  if (typeof plausible === "function") plausible(name, { props });
}
