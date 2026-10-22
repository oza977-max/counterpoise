import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { evaluate } from '../../engine/evaluate';
import { __resetDbsForTests } from '../../store/db';
import { SLOW_FLOW_MS } from './fillText';
import { describeToReadForm, installModel, reply } from './r18c2Flow';
import { DESC, answerFormExceptFiveAndEleven, confirmAndReachVerdict, ofType, sourcesOf, tickAll, trailOf } from './r18d2Flow';

// R18-D2, TC-R18-GI-5-10: a failed evaluation, then Retry. Each confirm attempt writes its OWN graph_confirmed
// (existing behaviour, stated in §27.13), and each carries the same sources: the model-filled answer is a
// prefilled_confirmed row both times, never a typed one.

vi.mock('../../engine/evaluate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine/evaluate')>();
  return { ...actual, evaluate: vi.fn(actual.evaluate) };
});

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await __resetDbsForTests();
});
afterEach(() => vi.unstubAllGlobals());

describe('a failed evaluation and its retry', () => {
  it(
    'TC-R18-GI-5-10: each attempt writes one graph_confirmed, and each carries the pre-filled row with its quotes',
    async () => {
      installModel({
        kind: 'honours-format',
        reply: reply([
          { question: '5', values: [{ option: 'people', quote: 'client names' }] },
          { question: '11', values: [{ option: 'UK', quote: 'Our UK team' }] },
        ]),
      });
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await describeToReadForm(user, DESC);
      await answerFormExceptFiveAndEleven(user, 'Retry tool');
      await tickAll(user);
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
      await screen.findByText(/here.s what we understood/i);

      // the first evaluation of THIS case fails (injected); anything else (the register's own seeding) is untouched
      const real = (await vi.importActual<typeof import('../../engine/evaluate')>('../../engine/evaluate')).evaluate;
      let armed = true;
      vi.mocked(evaluate).mockImplementation(((graph, ...rest) => {
        if (armed && graph.processing_nodes[0]?.label === 'Retry tool') {
          armed = false;
          return { ok: false, error: { kind: 'no-track-match' } };
        }
        return real(graph, ...rest);
      }) as typeof evaluate);
      await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/evaluation could not complete/i);
      let trail = await trailOf(DESC);
      expect(ofType(trail, 'graph_confirmed')).toHaveLength(1);
      expect(ofType(trail, 'verdict_produced')).toHaveLength(0);

      // Retry: back through the form (the answers, with their sources, are still there), Continue, Confirm
      await screen.findByLabelText(/what do you want to call it/i);
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
      await screen.findByText(/here.s what we understood/i);
      await confirmAndReachVerdict(user);

      trail = await trailOf(DESC);
      const confirmed = ofType(trail, 'graph_confirmed');
      expect(confirmed).toHaveLength(2); // one per attempt, and no more
      expect(ofType(trail, 'use_case_created')).toHaveLength(1);
      expect(ofType(trail, 'verdict_produced')).toHaveLength(1);
      const [first, second] = confirmed.map((e) => sourcesOf(e)!);
      expect(second).toEqual(first); // the same sources, byte for byte
      for (const s of [first!, second!]) {
        const q5 = s.answers.find((a) => a.question_id === '5')!;
        expect(q5.origin).toBe('prefilled_confirmed');
        expect(q5).toMatchObject({ quotes: [{ option: 'people', quote: 'client names' }], quote_in_final_description: true });
        expect(s.answers.filter((a) => a.origin === 'typed').map((a) => a.question_id)).not.toContain('5');
        expect(s.reads).toHaveLength(1);
      }
    },
    SLOW_FLOW_MS,
  );
});
