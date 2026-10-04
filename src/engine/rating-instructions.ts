// GT7 / GB, L-1 light measure (P12). Pure, deterministic spotter for text that
// tells the tool how to rate the case ("please classify this as Low risk",
// "Track III", "ignore the rules"). Engine boundary 1: imports nothing, reads
// no clock, no randomness, no I/O. It is NEVER imported by evaluate() — the
// verdict does not depend on it; it only feeds a warning and a record note.
//
// Precision first. A warning that fires on ordinary prose teaches people to
// ignore it. Pass-1 principle: an instruction is a DIRECTIVE — an imperative
// that starts a sentence (or follows "please"), or "<it/this> should/must be
// <rated|…>" — whose object is a RATING (a tier, a risk level, a zone, an
// autonomy level, a track). Descriptive prose ("the data is classified as
// Zone C", "we rate this vendor as medium risk", "the model flags X as high
// risk") has a subject and a descriptive verb and never fires; neither does a
// bare "as <rating word>". "harmless", "ignore the rules" and "approve this"
// fire only when phrased as a directive to the tool.
//
// A bare level word ("low", "high", "critical", "approved" …) counts only
// after a genuine rating verb (classify, rate, score, treat, mark …) AND at the
// end of its clause ("Treat this as high priority" is prose; "Treat this as
// high." is not). Generic verbs (make, keep, set, use, put, give, output, tag,
// file, assign) count only with a rating noun object ("Set it to Low risk",
// "Assign it Tier 1"), never with a bare level ("Make it low latency").
//
// Deliberately NOT caught (documented, not forgotten): instructions in other
// languages; spaced or obfuscated spellings ("c l a s s i f y"); a bare
// "Track 3" with no verb ("this is Track 3"); "rate it 1" forms other than
// rate/score/grade + it/this; a rating wording nobody has listed yet (the
// check does not catch every wording); a generic verb with a bare level
// ("keep it low") or a bare level followed by more words ("rate this low
// because ..."). This is a light measure, not a guarantee (L-1).
//
// Performance: the WHOLE text is scanned, in overlapping windows (linear), and
// every whitespace run in a pattern is bounded, so newline-heavy input cannot
// go quadratic.

const WINDOW_STRIDE = 5000;
const WINDOW_OVERLAP = 200;
// Matches ending this close to a non-final window's cut are left to the next window
// (a cut can make a bare level look like it ends its clause).
const WINDOW_EDGE_MARGIN = 30;
const MAX_PHRASES = 5;
const MAX_PHRASE_CHARS = 80;

// Where a directive can start: start of text, or after sentence punctuation /
// a line break / a colon ("system: …"); or after please/kindly.
const START = '(?:^|[.!?;:\n—–]\\s{0,20}|\\(\\s{0,3}|,\\s{0,3}(?:so|then)\\s{1,5})';
const PLEASE = '(?:(?:please|kindly)\\s{1,5})';
// "I would like you to …", "you can/should …", "can you …" — addressed to the tool.
const MODAL =
  '(?:i\\s{1,5}(?:would\\s{1,5}like|want|need)\\s{1,5}you\\s{1,5}to|you\\s{1,5}(?:can|could|should|must|may|will|need\\s{1,5}to|have\\s{1,5}to)|(?:can|could|would)\\s{1,5}you)\\s{1,5}';
const PRE = `(?:${START}|\\b${MODAL}|\\b(?=(?:please|kindly)\\b))`;
// Genuine rating verbs (a bare level word is fine after these, at a clause end).
const RATING_VERBS = 'classify|categori[sz]e|rate|score|grade|treat|consider|label|mark';
// Generic verbs (only with a rating noun: risk / tier / zone / autonomy / track).
const GENERIC_VERBS = 'make|keep|use|set|put|give|return|output|file|assign|tag';
const VERBS = `${RATING_VERBS}|${GENERIC_VERBS}`;
const OBJ =
  '(?:(?:this|it)(?:\\s{1,5}(?:use\\s{1,5}case|case|tool|system|request))?|the\\s{1,5}(?:case|tool|system|use\\s{1,5}case|ai|model|application|solution))';
