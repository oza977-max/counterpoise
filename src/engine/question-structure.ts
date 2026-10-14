// R18-C1 (specs/intake-flow.md §27.1, ADR-IF-R18-5, §27.11) — the form's question STRUCTURE.
// Pure engine island: engine types and stdlib only. NO WORDS: question text, option text and
// help live in src/components/plain-copy.ts, keyed by the ids and option keys declared here
// (question-structure.test.ts asserts the two cover exactly the same ids and keys).
//
// Extracted from StructuredForm.tsx / plain-copy.ts with no behaviour change: per question its
// kind, its static option keys (in display order), where policy-driven options are spliced in,
// which earlier answer makes it shown, whether it is required, what a change to it clears, and
// the one exclusivity rule (Question 13). The rules that read this data are in form-visibility.ts;
// the lookups every reader needs (shown? valid option keys?) are here so there is one copy and no
// import cycle.

import { buildGraphFromForm } from './build-graph-from-form';
import { platformZoneOptionKeys, plainAnswersToFormValues } from './plain-intake';
import type { PlainAnswers, QuestionId } from './plain-questions';
import type { PrefillCatalogue, PrefillCatalogueOption, PrefillCatalogueQuestion } from './prefill-types';
import type { DataFlowGraph, PolicyFile, RegistryEntry } from './types';

export type QuestionKind = 'single' | 'multi' | 'free';

/** Where a question's extra, policy-driven options come from (§27.1). */
export type DynamicSource = 'platforms' | 'suppliers' | 'company-assistants' | 'jurisdictions';

/** Which earlier answer makes a question shown. `in` is the set of that answer's keys; `needs` is a
 *  further condition on the policy. */
export interface ShownWhen {
  question: QuestionId;
  in?: readonly string[];
  needs?: 'several-company-assistants' | 'platform-with-several-zones';
}

export interface QuestionStructure {
  id: QuestionId;
  kind: QuestionKind;
  /** The question's own static option keys, in display order. Empty for a free-text question. */
  options: readonly string[];
  /** Policy-driven options. `at: 'start'` puts them before the static ones; a number splices them in
   *  at that index of the static list (Question 3's platforms sit between its 3rd and 4th option). */
  dynamic?: { source: DynamicSource; at: 'start' | number };
  /** Absent = always shown. */
  shownWhen?: ShownWhen;
  /** True when the question must be answered whenever it is shown (see REQUIRED_ORDER). */
  required: boolean;
  /** Answers cleared whenever THIS question is changed, even if still shown (Question 3 and 3a). */
  clearsOnChange?: readonly QuestionId[];
  /** Cleared on a change only if it was shown before and is not now (3model: a typed model name
   *  survives a change between answers that both ask for it). */
  clearOnlyOnTransition?: boolean;
  /** The option set depends on the chosen platform's allowed zones (3platformZone). */
  restrictedByPlatformZones?: boolean;
  /** Tick-all rule: "nothing beyond what's listed" cannot be ticked with others (Question 13). */
  exclusiveKey?: string;
}

const S = (
  id: QuestionId,
  kind: QuestionKind,
  options: readonly string[],
  rest: Partial<Omit<QuestionStructure, 'id' | 'kind' | 'options'>> = {},
): QuestionStructure => ({ id, kind, options, required: false, ...rest });

const AGENTIC = ['agentic', 'not-sure'] as const;

