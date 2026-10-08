import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  saveDraft,
  loadDraft,
  loadDraftInfo,
  clearDraft,
  loadFormDraft,
  updateFormDraft,
  clearFormDraft,
  probeLegacyFormDraft,
} from './intake-draft';
import { loadPolicy } from '../store/policy';
import { buildGraphFromForm } from '../engine/build-graph-from-form';
import { plainAnswersToFormValues } from '../engine/plain-intake';
import { WORKED_EXAMPLES } from '../engine/worked-examples';
import type { DataFlowGraph } from '../engine/types';
import type { IntakeState } from './intake-state';
import type { FormAnswerState } from '../engine/prefill-types';

// R18-A, draft v4 (specs/intake-flow.md §27.7; TC-R18-NF-5-01..04, GI-9).
// Fixtures are shaped by the REAL producers (BC-003): the graph comes from
// buildGraphFromForm over the guide's example answers, the states are the
// shapes the earlier builds' reducer wrote (versions 1, 2 and 3 of the draft
// envelope), and the old form-draft keys hold what StructuredForm wrote under
// them (the unversioned key held `{values, jurisdictionAnswer}`; `:v2` held
// raw PlainAnswers).

const DRAFT_KEY = 'aigate:intake-draft';
const FORM_V4 = 'aigate:intake-form-draft:v4';
const FORM_V2 = 'aigate:intake-form-draft:v2';
const FORM_UNVERSIONED = 'aigate:intake-form-draft';
const D = 'It reads client names and account details.';
const NEVER_READ = { fingerprint: '', outcome: 'not-read' };

let graph: DataFlowGraph;
let llmGraph: DataFlowGraph;
beforeAll(() => {
  const res = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
  if (!res.valid) throw new Error('policy invalid');
  const answers = { ...WORKED_EXAMPLES[0]!.answers, '2': D };
  const { values } = plainAnswersToFormValues(answers, res.policy);
  graph = buildGraphFromForm(values, '2026-10-01T00:00:00.000Z', () => 'node-id');
  llmGraph = { ...graph, intake_method: 'llm' };
});
beforeEach(() => {
  sessionStorage.clear();
});

function put(raw: unknown) {
  sessionStorage.setItem(DRAFT_KEY, typeof raw === 'string' ? raw : JSON.stringify(raw));
}

const LANDING = { step: 'graph_extraction', description: D, method: 'form' };

// What each earlier build really wrote.
function oldDrafts(): [string, unknown][] {
  const base = { description: D, corrections: [], useCaseId: 'uc-1' };
  const plainAnswers = { ...WORKED_EXAMPLES[0]!.answers, '2': D };
  const questionnaireLlm = {
    step: 'questionnaire', ...base, graph: llmGraph, questions: [], answers: [], resolutionNotes: [],
  };
  return [
    ['version 1 (bare state) questionnaire on the description path', questionnaireLlm],
    ['version 2 envelope, review of cards', { version: 2, state: {
      step: 'graph_review', ...base, graph: llmGraph, graphVersion: 1, unconfirmedNodeIds: ['n1'], jurisdictionsConfirmed: false } }],
    ['version 3 envelope, questionnaire with a back snapshot', { version: 3, state: { ...questionnaireLlm, backGraph: llmGraph } }],
    ['version 3 envelope, contradiction review', { version: 3, state: {
      step: 'contradiction_review', ...base, graph, questions: [], answers: [], contradictions: [], resolutionNotes: [], plainAnswers } }],
    ['version 3 envelope, confirmation with the form answers', { version: 3, state: {
      step: 'confirmation', ...base, graph, graphVersion: 1, answers: [], resolutionNotes: [], plainAnswers, assumptions: [], afterFailedEvaluation: false } }],
    ['version 3 envelope, graph_extraction on the model path', { version: 3, state: {
      step: 'graph_extraction', description: D, method: 'llm' } }],
    ['version 3 envelope, graph_extraction on the form path with answers', { version: 3, state: {
      step: 'graph_extraction', description: D, method: 'form', useCaseId: 'uc-1', plainAnswers, assumptions: [] } }],
  ];
}

