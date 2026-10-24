// R18-D2 (specs/intake-flow.md §27.10): everything "Correct this check" needs that is not a screen. Component
// layer (it mints ids and a time for the rebuilt graph, which the engine never does), no React.
//
// The register keeps no graph, so a case reopened from its record needs one for the correction flow: the form
// diffs the corrected graph against the original to write graph_corrected records (formCorrections), and with no
// original it would record "no answers changed" - a false line on an append-only trail. The original is rebuilt
// from the restored answers by the same two functions the form uses (plainAnswersToFormValues, buildGraphFromForm),
// numbered with the version the case's verdict was produced from. Its node ids are therefore new ones: they name
// the rebuilt graph, since the original graph was never stored.

import { restoreFromRecord } from '../engine/answer-sources';
import { olderCaseAnswers } from '../engine/answers-from-record';
import { buildGraphFromForm } from '../engine/build-graph-from-form';
import { toPlainAnswers } from '../engine/form-answer-state';
import { missingQuestionIds } from '../engine/form-visibility';
import { plainAnswersToFormValues } from '../engine/plain-intake';
import type { FormAnswerState } from '../engine/prefill-types';
import type { DataFlowGraph, PolicyFile } from '../engine/types';
import type { AuditEvent } from '../store/types';
import { describeAssumptions, findQuestion, olderDroppedSentence, restoreDroppedSentence } from './plain-copy';
import { visibleText } from '../engine/visible-text';
import type { QuestionId } from '../engine/plain-questions';
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

/** R18-E. The id prefix of the graph rebuilt for an OLDER case. Such a case kept no graph and no answers beyond its
 *  "Not sure" assumptions, so the rebuilt graph is mostly the form's strict defaults for blanks: it stands in for
 *  the original only to give the correction a version and a correction context. Its values are not what the case
 *  was confirmed on, so nothing is diffed against it (isRebuiltFromEarlierRecord). */
export const EARLIER_RECORD_GRAPH_PREFIX = 'earlier-record:';

/** True for the stand-in graph of an older case (see EARLIER_RECORD_GRAPH_PREFIX): a correction against it records
 *  no per-field changes and no count of them, because it has no real original to differ from. */
export function isRebuiltFromEarlierRecord(graph: { id: string } | undefined): boolean {
  return graph !== undefined && graph.id.startsWith(EARLIER_RECORD_GRAPH_PREFIX);
}

/** The answers a record restores, when they are enough to reopen the case. A record with `answer_sources`: the
 *  description is not blank and every question the form requires has an answer. An older case (`sources` absent): the
 *  description is not blank - the recorded "Not sure" answers come back for a tick and every other answer comes back
 *  blank and marked (olderCaseAnswers), so the form always opens. Null otherwise (the action is then not offered).
 *  Pure. */
export function restorableAnswers(
  sources: unknown,
  description: string,
  policy: PolicyFile,
  assumptions?: unknown,
  name?: unknown,
): FormAnswerState | null {
  return restoredFromRecord(sources, description, policy, assumptions, name)?.answerState ?? null;
}

/** The restored answers and the questions of the form (in words) whose recorded answer had to be left blank. */
function restoredFromRecord(
  sources: unknown,
  description: string,
  policy: PolicyFile,
  assumptions?: unknown,
  name?: unknown,
): { answerState: FormAnswerState; droppedNote: string | null } | null {
  if (description.trim() === '') return null;
  if (sources === undefined) {
    const older = olderCaseAnswers(assumptions, policy, name);
    return {
      answerState: older.answerState,
      droppedNote: older.dropped.length > 0 ? olderDroppedSentence(older.dropped.map(wordsFor)) : null,
    };
  }
  const { answerState, dropped } = restoreFromRecord(sources, policy);
  if (missingQuestionIds(toPlainAnswers(answerState, description), policy).length > 0) return null;
  return {
    answerState,
    droppedNote: dropped.length > 0 ? restoreDroppedSentence(dropped.map(wordsFor)) : null,
  };
}

function wordsFor(id: string): string {
  return visibleText(findQuestion(id as QuestionId)?.text ?? id);
}

export interface CorrectionOpening {
  useCaseId: string;
  originalVerdictId: string;
  description: string;
  answerState: FormAnswerState;
  originalGraph: DataFlowGraph;
  assumptions: Assumption[];
  /** The one sentence that says which recorded answers had to be left blank (null when none did). The form shows it. */
  droppedNote: string | null;
}

/** What OPEN_CORRECTION_FROM_RECORD carries. Called when the person presses the action (not during render: it
 *  mints ids). Null when the record does not restore (see restorableAnswers). */
export function correctionOpening(args: {
  useCaseId: string;
  originalVerdictId: string;
  /** The version the verdict was produced from; a verdict that predates the field reads as version 1. */
  graphVersion: number | undefined;
  description: string;
  sources: unknown;
  /** The "Not sure" assumptions of the case's confirmation. Read only for an older case (`sources` absent). */
  assumptions?: unknown;
  /** The case name the register keeps. Read only for an older case; it comes back as Question 1, needing a tick. */
  name?: unknown;
  policy: PolicyFile;
}): CorrectionOpening | null {
  const restored = restoredFromRecord(args.sources, args.description, args.policy, args.assumptions, args.name);
  if (!restored) return null;
  const { answerState, droppedNote } = restored;
  const { values, assumptions } = plainAnswersToFormValues(toPlainAnswers(answerState, args.description), args.policy);
  const built = buildGraphFromForm(values, new Date().toISOString(), () => crypto.randomUUID());
  return {
    useCaseId: args.useCaseId,
    originalVerdictId: args.originalVerdictId,
    description: args.description,
    answerState,
    originalGraph: {
      ...built,
      ...(args.sources === undefined ? { id: `${EARLIER_RECORD_GRAPH_PREFIX}${built.id}` } : {}),
      version: Number.isInteger(args.graphVersion) && args.graphVersion! >= 1 ? args.graphVersion! : 1,
    },
    assumptions: describeAssumptions(assumptions),
    droppedNote,
  };
}
