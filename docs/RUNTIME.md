# Where each job actually runs

Two surfaces, and the split is not cosmetic.

## The desktop app owns the loop

`apps/desktop` is where the fleet lives. It starts the Next server, opens a
window on it, and triggers every scheduled job over HTTP against that same local
server.

| Job | When | What it does |
| :-- | :-- | :-- |
| `produce` | 07:00 daily | Each creator agent wakes, reads its memory and its numbers, picks a shape it has not just used, and makes today's video. |
| `publish` | every 30 min | Posts anything whose slot has come, then pins its comment. |
| `ingest` | hourly | Pulls metrics and applies the decision grid at 2h / 24h / 72h. |
| `analyse` | 23:30 daily | Interprets the day and writes lessons to memory. |
| `review` | Mondays 09:00 | The manager reads every channel and decides: keep, double, reposition, slow, stop. |
| `warm` | 03:00 daily | Advances the warming ramp and promotes channels off it. |

Everything is also reachable by hand from the Fleet menu, and from the CLI.

### Why not Vercel

- One Omni shot takes about forty seconds; a video needs three to seven of them.
- A Remotion render pins a Chromium process for minutes.
- The generated media is hundreds of megabytes and has to persist.

A Vercel function is capped at sixty seconds and its filesystem does not survive
the invocation. The work fits a laptop and does not fit a lambda.

### The one rule the shell enforces

**Exactly one process owns the database.** PGlite has a single-writer directory,
and on 31 August a CLI and a reader touched it at the same moment: it did not
lock, it corrupted, and every run in it was lost. So the desktop shell never
opens the database and never spawns the CLI — it starts the server and talks to
it over HTTP. One owner, one writer.

The same rule is why `pnpm agent …` and `pnpm dev` must not run at the same time
against a PGlite database. Point `DATABASE_URL` at a real Postgres and the
constraint disappears.

## Vercel serves the landing page

The marketing site reads the showcase straight out of the database and renders
whatever the fleet actually published. It runs one cron — `ingest` — because
pulling metrics is a handful of API calls and comfortably fits the limit.

Production, rendering and publishing are deliberately not scheduled there. They
would time out, and a job that times out halfway through an upload is worse than
a job that never ran.
