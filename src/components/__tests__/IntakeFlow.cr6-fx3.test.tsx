import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { getUseCases } from '../../store/register';
import { getAll } from '../../store/audit';
import { fillText, DUP_CHECK_WAIT, pressNext } from './fillText';

// FX-3 (CR6-fixes.md) — description-path coverage that needs the real
// App/IntakeFlow wiring. Mock budget = 1: the Anthropic SDK boundary.
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('aigate:api-key', 'test-key');
  mockCreate.mockReset();
});

describe('CR6-05 — "replaces something you already use?" on the description path', () => {
  it('TC-CR6-05b: a guessed replaces_prior_model, answered "Not sure" in the questionnaire, becomes true, is recorded as an assumption and listed back', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: {
            input_nodes: [],
            processing_nodes: [
              {
                id: 'p1',
                label: 'client update model',
                model_type: 'ml',
                autonomy_level: 1,
                data_zone: 'Zone C',
                vendor: 'internal',
                // The model's own guess — and NO quote for it below.
                replaces_prior_model: false,
                basis_quotes: {
                  model_type: 'a model',
                  autonomy_level: 'a person reviews every update',
                  data_zone: 'built in-house',
                  vendor: 'built in-house',
                },
              },
            ],
            output_nodes: [
              {
                id: 'o1',
                label: 'client notifications',
                action_type: 'recommend',
                exposure: 'internal-only',
                decision_bindingness: 'advisory',
                output_reversibility: 'reversible',
                scale: 'limited',
                basis_quotes: {
                  action_type: 'suggests client updates',
                  exposure: 'only my team sees them',
                  decision_bindingness: 'one input among several',
                  output_reversibility: 'easily put right',
                  scale: 'a small trial',
                },
              },
            ],
            edges: [],
            jurisdictions: [],
          },
        },
      ],
    });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const description =
      'A model suggests client updates. A person reviews every update. It was built in-house. Only my team sees ' +
      'them, as one input among several, easily put right. It is a small trial.';
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), description);
    await pressNext(user);
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
    await screen.findByText('Check what we read from your description');
    for (;;) {
      const b = screen.queryAllByRole('button', { name: /^(this is right|i.ve checked this — it.s right)$/i })[0];
      if (!b) break;
      await user.click(b);
    }
    const jur = screen.queryByRole('button', { name: /^(these are right|none of these — continue)$/i });
    if (jur) await user.click(jur);
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    await screen.findByText(/does it replace something you already use/i);
    await user.click(screen.getByRole('button', { name: /^not sure$/i }));

    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });

    // Listed back.
    expect(screen.getByText(/answers the submitter wasn.t sure about/i)).toBeInTheDocument();
    expect(screen.getByText(/it replaces something you already use — the stricter case/i)).toBeInTheDocument();

    // Value true: the answer wrote one correction (false -> true, graph v2)
    // and the assumption is on the audited confirmation. replaces_prior_model
    // true routes a Low case to Track II (TRACK-II-REPLACE).
    // App seeds demo cases into the same register, and getUseCases returns
    // them in index (UUID) order — select THIS test's case by what it typed,
    // never by position (review pass 2: [0] was a seeded case most runs).
    const mine = (await getUseCases('all')).filter((u) => u.description === description);
    expect(mine).toHaveLength(1);
    const useCase = mine[0];
    const events = await getAll(useCase!.use_case_id);
    const confirmed = events.find((e) => e.payload.type === 'graph_confirmed')!.payload as {
      type: 'graph_confirmed';
      graph_version: number;
      corrections_count: number;
      assumptions?: { questionId: string; fields: string[] }[];
    };
    expect(confirmed.graph_version).toBe(2);
    expect(confirmed.corrections_count).toBe(1);
    expect(confirmed.assumptions).toEqual([
      expect.objectContaining({ questionId: 'field:replaces_prior_model', fields: ['replaces_prior_model'] }),
    ]);
    const produced = events.find((e) => e.payload.type === 'verdict_produced')!.payload as {
      verdict: { track: string };
    };
    expect(produced.verdict.track).toBe('II');
  });
});
