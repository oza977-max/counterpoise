import { CANONICAL_VOCABULARY } from './canonical-vocabulary';
import type {
  DataFlowGraph,
  HardLine,
  IntakeQuestion,
  Invariant,
  JurisdictionPack,
  PolicyFile,
  Tier,
} from './types';
import { assignTier } from './tier';
import { normaliseAccessScope } from './access-scope';

// UC-4 (intake-flow.md §6). Pure — no I/O, no LLM, same src/engine/* rule.
//
// "Worst-case" provisional tier (judgment call, build/prompts/P4-C03.md #1):
// The graph's uncertain fields already hold a concrete best-guess value —
// so the provisional tier pass below uses the graph's values directly, rather
// than building a separate per-field worst-case substitution engine.
function budgetForTier(tier: Tier): number {
  if (tier === 'Low') return 5;
  if (tier === 'Medium') return 10;
  return 15; // High or Critical
}

// v0.7.1 (user bug report, live-reproduced): fields OUTSIDE the canonical
// vocabulary but with a closed value set fell through to answer_type
// 'text' — "What level of human oversight...?" rendered an empty textarea,
// and whatever the user typed was written back into a numeric field,
// corrupting the graph. A closed-set field must NEVER ask for free text.
const EXTRA_QUESTION_OPTIONS: Record<string, readonly string[]> = {
  autonomy_level: ['0', '1', '2', '3', '4'],
  output_reversibility: ['reversible', 'irreversible', 'unknown'],
  scale: ['limited', 'at_scale'],
  // code-review-004 F3: the v1.4 agentic-infrastructure fields are closed
  // sets AND rule-condition candidate fields (candidatesFromRules iterates
  // condition keys, and INV-AGENT-INFRA/CRED/COORD-01 condition on them) —
  // but they were added to the schema without being added here, so a
  // question for either would have fallen through to free text and
  // coerceAnswerValue would have accepted any string. Unreachable at the
  // time of the fix only because the LLM extractor's schema doesn't emit
  // these fields yet — the exact v0.7.1 landmine this map exists to
  // prevent, re-armed for the day it does. Values mirror
  // src/engine/types.ts's SystemAccessScope and
  // ProcessingNode.multi_instance_coordination exactly.
  system_access_scope: ['none', 'shared_infrastructure', 'credentialed_systems', 'deployment_authority'],
  multi_instance_coordination: ['no', 'yes', 'unknown'],
};

function questionForField(
  field: string,
  nodeId: string | undefined,
  triggeredBy: string[],
): IntakeQuestion {
  const canonicalOptions = CANONICAL_VOCABULARY[field] ?? EXTRA_QUESTION_OPTIONS[field];
  // R16-E §3 (D-101): system_access_scope is the one field whose legal
  // value is a LIST — a single <select> can only ever narrow a genuine
  // multi-value answer, so it gets its own answer_type instead of 'select'.
  // `src/components/plain-copy.ts`'s QUESTIONNAIRE_COPY/QuestionnaireStep
  // supply the question's words and option labels; this object carries
  // only ids, the field, and the legal value set.
  const answerType: IntakeQuestion['answer_type'] =
    field === 'system_access_scope'
      ? 'multi_select'
      : canonicalOptions
        ? 'select'
        : field === 'hitl' || field === 'replaces_prior_model'
          ? 'boolean'
          : 'text';
  return {
    id: `Q-${field}-${nodeId ?? 'graph'}`,
    field,
    node_id: nodeId,
    triggered_by: [...triggeredBy],
    answer_type: answerType,
    options: canonicalOptions ? [...canonicalOptions] : undefined,
  };
}

/** v0.7.1 write-back validation gate. Coerces an answered value into the
 *  graph's typed form and refuses anything outside the field's legal set —
 *  a free-typed or malformed answer must never corrupt the graph. Pure. */
