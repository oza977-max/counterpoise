import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState, type ComponentProps } from 'react';
import { load, dump } from 'js-yaml';
import App from '../../App';
import RegisterView from '../RegisterView';
import VerdictDisplay from '../VerdictDisplay';
import { addNode } from '../../store/register';
import { loadPolicy } from '../../store/policy';
import { setCurrentPolicyYaml } from '../../store/policy-source';
import { evaluate } from '../../engine/evaluate';
import type { RegisterNode } from '../../store/types';
import type { Verdict } from '../../types/verdict';
import type { DataFlowGraph, PolicyFile, Tier } from '../../engine/types';

// gvm-test 007, first-round acceptance close-out, chunk 2 — the cases that are about
// what a person sees. Real components; the model SDK is the only thing mocked, and
// only so the app can mount without a key.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));

const POLICY_YAML = readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8');

function shippedPolicy(): PolicyFile {
  const res = loadPolicy(POLICY_YAML);
  if (!res.valid) throw new Error('shipped policy invalid');
  return res.policy;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// TC-RG-3-01

function RegisterHarness(props: Omit<ComponentProps<typeof RegisterView>, 'selectedId' | 'onSelectRow' | 'onCloseDetail'>) {
  const [sel, setSel] = useState<string | null>(null);
  return <RegisterView {...props} selectedId={sel} onSelectRow={setSel} onCloseDetail={() => setSel(null)} />;
}

function tierNode(tier: Tier, n: number): RegisterNode {
  return {
    node_id: crypto.randomUUID(),
    node_type: 'use_case',
    label: `Tier-${tier}-case-${n}`,
    created_at: new Date().toISOString(),
    metadata: {
      node_type: 'use_case',
      submitted_by: '1LoD',
      lifecycle_stage: 'pre_checked',
      current_verdict_id: null,
      tier,
      track: 'II',
    },
  };
}

describe('register filter by tier', () => {
  it('TC-RG-3-01: with 5 Critical, 8 High, 12 Medium and 20 Low cases, filtering to Critical shows exactly the 5 Critical ones', async () => {
    const counts: Array<[Tier, number]> = [['Critical', 5], ['High', 8], ['Medium', 12], ['Low', 20]];
    for (const [tier, n] of counts) {
      for (let i = 1; i <= n; i++) await addNode(tierNode(tier, i));
    }
    const user = userEvent.setup();
    render(<RegisterHarness role="2LoD" currentPolicyVersion="1.0" />);

    // Unfiltered: all 45 are there.
    await screen.findByText('Tier-Critical-case-1');
    expect(screen.getAllByText(/^Tier-(Critical|High|Medium|Low)-case-\d+$/)).toHaveLength(45);

    await user.click(screen.getByRole('button', { name: /^Critical$/i }));

    const shown = screen.getAllByText(/^Tier-(Critical|High|Medium|Low)-case-\d+$/).map((e) => e.textContent);
    expect(shown).toHaveLength(5);
    expect(shown.every((t) => t?.startsWith('Tier-Critical-case-'))).toBe(true);
    // No High, Medium or Low case in the filtered view.
    expect(screen.queryByText(/^Tier-(High|Medium|Low)-case-\d+$/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TC-UC-1-03

describe('intake: an empty description cannot be submitted', () => {
  it('TC-UC-1-03: Next stays disabled for an empty and for a spaces-only description, and pressing it does not advance to the next step', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const box = await screen.findByRole('textbox', { name: /what ai tool do you want to use/i });
    const next = screen.getByRole('button', { name: /^next/i });

    expect(next).toBeDisabled();
    await user.click(box);
    await user.paste('     ');
    expect(next).toBeDisabled();

    // The control is the block: clicking it does nothing, and the next step
    // (the duplicate check) never appears.
    await user.click(next);
    expect(screen.queryAllByText(/has this been checked before/i)).toHaveLength(0);
    expect(screen.getByRole('textbox', { name: /what ai tool do you want to use/i })).toBeInTheDocument();

    // Control: real text enables it, so the disabled state above is the blank's doing.
    await user.clear(box);
    await user.paste('A tool that drafts client emails');
    expect(screen.getByRole('button', { name: /^next/i })).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// TC-VD-2-01 and TC-RA-11-01 — fixtures

function verdictFrom(result: Omit<Verdict, 'id' | 'use_case_id' | 'living_status' | 'living_status_updated_at' | 'attested_by' | 'attested_at' | 'graph_version' | 'corrections'>): Verdict {
  return {
    ...result,
    id: 'verdict-closeout',
    use_case_id: 'uc-closeout',
    living_status: 'approved',
    living_status_updated_at: '2026-01-01T00:00:00.000Z',
    attested_by: '1LoD',
    attested_at: '2026-01-01T00:00:00.000Z',
    graph_version: 1,
    corrections: [],
  };
}

describe('verdict display: the rule and the path behind a decision', () => {
  it('TC-VD-2-01: a rejected MNPI case shows the rule id, the path through the graph and the plain-language reason', () => {
    const policy = shippedPolicy();
    const g: DataFlowGraph = {
      id: 'g-mnpi',
      version: 1,
      input_nodes: [{ id: 'i1', label: 'client_email_data', data_class: 'MNPI', data_zone: 'Zone A' }],
      processing_nodes: [
        {
          id: 'p1',
          label: 'external_model_zone_a',
          model_type: 'llm',
          autonomy_level: 1,
          data_zone: 'Zone A',
          vendor: 'third-party',
          replaces_prior_model: false,
        },
      ],
      output_nodes: [
        {
          id: 'o1',
          label: 'summary',
          action_type: 'draft',
          exposure: 'internal-only',
          decision_bindingness: 'advisory',
          output_reversibility: 'reversible',
          scale: 'limited',
        },
      ],
      edges: [
        { from: 'i1', to: 'p1' },
        { from: 'p1', to: 'o1' },
      ],
      jurisdictions: ['UK'],
      intake_method: 'structured_form',
      extracted_at: '2026-01-01T00:00:00.000Z',
    };
    const r = evaluate(g, policy, []);
    if (!r.ok) throw new Error('engine error');
    expect(r.value.binding_constraint).toBe('HL-002');

    render(<VerdictDisplay verdict={verdictFrom(r.value)} auditEvents={[]} policy={policy} graph={g} onCorrect={vi.fn()} reasoningDefaultOpen />);

    // The specific rule id...
    expect(screen.getAllByText('HL-002').length).toBeGreaterThan(0);
    // ...the specific graph path that tripped it...
    expect(screen.getAllByText(/client_email_data/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/external_model_zone_a/).length).toBeGreaterThan(0);
    // ...and a plain-language explanation, not a bare "policy violation".
    expect(screen.getAllByText(/MNPI outside Zone C violates market abuse prevention requirements\./).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^policy violation$/i)).not.toBeInTheDocument();
  });

  it('a controlled case names its binding rule id, what the rule says in words, and the path', () => {
    const policy = shippedPolicy();
    const description = policy.invariants.find((i) => i.id === 'INV-DATA-01')?.description;
    expect(description).toBeTruthy();
    const verdict = verdictFrom({
      status: 'approved_with_controls',
      tier: 'High',
      track: 'II',
      binding_constraint: 'INV-DATA-01',
      binding_path: 'client notes → drafting model → drafted email',
      controls: ['CTRL-ENC-01'],
      downstream_reviews: [],
      conditions: { hypotheses: [] },
      policy_version: policy.version,
      pack_versions: {},
      applied_overrides: [],
      confidence_caveats: [],
      provisional_reasons: [],
      boundary_proximity: false,
      margin_achieved: 0,
      margin_target: 0.1,
      single_covered_invariants: [],
      explanation: {
        tier_rationale: null,
        track_rationale: null,
        hard_lines_checked: 0,
        invariants_checked: 0,
        tripped_invariants: [],
        binding_reason: null,
        binding_regulatory_basis: null,
      },
    });
    render(<VerdictDisplay verdict={verdict} auditEvents={[]} policy={policy} onCorrect={vi.fn()} />);

    expect(screen.getAllByText('INV-DATA-01').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/client notes → drafting model → drafted email/).length).toBeGreaterThan(0);
    // The plain-language explanation is the policy's own wording for that rule.
    expect(screen.getAllByText(new RegExp(description!.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).length).toBeGreaterThan(0);
  });
});

describe('verdict display: a Medium-confidence rule is flagged', () => {
  const mediumVerdict = (): Verdict =>
    verdictFrom({
      status: 'approved_with_controls',
      tier: 'High',
      track: 'II',
      binding_constraint: 'INV-DATA-01',
      binding_path: 'client notes → drafting model → drafted email',
      controls: ['CTRL-ENC-01'],
      downstream_reviews: [],
      conditions: { hypotheses: [] },
      policy_version: '1.0',
      pack_versions: {},
      applied_overrides: [],
      confidence_caveats: [
        { ruleId: 'PE-JUR-EU-2', field: 'jurisdiction', reason: 'Interpretive judgment required.', confidence: 'medium' },
      ],
      provisional_reasons: [],
      boundary_proximity: false,
      margin_achieved: 0,
      margin_target: 0.1,
      single_covered_invariants: [],
      explanation: {
        tier_rationale: null,
        track_rationale: null,
        hard_lines_checked: 0,
        invariants_checked: 0,
        tripped_invariants: [],
        binding_reason: null,
        binding_regulatory_basis: null,
      },
    });

  it('TC-RA-11-01: the caveat names the rule id and its reason, tells the reader to check with compliance on the first screen, and the verdict is not marked provisional', () => {
    render(<VerdictDisplay verdict={mediumVerdict()} auditEvents={[]} onCorrect={vi.fn()} />);

    // Reviewer section: the rule id and the reason, in an alert.
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('PE-JUR-EU-2').tagName).toBe('CODE');
    expect(alert).toHaveTextContent(/interpretive judgment required/i);

    // First screen: plain words, naming the next step (check with compliance).
    expect(
      screen.getByText(/some rules it used are worded with less certainty than usual — check this result with your compliance team before relying on it/i),
    ).toBeInTheDocument();

    // A Medium caveat never makes a verdict provisional.
    expect(screen.queryByText(/provisional/i)).not.toBeInTheDocument();
  });

  it('a verdict with no Medium caveat shows neither the alert line nor the first-screen line (the caveat is not shown by default)', () => {
    const v = mediumVerdict();
    v.confidence_caveats = [];
    render(<VerdictDisplay verdict={v} auditEvents={[]} onCorrect={vi.fn()} />);
    expect(screen.queryByText(/less certainty than usual/i)).not.toBeInTheDocument();
    expect(screen.queryByText('PE-JUR-EU-2')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TC-NF-10-01

describe('header: translation fidelity label', () => {
  const today = () => new Date().toISOString().slice(0, 10);
  const withAttestation = (attestation: unknown): string => {
    const raw = load(POLICY_YAML) as Record<string, unknown>;
    if (attestation === undefined) delete raw.translation_attestation;
    else raw.translation_attestation = attestation;
    return dump(raw);
  };

  it('TC-NF-10-01: the shipped policy, whose attestation is still a placeholder, is labelled unattested, with the reason one click away', async () => {
    setCurrentPolicyYaml(POLICY_YAML);
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText(/translation fidelity: unattested/i)).toBeInTheDocument();
    expect(screen.queryByText(/translation fidelity: attested/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /details/i }));
    expect(screen.getByText(/authoring placeholder/i)).toBeInTheDocument();
  });

  it('a policy with no translation_attestation block at all is also labelled unattested, never as attested', async () => {
    const yaml = withAttestation(undefined);
    expect(loadPolicy(yaml).valid).toBe(false);
    setCurrentPolicyYaml(yaml);
    render(<App />);

    expect(await screen.findByText(/translation fidelity: unattested/i)).toBeInTheDocument();
    expect(screen.queryByText(/translation fidelity: attested/i)).not.toBeInTheDocument();
  });

  it('control: a current, filled-in attestation is labelled attested, so the label is computed rather than fixed', async () => {
    setCurrentPolicyYaml(
      withAttestation({
        attested_by: 'A. Reviewer',
        role: 'Head of AI Governance',
        date: today(),
        raf_version_checked: 'Board AI RAF v2.1, approved 2026-05-20',
      }),
    );
    render(<App />);

    expect(await screen.findByText(/translation fidelity: attested/i)).toBeInTheDocument();
    expect(screen.queryByText(/translation fidelity: unattested/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TC-NF-4-01

describe('runs in a browser with no install step', () => {
  it('TC-NF-4-01: the app mounts without a console error and without any install prompt, and the build uses relative paths so it can be served from any folder', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(<App />);
      expect(screen.getByText('Counterpoise')).toBeInTheDocument();
      expect(screen.queryByText(/install required|please install|npm install|docker/i)).not.toBeInTheDocument();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
    // `base: './'` is what lets dist/ be served from any path with no
    // configuration beyond the policy file (NF-4).
    const viteConfig = readFileSync(resolve(__dirname, '../../../vite.config.ts'), 'utf-8');
    expect(viteConfig).toMatch(/base:\s*'\.\/'/);
  });
});
