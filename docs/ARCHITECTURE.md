# Architecture

This explains the decisions that are not obvious from the code, and why the
alternatives were rejected.

---

## 1. A timeline, not templates

**The problem.** Twenty-two scenarios means twenty-two Remotion compositions to
write and maintain. Worse: a model handed templates does not edit, it fills
holes. And what separates a video people watch from one they scroll past is not
the content — it is the edit.

**The decision.** There is an **intermediate representation for editing**
(`server/edit/timeline.ts`): three tracks (video, overlays, audio), composable
effects, transitions, gain automation. Plain JSON.

The agent does not write React. It calls an editor's tools:

```
build_rough_cut          lay down the assembly
place_cut                move a cut (snapped to the breath)
split_clip               add density
apply_effect             punchIn, kenBurns, freeze, glitch, speed, color
add_overlay              band, card, annotation, timer, badge, bubble
duck_music_under_voice   build the mix automation
check_timeline           validate and report what's wrong
```

A **single** Remotion composition (`TimelineRenderer`) consumes it. Adding a
scenario adds no rendering code at all.

**What it buys.** The agent can produce a cut the taxonomy never described — a
reaction/demo split offset by 300ms, a 220ms freeze on a number — because it
manipulates the same primitives a human editor does.

**What it costs.** The representation has to be validated before rendering, or a
model produces timelines with gaps, off-screen overlays and music over dialogue.
Hence `validateTimeline`, which refuses to render while a blocking error stands.

---

## 2. The YouTube quota is the constraint, not the AI

The instinct is that inference cost is the limit. That is wrong by an order of
magnitude.

| | |
| :--- | :--- |
| Cost to produce one video | $0.29 to $3.80 |
| A Google Cloud project's daily quota | 10,000 units |
| Cost of one `videos.insert` | 1,600 units |
| **Uploads possible** | **6 per day, per project** |

450 videos a month therefore needs **at least three Google Cloud projects**, or a
quota extension from Google, which takes weeks.

**What the code does about it.**

- `api_projects` is a **pool**; each upload routes to whichever project has the
  most quota left.
- `quota_ledger` records every call **including failures** — a failed upload still
  consumes quota, and a scheduler that ignores that believes in headroom it does
  not have.
- `search.list` (100 units) is **never** used on channels we own: we read the
  uploads playlist instead (1 unit).
- Metrics come from **YouTube Analytics**, which has a separate and far more
  generous quota. That is what makes per-video measurement economically possible
  across a fleet.

---

## 3. Quality control fails closed

A check delegated entirely to a model will happily approve a video whose proof
asset is a stand-in: the model only sees the script.

So `server/agents/qa.ts` runs the **mechanical** checks first, and they can block
on their own:

- any asset labelled as a stand-in — which is everything, when no video model is
  configured;
- a proof scenario with no real screen recording;
- a recording whose metadata does not explicitly say `captured: true` — an
  unlabelled capture is treated as a stand-in;
- an asset that failed to generate;
- a hook banner over seven words;
- a hook score under 82.

The model only judges what it can actually see: tone, claims, and conformity to
the brand's policy.

---

## 4. Explicit degradation rather than failure

Every integration has a fallback, and every fallback is **visible**.

| Missing | What happens |
| :--- | :--- |
| `DATABASE_URL` | Local PGlite, same dialect, same migrations |
| `GEMINI_API_KEY` | Rule-based planner backed by the knowledge base; **no real footage, and QA blocks everything** |
| Google Cloud credentials | Stand-in images, music and voice with **real** durations and timings |
| Playwright | Capture marked `isPlaceholder`, and QA refuses it |
| YouTube OAuth | Dry run: the pipeline executes, nothing is posted |

The third one matters most. A stand-in returning fake URLs would let the pipeline
"pass" while hiding every timing error until the day credentials arrive. By
producing real files with real durations, everything downstream — the editing
arithmetic, caption alignment, rendering, safe-area checks — genuinely executes.

Settings shows which mode is live at all times.

---

## 5. What the model decides, and what it does not

| Decided by the model | Decided by code |
| :--- | :--- |
| The character, their voice, their past | Archetype allocation when no model is available |
| A channel's angle | That the scenario mix sums to 1 |
| The script and the hook | The 82 threshold and the seven-word limit |
| Editing decisions | Safe-area and gap validation |
| The tone of a comment reply | The verdict on a video (pure arithmetic) |
| Why a result happened | The decision thresholds and the posteriors |
| Review recommendations | The guardrails: no kill under 21 days, never more than a third |

The rule is constant: **the model proposes, the code disposes** wherever a mistake
costs money, reputation or an account.

---

## 6. Why the channels belong to the user

The original brief described a fleet of fake accounts on residential proxies with
an anti-shadowban protocol.

That is not implementable honestly: it breaks the terms of every platform
involved, and the first suspension takes the whole network with it.

What was kept is **all of the strategy** — ten archetypes, ten awareness levels,
ten rules about when the brand may appear, the warming ramp, the spacing between
posts — applied to **channels the user owns and connects themselves**. The warming
ramp still matters regardless: a brand-new channel posting twice a day from day
one is recognisable as automated, terms of service aside.