describe('earlier drafts land on the form with the description and no answers (TC-R18-NF-5-01)', () => {
  it.each(oldDrafts())('TC-R18-NF-5-01: %s', (_name, draft) => {
    put(draft);
    const info = loadDraftInfo();
    expect(info).not.toBeNull();
    expect(info!.state).toEqual(LANDING);
    expect(info!.earlierVersionNotice).toBe(true);
    expect(info!.migratedFromOldBuild).toBe(false);
    // No answer, case id or graph came with it (the landing is a fresh form).
    expect(JSON.stringify(info!.state)).not.toMatch(/plainAnswers|useCaseId|answerState|uc-1/);
  });

  it('TC-R18-NF-5-01: the notice is computed at load and never persisted — once the landing is saved, a reload shows no notice', () => {
    put(oldDrafts()[2]![1]);
    const info = loadDraftInfo()!;
    expect(info.earlierVersionNotice).toBe(true);
    saveDraft(info.state);
    const again = loadDraftInfo()!;
    expect(again.earlierVersionNotice).toBe(false);
    expect(again.state).toEqual(LANDING);
    expect(sessionStorage.getItem(DRAFT_KEY)).not.toMatch(/earlierVersionNotice/);
  });

  it('a current (version 4) draft round-trips untouched and has no notice', () => {
    const state: IntakeState = { step: 'description_entry', description: D, nudgeFor: ['countries'] };
    saveDraft(state);
    const info = loadDraftInfo()!;
    expect(info.state).toEqual(state);
    expect(info.earlierVersionNotice).toBe(false);
    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY)!).version).toBe(4);
  });

  it('an earlier draft saved at the evaluation step is still reported as that step (the interrupted-check notice depends on it)', () => {
    put({ version: 3, state: { step: 'evaluation_pending', graph, useCaseId: 'uc-1' } });
    expect(loadDraft()?.step).toBe('evaluation_pending');
  });
});

describe('a damaged earlier draft still opens (TC-R18-NF-5-02)', () => {
  it.each([
    ['a description that is a number', { version: 3, state: { step: 'graph_extraction', description: 42, method: 'form' } }, ''],
    ['no description at all', { version: 2, state: { step: 'graph_review', graph: llmGraph } }, ''],
    ['a version from the future (99)', { version: 99, state: { step: 'confirmation', description: D } }, D],
  ])('TC-R18-NF-5-02: %s', (_name, draft, want) => {
    put(draft);
    const info = loadDraftInfo()!;
    expect(info.state).toEqual({ step: 'graph_extraction', description: want, method: 'form' });
    expect(info.earlierVersionNotice).toBe(true);
  });
});

