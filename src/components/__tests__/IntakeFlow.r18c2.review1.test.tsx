import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { MODEL_SETTING_KEY, MODEL_SETTING_CHANGED_EVENT } from '../../llm/model-setting';
import { R18_COPY, failureSentence } from '../plain-copy';
import { SLOW_FLOW_MS } from './fillText';
import {
  FORM_HEADING,
  FORM_WAIT,
  backButton,
  describeAndContinue,
  describeToReadForm,
  installModel,
  reply,
  retype,
  submitDescription,
} from './r18c2Flow';
import type { FakeBehaviour } from '../../llm/test-utils';

// R18-C2 review pass 1, I1 and I2: the sentence above the form never names a button that is not on screen,
// and never says nothing was filled in while earlier model-filled answers are still showing.

const DESC = 'Our UK team will use it for internal ticket volumes across the whole business.';
const EDITED = 'Our UK team will use it for internal ticket volumes in one small trial.';
const GOOD = reply([
  { question: '11', values: [{ option: 'UK', quote: 'Our UK team' }] },
  { question: '5', values: [{ option: 'everyday', quote: 'internal ticket volumes' }] },
]);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const note = () => document.querySelector('.plain-form__read-note');
const readAgainButton = () => screen.queryByRole('button', { name: /read my description again/i });

/** Describe, reach the reading step with a read that never ends, then close the tab. */
async function reloadDuringReading(user: ReturnType<typeof userEvent.setup>) {
  installModel({ kind: 'never' });
  const first = render(<App />);
  await describeAndContinue(user, DESC);
  await screen.findByText(R18_COPY.READING_HEADING);
  first.unmount();
}

describe('I1: the note never names a button that is not on screen', () => {
  it('TC-R18-GI-7-06r1a (I1): a reload during reading WITH a valid model names the button, and the button is there', async () => {
    const user = userEvent.setup({ delay: null });
    await reloadDuringReading(user);
    render(<App />);
    await screen.findByText(FORM_HEADING, undefined, FORM_WAIT);
    expect(note()!.textContent).toBe(failureSentence('not-read', 'this-computer', ''));
    expect(note()!.textContent).toMatch(/read my description again/i);
    expect(readAgainButton()).toBeInTheDocument();
  }, SLOW_FLOW_MS);

  it('TC-R18-GI-7-06r1b (I1): a reload during reading with NO model says no model is connected and names no button', async () => {
    const user = userEvent.setup({ delay: null });
    await reloadDuringReading(user);
    localStorage.removeItem(MODEL_SETTING_KEY);
    render(<App />);
    await screen.findByText(FORM_HEADING, undefined, FORM_WAIT);
    expect(note()!.textContent).toBe(failureSentence('not-configured', 'this-computer', ''));
    expect(note()!.textContent).not.toMatch(/read my description again/i);
    expect(readAgainButton()).not.toBeInTheDocument();
  }, SLOW_FLOW_MS);

  it('TC-R18-GI-7-06r1c (I1): a reload during reading with an INVALID setting says so and names no button', async () => {
    const user = userEvent.setup({ delay: null });
    await reloadDuringReading(user);
    localStorage.setItem(MODEL_SETTING_KEY, '{not json');
    render(<App />);
    await screen.findByText(FORM_HEADING, undefined, FORM_WAIT);
    expect(note()!.textContent).toBe(failureSentence('invalid-setting', 'this-computer', ''));
    expect(readAgainButton()).not.toBeInTheDocument();
  }, SLOW_FLOW_MS);

  it('TC-R18-GI-7-09r1d (I1): the setting removed mid-read gives the no-model sentence and names no button', async () => {
    installModel({ kind: 'never' });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await describeAndContinue(user, DESC);
    await screen.findByText(R18_COPY.READING_HEADING);
    localStorage.removeItem(MODEL_SETTING_KEY);
    window.dispatchEvent(new CustomEvent(MODEL_SETTING_CHANGED_EVENT));
    await screen.findByText(FORM_HEADING, undefined, FORM_WAIT);
    expect(note()!.textContent).not.toMatch(/read my description again/i);
    expect(readAgainButton()).not.toBeInTheDocument();
  }, SLOW_FLOW_MS);
});

/** A read with two pre-filled answers, both ticked; then the description is edited and the next read is `later`. */
async function earlierAnswersThenSecondRead(user: ReturnType<typeof userEvent.setup>, later: FakeBehaviour) {
  installModel({ kind: 'custom', handle: (_req, index): FakeBehaviour => (index === 0 ? { kind: 'honours-format', reply: GOOD } : later) });
  render(<App />);
  await describeToReadForm(user, DESC);
  for (const tick of screen.getAllByRole('checkbox', { name: /^yes, this is right/i })) await user.click(tick);
  expect(screen.getAllByText(/confirmed by you/i)).toHaveLength(2);
  await user.click(backButton());
  await retype(user, EDITED);
  await submitDescription(user);
}

describe('I2: earlier model-filled answers that stay on the form are not denied by the note', () => {
  it('TC-R18-GI-13-01r1e (I2): Skip after earlier pre-fills says the earlier answers are kept - and they are', async () => {
    const user = userEvent.setup({ delay: null });
    await earlierAnswersThenSecondRead(user, { kind: 'never' });
    await user.click(await screen.findByRole('button', { name: /skip/i }));
    await screen.findByText(FORM_HEADING, undefined, FORM_WAIT);
    expect(note()!.textContent).toBe(R18_COPY.KEPT_EARLIER_NOTE);
    expect(note()!.textContent).not.toMatch(/nothing was filled in for you\. answer/i);
    expect(screen.getAllByText(/confirmed by you — from your description/i).length).toBeGreaterThanOrEqual(1);
  }, SLOW_FLOW_MS);

  it('TC-R18-GI-13-01r1f (I2): a failed Read again after earlier pre-fills says the earlier answers are kept', async () => {
    const user = userEvent.setup({ delay: null });
    await earlierAnswersThenSecondRead(user, { kind: 'content', content: 'nope' });
    await screen.findByText(FORM_HEADING, undefined, FORM_WAIT);
    expect(note()!.textContent).toBe(R18_COPY.KEPT_EARLIER_NOTE);
    expect(screen.getAllByText(/confirmed by you/i).length).toBeGreaterThanOrEqual(1);
  }, SLOW_FLOW_MS);

  it('TC-R18-GI-13-01r1g (I2, false state): with no earlier pre-fills Skip keeps the plain sentence and never says "kept"', async () => {
    installModel({ kind: 'never' });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await describeAndContinue(user, DESC);
    await user.click(await screen.findByRole('button', { name: /skip/i }));
    await screen.findByText(FORM_HEADING, undefined, FORM_WAIT);
    expect(note()!.textContent).toBe(failureSentence('skipped', 'this-computer', ''));
    expect(note()!.textContent).not.toMatch(/earlier answers/i);
    expect(screen.queryByText(/from your description/i)).not.toBeInTheDocument();
  }, SLOW_FLOW_MS);
});
