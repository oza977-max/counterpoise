import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { __resetDbsForTests } from '../../store/db';
import { addNode, confirmationPrecondition, updateUseCaseVerdictSummary } from '../../store/register';
import { SLOW_FLOW_MS } from './fillText';
import { describeToReadForm, installModel, reply } from './r18c2Flow';
import { DESC, answerFormExceptFiveAndEleven, confirmAndReachVerdict, ofType, tickAll, trailOf } from './r18d2Flow';

// R18-D2 review pass 1 (Minors 2 and 3): the audit trail is append-only, so a retry after a failure that happens
// AFTER an event is written must never write that event again; and a double press must reach the lock and the
// record check exactly once.

vi.mock('../../store/register', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/register')>();
  return {
    ...actual,
    confirmationPrecondition: vi.fn(actual.confirmationPrecondition),
    updateUseCaseVerdictSummary: vi.fn(actual.updateUseCaseVerdictSummary),
    addNode: vi.fn(actual.addNode),
  };
});

const FILLED = reply([
  { question: '5', values: [{ option: 'people', quote: 'client names' }] },
  { question: '11', values: [{ option: 'UK', quote: 'Our UK team' }] },
]);

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await __resetDbsForTests();
  vi.mocked(confirmationPrecondition).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

type User = ReturnType<typeof userEvent.setup>;

async function toConfirmation(user: User, name: string) {
  installModel({ kind: 'honours-format', reply: FILLED });
  render(<App />);
  await describeToReadForm(user, DESC);
  await answerFormExceptFiveAndEleven(user, name);
  await tickAll(user);
  await user.click(screen.getByRole('button', { name: /^continue$/i }));
  await screen.findByText(/here.s what we understood/i);
}

describe('a failure after the event is written never lets a retry write it again', () => {
  it(
    'a correction: the register update throws after verdict_corrected is appended; the retry is refused and verdict_corrected stays at 1',
    async () => {
      const user = userEvent.setup({ delay: null });
      await toConfirmation(user, 'Retry correction tool');
      await confirmAndReachVerdict(user);

      const real = (await vi.importActual<typeof import('../../store/register')>('../../store/register')).updateUseCaseVerdictSummary;
      let armed = true;
      vi.mocked(updateUseCaseVerdictSummary).mockImplementation(async (...args) => {
        if (armed) {
          armed = false;
          throw new Error('injected: the register could not be updated');
        }
        return real(...args);
      });

      await user.click(await screen.findByRole('button', { name: /correct your answers/i }));
      await screen.findByLabelText(/what do you want to call it/i);
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
      await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/evaluation could not complete/i);
      let trail = await trailOf(DESC);
      expect(ofType(trail, 'verdict_corrected')).toHaveLength(1); // written before the register update failed

      // Retry: back through the form, Continue, Confirm.
      await screen.findByLabelText(/what do you want to call it/i);
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
      await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
      await screen.findByText(/this result was corrected in another tab or window/i);

      trail = await trailOf(DESC);
      expect(ofType(trail, 'verdict_corrected')).toHaveLength(1); // not two
      expect(ofType(trail, 'graph_confirmed')).toHaveLength(1);
      expect(ofType(trail, 'verdict_produced')).toHaveLength(1);
    },
    SLOW_FLOW_MS * 2,
  );

  it(
    'a fresh case: the register write throws after graph_confirmed and verdict_produced; the retry is refused and neither is written twice',
    async () => {
      const user = userEvent.setup({ delay: null });
      await toConfirmation(user, 'Retry fresh tool');
      const real = (await vi.importActual<typeof import('../../store/register')>('../../store/register')).addNode;
      let armed = true;
      vi.mocked(addNode).mockImplementation(async (node) => {
        if (armed && node.metadata.node_type === 'use_case' && node.metadata.description === DESC) {
          armed = false;
          throw new Error('injected: the register could not be written');
        }
        return real(node);
      });
      await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/evaluation could not complete/i);
      let trail = await trailOf(DESC);
      expect(ofType(trail, 'graph_confirmed')).toHaveLength(1);
      expect(ofType(trail, 'verdict_produced')).toHaveLength(1);

      await screen.findByLabelText(/what do you want to call it/i);
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
      await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
      await screen.findByText(/this case already has a result/i);

      trail = await trailOf(DESC);
      expect(ofType(trail, 'graph_confirmed')).toHaveLength(1);
      expect(ofType(trail, 'verdict_produced')).toHaveLength(1);
      expect(ofType(trail, 'use_case_created')).toHaveLength(1);
    },
    SLOW_FLOW_MS * 2,
  );
});

describe('the confirm lock', () => {
  it(
    'a double press reaches the record check once: both clicks land before any re-render, so only the in-flight ref can stop the second',
    async () => {
      const user = userEvent.setup({ delay: null });
      await toConfirmation(user, 'Double press tool');
      const button = await screen.findByRole('button', { name: /confirm and evaluate/i });
      vi.mocked(confirmationPrecondition).mockClear();
      await act(async () => {
        button.click();
        button.click(); // same batch: the disabled state has not rendered yet
      });
      await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
      expect(confirmationPrecondition).toHaveBeenCalledTimes(1);
      const trail = await trailOf(DESC);
      expect(ofType(trail, 'graph_confirmed')).toHaveLength(1);
      expect(ofType(trail, 'verdict_produced')).toHaveLength(1);
    },
    SLOW_FLOW_MS,
  );
});
