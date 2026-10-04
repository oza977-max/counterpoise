import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps } from 'react';
import { dump, load } from 'js-yaml';
import App from '../../App';
import RegisterView from '../RegisterView';
import VerdictDisplay from '../VerdictDisplay';
import appetiteYaml from '../../../policy/appetite.yaml?raw';
import { setCurrentPolicyYaml } from '../../store/policy-source';
import { loadPolicy } from '../../store/policy';
import { loadPacks } from '../../store/packs';
import { getPackSources } from '../../store/pack-source';
import { setRole } from '../../store/role';
import { addNode, getUseCases } from '../../store/register';
import { append, getAll } from '../../store/audit';
import { exportBundle } from '../../store/handoff';
import { evaluate } from '../../engine/evaluate';
import type { DataFlowGraph, GraphCorrection } from '../../engine/types';
import type { AuditEvent, RegisterNode } from '../../store/types';
import type { Verdict } from '../../types/verdict';
import { fillText, SLOW_FLOW_MS, DUP_CHECK_WAIT } from './fillText';
import { questionnaireCopyForField } from '../plain-copy';

// gvm-test 007 close-out, chunk 3 — the UI cases. Only the model SDK is mocked
// (and only where a test exercises the description path); the policy, packs,
// engine, store, audit trail and components are the real ones.
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mockCreate.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const DRAFT_KEY = 'aigate:intake-draft';
const policyResult = loadPolicy(appetiteYaml);
if (!policyResult.valid) throw new Error('fixture policy invalid');
const policy = policyResult.policy;

// ---------------------------------------------------------------- fixtures --

function baseVerdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    status: 'approved_with_controls',
    tier: 'High',
    track: 'II',
    binding_constraint: '',
    binding_path: '',
    controls: [],
    downstream_reviews: [],
    conditions: { hypotheses: [] },
    policy_version: '1.0',
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
    id: 'verdict-1',
    use_case_id: 'uc-1',
    living_status: 'approved',
    living_status_updated_at: '2026-01-01T00:00:00.000Z',
    attested_by: '1LoD',
    attested_at: '2026-01-01T00:00:00.000Z',
    graph_version: 1,
    corrections: [],
    ...overrides,
  };
}

// A verdict made by the REAL engine against the REAL policy and packs, wrapped
// the way IntakeFlow wraps one (id, living status and attestation added).
function realVerdict(g: DataFlowGraph): Verdict {
  const { packs } = loadPacks(getPackSources());
  const result = evaluate(g, policy, packs);
  if (!result.ok) throw new Error('evaluation failed');
  return baseVerdict({ ...result.value });
}

