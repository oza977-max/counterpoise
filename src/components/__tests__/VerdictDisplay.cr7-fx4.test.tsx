import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../../store/policy';
import { evaluate } from '../../engine/evaluate';
import { buildGraphFromForm } from '../../engine/build-graph-from-form';
import VerdictDisplay from '../VerdictDisplay';
import type { DataFlowGraph, PolicyFile } from '../../engine/types';
import type { Verdict } from '../../types/verdict';
import type { AuditEvent } from '../../store/types';

// FX7-4 / code review 007 — what the verdict screen renders. Real shipped
// policy, real evaluate() output (BC-003). BC-005 tests render the state in
// which the claim would be FALSE and assert it is absent.
function realPolicy(): PolicyFile {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('bad policy');
  return r.policy;
}

function graphFor(platform: string | undefined, vendor: string | undefined, inputDataClass: 'Internal' | 'Confidential' = 'Internal'): DataFlowGraph {
  const g = buildGraphFromForm(
    {
      useCaseName: 'x', description: 'y', inputDataClass, inputDataZone: 'Zone B', modelType: 'ml',
      autonomyLevel: 1, processingDataZone: 'Zone B', outputActionType: 'recommend', outputExposure: 'internal-shared',
      decisionBindingness: 'advisory', outputReversibility: 'reversible', outputScale: 'limited',
      replacesPriorModel: false, jurisdictions: [],
    },
    '2026-01-01T00:00:00.000Z',
    () => crypto.randomUUID(),
  );
  if (platform) g.processing_nodes[0]!.platform = platform;
  if (vendor) g.processing_nodes[0]!.vendor = vendor;
  return g;
}

function verdictFrom(g: DataFlowGraph, policy: PolicyFile, over: Partial<Verdict> = {}): Verdict {
  const e = evaluate(g, policy);
  if (!e.ok) throw new Error('eval failed');
  return {
    ...e.value, id: 'v1', use_case_id: 'uc', living_status: 'approved' as const,
    living_status_updated_at: '2026-01-01T00:00:00Z', attested_by: '1LoD', attested_at: '2026-01-01T00:00:00Z',
    graph_version: 1, corrections: [], ...over,
  } as Verdict;
}

function approval(verdictId: string, action: 'approved' | 'correction_requested' = 'approved'): AuditEvent {
  return {
    event_id: crypto.randomUUID(), use_case_id: 'uc', event_type: 'twoloD_reviewed',
    occurred_at: '2026-01-02T00:00:00.000Z', actor: '2LoD',
    payload: { type: 'twoloD_reviewed', action, verdict_id: verdictId, attested_by_name: 'R' },
    prev_hash: null, hash: 'h',
  } as unknown as AuditEvent;
}

const SELF_SERVICE = /nobody —|no sign-off needed|self-service/i;

describe('VerdictDisplay — CR7-09: the sign-off wording follows the case, not the stage', () => {
  const policy = realPolicy();

  it('TC-CR7-09f: a signed-off Track II case (stage approved) says it was signed off and never "self-service" / "nobody"', () => {
    const verdict = verdictFrom(graphFor(undefined, undefined), policy, { tier: 'High' });
    const { container } = render(
      <VerdictDisplay verdict={verdict} auditEvents={[approval('v1')]} policy={policy} registerStage="approved" onCorrect={vi.fn()} />,
    );
    expect(container.textContent).toMatch(/signed off by your AI risk team/i);
    expect(container.textContent).not.toMatch(SELF_SERVICE);
    expect(container.querySelector('.verdict__stage-note')!.textContent).toMatch(/signed off/i);
  });

  it('TC-CR7-09g: a genuine self-service case (Low tier, stage approved) keeps its self-service wording', () => {
    const verdict = verdictFrom(graphFor(undefined, undefined), policy, { tier: 'Low' });
    const { container } = render(
      <VerdictDisplay verdict={verdict} auditEvents={[]} policy={policy} registerStage="approved" onCorrect={vi.fn()} />,
    );
    expect(container.querySelector('.verdict__stage-note')!.textContent).toMatch(/self-service/i);
    expect(container.textContent).not.toMatch(/signed off by your AI risk team/i);
  });

  it('TC-CR7-09h: stage approved for a case that needed a sign-off but has no approving review on this verdict — no "self-service" and no "signed off by"', () => {
    const verdict = verdictFrom(graphFor(undefined, undefined), policy, { tier: 'High' });
    const { container } = render(
      <VerdictDisplay verdict={verdict} auditEvents={[approval('v1', 'correction_requested'), approval('some-older-verdict')]} policy={policy} registerStage="approved" onCorrect={vi.fn()} />,
    );
    expect(container.querySelector('.verdict__stage-note')!.textContent).not.toMatch(SELF_SERVICE);
    expect(container.textContent).not.toMatch(/signed off by your AI risk team/i);
    expect(container.textContent).not.toMatch(/nobody —|no sign-off needed/i);
    // M-1: the headline must not claim the sign-off is still pending either.
    expect(container.querySelector('.verdict__first-headline')!.textContent ?? '').not.toMatch(/Not yet|signed it off/);
    expect(container.textContent).not.toMatch(/Until they do/);
    expect(container.querySelector('.verdict__first-headline')!.textContent).not.toMatch(/you can start/i);
    expect(container.querySelector('.verdict__first-headline')!.textContent).toMatch(/No sign-off from your AI risk team is on record/);
  });
});

