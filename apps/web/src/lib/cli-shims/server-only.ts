/**
 * CLI shim for the `server-only` package.
 *
 * `server-only` throws on import outside a React Server Component, which is
 * exactly what we want in the Next.js build — it stops a database module from
 * ever being bundled into client JavaScript. But our CLI entry points (seeds,
 * migrations, the agent runner) are plain Node processes that legitimately
 * import those same modules.
 *
 * `tsconfig.cli.json` maps `server-only` here for those runs only. The real
 * guard stays fully in force for anything Next.js compiles.
 */
export {};
