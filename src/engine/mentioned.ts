// R18-A — the checklist's "mentioned" rule (specs/intake-flow.md §27.2,
// ADR-IF-R18-1). A fixed phrase-table lookup over the folded text: no model,
// no clock, no random, no I/O. Engine island (imports types only).
//
// What it can honestly claim: a word or phrase from a reviewed vocabulary
// occurs in the text. It never claims the description "answers" a question;
// false ticks are possible and harmless (the form asks every question anyway).
// The vocabulary is English only and human-reviewed like pack text
// (grounding/PACK-AUTHORING.md). A phrase added later needs a ticks-on and a
// stays-unticked sentence in the same commit (mentioned.test.ts).
//
// Accepted limit (countries): a two- or three-letter jurisdiction code or name
// counts only when written in capitals, so a text typed ENTIRELY in capitals
// ("IT GIVES US A SCORE") ticks "countries" on the pronoun "US". The form asks
// the question either way, so a false tick costs nothing; guessing at case
// would miss the real "US office" far more often.

import type { ChecklistItemId } from './prefill-types';

/** The 13 items, in the order the checklist shows them (the form's own order). */
export const CHECKLIST_ITEM_IDS: readonly ChecklistItemId[] = [
  'where-ai-comes-from',
  'kind-of-ai',
  'can-explain',
  'information-used',
  'what-it-does-with-output',
  'weight-of-output',
  'who-receives',
  'what-it-decides',
  'mistake-recoverable',
  'how-widely',
  'countries',
  'replaces-something',
  'agentic-reach',
];

// ── The two normalisers (each has one job; no other is introduced) ──────────

/** Lower-case, curly quotes and dashes folded to plain, whitespace runs collapsed.
 *  Used only by the mention rule. */