describe('VerdictDisplay — CR7-14: a supplier id never reaches the screen raw', () => {
  const policy = realPolicy();

  for (const [name, withGraph] of [['with the graph', true], ['register path (no graph)', false]] as const) {
    it(`TC-CR7-14-${withGraph ? 1 : 2}: firm-account case ${name} shows the plain names, not VENDOR-APPROVED-LLM / PLAT-CLOUD-LLM, and one approved/rejected match only`, () => {
      const g = graphFor('PLAT-CLOUD-LLM', 'VENDOR-APPROVED-LLM');
      const verdict = verdictFrom(g, policy);
      const { container } = render(
        <VerdictDisplay verdict={verdict} auditEvents={[]} policy={policy} graph={withGraph ? g : undefined} onCorrect={vi.fn()} />,
      );
      expect(verdict.inheritance?.declared_vendor).toBe('VENDOR-APPROVED-LLM');
      expect(container.textContent).not.toContain('VENDOR-APPROVED-LLM');
      expect(container.textContent).not.toContain('PLAT-CLOUD-LLM');
      expect(container.textContent).toContain("Your firm's company AI assistant account");
      expect(screen.getAllByText(/approved|rejected/i)).toHaveLength(1);
    });
  }
});

describe('VerdictDisplay — CR7-40: evidence typed into the policy file is not "machine-verified"', () => {
  it('TC-CR7-40: the sign-off checklist says "marked verified in your firm\'s policy file"', () => {
    const policy = realPolicy();
    const g = graphFor('PLAT-CLOUD-LLM', 'VENDOR-APPROVED-LLM', 'Confidential');
    const verdict = verdictFrom(g, policy, { tier: 'High' });
    expect(verdict.controls.length).toBeGreaterThan(0);
    const { container } = render(
      <VerdictDisplay verdict={verdict} auditEvents={[]} policy={policy} graph={g} registerStage="pre_checked" showSignOffChecklist />,
    );
    const checklist = container.querySelector('.verdict__signoff-checklist')!;
    expect(checklist.textContent).not.toMatch(/machine-verified/i);
    expect(checklist.textContent).toMatch(/marked verified in your firm.s policy file/);
  });
});