function graphOf(overrides: Partial<DataFlowGraph>): DataFlowGraph {
  return {
    id: 'g1',
    version: 1,
    input_nodes: [],
    processing_nodes: [],
    output_nodes: [],
    edges: [],
    jurisdictions: [],
    intake_method: 'structured_form',
    extracted_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ----------------------------------------------------------------- CF-5-01 --

describe('TC-CF-5-01 — a policy file with hard_lines missing prevents evaluation', () => {
  function yamlWithoutHardLines(): string {
    const raw = load(appetiteYaml) as Record<string, unknown>;
    delete raw.hard_lines;
    return dump(raw);
  }

  const MINIMAL_GRAPH = {
    id: 'test-graph-1',
    version: 1,
    intake_method: 'structured_form' as const,
    extracted_at: '2026-01-01T00:00:00.000Z',
    input_nodes: [{ id: 'i1', label: 'notes', data_class: 'Internal', data_zone: 'Zone C' }],
    processing_nodes: [
      { id: 'p1', label: 'summariser', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
    ],
    output_nodes: [
      { id: 'o1', label: 'summary', action_type: 'draft', exposure: 'internal-only', decision_bindingness: 'non-binding', output_reversibility: 'reversible', scale: 'limited' },
    ],
    edges: [{ from: 'i1', to: 'p1' }, { from: 'p1', to: 'o1' }],
    jurisdictions: [],
  };

  it('TC-CF-5-01: the shipped policy with hard_lines deleted is refused, the error names hard_lines, and evaluation is blocked', async () => {
    // The shipped policy itself is fine; only the deletion makes it invalid.
    expect(loadPolicy(appetiteYaml).valid).toBe(true);
    const broken = loadPolicy(yamlWithoutHardLines());
    expect(broken.valid).toBe(false);
    if (!broken.valid) expect(broken.errors.map((e) => e.field)).toContain('hard_lines');

    setRole('2LoD');
    setCurrentPolicyYaml(yamlWithoutHardLines());
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'graph_review',
        description: 'A tool that summarises internal notes',
        graph: MINIMAL_GRAPH,
        graphVersion: 1,
        corrections: [],
        useCaseId: 'test-uc-cf5',
        jurisdictionsConfirmed: true,
        unconfirmedNodeIds: [],
      }),
    );
    render(<App />);

    // The start-up banner: evaluation disabled, and the missing section named.
    const banner = await screen.findByRole('alert', { name: '' }, { timeout: 5000 }).catch(() => null);
    void banner;
    const policyBanner = document.querySelector('.app-policy-invalid');
    expect(policyBanner).not.toBeNull();
    expect(policyBanner!.textContent).toMatch(/policy file invalid/i);
    expect(policyBanner!.textContent).toMatch(/evaluation is disabled/i);
    expect(policyBanner!.textContent).toMatch(/hard_lines/);

    // Evaluation really is blocked: asking to go on does not reach confirmation.
    const user = userEvent.setup({ delay: null });
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));
    expect((await screen.findAllByText(/rules file has a problem/i)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /confirm and evaluate/i })).toBeNull();
    // No verdict was produced for the case.
    expect(await getAll('test-uc-cf5')).toEqual([]);
  });
});

// ----------------------------------------------------------------- NF-5-01 --

// The form path: no model is involved anywhere, which is the "no LLM call in
// the evaluation path" the case specifies.
async function fillMinimalForm(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  description: string,
  opts: { dataClassOption?: RegExp; sourceOption?: RegExp; personalAccount?: boolean } = {},
) {
  await user.clear(screen.getByLabelText(/what do you want to call it/i));
  await fillText(user, screen.getByLabelText(/what do you want to call it/i), name);
  await user.clear(screen.getByLabelText(/in a sentence or two/i));
  await fillText(user, screen.getByLabelText(/in a sentence or two/i), description);
  await user.click(
    screen.getByRole('radio', { name: opts.sourceOption ?? /something a team in your firm built for this job/i }),
  );
  if (opts.personalAccount) {
    await user.click(screen.getByRole('radio', { name: /a free or personal account/i }));
  }
  await user.click(
    screen.getByRole('radio', { name: /reads, summarises, translates, writes or answers questions in words/i }),
  );
  await user.click(screen.getByRole('checkbox', { name: opts.dataClassOption ?? /everyday work information/i }));
  await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
  await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
  await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
  await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
  await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
  await user.click(screen.getByRole('checkbox', { name: /somewhere else, or not sure/i }));
  await user.click(screen.getByRole('radio', { name: /^no$/i }));
}

async function reachFormScreen(user: ReturnType<typeof userEvent.setup>, description: string) {
  render(<App />);
  await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), description);
  await user.click(screen.getByRole('button', { name: /^next/i }));
  await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
  await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
}

async function clickThroughToConfirm(user: ReturnType<typeof userEvent.setup>) {
  for (let i = 0; i < 20; i++) {
    if (screen.queryByRole('button', { name: /confirm and evaluate/i })) return;
    const option = document.querySelector<HTMLButtonElement>('.questionnaire__options button');
    if (option) {
      await user.click(option);
      continue;
    }
    const explain = screen.queryByRole('textbox', { name: /explain|resolution/i });
    const resolveButton = screen.queryByRole('button', { name: /resolve|continue/i });
    if (explain && resolveButton) {
      await fillText(user, explain, 'Explained for the test.');
      await user.click(resolveButton);
      continue;
    }
    break;
  }
  await screen.findByRole('button', { name: /confirm and evaluate/i });
}

