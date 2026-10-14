import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';
import App from '../../App';
import { evaluate } from '../../engine/evaluate';
import { __resetDbsForTests } from '../../store/db';
import { __resetChainStateForTests } from '../../store/audit';
import { toPlainAnswers } from '../../engine/form-answer-state';
import type { FormAnswerState, AnswerSource, ReadRecord } from '../../engine/prefill-types';
import { SLOW_FLOW_MS } from './fillText';
import { waitForSeeding } from './r18aFlow';
import { continueButton, describeAndContinue, describeToReadForm, installModel, reply, tickFor, FORM_HEADING } from './r18c2Flow';

// R18-C2 one-engine proof (specs/intake-flow.md §27.4 item 5; TC-R18-NF-4-01..04): the verdict is a pure
// function of the confirmed answers. How the answers got there (typed, pre-filled and ticked, pre-filled and
// changed, changed and changed back) and which model supplied them leave no mark on evaluate()'s result.
// The id source and the clock are injected: a counter for crypto.randomUUID and a fixed Date.

vi.mock('../../engine/evaluate', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../engine/evaluate')>();
  return { ...real, evaluate: vi.fn(real.evaluate) };
});
const evaluateSpy = vi.mocked(evaluate);

const DESC = 'Our UK team will use it for internal ticket volumes across the whole business. A person reads what it produces.';

let counter = 0;
beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await __resetDbsForTests();
  __resetChainStateForTests();
  counter = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type User = ReturnType<typeof userEvent.setup>;

/** Questions 1, 3, 4, 6, 7, 8, 9, 12, 13 by hand (the same on every route). */
async function fillCommon(user: User) {
  await user.type(screen.getByLabelText(/what do you want to call it/i), 'Tool');
  await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
  await user.click(screen.getByRole('radio', { name: /gives a score, ranking, flag, category or forecast/i }));
  await user.click(await screen.findByRole('radio', { name: /fixed, written-down rules/i }));
  await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
  await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
  await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
  await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
  await user.click(screen.getByRole('radio', { name: /^no$/i }));
}

/** Runs one case to the end of evaluate() and returns the serialised result. Ids and the clock are injected. */
async function runToResult(route: 'typed' | 'prefilled' | 'changed-back', model?: string): Promise<string> {
  const user = userEvent.setup({ delay: null });
  if (route !== 'typed') {
    installModel({
      kind: 'honours-format',
      reply: reply([
        { question: '11', values: [{ option: 'UK', quote: 'Our UK team' }] },
        { question: '5', values: [{ option: 'everyday', quote: 'internal ticket volumes' }] },
        { question: '10', values: [{ option: 'wide', quote: 'across the whole business' }] },
      ]),
    });
    if (model) {
      const { updateModelSetting } = await import('../../llm/model-setting');
      updateModelSetting({ model });
    }
  }
  render(<App />);
  await waitForSeeding();
  if (route === 'typed') {
    await describeAndContinue(user, DESC);
    await screen.findByText(FORM_HEADING);
  } else {
    await describeToReadForm(user, DESC);
  }
  await fillCommon(user);
  if (route === 'typed') {
    await user.click(screen.getByRole('checkbox', { name: /united kingdom/i }));
    await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
    await user.click(screen.getByRole('radio', { name: /^several teams, the whole business/i }));
  } else if (route === 'prefilled') {
    await user.click(tickFor(/which countries/));
    await user.click(tickFor(/what information/));
    await user.click(tickFor(/how widely/));
  } else {
    // change each pre-fill away and back: confirmed by the change, back to the original value
    const away = screen.getByRole('radio', { name: /just me, or a small trial/i });
    await user.click(away);
    await user.click(screen.getByRole('radio', { name: /^several teams, the whole business/i }));
    await user.click(tickFor(/which countries/));
    await user.click(tickFor(/what information/));
  }
  // inject the id source and the clock, from here to the result
  counter = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(
    () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`,
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T00:00:00.000Z'));
  evaluateSpy.mockClear();
  await user.click(continueButton());
  await screen.findByText(/here.s what we understood/i);
  await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
  await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
  expect(evaluateSpy).toHaveBeenCalledTimes(1);
  // the graph handed to evaluate() and what it returned, together
  const result = JSON.stringify({ graph: evaluateSpy.mock.calls[0]![0], result: evaluateSpy.mock.results[0]!.value });
  vi.useRealTimers();
  vi.restoreAllMocks();
  return result;
}

async function between() {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  await __resetDbsForTests();
  __resetChainStateForTests();
}

describe('one engine, however the answers were reached (R18-NF-4)', () => {
  it('TC-R18-NF-4-01: a typed run and a pre-filled-then-confirmed run give a byte-identical serialised result', async () => {
    const typed = await runToResult('typed');
    await between();
    const prefilled = await runToResult('prefilled');
    expect(typed.length).toBeGreaterThan(100);
    expect(prefilled).toBe(typed);
    await between();
    const changedBack = await runToResult('changed-back');
    expect(changedBack).toBe(typed);
  }, SLOW_FLOW_MS * 3);

  it('TC-R18-NF-4-02: the model name changes nothing in the result, and appears nowhere in it', async () => {
    const a = await runToResult('prefilled', 'qwen3:4b');
    await between();
    const b = await runToResult('prefilled', 'gemma4:cloud');
    expect(b).toBe(a);
    expect(a).not.toMatch(/qwen3|gemma4/i);
  }, SLOW_FLOW_MS * 2);
});

// ---- NF-4-04 (property): the graph the engine is given depends only on the confirmed values ----

const READ: ReadRecord = { model: 'm', place: 'this-computer', host: 'http://localhost:11434' };
const quote = (q: string) => ({ quote: q, option: '' }) as never;

describe('TC-R18-NF-4-04: identical confirmed answers give identical engine input', () => {
  it('the plain answers (the engine input is built from them alone) do not depend on the answer sources or the order they were confirmed in', () => {
    const valueArb = fc.record({
      '1': fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
      '5': fc.shuffledSubarray(['everyday', 'people', 'unsure'], { minLength: 1 }),
      '10': fc.constantFrom('small', 'wide', 'unsure'),
    });
    fc.assert(
      fc.property(valueArb, fc.array(fc.nat({ max: 3 }), { minLength: 3, maxLength: 3 }), (v, picks) => {
        const mk = (pick: (i: number) => AnswerSource): FormAnswerState => ({
          '1': { value: v['1'], source: pick(0) },
          '5': { value: v['5'], source: pick(1) },
          '10': { value: v['10'], source: pick(2) },
        });
        const kinds: ((q: string) => AnswerSource)[] = [
          () => ({ kind: 'typed' }),
          (q) => ({ kind: 'prefilled', quotes: [quote(q)], read: READ, confirmed: true }),
          (q) => ({ kind: 'changed', from: [quote(q)], read: READ }),
          () => ({ kind: 'record', confirmed: true }),
        ];
        const typedState = mk(() => ({ kind: 'typed' }));
        const mixedState = mk((i) => kinds[picks[i]!]!('q'));
        const reordered: FormAnswerState = {};
        for (const k of ['10', '5', '1'] as const) reordered[k] = mixedState[k];
        const typed = toPlainAnswers(typedState, 'desc');
        expect(toPlainAnswers(mixedState, 'desc')).toEqual(typed);
        expect(JSON.stringify(Object.entries(toPlainAnswers(reordered, 'desc')).sort())).toBe(
          JSON.stringify(Object.entries(typed).sort()),
        );
      }),
      { numRuns: 100 },
    );
  });
});
