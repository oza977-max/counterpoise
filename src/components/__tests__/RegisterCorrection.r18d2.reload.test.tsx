import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { getAllForExport } from '../../store/audit';
import { loadDraft } from '../intake-draft';
import { fillText } from './fillText';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { updateUseCaseVerdictSummary } from '../../store/register';
import { loadPolicy } from '../../store/policy';
import { toAnswerSources } from '../../engine/answer-sources';
import { typedAnswersFromPlain } from '../../engine/form-visibility';
import { WORKED_EXAMPLES } from '../../engine/worked-examples';
import { seedCase, DESCRIPTION, READ_LOCAL } from '../../test-support/answer-sources-fixtures';
import type { FormAnswerState } from '../../engine/prefill-types';
import { SLOW_FLOW_MS } from './fillText';
import { findQuestion, restoreDroppedSentence, R18_COPY } from '../plain-copy';
import { confirmAndReachVerdict, ofType, sourcesOf, trailOf } from './r18d2Flow';

// R18-D2, TC-R18-GI-10-06: nothing from an earlier session is in memory (a fresh App over a seeded register). The
// case has one typed answer, one confirmed pre-fill, one changed pre-fill and one from_earlier_record answer.
// "Correct this check" restores them as they were recorded - the earlier-record answer unconfirmed, owing its
// tick - and the corrected case's verdict_corrected carries the new sources.

let record: FormAnswerState;
beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  record = typedAnswersFromPlain(WORKED_EXAMPLES.find((e) => e.id === 'case-1')!.answers, r.policy);
  record['5'] = {
    value: ['people'],
    source: { kind: 'prefilled', quotes: [{ option: 'people', quote: 'client names' }], read: READ_LOCAL, confirmed: true },
  };
  record['11'] = { value: ['US'], source: { kind: 'changed', from: [{ option: 'UK', quote: 'Our UK team' }], read: READ_LOCAL } };
  record['7'] = { value: 'me-or-team', source: { kind: 'record', confirmed: true } };
});
// The stores are shared by the tests of this file, so each test seeds a case with a description of its own and
// reads only that case's trail.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
const own = (tag: string) => `${DESCRIPTION} [${tag}]`;