async function toConfirmScreen(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^continue$/i }));
  await screen.findByText(/here.s what we understood/i);
  await clickThroughToConfirm(user);
}

async function confirmAndReachVerdict(user: ReturnType<typeof userEvent.setup>) {
  await toConfirmScreen(user);
  await user.click(screen.getByRole('button', { name: /confirm and evaluate/i }));
  await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
}

describe('TC-NF-5-01 — a verdict appears within 30 seconds of the confirmation', () => {
  it('TC-NF-5-01: from the confirm click to the verdict on screen is well inside 30 s, with no model call in between', async () => {
    const user = userEvent.setup({ delay: null });
    await reachFormScreen(user, 'Canteen menu timing probe');
    await fillMinimalForm(user, 'Canteen menu timing probe', 'Sorts the staff canteen menu for the timing test.');
    await toConfirmScreen(user);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const started = performance.now();
    await user.click(screen.getByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
    const elapsedMs = performance.now() - started;

    expect(elapsedMs).toBeLessThan(30_000);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    // No loading state is left on screen once the verdict is showing.
    expect(screen.queryByText(/working out|evaluating/i)).toBeNull();
  }, SLOW_FLOW_MS);
});

// ----------------------------------------------------------------- PE-2-01 --

describe('TC-PE-2-01 — Track I is shown with the rule that matched', () => {
  it('TC-PE-2-01: a statistical credit-scoring model on a material decision shows Track I and TRACK-I, never Track II or III', () => {
    const verdict = realVerdict(
      graphOf({
        jurisdictions: ['UK'],
        processing_nodes: [
          { id: 'p1', label: 'credit score', model_type: 'statistical', autonomy_level: 0, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
        ],
        output_nodes: [
          { id: 'o1', label: 'score', action_type: 'recommend', exposure: 'internal-only', decision_bindingness: 'material', output_reversibility: 'reversible', scale: 'limited', decision_type: 'credit-decision' },
        ],
      }),
    );
    expect(verdict.track).toBe('I');
    expect(verdict.explanation.track_rationale?.rule_id).toBe('TRACK-I');

    render(<VerdictDisplay verdict={verdict} auditEvents={[]} onCorrect={vi.fn()} />);
    const why = document.querySelector('.verdict__why')!;
    const trackLine = Array.from(why.querySelectorAll('p')).find((p) => /^Track /.test(p.textContent ?? ''))!;
    expect(trackLine.textContent).toMatch(/^Track I —/);
    expect(trackLine.querySelector('code')?.textContent).toBe('TRACK-I');
    expect(trackLine.textContent).not.toMatch(/Track II|Track III/);
  });
});

// ------------------------------------------------------------- RA-11-02 ----

describe('TC-RA-11-02 — a verdict resting on a Low-confidence rule is provisional', () => {
  it('TC-RA-11-02: the screen says review is required before this is final, names the rule source, and never calls it final', () => {
    // EU and UK graph firing real, unadopted pack rules (low-confidence caveats).
    const verdict = realVerdict(
      graphOf({
        jurisdictions: ['UK', 'EU'],
        input_nodes: [{ id: 'i1', label: 'in', data_class: 'Client PII', data_zone: 'Zone C' }],
        processing_nodes: [
          { id: 'p1', label: 'm', model_type: 'ml', autonomy_level: 1, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
        ],
        output_nodes: [
          { id: 'o1', label: 'o', action_type: 'recommend', exposure: 'client-facing', decision_bindingness: 'material', output_reversibility: 'reversible', scale: 'limited', decision_type: 'credit-decision' },
        ],
      }),
    );
    const low = verdict.confidence_caveats.filter((c) => c.confidence === 'low');
    expect(low.length).toBeGreaterThan(0);
    expect(verdict.provisional_reasons.length).toBeGreaterThan(0);

    render(<VerdictDisplay verdict={verdict} auditEvents={[]} onCorrect={vi.fn()} />);

    const banner = document.querySelector('.verdict__provisional-banner')!;
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toMatch(/provisional — review required before this is final/i);
    // The notice carries each Low-confidence rule's own explanation, which names
    // the regulation and section it rests on.
    for (const c of low) expect(banner.textContent).toContain(c.reason);
    // Deliberately not "legal review required": which function must review is
    // stated against each rule in the chain, not presumed (user report 2026-08-15).
    expect(banner.textContent).not.toMatch(/legal review required|legal team/i);
    // The verdict heading carries the Provisional qualifier — never presented as final.
    const heading = document.querySelector('.verdict__heading')!;
    expect(heading.textContent).toMatch(/provisional/i);
    expect(heading.textContent).not.toMatch(/final/i);
    // And the rule that fired is named in the chain below.
    expect(document.body.textContent).toContain(low[0]!.ruleId);
  });
});

// ---------------------------------------------------------------- RG-5-01 ---

function RegisterViewHarness(props: Omit<ComponentProps<typeof RegisterView>, 'selectedId' | 'onSelectRow' | 'onCloseDetail'>) {
  const [sel, setSel] = useState<string | null>(null);
  return <RegisterView {...props} selectedId={sel} onSelectRow={setSel} onCloseDetail={() => setSel(null)} />;
}

describe('TC-RG-5-01 — the register exports to JSON', () => {
  it('TC-RG-5-01: ten use cases export as ten records with id, tier, track, status and verdict reference; verdict and policy version travel in the hand-off bundle', async () => {
    const tiers = ['Critical', 'High', 'Medium', 'Low', 'High', 'Medium', 'Low', 'Critical', 'High', 'Low'];
    const tracks = ['I', 'II', 'III', 'I', 'II', 'III', 'I', 'II', 'III', 'I'];
    const stages = ['pre_checked', 'approved', 'in_production', 'pre_checked', 'approved', 'idea', 'monitored', 'pre_checked', 'approved', 'exploring'] as const;
    const seeded: Array<{ id: string; verdictId: string; policy: string }> = [];
    for (let i = 0; i < 10; i++) {
      const id = `rg5-uc-${i}`;
      const verdictId = `rg5-verdict-${i}`;
      const policyVersion = `9.${i}`;
      seeded.push({ id, verdictId, policy: policyVersion });
      const node: RegisterNode = {
        node_id: id,
        node_type: 'use_case',
        label: `Export case ${i}`,
        created_at: '2026-01-01T00:00:00.000Z',
        metadata: {
          node_type: 'use_case',
          submitted_by: '1LoD',
          lifecycle_stage: stages[i]!,
          current_verdict_id: verdictId,
          tier: tiers[i]!,
          track: tracks[i]!,
        },
      };
      await addNode(node);
      const event: Omit<AuditEvent, 'prev_hash' | 'hash'> = {
        event_id: crypto.randomUUID(),
        use_case_id: id,
        event_type: 'verdict_produced',
        occurred_at: '2026-01-01T00:00:00.000Z',
        actor: '1LoD',
        payload: { type: 'verdict_produced', verdict: baseVerdict({ id: verdictId, use_case_id: id, policy_version: policyVersion, tier: tiers[i] as Verdict['tier'], track: tracks[i] as Verdict['track'] }) },
      };
      await append(event as never);
    }

    let capturedJson: string | undefined;
    const OriginalBlob = globalThis.Blob;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    globalThis.Blob = class MockBlob {
      constructor(parts: BlobPart[]) {
        capturedJson = String(parts[0]);
      }
    } as unknown as typeof Blob;
    URL.createObjectURL = (() => 'blob:mock-url') as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    try {
      const user = userEvent.setup();
      render(<RegisterViewHarness role="2LoD" currentPolicyVersion="1.0" />);
      await user.click(await screen.findByRole('button', { name: /export json/i }));
      expect(capturedJson).toBeDefined();
    } finally {
      globalThis.Blob = OriginalBlob;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }

    const exported = JSON.parse(capturedJson!) as { nodes: RegisterNode[] };
    const mine = exported.nodes.filter((n) => n.node_id.startsWith('rg5-uc-'));
    // All ten records, whatever their stage (the export is not the filtered view).
    expect(mine).toHaveLength(10);
    mine.sort((a, b) => a.node_id.localeCompare(b.node_id));
    mine.forEach((n, idx) => {
      const i = Number(n.node_id.split('-').pop());
      expect(idx).toBe(i);
      expect(n.node_id).toBe(`rg5-uc-${i}`);
      if (n.metadata.node_type !== 'use_case') throw new Error('not a use case');
      expect(n.metadata.tier).toBe(tiers[i]);
      expect(n.metadata.track).toBe(tracks[i]);
      expect(n.metadata.lifecycle_stage).toBe(stages[i]);
      expect(n.metadata.current_verdict_id).toBe(`rg5-verdict-${i}`);
    });

    // Amended Then: the verdict body, the audit-trail link and the policy version
    // are in the hand-off bundle (RG-8), keyed to the same use case and verdict ids.
    const bundle = await exportBundle('test');
    for (const s of seeded) {
      const ev = bundle.audit_events.find((e) => e.use_case_id === s.id && e.payload.type === 'verdict_produced');
      expect(ev).toBeDefined();
      if (!ev || ev.payload.type !== 'verdict_produced') continue;
      expect(ev.payload.verdict.id).toBe(s.verdictId);
      expect(ev.payload.verdict.policy_version).toBe(s.policy);
    }
  });
});

// ---------------------------------------------------------------- UC-1-04 ---

describe('TC-UC-1-04 — special characters and non-ASCII are accepted as literal text', () => {
  it('TC-UC-1-04: angle brackets, accents and em-dashes arrive intact as text; no element is created and no script runs', async () => {
    const user = userEvent.setup({ delay: null });
    const typed =
      'AI tool für Kundendaten-Analyse — parses <client_name> fields and outputs résumés. <img src=x onerror="window.__tc_uc_1_04=1"> <script>window.__tc_uc_1_04=1</script>';
    render(<App />);
    const box = await screen.findByRole('textbox', { name: /what ai tool do you want to use/i });
    await user.click(box);
    await user.paste(typed);
    // Accepted: the textbox keeps every character exactly as typed.
    expect((box as HTMLTextAreaElement).value).toBe(typed);
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await screen.findAllByText(/has this been checked before/i);
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));

    // The guided form's description field is prefilled from what was typed: the
    // text is there verbatim, with the brackets and the accents (not stripped).
    const prefilled = (await screen.findByLabelText(/in a sentence or two/i)) as HTMLTextAreaElement;
    expect(prefilled.value).toContain('<client_name>');
    expect(prefilled.value).toContain('für Kundendaten-Analyse — parses');
    expect(prefilled.value).toContain('résumés');
    // Nothing was rendered as markup, and nothing executed.
    expect(document.querySelector('client_name')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect((window as unknown as Record<string, unknown>).__tc_uc_1_04).toBeUndefined();
    expect(screen.queryByRole('alert')).toBeNull();
  }, SLOW_FLOW_MS);
});

// ---------------------------------------------------------------- UC-2-04 ---

describe('TC-UC-2-04 — nothing similar found: intake carries on without a duplicate prompt', () => {
  it('TC-UC-2-04: no duplicate card or adopt option appears; one Continue goes straight on to extraction', async () => {
    localStorage.setItem('aigate:api-key', 'test-key');
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: {
            input_nodes: [],
            processing_nodes: [
              { id: 'p1', label: 'menu translator', model_type: 'llm', autonomy_level: 0, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
            ],
            output_nodes: [
              { id: 'o1', label: 'menu', action_type: 'draft', exposure: 'internal-only', decision_bindingness: 'non-binding', output_reversibility: 'reversible', scale: 'limited' },
            ],
            edges: [],
            jurisdictions: [],
          },
        },
      ],
    });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(
      user,
      await screen.findByLabelText(/what ai tool do you want to use/i),
      'Weekly staff canteen menu translator for the cafeteria noticeboard.',
    );
    await user.click(screen.getByRole('button', { name: /^next/i }));

    // The register is not empty (the seeded portfolio is in it) — it was searched.
    expect(await screen.findByText(/nothing similar found — we looked through \d+ earlier checks?/i, {}, DUP_CHECK_WAIT)).toBeInTheDocument();
    expect(screen.queryByText(/something similar has been checked before/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /use the earlier result/i })).toBeNull();
    expect(document.querySelector('.duplicate-card')).toBeNull();
    // Only the one way on, and no extraction has been started yet.
    expect(mockCreate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^continue →$/i }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1), { timeout: 5000 });
    // The extracted graph is put in front of the submitter for checking.
    expect(await screen.findByText(/check what we read from your description/i, {}, DUP_CHECK_WAIT)).toBeInTheDocument();
  }, SLOW_FLOW_MS);
});

