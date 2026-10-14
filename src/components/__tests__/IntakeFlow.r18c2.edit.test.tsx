import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { loadFormDraft } from '../intake-draft';
import { textFingerprint } from '../../engine/form-answer-state';
import { SLOW_FLOW_MS, pressNext } from './fillText';
import { answerExampleOne } from './r18aFlow';
import {
  FORM_HEADING,
  FORM_WAIT,
  backButton,
  continueButton,
  describeToReadForm,
  installModel,
  reply,
  retype,
  submitDescription,
  tickFor,
} from './r18c2Flow';
import type { FakeBehaviour } from '../../llm/test-utils';

// R18-C2 deliverable 2 + threading: edit-and-return (TC-R18-GI-8-*), reload (GI-9-*). Three pre-filled
// answers - A (countries), B (information) and C (how widely) - from a description whose sentences the
// edits then change. Fakes reject on abort; no internal class is mocked.

const FIRST = 'Our UK team will use it for internal ticket volumes across the whole business.';
const SECOND = 'Our UK team will use it for internal ticket volumes in one small trial.';

const A = { question: '11', values: [{ option: 'UK', quote: 'Our UK team' }] };
const B = { question: '5', values: [{ option: 'everyday', quote: 'internal ticket volumes' }] };
const C = { question: '10', values: [{ option: 'wide', quote: 'across the whole business' }] };
const C2 = { question: '10', values: [{ option: 'small', quote: 'one small trial' }] };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

/** The fake answers the first read with `first` and every later read with `later`. */
function twoReads(first: Parameters<typeof reply>[0], later: Parameters<typeof reply>[0]) {
  return installModel({
    kind: 'custom',
    handle: (_req, index): FakeBehaviour => ({ kind: 'honours-format', reply: reply(index === 0 ? first : later) }),
  });
}

const uk = () => screen.getByRole('checkbox', { name: /united kingdom/i });
const everyday = () => screen.getByRole('checkbox', { name: /everyday work information/i });
const people = () => screen.getByRole('checkbox', { name: /information about people/i });
const wide = () => screen.getByRole('radio', { name: /several teams, the whole business/i });
const small = () => screen.getByRole('radio', { name: /just me, or a small trial/i });

/** First visit: A confirmed, B changed, C left untouched. */
async function halfConfirmedForm(user: ReturnType<typeof userEvent.setup>) {
  await describeToReadForm(user, FIRST);
  await user.click(tickFor(/which countries/));
  await user.click(people()); // B: ticking another option changes what the model read
  expect(screen.getByText(/changed by you/i)).toBeInTheDocument();
}