describe('Correct this check, after a reload', () => {
  it(
    'TC-R18-GI-10-06: restores every answer from the record; every restored model answer and the earlier-record answer owes a fresh tick; Back is gone; the correction carries the new sources',
    async () => {
      const id = crypto.randomUUID();
      const D = own('reload');
      await seedCase(id, { sources: toAnswerSources(record, D), label: 'Reloaded case D2', description: D });
      await updateUseCaseVerdictSummary(id, { currentVerdictId: `v-${id}` });
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await user.click(screen.getByText('▤ Register'));
      await user.click(await screen.findByText('Reloaded case D2'));
      await user.click(await screen.findByRole('button', { name: /^correct this check$/i }));
      await screen.findByLabelText(/what do you want to call it/i, undefined, { timeout: 5000 });

      // every recorded answer is there; none is blank
      expect(screen.getByLabelText(/what do you want to call it/i)).toHaveValue('Clean approval — nothing triggers');
      expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue(D);
      expect(screen.getByRole('checkbox', { name: /information about people/i })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: /united states/i })).toBeChecked();
      expect(screen.getByRole('radio', { name: /^only me or my own team$/i })).toBeChecked();
      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
      // nothing was left blank, so no note says so (false-state)
      expect(screen.queryByText(/no longer match the form's choices/i)).not.toBeInTheDocument();
      // Owner decision 2026-10-22: the confirmed pre-fill keeps its quote but is NOT ticked; the changed answer and the
      // earlier-record answer are earlier-record answers. All three owe this person's own tick.
      expect(screen.getByRole('checkbox', { name: /^i've checked this answer.*what information/i })).not.toBeChecked();
      expect(screen.getByText(/suggested by alpha:7b from your description: “client names”/i)).toBeInTheDocument();
      expect(screen.queryByText(/confirmed by you — suggested by alpha:7b/i)).not.toBeInTheDocument();
      expect(screen.getAllByText(/from the earlier record/i).length).toBeGreaterThan(0);
      const ticks = screen.getAllByRole('checkbox', { name: /^i've checked this answer/i });
      expect(ticks).toHaveLength(3);
      for (const t of ticks) expect(t).not.toBeChecked();
      expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled();

      for (const t of ticks) await user.click(t);
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
      await confirmAndReachVerdict(user);

      const trail = await trailOf(D);
      expect(ofType(trail, 'graph_confirmed')).toHaveLength(1); // the original; the correction wrote none
      const corrected = ofType(trail, 'verdict_corrected');
      expect(corrected).toHaveLength(1);
      expect((corrected[0]!.payload as { original_verdict_id: string }).original_verdict_id).toBe(`v-${id}`);
      const rows = sourcesOf(corrected[0]!)!.answers;
      const origin = (q: string) => rows.find((a) => a.question_id === q)!.origin;
      expect(origin('1')).toBe('typed');
      expect(origin('5')).toBe('prefilled_confirmed');
      expect(origin('11')).toBe('from_earlier_record'); // changed by the earlier person, not this one
      expect(origin('7')).toBe('from_earlier_record');
    },
    SLOW_FLOW_MS * 2,
  );

  // Owner decision 2026-10-22 (pass-1 I1, provenance laundering): an imported bundle's record is self-asserted. It
  // can claim any answer was filled in by a model and confirmed; restoring it must not hand those ticks to the
  // person correcting. Continue stays blocked until they tick, and the new record is theirs alone.
  it('a forged record claiming confirmed pre-fills cannot be confirmed without the person ticking each one', async () => {
    const forged = { ...record };
    forged['7'] = {
      value: 'me-or-team',
      source: { kind: 'prefilled', quotes: [{ option: 'me-or-team', quote: 'only my team' }], read: READ_LOCAL, confirmed: true },
    };
    const id = crypto.randomUUID();
    const D = own('forged');
    await seedCase(id, { sources: toAnswerSources(forged, D), label: 'Forged bundle D2', description: D });
    await updateUseCaseVerdictSummary(id, { currentVerdictId: `v-${id}` });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await user.click(screen.getByText('▤ Register'));
    await user.click(await screen.findByText('Forged bundle D2'));
    await user.click(await screen.findByRole('button', { name: /^correct this check$/i }));
    await screen.findByLabelText(/what do you want to call it/i, undefined, { timeout: 5000 });

    const ticks = screen.getAllByRole('checkbox', { name: /^i've checked this answer/i });
    expect(ticks.length).toBeGreaterThanOrEqual(3); // 5, 7 and 11 (and the changed one) all owe a tick
    for (const t of ticks) expect(t).not.toBeChecked();
    // confirming without ticking is not possible
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(screen.queryByRole('button', { name: /confirm and evaluate/i })).not.toBeInTheDocument();
    const before = (await trailOf(D)).length;

    // tick them one by one: Continue opens only after the last
    for (const [i, t] of ticks.entries()) {
      await user.click(t);
      if (i < ticks.length - 1) expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled();
    }
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await confirmAndReachVerdict(user);

    const trail = await trailOf(D);
    expect(trail.length).toBeGreaterThan(before);
    const corrected = ofType(trail, 'verdict_corrected');
    expect(corrected).toHaveLength(1);
    const rows = sourcesOf(corrected[0]!)!.answers;
    const origin = (q: string) => rows.find((a) => a.question_id === q)!.origin;
    // ticked by this person: confirmed is now true of them. The earlier person's change is not claimed.
    expect(origin('5')).toBe('prefilled_confirmed');
    expect(origin('7')).toBe('prefilled_confirmed');
    expect(origin('11')).toBe('from_earlier_record');
  });

  // Pass-1 Minor 4: a recorded row the form no longer offers is left blank, and the person is told which.
  it('names the questions left blank when a recorded answer no longer fits the form, and only then', async () => {
    const id = crypto.randomUUID();
    const D = own('dropped');
    const written = toAnswerSources(record, D);
    // a stale row: Question 3model is shown only for some platforms, and this record's Question 3 is not one of them
    const withStale = { ...written, answers: [...written.answers, { question_id: '3model', value: 'Old model', origin: 'typed' }] };
    await seedCase(id, { sources: withStale, label: 'Dropped row D2', description: D });
    await updateUseCaseVerdictSummary(id, { currentVerdictId: `v-${id}` });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await user.click(screen.getByText('▤ Register'));
    await user.click(await screen.findByText('Dropped row D2'));
    await user.click(await screen.findByRole('button', { name: /^correct this check$/i }));
    await screen.findByLabelText(/what do you want to call it/i, undefined, { timeout: 5000 });
    const note = screen.getByText(/no longer match the form's choices and were left blank:/i);
    expect(note).toHaveAttribute('role', 'status');
    expect(note.textContent).toBe(restoreDroppedSentence([findQuestion('3model')!.text]));
    // one note, not one per row
    expect(screen.getAllByText(/no longer match the form's choices/i)).toHaveLength(1);
  });

  // R18-E: re-pointed from "has no Correct this check" - the older-case path is built; the acceptance test
  // (OlderCaseCorrection.r18e.acceptance) walks it through to a verdict_corrected.
  it('a case with no answer_sources offers "Correct this check" in the app, with the older-case note', async () => {
    const id = crypto.randomUUID();
    await seedCase(id, { label: 'Older case D2' });
    await updateUseCaseVerdictSummary(id, { currentVerdictId: `v-${id}` });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await user.click(screen.getByText('▤ Register'));
    await user.click(await screen.findByText('Older case D2'));
    await screen.findByRole('heading', { name: 'Older case D2' });
    expect(await screen.findByRole('button', { name: /correct this check/i })).toBeInTheDocument();
    expect(screen.getByText(R18_COPY.CORRECT_OLDER_CHECK_NOTE)).toBeInTheDocument();
  });

  // The note beside the action says two things; each is tested in the state where it could be false.
  it('opening it writes nothing to the audit trail, and replaces an unfinished check this tab held', async () => {
    const id = crypto.randomUUID();
    const D = own('open');
    await seedCase(id, { sources: toAnswerSources(record, D), label: 'Open-writes-nothing D2', description: D });
    await updateUseCaseVerdictSummary(id, { currentVerdictId: `v-${id}` });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    // an unfinished check: a description typed on the first screen, then a trip to the register
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'An unfinished check about a different tool.');
    await user.click(screen.getByText('▤ Register'));
    await user.click(await screen.findByText('Open-writes-nothing D2'));
    const countOwn = async () => (await getAllForExport()).filter((e) => e.use_case_id === id).length;
    const before = await countOwn();
    await user.click(await screen.findByRole('button', { name: /^correct this check$/i }));
    await screen.findByLabelText(/what do you want to call it/i, undefined, { timeout: 5000 });
    expect(await countOwn()).toBe(before); // nothing recorded until Confirm
    expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue(D);
    expect(screen.queryByDisplayValue('An unfinished check about a different tool.')).not.toBeInTheDocument();
    const draft = loadDraft() as { step: string; description: string; useCaseId?: string };
    expect(draft).toMatchObject({ step: 'graph_extraction', description: D, useCaseId: id });
  });
});