// ---------------------------------------------------------------- UC-5-03 ---

describe('TC-UC-5-03 — several contradictions are shown together and all must be resolved', () => {
  it('TC-UC-5-03: two contradictions appear on one screen, confirmation is unreachable, and it opens only after they are explained', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const box = await screen.findByRole('textbox', { name: /what ai tool do you want to use/i });
    await user.click(box);
    await user.paste('This tool processes no client data at all. A human approves every action, no autonomy.');
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));

    // Declare the opposite on BOTH points: personal information, and acting by itself.
    await fillText(user, await screen.findByLabelText(/what do you want to call it/i), 'Contradictor');
    await fillText(user, screen.getByLabelText(/in a sentence or two/i), 'x');
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    await user.click(
      screen.getByRole('radio', { name: /reads, summarises, translates, writes or answers questions in words/i }),
    );
    await user.click(screen.getByRole('checkbox', { name: /information about people/i }));
    await user.click(screen.getByRole('radio', { name: /acts by itself within limits someone set/i }));
    await user.click(screen.getByRole('radio', { name: /something else — sends, books, updates records/i }));
    await user.click(screen.getByRole('radio', { name: /^other teams in the firm$/i }));
    await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
    await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
    await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
    await user.click(screen.getByRole('checkbox', { name: /united kingdom/i }));
    await user.click(screen.getByRole('radio', { name: /^no$/i }));
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    expect(await screen.findByRole('region', { name: /contradiction review/i })).toBeInTheDocument();
    // Both at once, on the same screen — not one now and the other later.
    const items = document.querySelectorAll('.contradiction');
    expect(items.length).toBe(2);
    expect(screen.getByText(/no personal information is involved/i)).toBeInTheDocument();
    expect(Array.from(items).some((el) => /person|approv|human/i.test(el.textContent ?? '') && !/no personal information/i.test(el.textContent ?? ''))).toBe(true);

    // Confirmation is out of reach, and so is moving on without an explanation.
    expect(screen.queryByRole('button', { name: /confirm and evaluate/i })).toBeNull();
    const cont = screen.getByRole('button', { name: /^continue$/i });
    expect(cont).toBeDisabled();

    // Once explained, the way to confirmation opens (and the contradictions are gone).
    await fillText(user, screen.getByRole('textbox', { name: /which is right, and why/i }), 'The form is right; the description was careless.');
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(await screen.findByRole('button', { name: /confirm and evaluate/i })).toBeInTheDocument();
    expect(document.querySelectorAll('.contradiction')).toHaveLength(0);
  }, SLOW_FLOW_MS);
});