export function foldForMention(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whitespace runs collapsed to one space and trimmed, nothing else. Used by the
 *  verifier, the quote re-check and the edit-and-return comparison. */
export function normForQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ── The vocabulary ──────────────────────────────────────────────────────────
// `phrases`: exact words/phrases, whole-phrase match (a space or hyphen in an
//            entry matches either). `words`: single words matched whole in
//            their inflected forms (plural, -ed, -ing — see `inflect`).
// `stems`:   prefix of a word; the end is open ("classif" -> classify,
//            classification).

interface ItemVocabulary {
  phrases: readonly string[];
  words: readonly string[];
  stems: readonly string[];
}

const VOCABULARY: Record<Exclude<ChecklistItemId, 'countries'>, ItemVocabulary> & {
  countries: ItemVocabulary;
} = {
  'where-ai-comes-from': {
    words: ['supplier', 'vendor', 'purchase', 'license', 'licence', 'outsource'],
    phrases: [
      'bought', 'built in-house', 'in-house', 'built by our team', 'built by us', 'built by our',
      'third-party', 'off the shelf', 'open source', 'chatgpt', 'copilot', 'claude', 'gemini',
      'openai', 'anthropic', 'llama', 'mistral',
    ],
    stems: [],
  },
  'kind-of-ai': {
    words: ['score', 'rank', 'forecast', 'chatbot', 'agent'],
    phrases: ['language model', 'llm', 'machine learning', 'neural network', 'agentic'],
    stems: ['classif', 'summaris', 'summariz', 'translat', 'recognis', 'recogniz', 'generat', 'predict'],
  },
  'can-explain': {
    words: [],
    phrases: [
      'show which factors', 'which factors', 'explain why', 'explain how', 'explain itself',
      'explain its', 'explain the result', 'fixed rules', 'written-down rules', 'scorecard',
      'cannot explain', "can't explain", 'unable to explain', 'black box', 'explainable',
      'explainability', 'interpretable',
    ],
    stems: [],
  },
  'information-used': {
    words: ['client', 'customer', 'applicant', 'employee', 'staff', 'cv'],
    phrases: [
      'names', 'account details', 'account data', 'account information', 'personal data',
      'personal information', 'personal details', 'pii', 'confidential', 'public information',
      'price-sensitive', 'mnpi', 'inside information', 'sensitive data',
    ],
    stems: [],
  },
  'what-it-does-with-output': {
    words: ['review', 'approve', 'draft', 'suggest', 'flag', 'recommend'],
    phrases: [
      'checks each', 'check each', 'checks every', 'a person checks', 'human review',
      'human in the loop', 'human-in-the-loop', 'acts by itself', 'act by itself',
      'acts on its own', 'automatically', 'autonomously', 'without a person', 'without human',
    ],
    stems: [],
  },
  'weight-of-output': {
    words: [],
    phrases: [
      'usually go with', 'usually goes with', 'go with its', 'goes with its', 'one input among',
      'one input of several', 'one of several inputs', 'relied on', 'relies on', 'rely on',
      'relying on', 'decision is based on', 'decisions are based on', 'based on its',
      'heavily relies', 'final say', 'advisory only', 'non-binding', 'binding decision',
    ],
    stems: [],
  },
  'who-receives': {
    words: ['publish', 'regulator'],
    phrases: [
      'go out to', 'goes out to', 'sent to', 'send to', 'sends to', 'shared with', 'my team',
      'other teams', 'other departments', 'the public', 'public-facing', 'customer-facing',
      'client-facing', 'distributed to', 'emailed to', 'delivered to',
    ],
    stems: [],
  },
  'what-it-decides': {
    words: ['lend', 'loan', 'mortgage', 'hire', 'recruit', 'underwrite', 'trade', 'fraud', 'credit'],
    phrases: [
      'lent', 'who gets a', 'decide who', 'decides who', 'help decide', 'helps decide',
      'regulatory return', 'regulatory returns', 'regulatory reporting', 'pricing', 'aml', 'kyc',
    ],
    stems: [],
  },
  'mistake-recoverable': {
    words: ['mistake', 'error'],
    phrases: [
      'correct any mistake', 'correct a mistake', 'can be undone', 'cannot be undone',
      "can't be undone", 'cannot be taken back', "can't be taken back", 'be taken back',
      'irreversible', 'reversible', 'put right', 'can be reversed', 'be reversed', 'roll back',
      'rolled back',
    ],
    stems: [],
  },
  'how-widely': {
    words: ['pilot'],
    phrases: [
      'every application', 'every case', 'every request', 'every customer', 'every client',
      'all applications', 'all cases', 'whole business', 'whole firm', 'whole bank', 'firm-wide',
      'firmwide', 'company-wide', 'bank-wide', 'across the firm', 'across the bank',
      'across the business', 'small trial', 'proof of concept', 'my team', 'just me',
      'a few users', 'handful of', 'all staff', 'all employees',
    ],
    stems: [],
  },
  // The policy's own names and codes are added per call (see `mentionedItems`).
  countries: {
    words: [],
    phrases: [
      'worldwide', 'overseas', 'abroad', 'cross-border', 'multiple countries', 'several countries',
      // A frozen list of country names. Ambiguous common words (Turkey, Chad, Jordan, Georgia,
      // Jersey, Niger, Guinea, Mali) are left out on purpose: a false tick on a food or a
      // first name costs more than a missed rarely-named country.
      'united kingdom', 'great britain', 'britain', 'england', 'scotland', 'wales',
      'northern ireland', 'united states', 'united states of america', 'european union',
      'germany', 'france', 'spain', 'italy', 'ireland', 'netherlands', 'belgium', 'luxembourg',
      'switzerland', 'austria', 'sweden', 'norway', 'denmark', 'finland', 'poland', 'portugal',
      'greece', 'czechia', 'hungary', 'romania', 'bulgaria', 'croatia', 'slovakia', 'slovenia',
      'estonia', 'latvia', 'lithuania', 'iceland', 'malta', 'cyprus', 'ukraine', 'russia',
      'canada', 'mexico', 'brazil', 'argentina', 'chile', 'colombia', 'peru', 'china',
      'hong kong', 'taiwan', 'south korea', 'korea', 'india', 'pakistan', 'bangladesh',
      'indonesia', 'malaysia', 'thailand', 'vietnam', 'philippines', 'australia', 'new zealand',
      'japan', 'singapore', 'israel', 'egypt', 'nigeria', 'kenya', 'south africa', 'saudi arabia',
      'united arab emirates', 'uae', 'usa', 'u.s.', 'u.k.', 'qatar', 'kuwait', 'bahrain', 'oman', 'morocco', 'ghana', 'iran',
      'iraq', 'guernsey', 'isle of man', 'liechtenstein', 'monaco', 'turkiye', 'türkiye',
    ],
    stems: [],
  },
  'replaces-something': {
    words: [],
    phrases: [
      'instead of our old', 'instead of the old', 'instead of our current', 'retire the old',
      'retiring the old', 'retires the old', 'phase out', 'phasing out', 'phases out',
    ],
    stems: ['replac'],
  },
  'agentic-reach': {
    words: ['deploy', 'credentials'],
    phrases: [
      'its own logins', 'its own login', 'own logins', 'own login', 'access token',
      'access tokens', 'api key', 'api keys', 'other agents', 'another agent', 'pass work',
      'passes work', 'passing work', 'pass messages', 'autonomous agent', 'agentic',
    ],
    stems: [],
  },
};

// ── Matching machinery ──────────────────────────────────────────────────────

const NOT_BEFORE = '(?<![\\p{L}\\p{N}])';
const NOT_AFTER = '(?![\\p{L}\\p{N}])';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A phrase as a pattern: a space or a hyphen in the entry matches either. */
function phrasePattern(phrase: string): string {
  return phrase.split(/[ -]/).map(escapeRegex).join('[ -]');
}

/** The inflection rule: the listed word, its plural, -ed and -ing forms, with
 *  the usual spelling changes (-e dropped, -y to -ies/-ied, a doubled final
 *  consonant). A few odd forms this produces ("scoreed") never occur in text
 *  and cost nothing. */
export function inflect(word: string): string[] {
  const last = word.slice(-1);
  const stem = word.slice(0, -1);
  const out = new Set<string>([word, `${word}s`, `${word}es`, `${word}ed`, `${word}d`, `${word}ing`]);
  out.add(`${word}${last}ed`);
  out.add(`${word}${last}ing`);
  if (last === 'e') out.add(`${stem}ing`);
  if (last === 'y') {
    out.add(`${stem}ies`);
    out.add(`${stem}ied`);
  }
  return [...out];
}

function compile(vocab: ItemVocabulary, extraPhrases: readonly string[] = []): RegExp {
  const wholes = [
    ...vocab.phrases,
    ...extraPhrases,
    ...vocab.words.flatMap(inflect),
  ].map(phrasePattern);
  const parts: string[] = [];
  if (wholes.length > 0) parts.push(`${NOT_BEFORE}(?:${wholes.join('|')})${NOT_AFTER}`);
  if (vocab.stems.length > 0) parts.push(`${NOT_BEFORE}(?:${vocab.stems.map(escapeRegex).join('|')})`);
  // An item with no entries must never match (an empty alternation would match everything).
  return new RegExp(parts.length > 0 ? parts.join('|') : '(?!)', 'u');
}

const STATIC_PATTERNS = new Map<ChecklistItemId, RegExp>(
  CHECKLIST_ITEM_IDS.filter((id) => id !== 'countries').map((id) => [id, compile(VOCABULARY[id])]),
);
const COUNTRY_NAMES_PATTERN = compile(VOCABULARY.countries);

export interface MentionJurisdiction {
  code: string;
  name: string;
}

/** A two- or three-letter code ("UK", "US", "EU") counts only when written in
 *  capitals, bounded by non-letters/digits, in the ORIGINAL text — so the
 *  pronoun "us" and the word "uk" in a URL do not tick. */
function isShortCode(code: string): boolean {
  return /^\p{L}{2,3}$/u.test(code);
}

function countriesMentioned(original: string, folded: string, jurisdictions: readonly MentionJurisdiction[]): boolean {
  if (COUNTRY_NAMES_PATTERN.test(folded)) return true;
  const caps: string[] = [];
  const longer: string[] = [];
  for (const j of jurisdictions) {
    const rawName = typeof j.name === 'string' ? j.name.trim() : '';
    // A 2-3 letter NAME is held to the same rule as a code (capitals only): "us" the
    // pronoun must not tick because a list calls a jurisdiction "US".
    if (isShortCode(rawName)) caps.push(escapeRegex(rawName.toUpperCase()));
    else {
      const name = foldForMention(rawName);
      if (name !== '') longer.push(name);
    }
    const code = typeof j.code === 'string' ? j.code.trim() : '';
    if (code === '') continue;
    if (isShortCode(code)) caps.push(escapeRegex(code.toUpperCase()));
    else longer.push(foldForMention(code));
  }
  if (longer.length > 0 && compile({ phrases: longer, words: [], stems: [] }).test(folded)) return true;
  if (caps.length > 0 && new RegExp(`${NOT_BEFORE}(?:${caps.join('|')})${NOT_AFTER}`, 'u').test(original)) return true;
  return false;
}

/**
 * The checklist items the text mentions. Pure: depends on the text and the
 * policy's jurisdiction list only. Runs on the whole text, however long.
 */
export function mentionedItems(
  text: string,
  jurisdictions: readonly MentionJurisdiction[],
): ReadonlySet<ChecklistItemId> {
  const folded = foldForMention(text);
  const out = new Set<ChecklistItemId>();
  for (const id of CHECKLIST_ITEM_IDS) {
    if (id === 'countries') {
      if (countriesMentioned(text, folded, jurisdictions)) out.add(id);
    } else if (STATIC_PATTERNS.get(id)!.test(folded)) {
      out.add(id);
    }
  }
  return out;
}

// ── Length rule (R18-GI-14, intake-flow §27.3) ─────────────────────────────

/** The longest description the model path reads, counted in Unicode code points. */
export const PREFILL_MAX_CHARS = 8000;

/** Length in code points ([...text].length), not UTF-16 units and not bytes. */
export function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}
