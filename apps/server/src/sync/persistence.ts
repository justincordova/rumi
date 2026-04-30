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
        logger.error({ err, tabId }, "failed to fetch document state");
        return null;
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
        logger.error({ err, tabId }, "failed to persist document state");
      }
    },
  });
}