/** Every question, in the order the form declares them. */
export const QUESTION_STRUCTURE: readonly QuestionStructure[] = [
  S('1', 'free', [], { required: true }),
  S('2', 'free', [], { required: true }),
  S('3', 'single', ['outside-assistant', 'supplier-feature', 'specialist-product', 'firm-built', 'not-sure'], {
    required: true,
    dynamic: { source: 'platforms', at: 3 },
    clearsOnChange: ['3a', '3aWhich', '3supplier', '3supplierName', '3platformZone'],
  }),
  S('3supplier', 'single', ['not-on-list', 'dont-know'], {
    required: true,
    dynamic: { source: 'suppliers', at: 'start' },
    shownWhen: { question: '3', in: ['supplier-feature', 'specialist-product'] },
  }),
  S('3supplierName', 'free', [], { shownWhen: { question: '3supplier', in: ['not-on-list'] } }),
  S('3model', 'free', [], {
    shownWhen: { question: '3', in: ['outside-assistant', 'supplier-feature', 'specialist-product'] },
    clearOnlyOnTransition: true,
  }),
  S('3a', 'single', ['firm-account', 'personal-account', 'not-sure'], {
    required: true,
    shownWhen: { question: '3', in: ['outside-assistant'] },
    clearsOnChange: ['3aWhich'],
  }),
  S('3aWhich', 'single', ['not-sure'], {
    required: true,
    dynamic: { source: 'company-assistants', at: 'start' },
    shownWhen: { question: '3a', in: ['firm-account'], needs: 'several-company-assistants' },
  }),
  S('3platformZone', 'single', ['firm-systems', 'outside-supplier', 'outside-service', 'not-sure'], {
    required: true,
    shownWhen: { question: '3', needs: 'platform-with-several-zones' },
    restrictedByPlatformZones: true,
  }),
  S('4', 'single', ['score', 'perception', 'language', 'generative', 'agentic', 'not-sure'], { required: true }),
  S('4a', 'single', ['rules', 'explainable', 'unexplainable'], {
    required: true,
    shownWhen: { question: '4', in: ['score'] },
  }),
  S('5', 'multi', ['people', 'price-sensitive', 'confidential', 'everyday', 'typed-only', 'public', 'not-sure'], {
    required: true,
  }),
  S('6', 'single', ['read', 'answers', 'drafts', 'suggests', 'prepares', 'acts-reviewed', 'acts-bounded', 'acts-alone', 'not-sure'], {
    required: true,
  }),
  S('6a', 'single', ['little', 'one-input', 'usually-basis', 'not-sure'], {
    required: true,
    shownWhen: { question: '6', in: ['answers', 'drafts', 'suggests'] },
  }),
  S('6b', 'single', ['trades', 'yes-no-decision', 'something-else'], {
    required: true,
    shownWhen: { question: '6', in: ['acts-reviewed', 'acts-bounded', 'acts-alone'] },
  }),
  S('7', 'single', ['me-or-team', 'other-teams', 'clients', 'public-market', 'not-sure'], { required: true }),
  S('8', 'single', ['credit', 'hiring', 'pricing', 'trading', 'fraud', 'regulatory', 'operational', 'other'], {
    required: true,
  }),
  S('8other', 'free', [], { required: true, shownWhen: { question: '8', in: ['other'] } }),
  S('9', 'single', ['yes', 'no', 'not-sure'], { required: true }),
  S('10', 'single', ['small', 'team', 'wide'], { required: true }),
  S('11', 'multi', ['elsewhere-not-sure'], { required: true, dynamic: { source: 'jurisdictions', at: 'start' } }),
  S('12', 'single', ['yes', 'no', 'not-sure'], { required: true }),
  S('13', 'multi', ['none', 'credentialed', 'deployment', 'shared', 'not-sure'], {
    required: true,
    shownWhen: { question: '4', in: AGENTIC },
    exclusiveKey: 'none',
  }),
  S('14', 'single', ['no', 'yes', 'not-sure'], { required: true, shownWhen: { question: '4', in: AGENTIC } }),
];

/** The order "Still to answer" lists missing questions in: the always-required ones, then the
 *  conditional ones in the order the form has always pushed them (pinned by the form's tests). */
export const REQUIRED_ORDER: readonly QuestionId[] = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
  '3supplier', '3platformZone', '3a', '3aWhich', '4a', '6a', '6b', '8other', '13', '14',
];

// A Map, never an object lookup: ids come from our own code, but one lookup style everywhere.
const BY_ID: ReadonlyMap<QuestionId, QuestionStructure> = new Map(QUESTION_STRUCTURE.map((q) => [q.id, q]));

export function structureFor(id: QuestionId): QuestionStructure | undefined {
  return BY_ID.get(id);
}

// ---- policy-driven options ----

/** One policy-driven option: its key and the registry's own plain name (absent = the caller's numbered label). */
export interface DynamicEntry {
  key: string;
  plainName?: string;
}

export function dynamicEntries(source: DynamicSource, policy: PolicyFile): DynamicEntry[] {
  const withName = (e: RegistryEntry): DynamicEntry => ({ key: e.id, ...(e.plain_name !== undefined ? { plainName: e.plain_name } : {}) });
  switch (source) {
    case 'platforms':
      return (policy.platforms ?? []).map(withName);
    case 'suppliers':
      return (policy.vendors ?? []).filter((v) => (v.kind ?? 'supplier') === 'supplier').map(withName);
    case 'company-assistants':
      return (policy.vendors ?? []).filter((v) => v.kind === 'company_assistant').map(withName);
    case 'jurisdictions':
      return (policy.jurisdictions ?? []).map((j) => ({ key: j.code, plainName: j.name }));
  }
}

/** All the question's option keys in display order (static ones with the policy-driven ones spliced in).
 *  For 3platformZone this is the full static set; validOptionKeys narrows it by the chosen platform. */
export function allOptionKeys(q: QuestionStructure, policy: PolicyFile): string[] {
  const staticKeys = [...q.options];
  if (!q.dynamic) return staticKeys;
  const extra = dynamicEntries(q.dynamic.source, policy).map((e) => e.key);
  const at = q.dynamic.at === 'start' ? 0 : q.dynamic.at;
  return [...staticKeys.slice(0, at), ...extra, ...staticKeys.slice(at)];
}