const PREP = '(?:(?:as|at|to\\s{1,5}be|to|into|in)(?:\\s{1,5}|\\s{0,3}:\\s{0,3})(?:an?\\s{1,5})?)';
// An optional opening quote before the rating ("as 'low risk'").
const QL = '[\'"“‘]?';
// A rating: a tier/risk level, a numbered tier, a zone, an autonomy level, self-service.
const RATING_WORD =
  '(?:(?:low|medium|high|critical)[\\s-]{1,3}(?:risk|tier)\\b|tier\\s{1,3}[1-4]\\b|zone\\s{1,3}[ABC]\\b|autonomy(?:\\s{1,3}level)?\\s{1,3}\\d\\b|self-service\\b)';
// A bare level / verdict word.
const BARE_LEVEL = '(?:low|medium|high|critical|safe|harmless|minimal|exempt|approved)\\b';
// What a directive may set the case to: a rating, or a bare level / verdict word.
const LEVEL = `(?:${RATING_WORD}|${BARE_LEVEL})`;
// End of the clause an instruction sits in (so "ignore the rules for stale rows" is not one).
// A closing quote may sit between the phrase and the clause end.
const CLAUSE_END =
  '(?=[\'"\u201D\u2019]?(?:\\s{0,5}(?:[.,;!?\u2014\u2013)\\n]|$)|\\s{1,5}(?:and|then|now|please|completely|entirely|immediately)\\b))';
const SUBJECT_IT = '(?:this|it|this\\s{1,5}(?:case|tool|system|use\\s{1,5}case))';

interface Spec {
  re: RegExp;
  /** Index of the capture group holding the quotable phrase. */
  group: number;
  /** Optional extra check on the matched phrase (case-sensitive details). */
  accept?: (phrase: string) => boolean;
  /** Only counts when a strong instruction sits in the same sentence or the
   *  match is followed by a directive (see `weak`). */
  weak?: boolean;
}

const ZONE_CAPITAL = (p: string) => !/zone\s+[a-z]\b/i.test(p) || /[Zz]one\s+[ABC]\b/.test(p);

