import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { setCurrentPolicyYaml } from '../../store/policy-source';
import appetiteYaml from '../../../policy/appetite.yaml?raw';
import { fillText, DUP_CHECK_WAIT, pressNext } from './fillText';

// R16-E — what only the real App/IntakeFlow wiring can prove. R18-A: the
// description-reading route is gone (one route: the guided form), so the
// extraction-error, card-review and targeted-question cases of this file were
// retired; the genuine evaluation failure still owes its plain message on the
// form route.

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // A key is set on purpose: R18-A has one route whatever is configured.
  localStorage.setItem('aigate:api-key', 'test-key');
});

async function answerExampleOne(user: ReturnType<typeof userEvent.setup>) {
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

describe('R16-E: a genuine evaluation failure on the form route', () => {
  it('TC-R16-E-66d: a genuine evaluation failure on the form route shows the plain message about a gap in the firm rules and keeps the form', async () => {
    const holed = appetiteYaml.replace(
      /^tracks:[\s\S]*?(?=^tiers:)/m,
      `tracks:\n  - id: "TRACK-III"\n    name: "Track III"\n    description: "test fixture"\n    regulatory_basis: "test fixture"\n    conditions:\n      - field: "model_type"\n        value: { in: ["llm"] }\n    short_circuit: true\n\n`,
    );
    setCurrentPolicyYaml(holed);
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'No-track-match description probe: a rules-based dashboard for our own team.');
    await pressNext(user);
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
    await user.type(screen.getByLabelText(/what do you want to call it/i), 'Probe');
    await answerExampleOne(user);
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByText(/here.s what we understood/i);
    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/evaluation could not complete: your firm.s rules don.t yet cover this particular combination of answers/i);
    expect(screen.getByText(/new pre-check — tell us about the ai you want to use/i)).toBeInTheDocument();
  });
});
