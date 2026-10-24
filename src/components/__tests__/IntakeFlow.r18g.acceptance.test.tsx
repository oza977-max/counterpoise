import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { DUP_CHECK_WAIT, SLOW_FLOW_MS, pressNext } from './fillText';
import { answerExampleOne } from './r18aFlow';

// R18-G acceptance test (outside-in, written first). A first-time visitor with
// empty storage sees the "Make it smarter" panel with exactly the two commands
// and the dated link (TC-R18-PS-2-01, -02), presses "Try an example" which fills
// the description and ticks the checklist (TC-R18-PS-3-01), continues with no
// model, reads the spec's no-model sentence (specs/intake-flow.md §27.5, which
// names the panel that now exists), and reaches a verdict (TC-R18-PS-1-01).

const EXAMPLE_ONE =
  "A dashboard that summarises last month's internal ticket volumes for the operations team. It reads from our own reporting database and produces a written summary. Nobody acts on it automatically.";

const NOT_CONFIGURED =
  'No model is connected, so nothing was filled in for you. Answer the questions below — or connect one under Make it smarter.';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('R18-G acceptance: the first visit on the public site', () => {
  it(
    'panel -> Try an example -> no model -> the spec sentence -> verdict',
    async () => {
      const user = userEvent.setup({ delay: null });
      render(<App />);

      // The panel: titled, exactly two commands in code style, a link to Ollama's own docs, a dated check.
      const panel = await screen.findByRole('region', { name: /make it smarter/i });
      const commands = Array.from(panel.querySelectorAll('code')).map((c) => c.textContent);
      expect(commands).toEqual(['ollama signin', `OLLAMA_ORIGINS=${window.location.origin}`]);
      const link = within(panel).getByRole('link', { name: /ollama/i });
      expect(link).toHaveAttribute('href', expect.stringMatching(/^https:\/\/[^/]*ollama\./));
      expect(panel.textContent).toMatch(/Link last checked \d{4}-\d{2}-\d{2}/);

      // Try an example: the box takes example 1's exact text and the checklist ticks.
      await user.click(screen.getByRole('button', { name: /^try an example/i }));
      await user.click(screen.getByRole('button', { name: /clean approval/i }));
      expect(screen.getByLabelText(/what ai tool do you want to use/i)).toHaveValue(EXAMPLE_ONE);
      const checklist = screen.getAllByRole('status').find((el) => /not mentioned/i.test(el.textContent ?? ''));
      expect(checklist).toBeDefined();
      expect(within(checklist!).getAllByText(/^mentioned$/i).length).toBeGreaterThanOrEqual(1);

      // Carry on with no model: similar checks, then the form with the spec's sentence.
      await pressNext(user);
      await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
      await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
      expect(screen.getByText(NOT_CONFIGURED)).toBeInTheDocument();

      await user.type(screen.getByLabelText(/what do you want to call it/i), 'Ticket volumes dashboard');
      await answerExampleOne(user);
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
      await screen.findByText(/here.s what we understood/i);
      await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));

      await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
      const cards = document.querySelector('.verdict__cards')!;
      expect(cards.textContent).toMatch(/Tier\s*Low/);
      expect(cards.textContent).toMatch(/Track\s*I(?!I)/);
    },
    SLOW_FLOW_MS,
  );
});