function matchedPlatform(answers: PlainAnswers, policy: PolicyFile): RegistryEntry | undefined {
  const q3 = answers['3'];
  return typeof q3 === 'string' ? (policy.platforms ?? []).find((p) => p.id === q3) : undefined;
}

/** The option keys a question currently offers, given the earlier answers (the form's
 *  singleSelectValidKeys / multiSelectValidKeys). Free-text questions offer none. */
export function validOptionKeys(id: QuestionId, answers: PlainAnswers, policy: PolicyFile): string[] {
  const q = BY_ID.get(id);
  if (!q || q.kind === 'free') return [];
  if (q.restrictedByPlatformZones) {
    const platform = matchedPlatform(answers, policy);
    return platform ? platformZoneOptionKeys(platform) : [];
  }
  return allOptionKeys(q, policy);
}

function answerKey(answers: PlainAnswers, id: QuestionId): string | undefined {
  const v = answers[id];
  return typeof v === 'string' ? v : undefined;
}

/** Whether the question is shown for these answers (flat rule on the raw earlier answer, as the form has always done). */
export function isShown(id: QuestionId, answers: PlainAnswers, policy: PolicyFile): boolean {
  const rule = BY_ID.get(id)?.shownWhen;
  if (!rule) return true;
  const key = answerKey(answers, rule.question);
  if (rule.in && !(key !== undefined && rule.in.includes(key))) return false;
  if (rule.needs === 'several-company-assistants') {
    return dynamicEntries('company-assistants', policy).length > 1;
  }
  if (rule.needs === 'platform-with-several-zones') {
    const platform = matchedPlatform(answers, policy);
    return Boolean(platform) && (platform!.approved_envelope.data_zones?.length ?? 0) > 1;
  }
  return true;
}

// ---- words come in as data: the catalogue ----

/** What the component passes in: every WORD the engine needs and may not own. */
export interface QuestionWords {
  /** The text of a static option, or undefined if the words do not have it. */
  optionText: (id: QuestionId, key: string) => string | undefined;
  neutralPlatformLabel: (n: number) => string;
  neutralSupplierLabel: (n: number) => string;
}

function dynamicText(source: DynamicSource, entry: DynamicEntry, index: number, words: QuestionWords): string {
  if (entry.plainName !== undefined) return entry.plainName;
  // D-23: never fall back to a registry's raw name; a numbered neutral label instead.
  return source === 'platforms' ? words.neutralPlatformLabel(index + 1) : words.neutralSupplierLabel(index + 1);
}

/** The closed catalogue of select questions a pre-fill may use (§27.4 step 1): a Map of Maps, so a
 *  model-supplied key can never reach an object prototype property. Free-text questions are never in it. */
export function buildCatalogue(
  structure: readonly QuestionStructure[],
  words: QuestionWords,
  policy: PolicyFile,
): PrefillCatalogue {
  const out = new Map<QuestionId, PrefillCatalogueQuestion>();
  for (const q of structure) {
    if (q.kind === 'free') continue;
    const options = new Map<string, PrefillCatalogueOption>();
    const entries = q.dynamic ? dynamicEntries(q.dynamic.source, policy) : [];
    for (const key of allOptionKeys(q, policy)) {
      if (options.has(key)) continue;
      const idx = entries.findIndex((e) => e.key === key);
      const text =
        idx >= 0 && q.dynamic ? dynamicText(q.dynamic.source, entries[idx]!, idx, words) : (words.optionText(q.id, key) ?? key);
      options.set(key, { key, text });
    }
    out.set(q.id, { kind: q.kind, options });
  }
  return out;
}

// ---- graph fields per question (§27.11) ----

/** A graph's fields, flattened for comparison: field name -> its values (sorted JSON strings, one per node carrying it). */
export type FieldValues = ReadonlyMap<string, readonly string[]>;

const NON_FIELDS = new Set(['id', 'label']);

function flatten(graph: DataFlowGraph): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const nodes = [...graph.input_nodes, ...graph.processing_nodes, ...graph.output_nodes] as unknown as Record<string, unknown>[];
  for (const node of nodes) {
    for (const key of Object.keys(node)) {
      if (NON_FIELDS.has(key)) continue;
      const value = node[key];
      const list = out.get(key) ?? [];
      for (const v of Array.isArray(value) ? value : [value]) list.push(JSON.stringify(v));
      out.set(key, list);
    }
  }
  out.set('jurisdictions', graph.jurisdictions.map((j) => JSON.stringify(j)));
  for (const list of out.values()) list.sort();
  return out;
}

/** A gold graph's fields in the shape optionsReproducing compares: field name -> value or list of values. */
export type GoldFields = Readonly<Record<string, unknown>>;

