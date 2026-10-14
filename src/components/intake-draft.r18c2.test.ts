import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { saveDraft, loadDraftInfo, updateFormDraft, loadFormDraft } from './intake-draft';
import { loadPolicy } from '../store/policy';
import { buildGraphFromForm } from '../engine/build-graph-from-form';
import { plainAnswersToFormValues } from '../engine/plain-intake';
import { WORKED_EXAMPLES } from '../engine/worked-examples';
import { textFingerprint } from '../engine/form-answer-state';
import type { DataFlowGraph } from '../engine/types';
import type { IntakeState } from './intake-state';
import type { FormAnswerState, LastRead, ReadRecord } from '../engine/prefill-types';

// R18-C2 drafts (specs/intake-flow.md §27.5 "Reload while reading", §27.7): prefill_reading is saved like
// evaluation_pending and mapped on load to the form with the description kept and outcome not-read;
// lastRead rides on every form-route step and is validated on load.

const DRAFT_KEY = 'aigate:intake-draft';
const D = 'It reads client names and account details. Our UK team will use it.';
const READ: ReadRecord = { model: 'alpha:7b', place: 'this-computer', host: 'http://localhost:11434' };
const lastRead: LastRead = { fingerprint: textFingerprint(D), outcome: 'ok', read: READ };
const answers: FormAnswerState = {
  '11': { value: ['UK'], source: { kind: 'prefilled', quotes: [{ option: 'UK', quote: 'Our UK team' }], read: READ, confirmed: false } },
};

let graph: DataFlowGraph;
beforeAll(() => {
  const res = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
  if (!res.valid) throw new Error('policy invalid');
  const { values } = plainAnswersToFormValues({ ...WORKED_EXAMPLES[0]!.answers, '2': D }, res.policy);
  graph = buildGraphFromForm(values, '2026-10-01T00:00:00.000Z', () => 'node-id');
});
beforeEach(() => sessionStorage.clear());

const stored = () => JSON.parse(sessionStorage.getItem(DRAFT_KEY)!) as { version: number; state: Record<string, unknown> };

describe('a saved prefill_reading reloads onto the form and makes no call (TC-R18-GI-7-06, GI-9)', () => {
  const reading: IntakeState = {
    step: 'prefill_reading',
    description: D,
    decidedFor: textFingerprint(D),
    nudgeFor: ['countries'],
    answerState: answers,
    lastRead,
  };

  it('is written with its step, like evaluation_pending', () => {
    saveDraft(reading);
    expect(stored().state.step).toBe('prefill_reading');
    expect(stored().version).toBe(4);
  });

  it('loads as the form step with the description, the decision, the nudge and the answers kept, outcome not-read', () => {
    saveDraft(reading);
    const info = loadDraftInfo()!;
    expect(info.earlierVersionNotice).toBe(false);
    expect(info.state).toEqual({
      step: 'graph_extraction',
      description: D,
      method: 'form',
      decidedFor: textFingerprint(D),
      nudgeFor: ['countries'],
      answerState: answers,
      lastRead: { fingerprint: '', outcome: 'not-read' },
    });
  });

  it('a damaged answer state in a saved reading step lands on the safe form without answers', () => {
    saveDraft({ ...reading, answerState: { '11': { value: ['UK'], source: { kind: 'nonsense' } } } } as unknown as IntakeState);
    const info = loadDraftInfo()!;
    expect(info.earlierVersionNotice).toBe(true);
    expect(info.state).toEqual({ step: 'graph_extraction', description: D, method: 'form' });
  });

  it('a reading step with no answers loads without them', () => {
    saveDraft({ step: 'prefill_reading', description: D });
    expect(loadDraftInfo()!.state).toEqual({
      step: 'graph_extraction',
      description: D,
      method: 'form',
      lastRead: { fingerprint: '', outcome: 'not-read' },
    });
  });
});

describe('lastRead is saved on every form-route step and checked on load (TC-R18-GI-8-11)', () => {
  it('survives on the description, the similar-cases step, the form and the confirmation', () => {
    const states: IntakeState[] = [
      { step: 'description_entry', description: D, decidedFor: textFingerprint(D), lastRead },
      { step: 'duplicate_check', description: D, lastRead },
      { step: 'graph_extraction', description: D, method: 'form', answerState: answers, lastRead },
      {
        step: 'confirmation',
        description: D,
        graph,
        graphVersion: 1,
        corrections: [],
        answers: [],
        resolutionNotes: [],
        useCaseId: 'c1',
        answerState: answers,
        lastRead,
        afterFailedEvaluation: false,
      },
    ];
    for (const s of states) {
      saveDraft(s);
      expect(loadDraftInfo()!.state, s.step).toMatchObject({ step: s.step, lastRead });
    }
  });

  it('a lastRead that fails its shape check makes the whole draft unusable (it lands on the form, no answers)', () => {
    saveDraft({ step: 'graph_extraction', description: D, method: 'form', lastRead: { fingerprint: 5, outcome: 'ok' } } as unknown as IntakeState);
    const info = loadDraftInfo()!;
    expect(info.earlierVersionNotice).toBe(true);
    expect(info.state).toEqual({ step: 'graph_extraction', description: D, method: 'form' });
  });

  it('an outcome outside the closed set is refused', () => {
    saveDraft({ step: 'description_entry', description: D, lastRead: { fingerprint: 'ab', outcome: 'made-up' } } as unknown as IntakeState);
    expect(loadDraftInfo()!.earlierVersionNotice).toBe(true);
  });
});

describe('the form draft and the reducer agree on lastRead (TC-R18-GI-8-11)', () => {
  it('updateFormDraft patches lastRead and keeps the answers; patching answers keeps lastRead', () => {
    updateFormDraft({ answerState: answers });
    updateFormDraft({ lastRead });
    expect(loadFormDraft()).toEqual({ version: 4, answerState: answers, lastRead });
    updateFormDraft({ answerState: {} });
    expect(loadFormDraft()!.lastRead).toEqual(lastRead);
  });
});
