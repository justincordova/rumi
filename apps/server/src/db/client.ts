import { env } from "@/lib/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 5,
  idle_timeout: 10,
  connect_timeout: 10,
});
export const db = drizzle(client, { schema });
export type DbClient = typeof db;

export async function closeDb() {
  await client.end();
}
