import { db } from "@/db/client";
import { rooms } from "@/db/schema";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

export const PURGE_INTERVAL_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function purgeExpiredRooms(): Promise<number> {
  const cutoff = new Date(Date.now() - PURGE_INTERVAL_DAYS * ONE_DAY_MS);
  const deleted = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(12345)`);
    return tx
      .delete(rooms)
      .where(sql`${rooms.deletedAt} IS NOT NULL AND ${rooms.deletedAt} < ${cutoff.toISOString()}`)
      .returning({ id: rooms.id });
  });
  if (deleted.length > 0) {
    logger.info({ count: deleted.length, cutoff: cutoff.toISOString() }, "purged expired rooms");
  }
  return deleted.length;
}

export function startPurgeScheduler(): () => void {
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  function scheduleNext(delay: number) {
    if (stopped) return;
    timeout = setTimeout(async () => {
      try {
        await purgeExpiredRooms();
      } catch (err) {
        logger.error({ err }, "scheduled purge run failed");
      }
      scheduleNext(ONE_DAY_MS);
    }, delay);
  }

  scheduleNext(60_000);

  return () => {
    stopped = true;
    if (timeout) clearTimeout(timeout);
  };
}
