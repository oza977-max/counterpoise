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
    'TC-R18-GI-10-06: restores every answer from the record; the earlier-record answer owes its tick; Back is gone; the correction carries the new sources',
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
      // the confirmed pre-fill keeps its tick and its quote; the changed one needs none; the earlier-record one owes its tick
      expect(screen.getByRole('checkbox', { name: /^i've checked this answer.*what information/i })).toBeChecked();
      expect(screen.getByText(/confirmed by you — suggested by alpha:7b from your description: “client names”/)).toBeInTheDocument();
      expect(screen.getByText(/from the earlier record/i)).toBeInTheDocument();
      const ticks = screen.getAllByRole('checkbox', { name: /^i've checked this answer/i });
      expect(ticks).toHaveLength(2);
      const owed = ticks.find((t) => !(t as HTMLInputElement).checked)!;
      expect(owed).toBeDefined();
      expect(owed).toHaveAccessibleName(/who will see|who sees|produces|result/i);
      expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled();

      await user.click(owed);
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
      expect(origin('11')).toBe('prefilled_changed');
      expect(origin('7')).toBe('from_earlier_record');
    },
    SLOW_FLOW_MS * 2,
  );

  it('a case with no answer_sources has no "Correct this check" in the app (the older-case path is a later chunk)', async () => {
    const id = crypto.randomUUID();
    await seedCase(id, { label: 'Older case D2' });
    await updateUseCaseVerdictSummary(id, { currentVerdictId: `v-${id}` });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await user.click(screen.getByText('▤ Register'));
    await user.click(await screen.findByText('Older case D2'));
    await screen.findByRole('heading', { name: 'Older case D2' });
    expect(screen.queryByRole('button', { name: /correct this check/i })).not.toBeInTheDocument();
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