describe('VerdictDisplay — CR7-11 / CR9-04: the no-model-recorded line', () => {
  const policy = realPolicy();
  const LINE = 'No AI model is recorded for this use case — your AI risk team may ask which one it uses.';

  it('TC-CR7-11a: shown in the reviewer section when no processing node names a model', () => {
    const g = graphFor(undefined, undefined);
    expect(g.processing_nodes.some((n) => n.declared_model_id)).toBe(false);
    const verdict = verdictFrom(g, policy);
    const { container } = render(<VerdictDisplay verdict={verdict} auditEvents={[]} policy={policy} graph={g} reasoningDefaultOpen />);
    expect(container.querySelector('.verdict__reviewer-body')!.textContent).toContain(LINE);
  });

  it('TC-CR9-04: an in-house form case with no model renders the neutral sentence and never the old "No model was named"', () => {
    const g = graphFor(undefined, undefined);
    const verdict = verdictFrom(g, policy);
    const { container } = render(<VerdictDisplay verdict={verdict} auditEvents={[]} policy={policy} graph={g} reasoningDefaultOpen />);
    expect(container.textContent).toContain(LINE);
    expect(container.textContent).not.toContain('No model was named');
    expect(container.textContent).not.toMatch(/was named/i);
  });

  it('TC-CR7-11b: absent when a model is named (BC-005 false case)', () => {
    const g = graphFor(undefined, undefined);
    g.processing_nodes[0]!.declared_model_id = 'qwen3:4b';
    const verdict = verdictFrom(g, policy);
    const { container } = render(<VerdictDisplay verdict={verdict} auditEvents={[]} policy={policy} graph={g} reasoningDefaultOpen />);
    expect(container.textContent).not.toContain(LINE);
    expect(container.querySelector('.verdict__no-model-named')).toBeNull();
  });

  it('TC-CR7-11c: absent when there is no graph to read (the register path cannot say none was named)', () => {
    const g = graphFor(undefined, undefined);
    const verdict = verdictFrom(g, policy);
    const { container } = render(<VerdictDisplay verdict={verdict} auditEvents={[]} policy={policy} reasoningDefaultOpen />);
    expect(container.textContent).not.toContain(LINE);
    expect(container.querySelector('.verdict__no-model-named')).toBeNull();
  });
});

describe('VerdictDisplay — CR7-39: a review-overdue source shows on the first screen', () => {
  it('TC-CR7-39-2: "Could still change" carries the overdue line when stale_sources is set, and not when it is empty', () => {
    const policy = realPolicy();
    const g = graphFor(undefined, undefined);
    const stale = verdictFrom(g, policy, { pack_versions: { 'EU-PACK': '1' }, stale_sources: [{ pack_id: 'EU-PACK', retrieved_date: '2026-01-01', days_overdue: 3, max_staleness_days: 90 }] } as Partial<Verdict>);
    const a = render(<VerdictDisplay verdict={stale} auditEvents={[]} policy={policy} graph={g} />);
    expect(a.container.querySelector('.verdict__first-could-change')!.textContent).toMatch(/overdue/i);
    a.unmount();
    const fresh = verdictFrom(g, policy);
    const b = render(<VerdictDisplay verdict={fresh} auditEvents={[]} policy={policy} graph={g} />);
    expect(b.container.querySelector('.verdict__first-could-change')?.textContent ?? '').not.toMatch(/overdue/i);
  });
});

describe('VerdictDisplay — M-3 (review pass 1): the reviewer section names a model by its plain name', () => {
  it('TC-CR7-35e: the model-governance review line reads with the plain name; the raw id appears only inside a quiet <code>', () => {
    const policy = realPolicy();
    const g = graphFor(undefined, undefined);
    g.processing_nodes[0]!.declared_model_id = 'qwen3:4b';
    const verdict = verdictFrom(g, policy, { tier: 'High' });
    expect(verdict.downstream_review_sources?.some((x) => x.rule_id === 'MODEL-REGISTRY:qwen3:4b')).toBe(true);
    const { container } = render(<VerdictDisplay verdict={verdict} auditEvents={[]} policy={policy} graph={g} reasoningDefaultOpen />);
    const plain = 'A small open model running on your own computer';
    const body = container.querySelector('.verdict__reviewer-body')!;
    // every place the review sentence is printed carries the plain name
    expect(body.textContent).toContain(`Model governance review required — ${plain}`);
    // strip every <code> and the raw id must be gone from the prose
    const clone = body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('code').forEach((c) => c.remove());
    expect(clone.textContent).not.toContain('qwen3:4b');
    expect(container.querySelector('.verdict__downstream-sources code')!.className).toContain('verdict__id-quiet');
  });

  it('TC-CR7-35e-1: a model the policy does not list is shown as written (nothing to translate)', () => {
    const policy = realPolicy();
    const g = graphFor(undefined, undefined);
    g.processing_nodes[0]!.declared_model_id = 'my-typed-model';
    const verdict = verdictFrom(g, policy, { tier: 'High' });
    const { container } = render(<VerdictDisplay verdict={verdict} auditEvents={[]} policy={policy} graph={g} reasoningDefaultOpen />);
    expect(container.querySelector('.verdict__reviewer-body')!.textContent).toContain('Model governance review required — my-typed-model');
  });
});
