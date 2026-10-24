// R18-F (specs/intake-flow.md §27.11, ADR-IF-R18-7) — how the in-app test scores a model's fills against a
// corpus case's known correct graph. Pure engine island: engine modules and stdlib only, no clock, no
// random, no I/O. The model call is in src/llm/model-test.ts; this file takes its replies as input.
//
// MEASUREMENT ONLY. `applyPrefillToGraph` is the one second route from a `Prefill` to `evaluate()`; it
// scores the in-app test and nothing in the intake route imports it (TC-R18-GI-12-07, engine-boundary
// test). The graph a person's answers build still comes only from the form (buildGraphFromForm).
//
// How a case is scored, in words:
//   - A select question is SCORED for a case only when it is expressible: exactly one option of that
//     question, run through the real answers-to-graph mapping on the question's own base, reproduces the
//     gold graph's fields for it. Otherwise it is "not scored": left out of right/blank/wrong and out of the
//     overlay, so a correct fill is never marked wrong for a gold the form cannot express.
//   - For a scored question: right = pre-filled with options that reproduce the gold; blank = not pre-filled;
//     wrong = pre-filled with anything else.
//   - The verdict: the gold graph with each scored, pre-filled question's own fields overlaid is run through
//     evaluate() and compared with the case's recorded status and tier. A case with no usable answer scores
//     every scored question blank and its verdict "no answer" (not matched).

import { evaluate } from './evaluate';
import {
  QUESTION_STRUCTURE,
  deriveQuestionFields,
  goldFieldsOf,
  graphForAnswer,
  keysReproduce,
  optionsReproducing,
} from './question-structure';
import type { QuestionFieldEntry } from './question-structure';
import type { QuestionId } from './plain-questions';
import type { Prefill } from './prefill-types';
import type { DataFlowGraph, JurisdictionPack, PolicyFile } from './types';

export { optionsReproducing };

/** A corpus case's compact graph, as backtest/cases.json writes it. */
export interface CorpusGraph {
  jurisdictions: string[];
  input: Record<string, unknown>;
  processing: Record<string, unknown>;
  output: Record<string, unknown>;
}

/** The compact corpus graph expanded to the shape the form builds (constant ids and timestamp). */
export function corpusGraph(caseId: string, g: CorpusGraph): DataFlowGraph {
  return {
    id: caseId,
    version: 1,
    intake_method: 'structured_form',
    extracted_at: '2026-01-01T00:00:00Z',
    jurisdictions: [...g.jurisdictions],
    input_nodes: [{ id: 'i1', label: 'input', ...g.input } as never],
    processing_nodes: [{ id: 'p1', label: 'model', ...g.processing } as never],
    output_nodes: [{ id: 'o1', label: 'output', ...g.output } as never],
    edges: [
      { from: 'i1', to: 'p1' },
      { from: 'p1', to: 'o1' },
    ],
  };
}

/** QUESTION_FIELDS: question id -> the graph fields its options change, derived from the real mapping for this policy. */
export function questionFields(policy: PolicyFile): ReadonlyMap<QuestionId, QuestionFieldEntry> {
  return deriveQuestionFields(QUESTION_STRUCTURE, policy);
}

// ---- the overlay ----

type NodeGroup = 'input_nodes' | 'processing_nodes' | 'output_nodes';
const GROUPS: readonly NodeGroup[] = ['input_nodes', 'processing_nodes', 'output_nodes'];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function overlayField(target: DataFlowGraph, built: DataFlowGraph, field: string): void {
  if (field === 'jurisdictions') {
    target.jurisdictions = [...built.jurisdictions];
    return;
  }
  for (const group of GROUPS) {
    const builtNodes = built[group] as unknown as Record<string, unknown>[];
    const targetNodes = target[group] as unknown as Record<string, unknown>[];
    const carrier = builtNodes.find((n) => Object.prototype.hasOwnProperty.call(n, field));
    if (field === 'data_class' && group === 'input_nodes' && carrier) {
      // One input node per ticked kind of information, as the real mapping builds them.
      const template = targetNodes[0] ?? {};
      const baseId = typeof template.id === 'string' ? template.id : 'i1';
      target.input_nodes = builtNodes.map((bn, i) => ({
        ...template,
        id: i === 0 ? baseId : `${baseId}-${i + 1}`,
        data_class: bn.data_class,
      })) as never;
      const processingId = target.processing_nodes[0]?.id ?? 'p1';
      const outputId = target.output_nodes[0]?.id ?? 'o1';
      target.edges = [
        ...target.input_nodes.map((n) => ({ from: n.id, to: processingId })),
        { from: processingId, to: outputId },
      ];
      continue;
    }
    for (const node of targetNodes) {
      if (carrier) node[field] = clone(carrier[field]);
      else delete node[field];
    }
  }
}

/**
 * The gold graph with each pre-filled question's OWN fields replaced by what that question's answer gives
 * on its own base through the real mapping (the strict defaults the mapping applies to unanswered questions
 * are not overlaid). Questions are applied in the form's order, never the reply's, so reordering a reply
 * changes nothing. `only` limits the overlay to the questions the caller scores. Returns a copy.
 */
