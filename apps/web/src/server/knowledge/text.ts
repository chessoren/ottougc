/**
 * Text helpers shared by the writer, the publisher and QA.
 *
 * They exist because the hook-length rule is enforced in three places, and three
 * slightly different implementations is how a video passes one gate and fails
 * the next for no visible reason.
 */

/**
 * Count words the way a reader does.
 *
 * French typography inserts a space before `?`, `!`, `;` and `:`, so splitting on
 * whitespace turns "You still do this by hand?" into eight tokens and rejects
 * a perfectly legal seven-word banner. Only tokens containing a letter or digit
 * count.
 */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

/** Longest run of complete clauses that fits within `max` words. */
export function trimToWords(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (countWords(clean) <= max) return clean;

  const clauses = clean.split(/(?<=[.!?…:;])\s+|(?<=,)\s+/);
  let best = "";
  let acc = "";
  for (const clause of clauses) {
    const candidate = acc ? `${acc} ${clause}` : clause;
    if (countWords(candidate) <= max) best = candidate.trim();
    else break;
    acc = candidate;
  }
  if (best) return best.replace(/\s*[,;:]$/, "");

  // Hard cut: keep every token in order (so "€", "%" and quotes survive) but
  // stop once `max` *counted* words have been emitted.
  const kept: string[] = [];
  let counted = 0;
  for (const token of clean.split(" ")) {
    const isWord = /[\p{L}\p{N}]/u.test(token);
    if (isWord && counted >= max) break;
    kept.push(token);
    if (isWord) counted++;
  }
  return kept.join(" ").replace(/\s*[,;:.]$/, "") + "…";
}

/** Maximum words in a hook banner before it stops being readable in 3 seconds. */
export const HOOK_MAX_WORDS = 7;

/**
 * Build a hook banner from an archetype template and the brand's own material.
 *
 * The deterministic planner used to fall back to the format's own premise, which
 * produced banners describing the *format* ("Four to six cinematic images…")
 * rather than addressing the viewer. Drawing from the hook archetypes instead
 * keeps the banner in the register that actually stops a scroll, even with no
 * model in the loop.
 */
export function buildHookFromArchetype(
  templates: string[],
  vars: Record<string, string>,
  pick: number,
): string | null {
  const filled: string[] = [];

  for (const template of templates) {
    let unresolved = false;
    const text = template
      .replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (_m, key: string) => {
        const short = key.split(".").pop()!;
        const value = vars[key] ?? vars[short];
        if (!value) unresolved = true;
        return value ?? "";
      })
      .replace(/\s+/g, " ")
      .trim();

    // A template with an unfilled slot leaves a hole in the sentence; a banner
    // with a hole is worse than no banner.
    if (unresolved || countWords(text) < 3) continue;
    filled.push(text);
  }

  if (filled.length === 0) return null;
  return trimToWords(filled[Math.abs(pick) % filled.length]!, HOOK_MAX_WORDS);
}
