import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegisterDetail from '../RegisterDetail';
import { loadPolicy } from '../../store/policy';
import { toAnswerSources } from '../../engine/answer-sources';
import { typedAnswersFromPlain } from '../../engine/form-visibility';
import { WORKED_EXAMPLES } from '../../engine/worked-examples';
import { R18_COPY } from '../plain-copy';
import { seedCase, DESCRIPTION, READ_LOCAL } from '../../test-support/answer-sources-fixtures';
import type { PolicyFile } from '../../engine/types';
import type { FormAnswerState } from '../../engine/prefill-types';

// R18-D2 (specs/intake-flow.md §27.10, TC-R18-GI-10-08, GI-13-01): "Correct this check" on the register detail.
// A submitter action; offered only for a case whose CURRENT record can reopen the form; and every sentence it
// adds is tested in the state where it must be absent.

let policy: PolicyFile;
let complete: FormAnswerState;
beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  policy = r.policy;
  complete = typedAnswersFromPlain(WORKED_EXAMPLES.find((e) => e.id === 'case-1')!.answers, policy);
  // one model-filled answer, confirmed, so the record carries a read
  complete['11'] = {
    value: ['UK'],
    source: { kind: 'prefilled', quotes: [{ option: 'UK', quote: 'Our UK team' }], read: READ_LOCAL, confirmed: true },
  };
});
beforeEach(() => localStorage.clear());

const sources = () => toAnswerSources(complete, DESCRIPTION);
const LABEL = /^correct this check$/i;

