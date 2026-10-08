import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { fillText, DUP_CHECK_WAIT, SLOW_FLOW_MS } from './fillText';

// R18-A acceptance test (outside-in, written first). TC-R18-PS-1-01: a
// first-time visitor with empty storage and NO model configured goes from the
// first screen to a result: description with a live "mentioned / not
// mentioned" checklist, the one-press nudge (second Next proceeds), the
// similar-checks screen, the guided form (example 1's answers), Continue,
// Confirm, verdict. No fetch, no mocks: nothing here touches a model.

const DESCRIPTION =
  'A dashboard that summarises last month’s internal ticket volumes for the operations team.';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

async function answerExampleOne(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
  await user.click(screen.getByRole('radio', { name: /gives a score, ranking, flag, category or forecast/i }));
  await user.click(await screen.findByRole('radio', { name: /fixed, written-down rules/i }));
  await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
  await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
  await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
  await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
  await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
  await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
  await user.click(screen.getByRole('checkbox', { name: /united kingdom/i }));
  await user.click(screen.getByRole('radio', { name: /^no$/i }));
}

describe('R18-A acceptance: the no-model pre-check', () => {
  it(
    'TC-R18-PS-1-01: describe -> live checklist -> nudge (second Next proceeds) -> similar checks -> form -> verdict, with no model',
    async () => {
      const user = userEvent.setup({ delay: null });
      render(<App />);

      // The description box is the first thing; typing makes the live
      // checklist appear as a status region that spells out each state.
      await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), DESCRIPTION);
      const checklist = screen
        .getAllByRole('status')
        .find((el) => /not mentioned/i.test(el.textContent ?? ''));
      expect(checklist, 'a role=status checklist that says "not mentioned"').toBeDefined();
      expect(within(checklist!).getAllByText(/^(not )?mentioned$/i).length).toBeGreaterThanOrEqual(13);
      expect(within(checklist!).getAllByText(/^mentioned$/i).length).toBeGreaterThanOrEqual(1);

      // First Next with unmentioned items: the note, not the next step.
      await user.click(screen.getByRole('button', { name: /^next/i }));
      expect(screen.getByText(/your description doesn.t mention:/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /continue →/i })).not.toBeInTheDocument();

      // Second Next (nothing changed) proceeds to the similar-checks screen.
      await user.click(screen.getByRole('button', { name: /^next/i }));
      await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));

      // The guided form (no model: nothing pre-filled), answered by example 1.
      await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
      await user.type(screen.getByLabelText(/what do you want to call it/i), 'Ticket volumes dashboard');
      await answerExampleOne(user);
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
      await screen.findByText(/here.s what we understood/i);
      await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));

      await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
      const cards = document.querySelector('.verdict__cards')!;
      expect(cards.textContent).toMatch(/Tier\s*Low/);
      expect(cards.textContent).toMatch(/Track\s*I(?!I)/);
      expect(document.querySelector('.verdict__first-screen')!.textContent).toMatch(/you can start/i);
    },
    SLOW_FLOW_MS,
  );
});