describe('editing the description and returning (TC-R18-GI-8-01, -02, -03, -04, -08)', () => {
  it('TC-R18-GI-8-01: re-pre-fills only the untouched answer; the confirmed and the changed one are kept', async () => {
    const fake = twoReads([A, B, C], [A, B, C2]);
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await halfConfirmedForm(user);
    expect(wide()).toBeChecked();

    await user.click(backButton());
    await retype(user, SECOND);
    await submitDescription(user);
    await screen.findByText(FORM_HEADING, undefined, FORM_WAIT);
    expect(fake.requests.length).toBeGreaterThanOrEqual(2);

    // A: confirmed, original value
    expect(uk()).toBeChecked();
    expect(screen.getByText(/confirmed by you — from your description: “Our UK team”/)).toBeInTheDocument();
    // B: the changed value and state, not the model's new reply
    expect(people()).toBeChecked();
    expect(everyday()).toBeChecked();
    expect(screen.getByText(/changed by you — alpha:7b had read “internal ticket volumes”/)).toBeInTheDocument();
    // C: the new pre-fill, with its new quote
    expect(small()).toBeChecked();
    expect(wide()).not.toBeChecked();
    expect(screen.getByText('from your description: “one small trial” — is this right?')).toBeInTheDocument();
    expect(screen.queryByText(/across the whole business/)).not.toBeInTheDocument();
  }, SLOW_FLOW_MS);

  it('TC-R18-GI-8-02: an unconfirmed pre-fill whose sentence was deleted becomes blank, with no trace of the old quote', async () => {
    twoReads([A, B, C], [A, B]);
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await halfConfirmedForm(user);
    await user.click(backButton());
    await retype(user, 'Our UK team will use it for internal ticket volumes.');
    await submitDescription(user);
    await screen.findByText(FORM_HEADING, undefined, FORM_WAIT);
    expect(wide()).not.toBeChecked();
    expect(small()).not.toBeChecked();
    expect(document.body.textContent).not.toContain('across the whole business');
    expect(loadFormDraft()!.answerState['10']).toBeUndefined();
  }, SLOW_FLOW_MS);

  it('TC-R18-GI-8-03: going back and returning without editing changes nothing and asks the model nothing', async () => {
    const fake = twoReads([A, B, C], [A, B, C2]);
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await halfConfirmedForm(user);
    const requests = fake.requests.length;
    const before = JSON.stringify(loadFormDraft()!.answerState);

    await user.click(backButton());
    await screen.findByLabelText(/what ai tool do you want to use/i);
    await pressNext(user);
    await screen.findByText(FORM_HEADING);
    expect(fake.requests).toHaveLength(requests);
    expect(JSON.stringify(loadFormDraft()!.answerState)).toBe(before);
    expect(uk()).toBeChecked();
    expect(people()).toBeChecked();
    expect(wide()).toBeChecked();
    expect(screen.getByText(/changed by you/i)).toBeInTheDocument();
    expect(screen.getByText(/confirmed by you — from your description: “Our UK team”/)).toBeInTheDocument();
    expect(screen.getByText('from your description: “across the whole business” — is this right?')).toBeInTheDocument();
  }, SLOW_FLOW_MS);

  it('TC-R18-GI-8-10: Back after a pre-fill keeps it confirmed and calls the model no more', async () => {
    const fake = twoReads([A], [A]);
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await describeToReadForm(user, FIRST);
    await user.type(screen.getByLabelText(/what do you want to call it/i), 'Tool');
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    await user.click(tickFor(/which countries/));
    const requests = fake.requests.length;

    await user.click(backButton());
    await screen.findByLabelText(/what ai tool do you want to use/i);
    await pressNext(user);
    await screen.findByText(FORM_HEADING);
    expect(fake.requests).toHaveLength(requests);
    expect(screen.getByLabelText(/what do you want to call it/i)).toHaveValue('Tool');
    expect(screen.getByRole('radio', { name: /something a team in your firm built for this job/i })).toBeChecked();
    expect(uk()).toBeChecked();
    expect(screen.getByText(/confirmed by you/i)).toBeInTheDocument();
  }, SLOW_FLOW_MS);

  it('TC-R18-GI-8-04: a confirmed answer survives an edit that removes its sentence, and says so', async () => {
    twoReads([A, B, C], []);
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await describeToReadForm(user, FIRST);
    await user.click(tickFor(/which countries/));
    await user.click(backButton());
    await retype(user, 'The London office will use it for internal ticket volumes across the whole business.');
    await submitDescription(user);
    await screen.findByText(FORM_HEADING, undefined, FORM_WAIT);
    expect(uk()).toBeChecked();
    expect(screen.getByText('confirmed by you — the quote “Our UK team” is no longer in your description')).toBeInTheDocument();
    expect(screen.queryByText(/from your description: “Our UK team”/)).not.toBeInTheDocument();
    // the record keeps the original quote unchanged
    expect(loadFormDraft()!.answerState['11']!.source).toMatchObject({
      kind: 'prefilled',
      confirmed: true,
      quotes: [{ option: 'UK', quote: 'Our UK team' }],
    });
  }, SLOW_FLOW_MS);

  it('TC-R18-GI-8-08: a stale draft never beats a fresh read; a typed answer in it survives; the draft holds the merged state', async () => {
    twoReads([C], [C2]);
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await describeToReadForm(user, FIRST);
    await user.type(screen.getByLabelText(/what do you want to call it/i), 'Typed name');
    expect(loadFormDraft()!.answerState['10']!.value).toBe('wide'); // the first visit's draft

    await user.click(backButton());
    await retype(user, SECOND);
    await submitDescription(user);
    await screen.findByText(FORM_HEADING, undefined, FORM_WAIT);
    expect(small()).toBeChecked();
    expect(wide()).not.toBeChecked();
    expect(screen.getByLabelText(/what do you want to call it/i)).toHaveValue('Typed name');
    const draft = loadFormDraft()!.answerState;
    expect(draft['10']!.value).toBe('small');
    expect(draft['1']).toMatchObject({ value: 'Typed name', source: { kind: 'typed' } });
  }, SLOW_FLOW_MS);
});

