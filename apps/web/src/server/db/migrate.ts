import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { sql } from "drizzle-orm";

import { env } from "@/lib/env";
import { db } from "./index";

/**
 * Migration runner.
 *
 * Drizzle's own migrator is driver-specific, and we run against two drivers. The
 * SQL files are identical either way, so we apply them ourselves and record what
 * has run in a small ledger table. Statements are split on `--> statement-breakpoint`,
 * the marker drizzle-kit already emits.
 */
export async function migrate(): Promise<{ applied: string[]; skipped: string[] }> {
  await db.execute(sql`
    create table if not exists __ottougc_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const done = await db.execute(sql`select name from __ottougc_migrations`);
  const doneNames = new Set(
    (done as unknown as Array<{ name: string }> | { rows: Array<{ name: string }> }) instanceof Array
      ? (done as unknown as Array<{ name: string }>).map((r) => r.name)
      : ((done as unknown as { rows: Array<{ name: string }> }).rows ?? []).map((r) => r.name),
  );

  const dir = path.join(process.cwd(), "drizzle");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (doneNames.has(file)) {
      skipped.push(file);
      continue;
    }
    const content = await readFile(path.join(dir, file), "utf8");
    const statements = content
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const statement of statements) {
      try {
        await db.execute(sql.raw(statement));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Re-running a partially applied migration is common in development;
        // "already exists" is not a failure worth aborting the whole run for.
        if (!/already exists|duplicate/i.test(message)) {
          throw new Error(`Migration ${file} failed on:\n${statement.slice(0, 200)}\n${message}`);
        }
      }
    }

    await db.execute(sql`insert into __ottougc_migrations (name) values (${file})`);
    applied.push(file);
  }

  return { applied, skipped };
}

if (process.argv[1]?.includes("migrate")) {
  migrate()
    .then((r) => {
      console.log(
        `Migrations: ${r.applied.length} applied${r.applied.length ? ` (${r.applied.join(", ")})` : ""}, ${r.skipped.length} already up to date.`,
      );
      console.log(`Driver: ${env.databaseUrl ? "postgres" : "pglite (" + env.pgliteDir + ")"}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