function goldValues(gold: GoldFields, field: string): string[] | undefined {
  if (!Object.prototype.hasOwnProperty.call(gold, field)) return undefined;
  const v = gold[field];
  return (Array.isArray(v) ? v : [v]).map((x) => JSON.stringify(x)).sort();
}

const NEUTRAL: PlainAnswers = {
  '1': 'Example',
  '2': 'Example description',
  '3': 'firm-built',
  '4': 'language',
  '5': ['everyday'],
  '6': 'read',
  '7': 'me-or-team',
  '8': 'operational',
  '9': 'no',
  '10': 'small',
  '11': [],
  '12': 'no',
};

const FIXED_TIME = '2000-01-01T00:00:00.000Z';

function constantIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

function graphFor(answers: PlainAnswers, policy: PolicyFile): DataFlowGraph {
  const { values } = plainAnswersToFormValues(answers, policy);
  return buildGraphFromForm(values, FIXED_TIME, constantIds());
}

/** The answers that make a question shown, over the neutral choices elsewhere; null if the policy cannot show it. */
function baseFor(id: QuestionId, policy: PolicyFile): PlainAnswers | null {
  const answers: PlainAnswers = { ...NEUTRAL };
  const chain: QuestionStructure[] = [];
  let cur = BY_ID.get(id);
  // Walk the "shown when" chain upwards, then apply it from the top down.
  while (cur?.shownWhen) {
    chain.unshift(cur);
    cur = BY_ID.get(cur.shownWhen.question);
  }
  for (const q of chain) {
    const rule = q.shownWhen!;
    if (rule.needs === 'platform-with-several-zones') {
      const platform = (policy.platforms ?? []).find((p) => (p.approved_envelope.data_zones?.length ?? 0) > 1);
      if (!platform) return null;
      answers['3'] = platform.id;
    } else if (rule.in && rule.in.length > 0) {
      answers[rule.question] = rule.in[0]!;
    }
    if (!isShown(q.id, answers, policy)) return null;
  }
  return answers;
}

/** What one question's options change in the graph. */
export type QuestionFieldEntry = { scored: true; fields: string[] } | { scored: false; why: string };

function answerWith(base: PlainAnswers, q: QuestionStructure, key: string): PlainAnswers {
  return { ...base, [q.id]: q.kind === 'multi' ? [key] : key };
}

/**
 * For each select question, the graph fields its options change (§27.11). Each option (a tick-all
 * question: each option ticked alone) is run through the real mapping on a per-question base —
 * the earlier answers that make the question shown, a neutral choice elsewhere, constant ids and
 * timestamp — and a field counts when it is not the same under every option. A question with no
 * option that changes any field, or one the policy cannot show, is an explicit "not scored" entry.
 */
export function deriveQuestionFields(
  structure: readonly QuestionStructure[],
  policy: PolicyFile,
): ReadonlyMap<QuestionId, QuestionFieldEntry> {
  const out = new Map<QuestionId, QuestionFieldEntry>();
  for (const q of structure) {
    if (q.kind === 'free') continue;
    const base = baseFor(q.id, policy);
    if (!base) {
      out.set(q.id, { scored: false, why: 'the policy cannot show this question' });
      continue;
    }
    const perOption = validOptionKeys(q.id, base, policy).map((key) => flatten(graphFor(answerWith(base, q, key), policy)));
    const names = new Set<string>();
    for (const g of perOption) for (const k of g.keys()) names.add(k);
    const fields = [...names]
      .filter((f) => new Set(perOption.map((g) => (g.get(f) ?? ['<absent>']).join('|'))).size > 1)
      .sort();
    out.set(q.id, fields.length > 0 ? { scored: true, fields } : { scored: false, why: 'no option changes the graph' });
  }
  return out;
}

/**
 * The options of a question whose graph fields equal the gold graph's for that question's fields
 * (§27.11). Exactly one = the question is expressible for this case; none or several = not scored.
 * An unscored question returns an empty list.
 */
export function optionsReproducing(
  id: QuestionId,
  goldFields: GoldFields,
  structure: readonly QuestionStructure[],
  policy: PolicyFile,
): string[] {
  const q = structure.find((s) => s.id === id);
  const entry = deriveQuestionFields(structure, policy).get(id);
  if (!q || q.kind === 'free' || !entry || !entry.scored) return [];
  const base = baseFor(id, policy);
  if (!base) return [];
  const keys: string[] = [];
  for (const key of validOptionKeys(id, base, policy)) {
    const graph = flatten(graphFor(answerWith(base, q, key), policy));
    const same = entry.fields.every((f) => {
      const want = goldValues(goldFields, f);
      const have = graph.get(f);
      if (want === undefined || have === undefined) return want === undefined && have === undefined;
      return want.join('|') === have.join('|');
    });
    if (same) keys.push(key);
  }
  return keys;
}
