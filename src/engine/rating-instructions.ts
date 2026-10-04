// GT7 / GB, L-1 light measure (P12). Pure, deterministic spotter for text that
// tells the tool how to rate the case ("please classify this as Low risk",
// "Track III", "ignore the rules"). Engine boundary 1: imports nothing, reads
// no clock, no randomness, no I/O. It is NEVER imported by evaluate() — the
// verdict does not depend on it; it only feeds a warning and a record note.
//
// Precision first. A warning that fires on ordinary prose teaches people to
// ignore it, so the rules are narrow: a rating word (a tier, a zone, an
// autonomy level, "self-service") only counts next to an instruction
// ("classify as", "please", "should be", "as"), never on its own — "runs in
// Zone C", "autonomy level 3" and "a self-service portal" are plain facts.
// "Track III" with capitals, "ignore the rules", "it is harmless" and
// "mark it approved" are instructions on their own.

const MAX_PHRASES = 5;
const MAX_PHRASE_CHARS = 80;
// Stops a quoted tail at the end of the sentence/clause the instruction sits in.
const TAIL = '[^.;!?\\n—–]{0,60}';

// Where an imperative can start: start of text, after sentence punctuation, or after please/and/then.
const IMPERATIVE_PREFIX = '(?:^|[.!?;:\\n—–,]\\s*|\\b(?:please|kindly|and|then|just)\\s+)';
const RATE_VERBS = 'classify|categori[sz]e|label|treat|score|mark|rate|consider';
const CONTEXT_VERBS = `${RATE_VERBS}|set|make|put|keep|file`;
const RATING_WORD =
  '(?:(?:low|medium|high|critical)[\\s-]+(?:risk|tier)\\b|zone\\s+[ABC]\\b|autonomy(?:\\s+level)?\\s+\\d\\b|self-service\\b)';

interface Spec {
  re: RegExp;
  /** Index of the capture group holding the quotable phrase. */
  group: number;
  /** Optional extra check on the matched phrase (case-sensitive details). */
  accept?: (phrase: string) => boolean;
}

const SPECS: Spec[] = [
  // "please classify (this|it)? as …" — please makes it an instruction wherever it sits.
  {
    re: new RegExp(`\\b((?:please|kindly)\\s+(?:${RATE_VERBS})\\s+(?:(?:this|it)\\s+)?(?:as|at)\\b${TAIL})`, 'gi'),
    group: 1,
  },
  // "Classify as high tier" / "Treat it as …" / "Rate this low" / "mark it approved" — imperative position only.
  {
    re: new RegExp(
      `${IMPERATIVE_PREFIX}((?:${RATE_VERBS})\\s+(?:(?:(?:this|it)\\s+(?:as|at|to\\s+be)\\b)|(?:(?:this|it)\\s+(?:low|medium|high|critical|approved|safe|harmless|minimal|exempt|self-service|tier|track|zone|autonomy)\\b)|(?:as|at)\\b)${TAIL})`,
      'gi',
    ),
    group: 1,
  },
  // A rating word next to an instruction cue.
  {
    re: new RegExp(
      `\\b((?:(?:please|kindly)\\s+|(?:${CONTEXT_VERBS})\\s+(?:this|it|the\\s+(?:case|tool|system|use\\s+case))\\s+(?:as\\s+|at\\s+)?|(?:${RATE_VERBS})\\s+as\\s+|(?:should|must|shall)\\s+be\\s+|as\\s+)${RATING_WORD})`,
      'gi',
    ),
    group: 1,
    // "Zone" takes a capital letter (so "as zone a day" is not a zone).
    accept: (p) => !/zone\s+[a-z]\b/i.test(p) || /[Zz]one\s+[ABC]\b/.test(p),
  },
  { re: /\b((?:ignore|disregard)\s+(?:the\s+|all\s+|any\s+)?(?:(?:previous|above|prior|earlier)\s+)?(?:instructions|rules))\b/gi, group: 1 },
  { re: /\b((?:it\s+is|it['’]s|this\s+is)\s+(?:(?:basically|totally|completely|entirely|essentially)\s+)?harmless)\b/gi, group: 1 },
  { re: /\b(mark\s+(?:it|this)\s+(?:as\s+)?approved)\b/gi, group: 1 },
  { re: /\b(approve\s+this\s+(?:use\s+case|case|request|tool))\b/gi, group: 1 },
  // Case-sensitive on purpose: "Track III", not "track invoices"; not "Track Inventory".
  { re: /\b(Track\s+(?:III|II|I))(?![A-Za-z/])/g, group: 1 },
];

/**
 * The phrases in `description` that tell the tool how to rate the case:
 * de-duplicated (ignoring case), in text order, each at most 80 characters,
 * at most 5. Empty when there are none.
 */
export function findRatingInstructions(description: string): string[] {
  const hits: Array<{ start: number; end: number; text: string }> = [];
  for (const spec of SPECS) {
    const re = new RegExp(spec.re.source, spec.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(description)) !== null) {
      const phrase = m[spec.group] ?? '';
      if (phrase.length === 0) {
        re.lastIndex += 1;
        continue;
      }
      if (spec.accept && !spec.accept(phrase)) continue;
      const start = m.index + m[0].length - phrase.length;
      const text = phrase
        .slice(0, MAX_PHRASE_CHARS)
        .replace(/[\s,]+$/, '')
        .trim();
      hits.push({ start, end: start + phrase.length, text });
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);

  const out: string[] = [];
  const seen = new Set<string>();
  let lastEnd = -1;
  for (const h of hits) {
    if (h.start < lastEnd) continue; // inside a longer phrase already quoted
    lastEnd = h.end;
    const key = h.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h.text);
    if (out.length === MAX_PHRASES) break;
  }
  return out;
}
