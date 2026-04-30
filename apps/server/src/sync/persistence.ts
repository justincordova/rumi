import { fetchDocument, storeDocument } from "@/db/documents";
import { Database } from "@hocuspocus/extension-database";

export function buildDatabaseExtension() {
  return new Database({
    async fetch({ context }) {
      // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
      const tabId = (context as any).tabId as string | undefined;
      if (!tabId) return null;
      return fetchDocument(tabId);
    },
    async store({ context, state }) {
      if (!context) return;
      // biome-ignore lint/suspicious/noExplicitAny: Hocuspocus context is typed as unknown
      const tabId = (context as any).tabId as string | undefined;
      if (!tabId) return;
      await storeDocument(tabId, state);
    },
  });
}