export function coerceAnswerValue(
  field: string,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (field === 'autonomy_level') {
    const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    return Number.isInteger(n) && n >= 0 && n <= 4
      ? { ok: true, value: n }
      : { ok: false, reason: 'autonomy level must be 0–4' };
  }
  if (field === 'hitl' || field === 'replaces_prior_model') {
    if (typeof value === 'boolean') return { ok: true, value };
    if (value === 'true' || value === 'false') return { ok: true, value: value === 'true' };
    return { ok: false, reason: `${field} must be yes or no` };
  }
  // R16-E §3 (D-101, EC-1): system_access_scope is list-valued — the
  // generic closed-set branch below does `closed.includes(String(value))`,
  // which `String(['a','b'])` ("a,b") would never match, rejecting every
  // array. Routed through the SAME single checker every other caller uses
  // (the form, the questionnaire's multi-select) so
  // the four legal values, their order and the `none`-exclusivity rule
  // never drift between call sites.
  if (field === 'system_access_scope') {
    const result = normaliseAccessScope(value);
    return result.ok ? { ok: true, value: result.value } : { ok: false, reason: result.reason };
  }
  const closed = CANONICAL_VOCABULARY[field] ?? EXTRA_QUESTION_OPTIONS[field];
  if (closed) {
    return closed.includes(String(value))
      ? { ok: true, value: String(value) }
      : { ok: false, reason: `"${String(value)}" is not a permitted ${field.replace(/_/g, ' ')}` };
  }
  // Open-text fields (vendor, label): any non-empty string.
  const text = String(value).trim();
  return text ? { ok: true, value: text } : { ok: false, reason: `${field.replace(/_/g, ' ')} cannot be empty` };
}

function findUncertainNode(graph: DataFlowGraph, field: string): { id: string } | undefined {
  // Only ProcessingNode carries `uncertain` today (intake-flow.md §4.2) —
  // InputNode/OutputNode have no per-node confidence flag yet.
  for (const node of graph.processing_nodes) {
    if (node.uncertain && field in node) return { id: node.id };
  }
  return undefined;
}

function candidatesFromRules<T extends { id: string; condition: Record<string, unknown> }>(
  rules: T[],
  graph: DataFlowGraph,
): IntakeQuestion[] {
  const candidates: IntakeQuestion[] = [];
  for (const rule of rules) {
    for (const field of Object.keys(rule.condition)) {
      const uncertainNode = findUncertainNode(graph, field);
      if (uncertainNode) {
        candidates.push(questionForField(field, uncertainNode.id, [rule.id]));
      }
    }
  }
  return candidates;
}

function dedupeAndMerge(candidates: IntakeQuestion[]): IntakeQuestion[] {
  const byKey = new Map<string, IntakeQuestion>();
  for (const q of candidates) {
    const key = `${q.field}::${q.node_id ?? ''}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.triggered_by = [...new Set([...existing.triggered_by, ...q.triggered_by])];
    } else {
      byKey.set(key, { ...q });
    }
  }
  return [...byKey.values()];
}

// V1.2-B (design-gap C2): expose the budget the generator already
// computes internally, so the questionnaire UI can render
// "{answered}/{total} · budget ≤N (provisional {tier})".
// BC-V12B-04: additive — generateQuestions' signature is unchanged.
export function getQuestionBudget(
  graph: DataFlowGraph,
  policy: PolicyFile,
): { budget: number; provisionalTier: Tier } {
  const provisionalTier = assignTier(graph, [...policy.tiers].sort((a, b) => a.id.localeCompare(b.id))).tier;
  return { budget: budgetForTier(provisionalTier), provisionalTier };
}

export function generateQuestions(
  graph: DataFlowGraph,
  policy: PolicyFile,
  _activePacks: JurisdictionPack[],
): IntakeQuestion[] {
  // Review finding (V1.2-B, pass 1): consume the same helper the UI uses
  // for the displayed budget, so the enforced budget and the displayed
  // budget can never silently drift apart.
  const { budget } = getQuestionBudget(graph, policy);

  const sortedInvariants = [...policy.invariants].sort((a, b) => a.id.localeCompare(b.id)) as Invariant[];
  const sortedHardLines = [...policy.hard_lines].sort((a, b) => a.id.localeCompare(b.id)) as HardLine[];

  const candidates = [
    ...candidatesFromRules(sortedInvariants, graph),
    ...candidatesFromRules(sortedHardLines, graph),
  ];

  const deduped = dedupeAndMerge(candidates);

  // Prioritize by how many invariants/hard-lines a question would resolve
  // — trim to budget by removing lowest-priority candidates, not by
  // generating fewer candidates up front (BC-P4C03-02).
  deduped.sort((a, b) => b.triggered_by.length - a.triggered_by.length || a.id.localeCompare(b.id));

  return deduped.slice(0, budget);
}