describe('reload (TC-R18-GI-9-02..04)', () => {
  it('TC-R18-GI-9-02: a reload at the half-confirmed form restores description, sources and quotes, and makes no call', async () => {
    const fake = twoReads([A, B, C], [A, B, C2]);
    const user = userEvent.setup({ delay: null });
    const first = render(<App />);
    await halfConfirmedForm(user);
    const requests = fake.requests.length;
    first.unmount();

    render(<App />);
    await screen.findByText(FORM_HEADING);
    expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue(FIRST);
    expect(uk()).toBeChecked();
    expect(screen.getByText(/confirmed by you — from your description: “Our UK team”/)).toBeInTheDocument();
    expect(screen.getByText(/changed by you — alpha:7b had read “internal ticket volumes”/)).toBeInTheDocument();
    expect(screen.getByText('from your description: “across the whole business” — is this right?')).toBeInTheDocument();
    expect(fake.requests).toHaveLength(requests);
  }, SLOW_FLOW_MS);

  it('TC-R18-GI-9-03: Start over clears the description, the answers and the stored draft', async () => {
    twoReads([A, B, C], []);
    const user = userEvent.setup({ delay: null });
    const first = render(<App />);
    await halfConfirmedForm(user);
    first.unmount();
    render(<App />);
    await screen.findByText(FORM_HEADING);

    await user.click(screen.getByRole('button', { name: /start over instead/i }));
    expect(await screen.findByLabelText(/what ai tool do you want to use/i)).toHaveValue('');
    const stored = JSON.stringify({ ...sessionStorage });
    expect(stored).not.toContain('Our UK team');
    expect(stored).not.toContain('internal ticket volumes');
    expect(stored).not.toContain('confirmed');
    expect(loadFormDraft()).toBeNull();
  }, SLOW_FLOW_MS);

  it('TC-R18-GI-9-04: completing the pre-check clears the draft', async () => {
    twoReads([A, B, C], []);
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await describeToReadForm(user, FIRST);
    await user.type(screen.getByLabelText(/what do you want to call it/i), 'Tool');
    // everything else by hand except the three pre-filled answers, which are ticked
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    await user.click(screen.getByRole('radio', { name: /gives a score, ranking, flag, category or forecast/i }));
    await user.click(await screen.findByRole('radio', { name: /fixed, written-down rules/i }));
    await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
    await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
    await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
    await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
    await user.click(screen.getByRole('radio', { name: /^no$/i }));
    await user.click(tickFor(/what information/));
    await user.click(tickFor(/which countries/));
    await user.click(tickFor(/how widely/));
    await user.click(continueButton());
    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
    expect(JSON.stringify({ ...sessionStorage })).not.toMatch(/Our UK team|internal ticket volumes|confirmed/);
    expect(loadFormDraft()).toBeNull();
  }, SLOW_FLOW_MS);
});

describe('the last read survives a submit and a Back (TC-R18-GI-8-11)', () => {
  it('after a failed read, a submit, "Change an answer" and Back, an unchanged text makes no further request, and draft and reducer agree', async () => {
    const fake = installModel({ kind: 'refused' });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await describeToReadForm(user, FIRST);
    expect(fake.requests).toHaveLength(1);
    await user.type(screen.getByLabelText(/what do you want to call it/i), 'Tool');
    await answerExampleOne(user);
    await user.click(continueButton());
    await screen.findByText(/here.s what we understood/i);
    // no model-filled line: nothing was filled in
    expect(screen.queryByText(/filled in by a model/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /change an answer/i }));
    await screen.findByText(FORM_HEADING);
    // a form that carries a case has no Back: the way to the description is not offered here (fresh cases only)
    expect(fake.requests).toHaveLength(1);
    const fingerprint = textFingerprint(FIRST);
    expect(loadFormDraft()!.lastRead.fingerprint).toBe(fingerprint);
    const reducerCopy = JSON.parse(sessionStorage.getItem('aigate:intake-draft')!).state;
    expect(reducerCopy.lastRead.fingerprint).toBe(fingerprint);
    expect(reducerCopy.lastRead.fingerprint).toBe(loadFormDraft()!.lastRead.fingerprint);
  }, SLOW_FLOW_MS);
});