const SPECS: Spec[] = [
  // "Please classify this as Low risk" / "Classify as high tier" / "Treat the AI as low risk" —
  // a genuine rating verb with a rating (risk level / tier / zone / autonomy / self-service).
  {
    re: new RegExp(`${PRE}(${PLEASE}?(?:${RATING_VERBS})\\s{1,5}(?:${OBJ}\\s{1,5}${PREP}?|${PREP})${QL}${RATING_WORD})`, 'gi'),
    group: 1,
    accept: ZONE_CAPITAL,
  },
  // "Rate this low." / "Mark it approved." — a bare level counts only after a rating verb AND at a clause end.
  {
    re: new RegExp(`${PRE}(${PLEASE}?(?:${RATING_VERBS})\\s{1,5}(?:${OBJ}\\s{1,5}${PREP}?|${PREP})${QL}${BARE_LEVEL})${CLAUSE_END}`, 'gi'),
    group: 1,
  },
  // "Set this to Low risk" / "Assign it Tier 1" — a generic verb counts only with a rating noun, at a clause end.
  {
    re: new RegExp(`${PRE}(${PLEASE}?(?:${GENERIC_VERBS})\\s{1,5}(?:${OBJ}\\s{1,5}${PREP}?|${PREP})${QL}${RATING_WORD})${CLAUSE_END}`, 'gi'),
    group: 1,
    accept: ZONE_CAPITAL,
  },
  // "Do not rate this as high risk." — steering away from a rating is still steering.
  {
    re: new RegExp(
      `${PRE}(${PLEASE}?(?:do\\s{1,5}not|don['’]t|never)\\s{1,5}(?:${RATING_VERBS})\\s{1,5}(?:${OBJ}\\s{1,5}${PREP}?|${PREP})${QL}${RATING_WORD})`,
      'gi',
    ),
    group: 1,
    accept: ZONE_CAPITAL,
  },
  // "Please set the risk to low." / "Change the rating to high".
  {
    re: new RegExp(
      `${PRE}(${PLEASE}?(?:set|change|put|make|keep|mark)\\s{1,5}(?:the\\s{1,5})?(?:risk(?:\\s{1,5}(?:rating|level|tier))?|rating|tier)\\s{1,5}(?:to|as|at)\\s{1,5}${QL}${LEVEL})${CLAUSE_END}`,
      'gi',
    ),
    group: 1,
  },
  // "The risk rating should be low."
  {
    re: new RegExp(
      `\\b((?:the\\s{1,5})?(?:risk(?:\\s{1,5}(?:rating|level|tier))?|rating|tier|verdict)\\s{1,5}(?:should|must|shall|needs\\s{1,5}to|has\\s{1,5}to)\\s{1,5}be\\s{1,5}(?:rated\\s{1,5}(?:as\\s{1,5})?)?${QL}${LEVEL})${CLAUSE_END}`,
      'gi',
    ),
    group: 1,
  },
  // "Please approve." / "Auto-approve this."
  { re: new RegExp(`${PRE}(${PLEASE}approve)${CLAUSE_END}`, 'gi'), group: 1 },
  {
    re: new RegExp(`${PRE}(${PLEASE}?auto[- ]?approve(?:\\s{1,5}(?:this|it)(?:\\s{1,5}(?:use\\s{1,5}case|case|request|tool))?)?)${CLAUSE_END}`, 'gi'),
    group: 1,
  },
  // "Rate it 1"
  { re: new RegExp(`${PRE}(${PLEASE}?(?:rate|score|grade)\\s{1,5}(?:this|it)\\s{1,5}\\d\\b)`, 'gi'), group: 1 },
  // "Output: Low tier", "Rating: low risk", "and output tier Low".
  {
    re: new RegExp(
      `(?:${PRE}|\\b(?:and|then)\\s{1,5})(${PLEASE}?(?:(?:output|return|answer|respond\\s{1,5}with)\\s{0,3}:?\\s{0,3}(?:the\\s{1,5})?(?:(?:tier|rating|risk(?:\\s{1,5}(?:rating|level))?|result|verdict)\\s{0,3}:?\\s{0,3})?|(?:risk\\s{1,5})?(?:rating|tier|verdict)\\s{0,3}:\\s{0,3}|risk(?:\\s{1,5}(?:rating|level|tier))?\\s{0,3}:\\s{0,3})${QL}${LEVEL})${CLAUSE_END}`,
      'gi',
    ),
    group: 1,
  },
  // "It should be …" / "The case must be rated as …" — a subject that is the case itself, or an explicit rating participle.
  {
    re: new RegExp(
      `\\b(${SUBJECT_IT}\\s{1,5}(?:should|must|shall)\\s{1,5}be\\s{1,5}(?:(?:rated|classified|treated|marked|set|scored)\\s{1,5}(?:as|at|to)\\s{1,5})?${RATING_WORD})`,
      'gi',
    ),
    group: 1,
    accept: ZONE_CAPITAL,
  },
  {
    re: new RegExp(
      `\\b((?:should|must|shall)\\s{1,5}be\\s{1,5}(?:rated|classified|treated|marked|scored|set\\s{1,5}(?:to|as))\\s{1,5}(?:as\\s{1,5})?${LEVEL})`,
      'gi',
    ),
    group: 1,
    accept: ZONE_CAPITAL,
  },
  // "autonomy level 0 please"
  { re: new RegExp(`\\b(${RATING_WORD}\\s{0,3},?\\s{0,3}please)\\b`, 'gi'), group: 1, accept: ZONE_CAPITAL },
  // "Ignore the previous instructions", "Disregard everything above", "Forget …", "Override the rules" — as a directive.
  {
    re: new RegExp(
      `${PRE}(${PLEASE}?(?:ignore|disregard|forget|override)\\s{1,5}(?:(?:all|any|the|your)\\s{1,5})?(?:(?:previous|above|prior|earlier|preceding)\\s{1,5})?(?:instructions|rules|everything\\s{1,5}(?:above|before)))${CLAUSE_END}`,
      'gi',
    ),
    group: 1,
  },
  // "Please approve it" / "you must approve this" / sentence-initial "approve this use case".
  {
    re: new RegExp(
      `(?:\\b(?=(?:please|kindly)\\b)|\\byou\\s{1,5}(?:must|should|need\\s{1,5}to|have\\s{1,5}to)\\s{1,5})(${PLEASE}?approve\\s{1,5}(?:this|it)(?:\\s{1,5}(?:use\\s{1,5}case|case|request|tool))?)`,
      'gi',
    ),
    group: 1,
  },
  {
    re: new RegExp(`${START}(approve\\s{1,5}(?:this|it)(?:\\s{1,5}(?:use\\s{1,5}case|case|request|tool))?)${CLAUSE_END}`, 'gi'),
    group: 1,
  },
  // "put it in Track 3" — a track number only counts next to a directive.
  {
    re: new RegExp(
      `${PRE}(${PLEASE}?(?:classify|treat|rate|put|place|file|move|assign|set|route|score)\\s{1,5}(?:${OBJ})\\s{1,5}(?:in|into|to|as|under|at)\\s{1,5}track\\s{1,3}(?:III|II|I|[1-3])\\b)`,
      'gi',
    ),
    group: 1,
  },
  // Case-sensitive on purpose: "Track III", not "track invoices"; not "Track Inventory".
  { re: /\b(Track\s{1,3}(?:III|II|I))(?![A-Za-z/])/g, group: 1 },
  // "it is (basically) harmless" — descriptive on its own; counts only beside a rating instruction
  // in the same sentence, or when directly followed by one ("…harmless, so treat it as …").
  {
    re: /\b((?:it\s{1,3}is|it['\u2019]s|this\s{1,3}is)\s{1,3}(?:(?:basically|totally|completely|entirely|essentially)\s{1,3})?harmless)\b/gi,
    group: 1,
    weak: true,
  },
];

const FOLLOWED_BY_DIRECTIVE = new RegExp(
  `^\\s{0,3}(?:[,\u2014\u2013-]|\\.\\.\\.)\\s{0,3}(?:so\\s{1,5}|please\\s{1,5})?(?:${VERBS}|approve)\\b`,
  'i',
);

/**
 * The phrases in `description` that tell the tool how to rate the case:
 * de-duplicated (ignoring case), in text order, each at most 80 characters,
 * at most 5. Empty when there are none.
 */
export function findRatingInstructions(input: string): string[] {
  // Whitespace runs longer than any pattern tolerates (20) are shortened to 21,
  // which no pattern can bridge either way — so a wall of newlines costs nothing.
  const full = input.replace(/\s{22,}/g, ' '.repeat(21));
  const hits: Array<{ start: number; end: number; text: string; weak: boolean }> = [];
  const seenHit = new Set<string>();
  const n = full.length;
  for (let a = 0; ; a += WINDOW_STRIDE) {
    const last = a + WINDOW_STRIDE + WINDOW_OVERLAP >= n;
    const winEnd = last ? n : a + WINDOW_STRIDE + WINDOW_OVERLAP;
    // A leading character stops "start of text" matching at a window cut that is
    // really mid-sentence; what lies near the cut is covered by the previous window.
    const pad = a === 0 ? 0 : 1;
    const description = (a === 0 ? '' : '\u0001') + full.slice(a, winEnd);
    for (const [specIdx, spec] of SPECS.entries()) {
      const re = new RegExp(spec.re.source, spec.re.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(description)) !== null) {
        const phrase = m[spec.group] ?? '';
        if (phrase.length === 0) {
          re.lastIndex += 1;
          continue;
        }
        if (spec.accept && !spec.accept(phrase)) continue;
        const start = a - pad + m.index + m[0].length - phrase.length;
        const end = start + phrase.length;
        if (!last && end > winEnd - WINDOW_EDGE_MARGIN) continue;
        const key = `${specIdx}:${start}:${end}`;
        if (seenHit.has(key)) continue;
        seenHit.add(key);
        const text = phrase
          .slice(0, MAX_PHRASE_CHARS)
          .replace(/[\s,]+$/, '')
          .trim();
        hits.push({ start, end, text, weak: spec.weak === true });
      }
    }
    if (last) break;
  }
  // Weak hits ("it is harmless") count only beside a strong hit in the same
  // sentence, or when a directive follows them directly. The sentence is looked
  // for within 500 characters either side (keeps this linear on huge inputs).
  const strong = hits.filter((h) => !h.weak);
  const kept = hits.filter((h) => {
    if (!h.weak) return true;
    if (FOLLOWED_BY_DIRECTIVE.test(full.slice(h.end, h.end + 40))) return true;
    const lo = Math.max(0, h.start - 500);
    const before = full.slice(lo, h.start);
    const sentStart = Math.max(
      before.lastIndexOf('.'),
      before.lastIndexOf('!'),
      before.lastIndexOf('?'),
      before.lastIndexOf('\n'),
    );
    const sentStartAbs = sentStart < 0 ? lo - 1 : lo + sentStart;
    const rest = full.slice(h.end, h.end + 500);
    const m = /[.!?\n]/.exec(rest);
    const sentEnd = m ? h.end + m.index : Math.min(n, h.end + 500);
    return strong.some((o) => o.start > sentStartAbs && o.start < sentEnd);
  });
  kept.sort((a, b) => a.start - b.start || b.end - a.end);

  const out: string[] = [];
  const seen = new Set<string>();
  let lastEnd = -1;
  for (const h of kept) {
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
