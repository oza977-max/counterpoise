import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { createFakeModel } from '../../llm/test-utils';
import type { FakeBehaviour, RecordedRequest } from '../../llm/test-utils';
import { updateModelSetting } from '../../llm/model-setting';
import casesRaw from '../../../backtest/cases.json?raw';

// R18-F acceptance test (outside-in, written first, committed alone while Red).
// A person opens Settings, presses "Test it" and watches the model read the 31 public worked
// cases ("Case n of 31"). A fake model answers each case's replaces-something question with
// that case's own known correct answer, quoting the first words of the case (so the test never
// invents corpus data: the answers come from backtest/cases.json itself). When the run ends the
// screen says how often the fills reached the right verdict; the result is saved; and the
// description screen's model label reads "tested" with the same count and the assumption suffix.

interface Case {
  id: string;
  prose: string;
  graph: { processing: { replaces_prior_model: boolean } };
}
const CASES: Case[] = JSON.parse(casesRaw).cases;

function replyFor(request: RecordedRequest): string {
  const messages = (request.json?.messages ?? []) as { role: string; content: string }[];
  const user = messages.find((m) => m.role === 'user')?.content ?? '';
  const found = CASES.find((c) => user.includes(c.prose));
  if (!found) throw new Error('a request that is not one of the 31 corpus cases');
  const quote = found.prose.split(' ').slice(0, 3).join(' ');
  return JSON.stringify({
    answers: [
      { question: '12', values: [{ option: found.graph.processing.replaces_prior_model ? 'yes' : 'no', quote }] },
    ],
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('R18-F acceptance: test the model before trusting it', () => {
  it(
    'TC-R18-MS-4-01: acceptance - Test it runs the 31 cases with progress, saves a result and the description screen reads tested',
    async () => {
      const behaviour: FakeBehaviour = {
        kind: 'custom',
        handle: (request, index) => {
          const answer: FakeBehaviour = { kind: 'honours-format', reply: replyFor(request) };
          return index === 0 ? { kind: 'slow', ms: 200, then: answer } : answer;
        },
      };
      const fake = createFakeModel(behaviour);
      vi.stubGlobal('fetch', fake.fetch);
      expect(updateModelSetting({ place: 'this-computer', url: 'http://localhost:11434', model: 'alpha:7b' }).ok).toBe(true);

      const user = userEvent.setup({ delay: null });
      render(<App />);

      // Before any test: untested, on the description screen.
      expect(document.body.textContent).toContain('alpha:7b: untested');

      await user.click(screen.getByText(/the model that reads your description/i));
      await user.click(screen.getByRole('button', { name: /^test it$/i }));

      // Progress while it runs, and the stated limit.
      expect(await screen.findByText('Case 1 of 31')).toBeInTheDocument();
      expect(screen.getByText('Each case gets 60 seconds.')).toBeInTheDocument();

      // The end: the result line, then the plain caveat.
      expect(await screen.findByText(/Right verdict in 31 of 31 cases/, {}, { timeout: 20000 })).toBeInTheDocument();
      expect(
        screen.getByText('These 31 cases are public examples; they are not a guarantee about your own descriptions.'),
      ).toBeInTheDocument();

      // Exactly the 31 cases were sent, one request each (the fake honours the strict format).
      expect(fake.requests).toHaveLength(31);

      // The result is saved for this model, newest first.
      const stored = JSON.parse(localStorage.getItem('aigate:model-test-results') ?? 'null');
      expect(stored.version).toBe(1);
      expect(stored.results).toHaveLength(1);
      expect(stored.results[0]).toMatchObject({
        model: 'alpha:7b',
        place: 'this-computer',
        host: 'http://localhost:11434',
        casesRun: 31,
        stopped: false,
        verdictMatches: 31,
      });

      // The description screen's model label now reads tested, with the date and the answer counts.
      const statuses = screen.getAllByRole('status').map((el) => el.textContent ?? '');
      expect(
        statuses.some((t) => /alpha:7b: tested on \d{4}-\d{2}-\d{2}: \d+ of \d+ answers filled in correctly, \d+ left blank, \d+ wrong/.test(t)),
        'a status line with the tested label',
      ).toBe(true);
      expect(within(document.body).queryByText('alpha:7b: untested')).not.toBeInTheDocument();
    },
    40000,
  );
});
