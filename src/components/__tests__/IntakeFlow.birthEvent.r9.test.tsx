import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IntakeFlow from '../IntakeFlow';
import { fillText, DUP_CHECK_WAIT, SLOW_FLOW_MS, pressNext } from './fillText';

// App-run vs seeded trail comparison (2026-08-17): the form path was
// missing use_case_created — found by actually driving the app, not by
// any review. Pinned so it cannot regress.
//
// R16-F F-3 (DR7-05): the write itself moved from the form's own Continue
// to Confirm (so "Start over" before Confirm strands nothing) — this test
// now drives all the way through Confirm before checking the trail,
// which is the only timing change; the assertion (description, method)
// is unchanged.
describe('form path — the trail records the birth event', () => {
  it('writes use_case_created with the typed description and structured_form method', async () => {
    localStorage.clear();
    sessionStorage.clear(); // no model configured → form path
    const user = userEvent.setup({ delay: null });
    render(<IntakeFlow />);
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'A tool that sorts internal mail queues.');
    await pressNext(user);
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
    // On the guided form now; fill the minimum and submit. R16-B: the
    // field-by-field form this used to drive (by label, with an sf-* id
    // fallback) is replaced by the situational question set — adapted to
    // the same underlying scenario (Internal data, firm-built/Zone C, an
    // ml-type recommendation, internal-only, advisory, reversible, at
    // scale), same assertion below (use_case_created, structured_form).
    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
    const { getAllForExport } = await import('../../store/audit');
    await fillText(user, screen.getByLabelText(/what do you want to call it/i), 'Mail queue sorter');
    await fillText(user, screen.getByLabelText(/in a sentence or two/i), 'Sorts internal mail queues.');
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    await user.click(screen.getByRole('radio', { name: /gives a score, ranking, flag, category or forecast/i }));
    await user.click(screen.getByRole('radio', { name: /no, or i don.t know/i }));
    await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
    await user.click(screen.getByRole('radio', { name: /suggests, ranks or flags things/i }));
    await user.click(screen.getByRole('radio', { name: /one input among several/i }));
    await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
    await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
    await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
    await user.click(screen.getByRole('radio', { name: /several teams, the whole business/i }));
    await user.click(screen.getByRole('checkbox', { name: /somewhere else, or not sure/i }));
    await user.click(screen.getByRole('radio', { name: /^no$/i }));
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    // R16-W W-3 (D-69): the form path reaches the summary directly.
    await screen.findByText(/here.s what we understood/i);
    // R16-F F-3 (DR7-05): the write now happens at Confirm, not here.
    await user.click(screen.getByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });

    const created = (await getAllForExport()).filter((e) => e.payload.type === 'use_case_created');
    const mine = created.find(
      (e) => e.payload.type === 'use_case_created' && e.payload.description.includes('sorts internal mail queues'),
    );
    expect(mine).toBeDefined();
    expect(mine!.payload.type === 'use_case_created' && mine!.payload.intake_method).toBe('structured_form');
  }, SLOW_FLOW_MS);
});
