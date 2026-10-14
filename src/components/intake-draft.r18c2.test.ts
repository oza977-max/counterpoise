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

describe('lastRead is read only where the step carries it (review pass 1, M6)', () => {
  const review = { step: 'verdict', verdictId: 'v1' };

  it('TC-R18-GI-8-11: a valid lastRead on a step that does not carry it is dropped, not restored', () => {
    saveDraft({ ...review, lastRead } as unknown as IntakeState);
    const state = loadDraftInfo()!.state as unknown as Record<string, unknown>;
    expect(state.step).toBe('verdict');
    expect('lastRead' in state).toBe(false);
  });

  it('TC-R18-GI-8-11: a malformed lastRead on a step that does not carry it cannot make the draft unusable', () => {
    saveDraft({ ...review, lastRead: { fingerprint: 5, outcome: 'made-up' } } as unknown as IntakeState);
    const info = loadDraftInfo()!;
    expect(info.earlierVersionNotice).not.toBe(true);
    expect(info.state.step).toBe('verdict');
  });

  it('TC-R18-GI-8-11: on a step that does carry it (the form), a valid lastRead is restored and a malformed one is refused', () => {
    saveDraft({ step: 'graph_extraction', description: D, method: 'form', lastRead } as unknown as IntakeState);
    expect(loadDraftInfo()!.state).toMatchObject({ lastRead });
    saveDraft({ step: 'graph_extraction', description: D, method: 'form', lastRead: { fingerprint: 5, outcome: 'ok' } } as unknown as IntakeState);
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

describe('an earlier build’s form answers come back as typed where the form still offers them (TC-R18-NF-5-03, spec §27.7)', () => {
  const put = (raw: unknown) => sessionStorage.setItem(DRAFT_KEY, JSON.stringify(raw));
  const base = { description: D, corrections: [], useCaseId: 'uc-1' };
  const plainAnswers = { '1': 'Old tool', '2': D, '3': 'firm-built', '4': 'Gigantic', '5': ['everyday'], '10': 'wide', '11': ['Atlantis'] };

  it.each(['confirmation', 'questionnaire', 'contradiction_review'])('a version 3 %s keeps the valid answers as typed and leaves "Gigantic" and an unknown country blank', (step) => {
    put({ version: 3, state: { step, ...base, graph, graphVersion: 1, questions: [], answers: [], contradictions: [], resolutionNotes: [], plainAnswers, assumptions: [] } });
    const info = loadDraftInfo()!;
    expect(info.earlierVersionNotice).toBe(true);
    const a = (info.state as { answerState: FormAnswerState }).answerState;
    expect(a['1']).toEqual({ value: 'Old tool', source: { kind: 'typed' } });
    expect(a['3']).toEqual({ value: 'firm-built', source: { kind: 'typed' } });
    expect(a['5']).toEqual({ value: ['everyday'], source: { kind: 'typed' } });
    expect(a['10']).toEqual({ value: 'wide', source: { kind: 'typed' } });
    expect(a['4']).toBeUndefined();
    expect(a['11']).toBeUndefined();
    expect(JSON.stringify(info.state)).not.toMatch(/Gigantic|Atlantis|uc-1|input_nodes|"confirmed"|"prefilled"/);
    expect(info.state).toMatchObject({ step: 'graph_extraction', method: 'form', description: D });
  });

  it('a version 3 form-path graph_extraction keeps them too; a model-path one, a version 4 and a future version keep none', () => {
    put({ version: 3, state: { step: 'graph_extraction', description: D, method: 'form', plainAnswers } });
    expect((loadDraftInfo()!.state as { answerState?: FormAnswerState }).answerState?.['3']).toBeDefined();
    put({ version: 3, state: { step: 'graph_extraction', description: D, method: 'llm', plainAnswers } });
    expect((loadDraftInfo()!.state as { answerState?: unknown }).answerState).toBeUndefined();
    put({ version: 99, state: { step: 'confirmation', ...base, graph, plainAnswers } });
    expect((loadDraftInfo()!.state as { answerState?: unknown }).answerState).toBeUndefined();
    put({ version: 4, state: { step: 'confirmation', ...base, graph, plainAnswers: 'nope' } });
    expect((loadDraftInfo()!.state as { answerState?: unknown }).answerState).toBeUndefined();
  });

  it('a card-review draft (no form answers at all) and an answer set that is entirely invalid land with no answerState field', () => {
    put({ version: 2, state: { step: 'graph_review', ...base, graph, graphVersion: 1 } });
    expect(loadDraftInfo()!.state).toEqual({ step: 'graph_extraction', description: D, method: 'form' });
    put({ version: 3, state: { step: 'confirmation', ...base, graph, plainAnswers: { '4': 'Gigantic' } } });
    expect(loadDraftInfo()!.state).toEqual({ step: 'graph_extraction', description: D, method: 'form' });
  });
});

describe('the form-route graph_extraction step is checked field by field (R18-A forward note, closed in C2)', () => {
  const put = (state: object) => sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 4, state }));
  const ok = { step: 'graph_extraction', description: D, method: 'form' };
  const LANDING = { step: 'graph_extraction', description: D, method: 'form' };
  const good = { questionId: '4', question: 'q', shortLabel: 's', assumption: 'a', fields: ['f'] };

  it('a well-formed assumption list, afterFailedEvaluation and originalVerdictId are kept', () => {
    put({ ...ok, assumptions: [good], afterFailedEvaluation: true, originalVerdictId: 'v-1' });
    const info = loadDraftInfo()!;
    expect(info.earlierVersionNotice).toBe(false);
    expect(info.state).toMatchObject({ assumptions: [good], afterFailedEvaluation: true, originalVerdictId: 'v-1' });
  });

  it('an assumption saved without shortLabel and fields (an older shape) is kept', () => {
    const old = { questionId: '9', question: 'q', assumption: 'a' };
    put({ ...ok, assumptions: [old] });
    expect(loadDraftInfo()!.state).toMatchObject({ assumptions: [old] });
  });

  it.each([
    ['an assumption that is a number', { assumptions: [1] }],
    ['an assumption missing its text', { assumptions: [{ questionId: '4', question: 'q', shortLabel: 's', fields: [] }] }],
    ['an assumption whose shortLabel is a number', { assumptions: [{ ...good, shortLabel: 3 }] }],
    ['an assumption whose fields are not strings', { assumptions: [{ ...good, fields: [1] }] }],
    ['an assumption with a __proto__ key', { assumptions: JSON.parse('[{"__proto__":{"x":1},"questionId":"4","question":"q","shortLabel":"s","assumption":"a","fields":[]}]') }],
    ['afterFailedEvaluation that is a string', { afterFailedEvaluation: 'yes' }],
    ['originalVerdictId that is a number', { originalVerdictId: 5 }],
  ])('%s makes the draft incompatible (the safe landing, with the sentence)', (_n, extra) => {
    put({ ...ok, ...extra });
    const info = loadDraftInfo()!;
    expect(info.state).toEqual(LANDING);
    expect(info.earlierVersionNotice).toBe(true);
  });
});
