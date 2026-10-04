// GT7 D-3 (P11, NF-11): plain-words clauses for "what set this regulation
// off", shown on the result screen as "Applies because <clause>".
//
// Deliberately NOT built from field-copy's *_LABELS (they end in raw codes in
// parentheses) or the intake question sentences: a submitter screen must never
// show a field code or an enum value. Only the fields the shipped packs test
// are mapped; anything else gets the generic clause, never a raw code.
// Presentation-only (cross-cutting rule 4) — no engine logic here.

export const GENERIC_TRIGGER_PHRASE = 'one of your answers matches this rule';

const DECISION_TYPE: Record<string, string> = {
  'credit-decision': 'it helps decide whether to lend, or on what terms (a credit decision)',
  'lending-decision': 'it helps decide loan origination or limits (a lending decision)',
  'fraud-detection': 'it is used to spot fraud or financial crime',
  trading: 'it is used for buying, selling or hedging positions',
  pricing: 'it helps decide what to charge a client',
  hiring: 'it helps decide recruitment, selection or promotion',
  'regulatory-reporting': 'it feeds numbers or statements that go to a regulator',
  operational: 'it is used for day to day internal processes',
};

const EXPOSURE: Record<string, string> = {
  'internal-only': 'what it produces is seen only by your own team',
  'internal-shared': 'what it produces is seen by other teams across the firm',
  'client-facing': 'what it produces is seen by clients or customers',
  'market-facing': 'what it produces goes outside the firm, to the market, the public or regulators',
};

const MODEL_TYPE: Record<string, string> = {
  statistical: 'it uses a calculation or scorecard',
  'traditional-ml': 'it uses a model trained on historical data',
  ml: 'it uses a model trained on historical data',
  'deep-learning': 'it uses a neural network',
  llm: 'it uses a chatbot or writing assistant that produces text',
  'generative-ai': 'it generates new content such as text, images, audio or code',
  agentic: 'it can decide its own steps and use other tools',
};

const DATA_ZONE: Record<string, string> = {
  'Zone A': 'its data is on the open internet, outside the firm’s control',
  'Zone B': 'its data is held by an outside supplier, a cloud or vendor service',
  'Zone C': 'its data stays inside the firm’s own systems',
};

const BINDINGNESS: Record<string, string> = {
  'non-binding': 'it is background information that nobody acts on directly',
  advisory: 'it is one input among several into a human decision',
  material: 'it substantially drives the decision a person then makes',
  binding: 'it is the decision itself, the outcome follows automatically',
};

const BY_FIELD: Record<string, Record<string, string>> = {
  decision_type: DECISION_TYPE,
  exposure: EXPOSURE,
  model_type: MODEL_TYPE,
  data_zone: DATA_ZONE,
  decision_bindingness: BINDINGNESS,
};

// Own-property lookup only, so a value such as "constructor" cannot reach
// Object.prototype.
export function triggerPhrase(field: string, value: string | number | boolean): string {
  const table = Object.prototype.hasOwnProperty.call(BY_FIELD, field) ? BY_FIELD[field] : undefined;
  const key = String(value);
  if (table && Object.prototype.hasOwnProperty.call(table, key)) return table[key] as string;
  return GENERIC_TRIGGER_PHRASE;
}

// A `not_in` trigger: the rule applies because the answer is NOT one of the
// excluded values, so say that instead of listing everything else.
export function triggerNotPhrase(field: string, excluded: Array<string | number | boolean>): string {
  const phrases = [...new Set(excluded.map((v) => triggerPhrase(field, v)))];
  if (phrases.length === 0 || phrases.includes(GENERIC_TRIGGER_PHRASE)) return GENERIC_TRIGGER_PHRASE;
  return `it is not the case that ${phrases.join(' or that ')}`;
}
