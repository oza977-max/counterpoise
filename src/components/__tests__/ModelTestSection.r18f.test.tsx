import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModelSettingSection from '../ModelSettingSection';
import ModelStatus from '../ModelStatus';
import { createFakeModel } from '../../llm/test-utils';
import type { FakeBehaviour, RecordedRequest } from '../../llm/test-utils';
import { updateModelSetting, appendTestResult } from '../../llm/model-setting';
import { loadCorpus } from '../../llm/model-test';

// R18-F: the Settings "Test it" control as a person sees it (TC-R18-MS-4-02, -04, -05, -07, -08, -09,
// GI-12-03, NF-1-04/-05, and the false state of every new sentence, TC-R18-GI-13-01 rows for F).

const corpus = loadCorpus()!;
const LOCAL = 'http://localhost:11434';

function userContent(request: RecordedRequest): string {
  const messages = (request.json?.messages ?? []) as { role: string; content: string }[];
  return messages.find((m) => m.role === 'user')?.content ?? '';
}

/** Answers each corpus case's replaces-something question with that case's own known answer. */
function knows(request: RecordedRequest, extra?: { question: string; values: unknown[] }): FakeBehaviour {
  const content = userContent(request);
  const c = corpus.cases.find((x) => content.includes(x.prose))!;
  const gold = (c.graph.processing as { replaces_prior_model: boolean }).replaces_prior_model;
  const quote = c.prose.split(' ').slice(0, 3).join(' ');
  const answers: unknown[] = [{ question: '12', values: [{ option: gold ? 'yes' : 'no', quote }] }];
  if (extra) answers.push(extra);
  return { kind: 'honours-format', reply: JSON.stringify({ answers }) };
}

