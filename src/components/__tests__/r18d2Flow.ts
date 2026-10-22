import { screen, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { getAllForExport } from '../../store/audit';
import type { AuditEvent } from '../../store/types';
import { fillText } from './fillText';

// Shared steps of the R18-D2 flow tests: finish the form after the model has (or has not) filled Questions 5 and 11,
// confirm, and read the audit trail of the case just made.

type User = ReturnType<typeof userEvent.setup>;

export const DESC = 'It reads client names and account details. Our UK team will use it every morning.';

/** Everything of the form except Questions 5 and 11 (a model fills those, or a typed run answers them). */
export async function answerFormExceptFiveAndEleven(user: User, name: string) {
  await user.type(screen.getByLabelText(/what do you want to call it/i), name);
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

/** Questions 5 and 11 by hand (a run with no model). */
export async function typeFiveAndEleven(user: User) {
  await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
  await user.click(screen.getByRole('checkbox', { name: /united kingdom/i }));
}

export async function tickAll(user: User) {
  for (const tick of screen.getAllByRole('checkbox', { name: /^i've checked this answer/i })) {
    if (!(tick as HTMLInputElement).checked) await user.click(tick);
  }
}

/** Replace the description on the FORM (Question 2's box). */
export async function editFormDescription(user: User, text: string) {
  const box = screen.getByLabelText(/in a sentence or two/i);
  await user.clear(box);
  await fillText(user, box, text);
}

export async function confirmAndReachVerdict(user: User) {
  await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
  await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
}

/** The audit trail of the case whose use_case_created holds this description (the first such case). */
export async function trailOf(description: string): Promise<AuditEvent[]> {
  const all = await getAllForExport();
  const created = all.find((e) => e.payload.type === 'use_case_created' && e.payload.description === description);
  return created ? all.filter((e) => e.use_case_id === created.use_case_id) : [];
}

export const ofType = (events: AuditEvent[], type: string) => events.filter((e) => e.payload.type === type);

export type SourceRow = { question_id: string; origin: string; value: unknown; quote_in_final_description?: boolean; read?: number };
export const sourcesOf = (e: AuditEvent): { reads: unknown[]; answers: SourceRow[] } | undefined =>
  (e.payload as unknown as { answer_sources?: { reads: unknown[]; answers: SourceRow[] } }).answer_sources;

export { within };
