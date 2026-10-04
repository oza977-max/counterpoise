import { describe, it, expect, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../../store/policy';
import { evaluate } from '../../engine/evaluate';
import { routeToWorkflow } from '../../engine/workflow-router';
import { addNode } from '../../store/register';
import { append } from '../../store/audit';
import { seedAigateSelfAssessment, AIGATE_USE_CASE_ID } from '../../seeds/aigate-self-assessment';
import RegisterDetail from '../RegisterDetail';
import RegisterView from '../RegisterView';
import VerdictDisplay from '../VerdictDisplay';
import type { DataFlowGraph, JurisdictionPack, PackRule, PolicyFile } from '../../engine/types';
import type { Verdict } from '../../types/verdict';
import type { RegisterNode } from '../../store/types';

// gvm-test 007 close-out, chunk 0 (UI half). Real engine, real shipped policy,
// real store on the suite's fake IndexedDB, real components. Nothing here is
// mocked. Each test names the original acceptance case it proves.

function realPolicy(): PolicyFile {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('shipped policy invalid');
  return r.policy;
}

function graph(over: Partial<DataFlowGraph> = {}): DataFlowGraph {
  return {
    id: 'g1',
    version: 1,
    input_nodes: [{ id: 'i1', label: 'in', data_class: 'Internal', data_zone: 'Zone C' }],
    processing_nodes: [
      { id: 'p1', label: 'model', model_type: 'traditional-ml', autonomy_level: 0, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
    ],
    output_nodes: [
      { id: 'o1', label: 'out', action_type: 'recommend', exposure: 'internal-only', decision_bindingness: 'non-binding', output_reversibility: 'reversible', scale: 'limited' },
    ],
    edges: [],
    jurisdictions: [],
    intake_method: 'structured_form',
    extracted_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function verdictFrom(g: DataFlowGraph, policy: PolicyFile, packs: JurisdictionPack[] = [], over: Partial<Verdict> = {}): Verdict {
  const e = evaluate(g, policy, packs);
  if (!e.ok) throw new Error('eval failed');
  return {
    ...e.value,
    id: 'v1',
    use_case_id: 'uc',
    living_status: 'approved' as const,
    living_status_updated_at: '2026-01-01T00:00:00Z',
    attested_by: '1LoD',
    attested_at: '2026-01-01T00:00:00Z',
    graph_version: 1,
    corrections: [],
    ...over,
  } as Verdict;
}

describe('TC-LC-2-01: a Low-tier use case is self-service — final on submitter confirmation, no 2LoD gate', () => {
  it('the router sends Low straight to approved with no 2LoD action; the verdict screen then reads self-service final, with no pending sign-off', () => {
    const policy = realPolicy();
    const verdict = verdictFrom(graph(), policy);
    expect(verdict.tier).toBe('Low');

    const route = routeToWorkflow('Low', policy);
    expect(route.lifecycle_stage).toBe('approved');
    expect(route.requires_twoLoD_action).toBe(false);

    const { container, unmount } = render(
      <VerdictDisplay verdict={verdict} auditEvents={[]} policy={policy} registerStage="approved" onCorrect={vi.fn()} />,
    );
    // The status the case calls "Approved" and the path it calls "self-service — Low tier",
    // in the words the screen uses (stage note + first-screen answer; the reserved words are
    // avoided on purpose, BC-V12B-03).
    expect(container.querySelector('.verdict__stage-note')!.textContent).toMatch(/self-service final/i);
    expect(container.querySelector('.verdict__first-screen')!.textContent).toMatch(/you can start/i);
    // MUST NOT: a pending 2LoD gate for a Low-tier use case.
    expect(container.textContent).not.toMatch(/awaiting active 2LoD sign-off|not final until a second-line reviewer/i);
    unmount();

    // Contrast: the same screen for a tier that DOES need sign-off says so — so the absence
    // above is the router's doing, not a screen that never shows a gate.
    const medium = verdictFrom(
      graph({ output_nodes: [{ ...graph().output_nodes[0]!, decision_bindingness: 'material' }] }),
      policy,
    );
    expect(medium.tier).toBe('Medium');
    expect(routeToWorkflow('Medium', policy).lifecycle_stage).toBe('pre_checked');
    const gated = render(
      <VerdictDisplay verdict={medium} auditEvents={[]} policy={policy} registerStage="pre_checked" onCorrect={vi.fn()} />,
    );
    expect(gated.container.querySelector('.verdict__stage-note')!.textContent).toMatch(/awaiting active 2LoD sign-off/i);
  });
});

describe('TC-CS-3-01: the downstream review reaches the verdict screen as a required step, with the rule that triggered it', () => {
  it('an MNPI use case lists the information security review, "required by" its policy rule, with nothing optional about it', () => {
    const policy = realPolicy();
    const g = graph({
      input_nodes: [{ id: 'i1', label: 'deal notes', data_class: 'MNPI', data_zone: 'Zone C' }],
      processing_nodes: [{ ...graph().processing_nodes[0]!, autonomy_level: 2 }],
    });
    const verdict = verdictFrom(g, policy);
    expect(verdict.status).not.toBe('rejected');
    const { container } = render(<VerdictDisplay verdict={verdict} auditEvents={[]} policy={policy} onCorrect={vi.fn()} />);
    const block = container.querySelector('.verdict__downstream')!;
    expect(block).not.toBeNull();
    expect(block.textContent).toMatch(/Downstream reviews:.*Information security review/);
    expect(block.querySelector('.verdict__downstream-sources')!.textContent).toMatch(/Information security review — required by\s*DR-INFOSEC-01/);
    expect(block.textContent).not.toMatch(/optional|advisory|if you wish/i);
  });
});

function makePack(rules: PackRule[], over: Partial<JurisdictionPack> = {}): JurisdictionPack {
  return {
    pack_id: 'SS1-23',
    version: '1.0',
    jurisdiction: 'UK',
    regulator: 'PRA',
    document: 'PRA SS1/23',
    effective_date: '2024-05-17',
    reviewer_name: 'A. Counsel',
    reviewer_role: 'Head of Compliance',
    sign_off_date: '2026-03-01',
    rules,
    ...over,
  };
}
const ukRule = (over: Partial<PackRule> = {}): PackRule => ({
  id: 'PE-JUR-UK-3',
  title: 'Independent validation',
  source: { document: 'PRA SS1/23', section: 'Principle 3', text: 'Models should be independently validated before use.' },
  effect: { type: 'required_review', review: 'Independent model validation (2LoD)' },
  condition: {},
  basis: 'verbatim',
  reviewer_name: '[FIRM] — Legal/Compliance',
  reviewer_role: 'Head of Compliance',
  sign_off_date: '[DATE]',
  ...over,
});

describe('TC-NF-7-01: a verdict decided by a pack rule nobody has signed off is Provisional, and says which rule', () => {
  const ukGraph = () => graph({ jurisdictions: ['UK'] });

  it('unsigned rule: the verdict is Provisional, the banner says review is required, and the chain names the rule as pending sign-off', () => {
    const policy = realPolicy();
    const unsigned = makePack([ukRule()], { reviewer_name: '[FIRM] — Legal/Compliance', sign_off_date: '[DATE]' });
    const verdict = verdictFrom(ukGraph(), policy, [unsigned]);

    // Engine: the cause is recorded and the rule is named.
    expect(verdict.provisional_reasons).toContain('unsigned_pack_rules');
    expect(verdict.confidence_caveats.some((c) => c.ruleId === 'PE-JUR-UK-3' && c.confidence === 'low')).toBe(true);
    expect(verdict.explanation.regulatory_chain?.find((e) => e.rule_id === 'PE-JUR-UK-3')?.sign_off).toMatch(/pending firm adoption/i);

    // Screen: not presented as final.
    const { container } = render(
      <VerdictDisplay verdict={verdict} auditEvents={[]} policy={policy} onCorrect={vi.fn()} reasoningDefaultOpen />,
    );
    const banner = container.querySelector('.verdict__provisional-banner')!;
    expect(banner.textContent).toMatch(/Provisional — review required before this is final/);
    expect(banner.textContent).toMatch(/not yet adopted/i);
    expect(container.querySelector('.verdict__heading')!.textContent).toMatch(/Provisional/);
    // The specific unsigned rule id, beside its sign-off line.
    const entry = [...container.querySelectorAll('.verdict__chain-entry')].find((e) => e.textContent!.includes('PE-JUR-UK-3'))!;
    expect(entry.querySelector('.verdict__chain-signoff')!.textContent).toMatch(/pending firm adoption/i);
  });

  it('the same rule once signed off: the verdict is not marked Provisional on that account', () => {
    const policy = realPolicy();
    const signed = makePack([ukRule({ reviewer_name: 'A. Counsel', sign_off_date: '2026-03-01' })]);
    const verdict = verdictFrom(ukGraph(), policy, [signed]);
    expect(verdict.provisional_reasons).not.toContain('unsigned_pack_rules');
    const { container } = render(<VerdictDisplay verdict={verdict} auditEvents={[]} policy={policy} onCorrect={vi.fn()} />);
    expect(container.querySelector('.verdict__provisional-banner')).toBeNull();
  });
});

describe('TC-NF-2-01: nothing on the screen can edit or delete an audit record', () => {
  async function seedFive(id: string, verdict: Verdict) {
    const node: RegisterNode = {
      node_id: id,
      node_type: 'use_case',
      label: 'Audit probe case',
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: { node_type: 'use_case', submitted_by: '1LoD', lifecycle_stage: 'pre_checked', current_verdict_id: null, tier: 'High', track: 'II' },
    };
    await addNode(node);
    const ev = (n: number, type: string, actor: string, payload: unknown) =>
      append({
        event_id: crypto.randomUUID(),
        use_case_id: id,
        event_type: type as never,
        occurred_at: `2026-01-0${n}T00:00:00.000Z`,
        actor,
        payload: payload as never,
      });
    await ev(1, 'use_case_created', '1LoD', { type: 'use_case_created', description: 'Drafts client emails.', intake_method: 'structured_form' });
    await ev(2, 'graph_corrected', '1LoD', {
      type: 'graph_corrected',
      correction: { correction_id: 'c1', node_id: 'p1', graph_version_before: 1, graph_version_after: 2, field: 'data_zone', original_value: 'Zone C', corrected_value: 'Zone B', corrected_by: '1LoD', corrected_at: '2026-01-02T00:00:00.000Z' },
    });
    await ev(3, 'verdict_produced', '1LoD', { type: 'verdict_produced', verdict });
    await ev(4, 'twoloD_reviewed', '2LoD', { type: 'twoloD_reviewed', action: 'correction_requested', verdict_id: verdict.id, attested_by_name: 'R. Reviewer' });
    await ev(5, 'lifecycle_stage_changed', '2LoD', { type: 'lifecycle_stage_changed', from_stage: 'idea', to_stage: 'pre_checked' });
  }

  it.each(['1LoD', '2LoD'] as const)('%s: five audit records render read-only — no edit, delete or modify control, on the records or anywhere beside them', async (role) => {
    const policy = realPolicy();
    const id = crypto.randomUUID();
    const verdict = verdictFrom(graph(), policy, [], { id: crypto.randomUUID(), use_case_id: id });
    await seedFive(id, verdict);
    const { container } = render(
      <StrictMode>
        <RegisterDetail useCaseId={id} role={role} policy={policy} onBack={vi.fn()} />
      </StrictMode>,
    );
    await screen.findByText(/audit trail · append-only/i);
    const rows = await vi.waitFor(() => {
      const r = container.querySelectorAll('.timeline__row');
      expect(r.length).toBe(5);
      return r;
    });
    expect(rows).toHaveLength(5);
    // No interactive element of any kind inside the trail.
    const trail = container.querySelector('.register-detail__timeline') as HTMLElement;
    expect(within(trail).queryAllByRole('button')).toHaveLength(0);
    expect(within(trail).queryAllByRole('link')).toHaveLength(0);
    expect(within(trail).queryAllByRole('textbox')).toHaveLength(0);
    // And no control anywhere on the page that offers to change the record.
    expect(screen.queryByRole('button', { name: /delete|edit|modify|remove|erase/i })).toBeNull();
    // What is there is the read-only record: all five events, in order.
    expect([...rows].map((r) => r.querySelector('.timeline__type')!.textContent)).toEqual([
      'use_case_created',
      'graph_corrected',
      'verdict_produced',
      'twoloD_reviewed',
      'lifecycle_stage_changed',
    ]);
  });
});

describe('TC-LC-4-02: the Counterpoise self-assessment is on the register with tier, track and a verdict', () => {
  it('a 2LoD user sees the row, with tier, track and status all populated (not blank)', async () => {
    await seedAigateSelfAssessment(realPolicy());
    const user = userEvent.setup({ delay: null });
    render(<RegisterView role="2LoD" currentPolicyVersion="1.0" selectedId={null} onSelectRow={vi.fn()} onCloseDetail={vi.fn()} />);
    // The default 2LoD view may only list cases awaiting sign-off; widen it if needed.
    let row = (await screen.findAllByRole('row')).find((r) => within(r).queryByText('self-assessment'));
    if (!row) {
      await user.click(await screen.findByRole('button', { name: /show all/i }));
      row = (await screen.findAllByRole('row')).find((r) => within(r).queryByText('self-assessment'));
    }
    expect(row).toBeDefined();
    const cells = within(row!).getAllByRole('cell').map((c) => c.textContent ?? '');
    // columns for 2LoD: name, submitter, tier, track, status, stage, ...
    expect(cells[0]).toMatch(/Counterpoise/);
    expect(cells[2]).toMatch(/^(Low|Medium|High|Critical)$/);
    expect(cells[3]).toMatch(/^(I|II|III)$/);
    expect(cells[4]).toMatch(/approved|declined|outside|controls|in appetite/i);
    expect(AIGATE_USE_CASE_ID).toBeTruthy();
  });
});