describe('R18-D2 "Correct this check" on the register detail', () => {
  it('TC-R18-GI-10-08: the submitter sees it, with its note; the 2LoD reviewer, on the very same case, sees neither', async () => {
    const id = crypto.randomUUID();
    await seedCase(id, { sources: sources() });
    const submitter = render(<RegisterDetail useCaseId={id} role="1LoD" policy={policy} onBack={() => {}} onCorrectFromRecord={() => {}} />);
    expect(await screen.findByRole('button', { name: LABEL })).toBeInTheDocument();
    expect(screen.getByText(R18_COPY.CORRECT_THIS_CHECK_NOTE)).toBeInTheDocument();
    // the note must not imply the answers come back confirmed (owner decision 2026-10-22)
    expect(R18_COPY.CORRECT_THIS_CHECK_NOTE).toMatch(/need your tick again/);
    expect(R18_COPY.CORRECT_THIS_CHECK_NOTE).not.toMatch(/your answers|confirmed answers/i);
    submitter.unmount();
    render(<RegisterDetail useCaseId={id} role="2LoD" policy={policy} onBack={() => {}} onCorrectFromRecord={() => {}} />);
    await screen.findByRole('region', { name: /where each answer came from/i });
    expect(screen.queryByRole('button', { name: LABEL })).not.toBeInTheDocument();
    expect(screen.queryByText(R18_COPY.CORRECT_THIS_CHECK_NOTE)).not.toBeInTheDocument();
  });

  // R18-G (forward note 2026-10-24, "a test for the RegisterDetail onCorrect row"): the verdict shown inside the
  // register detail is not given the intake's own `onCorrect`, so it carries no second correction button. The one
  // way to correct a check from the register is the submitter's "Correct this check" action, whose opening is built
  // from the record; the verdict's own button (which reopens the in-memory case) would be a second, different one.
  it('GI-10-08 (the onCorrect row): the verdict inside the register detail has no correction button of its own, for either role; the register action is the only one', async () => {
    const id = crypto.randomUUID();
    await seedCase(id, { sources: sources() });
    const own = /think we got something wrong|if we.ve misunderstood how you.d use it/i;
    const submitter = render(<RegisterDetail useCaseId={id} role="1LoD" policy={policy} onBack={() => {}} onCorrectFromRecord={() => {}} />);
    await screen.findByRole('button', { name: LABEL });
    expect(document.querySelector('.verdict__first-correct')).toBeNull();
    expect(screen.queryByText(own)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /correct/i }).filter((b) => LABEL.test(b.textContent ?? ''))).toHaveLength(1);
    submitter.unmount();
    render(<RegisterDetail useCaseId={id} role="2LoD" policy={policy} onBack={() => {}} onCorrectFromRecord={() => {}} />);
    await screen.findByRole('region', { name: /where each answer came from/i });
    expect(document.querySelector('.verdict__first-correct')).toBeNull();
    expect(screen.queryByText(own)).not.toBeInTheDocument();
  });

  // R18-E: the older-case path exists now, so these two D2 tests (which asserted the action was ABSENT for a record
  // with no answer_sources) are re-pointed: it is offered, with its own note, and the new-case note is the one absent.
  it('GI-13-01: for a case with no answer_sources (an older case) it is offered with the older-case note, and the new-case note is absent', async () => {
    const id = crypto.randomUUID();
    await seedCase(id, {});
    render(<RegisterDetail useCaseId={id} role="1LoD" policy={policy} onBack={() => {}} onCorrectFromRecord={() => {}} />);
    await screen.findByRole('heading', { name: /client email drafting assistant/i });
    expect(await screen.findByRole('button', { name: LABEL })).toBeInTheDocument();
    expect(screen.getByText(R18_COPY.CORRECT_OLDER_CHECK_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(R18_COPY.CORRECT_THIS_CHECK_NOTE)).not.toBeInTheDocument();
  });

  it('GI-13-01: the older-case note is absent for a case that has answer_sources, and the 2LoD reviewer sees neither note on an older case', async () => {
    const withSources = crypto.randomUUID();
    const older = crypto.randomUUID();
    await seedCase(withSources, { sources: sources() });
    await seedCase(older, {});
    const first = render(<RegisterDetail useCaseId={withSources} role="1LoD" policy={policy} onBack={() => {}} onCorrectFromRecord={() => {}} />);
    await screen.findByRole('button', { name: LABEL });
    expect(screen.queryByText(R18_COPY.CORRECT_OLDER_CHECK_NOTE)).not.toBeInTheDocument();
    first.unmount();
    render(<RegisterDetail useCaseId={older} role="2LoD" policy={policy} onBack={() => {}} onCorrectFromRecord={() => {}} />);
    await screen.findByRole('heading', { name: /client email drafting assistant/i });
    expect(screen.queryByRole('button', { name: LABEL })).not.toBeInTheDocument();
    expect(screen.queryByText(R18_COPY.CORRECT_OLDER_CHECK_NOTE)).not.toBeInTheDocument();
  });

  it('GI-13-01: when the CURRENT record has none, even if an earlier confirmation did, it is the older-case path - the earlier record is not believed', async () => {
    const id = crypto.randomUUID();
    await seedCase(id, { sources: sources(), corrections: [{}] });
    const onCorrect = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<RegisterDetail useCaseId={id} role="1LoD" policy={policy} onBack={() => {}} onCorrectFromRecord={onCorrect} />);
    await screen.findByText(R18_COPY.SOURCES_HISTORY_NOTE);
    expect(screen.getByText(R18_COPY.CORRECT_OLDER_CHECK_NOTE)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: LABEL }));
    const opening = onCorrect.mock.calls[0]![0];
    // nothing from the earlier record's sources comes back: every answer is blank and marked
    // (only the case name, which the register keeps, comes back - from the record, unconfirmed)
    const entries = Object.entries(opening.answerState) as [string, { source: { kind: string; confirmed?: boolean } }][];
    expect(entries.filter(([k]) => k !== '1').every(([, e]) => e.source.kind === 'not-carried')).toBe(true);
    expect(opening.answerState['1'].source).toEqual({ kind: 'record', confirmed: false });
    expect(opening.originalVerdictId).toBe(`v-${id}-c1`);
  });

  it('GI-13-01: it is offered from a correction\'s own sources, and reopens on the correction\'s description', async () => {
    const id = crypto.randomUUID();
    const edited = 'It reads client names. Our UK team will use it every morning, with a second check.';
    await seedCase(id, { sources: sources(), corrections: [{ answer_sources: sources(), description: edited }] });
    const onCorrect = vi.fn();
    const user = userEvent.setup();
    render(<RegisterDetail useCaseId={id} role="1LoD" policy={policy} onBack={() => {}} onCorrectFromRecord={onCorrect} />);
    await user.click(await screen.findByRole('button', { name: LABEL }));
    expect(onCorrect).toHaveBeenCalledTimes(1);
    expect(onCorrect.mock.calls[0]![0]).toMatchObject({ description: edited, originalVerdictId: `v-${id}-c1` });
  });

  it('GI-13-01: it is not offered when the record cannot reopen the form (answers missing), and not without a policy or a host', async () => {
    const thin = { reads: [], answers: [{ question_id: '1', value: 'Only a name', origin: 'typed' }] };
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await seedCase(a, { sources: thin });
    await seedCase(b, { sources: sources() });
    const { unmount } = render(<RegisterDetail useCaseId={a} role="1LoD" policy={policy} onBack={() => {}} onCorrectFromRecord={() => {}} />);
    await screen.findByRole('region', { name: /where each answer came from/i });
    expect(screen.queryByRole('button', { name: LABEL })).not.toBeInTheDocument();
    unmount();
    const second = render(<RegisterDetail useCaseId={b} role="1LoD" onBack={() => {}} onCorrectFromRecord={() => {}} />);
    await screen.findByRole('region', { name: /where each answer came from/i });
    expect(screen.queryByRole('button', { name: LABEL })).not.toBeInTheDocument();
    second.unmount();
    render(<RegisterDetail useCaseId={b} role="1LoD" policy={policy} onBack={() => {}} />);
    await screen.findByRole('region', { name: /where each answer came from/i });
    expect(screen.queryByRole('button', { name: LABEL })).not.toBeInTheDocument();
  });

  it('GI-13-01: a hostile record (an unknown origin on every row) offers nothing it could confirm', async () => {
    const id = crypto.randomUUID();
    const hostile = { reads: [], answers: sources().answers.map((r) => ({ ...r, origin: 'telepathy' })) };
    await seedCase(id, { sources: hostile });
    render(<RegisterDetail useCaseId={id} role="1LoD" policy={policy} onBack={() => {}} onCorrectFromRecord={() => {}} />);
    await screen.findByRole('heading', { name: /client email drafting assistant/i });
    await waitFor(() => expect(screen.queryByRole('button', { name: LABEL })).not.toBeInTheDocument());
  });

  it('pressing it hands over the case, the verdict being corrected, the restored answers and a rebuilt original graph - once, even on a double press', async () => {
    const id = crypto.randomUUID();
    await seedCase(id, { sources: sources() });
    const onCorrect = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<RegisterDetail useCaseId={id} role="1LoD" policy={policy} onBack={() => {}} onCorrectFromRecord={onCorrect} />);
    const button = await screen.findByRole('button', { name: LABEL });
    await user.dblClick(button);
    expect(onCorrect).toHaveBeenCalledTimes(1);
    const opening = onCorrect.mock.calls[0]![0];
    expect(opening).toMatchObject({ useCaseId: id, originalVerdictId: `v-${id}`, description: DESCRIPTION });
    expect(opening.answerState['11'].source).toMatchObject({ kind: 'prefilled', confirmed: false, read: READ_LOCAL }); // owner decision 2026-10-22: a restored model answer owes a fresh tick
    expect(opening.answerState['1'].source).toEqual({ kind: 'typed' });
    expect(opening.originalGraph.version).toBe(1); // the seeded verdict names no version: read as 1
    expect(opening.originalGraph.processing_nodes).toHaveLength(1);
  });
});

describe('R18-E review pass 1: the older-case note is true whether or not a Not sure was recorded', () => {
  it('GI-13-01: the note promises filled-in answers only conditionally, so it is true for a case that recorded none (nothing to fill in)', () => {
    const N = R18_COPY.CORRECT_OLDER_CHECK_NOTE;
    expect(N).toMatch(/If you marked any answers as not sure/);
    expect(N).not.toMatch(/the answers you were not sure about filled in/);
    expect(N).not.toMatch(/approved|rejected/i);
  });

  it('GI-13-01: on a case with nothing recorded, the same note is shown and the form it opens has no answer from the record except the name', async () => {
    const id = crypto.randomUUID();
    await seedCase(id, {});
    const onCorrect = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(<RegisterDetail useCaseId={id} role="1LoD" policy={policy} onBack={() => {}} onCorrectFromRecord={onCorrect} />);
    expect(await screen.findByText(R18_COPY.CORRECT_OLDER_CHECK_NOTE)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: LABEL }));
    const state = onCorrect.mock.calls[0]![0].answerState as Record<string, { source: { kind: string } }>;
    const fromRecord = Object.keys(state).filter((k) => state[k]!.source.kind === 'record');
    expect(fromRecord).toEqual(['1']);
  });
});
