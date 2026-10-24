import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { R18_COPY } from '../plain-copy';
import { MODEL_TEST_RESULTS_KEY, updateModelSetting } from '../../llm/model-setting';

// R18-G, TC-R18-GI-12-06 - the model label reads the same, answers first, with no verdict figure, on Settings and
// on the description screen. (With a model set the panel gives way to the one-line status, so the status line is
// where the panel's place is: specs/intake-flow.md §27.12.)

const LOCAL = 'http://localhost:11434';
const LABEL = 'tested on 2026-10-07: 11 of 15 answers filled in correctly, 3 left blank, 1 wrong';
const VERDICT_LINE = 'Right verdict in 21 of 31 cases if you check every filled answer and answer the rest yourself.';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function saveResult() {
  updateModelSetting({ place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' });
  localStorage.setItem(
    MODEL_TEST_RESULTS_KEY,
    JSON.stringify({
      version: 1,
      results: [
        {
          model: 'gemma4:cloud', place: 'ollama-cloud', host: LOCAL, date: '2026-10-07', casesRun: 31, stopped: false,
          verdictMatches: 21, discarded: {},
          perQuestion: { '5': { right: 6, blank: 1, wrong: 1 }, '7': { right: 5, blank: 2, wrong: 0 } },
        },
      ],
    }),
  );
}

describe('TC-R18-GI-12-06: the label leads with the answers on every screen, with no verdict figure', () => {
  it('the description screen\'s status line and Settings both read the label, and neither label carries a verdict figure', async () => {
    saveResult();
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const status = document.querySelector('.model-status__line') as HTMLElement;
    expect(status.textContent).toContain(LABEL);
    expect(status.textContent).not.toMatch(/21\s*\/\s*31|of 31 cases|21 of 31/);

    await user.click(screen.getByText(R18_COPY.SETTINGS.SUMMARY));
    const settings = screen.getByText(R18_COPY.SETTINGS.SUMMARY).closest('details') as HTMLElement;
    expect(settings.textContent).toContain(LABEL);
    // Where Settings shows the verdict figure, it is its own sentence and comes after the answers line.
    expect(settings.textContent).toContain(VERDICT_LINE);
    expect(settings.textContent!.indexOf(LABEL)).toBeLessThan(settings.textContent!.indexOf(VERDICT_LINE));
    // The label itself (the part before the verdict sentence) holds no verdict figure.
    const labelOnly = settings.textContent!.replace(VERDICT_LINE, '');
    expect(labelOnly).not.toMatch(/21\s*\/\s*31|of 31 cases/);
    expect(R18_COPY.TEST_RESULT_DONE.replace('{matches}', '21')).toBe(VERDICT_LINE);
  });

  it('an untested model\'s label does not say answers were filled in correctly (false state)', () => {
    updateModelSetting({ place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' });
    render(<App />);
    expect(document.querySelector('.model-status__line')!.textContent).not.toContain('answers filled in correctly');
    expect(document.querySelector('.model-status__line')!.textContent).toMatch(/untested/);
  });
});
