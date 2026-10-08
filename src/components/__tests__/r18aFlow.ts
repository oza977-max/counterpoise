import { screen, waitFor } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { getUseCases } from '../../store/register';
import { IB_PREFIX, ibCaseCount } from '../../seeds/ib-portfolio';
import { AIGATE_USE_CASE_ID } from '../../seeds/aigate-self-assessment';
import { fillText, DUP_CHECK_WAIT, pressNext } from './fillText';

// Shared steps of the R18-A flow tests: describe -> (nudge) -> similar checks -> form.

type User = ReturnType<typeof userEvent.setup>;

/** The guide's example 1, answered on the form (everything except the name and the description). */
export async function answerExampleOne(user: User) {
  await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
  await user.click(screen.getByRole('radio', { name: /gives a score, ranking, flag, category or forecast/i }));
  await user.click(await screen.findByRole('radio', { name: /fixed, written-down rules/i }));
  await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
  await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
  await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
  await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
  await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
  await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
  await user.click(screen.getByRole('checkbox', { name: /united kingdom/i }));
  await user.click(screen.getByRole('radio', { name: /^no$/i }));
}

/** Type a description, go through the nudge, and pass the similar-checks screen to the form. */
export async function describeToForm(user: User, text: string) {
  await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), text);
  await pressNext(user);
  const match = await screen.findByRole('button', { name: /mine is different|continue →/i }, DUP_CHECK_WAIT);
  await user.click(match);
  await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
}

/** Wait until the demo register and the self-assessment are seeded (so a faked evaluation is not consumed by the seed). */
export async function waitForSeeding() {
  await waitFor(
    async () => {
      const ids = (await getUseCases('all')).map((u) => u.use_case_id);
      expect(ids.filter((id) => id.startsWith(IB_PREFIX)).length).toBe(ibCaseCount());
      expect(ids).toContain(AIGATE_USE_CASE_ID);
    },
    { timeout: 10000 },
  );
}