export function applyPrefillToGraph(
  gold: DataFlowGraph,
  prefill: Prefill,
  policy: PolicyFile,
  only?: ReadonlySet<QuestionId>,
): DataFlowGraph {
  const result = clone(gold);
  const fields = questionFields(policy);
  for (const q of QUESTION_STRUCTURE) {
    const filled = prefill.get(q.id);
    const entry = fields.get(q.id);
    if (!filled || !entry || !entry.scored) continue;
    if (only && !only.has(q.id)) continue;
    const built = graphForAnswer(q.id, filled.values.map((v) => v.option), policy);
    if (!built) continue;
    for (const field of entry.fields) overlayField(result, built, field);
  }
  return result;
}

// ---- scoring ----

export type QuestionScore = 'right' | 'blank' | 'wrong' | 'not scored';
export type VerdictScore = 'matched' | 'did not match' | 'no answer';

export interface CaseScore {
  /** Every select question, in the form's order. */
  questions: Record<string, QuestionScore>;
  verdict: VerdictScore;
  /**
   * False when the gold graph, evaluated under the policy and packs in force now, no longer gives the status and
   * tier recorded in engine-verdicts.json (the firm's rules were edited since). The verdict is then not compared.
   */
  compared: boolean;
}

export interface ExpectedVerdict {
  status: string;
  tier: string;
}

/**
 * Scores one case. `prefill` is the verified reply, or null when the model gave no usable answer.
 * Deterministic: the same inputs give a byte-identical score, with no clock and no random.
 */
export function scoreCase(args: {
  gold: DataFlowGraph;
  prefill: Prefill | null;
  expected: ExpectedVerdict;
  policy: PolicyFile;
  packs: JurisdictionPack[];
}): CaseScore {
  const { gold, prefill, expected, policy, packs } = args;
  const fields = questionFields(policy);
  const goldFields = goldFieldsOf(gold);
  const questions: Record<string, QuestionScore> = {};
  const scored = new Set<QuestionId>();
  for (const q of QUESTION_STRUCTURE) {
    if (q.kind === 'free') continue;
    const entry = fields.get(q.id);
    const reproducing = entry && entry.scored ? optionsReproducing(q.id, goldFields, QUESTION_STRUCTURE, policy) : [];
    if (reproducing.length !== 1) {
      questions[q.id] = 'not scored';
      continue;
    }
    scored.add(q.id);
    const filled = prefill?.get(q.id);
    if (!filled) {
      questions[q.id] = 'blank';
      continue;
    }
    questions[q.id] = keysReproduce(q.id, filled.values.map((v) => v.option), goldFields, policy) ? 'right' : 'wrong';
  }
  // The recorded verdicts were made under the shipped rules. If the live rules give the gold graph another
  // verdict, comparing a fill against the recording would punish a perfect model, so the verdict is not compared.
  const goldVerdict = evaluate(gold, policy, packs);
  const compared = goldVerdict.ok && goldVerdict.value.status === expected.status && goldVerdict.value.tier === expected.tier;
  if (prefill === null) return { questions, verdict: 'no answer', compared };
  if (!compared) return { questions, verdict: 'did not match', compared };
  const overlaid = applyPrefillToGraph(gold, prefill, policy, scored);
  const verdict = evaluate(overlaid, policy, packs);
  const matched = verdict.ok && verdict.value.status === expected.status && verdict.value.tier === expected.tier;
  return { questions, verdict: matched ? 'matched' : 'did not match', compared };
}

// ---- the run's table ----

export interface QuestionTally {
  right: number;
  blank: number;
  wrong: number;
}

export interface RunTally {
  /** Only questions scored in at least one case, in the form's order. right + blank + wrong = cases where it was scored. */
  perQuestion: Record<string, QuestionTally>;
  /** Cases whose verdict matched the recorded one. */
  verdictMatches: number;
  /** Cases whose verdict could be compared with the recorded one (the live rules still give the recorded verdict for the gold graph). */
  verdictCompared: number;
  /** Cases with no usable answer (a timeout, a refusal, an unreadable or empty reply). */
  noAnswer: number;
}

/** The run's counts from its case scores. Order-independent and deterministic. */
export function tallyScores(scores: readonly CaseScore[]): RunTally {
  const perQuestion: Record<string, QuestionTally> = {};
  let verdictMatches = 0;
  let noAnswer = 0;
  let verdictCompared = 0;
  for (const q of QUESTION_STRUCTURE) {
    if (q.kind === 'free') continue;
    for (const s of scores) {
      const v = s.questions[q.id];
      if (v === undefined || v === 'not scored') continue;
      const t = (perQuestion[q.id] ??= { right: 0, blank: 0, wrong: 0 });
      t[v] += 1;
    }
  }
  for (const s of scores) {
    if (s.compared) verdictCompared += 1;
    if (s.verdict === 'matched') verdictMatches += 1;
    else if (s.verdict === 'no answer') noAnswer += 1;
  }
  return { perQuestion, verdictMatches, verdictCompared, noAnswer };
}
