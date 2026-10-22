// R18-D2 (specs/intake-flow.md §27.10): everything "Correct this check" needs that is not a screen. Component
// layer (it mints ids and a time for the rebuilt graph, which the engine never does), no React.
//
// The register keeps no graph, so a case reopened from its record needs one for the correction flow: the form
// diffs the corrected graph against the original to write graph_corrected records (formCorrections), and with no
// original it would record "no answers changed" - a false line on an append-only trail. The original is rebuilt
// from the restored answers by the same two functions the form uses (plainAnswersToFormValues, buildGraphFromForm),
// numbered with the version the case's verdict was produced from. Its node ids are therefore new ones: they name
// the rebuilt graph, since the original graph was never stored.

import { answersFromRecord } from '../engine/answer-sources';
import { buildGraphFromForm } from '../engine/build-graph-from-form';
import { toPlainAnswers } from '../engine/form-answer-state';
import { missingQuestionIds } from '../engine/form-visibility';
import { plainAnswersToFormValues } from '../engine/plain-intake';
import type { FormAnswerState } from '../engine/prefill-types';
import type { DataFlowGraph, PolicyFile } from '../engine/types';
import type { AuditEvent } from '../store/types';
import { describeAssumptions } from './plain-copy';
import type { Assumption } from './plain-copy';

/** The description the case stands on now: the latest correction that edited it, else the one it was created
 *  with. '' when the trail holds neither (a damaged case). Never rewritten by anything; read-only. */
export function effectiveDescription(events: readonly AuditEvent[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const p = events[i]!.payload;
    if (p.type === 'verdict_corrected' && typeof p.description === 'string') return p.description;
  }
  const created = events.find((e) => e.payload.type === 'use_case_created');
  return created && created.payload.type === 'use_case_created' ? created.payload.description : '';
}

/** The answers a record restores, when they are enough to reopen the case: the description is not blank and every
 *  question the form requires has an answer. Null otherwise (the action is then not offered - an older or damaged
 *  record is the older-case path, E's). Pure. */
export function restorableAnswers(sources: unknown, description: string, policy: PolicyFile): FormAnswerState | null {
  if (description.trim() === '') return null;
  const answerState = answersFromRecord(sources, policy);
  return missingQuestionIds(toPlainAnswers(answerState, description), policy).length === 0 ? answerState : null;
}

export interface CorrectionOpening {
  useCaseId: string;
  originalVerdictId: string;
  description: string;
  answerState: FormAnswerState;
  originalGraph: DataFlowGraph;
  assumptions: Assumption[];
}

/** What OPEN_CORRECTION_FROM_RECORD carries. Called when the person presses the action (not during render: it
 *  mints ids). Null when the record does not restore (see restorableAnswers). */
export function correctionOpening(args: {
  useCaseId: string;
  originalVerdictId: string;
  graphVersion: number;
  description: string;
  sources: unknown;
  policy: PolicyFile;
}): CorrectionOpening | null {
  const answerState = restorableAnswers(args.sources, args.description, args.policy);
  if (!answerState) return null;
  const { values, assumptions } = plainAnswersToFormValues(toPlainAnswers(answerState, args.description), args.policy);
  const built = buildGraphFromForm(values, new Date().toISOString(), () => crypto.randomUUID());
  return {
    useCaseId: args.useCaseId,
    originalVerdictId: args.originalVerdictId,
    description: args.description,
    answerState,
    originalGraph: { ...built, version: args.graphVersion },
    assumptions: describeAssumptions(assumptions),
  };
}