// ------------------------------------------------ UC-7-01 / VD-6-01 / VD-3-01

async function eventsFor(label: string): Promise<{ id: string; events: AuditEvent[] }> {
  const useCase = (await getUseCases('all')).find((u) => u.label === label);
  expect(useCase).toBeDefined();
  return { id: useCase!.use_case_id, events: await getAll(useCase!.use_case_id) };
}

// The description path, as the case words it: the submitter is reviewing the
// extracted graph and corrects one field on a card.
const UC7_DESCRIPTION =
  'A tool that sorts internal documents for the operations team. It is a traditional ML model, internal vendor, Zone C, no autonomy, replacing no prior model; recommends, internal only, material, reversible, limited scale.';

const UC7_EXTRACTION = {
  content: [
    {
      type: 'tool_use',
      name: 'extract_graph',
      input: {
        input_nodes: [
          {
            id: 'i1',
            label: 'internal documents',
            data_class: 'Internal',
            data_zone: 'Zone C',
            basis_quotes: { data_class: 'internal documents', data_zone: 'Zone C' },
          },
        ],
        processing_nodes: [
          {
            id: 'p1',
            label: 'document sorter',
            model_type: 'traditional-ml',
            autonomy_level: 0,
            data_zone: 'Zone C',
            vendor: 'internal',
            replaces_prior_model: false,
            basis_quotes: {
              model_type: 'traditional ML model',
              autonomy_level: 'no autonomy',
              data_zone: 'Zone C',
              vendor: 'internal vendor',
              replaces_prior_model: 'replacing no prior model',
            },
          },
        ],
        output_nodes: [
          {
            id: 'o1',
            label: 'sorted documents',
            action_type: 'recommend',
            exposure: 'internal-only',
            decision_bindingness: 'material',
            output_reversibility: 'reversible',
            scale: 'limited',
            basis_quotes: {
              action_type: 'recommends',
              exposure: 'internal only',
              decision_bindingness: 'material',
              output_reversibility: 'reversible',
              scale: 'limited scale',
            },
          },
        ],
        edges: [{ from: 'i1', to: 'p1' }, { from: 'p1', to: 'o1' }],
        jurisdictions: [],
      },
    },
  ],
};

