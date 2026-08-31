# OttoUGC

## The video that made no sound

The woman on screen is talking. Her mouth moves, she leans toward the phone, she gets to the number and stops — the small involuntary pause of someone who still can't believe it.

You can't hear her.

Under her runs a music bed, correctly mixed, correctly ducked, at exactly the level the specification asks for. Everything else in the frame is right: the freckles, the coffee stain on the grey sweatshirt, the takeaway menus stuck to the fridge behind her. The pipeline had done its work. Ten agents, seven models, a storyboard, a render at 1080×1920 and 60fps.

And it had produced a video of a woman being inaudible.

I measured it rather than argued about it: $-42$ dBFS RMS. The renderer was muting every clip, on one line, with a comment explaining why — an assumption that had been correct for a year and had quietly stopped being true.

That is the honest shape of this project. Not a clever idea executed cleanly. A long argument with a machine about what "working" means.

---

## What inspired it

An app pays a creator $2{,}000 for one video. The video gets 4{,}000 views. Nobody involved can say in advance whether the next one will do ten times better or ten times worse, and there is no mechanism to find out except to pay again.

The maths of short-form is brutally uneven. A small fraction of posts carry almost all of the distribution, and which fraction is not knowable in advance — only in retrospect. So the economics only close at volume, and volume needs people: writers, performers, editors, someone to post at 18:30 every day for six months. Which is why almost nobody does it, and why the ones who do it well are agencies charging accordingly.

I wanted to know whether the whole loop — deciding, writing, filming, cutting, posting, and *learning from the numbers* — could run without anybody in it.

Not a video generator. A creator that wakes up.

---

## What it does

Ten synthetic creators run on your own YouTube channels. Each one has a face, a room, a way of speaking, a strategy and a memory.

At 07:00, each agent wakes up on its own — Cloud Scheduler, not a person — and works through its day:

- it reads what it learned yesterday;
- it looks at what its last videos actually did at 2h, 24h and 72h;
- it picks a **shape** it has not just used, because two videos with the same length, the same speech mode and the same on-screen text look identical to somebody scrolling, whatever their scripts say;
- it writes a *situation* rather than an advert — someone gets a message they can't answer, someone is up too late finishing something they shouldn't have had to do — and the product arrives once, late, in passing;
- it draws the whole thing as a storyboard, films it, cuts it, checks it, posts it;
- and it writes down what it learned, with the numbers in it.

Then the decision grid does its work. Every post is scored on rates, never absolutes, because a channel with more subscribers would otherwise always win and the fleet would stop learning anything about the *creative*:

$$S \;=\; 1.8\,W_{3s} \;+\; 4.5\,\mathrm{CR}_{100} \;+\; 5.0\,\frac{\text{shares}}{\text{views}} \;+\; 3.5\,\frac{\text{saves}}{\text{views}}$$

Below threshold three times, a format is dropped. Above it, doubled. The channel's own posterior over formats updates, and tomorrow's choice is drawn from it — mostly exploiting what works, deliberately exploring what hasn't been tried.

---

## How I built it

Six Google models, all through Vertex AI, each doing the one thing it is best at:

| | |
| :--- | :--- |
| **Gemini 3.7 Flash** | the agent loop — 51 tools, thinking set high, and the vision judge that inspects every frame before it is animated |
| **Gemini 3 Pro Image** (Nano Banana 2) | a seven-photograph character sheet, then one storyboard panel per shot |
| **Gemini Omni Flash** | animates an approved panel, with the dialogue rendered in sync inside the clip |
| **Lyria 002** | the music bed |
| **Chirp 3 HD** | narration, where the scenario calls for it |
| **Speech-to-Text** | word timings, read back off the generated audio |

On Cloud Run, against Cloud SQL, woken by Cloud Scheduler. Media that people will look at again is copied to Cloud Storage, because the container's filesystem lives in memory and disappears minutes after the daily run ends.

**The craft is deliberately not the model's job.** A model asked to write a video prompt writes adjective salad — *cinematic, beautiful, 8k* — and adjective salad produces exactly the plastic look that gets a UGC account dismissed in half a second. So shots are compiled from closed, typed vocabularies: framing, motivated light, sensor behaviour, performance direction. The model supplies only what genuinely requires judgement — who is in the shot, what happens, what is said. The agent chooses *which* video exists today and *why*. That is the part no procedure can do for it.

