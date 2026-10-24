// R18-D1: realistic, hand-made `answer_sources` records and a case seeder, shaped exactly as specs/intake-flow.md
// §27.13 says. D1 builds the read side only, so nothing here is written by the app; R18-D2 replaces the hand-made
// rows with `toAnswerSources`. Test-only: never imported by src code.

import { addNode } from '../store/register';
import { append } from '../store/audit';
import type { RegisterNode } from '../store/types';
import type { AnswerSourceRecord, AnswerSources, ModelPlace, ReadRecord } from '../engine/prefill-types';

export const DESCRIPTION = 'It reads client names and account details to draft emails. Our UK team will use it every morning.';

export const READ_LOCAL: ReadRecord = { model: 'alpha:7b', place: 'this-computer', host: 'http://localhost:11434' };
export const READ_CLOUD: ReadRecord = { model: 'gemma4:cloud', place: 'ollama-cloud', host: 'http://localhost:11434' };
export const READ_FIRM: ReadRecord = { model: 'firm-model:2', place: 'firm-server', host: 'https://models.example.internal:8443' };

/** The five-row case of the acceptance test: one typed free-text, two confirmed pre-fills (one whose quote has
 *  left the description), one typed select, one pre-fill changed from the UK to the US. */
export function realisticSources(): AnswerSources {
  return {
    reads: [{ ...READ_LOCAL }],
    answers: [
      { question_id: '1', value: 'Client email drafting assistant', origin: 'typed' },
      {
        question_id: '5',
        value: ['people'],
        origin: 'prefilled_confirmed',
        quotes: [{ option: 'people', quote: 'client names' }],
        quote_in_final_description: true,
        read: 0,
      },
      {
        question_id: '7',
        value: 'clients',
        origin: 'prefilled_confirmed',
        quotes: [{ option: 'clients', quote: 'our customers' }],
        quote_in_final_description: false,
        read: 0,
      },
      { question_id: '9', value: 'yes', origin: 'typed' },
      {
        question_id: '11',
        value: ['US'],
        origin: 'prefilled_changed',
        quotes: [{ option: 'UK', quote: 'Our UK team' }],
        changed_from: [{ option: 'UK', quote: 'Our UK team' }],
        quote_in_final_description: true,
        read: 0,
      },
    ],
  };
}

/** The TC-R18-GI-5-01 case: countries typed, information a confirmed pre-fill, how widely a changed pre-fill. */
export function cloudSources(read: ReadRecord = READ_CLOUD): AnswerSources {
  return {
    reads: [{ ...read }],
    answers: [
      { question_id: '11', value: ['UK'], origin: 'typed' },
      {
        question_id: '5',
        value: ['everyday'],
        origin: 'prefilled_confirmed',
        quotes: [{ option: 'everyday', quote: 'internal ticket volumes' }],
        quote_in_final_description: true,
        read: 0,
      },
      {
        question_id: '10',
        value: 'team',
        origin: 'prefilled_changed',
        quotes: [{ option: 'small', quote: 'a small trial' }],
        changed_from: [{ option: 'small', quote: 'a small trial' }],
        quote_in_final_description: true,
        read: 0,
      },
    ],
  };
}

/** Nothing was read: every answer typed by hand, no model configured. */
export function typedOnlySources(): AnswerSources {
  return {
    reads: [],
    answers: [
      { question_id: '1', value: 'Ticket volume report', origin: 'typed' },
      { question_id: '5', value: ['everyday'], origin: 'typed' },
      { question_id: '9', value: 'yes', origin: 'typed' },
    ],
  };
}

/** `count` select answers: `confirmed` confirmed pre-fills, `changed` changed pre-fills, the rest typed. */
export function countedSources(count: number, confirmed: number, changed: number): AnswerSources {
  const ids = ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '3a', '4a', '6a', '14', '13'];
  const answers: AnswerSourceRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = ids[i]!;
    if (i < confirmed) {
      answers.push({ question_id: id, value: 'yes', origin: 'prefilled_confirmed', quotes: [{ option: 'yes', quote: 'client names' }], quote_in_final_description: true, read: 0 });
    } else if (i < confirmed + changed) {
      answers.push({ question_id: id, value: 'no', origin: 'prefilled_changed', quotes: [{ option: 'yes', quote: 'client names' }], changed_from: [{ option: 'yes', quote: 'client names' }], quote_in_final_description: true, read: 0 });
    } else {
      answers.push({ question_id: id, value: 'yes', origin: 'typed' });
    }
  }
  return { reads: [{ ...READ_LOCAL }], answers };
}