function save(model = 'alpha:7b') {
  expect(updateModelSetting({ place: 'this-computer', url: LOCAL, model }).ok).toBe(true);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

async function open(user: ReturnType<typeof userEvent.setup>) {
  render(
    <>
      <ModelSettingSection />
      <ModelStatus />
    </>,
  );
  await user.click(screen.getByText(/the model that reads your description/i));
}

const section = () => screen.getByRole('region', { name: 'Test it' });
const statusLine = () => document.querySelector('.model-status__line')!.textContent ?? '';

describe('Test it with no saved model setting (false state of the control)', () => {
  it('says to save a setting first, offers no button, and does not state the 60-second limit', async () => {
    const user = userEvent.setup({ delay: null });
    await open(user);
    expect(within(section()).getByText('Save a model setting first. The test runs on the saved setting.')).toBeInTheDocument();
    expect(within(section()).queryByRole('button', { name: 'Test it' })).not.toBeInTheDocument();
    expect(section().textContent).not.toContain('Each case gets 60 seconds.');
    expect(section().textContent).not.toMatch(/Reached the right verdict|public examples|Case \d+ of 31/);
  });

  it('TC-R18-MS-4-05: a model saved without a test is labelled untested, with no count and no date, and shows no result', async () => {
    save('delta:2b');
    const user = userEvent.setup({ delay: null });
    await open(user);
    expect(statusLine()).toContain('delta:2b: untested');
    expect(statusLine()).not.toMatch(/\d+\/31|\d{4}-\d{2}-\d{2}/);
    expect(section().textContent).not.toContain('Reached the right verdict');
    expect(section().textContent).not.toContain('public examples');
    // the control and its limit are there
    expect(within(section()).getByRole('button', { name: 'Test it' })).toBeEnabled();
    expect(within(section()).getByText('Each case gets 60 seconds.')).toBeInTheDocument();
  });
});

describe('progress, Stop and one run at a time (TC-R18-MS-4-02, -08, NF-1-05)', () => {
  it('TC-R18-MS-4-08 / TC-R18-MS-4-02 / TC-R18-NF-1-05: shows "Case 12 of 31" while case 12 is read; Stop ends the run and says "Stopped after 11 of 31 cases."; a second press while running starts nothing', async () => {
    save();
    const fake = createFakeModel({ kind: 'custom', handle: (r, i) => (i >= 11 ? { kind: 'never' } : knows(r)) });
    vi.stubGlobal('fetch', fake.fetch);
    const user = userEvent.setup({ delay: null });
    await open(user);

    const press = within(section()).getByRole('button', { name: 'Test it' });
    await user.dblClick(press); // two presses in a row
    expect(await within(section()).findByText('Case 12 of 31')).toBeInTheDocument();
    expect(within(section()).getByText('Each case gets 60 seconds.')).toBeInTheDocument();
    expect(fake.requests).toHaveLength(12); // one run, not two
    expect(within(section()).getByRole('button', { name: 'Test it' })).toBeDisabled();

    await user.click(within(section()).getByRole('button', { name: 'Stop' }));
    expect(await within(section()).findByText('Stopped after 11 of 31 cases.')).toBeInTheDocument();
    expect(fake.requests).toHaveLength(12); // nothing sent after Stop
    expect(section().textContent).toContain('Reached the right verdict in 11 of the 11 cases that ran');
    expect(section().textContent).not.toMatch(/of 31 cases \(measured/); // a stopped run never reads as a finished count
    expect(within(section()).queryByText(/Case \d+ of 31/)).not.toBeInTheDocument(); // progress is gone
    expect(within(section()).queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  it('TC-R18-MS-4-09: a stopped run leaves the model untested ("partial"), never "tested 11/31"', async () => {
    save();
    vi.stubGlobal('fetch', createFakeModel({ kind: 'custom', handle: (r, i) => (i >= 11 ? { kind: 'never' } : knows(r)) }).fetch);
    const user = userEvent.setup({ delay: null });
    await open(user);
    await user.click(within(section()).getByRole('button', { name: 'Test it' }));
    await within(section()).findByText('Case 12 of 31');
    await user.click(within(section()).getByRole('button', { name: 'Stop' }));
    await within(section()).findByText('Stopped after 11 of 31 cases.');
    expect(statusLine()).toContain('untested (a partial test stopped after 11 of 31 cases)');
    expect(statusLine()).not.toContain('tested 11/31');
    expect(document.body.textContent).not.toMatch(/(^|[^n])tested \d+\/31/);
  });

  it('leaving Settings mid-run abandons the run and saves nothing', async () => {
    save();
    const fake = createFakeModel({ kind: 'custom', handle: (r, i) => (i >= 3 ? { kind: 'never' } : knows(r)) });
    vi.stubGlobal('fetch', fake.fetch);
    const user = userEvent.setup({ delay: null });
    const { unmount } = render(<ModelSettingSection />);
    await user.click(screen.getByText(/the model that reads your description/i));
    await user.click(within(section()).getByRole('button', { name: 'Test it' }));
    await within(section()).findByText('Case 4 of 31');
    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(localStorage.getItem('aigate:model-test-results')).toBeNull();
    expect(fake.requests).toHaveLength(4);
  });

  it('changing the model setting during a run stops it; the partial result belongs to the model that was tested (TC-R18-GI-12-03)', async () => {
    save('alpha:7b');
    vi.stubGlobal('fetch', createFakeModel({ kind: 'custom', handle: (r, i) => (i >= 2 ? { kind: 'never' } : knows(r)) }).fetch);
    const user = userEvent.setup({ delay: null });
    await open(user);
    await user.click(within(section()).getByRole('button', { name: 'Test it' }));
    await within(section()).findByText('Case 3 of 31');
    act(() => {
      updateModelSetting({ model: 'beta:3b' });
    });
    await vi.waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('aigate:model-test-results') ?? 'null');
      expect(saved.results[0]).toMatchObject({ model: 'alpha:7b', stopped: true, casesRun: 2 });
    });
    // the new model is untested: the result is not carried across (TC-R18-GI-12-03)
    expect(statusLine()).toContain('beta:3b: untested');
    expect(section().textContent).not.toContain('Reached the right verdict');
  });
});

describe('a finished run (TC-R18-MS-4-01, -04, -07, -09, GI-12-02, -03)', () => {
  async function finish(user: ReturnType<typeof userEvent.setup>, handle: (r: RecordedRequest, i: number) => FakeBehaviour) {
    vi.stubGlobal('fetch', createFakeModel({ kind: 'custom', handle }).fetch);
    await user.click(within(section()).getByRole('button', { name: 'Test it' }));
    await within(section()).findByText(/Reached the right verdict in \d+ of 31 cases/, {}, { timeout: 20000 });
  }

  it(
    'TC-R18-MS-4-09 / TC-R18-MS-4-07 / TC-R18-MS-4-01: the result says what was dropped, each question\'s counts, and what it does not prove; the label reads tested with its count, date and caveat',
    async () => {
      save();
      const user = userEvent.setup({ delay: null });
      await open(user);
      // 7 fills fail the checks across the run (an option the question does not have)
      await finish(user, (r, i) => knows(r, i < 7 ? { question: '9', values: [{ option: 'not-an-option', quote: 'x y' }] } : undefined));
      const s = section().textContent!;
      expect(s).toContain('7 filled-in answers were dropped because they failed the checks.');
      expect(s).toContain('Reached the right verdict in 31 of 31 cases (measured as if you check every filled answer).');
      expect(s).toMatch(/Does it replace something that already exists\?|replace/i);
      expect(s).toContain('right,');
      expect(s).toContain('These 31 cases are public examples; they are not a guarantee about your own descriptions.');
      expect(s).toContain('cannot be compared with the 2026-10-04 comparison');
      expect(s).not.toMatch(/\b(safe|reliable|recommended)\b/i);
      expect(statusLine()).toMatch(/alpha:7b: tested 31\/31 on \d{4}-\d{2}-\d{2} \(measured as if you check every filled answer\)/);
      expect(statusLine()).not.toContain('untested');
    },
    40000,
  );

  it('no dropped answer, no "dropped" sentence; every case answered, no "no usable answer" sentence; not stopped, no "Stopped after"', async () => {
    save();
    const user = userEvent.setup({ delay: null });
    await open(user);
    await finish(user, (r) => knows(r));
    expect(section().textContent).not.toMatch(/dropped because/);
    expect(section().textContent).not.toMatch(/no usable answer/i);
    expect(section().textContent).not.toMatch(/Stopped after/);
  }, 40000);

  it('a model that gives no usable answers reads as 0 of 31 with the no-answer count, not as a tested success', async () => {
    save();
    const user = userEvent.setup({ delay: null });
    await open(user);
    await finish(user, () => ({ kind: 'content', content: 'not json at all' }));
    expect(section().textContent).toContain('Cases with no usable answer from the model: 31.');
    expect(section().textContent).toContain('Reached the right verdict in 0 of 31 cases');
    expect(statusLine()).toMatch(/alpha:7b: tested 0\/31 on/);
  }, 40000);

  it('TC-R18-MS-4-04 / TC-R18-GI-12-03: the result is still there after the page is rebuilt, and belongs to its own model only', async () => {
    save();
    const user = userEvent.setup({ delay: null });
    await open(user);
    await finish(user, (r) => knows(r));
    // rebuild the screen from storage alone
    document.body.innerHTML = '';
    const again = userEvent.setup({ delay: null });
    await open(again);
    expect(statusLine()).toMatch(/alpha:7b: tested 31\/31 on \d{4}-\d{2}-\d{2}/);
    expect(section().textContent).toContain('Reached the right verdict in 31 of 31 cases');
    // another model on the same place: untested, no result block
    act(() => {
      updateModelSetting({ model: 'delta:2b' });
    });
    await vi.waitFor(() => expect(statusLine()).toContain('delta:2b: untested'));
    expect(statusLine()).not.toContain('tested 31/31');
    expect(section().textContent).not.toContain('Reached the right verdict');
    expect(section().textContent).not.toContain('public examples');
  }, 60000);
});

describe('the saved results are bounded and newest first (R18-B note for F)', () => {
  it('appendTestResult keeps the latest 20, newest first, in { version: 1, results }', () => {
    const make = (n: number) => ({
      model: 'm:1', place: 'this-computer' as const, host: LOCAL, date: `2026-10-${String(n).padStart(2, '0')}`,
      casesRun: 31, stopped: false, verdictMatches: n, discarded: {}, perQuestion: {},
    });
    for (let n = 1; n <= 23; n++) expect(appendTestResult(make(n))).toBe(true);
    const stored = JSON.parse(localStorage.getItem('aigate:model-test-results')!);
    expect(stored.version).toBe(1);
    expect(stored.results).toHaveLength(20);
    expect(stored.results[0].verdictMatches).toBe(23);
    expect(stored.results[19].verdictMatches).toBe(4);
  });
});
