import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { loadPolicy } from '../../store/policy';
import { updateUseCaseVerdictSummary } from '../../store/register';
import { toAnswerSources } from '../../engine/answer-sources';
import { typedAnswersFromPlain } from '../../engine/form-visibility';
import { WORKED_EXAMPLES } from '../../engine/worked-examples';
import { seedCase, DESCRIPTION } from '../../test-support/answer-sources-fixtures';

// R18-D2 review pass 1 (Minor 5): a correction the register hands to the intake is for that screen only. If the
// intake never takes it (here a stand-in that ignores it) and the person goes elsewhere, it is dropped, so a
// later visit to the intake does not receive it and cannot replace a draft started since.

vi.mock('../IntakeFlow', () => ({
  default: ({ correctionRequest }: { correctionRequest?: unknown }) => (
    <div data-testid="intake" data-request={correctionRequest ? 'held' : 'none'} />
  ),
}));

let sources: ReturnType<typeof toAnswerSources>;
beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  sources = toAnswerSources(typedAnswersFromPlain(WORKED_EXAMPLES.find((e) => e.id === 'case-1')!.answers, r.policy), DESCRIPTION);
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('a correction request the intake did not take', () => {
  it('is handed to the intake when the register asks, and is gone once the person has been elsewhere', async () => {
    const id = crypto.randomUUID();
    await seedCase(id, { sources, label: 'Stale request D2', description: DESCRIPTION });
    await updateUseCaseVerdictSummary(id, { currentVerdictId: `v-${id}` });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    expect(screen.getByTestId('intake')).toHaveAttribute('data-request', 'none'); // false-state: nothing held yet
    await user.click(screen.getByText('▤ Register'));
    await user.click(await screen.findByText('Stale request D2'));
    await user.click(await screen.findByRole('button', { name: /^correct this check$/i }));
    expect(await screen.findByTestId('intake')).toHaveAttribute('data-request', 'held'); // the intake was given it

    // the stand-in never took it; the person goes to the register and back to the intake
    await user.click(screen.getByText('▤ Register'));
    await screen.findByText('Stale request D2');
    await user.click(screen.getByRole('button', { name: /new pre-check/i }));
    expect(await screen.findByTestId('intake')).toHaveAttribute('data-request', 'none');
  });
});
