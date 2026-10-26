import { describe, it, expect, beforeEach } from 'vitest';
import { loadDraftInfo, saveDraft } from './intake-draft';
import { EARLIER_CARD_REVIEW_STEP } from '../test-support/earlier-drafts';
import type { IntakeState } from './intake-state';

// R18-E (specs/intake-flow.md §27.7, TC-R18-NF-5): a saved draft that points at the retired card-review step opens on
// the form with its description kept - from any version, including a version-4 draft written by a build between
// Round 18-A and this one - and is never given back as that step. Nothing in the draft is carried but the words.

const D = 'It reads client names. Our UK team will use it every morning.';
const graph = { id: 'g', version: 1, input_nodes: [], processing_nodes: [], output_nodes: [], edges: [], jurisdictions: [], intake_method: 'llm', extracted_at: '2026-01-01T00:00:00.000Z' };
const LANDING = { step: 'graph_extraction', description: D, method: 'form' };
const put = (raw: unknown) => sessionStorage.setItem('aigate:intake-draft', JSON.stringify(raw));

beforeEach(() => sessionStorage.clear());

describe('a draft naming the retired card-review step lands on the form', () => {
  it.each([
    ['version 1 (bare state)', { step: EARLIER_CARD_REVIEW_STEP, description: D, graph, graphVersion: 1, corrections: [], useCaseId: 'uc-1' }],
    ['version 2', { version: 2, state: { step: EARLIER_CARD_REVIEW_STEP, description: D, graph, graphVersion: 1, corrections: [], useCaseId: 'uc-1', unconfirmedNodeIds: ['n1'] } }],
    ['version 3', { version: 3, state: { step: EARLIER_CARD_REVIEW_STEP, description: D, graph, graphVersion: 1, corrections: [], useCaseId: 'uc-1', jurisdictionsConfirmed: false } }],
    ['version 4 (written between Round 18-A and the retirement)', { version: 4, state: { step: EARLIER_CARD_REVIEW_STEP, description: D, graph, graphVersion: 1, corrections: [], useCaseId: 'uc-1' } }],
  ])('TC-R18-NF-5-01 (E): %s keeps the description, carries no case, graph or answers, and says it was saved by an earlier version', (_name, draft) => {
    put(draft);
    const info = loadDraftInfo()!;
    expect(info.state).toEqual(LANDING);
    expect(info.earlierVersionNotice).toBe(true);
    expect(JSON.stringify(info.state)).not.toMatch(/useCaseId|uc-1|input_nodes|unconfirmed|jurisdictionsConfirmed/);
  });

  it('a version-4 draft naming it is not a draft this build wrote, so it is flagged like any other it cannot use as saved', () => {
    put({ version: 4, state: { step: EARLIER_CARD_REVIEW_STEP, description: D, graph, graphVersion: 1, corrections: [], useCaseId: 'uc-1' } });
    expect(loadDraftInfo()!.earlierVersionNotice).toBe(true);
  });

  it('GI-13-01: a draft this build wrote is NOT flagged as an earlier version (the notice is claimed only where true)', () => {
    saveDraft({ step: 'graph_extraction', description: D, method: 'form' } as IntakeState);
    const info = loadDraftInfo()!;
    expect(info.state).toMatchObject({ step: 'graph_extraction', description: D });
    expect(info.earlierVersionNotice).toBe(false);
  });
});
