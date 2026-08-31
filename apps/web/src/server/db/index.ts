import "server-only";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import postgres from "postgres";

import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Two drivers, one API.
 *
 * - `DATABASE_URL` present -> postgres-js against Supabase/Neon (production).
 * - otherwise              -> PGlite, a real Postgres compiled to WASM, persisted
 *                             on disk under `.pglite`. Same SQL dialect, same
 *                             migrations, no daemon to install. This is what makes
 *                             a fresh clone runnable with zero setup.
 */

/**
 * Both drivers expose the same query builder, but their nominal types differ,
 * and a union of them collapses Drizzle's overloads (`.returning()` stops
 * type-checking). We therefore pin the public type to the postgres-js shape and
 * widen the PGlite instance at the single point where it is created.
 */
type Database = ReturnType<typeof drizzlePg<typeof schema>>;

const globalForDb = globalThis as unknown as {
  __ottougc_db?: Database;
  __ottougc_sql?: ReturnType<typeof postgres>;
};

function createDb(): Database {
  if (env.databaseUrl) {
    const client =
      globalForDb.__ottougc_sql ??
      postgres(env.databaseUrl, {
        max: env.isProd ? 10 : 3,
        idle_timeout: 20,
        connect_timeout: 15,
        prepare: false, // required by Supabase's transaction pooler
      });
    if (!env.isProd) globalForDb.__ottougc_sql = client;
    return drizzlePg(client, { schema, casing: "snake_case" });
  }

  const client = new PGlite(env.pgliteDir);
  return drizzlePglite(client, { schema, casing: "snake_case" }) as unknown as Database;
}

export const db: Database = globalForDb.__ottougc_db ?? createDb();
if (!env.isProd) globalForDb.__ottougc_db = db;

export { schema };
export * from "./schema";
