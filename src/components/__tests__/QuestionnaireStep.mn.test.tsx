import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import QuestionnaireStep from '../QuestionnaireStep';
import { loadPolicy } from '../../store/policy';
import type { IntakeQuestion, PolicyFile } from '../../engine/types';

// MODEL-NAMES (owner-approved 2026-10-03): the two shipped approved_models
// entries get plain names, so no raw model id reaches a button (CR6-19
// follow-up). These tests read the REAL policy/appetite.yaml (BC-003).

const VENDOR_NAME = 'A licensed AI model from an outside company (example)';
// UNSIGNED-MODEL: qwen3:4b is is_approved false, so its label (button, Recorded
// line) now carries the owner-approved suffix after the plain name.
const LOCAL_NAME = 'A small open model running on your own computer — not yet accepted by your firm, so it gets an extra check';

const result = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
if (!result.valid) throw new Error('shipped policy invalid: ' + JSON.stringify(result));
const policy: PolicyFile = result.policy;

const question: IntakeQuestion = { id: 'Q1', field: 'declared_model_id', node_id: 'n1', triggered_by: [], answer_type: 'text' };

describe('MODEL-NAMES — the shipped approved models have plain names', () => {
  it('TC-MN-01: every non-family approved_models entry in the real policy has a plain_name', () => {
    const entries = (policy.approved_models ?? []).filter((m) => !m.is_family);
    expect(entries.length).toBeGreaterThan(0);
    for (const m of entries) {
      expect(m.plain_name, `${m.model_id} has no plain_name`).toBeTruthy();
    }
  });

  it('TC-MN-02: the description-path model question shows the owner-approved name and never the raw id', () => {
    render(<QuestionnaireStep questions={[question]} answeredCount={0} onAnswer={vi.fn()} policy={policy} />);
    expect(screen.getByRole('button', { name: VENDOR_NAME })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /VENDOR-LLM-v1/ })).not.toBeInTheDocument();
  });

  it('TC-MN-03: the unapproved local model renders as a button too, under its plain name; the Recorded line uses it', () => {
    const { rerender } = render(
      <QuestionnaireStep questions={[question]} answeredCount={0} onAnswer={vi.fn()} policy={policy} />,
    );
    expect(screen.getByRole('button', { name: LOCAL_NAME })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /qwen3/ })).not.toBeInTheDocument();
    rerender(
      <QuestionnaireStep
        questions={[question, { ...question, id: 'Q2', field: 'data_class', answer_type: 'select' }]}
        answeredCount={1}
        lastAnswer={{ questionId: 'Q1', value: 'qwen3:4b' }}
        onAnswer={vi.fn()}
        policy={policy}
      />,
    );
    const recorded = screen.getByText(/^recorded:/i).closest('p')!;
    expect(recorded).toHaveTextContent(LOCAL_NAME);
    expect(recorded).not.toHaveTextContent('qwen3');
  });

  it('TC-MN-04: neither plain name contains the words approved or rejected', () => {
    for (const id of ['VENDOR-LLM-v1', 'qwen3:4b']) {
      const name = policy.approved_models!.find((m) => m.model_id === id)?.plain_name ?? '';
      expect(name).not.toBe('');
      expect(name).not.toMatch(/approved|rejected/i);
    }
  });
});
