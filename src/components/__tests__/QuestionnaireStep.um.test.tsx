import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import QuestionnaireStep from '../QuestionnaireStep';
import { approvedModelOptionList } from '../plain-copy';
import { buildVerdictView } from '../verdict-view-model';
import { loadPolicy } from '../../store/policy';
import { evaluate } from '../../engine/evaluate';
import { buildGraphFromForm } from '../../engine/build-graph-from-form';
import type { DataFlowGraph, IntakeQuestion, PolicyFile } from '../../engine/types';
import { checkPolicyReferences } from '../../store/policy-references';
import type { Verdict } from '../../types/verdict';

// UNSIGNED-MODEL (owner-approved wording 2026-10-03): a model the firm lists
// but has not accepted says so on the button and the Recorded line, and its
// owed review names the right action. (R18-E: the review row went with the
// retired card review; TC-UM-02 and the review-row halves of TC-CR7-35b/c went with it.) REAL policy (BC-003).

const SUFFIX = ' — not yet accepted by your firm, so it gets an extra check';
const LOCAL_LABEL = 'A small open model running on your own computer' + SUFFIX;
const VENDOR_NAME = 'A licensed AI model from an outside company (example)';

const result = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
if (!result.valid) throw new Error('shipped policy invalid');
const policy: PolicyFile = result.policy;

const question: IntakeQuestion = { id: 'Q1', field: 'declared_model_id', node_id: 'n1', triggered_by: [], answer_type: 'text' };

function graphWith(modelId: string): DataFlowGraph {
  const g = buildGraphFromForm(
    {
      useCaseName: 'x', description: 'y', inputDataClass: 'Internal', inputDataZone: 'Zone B', modelType: 'llm',
      autonomyLevel: 1, processingDataZone: 'Zone B', outputActionType: 'recommend', outputExposure: 'internal-shared',
      decisionBindingness: 'advisory', outputReversibility: 'reversible', outputScale: 'limited',
      replacesPriorModel: false, jurisdictions: [],
    },
    '2026-01-01T00:00:00.000Z',
    () => 'id-1',
  );
  g.processing_nodes[0]!.declared_model_id = modelId;
  return g;
}

function owedNames(modelId: string, evalPolicy: PolicyFile = policy): string[] {
  const g = graphWith(modelId);
  const e = evaluate(g, evalPolicy);
  if (!e.ok) throw new Error('eval failed');
  const verdict = {
    ...e.value, id: 'v', use_case_id: 'uc', living_status: 'approved' as const,
    living_status_updated_at: '2026-01-01T00:00:00Z', attested_by: '1LoD', attested_at: '2026-01-01T00:00:00Z',
    graph_version: 1, corrections: [],
  } as Verdict;
  return buildVerdictView(verdict, policy, g, undefined, undefined, 'pre_checked').owedReviews.map((r) => r.plainName);
}

describe('UNSIGNED-MODEL', () => {
  it('TC-UM-01: qwen3:4b button and Recorded line carry the suffix; VENDOR-LLM-v1 does not', () => {
    const { rerender } = render(<QuestionnaireStep questions={[question]} answeredCount={0} onAnswer={vi.fn()} policy={policy} />);
    expect(screen.getByRole('button', { name: LOCAL_LABEL })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: VENDOR_NAME })).toBeInTheDocument();
    rerender(
      <QuestionnaireStep
        questions={[question, { ...question, id: 'Q2', field: 'data_class', answer_type: 'select' }]}
        answeredCount={1}
        lastAnswer={{ questionId: 'Q1', value: 'qwen3:4b' }}
        onAnswer={vi.fn()}
        policy={policy}
      />,
    );
    expect(screen.getByText(/^recorded:/i).closest('p')).toHaveTextContent(LOCAL_LABEL);
    rerender(
      <QuestionnaireStep
        questions={[question, { ...question, id: 'Q2', field: 'data_class', answer_type: 'select' }]}
        answeredCount={1}
        lastAnswer={{ questionId: 'Q1', value: 'VENDOR-LLM-v1' }}
        onAnswer={vi.fn()}
        policy={policy}
      />,
    );
    const rec = screen.getByText(/^recorded:/i).closest('p')!;
    expect(rec).toHaveTextContent(VENDOR_NAME);
    expect(rec).not.toHaveTextContent('not yet accepted');
  });

  it('TC-UM-03: a real evaluate() of a case declaring qwen3:4b owes "your AI risk team accepting this model", never "adding the model"', () => {
    const names = owedNames('qwen3:4b');
    expect(names).toContain('your AI risk team accepting this model');
    expect(names.join(' | ')).not.toContain("adding the model to your firm's list");
  });

  it('TC-UM-04: a model id not in the policy still owes "adding the model to your firm\'s list of known models"', () => {
    const names = owedNames('some-new-model-7');
    expect(names).toContain("adding the model to your firm's list of known models");
    expect(names.join(' | ')).not.toContain('accepting this model');
  });

  // UNSIGNED-MODEL review, Important: the engine also owes MODEL-REGISTRY
  // for a model matched by a FAMILY entry that is not (or no longer)
  // accepted — e.g. gpt-4o-family after its reattest_by date, which
  // IntakeFlow applies before evaluate() while the screen reads the policy
  // as written. That model IS on the firm's list.
  it('TC-UM-06: a family-matched model whose family is not accepted owes "accepting", never "adding … to your firm\'s list"', () => {
    const lapsed: PolicyFile = {
      ...policy,
      approved_models: (policy.approved_models ?? []).map((m) => (m.is_family ? { ...m, is_approved: false } : m)),
    };
    const names = owedNames('gpt-4o-2026-08-01', lapsed);
    expect(names).toContain('your AI risk team accepting this model');
    expect(names.join(' | ')).not.toContain("adding the model to your firm's list");
  });

  it('TC-UM-07: an older case still owing the review keeps "accepting" after the firm later accepts the model', () => {
    const later: PolicyFile = {
      ...policy,
      approved_models: (policy.approved_models ?? []).map((m) => (m.model_id === 'qwen3:4b' ? { ...m, is_approved: true } : m)),
    };
    const g = graphWith('qwen3:4b');
    const e = evaluate(g, policy);
    if (!e.ok) throw new Error('eval failed');
    const verdict = {
      ...e.value, id: 'v', use_case_id: 'uc', living_status: 'approved' as const,
      living_status_updated_at: '2026-01-01T00:00:00Z', attested_by: '1LoD', attested_at: '2026-01-01T00:00:00Z',
      graph_version: 1, corrections: [],
    } as Verdict;
    const names = buildVerdictView(verdict, later, g, undefined, undefined, 'pre_checked').owedReviews.map((r) => r.plainName);
    expect(names).toContain('your AI risk team accepting this model');
  });

  it('TC-UM-05: the new strings contain neither "approved" nor "rejected"', () => {
    expect(SUFFIX).not.toMatch(/approved|rejected/i);
    expect(owedNames('qwen3:4b').join(' ')).not.toMatch(/approved|rejected/i);
  });
});

