import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { createFakeModel } from '../../llm/test-utils';
import { installEgressHarness } from '../../test-support/egress-harness';
import type { EgressHarness } from '../../test-support/egress-harness';
import {
  MODEL_SETTING_KEY,
  MODEL_TEST_RESULTS_KEY,
  updateModelSetting,
} from '../../llm/model-setting';
import { answerExampleOne, describeToForm } from './r18aFlow';
import { reply, FORM_HEADING, FORM_WAIT } from './r18c2Flow';
import { fillText, pressNext, DUP_CHECK_WAIT, SLOW_FLOW_MS } from './fillText';

// R18-G, what may leave the browser and what stays in it (specs/intake-flow.md §27.9), through the whole App:
// TC-R18-NF-3-03 (egress end to end), NF-3-04 (nothing in the address, history or title), NF-3-02 and
// MS-5-04 (Clear all data keeps the model setting and drops the draft and its quotes).

const LOCAL = 'http://localhost:11434';
// Distinctive, so a partial, truncated or encoded copy anywhere is found.
const DESCRIPTION = 'Zebra-quokka-7731 reads client names for the Zorblax desk. Our UK team will use it every morning.';
const REPLY = reply([
  { question: '5', values: [{ option: 'people', quote: 'client names' }] },
  { question: '11', values: [{ option: 'UK', quote: 'Our UK team' }] },
]);

let harness: EgressHarness | undefined;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  harness?.restore();
  harness = undefined;
  vi.unstubAllGlobals();
});

function withModel(replyText = REPLY) {
  const fake = createFakeModel({ kind: 'honours-format', reply: replyText });
  harness = installEgressHarness((url, init) => fake.fetch(url, init));
  const saved = updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'alpha:7b' });
  if (!saved.ok) throw new Error('setting not saved');
  return { fake, harness };
}

type User = ReturnType<typeof userEvent.setup>;

/** Everything of example 1 except Questions 5 and 11, which the model filled in. */
async function answerTheRest(user: User) {
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

async function toFormWithPrefill(user: User) {
  await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), DESCRIPTION);
  await pressNext(user);
  await user.click(await screen.findByRole('button', { name: /continue →|mine is different/i }, DUP_CHECK_WAIT));
  await screen.findByText(FORM_HEADING, undefined, FORM_WAIT);
  await screen.findAllByText(/from your description/i);
}

describe('TC-R18-NF-3-03: a whole pre-check, run with everything a page can send with recorded', () => {
  it(
    'with a model: one request carries the description, to the declared address only; nothing else leaves by any channel; the page loads no foreign script',
    async () => {
      const { harness: h } = withModel();
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await toFormWithPrefill(user);
      await user.type(screen.getByLabelText(/what do you want to call it/i), 'Zorblax desk');
      await answerTheRest(user);
      // the two pre-filled answers need their own tick (Question 5 and Question 11 are both pre-filled)
      for (const t of screen.getAllByRole('checkbox', { name: /^i've checked this answer/i })) await user.click(t);
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
      await screen.findByText(/here.s what we understood/i);
      await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
      await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 8000 });

      // Every record: the page's own origin or the declared model address; the description only to the latter.
      const origins = new Set(h.records.map((r) => new URL(r.url, window.location.origin).origin));
      for (const o of origins) expect([LOCAL, window.location.origin], `an unexpected origin: ${o}`).toContain(o);
      const carrying = h.carrying('Zebra-quokka-7731');
      expect(carrying).toHaveLength(1);
      expect(carrying[0]!.channel).toBe('fetch');
      expect(carrying[0]!.url).toBe(`${LOCAL}/api/chat`);
      // No other channel was used at all.
      expect(h.records.filter((r) => r.channel !== 'fetch')).toEqual([]);
      // A partial copy is not anywhere else either (a fragment of the distinctive word, and its encoded forms).
      for (const part of ['quokka-7731', 'Zorblax', encodeURIComponent('Zebra-quokka-7731'), btoa('Zebra-quokka-7731').slice(0, 12)]) {
        for (const r of h.carrying(part)) expect(r.url, `a copy of "${part}" went to ${r.url}`).toBe(`${LOCAL}/api/chat`);
      }
      // The page itself holds no script, image, link or frame from another origin.
      for (const el of document.querySelectorAll('script[src], img[src], iframe[src], link[href], source[src]')) {
        const ref = el.getAttribute('src') ?? el.getAttribute('href') ?? '';
        expect(new URL(ref, window.location.href).origin, `a foreign resource: ${ref}`).toBe(window.location.origin);
      }
    },
    SLOW_FLOW_MS,
  );

  it('with no model nothing at all is sent, by any channel, through to a verdict', async () => {
    harness = installEgressHarness();
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await describeToForm(user, DESCRIPTION);
    await user.type(screen.getByLabelText(/what do you want to call it/i), 'Zorblax desk');
    await answerExampleOne(user);
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByText(/here.s what we understood/i);
    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 8000 });
    expect(harness.records).toEqual([]);
  }, SLOW_FLOW_MS);
});

