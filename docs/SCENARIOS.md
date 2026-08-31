# Scenarios

Why the taxonomy was rebuilt, and what it guarantees.

## What was wrong before

The original "formats" described videos by their **subject**: a comparison, a
testimonial, a tutorial. The result was twenty-eight variations of one chest-up
shot with a voice over it. On a recommendation feed, those twenty-eight videos
are one video posted twenty-eight times.

## The principle

A scenario is described by its **shape** first:

| Dimension | Values |
| :--- | :--- |
| duration | 4s to 45s |
| shots | 1 to 12 |
| face | none · one · two or more |
| speech | none · sync · voiceover · overheard |
| overlay | none · POV line · cards · kinetic captions · flat subtitles · chat · meme bands · fixed headline |
| music | none · bed · drives · punctuates |
| register | candid · staged · found · fiction |

Two scenarios sharing a shape signature are treated as **one arm** by the
allocator, whatever their scripts say. That is what stops a channel posting the
same video five times while believing it posted five different ones.

Current catalogue: **22 scenarios, 16 distinct shapes.**

## The second principle: these are not ads

Every scenario declares:

- `premise` — the situation. It says nothing about the product.
- `productRole` — the product's role **in the story**, not in the pitch.
- `brandEntry.atRatio` — the fraction of the story before which the brand cannot
  appear. Usually 0.7 or 0.8. Sometimes 1, meaning never.
- `brandEntry.manner` — how it appears. "Named by whoever loses the argument,
  grudgingly, in the last line."

The limit case is drama: the product isn't mentioned, it **is the plot's pivot**.
Remove it and the story has no ending. That is the only construction where a
brand can occupy thirty seconds without anyone's advertising guard going up.

## The families

| Family | Duration | What defines it |
| :--- | :--- | :--- |
| `MICRO` | 4–9s | One idea, usually one shot. Loops before you decide to scroll. |
| `SITUATION` | 10–25s | A situation, a turn, a consequence. |
| `DRAMA` | 20–45s | Openly fiction. The only family where production value is the point. |
| `FACELESS` | 8–25s | No face at all. The insurance policy, and the cheapest videos there are. |
| `REACTIVE` | 10–25s | Responds to a comment, a habit, a claim. |
| `EVIDENCE` | 12–20s | A real screen, in real time, uncut. |
| `SERIAL` | 10–18s | One episode. Never recaps. |

## Why prompts are compiled, not written

A model asked to "write a good video prompt" writes an adjective salad —
*cinematic, beautiful, 8k* — which produces exactly the plastic look that gets an
account dismissed in half a second.

So the two are separated:

- the model decides **what happens** and **what is said**;
- the code decides framing, motion, motivated light, sensor texture, room tone and
  the negatives.

The vocabularies are closed (`SHOT_SIZES`, `ANGLES`, `CAMERA_MOTION`, `LIGHTING`,
`TEXTURE`, `PERFORMANCE`, `AMBIENCE`) and every term is one a cinematographer
would actually use. Specificity is enforced by the type system, not requested in
a prompt.

The compiler orders the prompt by how much weight video models give each position:

```
register declaration → anchored subject → action → line → setting
→ framing → camera → light → texture → sound → negatives
```

The opening declaration depends on the shot archetype: telling a model "filmed on
a phone" and then asking for a staged scene on a cinema camera gives it two
incompatible instructions.

## What the negatives do

They matter as much as the positive prompt, because a model's default mode is the
commercial:

- `ANTI_COMMERCIAL` — studio lighting, advertisement, product hero shot, logo…
- `ANTI_PLASTIC` — airbrushed skin, flawless complexion, model, symmetrical face…
- `ANTI_CINEMA` — gimbal, drone, lens flare, teal and orange grade…
- `ANTI_STAGED` — posed, tidy showroom, props arranged neatly…
- `ANTI_TEXT` — subtitles, watermark, burnt-in text…

`ANTI_CINEMA` is dropped for `DRAMA` archetypes: leaving it in would destroy the
one family that actually needs composition.
