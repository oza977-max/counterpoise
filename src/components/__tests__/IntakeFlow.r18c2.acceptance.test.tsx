import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { createFakeModel } from '../../llm/test-utils';
import { updateModelSetting } from '../../llm/model-setting';
import { fillText, DUP_CHECK_WAIT, SLOW_FLOW_MS, pressNext } from './fillText';

// R18-C2 acceptance test (outside-in, written first, committed alone while Red).
// TDD-1 of build/prompts/R18-C2.md: a person types a description that mentions client
// names and the UK, presses Next then Continue, sees the reading step, lands on the form
// with Question 5 and Question 11 pre-filled and their quotes visible, finds Continue
// shut, ticks both answers (one tick each, no accept-all), goes through the confirmation
// line "2 of M answers were filled in by a model and confirmed by you" and reaches a
// verdict. A fake model fetch stands in for the server; a valid this-computer setting is
// in storage.

const DESCRIPTION = 'It reads client names and account details. Our UK team will use it every morning.';
const REPLY = JSON.stringify({
  answers: [
    { question: '5', values: [{ option: 'people', quote: 'client names' }] },
    { question: '11', values: [{ option: 'UK', quote: 'Our UK team' }] },
  ],
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

/** Everything of example 1 except Question 5 and Question 11 (the two the model fills in). */
async function answerTheRest(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
  await user.click(screen.getByRole('radio', { name: /gives a score, ranking, flag, category or forecast/i }));
  await user.click(await screen.findByRole('radio', { name: /fixed, written-down rules/i }));
  await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
  await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
  await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
  await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
  await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
  await user.click(screen.getByRole('radio', { name: /^no$/i }));
}

describe('R18-C2 acceptance: describe, read, pre-fill, confirm, verdict', () => {
  it(
    'TC-R18-GI-3-01: acceptance - a model-read description fills two answers, each needs its own tick, and the result is reached',
    async () => {
      const fake = createFakeModel({ kind: 'slow', ms: 300, then: { kind: 'honours-format', reply: REPLY } });
      vi.stubGlobal('fetch', fake.fetch);
      const saved = updateModelSetting({ place: 'this-computer', url: 'http://localhost:11434', model: 'alpha:7b' });
      expect(saved.ok).toBe(true);

      const user = userEvent.setup({ delay: null });
      render(<App />);

      // 1-2. Describe, Next (through the nudge), then Continue on the similar-cases screen.
      await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), DESCRIPTION);
      await pressNext(user);
      await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));

      // 3. The reading step, with its Skip control.
      await screen.findByText(/reading your description/i);
      expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();

      // 4. The form, with Question 5 and Question 11 pre-filled and their quotes visible.
      await screen.findByText(/new pre-check — tell us about the ai you want to use/i, undefined, { timeout: 5000 });
      const marks = await screen.findAllByText(/from your description/i);
      expect(marks).toHaveLength(2);
      expect(marks.map((m) => m.textContent).join(' ')).toMatch(/client names/);
      expect(marks.map((m) => m.textContent).join(' ')).toMatch(/our uk team/i);
      expect(screen.getByRole('checkbox', { name: /information about people/i })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: /united kingdom/i })).toBeChecked();
      expect(fake.requests).toHaveLength(1);

      // 5. Everything else is answered by hand; Continue is still shut, because two answers are unconfirmed.
      await user.type(screen.getByLabelText(/what do you want to call it/i), 'Ticket volumes dashboard');
      await answerTheRest(user);
      const continueButton = screen.getByRole('button', { name: /^continue$/i });
      expect(continueButton).toBeDisabled();

      // 6. One tick each - there is no accept-all - and then Continue opens.
      const ticks = screen.getAllByRole('checkbox', { name: /^yes, this is right/i });
      expect(ticks).toHaveLength(2);
      await user.click(ticks[0]!);
      expect(continueButton).toBeDisabled();
      await user.click(ticks[1]!);
      expect(continueButton).toBeEnabled();
      await user.click(continueButton);

      // 7. The confirmation says how many answers a model filled in and the person confirmed.
      await screen.findByText(/here.s what we understood/i);
      expect(screen.getByText(/^2 of \d+ answers were filled in by a model and confirmed by you$/)).toBeInTheDocument();
      await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));

      // 8. A result.
      await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
      expect(within(document.querySelector('.verdict__cards')!).getByText(/tier/i)).toBeInTheDocument();
      expect(fake.requests).toHaveLength(1);
    },
    SLOW_FLOW_MS,
  );
});