describe('no stored shape is used unvalidated (TC-R18-NF-5-03, TC-R18-NF-5-04)', () => {
  it('TC-R18-NF-5-03: a version-4 draft whose answer state has a source outside the closed set is incompatible, not used', () => {
    put({ version: 4, state: { step: 'graph_extraction', description: D, method: 'form',
      answerState: { '4': { value: 'score', source: { kind: 'made-up' } } } } });
    const info = loadDraftInfo()!;
    expect(info.state).toEqual(LANDING);
    expect(info.earlierVersionNotice).toBe(true);
  });

  it('TC-R18-NF-5-03: a version-4 draft carrying a model-path step is incompatible (the route is the form)', () => {
    put({ version: 4, state: { step: 'graph_extraction', description: D, method: 'llm' } });
    expect(loadDraftInfo()!.state).toEqual(LANDING);
  });

  it('TC-R18-NF-5-03: a version-4 draft with an unknown step is incompatible', () => {
    put({ version: 4, state: { step: 'teleport', description: D } });
    expect(loadDraftInfo()!.state).toEqual(LANDING);
  });

  it('TC-R18-NF-5-03: a form draft with an answer value that is not a string or list of strings is incompatible', () => {
    sessionStorage.setItem(FORM_V4, JSON.stringify({ version: 4, answerState: { '4': { value: { x: 1 }, source: { kind: 'typed' } } }, lastRead: NEVER_READ }));
    expect(loadFormDraft()).toBeNull();
  });

  const hostile: [string, string][] = [
    ['truncated JSON', '{"version":3,"state":{"step":"conf'],
    ['null', 'null'],
    ['an array', '[1,2,3]'],
    ['a bare string', '"hello"'],
    ['a number', '7'],
    ['__proto__ at the top', '{"__proto__":{"step":"confirmation"},"version":3,"state":{"description":"' + D + '"}}'],
    ['__proto__ in the state', '{"version":4,"state":{"step":"graph_extraction","method":"form","description":"' + D + '","__proto__":{"polluted":true}}}'],
    ['constructor as an answer key', '{"version":4,"state":{"step":"graph_extraction","method":"form","description":"' + D + '","answerState":{"constructor":{"value":"x","source":{"kind":"typed"}}}}}'],
    ['version 0', '{"version":0,"state":{"step":"confirmation","description":"' + D + '"}}'],
    ['version -1', '{"version":-1,"state":{"step":"confirmation","description":"' + D + '"}}'],
    ['version 1.5', '{"version":1.5,"state":{"step":"confirmation","description":"' + D + '"}}'],
    ['version "2" as a string', '{"version":"2","state":{"step":"confirmation","description":"' + D + '"}}'],
    ['version NaN (stored as null)', JSON.stringify({ version: NaN, state: { step: 'confirmation', description: D } })],
  ];
  it.each(hostile)('TC-R18-NF-5-04: %s opens the form without throwing and never pollutes Object', (_name, raw) => {
    put(raw);
    const info = loadDraftInfo();
    expect(info).not.toBeNull();
    expect(info!.state.step).toBe('graph_extraction');
    expect(info!.earlierVersionNotice).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(info!.state)).toEqual(expect.arrayContaining(['step', 'description', 'method']));
  });

  it('TC-R18-NF-5-04: a 1 MB description and control characters are kept as a string and never throw', () => {
    const big = 'x'.repeat(1_000_000);
    put({ version: 3, state: { step: 'confirmation', description: big } });
    expect((loadDraftInfo()!.state as { description: string }).description.length).toBe(1_000_000);
    const ctl = 'a\u0000b‮c\u0007';
    put({ version: 3, state: { step: 'confirmation', description: ctl } });
    expect((loadDraftInfo()!.state as { description: string }).description).toBe(ctl);
  });

  it('TC-R18-NF-5-04 (property): for any stored value, loading never throws and ends at the form (or a valid current step) keeping a string description', () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 4 }), fc.string(), fc.boolean(), (value, desc, wrap) => {
        const stored =
          wrap && typeof value === 'object' && value !== null && !Array.isArray(value)
            ? { version: 3, state: { ...value, description: desc } }
            : value;
        put(JSON.stringify(stored));
        const info = loadDraftInfo();
        expect(info).not.toBeNull();
        if (info!.earlierVersionNotice) {
          expect(info!.state.step).toMatch(/^(graph_extraction|evaluation_pending)$/);
        }
        if (wrap && typeof value === 'object' && value !== null && !Array.isArray(value) && info!.state.step === 'graph_extraction') {
          expect((info!.state as { description: string }).description).toBe(desc);
        }
      }),
      { numRuns: 150 },
    );
  });
});

