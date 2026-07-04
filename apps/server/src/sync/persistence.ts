import { fetchDocument, storeDocument } from "@/db/documents";
import { logger } from "@/lib/logger";
import { Database } from "@hocuspocus/extension-database";

export function buildDatabaseExtension() {
  return new Database({
    async fetch({ context }) {
      if (!context) return null;
      // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
      const tabId = (context as any).tabId as string | undefined;
      if (!tabId) return null;
      try {
        return await fetchDocument(tabId);
      } catch (err) {
        // Do NOT return null here. Hocuspocus treats a null fetch result as
        // "no persisted state" and seeds a fresh empty Yjs document. If a
        // transient DB read error were swallowed that way, clients would load
        // an empty doc and the next successful `store` would overwrite the
        // real persisted state — turning a momentary read blip into permanent
        // data loss. Re-throw so Hocuspocus aborts the load and the client
        // retries instead of clobbering good data. The genuine "no row" case
        // is still returned as null by fetchDocument itself.
        logger.error({ err, tabId }, "failed to fetch document state");
        throw err;
      }
    },
    async store({ context, state }) {
      if (!context) return;
      // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
      const tabId = (context as any).tabId as string | undefined;
      if (!tabId) return;
      try {
        await storeDocument(tabId, state);
      } catch (err) {
        // Do NOT swallow. If the final debounced store fails while the last
        // client is disconnecting, Hocuspocus would treat a swallowed error as
        // success, evict the in-memory doc, and every unsaved edit would be
        // permanently lost. On rejection, Hocuspocus skips unloadDocument
        // (storeDocumentHooks only unloads in the resolve path), so the doc —
        // and its state — stays in memory and is reused by the next
        // connection. Mirrors the deliberate re-throw in `fetch` above.
        logger.error({ err, tabId }, "failed to persist document state");
        throw err;
      }
    },
  });
}