async function confirmAllNodes(user: ReturnType<typeof userEvent.setup>) {
  for (;;) {
    const buttons = screen.queryAllByRole('button', { name: /^(this is right|i.ve checked this — it.s right)$/i });
    if (buttons.length === 0) break;
    await user.click(buttons[0]!);
  }
  const jurisdictionButton = screen.queryByRole('button', { name: /^(these are right|none of these — continue)$/i });
  if (jurisdictionButton) await user.click(jurisdictionButton);
}

describe('TC-UC-7-01 / TC-VD-6-01 — a correction keeps both values; a fresh verdict carries its living status', () => {
  it('TC-UC-7-01: correcting the data class from Internal to MNPI on the review screen records field, before, after, who and when [TC-VD-6-01]', async () => {
    localStorage.setItem('aigate:api-key', 'test-key');
    mockCreate.mockResolvedValue(UC7_EXTRACTION);
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, await screen.findByLabelText(/what ai tool do you want to use/i), UC7_DESCRIPTION);
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
    await screen.findByText(/check what we read from your description/i);

    // Correct the data class on the input card: Internal -> MNPI.
    await user.click(screen.getAllByRole('button', { name: /^edit$/i })[0]!);
    const select = screen.getByLabelText(new RegExp(`internal documents — ${questionnaireCopyForField('data_class').shortLabel}`, 'i'));
    expect((select as HTMLSelectElement).value).toBe('Internal');
    await user.selectOptions(select, 'MNPI');
    await user.click(screen.getByRole('button', { name: /^done$/i }));

    await confirmAllNodes(user);
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));
    await clickThroughToConfirm(user);
    await user.click(screen.getByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });

    const useCase = (await getUseCases('all')).find((u) => /document sorter|internal documents|sorted documents/i.test(u.label));
    expect(useCase).toBeDefined();
    const events = await getAll(useCase!.use_case_id);

    // UC-7-01: the correction on the trail, with both values, who and when.
    const corrections = events
      .filter((e) => e.payload.type === 'graph_corrected')
      .map((e) => ({ event: e, c: (e.payload as { type: 'graph_corrected'; correction: GraphCorrection }).correction }));
    const dataClass = corrections.find((x) => x.c.field === 'data_class');
    expect(dataClass).toBeDefined();
    expect(dataClass!.c.node_id).toBe('i1');
    expect(dataClass!.c.original_value).toBe('Internal');
    expect(dataClass!.c.corrected_value).toBe('MNPI');
    expect(dataClass!.c.corrected_by.length).toBeGreaterThan(0);
    expect(dataClass!.c.corrected_by).toBe(dataClass!.event.actor);
    expect(new Date(dataClass!.c.corrected_at).toISOString()).toBe(dataClass!.c.corrected_at);

    // VD-6-01: the verdict as produced and stored carries living_status and an
    // ISO timestamp for it, and the screen shows the living-status line.
    const produced = events.find((e) => e.payload.type === 'verdict_produced');
    if (produced?.payload.type !== 'verdict_produced') throw new Error('no verdict');
    const stored = produced.payload.verdict;
    expect(stored.living_status).toBe('approved');
    expect(Number.isNaN(Date.parse(stored.living_status_updated_at))).toBe(false);
    expect(new Date(stored.living_status_updated_at).toISOString()).toBe(stored.living_status_updated_at);
    expect(document.querySelector('.verdict__living-status')?.textContent).toMatch(/living status/i);
  }, SLOW_FLOW_MS);
});

