import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { setCurrentPolicyYaml } from '../../store/policy-source';
import { loadDraft } from '../intake-draft';
import appetiteYaml from '../../../policy/appetite.yaml?raw';
import type { FormAnswerState } from '../../engine/prefill-types';
import { SLOW_FLOW_MS } from './fillText';
import { continueButton, describeToReadForm, installModel, reply, tickFor } from './r18c2Flow';

// R18-C2 full-route regression (spec §27.6 threading, TC-R18-GI-8-*, GI-3-17): the answer state, with each
// answer's source, survives a failed evaluation. After the failure the person is back on the form with the
// pre-filled answer still confirmed (no second tick owed), and the next confirmation still counts it.

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentPolicyYaml(appetiteYaml);
});

describe('answerState survives EVALUATION_FAILED and the retry', () => {
  it('R18-C2: after a failed evaluation the form still holds the model-filled answer as confirmed, and the retry confirmation still counts it', async () => {
    installModel({
      kind: 'honours-format',
      reply: reply([{ question: '5', values: [{ option: 'everyday', quote: 'internal ticket volumes' }] }]),
    });
    // a policy with a hole in its tracks, so the evaluation genuinely fails (as TC-R16-F-24 does)
    setCurrentPolicyYaml(
      appetiteYaml.replace(
        /^tracks:[\s\S]*?(?=^tiers:)/m,
        `tracks:\n  - id: "TRACK-III"\n    name: "Track III"\n    description: "test fixture"\n    regulatory_basis: "test fixture"\n    conditions:\n      - field: "model_type"\n        value: { in: ["llm"] }\n    short_circuit: true\n\n`,
      ),
    );
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await describeToReadForm(user, 'A tool for internal ticket volumes. A person reads what it produces.');

    await user.type(screen.getByLabelText(/what do you want to call it/i), 'Retry tool');
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    await user.click(screen.getByRole('radio', { name: /recognises things in images, sound or documents/i }));
    await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
    await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
    await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
    await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
    await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
    await user.click(screen.getByRole('checkbox', { name: /somewhere else, or not sure/i }));
    await user.click(screen.getByRole('radio', { name: /^no$/i }));
    await user.click(tickFor(/what information/));
    await user.click(continueButton());
    await screen.findByText(/here.s what we understood/i);
    expect(screen.getByText(/^1 of \d+ answers? (was|were) filled in by a model and confirmed by you$/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /confirm and evaluate/i }));

    // failed: back on the form
    expect(await screen.findByRole('alert')).toHaveTextContent(/evaluation could not complete/i);
    await screen.findByLabelText(/what do you want to call it/i);
    // the draft holds the state with its source
    const draft = loadDraft() as { step: string; answerState?: FormAnswerState };
    expect(draft.step).toBe('graph_extraction');
    expect(draft.answerState?.['5']?.source).toMatchObject({ kind: 'prefilled', confirmed: true });
    // the mark and its tick are still there, ticked; Continue is open with no second tick owed
    expect(screen.getByText(/confirmed by you — suggested by .+ from your description: “internal ticket volumes”/)).toBeInTheDocument();
    expect(tickFor(/what information/)).toBeChecked();
    expect(continueButton()).toBeEnabled();
    // the retry: the confirmation counts it again
    await user.click(continueButton());
    await screen.findByText(/here.s what we understood/i);
    expect(screen.getByText(/^1 of \d+ answers? (was|were) filled in by a model and confirmed by you$/)).toBeInTheDocument();
  }, SLOW_FLOW_MS);
});