// Code review 007 — CR7-35: a listed model with no plain_name never shows its
// raw id; a typed id the policy does not list is shown as written.
function withoutPlainNames(): PolicyFile {
  return {
    ...policy,
    approved_models: (policy.approved_models ?? []).map((m) => {
      if (m.is_family) return m;
      const { plain_name: _drop, ...rest } = m;
      return rest as typeof m;
    }),
  };
}

describe('CR7-35 — unnamed models', () => {
  it('TC-CR7-35a: the reference check warns (never errors) for each non-family model with no plain_name, naming it; the real policy gives none', () => {
    const bad = checkPolicyReferences(withoutPlainNames());
    expect(bad.errors.filter((e) => /plain_name/.test(e) && /qwen3:4b/.test(e))).toEqual([]);
    expect(bad.warnings.some((w) => w.includes('qwen3:4b') && /plain_name/.test(w))).toBe(true);
    expect(bad.warnings.some((w) => w.includes('VENDOR-LLM-v1') && /plain_name/.test(w))).toBe(true);
    const real = checkPolicyReferences(policy);
    expect(real.warnings.filter((w) => /approved_models|model .*plain_name/i.test(w))).toEqual([]);
    // Pass 2: a blank plain_name counts as none here too (the label already
    // treats it so, TC-CR7-35d) — removing the .trim() must fail this.
    const blank = checkPolicyReferences({
      ...policy,
      approved_models: (policy.approved_models ?? []).map((m) => (m.model_id === 'qwen3:4b' ? { ...m, plain_name: '   ' } : m)),
    });
    expect(blank.warnings.some((w) => w.includes('qwen3:4b') && /plain_name/.test(w))).toBe(true);
  });

  it('TC-CR7-35b: with no plain_name, button and Recorded line show "Model n" (list order), keeping the suffix when not accepted; never the raw id', () => {
    const p = withoutPlainNames();
    const models = p.approved_models!.filter((m) => !m.is_family);
    const labelOf = (id: string) => {
      const i = models.findIndex((m) => m.model_id === id);
      return `Model ${i + 1}` + (models[i]!.is_approved === false ? SUFFIX : '');
    };
    const { rerender, unmount } = render(<QuestionnaireStep questions={[question]} answeredCount={0} onAnswer={vi.fn()} policy={p} />);
    for (const m of models) {
      expect(screen.getByRole('button', { name: labelOf(m.model_id) })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: new RegExp(m.model_id) })).not.toBeInTheDocument();
    }
    rerender(
      <QuestionnaireStep
        questions={[question, { ...question, id: 'Q2', field: 'data_class', answer_type: 'select' }]}
        answeredCount={1}
        lastAnswer={{ questionId: 'Q1', value: 'qwen3:4b' }}
        onAnswer={vi.fn()}
        policy={p}
      />,
    );
    const rec = screen.getByText(/^recorded:/i).closest('p')!;
    expect(rec).toHaveTextContent(labelOf('qwen3:4b'));
    expect(rec).not.toHaveTextContent('qwen3');
    unmount();
  });

  it('TC-CR7-35c: a declared model id not on the list is shown as written on the Recorded line', () => {
    const { rerender, unmount } = render(
      <QuestionnaireStep
        questions={[question, { ...question, id: 'Q2', field: 'data_class', answer_type: 'select' }]}
        answeredCount={1}
        lastAnswer={{ questionId: 'Q1', value: 'some-new-model-7' }}
        onAnswer={vi.fn()}
        policy={policy}
      />,
    );
    expect(screen.getByText(/^recorded:/i).closest('p')).toHaveTextContent('some-new-model-7');
    rerender(<div />);
    unmount();
  });
});

describe('UNSIGNED-MODEL — mixed and blank names', () => {
  it('TC-CR7-35d: in a mixed list (named, unnamed, blank-named) only the unnamed are numbered, in order, and a blank name is treated as unnamed', () => {
    const opts = approvedModelOptionList([
      { model_id: 'a', plain_name: 'Alpha model', is_approved: true },
      { model_id: 'b', is_approved: true },
      { model_id: 'c', plain_name: '   ', is_approved: true },
    ]);
    expect(opts.map((o) => o.label)).toEqual(['Alpha model', 'Model 1', 'Model 2']);
  });
});