**The storyboard layer is the one idea I would keep if I had to throw the rest away.** The image model is far better than the video model at composition, at detail, and above all at holding a face. Asking the video model to invent the framing *and* animate it gets both jobs done at the quality of the weaker one. So the frame is decided in stills: a panel per shot, each conditioned on the character's own photographs and on the panel before it, so the room and the clothes and the light carry over as pixels rather than as adjectives. A vision pass then rejects any panel with the wrong face, a fabricated interface, or burnt-in text. Only approved panels are animated.

---

## The challenges

Four of them changed how I think.

**The agent could not exist, and it was a protocol bug.** Gemini 3.x attaches a thought signature to every function call and refuses the next request if it is missing. The runtime was rebuilding the model's turn from `{name, args}` — dropping the signature — so every tool-using run died at step two with a 400. It also requires the responses for a turn to come back as *one* user turn with exactly as many parts as the turn had calls. Two protocol details, and until both were right there was no agent, only a pipeline wearing a prompt.

**Imagen does not exist on this account.** Five published model ids, five 404s. And the Gemini image models refuse the `predict` endpoint that the SDK's `generateImages()` calls, with `FAILED_PRECONDITION`. So no character reference image had *ever* been generated — the sheet was full of labelled placeholders, the video model got no references, and every shot invented a new face. The fix was `generateContent` with image output, which is also what makes reference images an *input*, which is the only reason the storyboard layer is possible at all.

**Cloud Run withdraws the CPU when the request returns.** Renders were fire-and-forget — correct for a long-lived server, fatal here. A render left running does not fail. It freezes, at whatever percent it reached, for ever. Three runs sat at 0% while I looked for a bug in the renderer that was not there. The CLI had always awaited the render queue, which is precisely why rendering worked on a laptop and had never once worked in the cloud.

**And the videos kept lying.** A shot directed as "an insert on the screen" came back with a fabricated Shopify dashboard. Another with a fake Instagram analytics grid. A selfie came back with an entire iPhone camera app painted over the image, mode tabs reading `FENTO VIDEO MATEO PHOTO FORMOTO`. The negative prompt already said "no text overlay" — the model simply did not classify a user interface as text. Now the negative list is a bug log rather than a wish list, every entry naming something actually seen in a rejected frame; a positive clause states that *the camera IS the phone*; and a shot that scripts a screen with no real capture to show has the screen removed from its direction. Showing nothing beats showing a forgery, in a product whose entire claims policy exists to stop exactly that.

---

## What I learned

**Move every rejection to the cheapest stage that can catch it.**

That sentence is most of the engineering here. Let $c_i$ be the cost of a rejection at stage $i$ and $p_i$ the probability of catching a given defect there. Expected waste is

$$\mathbb{E}[\text{waste}] \;=\; \sum_i p_i \, c_i$$

and the entire game is shifting probability mass leftward, toward small $c_i$.

An invented figure caught by quality control costs a whole video — every clip generated, every second rendered. Caught at write time it costs one model call. So the writer now checks its own numbers against the brand's published material before a frame exists.

A wrong frame caught after generation costs about $\$0.60$ and forty seconds. Caught as a storyboard panel it costs about $\$0.13$ and three. That ratio — roughly five to one in money, thirteen to one in time — is why the storyboard exists at all. It is not a documentation step. It is where the failure rate is *supposed* to live.

The second lesson is smaller and cost me more hours: **a creative step that fails quietly is worse than one that fails loudly.** The scene writer swallowed every error into a convincing template fallback. The videos still shipped. Nobody noticed the model had stopped writing.

---

## What's next

Multi-tenant onboarding. The paid amplification loop for videos the decision grid marks as outliers. And the flywheel the product is named for: OttoUGC running OttoUGC's own channels, on the same code path as any customer, so that the showcase on the landing page is not a portfolio but a proof — if it stopped working, that page would have nothing to show.

The woman in the kitchen has a voice now. It took finding out that "working" and "watchable" are two different tests, and that only the second one counts.
