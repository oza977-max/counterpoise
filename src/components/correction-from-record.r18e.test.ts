import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../store/policy';
import { correctionOpening, isRebuiltFromEarlierRecord, restorableAnswers, EARLIER_RECORD_GRAPH_PREFIX } from './correction-from-record';
import { describeAssumptions, olderDroppedSentence, R18_COPY } from './plain-copy';
import type { PolicyFile } from '../engine/types';

// R18-E: the older-case branch of correctionOpening / restorableAnswers (a record with no `answer_sources`).

let policy: PolicyFile;
beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  policy = r.policy;
});

const D = 'It reads client names and account details. Our UK team will use it every morning.';
const assumptions = () =>
  describeAssumptions([
    { questionId: '4', optionKey: 'not-sure', fields: ['model_type'] },
    { questionId: '9', optionKey: 'not-sure', fields: ['output_reversibility'] },
  ]);
const args = (over: Record<string, unknown> = {}) => ({
  useCaseId: 'uc-1',
  originalVerdictId: 'v-1',
  graphVersion: 3,
  description: D,
  sources: undefined as unknown,
  assumptions: assumptions() as unknown,
  policy,
  ...over,
});

describe('correctionOpening for an older case', () => {
  it('restores the two Not sure answers unconfirmed, marks the rest not-carried, and builds a stand-in original that nothing is diffed against', () => {
    const o = correctionOpening(args())!;
    expect(o).not.toBeNull();
    expect(o.answerState['4']).toEqual({ value: 'not-sure', source: { kind: 'record', confirmed: false } });
    expect(o.answerState['9']).toEqual({ value: 'not-sure', source: { kind: 'record', confirmed: false } });
    expect(o.answerState['1']!.source.kind).toBe('not-carried');
    expect(Object.values(o.answerState).filter((e) => e!.source.kind === 'record')).toHaveLength(2);
    expect(Object.values(o.answerState).some((e) => e!.source.kind === 'typed' || e!.source.kind === 'prefilled')).toBe(false);
    expect(o.description).toBe(D);
    expect(o.droppedNote).toBeNull();
    expect(o.originalGraph.version).toBe(3);
    expect(isRebuiltFromEarlierRecord(o.originalGraph)).toBe(true);
    expect(o.originalGraph.id.startsWith(EARLIER_RECORD_GRAPH_PREFIX)).toBe(true);
  });

  it('a case with answer_sources builds an original that IS diffed against (not the stand-in)', () => {
    const sources = { reads: [], answers: [{ question_id: '1', value: 'A name', origin: 'typed' }] };
    // too thin to reopen: no opening at all, and never the older-case path by accident
    expect(correctionOpening(args({ sources }))).toBeNull();
    expect(restorableAnswers(sources, D, policy, assumptions())).toBeNull();
    expect(isRebuiltFromEarlierRecord(undefined)).toBe(false);
    expect(isRebuiltFromEarlierRecord({ id: 'g-1' })).toBe(false);
  });

  it('a blank description gives no opening (nothing to keep)', () => {
    expect(correctionOpening(args({ description: '   ' }))).toBeNull();
    expect(restorableAnswers(undefined, '', policy, assumptions())).toBeNull();
  });

  it('hostile assumptions do not throw and restore nothing they should not', () => {
    for (const bad of [undefined, null, 'x', 5, {}, [null], [{ questionId: { x: 1 } }], [{ questionId: '__proto__' }], Array.from({ length: 500 }, () => ({ questionId: '4' }))]) {
      const o = correctionOpening(args({ assumptions: bad }));
      expect(o).not.toBeNull();
      for (const e of Object.values(o!.answerState)) expect(['record', 'not-carried']).toContain(e!.source.kind);
    }
  });

  it('an unusable graph version reads as 1, as for a case with sources', () => {
    expect(correctionOpening(args({ graphVersion: undefined }))!.originalGraph.version).toBe(1);
    expect(correctionOpening(args({ graphVersion: 0 }))!.originalGraph.version).toBe(1);
  });
});

// R18-G (forward note 2026-10-24): a questionnaire-route "Not sure" ("field:vendor") that cannot be put back is
// named in the form's note, in the record's own words, after the form questions that could not be put back.
describe('correctionOpening names questionnaire-route Not sure answers it could not restore', () => {
  const vendorRow = { questionId: 'field:vendor', question: 'Which supplier made it?', shortLabel: 'the supplier', assumption: 'a', fields: ['vendor'] };

  it('names it alone, and keeps the answers it could restore', () => {
    const o = correctionOpening(args({ assumptions: [...assumptions(), vendorRow] }))!;
    expect(o.droppedNote).toBe(olderDroppedSentence(['Which supplier made it?']));
    expect(o.answerState['4']!.source.kind).toBe('record');
  });

  it('puts the form questions first, then the questionnaire ones, in one sentence', () => {
    const three = describeAssumptions([{ questionId: '3a', optionKey: 'not-sure', fields: ['f'] }]);
    const o = correctionOpening(args({ assumptions: [...three, vendorRow] }))!;
    expect(o.droppedNote!.startsWith(R18_COPY.OLDER_DROPPED_PREFIX)).toBe(true);
    expect(o.droppedNote!.endsWith('Which supplier made it?.')).toBe(true);
    expect((o.droppedNote!.match(/; /g) ?? []).length).toBe(1);
  });

  it('words with a hidden direction-change character are shown as an escape, never obeyed', () => {
    const o = correctionOpening(args({ assumptions: [{ ...vendorRow, question: 'Which\u202Esupplier?' }] }))!;
    expect(o.droppedNote).not.toContain('\u202E');
    expect(o.droppedNote).toContain('U+202E');
  });

  it('false state: no note when nothing was lost (and none for a case that has answer_sources)', () => {
    expect(correctionOpening(args())!.droppedNote).toBeNull();
  });
});
