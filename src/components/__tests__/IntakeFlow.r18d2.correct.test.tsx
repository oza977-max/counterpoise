import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { __resetDbsForTests } from '../../store/db';
import { SLOW_FLOW_MS } from './fillText';
import { describeToReadForm, installModel, reply } from './r18c2Flow';
import { currentVerdictAttestationFields } from '../RegisterDetail';
import {
  DESC,
  answerFormExceptFiveAndEleven,
  confirmAndReachVerdict,
  editFormDescription,
  ofType,
  sourcesOf,
  tickAll,
  trailOf,
} from './r18d2Flow';

// R18-D2, correcting in the same session (TC-R18-GI-10-05) and the corrected-description rule (§27.13):
// a correction writes `description` only when the confirmed text differs from the one now in force - the latest
// correction's, else the one the case was created with.

const FILLED = reply([
  { question: '5', values: [{ option: 'people', quote: 'client names' }] },
  { question: '11', values: [{ option: 'UK', quote: 'Our UK team' }] },
]);
const D2 = 'It reads account details. Our UK team will use it every morning, with a second check.';

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await __resetDbsForTests();
});
afterEach(() => vi.unstubAllGlobals());

async function firstVerdict(user: ReturnType<typeof userEvent.setup>, name: string) {
  installModel({ kind: 'honours-format', reply: FILLED });
  render(<App />);
  await describeToReadForm(user, DESC);
  await answerFormExceptFiveAndEleven(user, name);
  await tickAll(user);
  await user.click(screen.getByRole('button', { name: /^continue$/i }));
  await screen.findByText(/here.s what we understood/i);
  await confirmAndReachVerdict(user);
}

async function correctAgain(user: ReturnType<typeof userEvent.setup>, edit?: string) {
  await user.click(await screen.findByRole('button', { name: /correct your answers/i }));
  await screen.findByLabelText(/what do you want to call it/i);
  if (edit !== undefined) await editFormDescription(user, edit);
  await user.click(screen.getByRole('button', { name: /^continue$/i }));
  await confirmAndReachVerdict(user);
}

describe('correcting in the same session', () => {
  it(
    'TC-R18-GI-10-05: "Correct your answers" returns to the form with every confirmed answer, its quote and its tick - and no Back',
    async () => {
      const user = userEvent.setup({ delay: null });
      await firstVerdict(user, 'Same session tool');
      await user.click(await screen.findByRole('button', { name: /correct your answers/i }));
      await screen.findByLabelText(/what do you want to call it/i);
      expect(screen.getByLabelText(/what do you want to call it/i)).toHaveValue('Same session tool');
      const ticks = screen.getAllByRole('checkbox', { name: /^i've checked this answer/i });
      expect(ticks).toHaveLength(2);
      ticks.forEach((t) => expect(t).toBeChecked());
      expect(screen.getByText(/confirmed by you — suggested by .+ from your description: “client names”/)).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /information about people/i })).toBeChecked();
      expect(screen.getByRole('radio', { name: /^only me or my own team$/i })).toBeChecked();
      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^continue$/i })).toBeEnabled();
    },
    SLOW_FLOW_MS,
  );

  it(
    'a correction carries the new sources, writes no second graph_confirmed, and writes no description it did not edit',
    async () => {
      const user = userEvent.setup({ delay: null });
      await firstVerdict(user, 'Sources on correction');
      await correctAgain(user);
      const trail = await trailOf(DESC);
      expect(ofType(trail, 'graph_confirmed')).toHaveLength(1);
      const corrected = ofType(trail, 'verdict_corrected');
      expect(corrected).toHaveLength(1);
      expect(sourcesOf(corrected[0]!)).toEqual(sourcesOf(ofType(trail, 'graph_confirmed')[0]!));
      expect(Object.hasOwn(corrected[0]!.payload, 'description')).toBe(false);
      // the creation record is never rewritten
      expect(ofType(trail, 'use_case_created')).toHaveLength(1);
    },
    SLOW_FLOW_MS,
  );

  it(
    'the corrected description is written only when it differs from the one in force - including a revert',
    async () => {
      const user = userEvent.setup({ delay: null });
      await firstVerdict(user, 'Description rule tool');

      // 1. an edit: written, and the quote is judged against it
      await correctAgain(user, D2);
      let trail = await trailOf(DESC);
      let corrected = ofType(trail, 'verdict_corrected');
      expect((corrected[0]!.payload as { description?: string }).description).toBe(D2);
      expect(sourcesOf(corrected[0]!)!.answers.find((a) => a.question_id === '5')!.quote_in_final_description).toBe(false);
      expect(sourcesOf(corrected[0]!)!.answers.find((a) => a.question_id === '11')!.quote_in_final_description).toBe(true);
      expect(currentVerdictAttestationFields(trail).description).toBe(D2);

      // 2. a correction that leaves the text alone: nothing written, D2 still in force
      await correctAgain(user);
      trail = await trailOf(DESC);
      corrected = ofType(trail, 'verdict_corrected');
      expect(corrected).toHaveLength(2);
      expect(Object.hasOwn(corrected[1]!.payload, 'description')).toBe(false);
      expect(currentVerdictAttestationFields(trail).description).toBe(D2);

      // 3. a correction that puts the first text back: written (it differs from D2), so the register never keeps showing D2
      await correctAgain(user, DESC);
      trail = await trailOf(DESC);
      corrected = ofType(trail, 'verdict_corrected');
      expect(corrected).toHaveLength(3);
      expect((corrected[2]!.payload as { description?: string }).description).toBe(DESC);
      expect(currentVerdictAttestationFields(trail).description).toBe(DESC);
      expect(ofType(trail, 'graph_confirmed')).toHaveLength(1);
      expect((ofType(trail, 'use_case_created')[0]!.payload as { description: string }).description).toBe(DESC);
    },
    SLOW_FLOW_MS * 3,
  );
});