describe('TC-R18-NF-3-04: the description is never in the address, the history or the title', () => {
  it('after typing it and a pre-fill run, the address bar, the history entry and the document title hold no part of it', async () => {
    withModel();
    const before = window.location.href;
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await toFormWithPrefill(user);
    const parts = ['client names', 'Zebra', 'quokka', 'Zorblax', 'Our UK team'];
    const where = {
      href: window.location.href,
      hash: window.location.hash,
      search: window.location.search,
      title: document.title,
      state: JSON.stringify(window.history.state ?? null),
    };
    expect(where.href).toBe(before);
    for (const [name, value] of Object.entries(where)) {
      for (const p of parts) {
        expect(value, `${name} holds "${p}"`).not.toContain(p);
        expect(value, `${name} holds an encoded "${p}"`).not.toContain(encodeURIComponent(p));
        expect(value.toLowerCase(), `${name} holds "${p}" with plus signs`).not.toContain(p.toLowerCase().replace(/ /g, '+'));
      }
    }
  }, SLOW_FLOW_MS);
});

describe('Clear all data with a half-confirmed pre-filled form (TC-R18-NF-3-02, TC-R18-MS-5-04)', () => {
  const reload = vi.fn();
  const realLocation = window.location;

  /** A form with two pre-filled answers, one ticked and one not, its draft (with the quotes) in this tab. */
  async function halfConfirmedForm(user: User) {
    updateModelSetting({ mode: 'tool' });
    localStorage.setItem(
      MODEL_TEST_RESULTS_KEY,
      JSON.stringify({
        version: 1,
        results: [{ model: 'alpha:7b', place: 'this-computer', host: LOCAL, date: '2026-10-07', casesRun: 31, stopped: false, verdictMatches: 20, discarded: {}, perQuestion: { '5': { right: 2, blank: 1, wrong: 0 } } }],
      }),
    );
    render(<App />);
    await toFormWithPrefill(user);
    const ticks = screen.getAllByRole('checkbox', { name: /^i've checked this answer/i });
    expect(ticks).toHaveLength(2);
    await user.click(ticks[0]!);
    // the draft exists, holds the text and a quote: the check below is not vacuous
    const draft = JSON.stringify({ ...sessionStorage });
    expect(draft).toContain('Zebra-quokka-7731');
    expect(draft).toContain('Our UK team');
  }

  async function clearAll(user: User) {
    vi.stubGlobal('location', { ...realLocation, reload });
    await user.click(screen.getByText(/demo data/i));
    await user.click(screen.getByRole('button', { name: /clear all data and start over/i }));
    await user.click(screen.getByRole('button', { name: /yes, delete everything/i }));
    await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 8000 });
  }

  beforeEach(() => reload.mockClear());

  it('TC-R18-NF-3-02: browser storage no longer holds the description, the pre-filled answers, the quotes or the confirmations; the model setting is as it was', async () => {
    withModel();
    const user = userEvent.setup({ delay: null });
    await halfConfirmedForm(user);
    const settingBefore = localStorage.getItem(MODEL_SETTING_KEY);
    await clearAll(user);
    const everything = JSON.stringify({ ...sessionStorage, ...localStorage });
    for (const part of ['Zebra-quokka-7731', 'Zorblax', 'client names', 'Our UK team', '"confirmed"', 'prefilled', 'answerState']) {
      expect(everything, `storage still holds ${part}`).not.toContain(part);
    }
    expect(Object.keys(sessionStorage).filter((k) => k.startsWith('aigate:intake'))).toEqual([]);
    expect(localStorage.getItem(MODEL_SETTING_KEY)).toBe(settingBefore);
  }, SLOW_FLOW_MS);

  it('TC-R18-MS-5-04: the remembered mode and the saved test result are still there; the draft and the quotes are not', async () => {
    withModel();
    const user = userEvent.setup({ delay: null });
    await halfConfirmedForm(user);
    const resultsBefore = localStorage.getItem(MODEL_TEST_RESULTS_KEY);
    await clearAll(user);
    expect(JSON.parse(localStorage.getItem(MODEL_SETTING_KEY)!).mode).toBe('tool');
    expect(localStorage.getItem(MODEL_TEST_RESULTS_KEY)).toBe(resultsBefore);
    expect(JSON.parse(resultsBefore!).results[0].perQuestion['5']).toEqual({ right: 2, blank: 1, wrong: 0 });
    expect(JSON.stringify({ ...sessionStorage })).not.toMatch(/Zebra-quokka|Our UK team|client names/);
  }, SLOW_FLOW_MS);
});
