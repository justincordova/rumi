import { eq } from "drizzle-orm";
import { db } from "./client";
import { tabDocuments } from "./schema";

export async function fetchDocument(tabId: string): Promise<Uint8Array | null> {
  const rows = await db
    .select({ state: tabDocuments.state })
    .from(tabDocuments)
    .where(eq(tabDocuments.tabId, tabId))
    .limit(1);
  return rows[0]?.state ?? null;
}

export async function storeDocument(tabId: string, state: Uint8Array): Promise<void> {
  await db
    .insert(tabDocuments)
    .values({ tabId, state, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: tabDocuments.tabId,
      set: { state, updatedAt: new Date() },
    });
}
