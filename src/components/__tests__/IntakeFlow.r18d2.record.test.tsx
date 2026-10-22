import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { __resetDbsForTests } from '../../store/db';
import { SLOW_FLOW_MS } from './fillText';
import { describeToReadForm, describeAndContinue, installModel, reply, FORM_HEADING, FORM_WAIT } from './r18c2Flow';
import {
  DESC,
  answerFormExceptFiveAndEleven,
  confirmAndReachVerdict,
  editFormDescription,
  ofType,
  sourcesOf,
  tickAll,
  trailOf,
  typeFiveAndEleven,
} from './r18d2Flow';

// R18-D2, the write side (specs/intake-flow.md §27.13 Writer): exactly one graph_confirmed per confirm attempt,
// carrying where every answer came from. The audit trail is append-only, so every path that could write twice is
// tested by COUNTING events, not by checking that an event exists.

const FILLED = reply([
  { question: '5', values: [{ option: 'people', quote: 'client names' }] },
  { question: '11', values: [{ option: 'UK', quote: 'Our UK team' }] },
]);

// Each test reads the trail of the one case it made, so every test starts from empty stores.
beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await __resetDbsForTests();
});
afterEach(() => vi.unstubAllGlobals());

async function typedOnlyToConfirmation(user: ReturnType<typeof userEvent.setup>, name: string) {
  await describeAndContinue(user, DESC);
  await screen.findByText(FORM_HEADING, undefined, FORM_WAIT);
  await answerFormExceptFiveAndEleven(user, name);
  await typeFiveAndEleven(user);
  await user.click(screen.getByRole('button', { name: /^continue$/i }));
  await screen.findByText(/here.s what we understood/i);
}

describe('the write: one graph_confirmed per confirm attempt', () => {
  it(
    'TC-R18-GI-5-07: a double press on "Confirm and evaluate", under React StrictMode, writes ONE graph_confirmed, with typed rows and no reads',
    async () => {
      const user = userEvent.setup({ delay: null });
      render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
      await typedOnlyToConfirmation(user, 'Typed only tool');
      const button = await screen.findByRole('button', { name: /confirm and evaluate/i });
      // two presses inside one batch: neither sees the other's state update, so only the synchronous guard can stop the second
      act(() => {
        button.click();
        button.click();
      });
      await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
      const trail = await trailOf(DESC);
      expect(ofType(trail, 'graph_confirmed')).toHaveLength(1);
      expect(ofType(trail, 'verdict_produced')).toHaveLength(1);
      expect(ofType(trail, 'use_case_created')).toHaveLength(1);
      const sources = sourcesOf(ofType(trail, 'graph_confirmed')[0]!)!;
      expect(sources.reads).toEqual([]);
      expect(sources.answers.length).toBeGreaterThan(5);
      expect(sources.answers.every((a) => a.origin === 'typed')).toBe(true);
      expect(sources.answers.some((a) => a.question_id === '2')).toBe(false);
      const q5 = sources.answers.find((a) => a.question_id === '5')!;
      expect(q5.value).toEqual(['everyday']);
    },
    SLOW_FLOW_MS,
  );

  it(
    'under React StrictMode a model-filled case still writes ONE graph_confirmed, carrying quotes and the read',
    async () => {
      installModel({ kind: 'honours-format', reply: FILLED });
      const user = userEvent.setup({ delay: null });
      render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
      await describeToReadForm(user, DESC);
      await answerFormExceptFiveAndEleven(user, 'Strict mode tool');
      await tickAll(user);
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
      await screen.findByText(/here.s what we understood/i);
      await confirmAndReachVerdict(user);
      const trail = await trailOf(DESC);
      expect(ofType(trail, 'graph_confirmed')).toHaveLength(1);
      expect(ofType(trail, 'use_case_created')).toHaveLength(1);
      const sources = sourcesOf(ofType(trail, 'graph_confirmed')[0]!)!;
      expect(sources.reads).toEqual([{ model: 'alpha:7b', place: 'this-computer', host: 'http://localhost:11434' }]);
      const q5 = sources.answers.find((a) => a.question_id === '5')!;
      expect(q5).toMatchObject({
        origin: 'prefilled_confirmed',
        value: ['people'],
        quotes: [{ option: 'people', quote: 'client names' }],
        quote_in_final_description: true,
        read: 0,
      });
      expect(sources.answers.find((a) => a.question_id === '11')).toMatchObject({ origin: 'prefilled_confirmed', value: ['UK'] });
      // a model-filled answer is never written as typed
      expect(sources.answers.filter((a) => a.origin === 'typed').map((a) => a.question_id)).not.toContain('5');
    },
    SLOW_FLOW_MS,
  );

  it(
    'a quote the person edited out of the description is recorded as gone, the other as still there',
    async () => {
      installModel({ kind: 'honours-format', reply: FILLED });
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await describeToReadForm(user, DESC);
      await answerFormExceptFiveAndEleven(user, 'Edited description tool');
      await tickAll(user);
      const edited = 'It reads account details. Our UK team will use it every morning.';
      await editFormDescription(user, edited);
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
      await screen.findByText(/here.s what we understood/i);
      await confirmAndReachVerdict(user);
      const trail = await trailOf(edited);
      const sources = sourcesOf(ofType(trail, 'graph_confirmed')[0]!)!;
      expect(sources.answers.find((a) => a.question_id === '5')!.quote_in_final_description).toBe(false);
      expect(sources.answers.find((a) => a.question_id === '11')!.quote_in_final_description).toBe(true);
      // the creation record holds the final text, and one only
      expect(ofType(trail, 'use_case_created')).toHaveLength(1);
    },
    SLOW_FLOW_MS,
  );

  it(
    'a changed answer is written as prefilled_changed with what it was changed from',
    async () => {
      installModel({ kind: 'honours-format', reply: FILLED });
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await describeToReadForm(user, DESC);
      await answerFormExceptFiveAndEleven(user, 'Changed answer tool');
      await user.click(screen.getByRole('checkbox', { name: /united states/i })); // adds one to the filled list: now changed
      await tickAll(user);
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
      await screen.findByText(/here.s what we understood/i);
      await confirmAndReachVerdict(user);
      const row = sourcesOf(ofType(await trailOf(DESC), 'graph_confirmed')[0]!)!.answers.find((a) => a.question_id === '11')! as unknown as {
        origin: string; value: string[]; changed_from: { option: string; quote: string }[]; quotes: unknown;
      };
      expect(row.origin).toBe('prefilled_changed');
      expect(row.value).toEqual(['UK', 'US']);
      expect(row.changed_from).toEqual([{ option: 'UK', quote: 'Our UK team' }]);
    },
    SLOW_FLOW_MS,
  );
});
