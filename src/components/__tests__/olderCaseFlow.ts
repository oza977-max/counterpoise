import { screen, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { describeAssumptions } from '../plain-copy';
import { DUP_CHECK_WAIT } from './fillText';
import { tickAll, typeFiveAndEleven } from './r18d2Flow';

// Shared steps of the R18-E older-case tests: open an older case from the register as the submitter, and answer
// what its form leaves blank when the two recorded "Not sure" answers are Question 4 and Question 9.

type User = ReturnType<typeof userEvent.setup>;

/** The "Not sure" assumptions a build before Round 18 recorded for Questions 4 and 9. */
export const NOT_SURE_4_AND_9 = () =>
  describeAssumptions([
    { questionId: '4', optionKey: 'not-sure', fields: ['model_type'] },
    { questionId: '9', optionKey: 'not-sure', fields: ['output_reversibility'] },
  ]);

export const RETIRED_TITLE = /check what we read from your description/i;

/** Register -> the case -> "Correct this check" -> the form. */
export async function openOlderCase(user: User, label: string) {
  await user.click(screen.getByText('▤ Register'));
  await user.click(await screen.findByText(label));
  await user.click(await screen.findByRole('button', { name: /^correct this check$/i }));
  await screen.findByText(/new pre-check — tell us about the ai you want to use/i, undefined, DUP_CHECK_WAIT);
}

/** Answer every question that is blank when 4 and 9 are restored as "Not sure". */
export async function answerTheRest(user: User, name: string) {
  await user.type(screen.getByLabelText(/what do you want to call it/i), name);
  await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
  await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
  await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
  await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
  await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
  await user.click(within(screen.getByRole('radiogroup', { name: /does it replace something/i })).getByRole('radio', { name: /^no$/i }));
  await user.click(within(screen.getByRole('radiogroup', { name: /can copies of it/i })).getByRole('radio', { name: /^no — it works alone$/i }));
  await user.click(screen.getByRole('checkbox', { name: /nothing beyond what it.s given/i }));
  await typeFiveAndEleven(user);
}

export { tickAll };
