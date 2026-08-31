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
 * - `DATABASE_URL` present -> postgres-js against Cloud SQL (production), over a
 *                             unix socket when the URL names one.
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

/**
 * Cloud SQL from Cloud Run is a unix socket, not a host and a port.
 *
 * The connection string for it — `postgresql://user:pw@/db?host=/cloudsql/x` —
 * has no host between the `@` and the `/`, and postgres.js parses its URLs with
 * `new URL()`, which rejects that shape outright: "TypeError: Invalid URL". So
 * the socket form is taken apart here and handed over as options instead.
 *
 * Worth the special case: the socket is what lets the database instance stay
 * closed to the internet, with no IP allowlist and no password crossing a
 * network.
 */
function socketOptions(url: string) {
  const match = /[?&]host=(\/cloudsql\/[^&]+)/.exec(url);
  if (!match) return null;

  const withoutQuery = url.slice(0, url.indexOf("?"));
  const credentials = /^postgres(?:ql)?:\/\/([^:]+):([^@]*)@\/(.+)$/.exec(withoutQuery);
  if (!credentials) return null;

  return {
    host: decodeURIComponent(match[1]!),
    username: decodeURIComponent(credentials[1]!),
    password: decodeURIComponent(credentials[2]!),
    database: credentials[3]!,
  };
}

function createDb(): Database {
  if (env.databaseUrl) {
    const socket = socketOptions(env.databaseUrl);
    const settings = {
      max: env.isProd ? 10 : 3,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false, // required by Supabase's transaction pooler
    };
    const client =
      globalForDb.__ottougc_sql ??
      (socket ? postgres({ ...socket, ...settings }) : postgres(env.databaseUrl, settings));
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