describe('updateFormDraft is the only writer of the form draft (specs/intake-flow.md §27.6)', () => {
  const state: FormAnswerState = { '1': { value: 'Ticket tool', source: { kind: 'typed' } } };

  it('writes version 4 with a never-read lastRead when nothing was stored', () => {
    updateFormDraft({ answerState: state });
    expect(JSON.parse(sessionStorage.getItem(FORM_V4)!)).toEqual({ version: 4, answerState: state, lastRead: NEVER_READ });
  });

  it('merges a patch: a lastRead patch keeps the answers, an answerState patch keeps lastRead', () => {
    updateFormDraft({ answerState: state });
    updateFormDraft({ lastRead: { fingerprint: 'abc', outcome: 'ok' } });
    expect(loadFormDraft()).toEqual({ version: 4, answerState: state, lastRead: { fingerprint: 'abc', outcome: 'ok' } });
    const next: FormAnswerState = { ...state, '3': { value: 'firm-built', source: { kind: 'typed' } } };
    updateFormDraft({ answerState: next });
    expect(loadFormDraft()).toEqual({ version: 4, answerState: next, lastRead: { fingerprint: 'abc', outcome: 'ok' } });
  });

  it('a stored value that fails validation is replaced, never merged into', () => {
    sessionStorage.setItem(FORM_V4, JSON.stringify({ version: 4, answerState: { __proto__x: 1, '4': { value: 'x', source: { kind: 'zzz' } } }, lastRead: 5 }));
    expect(loadFormDraft()).toBeNull();
    updateFormDraft({ answerState: state });
    expect(loadFormDraft()).toEqual({ version: 4, answerState: state, lastRead: NEVER_READ });
  });

  it('a version-5 form draft is incompatible', () => {
    sessionStorage.setItem(FORM_V4, JSON.stringify({ version: 5, answerState: {}, lastRead: NEVER_READ }));
    expect(loadFormDraft()).toBeNull();
  });

  it('rejects an oversized answer string', () => {
    const big: FormAnswerState = { '1': { value: 'x'.repeat(20_001), source: { kind: 'typed' } } };
    sessionStorage.setItem(FORM_V4, JSON.stringify({ version: 4, answerState: big, lastRead: NEVER_READ }));
    expect(loadFormDraft()).toBeNull();
  });

  it('never throws when storage refuses the write', () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      expect(() => updateFormDraft({ answerState: state })).not.toThrow();
    } finally {
      Storage.prototype.setItem = real;
    }
  });

  it('clearFormDraft removes it', () => {
    updateFormDraft({ answerState: state });
    clearFormDraft();
    expect(loadFormDraft()).toBeNull();
  });
});

describe('probeLegacyFormDraft probes and removes both earlier form keys once (TC-R18-NF-5-01)', () => {
  it('TC-R18-NF-5-01: the :v2 key (raw PlainAnswers) is reported and removed', () => {
    sessionStorage.setItem(FORM_V2, JSON.stringify({ '1': 'Old name', '3': 'firm-built' }));
    expect(probeLegacyFormDraft()).toBe(true);
    expect(sessionStorage.getItem(FORM_V2)).toBeNull();
    expect(probeLegacyFormDraft()).toBe(false);
  });

  it('TC-R18-NF-5-01: the unversioned key (field-by-field values) is reported and removed', () => {
    sessionStorage.setItem(FORM_UNVERSIONED, JSON.stringify({ values: { useCaseName: 'Old' }, jurisdictionAnswer: 'none' }));
    expect(probeLegacyFormDraft()).toBe(true);
    expect(sessionStorage.getItem(FORM_UNVERSIONED)).toBeNull();
  });

  it('both present: both are removed in one call, reported once; the v4 draft is untouched', () => {
    sessionStorage.setItem(FORM_V2, '{}');
    sessionStorage.setItem(FORM_UNVERSIONED, '{}');
    updateFormDraft({ answerState: { '1': { value: 'x', source: { kind: 'typed' } } } });
    expect(probeLegacyFormDraft()).toBe(true);
    expect(sessionStorage.getItem(FORM_V2)).toBeNull();
    expect(sessionStorage.getItem(FORM_UNVERSIONED)).toBeNull();
    expect(loadFormDraft()).not.toBeNull();
    expect(probeLegacyFormDraft()).toBe(false);
  });

  it('a legacy draft is never read as a current one', () => {
    sessionStorage.setItem(FORM_V2, JSON.stringify({ '1': 'Old name' }));
    expect(loadFormDraft()).toBeNull();
    clearDraft();
  });
});
