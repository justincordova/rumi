import { fetchDocument, storeDocument } from "@/db/documents";
import { Database } from "@hocuspocus/extension-database";

// `context` is undefined when Hocuspocus loads a document via openDirectConnection
// (e.g. server-side broadcasts in sync/control.ts). Guard before property access
// so those paths don't crash with a TypeError.
export function buildDatabaseExtension() {
  return new Database({
    async fetch({ context }) {
      if (!context) return null;
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
