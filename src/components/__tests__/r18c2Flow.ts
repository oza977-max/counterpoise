import { vi } from 'vitest';
import { screen } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { createFakeModel } from '../../llm/test-utils';
import type { FakeBehaviour, FakeModel } from '../../llm/test-utils';
import { updateModelSetting } from '../../llm/model-setting';
import { fillText, pressNext, DUP_CHECK_WAIT } from './fillText';

// Shared steps of the R18-C2 flow tests: a fake model and a valid this-computer setting, then
// describe -> Next -> Continue -> (reading step) -> form.

type User = ReturnType<typeof userEvent.setup>;

export const FORM_HEADING = /new pre-check — tell us about the ai you want to use/i;
export const FORM_WAIT = { timeout: 5000 };

/** The JSON a model server returns for these answers. */
export function reply(answers: { question: string; values: { option: string; quote: string }[] }[]): string {
  return JSON.stringify({ answers });
}

/** Installs a fake fetch and stores a valid setting that points at it. */
export function installModel(behaviour: FakeBehaviour): FakeModel {
  const fake = createFakeModel(behaviour);
  vi.stubGlobal('fetch', fake.fetch);
  const saved = updateModelSetting({ place: 'this-computer', url: 'http://localhost:11434', model: 'alpha:7b' });
  if (!saved.ok) throw new Error('setting not saved');
  return fake;
}

export const descriptionBox = () => screen.getByLabelText(/what ai tool do you want to use/i);

/** Replace the text in the description box on the description screen. */
export async function retype(user: User, text: string) {
  await user.clear(descriptionBox());
  await fillText(user, descriptionBox(), text);
}

/** Type, Next (through the nudge), then Continue on the similar-cases screen. The reading step follows. */
export async function describeAndContinue(user: User, text: string) {
  await fillText(user, descriptionBox(), text);
  await submitDescription(user);
}

/** Next (through the nudge), then Continue on the similar-cases screen (shown whenever the text is new or changed). */
export async function submitDescription(user: User) {
  await pressNext(user);
  await user.click(await screen.findByRole('button', { name: /continue →|mine is different/i }, DUP_CHECK_WAIT));
}

/** As describeAndContinue, then wait for the form (the reading step is over). */
export async function describeToReadForm(user: User, text: string) {
  await describeAndContinue(user, text);
  await screen.findByText(FORM_HEADING, undefined, FORM_WAIT);
}

export const backButton = () => screen.getAllByRole('button', { name: /back/i })[0]!;
export const continueButton = () => screen.getByRole('button', { name: /^continue$/i });
export const tickFor = (question: RegExp) =>
  screen.getByRole('checkbox', { name: new RegExp(`^i've checked this answer.*${question.source}`, 'i') });
