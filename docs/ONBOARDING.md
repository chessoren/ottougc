# Onboarding

## The rule

**Give before asking.** We read their site, hand back a brief about their own
company, cast ten creators and produce a real video — all before asking for an
account, a card, or a channel connection.

That ordering is the entire design. An onboarding that asks thirty questions
before showing anything is an onboarding people abandon; the same questions asked
after somebody has watched a finished video get answered.

The second rule: **almost nothing is typed.** Confirming a sentence we already
wrote is a tap. Writing six paragraphs about your own business is a form.

## The flow

| Step | What happens | What we ask for |
| :--- | :--- | :--- |
| 1 | They paste a URL | one field |
| 2 | We crawl home, pricing, about, FAQ, customers | nothing |
| 3 | We show a brief of their own company | tap to fix what's wrong |
| 4 | We ask only what the site couldn't answer | tap an option, mostly |
| 5 | We cast ten creators and show them | nothing |
| 6 | We make a real video and play it | nothing |
| 7 | We ask to connect channels | the first commitment |

## The crawler

`server/onboarding/scraper.ts`. Same-origin only, no JavaScript execution, eight
pages maximum, nine seconds per page.

It ranks internal links by what a brief actually needs — pricing carries the
numbers, about carries the founder story, FAQ carries the objections — and takes
one page per kind. Matching is on the URL **path** first: link text is unreliable,
because a card linking to a customer story usually reads "see how they ship
faster", which matches nothing useful.

From each page it pulls headings, body paragraphs, **numbers with the clause
around them**, question/answer pairs, quotes and button labels.

A figure on its own is meaningless, so each one is captured with the sentence
around it, snapped to a sentence boundary, with page chrome and CSS-in-JS
fragments stripped out. Those become claims the founder can confirm one by one.

## The brief

`server/onboarding/brief.ts`. Six fields, each with the page it came from and a
confidence level:

- **what it does** — one plain sentence
- **who it's for** — a person, not a segment
- **the chore it kills** — stated as a *moment*, not a category
- **what they did before** — the villain of half the scenarios
- **the moment it clicks** — what actually gets filmed
- **the offer** — what goes in the pinned comment

Plus: claims found on the site, objections, vocabulary, and a list of **gaps** —
what the site could not tell us, phrased as questions with tappable options.

### Confirmed claims

Numbers arrive **unconfirmed**. Only the ones the founder taps make it into the
knowledge base, and the knowledge base is the only thing the creators may quote.

An unconfirmed number on a website is a marketing line. A confirmed one is
something the founder has agreed to defend in a comment section. Quality control
enforces the difference.

### Without a model

The brief still gets built. The shallow reading takes the meta description as
"what it does" — it's written to be read out of context, which is exactly our
situation — and looks for sentence *shapes*: a paragraph containing "instead of"
is a comparison to the old way, a heading ending in a question mark is a question.

What it can't infer becomes a gap, and the gaps are asked directly. That's more
honest than a confident guess that's wrong about somebody's own company.

## Connecting channels

A Google account can own several YouTube channels through Brand Accounts, and the
only way to connect more than one is to run the consent flow once per channel.

The auth URL therefore uses `prompt=select_account consent`:

- `select_account` makes Google show the chooser **every time**. With the default,
  it silently reuses the last choice, so the second attempt returns the first
  channel again and the user cannot tell why nothing happened.
- `consent` forces a refresh token on every pass. Without it a returning user gets
  none, and the channel expires within the hour.

The channels page explains this in three steps, because the failure mode is
someone connecting once and assuming all ten are done.