describe('TC-VD-3-01 — a correction re-evaluates and both verdicts are preserved', () => {
  it('TC-VD-3-01: a rejected case corrected to a firm-built system gets a new verdict; the original verdict is still on the trail, unaltered', async () => {
    const user = userEvent.setup({ delay: null });
    const label = 'Zephyrquill zone correction probe';
    await reachFormScreen(user, label);
    // Price-sensitive information sent to a personal outside account: Zone A.
    await fillMinimalForm(user, label, 'Reads deal notes for the zone correction test.', {
      sourceOption: /an ai assistant or website run by an outside company/i,
      personalAccount: true,
      dataClassOption: /price-sensitive information/i,
    });
    await confirmAndReachVerdict(user);

    const before = await eventsFor(label);
    const originalEvent = before.events.find((e) => e.payload.type === 'verdict_produced');
    if (originalEvent?.payload.type !== 'verdict_produced') throw new Error('no original verdict');
    const original = originalEvent.payload.verdict;
    expect(original.status).toBe('rejected');
    const originalSnapshot = JSON.stringify(originalEvent);

    // Correct where it runs: a firm-built system (Zone C).
    await user.click(document.querySelector<HTMLButtonElement>('.verdict__first-correct')!);
    await screen.findByText(/you.re correcting your earlier answers/i);
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    await confirmAndReachVerdict(user);

    const after = await eventsFor(label);
    // The original verdict is still there, byte for byte.
    const stillThere = after.events.find((e) => e.event_id === originalEvent.event_id);
    expect(JSON.stringify(stillThere)).toBe(originalSnapshot);
    // A new verdict was produced by re-evaluation and recorded beside it.
    const corrected = after.events.find((e) => e.payload.type === 'verdict_corrected');
    if (corrected?.payload.type !== 'verdict_corrected') throw new Error('no corrected verdict');
    expect(corrected.payload.original_verdict_id).toBe(original.id);
    expect(corrected.payload.new_verdict.id).not.toBe(original.id);
    expect(corrected.payload.new_verdict.status).not.toBe('rejected');
    // Appended after, never in place of.
    expect(after.events.indexOf(corrected)).toBeGreaterThan(after.events.indexOf(originalEvent));
    expect(after.events.length).toBeGreaterThan(before.events.length);
    // The register's current view follows the new verdict.
    const summary = (await getUseCases('all')).find((u) => u.use_case_id === after.id);
    expect(summary?.current_verdict_status).toBe(corrected.payload.new_verdict.status);
  }, SLOW_FLOW_MS);
});