export function placeOf(read: ReadRecord): ModelPlace {
  return read.place;
}

/** A verdict the register can render and the hand-off schema accepts. */
export function fullVerdict(useCaseId: string): Record<string, unknown> {
  return {
    id: `v-${useCaseId}`,
    use_case_id: useCaseId,
    status: 'approved_with_controls',
    tier: 'High',
    track: 'II',
    binding_constraint: 'INV-DATA-01',
    binding_path: 'client notes → drafting model → drafted email',
    controls: [],
    downstream_reviews: [],
    conditions: { hypotheses: [] },
    policy_version: '1.3',
    pack_versions: {},
    applied_overrides: [],
    confidence_caveats: [],
    provisional_reasons: [],
    boundary_proximity: false,
    margin_achieved: 0,
    margin_target: 0.1,
    single_covered_invariants: [],
    explanation: {
      tier_rationale: null,
      track_rationale: null,
      hard_lines_checked: 4,
      invariants_checked: 6,
      tripped_invariants: [],
      binding_reason: null,
      binding_regulatory_basis: null,
    },
    living_status: 'approved',
    living_status_updated_at: '2026-10-22T09:00:00.000Z',
    attested_by: '1LoD',
    attested_at: '2026-10-22T09:00:00.000Z',
  };
}

export interface SeedOptions {
  /** The graph_confirmed payload's answer_sources. `undefined` writes none (an older case). Typed loosely on
   *  purpose: tests also write hostile and unknown shapes, which the store does not validate on write. */
  sources?: unknown;
  description?: string;
  /** use_case_created's intake_method; an older case saved by the model route says 'llm'. */
  intakeMethod?: 'structured_form' | 'llm';
  /** The case's name on the register. */
  label?: string;
  /** The graph_confirmed payload's "Not sure" assumptions (what a build before Round 18 recorded). */
  assumptions?: unknown;
  /** Extra events after the verdict, e.g. a verdict_corrected. */
  corrections?: { answer_sources?: unknown; description?: string }[];
}

/** One case: node, use_case_created, graph_confirmed (+ sources), verdict_produced, then any corrections. */
export async function seedCase(useCaseId: string, opts: SeedOptions = {}): Promise<void> {
  await addNode({
    node_id: useCaseId,
    node_type: 'use_case',
    label: opts.label ?? 'Client email drafting assistant',
    created_at: '2026-10-22T09:00:00.000Z',
    metadata: { node_type: 'use_case', submitted_by: '1LoD', lifecycle_stage: 'pre_checked', current_verdict_id: null, tier: 'High', track: 'II' },
  } as RegisterNode);
  const base = { use_case_id: useCaseId, actor: '1LoD' } as const;
  let n = 0;
  const at = () => `2026-10-22T09:00:${String(n++).padStart(2, '0')}.000Z`;
  await append({
    ...base,
    event_id: `${useCaseId}-created`,
    event_type: 'use_case_created',
    occurred_at: at(),
    payload: { type: 'use_case_created', description: opts.description ?? DESCRIPTION, intake_method: opts.intakeMethod ?? 'structured_form' },
  } as never);
  await append({
    ...base,
    event_id: `${useCaseId}-confirmed`,
    event_type: 'graph_confirmed',
    occurred_at: at(),
    payload: {
      type: 'graph_confirmed',
      graph_id: 'g-1',
      graph_version: 1,
      corrections_count: 0,
      ...(opts.assumptions !== undefined ? { assumptions: opts.assumptions } : {}),
      ...(opts.sources !== undefined ? { answer_sources: opts.sources } : {}),
    },
  } as never);
  await append({
    ...base,
    event_id: `${useCaseId}-verdict`,
    event_type: 'verdict_produced',
    occurred_at: at(),
    payload: { type: 'verdict_produced', verdict: fullVerdict(useCaseId) },
  } as never);
  let i = 0;
  for (const c of opts.corrections ?? []) {
    i += 1;
    await append({
      ...base,
      event_id: `${useCaseId}-corrected-${i}`,
      event_type: 'verdict_corrected',
      occurred_at: at(),
      payload: {
        type: 'verdict_corrected',
        original_verdict_id: `v-${useCaseId}`,
        new_verdict: { ...fullVerdict(useCaseId), id: `v-${useCaseId}-c${i}` },
        corrections_count: 1,
        ...(c.answer_sources !== undefined ? { answer_sources: c.answer_sources } : {}),
        ...(c.description !== undefined ? { description: c.description } : {}),
      },
    } as never);
  }
}
