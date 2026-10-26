import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModelSettingSection from '../ModelSettingSection';
import ModelStatus from '../ModelStatus';
import { createFakeModel } from '../../llm/test-utils';
import type { FakeBehaviour, RecordedRequest } from '../../llm/test-utils';
import { updateModelSetting, appendTestResult } from '../../llm/model-setting';
import { loadCorpus, runModelTest } from '../../llm/model-test';
import { setCurrentPolicyYaml } from '../../store/policy-source';
import appetiteYaml from '../../../policy/appetite.yaml?raw';

vi.mock('../../llm/model-test', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../llm/model-test')>();
  return { ...actual, runModelTest: vi.fn(actual.runModelTest) };
});

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
// The status region mounts empty and fills after the first read of storage (StatusAfterMount-style): every read of
// its label waits for the text, and a negative check on it comes only after a wait for the real label.
const statusHas = (text: string | RegExp) =>
  vi.waitFor(() => {
    if (typeof text === 'string') expect(statusLine()).toContain(text);
    else expect(statusLine()).toMatch(text);
  });

describe('Test it with no saved model setting (false state of the control)', () => {
  it('says to save a setting first, offers no button, and does not state the 60-second limit', async () => {
    const user = userEvent.setup({ delay: null });
    await open(user);
    expect(within(section()).getByText('Save a model setting first. The test runs on the saved setting.')).toBeInTheDocument();
    expect(within(section()).queryByRole('button', { name: 'Test it' })).not.toBeInTheDocument();
    expect(section().textContent).not.toContain('Each case gets 60 seconds.');
    expect(section().textContent).not.toMatch(/Right verdict in|answers filled in correctly|public examples|Case \d+ of 31/);
  });

  it('TC-R18-MS-4-05: a model saved without a test is labelled not yet tested, with no count and no date, and shows no result', async () => {
    save('delta:2b');
    const user = userEvent.setup({ delay: null });
    await open(user);
    await statusHas('AI helper delta:2b: not yet tested on the example cases');
    expect(statusLine()).not.toMatch(/\d+\/31|\d{4}-\d{2}-\d{2}/);
    expect(section().textContent).not.toContain('Right verdict in');
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
    expect(section().textContent).toContain('Right verdict in 11 of the 11 cases that ran');
    expect(section().textContent).not.toMatch(/of 31 cases if you check/); // a stopped run never reads as a finished count
    expect(within(section()).queryByText(/Case \d+ of 31/)).not.toBeInTheDocument(); // progress is gone
    expect(within(section()).queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  it('TC-R18-MS-4-09: a stopped run leaves the model untested ("partial"), never "tested"', async () => {
    save();
    vi.stubGlobal('fetch', createFakeModel({ kind: 'custom', handle: (r, i) => (i >= 11 ? { kind: 'never' } : knows(r)) }).fetch);
    const user = userEvent.setup({ delay: null });
    await open(user);
    await user.click(within(section()).getByRole('button', { name: 'Test it' }));
    await within(section()).findByText('Case 12 of 31');
    await user.click(within(section()).getByRole('button', { name: 'Stop' }));
    await within(section()).findByText('Stopped after 11 of 31 cases.');
    await statusHas('AI helper alpha:7b: untested (a partial test stopped after 11 of 31 cases)');
    expect(statusLine()).not.toContain('answers filled in correctly');
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
    // the new model is not yet tested: the result is not carried across (TC-R18-GI-12-03)
    await statusHas('AI helper beta:3b: not yet tested on the example cases');
    expect(section().textContent).not.toContain('Right verdict in');
  });
});

describe('a finished run (TC-R18-MS-4-01, -04, -07, -09, GI-12-02, -03)', () => {
  async function finish(user: ReturnType<typeof userEvent.setup>, handle: (r: RecordedRequest, i: number) => FakeBehaviour) {
    vi.stubGlobal('fetch', createFakeModel({ kind: 'custom', handle }).fetch);
    await user.click(within(section()).getByRole('button', { name: 'Test it' }));
    await within(section()).findByText(/Right verdict in \d+ of 31 cases/, {}, { timeout: 20000 });
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
      expect(s).toContain('Right verdict in 31 of 31 cases if you check every filled answer and answer the rest yourself.');
      expect(s).toMatch(/Does it replace something that already exists\?|replace/i);
      expect(s).toContain('right,');
      expect(s).toContain('These 31 cases are public examples; they are not a guarantee about your own descriptions.');
      expect(s).toContain('cannot be compared with the 2026-10-04 comparison');
      expect(s).not.toMatch(/\b(safe|reliable|recommended)\b/i);
      await statusHas(/AI helper alpha:7b: tested on \d{4}-\d{2}-\d{2}: \d+ of \d+ answers filled in correctly, \d+ left blank, \d+ wrong/);
      expect(statusLine()).not.toMatch(/untested|not yet tested/);
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
    expect(section().textContent).toContain('Right verdict in 0 of 31 cases');
    // review pass 1, fix 2: no usable answer in any case tested nothing, so the label must not say "tested"
    await statusHas('AI helper alpha:7b: untested (the model gave no usable answer in any case)');
    expect(statusLine()).not.toMatch(/tested on|(^|[^n])tested /);
  }, 40000);

  // Owner decision 2026-10-24. A model that fills nothing must not show a good headline. A fake model that
  // returns no answers runs over the real corpus; every scored answer is then blank.
  const noAnswers = (): FakeBehaviour => ({ kind: 'honours-format', reply: JSON.stringify({ answers: [] }) });
  const totalsOf = (r: { perQuestion: Record<string, { right: number; blank: number; wrong: number }> }) =>
    Object.values(r.perQuestion).reduce((a, q) => ({ r: a.r + q.right, b: a.b + q.blank, w: a.w + q.wrong }), { r: 0, b: 0, w: 0 });
  const unqualified = (text: string) =>
    text.replace(/Right verdict in \d+ of 31 cases if you check every filled answer and answer the rest yourself\./g, '');

  it('owner decision 2026-10-24 (false state): a model that returns no answers shows 0 filled in correctly and all scored left blank', async () => {
    save();
    const user = userEvent.setup({ delay: null });
    await open(user);
    await finish(user, noAnswers);
    const tot = totalsOf(JSON.parse(localStorage.getItem('aigate:model-test-results')!).results[0]);
    expect(tot.r).toBe(0);
    expect(tot.w).toBe(0);
    expect(tot.b).toBeGreaterThan(0);
    const label = `0 of ${tot.b} answers filled in correctly, ${tot.b} left blank, 0 wrong`;
    // review pass 1, fix 2: an empty reply is no usable answer in any case, so the label says untested
    // (the second owner-decision test below covers the tested label's figures)
    await statusHas('AI helper alpha:7b: untested (the model gave no usable answer in any case)');
    expect(section().textContent).toContain(label);
    expect(unqualified(section().textContent!)).not.toMatch(/\d+ of 31 cases/);
    expect(statusLine()).not.toMatch(/of 31|\/31/);
    const text = section().textContent!;
    expect(text.indexOf('answers filled in correctly')).toBeLessThan(text.indexOf('Right verdict in'));
  }, 40000);

  it('owner decision 2026-10-24 (false state): even when the verdict measure reads 31 of 31 for an all-blank run, that figure shows only inside the qualified sentence', async () => {
    save();
    const user = userEvent.setup({ delay: null });
    await open(user);
    await finish(user, noAnswers);
    // The verdict measure keeps the right answer for every blank, so a model that fills nothing it is scored on
    // can read 31 of 31 there (a model that fills only a question no case scores does). Saved as such:
    const stored = JSON.parse(localStorage.getItem('aigate:model-test-results')!);
    stored.results[0].verdictMatches = 31;
    stored.results[0].noAnswer = 0;
    localStorage.setItem('aigate:model-test-results', JSON.stringify(stored));
    document.body.innerHTML = '';
    await open(userEvent.setup({ delay: null }));
    const tot = totalsOf(stored.results[0]);
    const text = section().textContent!;
    expect(text.match(/31 of 31/g)).toHaveLength(1);
    expect(text).toContain('Right verdict in 31 of 31 cases if you check every filled answer and answer the rest yourself.');
    expect(text).toContain(`0 of ${tot.b} answers filled in correctly, ${tot.b} left blank, 0 wrong.`);
    expect(unqualified(text)).not.toMatch(/31 of 31/);
    await statusHas(`tested on`);
    await statusHas(`0 of ${tot.b} answers filled in correctly`);
    expect(statusLine()).not.toMatch(/31 of 31|31\/31/);
  }, 60000);

  it('TC-R18-MS-4-04 / TC-R18-GI-12-03: the result is still there after the page is rebuilt, and belongs to its own model only', async () => {
    save();
    const user = userEvent.setup({ delay: null });
    await open(user);
    await finish(user, (r) => knows(r));
    // rebuild the screen from storage alone
    document.body.innerHTML = '';
    const again = userEvent.setup({ delay: null });
    await open(again);
    await statusHas(/AI helper alpha:7b: tested on \d{4}-\d{2}-\d{2}: /);
    expect(section().textContent).toContain('Right verdict in 31 of 31 cases');
    // another model on the same place: not yet tested, no result block
    act(() => {
      updateModelSetting({ model: 'delta:2b' });
    });
    await vi.waitFor(() => expect(statusLine()).toContain('AI helper delta:2b: not yet tested on the example cases'));
    expect(statusLine()).not.toContain('answers filled in correctly');
    expect(section().textContent).not.toContain('Right verdict in');
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


// ---- review pass 1 ----

const stored = (over: Partial<ModelTestResultLike> = {}): ModelTestResultLike => ({
  model: 'alpha:7b', place: 'this-computer', host: LOCAL, date: '2026-10-20', casesRun: 31, stopped: false,
  verdictMatches: 31, noAnswer: 0, verdictCompared: 31, discarded: {},
  perQuestion: { '12': { right: 10, blank: 5, wrong: 1 } }, ...over,
});
type ModelTestResultLike = Parameters<typeof appendTestResult>[0];

describe('review pass 1, fix 1: a firm that edited its rules (the recorded verdicts no longer apply)', () => {
  async function runPerfect(user: ReturnType<typeof userEvent.setup>) {
    vi.stubGlobal('fetch', createFakeModel({ kind: 'custom', handle: (r) => knows(r) }).fetch);
    await user.click(within(section()).getByRole('button', { name: 'Test it' }));
    await within(section()).findByText(/Right verdict in \d+ of/, {}, { timeout: 20000 });
  }

  it('does not penalise a perfect fill: the verdict is reported against the cases compared and the skipped count is stated', async () => {
    save();
    setCurrentPolicyYaml(appetiteYaml.replace('value: { in: ["Client PII", "MNPI"] }', 'value: { in: ["MNPI"] }'));
    const user = userEvent.setup({ delay: null });
    await open(user);
    await runPerfect(user);
    const saved = JSON.parse(localStorage.getItem('aigate:model-test-results')!).results[0];
    expect(saved.verdictCompared).toBeLessThan(31);
    expect(saved.verdictCompared).toBeGreaterThan(0);
    expect(saved.verdictMatches).toBe(saved.verdictCompared); // every compared case is right
    const k = saved.verdictCompared;
    const text = section().textContent!;
    expect(text).toContain(`Right verdict in ${k} of the ${k} cases compared if you check every filled answer and answer the rest yourself.`);
    expect(text).toContain(
      `Your firm's rules differ from the ones these examples were recorded under, so the verdict is not compared for ${31 - k} of 31 cases.`,
    );
    expect(text).not.toMatch(/of 31 cases if you check/);
  }, 60000);

  it('false state: under the shipped rules nothing is skipped, the sentence is absent and the figure is out of 31', async () => {
    save();
    const user = userEvent.setup({ delay: null });
    await open(user);
    await runPerfect(user);
    expect(section().textContent).not.toContain('not compared');
    expect(section().textContent).not.toContain('cases compared');
    expect(section().textContent).toContain('Right verdict in 31 of 31 cases if you check');
  }, 60000);

  it('false state: a result saved before the count existed reads as all compared', async () => {
    save();
    const { verdictCompared: _omit, ...legacy } = stored({ verdictMatches: 20 });
    appendTestResult(legacy);
    const user = userEvent.setup({ delay: null });
    await open(user);
    expect(section().textContent).toContain('Right verdict in 20 of 31 cases if you check');
    expect(section().textContent).not.toContain('not compared');
  });

  it('a run where no verdict could be compared says so, with no count', async () => {
    save();
    appendTestResult(stored({ verdictCompared: 0, verdictMatches: 0 }));
    const user = userEvent.setup({ delay: null });
    await open(user);
    expect(section().textContent).toContain('No verdict could be compared in this run.');
    expect(section().textContent).toContain('not compared for 31 of 31 cases');
    expect(section().textContent).not.toMatch(/Right verdict in/);
  });
});

describe('review pass 1, fix 2: no usable answer', () => {
  it('in every case: the label says untested (no usable answer) and the Settings result says so too', async () => {
    save();
    appendTestResult(stored({ noAnswer: 31, verdictMatches: 0, perQuestion: {} }));
    const user = userEvent.setup({ delay: null });
    await open(user);
    await statusHas('AI helper alpha:7b: untested (the model gave no usable answer in any case)');
    expect(statusLine()).not.toMatch(/tested on/);
    expect(section().textContent).toContain('Cases with no usable answer from the model: 31.');
  });

  it('in some cases only: still tested, and Settings keeps the no-answer line', async () => {
    save();
    appendTestResult(stored({ noAnswer: 4 }));
    const user = userEvent.setup({ delay: null });
    await open(user);
    await statusHas('AI helper alpha:7b: tested on 2026-10-20');
    expect(section().textContent).toContain('Cases with no usable answer from the model: 4.');
  });

  it('in none: no no-answer line and no untested or not-yet-tested label', async () => {
    save();
    appendTestResult(stored({ noAnswer: 0 }));
    const user = userEvent.setup({ delay: null });
    await open(user);
    await statusHas('AI helper alpha:7b: tested on 2026-10-20');
    expect(statusLine()).not.toMatch(/untested|not yet tested/);
    expect(section().textContent).not.toContain('no usable answer');
  });
});

describe('review pass 1, fix 3: a stop before any case finishes, and an earlier complete run', () => {
  it('a stop before the first case finishes saves nothing and says so', async () => {
    save();
    vi.stubGlobal('fetch', createFakeModel({ kind: 'never' }).fetch);
    const user = userEvent.setup({ delay: null });
    await open(user);
    await user.click(within(section()).getByRole('button', { name: 'Test it' }));
    await within(section()).findByText('Case 1 of 31');
    await user.click(within(section()).getByRole('button', { name: 'Stop' }));
    expect(await within(section()).findByText('The test was stopped before any case finished, so nothing was saved.')).toBeInTheDocument();
    expect(localStorage.getItem('aigate:model-test-results')).toBeNull();
    await statusHas('AI helper alpha:7b: not yet tested on the example cases');
    expect(statusLine()).not.toContain('partial');
    expect(section().textContent).not.toContain('Latest test of this model');
  });

  it('false state: a stop after some cases finished saves a result and does not say "nothing was saved"', async () => {
    save();
    vi.stubGlobal('fetch', createFakeModel({ kind: 'custom', handle: (r, i) => (i >= 2 ? { kind: 'never' } : knows(r)) }).fetch);
    const user = userEvent.setup({ delay: null });
    await open(user);
    await user.click(within(section()).getByRole('button', { name: 'Test it' }));
    await within(section()).findByText('Case 3 of 31');
    await user.click(within(section()).getByRole('button', { name: 'Stop' }));
    await within(section()).findByText('Stopped after 2 of 31 cases.');
    expect(section().textContent).not.toContain('nothing was saved');
    expect(localStorage.getItem('aigate:model-test-results')).not.toBeNull();
  });

  it('a newer stopped run does not hide the earlier complete one: the complete run is the result, the stopped one is a separate line, and the label agrees', async () => {
    save();
    appendTestResult(stored({ date: '2026-10-20' }));
    appendTestResult(stored({ date: '2026-10-22', casesRun: 7, stopped: true, verdictMatches: 5, verdictCompared: 7 }));
    const user = userEvent.setup({ delay: null });
    await open(user);
    const text = section().textContent!;
    expect(text).toContain('Right verdict in 31 of 31 cases');
    expect(text).toContain('A later test was stopped after 7 of 31 cases.');
    expect(text).not.toContain('Stopped after 7 of 31 cases.');
    expect(text).not.toMatch(/Right verdict in \d+ of the 7 cases that ran/);
    await statusHas('tested on 2026-10-20');
    expect(statusLine()).not.toContain('2026-10-22');
  });

  it('false state: with no complete run the stopped run is the result and there is no "later" line; an older stopped run is not called later', async () => {
    save();
    appendTestResult(stored({ date: '2026-10-22', casesRun: 7, stopped: true }));
    const user = userEvent.setup({ delay: null });
    await open(user);
    expect(section().textContent).toContain('Stopped after 7 of 31 cases.');
    expect(section().textContent).not.toContain('A later test');
    await statusHas('AI helper alpha:7b: untested (a partial test stopped after 7 of 31 cases)');
  });

  it('false state: a stopped run older than the complete one is not mentioned', async () => {
    save();
    appendTestResult(stored({ date: '2026-10-01', casesRun: 7, stopped: true }));
    appendTestResult(stored({ date: '2026-10-20' }));
    const user = userEvent.setup({ delay: null });
    await open(user);
    expect(section().textContent).not.toContain('A later test');
    expect(section().textContent).not.toContain('stopped after');
  });
});

describe('review pass 1, fixes 4 and 5: the run fails in the middle, or the result cannot be saved', () => {
  it('a throw mid-run says the test stopped unexpectedly and was not saved, not that it could not start', async () => {
    save();
    vi.mocked(runModelTest).mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const user = userEvent.setup({ delay: null });
    await open(user);
    await user.click(within(section()).getByRole('button', { name: 'Test it' }));
    expect(await within(section()).findByText('The test stopped unexpectedly and was not saved.')).toBeInTheDocument();
    expect(section().textContent).not.toContain('could not start');
    expect(localStorage.getItem('aigate:model-test-results')).toBeNull();
    expect(within(section()).getByRole('button', { name: 'Test it' })).toBeEnabled();
  });

  it('false state: a run that finishes shows neither failure sentence', async () => {
    save();
    vi.stubGlobal('fetch', createFakeModel({ kind: 'custom', handle: (r) => knows(r) }).fetch);
    const user = userEvent.setup({ delay: null });
    await open(user);
    await user.click(within(section()).getByRole('button', { name: 'Test it' }));
    await within(section()).findByText(/Right verdict in \d+ of/, {}, { timeout: 20000 });
    expect(section().textContent).not.toMatch(/stopped unexpectedly|could not start|could not be saved/);
  }, 40000);

  it('storage refusing the write says the result could not be saved in this browser', async () => {
    save();
    vi.stubGlobal('fetch', createFakeModel({ kind: 'custom', handle: (r) => knows(r) }).fetch);
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === 'aigate:model-test-results') throw new Error('quota');
      return realSet.call(this, k, v);
    });
    const user = userEvent.setup({ delay: null });
    await open(user);
    await user.click(within(section()).getByRole('button', { name: 'Test it' }));
    expect(await within(section()).findByText('The result could not be saved in this browser.', {}, { timeout: 20000 })).toBeInTheDocument();
    await statusHas('AI helper alpha:7b: not yet tested on the example cases');
    vi.restoreAllMocks();
  }, 40000);
});
