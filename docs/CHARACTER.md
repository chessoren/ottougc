# Characters

## The rule

**No video is generated before the character exists.** That is a precondition
checked in code, not a recommendation.

A creator that generates a shot with no character sheet produces a different face
in every shot. That is the most recognisable sign an account is synthetic — more
obvious than a robotic voice, more obvious than a flat edit.

## What gets built

### 1. This channel's own ICP

Not the brand's audience: the slice this particular channel aims at. Ten channels
with ten ICPs sound like ten people; ten channels sharing one sound like a brand
posting ten times.

The ICP states the pain as a **moment**, not a category: not "short on time" but
"it's 11pm on Sunday and they haven't started". It also carries `turnOffs` — what
would make this person scroll — and `stoppingThought`, the exact sentence that
would stop them.

### 2. The character sheet

- `anchor` — the locked description, in casting terms. Thirty words minimum: age,
  build, exact hair with length and texture, face shape, skin tone. This string is
  the character's identity and never changes again.
- `distinguishingFeatures` — two to four ordinary imperfections. An overlapping
  tooth, dark circles, a bad tattoo. A memorable face is not a pretty one.
- `wardrobe` — worn clothes, never new. A recurring wardrobe reads as one
  continuous person.
- `locations` — the two or three rooms this person films in, with the actual
  clutter in them.
- `voice` — pace, verbal tics, what this person would never say.

The check rejects an anchor under twenty-five words, an anchor describing an
ideal, a sheet with no distinguishing features, or a sheet with one location.
When the archetype seed is too short it is padded — but only on the points it does
not already fix: a seed saying "shoulder-length blonde hair" followed by a generic
"hair cut short" would give the model two incompatible faces.

### 3. The reference set

Seven images of the same face, generated from the anchor:

| Purpose | What it locks |
| :--- | :--- |
| `FRONT_NEUTRAL` | the geometry of the face — the master reference |
| `THREE_QUARTER` | the volume, three-quarters on |
| `EXPRESSION_SURPRISE` | how the face moves |
| `EXPRESSION_TIRED` | the same face with no energy |
| `WARDROBE_ALT` | that it is the same person on another day |
| `LOCATION_HOME` | the world around them |
| `FULL_BODY` | build and height |

Seven, because that is Gemini Omni Flash's input limit. The choice is not
arbitrary: more angles of the same neutral face would add nothing, while two
expressions and a second setting add everything.

These are passed into **every clip generation**. That is the consistency
mechanism, and it has no substitute: a text description alone drifts.

## How the references are rendered

They are requested as **photographs**, never portraits. The moment a model thinks
it is making a portrait it produces studio light and a symmetrical face, and the
character stops being believable as somebody posting from their phone.

Standard negatives: `professional headshot`, `beauty retouching`,
`airbrushed skin`, `model`, `symmetrical face`, `plain white background`.
