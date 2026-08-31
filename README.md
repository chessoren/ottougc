# OttoUGC

Ten creators who post about your product every day. They aren't real people. They
write, film, edit and post to your own YouTube channels — then work out what to
make next from what actually worked.

The product is its own first customer: the `ottougc` brand in the database is
real, runs the same code path as any customer, and fills the showcase on the
landing page.

---

## Start in three commands

```bash
pnpm install
pnpm --filter @ottougc/web db:migrate
pnpm --filter @ottougc/web db:seed
pnpm dev
```

No credentials needed for that first run. Without them:

- the database is **PGlite** (Postgres compiled to WASM, persisted in `.pglite`);
- the creators run on a **rule-based planner** backed by the knowledge base — the
  whole pipeline works, it just doesn't improvise;
- media is **labelled stand-ins** with real durations and real word timings, so
  editing, rendering and quality control all genuinely execute;
- **quality control blocks every video containing a stand-in**, which is the
  point: nothing unpublishable is ever mistaken for content.

`Dashboard → Settings` says which of these modes is live.

> **PGlite is single-process.** The Next server and the `agent` CLI can't write to
> `.pglite` at the same time, and the server won't see what the CLI wrote until it
> restarts. In development, restart `pnpm dev` after a CLI session — or set
> `DATABASE_URL` to a real Postgres, which removes the constraint.

To make real videos, set one variable:

```bash
echo 'GEMINI_API_KEY=your-key' >> apps/web/.env.local
```

That unlocks **Gemini Omni Flash** for video. Images, music and voice need a
Google Cloud service account — see [`docs/SETUP.md`](docs/SETUP.md).

---

## Running it

Everything the scheduler does is also a command. A scheduled system nobody can
trigger by hand is a system nobody can debug.

```bash
pnpm --filter @ottougc/web agent status        # where everything stands
pnpm --filter @ottougc/web agent plan          # cast the creators
pnpm --filter @ottougc/web agent produce 5     # five creators make their video
pnpm --filter @ottougc/web agent publish       # post whatever's due
pnpm --filter @ottougc/web agent simulate 5    # simulated metrics, clearly labelled
pnpm --filter @ottougc/web agent ingest        # pull numbers, apply the decision grid
pnpm --filter @ottougc/web agent analyse       # interpret, write lessons to memory
pnpm --filter @ottougc/web agent review        # weekly review of every channel
pnpm --filter @ottougc/web agent day 5         # a full day, in order
```

The Remotion studio, for working on the renderer:

```bash
pnpm video:studio
```

---

## What happens, in order

```
Setup                          Every day, per channel
─────                          ──────────────────────
paste a website                read its memory
crawl home/pricing/about/FAQ   read its targets
propose a brief                see what worked
you fix and confirm            pick a SCENARIO — never a shape it used twice
cast ten creators              write the scene against real brand material
                               build the character (once) — ICP + 7 reference images
      ▲                        compile every beat into a shot specification
      │                        generate each shot with those references attached
      │                        cut it: breaths, punch-ins, overlays, mix
      │                        render 1080×1920 at 60fps
      │                              │
      │                              ▼
      │                        Quality control
      │                        blocks: unconfirmed numbers, absolute promises,
      │                        proof without a real recording, stand-in media
      │                              │
      │                              ▼
      │                        Post + pinned comment within 90s
      │                              │
      │                              ▼
      │                        Measure at 2h / 24h / 72h
      │                        drop · keep · double down · amplify
      │                              │
      └────────── weekly review ─────┘
              keep · double · reposition · slow · stop
```

---

## Architecture

| Folder | What it holds |
| :--- | :--- |
| `server/knowledge/scenarios` | 22 scenarios described by **shape** — 16 distinct ones. See [`docs/SCENARIOS.md`](docs/SCENARIOS.md). |
| `server/knowledge/prompting` | Closed vocabularies for framing, light, texture and performance, and the compiler that turns them into a prompt. The model never writes a prompt. |
| `server/persona` | ICP and character sheet construction. A precondition of any generation. See [`docs/CHARACTER.md`](docs/CHARACTER.md). |
| `server/onboarding` | Site crawler and brief builder. See [`docs/ONBOARDING.md`](docs/ONBOARDING.md). |
| `server/agents` | Agent runtime, and the agents: manager, account, QA, analyst, weekly review. |
| `server/agents/tools` | What the model can call: knowledge, memory, strategy, generation, **editing**, publishing, analytics. |
| `server/edit` | The editing timeline: intermediate representation, validation, rule-based editor. |
| `server/media` | Gemini Omni Flash, Imagen, Lyria, Chirp — and the labelled stand-in provider. |
| `server/darwin` | Scoring, the decision grid, Thompson sampling, drop-off diagnosis. |
| `server/integrations` | YouTube: OAuth, upload, analytics, comments, **quota sharding**. |
| `apps/video` | The Remotion project: **one generic composition** that renders any timeline. |

Four decisions are explained in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md):

1. **A timeline, not templates.** The agent performs editing operations on an
   intermediate representation, which is what lets it invent a cut the taxonomy
   never described.
2. **The YouTube quota is the real constraint**, not the AI. Six uploads a day
   per Google Cloud project. Multi-project routing is built in.
3. **Quality control fails closed.** An unlabelled screen recording is treated as
   a stand-in, and a proof scenario with no proof does not publish.
4. **Degradation is explicit.** Every integration has a fallback, and every
   fallback is visible in Settings.

---

## What's true today

- The whole pipeline runs end to end and produces 1080×1920 60fps MP4s.
- Every channel builds its own ICP and a seven-image character sheet before it
  generates a single second of video.
- Video prompts are compiled from a typed specification, not written by a model.
- 22 scenarios across 16 distinct shapes, from a four-second silent reaction to a
  forty-five-second drama where the product is the plot's pivot.
- The site crawler reads a company's own pages and proposes a brief to correct.
- The decision engine issues numbered verdicts and updates its posteriors.
- The weekly review decides each channel's fate and reallocates cadence.
- YouTube posting is implemented and tested in dry run.

## What's still to wire

- **A `GEMINI_API_KEY`.** Without it no real footage is generated and quality
  control blocks everything. This is the only thing between the current state and
  real videos.
- Google Cloud credentials for Imagen, Lyria and Chirp — character reference
  images, music and voiceover.
- Multi-tenant auth: onboarding currently attaches a brand to a single operator.
- Payment: usage pricing is modelled and calculated, but nothing is charged.
