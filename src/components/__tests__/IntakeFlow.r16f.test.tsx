import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { addNode, updateUseCaseVerdictSummary } from '../../store/register';
import * as registerModule from '../../store/register';
import * as traceModule from '../../llm/reasoning-trace';
import { append as appendAuditEvent, getAll } from '../../store/audit';
import { setCurrentPolicyYaml } from '../../store/policy-source';
import { loadDraft } from '../intake-draft';
import appetiteYaml from '../../../policy/appetite.yaml?raw';
import type { Verdict } from '../../types/verdict';
import type { DataFlowGraph } from '../../engine/types';
import { fillText, SLOW_FLOW_MS, DUP_CHECK_WAIT, pressNext } from './fillText';

// R16-F — design-review-007.html Group 1. Integration-level coverage for
// the items that need the real App wiring to prove: F-1 (cross-tab
// confirm/correction refusal), F-2 (a form-path evaluation failure returns
// to the form, not graph_review), F-3 (the creation record's new timing).
// Unit-level coverage for the individual pieces lives in intake-state.test.ts
// (the reducer — including EVALUATION_FAILED's intake_method branch and
// STEP_BACK's afterFailedEvaluation refusal), db.test.ts (withCaseLock),
// register.test.ts (confirmationPrecondition — including TC-R16-F-18,
// which proves an evaluation retry with no verdict yet still passes as
// 'ok', the mechanism that makes "a retry writes a second, deliberate
// graph_confirmed" safe — not re-proven at this integration level),
// plain-copy.test.ts (describeAssumptions, summaryDestinationLine) and
// plausibility.test.ts (the reworded messages).
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));

const DRAFT_KEY = 'aigate:intake-draft';

// setCurrentPolicyYaml (store/policy-source.ts) persists to localStorage —
// module-global for the life of this test FILE (unlike sessionStorage,
// which src/test-setup.ts already clears after every test). A broken
// policy set by one test must never leak into the next.
beforeEach(() => {
  localStorage.clear();
});

function makeGraph(overrides: Partial<DataFlowGraph> = {}): DataFlowGraph {
  return {
    id: 'g1',
    version: 1,
    intake_method: 'structured_form',
    extracted_at: '2026-01-01T00:00:00.000Z',
    jurisdictions: [],
    input_nodes: [{ id: 'i1', label: 'x', data_class: 'Internal', data_zone: 'Zone C' }],
    processing_nodes: [
      { id: 'p1', label: 'x', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
    ],
    output_nodes: [
      { id: 'o1', label: 'x', action_type: 'read', exposure: 'internal-only', decision_bindingness: 'non-binding', output_reversibility: 'reversible', scale: 'limited' },
    ],
    edges: [],
    ...overrides,
  };
}

function makeVerdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    status: 'approved_with_controls',
    tier: 'High',
    track: 'II',
    binding_constraint: 'INV-DATA-01',
    binding_path: 'x',
    controls: [],
    downstream_reviews: [],
    conditions: { hypotheses: [] },
    policy_version: '1.9',
    pack_versions: {},
    applied_overrides: [],
    confidence_caveats: [],
    provisional_reasons: [],
    boundary_proximity: false,
    margin_achieved: 0,
    margin_target: 0.1,
    single_covered_invariants: [],
    id: 'v-other-tab',
    use_case_id: 'uc-placeholder',
    living_status: 'approved',
    living_status_updated_at: '2026-01-01T00:00:00.000Z',
    attested_by: '1LoD',
    attested_at: '2026-01-01T00:00:00.000Z',
    graph_version: 1,
    corrections: [],
    ...overrides,
  } as Verdict;
}

describe('F-6 (DR7-13): checkPolicyGate is the one policy-gate check, on the form path too', () => {
  it('TC-R16-F-59: a covers_reviews reference error on the FORM path\'s own Continue shows the message and never dispatches FORM_SUBMITTED (mirrors TC-R16-A1-63\'s graph_review coverage)', async () => {
    localStorage.clear();
    const { setCurrentPolicyYaml } = await import('../../store/policy-source');
    setCurrentPolicyYaml(`
version: "1.0"
policy_id: "RAF-001"
firm_name: "Test Bank"
translation_attestation:
  attested_by: "x"
  role: "x"
  date: "2026-01-01"
  raf_version_checked: "x"
hard_lines: []
tracks:
  - id: "TRACK-I"
    name: "Track I"
    description: "d"
    conditions: []
    short_circuit: true
    regulatory_basis: "x"
tiers:
  - id: "TIER-LOW"
    name: "Low"
    triggers: []
invariants: []
controls:
  - id: "CTRL-TPRM-01"
    name: "n"
    description: "d"
    resolves: []
    burden: 1
    verification: "v"
    covers_reviews: ["DR-VENDR-01"]
kri_thresholds: {}
jurisdictions: []
roles: {}
tier_workflow:
  Critical: "x"
  High: "x"
  Medium: "x"
  Low: "x"
safety_margin: 0.1
`);

    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'Form-path gate probe');
    await pressNext(user);
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));

    await fillText(user, await screen.findByLabelText(/what do you want to call it/i), 'Gate probe tool');
    await fillText(user, screen.getByLabelText(/in a sentence or two/i), 'x');
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    await user.click(screen.getByRole('radio', { name: /reads, summarises, translates, writes or answers questions in words/i }));
    await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
    await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
    await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
    await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
    await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
    await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
    await user.click(screen.getByRole('checkbox', { name: /somewhere else, or not sure/i }));
    await user.click(screen.getByRole('radio', { name: /^no$/i }));
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    expect(await screen.findAllByText(/Policy file invalid/i)).not.toHaveLength(0);
    // CR8-13 (code review 008): a submitter (the default 1LoD view) sees the
    // plain policy sentence, never the raw field path — that detail is for
    // 2LoD and the Appetite framework screen (TC-R16-A1-62 / TC-CR8-13).
    expect(screen.getAllByText(/rules file has a problem/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/CTRL-TPRM-01 covers_reviews: no review with id 'DR-VENDR-01'/)).not.toBeInTheDocument();
    // Never reached the summary — FORM_SUBMITTED was never dispatched.
    expect(screen.queryByText(/here.s what we understood/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeInTheDocument();
  }, SLOW_FLOW_MS);
});

describe('§3 (DR7-10): focus moves and the step change is announced', () => {
  it('TC-R16-F-46: a step change (not the first load) moves focus to the step container and announces the new step', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);

    // First load: nothing has "changed" into yet — no announcement.
    expect(document.querySelector('.intake-flow__step-announcement')?.textContent).toBe('');

    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'Focus announcement probe');
    await pressNext(user);

    // Now on duplicate_check — StepTracker's own numbering: Describe (1),
    // Similar checks (2 — the step just reached).
    await screen.findByText(/has this been checked before/i);
    expect(document.querySelector('.intake-flow__step-announcement')?.textContent).toBe(
      'Step 2 of 6: Similar checks',
    );
    // The step container itself — not just some element — has focus.
    expect(document.querySelector('.card')).toHaveFocus();
  });
});

describe('F-1 (DR7-02, DR7-03): cross-tab confirm/correction integrity', () => {
  it('TC-R16-F-22: a confirm refused because another tab already confirmed the same case writes nothing, shows the "already decided" alert, and disables Confirm', async () => {
    const useCaseId = 'uc-r16f-already-decided';
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'confirmation',
        description: 'A tool already confirmed elsewhere.',
        graph: makeGraph(),
        graphVersion: 1,
        corrections: [],
        answers: [],
        resolutionNotes: [],
        useCaseId,
      }),
    );

    // "Another tab" already ran a complete fresh confirm for this exact case.
    const now = new Date().toISOString();
    await appendAuditEvent({
      event_id: crypto.randomUUID(),
      use_case_id: useCaseId,
      event_type: 'use_case_created',
      occurred_at: now,
      actor: '1LoD',
      payload: { type: 'use_case_created', description: 'A tool already confirmed elsewhere.', intake_method: 'structured_form' },
    });
    await appendAuditEvent({
      event_id: crypto.randomUUID(),
      use_case_id: useCaseId,
      event_type: 'graph_confirmed',
      occurred_at: now,
      actor: '1LoD',
      payload: { type: 'graph_confirmed', graph_id: 'g1', graph_version: 1, corrections_count: 0 },
    });
    await appendAuditEvent({
      event_id: crypto.randomUUID(),
      use_case_id: useCaseId,
      event_type: 'verdict_produced',
      occurred_at: now,
      actor: 'system',
      payload: { type: 'verdict_produced', verdict: makeVerdict({ use_case_id: useCaseId }) },
    });
    await addNode({
      node_id: useCaseId,
      node_type: 'use_case',
      label: 'Already confirmed elsewhere',
      created_at: now,
      metadata: {
        node_type: 'use_case',
        submitted_by: '1LoD',
        lifecycle_stage: 'pre_checked',
        current_verdict_id: 'v-other-tab',
        tier: 'High',
        track: 'II',
      },
    });

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already has a result/i);
    expect(screen.getByRole('button', { name: /confirm and evaluate/i })).toBeDisabled();

    // Nothing new was written — exactly the one graph_confirmed/
    // verdict_produced pair "the other tab" wrote survives.
    const events = await getAll(useCaseId);
    expect(events.filter((e) => e.event_type === 'graph_confirmed')).toHaveLength(1);
    expect(events.filter((e) => e.event_type === 'verdict_produced')).toHaveLength(1);
    expect(events.filter((e) => e.event_type === 'use_case_created')).toHaveLength(1);
    sessionStorage.clear();
  });

  it('TC-R16-F-23: a correction refused because another tab\'s correction already landed writes nothing and shows the "corrected elsewhere" alert', async () => {
    const useCaseId = 'uc-r16f-corrected-elsewhere';
    const originalVerdictId = 'v-original-this-tab-saw';
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'confirmation',
        description: 'A tool corrected elsewhere while this tab worked.',
        graph: makeGraph({ version: 2 }),
        graphVersion: 2,
        corrections: [],
        answers: [],
        resolutionNotes: [],
        useCaseId,
        originalVerdictId,
      }),
    );

    const now = new Date().toISOString();
    await appendAuditEvent({
      event_id: crypto.randomUUID(),
      use_case_id: useCaseId,
      event_type: 'verdict_produced',
      occurred_at: now,
      actor: 'system',
      payload: { type: 'verdict_produced', verdict: makeVerdict({ id: originalVerdictId, use_case_id: useCaseId }) },
    });
    await addNode({
      node_id: useCaseId,
      node_type: 'use_case',
      label: 'Corrected elsewhere',
      created_at: now,
      metadata: {
        node_type: 'use_case',
        submitted_by: '1LoD',
        lifecycle_stage: 'pre_checked',
        current_verdict_id: originalVerdictId,
        tier: 'High',
        track: 'II',
      },
    });

    // "Another tab" completes its OWN correction of the same original
    // verdict, moving the trail's current verdict on.
    await appendAuditEvent({
      event_id: crypto.randomUUID(),
      use_case_id: useCaseId,
      event_type: 'verdict_corrected',
      occurred_at: now,
      actor: 'system',
      payload: {
        type: 'verdict_corrected',
        original_verdict_id: originalVerdictId,
        new_verdict: makeVerdict({ id: 'v-newer-from-other-tab', use_case_id: useCaseId }),
      },
    });
    await updateUseCaseVerdictSummary(useCaseId, { currentVerdictId: 'v-newer-from-other-tab' });

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/corrected in another tab/i);
    expect(screen.getByRole('button', { name: /confirm and evaluate/i })).toBeDisabled();

    // This tab's correction never landed.
    const events = await getAll(useCaseId);
    expect(events.filter((e) => e.event_type === 'verdict_corrected')).toHaveLength(1);
    sessionStorage.clear();
  });
});

describe('F-2 (DR7-04): an evaluation error never orphans the case', () => {
  it('TC-R16-F-24: a form-path evaluation failure returns to the FORM, filled in, not graph_review, and orphans nothing on the trail', async () => {
    localStorage.clear(); // no API key — structured form path

    // Force a genuine evaluation failure the same way WalkingSkeleton's own
    // "no-track-match" test does. Set BEFORE render: IntakeFlow reads the
    // policy via `useMemo(() => loadPolicy(getCurrentPolicyYaml()), [])` —
    // mount-time only, never recomputed, so this must land before mount.
    const holed = appetiteYaml.replace(
      /^tracks:[\s\S]*?(?=^tiers:)/m,
      `tracks:\n  - id: "TRACK-III"\n    name: "Track III"\n    description: "test fixture"\n    regulatory_basis: "test fixture"\n    conditions:\n      - field: "model_type"\n        value: { in: ["llm"] }\n    short_circuit: true\n\n`,
    );
    setCurrentPolicyYaml(holed);

    const user = userEvent.setup({ delay: null });
    render(<App />);

    const input = screen.getByLabelText(/what ai tool do you want to use/i);
    await fillText(user, input, 'Evaluation failure probe');
    await pressNext(user);
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));

    await fillText(user, await screen.findByLabelText(/what do you want to call it/i), 'No-track-match tool');
    await fillText(user, screen.getByLabelText(/in a sentence or two/i), 'x');
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    // deep-learning, not llm — the holed policy above keeps TRACK-III
    // matching only model_type llm, so this is the one that fails to
    // match any track.
    await user.click(screen.getByRole('radio', { name: /recognises things in images, sound or documents/i }));
    await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
    await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
    await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
    await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
    await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
    await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
    await user.click(screen.getByRole('checkbox', { name: /somewhere else, or not sure/i }));
    await user.click(screen.getByRole('radio', { name: /^no$/i }));
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByText(/here.s what we understood/i);
    await user.click(screen.getByRole('button', { name: /confirm and evaluate/i }));

    // F-2: back on the FORM, filled in — never graph_review, which this
    // path has never visited on the way forward either (W-3) — and the
    // error renders (previously only wired up on graph_review's own JSX).
    expect(await screen.findByRole('alert')).toHaveTextContent(/evaluation could not complete/i);
    expect(await screen.findByLabelText(/what do you want to call it/i)).toHaveValue('No-track-match tool');

    // F-3: exactly one use_case_created and one graph_confirmed survive —
    // the failed attempt attested once, honestly, and nothing orphaned.
    const { getUseCases } = await import('../../store/register');
    // CR6-04: the draft is now saved as a {version, state} envelope — read
    // it through the real, stable loadDraft() API rather than parsing the
    // raw sessionStorage value's shape directly (BC-002: the recogniser
    // that validates is the one whose output is used).
    const draft = loadDraft() as { step: string; method: string; useCaseId: string };
    expect(draft.step).toBe('graph_extraction');
    expect(draft.method).toBe('form');
    const events = await getAll(draft.useCaseId);
    expect(events.map((e) => e.event_type)).toEqual(['use_case_created', 'graph_confirmed']);
    expect((await getUseCases('all')).find((r) => r.use_case_id === draft.useCaseId)).toBeUndefined();
  }, SLOW_FLOW_MS);
});

describe('F-3 (DR7-05): "Start over" before Confirm strands nothing', () => {
  it('TC-R16-F-25: Start over after Continue but before Confirm leaves no event on the trail', async () => {
    const useCaseId = 'uc-r16f-strands-nothing';
    // A draft at `confirmation` — reached via Continue, never Confirmed —
    // the exact state a person closing the tab (or clicking "Start over
    // instead" on the resumed-draft banner) leaves behind.
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'confirmation',
        description: 'Abandoned before confirm.',
        graph: makeGraph(),
        graphVersion: 1,
        corrections: [],
        answers: [],
        resolutionNotes: [],
        useCaseId,
      }),
    );

    const user = userEvent.setup({ delay: null });
    render(<App />);
    // Per F-3, nothing was ever written for this case — reaching Confirm
    // is the only point that writes anything.
    expect(await getAll(useCaseId)).toEqual([]);

    // The resumed-draft banner's own escape hatch — the UI's actual
    // "Start over" affordance mid-flow (explore-005 D-002).
    await user.click(await screen.findByRole('button', { name: /start over instead/i }));
    await screen.findByText(/what ai tool do you want to use/i);

    // Still nothing on the trail for the abandoned case id, and no
    // register row for it either.
    expect(await getAll(useCaseId)).toEqual([]);
    const { getUseCases } = await import('../../store/register');
    const rows = await getUseCases('all');
    expect(rows.find((r) => r.use_case_id === useCaseId)).toBeUndefined();
  });
});

// Found verifying R16-F: test-cases-022 said the correction handler's own
// access-scope check was "exercised indirectly" by GraphView.r16f.test.tsx,
// but those tests pass a stand-in onCorrect — the real handler never ran.
// This drives the real one, on the review screen, through App.
describe('§4 (DR7-11): the tick-all editor through the real correction handler', () => {
  it('TC-R16-F-64: on the review screen, ticking a second kind of access applies both kinds to the case', async () => {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'graph_review',
        description: 'An agent that files tickets using its own service account.',
        graph: makeGraph({
          intake_method: 'llm',
          processing_nodes: [
            {
              id: 'p1',
              label: 'Ticket agent',
              model_type: 'agentic',
              autonomy_level: 2,
              data_zone: 'Zone C',
              vendor: 'internal',
              replaces_prior_model: false,
              system_access_scope: ['credentialed_systems'],
            },
          ],
        }),
        graphVersion: 1,
        corrections: [],
        useCaseId: 'uc-r16f-access-editor',
        jurisdictionsConfirmed: true,
        unconfirmedNodeIds: [],
      }),
    );
    const user = userEvent.setup({ delay: null });
    render(<App />);

    const card = (await screen.findByText('Ticket agent')).closest('.graph-node') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: /^edit$/i }));
    await user.click(within(card).getByRole('checkbox', { name: /runs on computers or servers shared with other automated tools/i }));

    // The real handler accepted the list and wrote it into the graph, so the
    // editor now shows both kinds ticked (a stand-in onCorrect would leave
    // the graph, and so the ticks, unchanged).
    expect(within(card).getByRole('checkbox', { name: /runs on computers or servers shared/i })).toBeChecked();
    expect(within(card).getByRole('checkbox', { name: /its own logins, passwords or access tokens/i })).toBeChecked();
    sessionStorage.clear();
  });
});

// Found by R16-F review pass 1 (GVM build convergence loop): the confirm
// step checked the policy's references only AFTER writing use_case_created
// and graph_confirmed, and on an error returned silently — the screen sat on
// "Evaluating…" and the trail kept an attestation with no verdict. Reachable
// by reopening a saved draft at Confirm after the policy was edited.
describe('R16-F review pass 1: the confirm step checks the policy before writing anything', () => {
  it('TC-R16-F-67: a draft reopened at Confirm under a broken policy writes nothing and shows why, instead of hanging on "Evaluating…"', async () => {
    const useCaseId = 'uc-r16f-broken-policy-at-confirm';
    setCurrentPolicyYaml(`
version: "1.0"
policy_id: "RAF-001"
firm_name: "Test Bank"
translation_attestation:
  attested_by: "x"
  role: "x"
  date: "2026-01-01"
  raf_version_checked: "x"
hard_lines: []
tracks:
  - id: "TRACK-I"
    name: "Track I"
    description: "d"
    conditions: []
    short_circuit: true
    regulatory_basis: "x"
tiers:
  - id: "TIER-LOW"
    name: "Low"
    triggers: []
invariants: []
controls:
  - id: "CTRL-TPRM-01"
    name: "n"
    description: "d"
    resolves: []
    burden: 1
    verification: "v"
    covers_reviews: ["DR-VENDR-01"]
kri_thresholds: {}
jurisdictions: []
roles: {}
tier_workflow:
  Critical: "x"
  High: "x"
  Medium: "x"
  Low: "x"
safety_margin: 0.1
`);
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'confirmation',
        description: 'A tool confirmed after the policy broke.',
        graph: makeGraph(),
        graphVersion: 1,
        corrections: [],
        answers: [],
        resolutionNotes: [],
        useCaseId,
        plainAnswers: { '1': 'Tool' },
        assumptions: [],
      }),
    );
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));

    // Not stuck: the reason is shown and the person is back at their answers.
    expect(await screen.findByText(/evaluation could not complete: .*rules file has a problem/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Evaluating…$/)).not.toBeInTheDocument();
    // Nothing reached the append-only trail.
    expect(await getAll(useCaseId)).toEqual([]);
    sessionStorage.clear();
  });
});

// Found by R16-F review pass 2: the record check before Confirm
// (confirmationPrecondition) sat outside any error handling. A browser-storage
// read failure there escaped as an unhandled rejection and left the in-flight
// guard set — Confirm went dead with no message. The store is this app's I/O
// boundary, so the failure is simulated there.
describe('R16-F review pass 2: a failed record check before Confirm is shown, and Confirm stays usable', () => {
  it('TC-R16-F-68: the record check failing writes nothing, says so in plain words, and a second press goes through', async () => {
    const useCaseId = 'uc-r16f-check-failed';
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'confirmation',
        description: 'A tool whose record check fails once.',
        graph: makeGraph(),
        graphVersion: 1,
        corrections: [],
        answers: [],
        resolutionNotes: [],
        useCaseId,
        plainAnswers: { '1': 'Tool' },
        assumptions: [],
      }),
    );
    const spy = vi
      .spyOn(registerModule, 'confirmationPrecondition')
      .mockRejectedValueOnce(new Error('simulated storage read failure'));
    try {
      render(<App />);
      await userEvent.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));

      expect(await screen.findByText(/couldn.t check this case.s record just now, so nothing was saved/i)).toBeInTheDocument();
      expect(await getAll(useCaseId)).toEqual([]);
      const confirm = screen.getByRole('button', { name: /confirm and evaluate/i });
      expect(confirm).toBeEnabled();

      // Transient: the next press runs the real check and goes through.
      await userEvent.click(confirm);
      await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
      expect((await getAll(useCaseId)).map((e) => e.event_type)).toEqual(['use_case_created', 'graph_confirmed', 'verdict_produced']);
    } finally {
      spy.mockRestore();
      sessionStorage.clear();
    }
  });
});

// Found by R16-F review pass 3: the transient 'check-failed' message survived
// "Change an answer", so on returning to Confirm the person saw "We couldn't
// check this case's record just now" about a check that had not been run on
// this visit — a false claim.
describe('R16-F review pass 3: a failed-check message does not outlive the attempt it describes', () => {
  it('TC-R16-F-69: after a failed record check, "Change an answer" and back to Confirm shows no stale message', async () => {
    const useCaseId = 'uc-r16f-stale-check-message';
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'confirmation',
        description: 'A tool whose record check fails once.',
        graph: makeGraph(),
        graphVersion: 1,
        corrections: [],
        answers: [],
        resolutionNotes: [],
        useCaseId,
        plainAnswers: {
          '1': 'Stale message probe', '2': 'A tool whose record check fails once.', '3': 'firm-built', '4': 'language',
          '5': ['everyday'], '6': 'read', '7': 'me-or-team', '8': 'operational', '9': 'yes',
          '10': 'small', '11': ['elsewhere-not-sure'], '12': 'no',
        },
        assumptions: [],
      }),
    );
    const spy = vi
      .spyOn(registerModule, 'confirmationPrecondition')
      .mockRejectedValueOnce(new Error('simulated storage read failure'));
    try {
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
      expect(await screen.findByText(/couldn.t check this case.s record just now/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /change an answer/i }));
      await user.click(await screen.findByRole('button', { name: /^continue$/i }));
      await screen.findByRole('button', { name: /confirm and evaluate/i });

      expect(screen.queryByText(/couldn.t check this case.s record just now/i)).not.toBeInTheDocument();
    } finally {
      spy.mockRestore();
      sessionStorage.clear();
    }
  });
});

// Found by R16-F review pass 4: F-1 put the case lock and the record check
// BEFORE the step leaves 'confirmation'. While they ran, "Change an answer"
// stayed usable, so a superseded attempt could still record the OLD answers.
describe('R16-F review pass 4: nothing can change the answers while a confirm is under way', () => {
  it('TC-R16-F-70: while the record check is pending, Confirm and "Change an answer" are disabled and "Confirming…" shows; then the result arrives', async () => {
    const useCaseId = 'uc-r16f-confirm-pending';
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'confirmation',
        description: 'A tool whose record check is slow.',
        graph: makeGraph(),
        graphVersion: 1,
        corrections: [],
        answers: [],
        resolutionNotes: [],
        useCaseId,
        plainAnswers: { '1': 'Tool' },
        assumptions: [],
      }),
    );
    let release: (v: 'ok') => void = () => {};
    const spy = vi
      .spyOn(registerModule, 'confirmationPrecondition')
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    try {
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));

      expect(await screen.findByText('Confirming…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /confirm and evaluate/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /change an answer/i })).toBeDisabled();
      // The resumed-draft banner's own way out is shut too (review pass 5).
      expect(screen.getByRole('button', { name: /start over instead/i })).toBeDisabled();

      release('ok');
      await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
      expect((await getAll(useCaseId)).map((e) => e.event_type)).toEqual(['use_case_created', 'graph_confirmed', 'verdict_produced']);
    } finally {
      spy.mockRestore();
      sessionStorage.clear();
    }
  });
});

// Found by R16-F review pass 5: "pending" ended the moment the step left
// 'confirmation', but the case lock — and the evaluation and its writes — run
// on through 'evaluation_pending'. "Start over instead" re-enabled there, so a
// second case could begin while the first was still running.
describe('R16-F review pass 5: nothing can start a new case while the result is being worked out', () => {
  it('TC-R16-F-71: while the result is being worked out, "Start over instead" stays disabled; once the result is shown a new case can be started', async () => {
    const useCaseId = 'uc-r16f-evaluating-start-over';
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'confirmation',
        description: 'A tool whose result takes a while.',
        graph: makeGraph(),
        graphVersion: 1,
        corrections: [],
        answers: [],
        resolutionNotes: [],
        useCaseId,
        plainAnswers: { '1': 'Tool' },
        assumptions: [],
      }),
    );
    // A gate created up front, so releasing it can never be lost — even if
    // the release runs before the app reaches the held step (the first
    // version of this test assigned the release inside the mock and raced).
    let releaseTrace!: () => void;
    const gate = new Promise<void>((resolve) => { releaseTrace = resolve; });
    const spy = vi
      .spyOn(traceModule, 'generateReasoningTraceForVerdict')
      .mockImplementationOnce(async () => {
        await gate;
        return { ok: false, error: { kind: 'no-api-key', message: 'held' } } as never;
      });
    try {
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
      // Held inside the evaluation itself: the trace step has started.
      await vi.waitFor(() => expect(spy).toHaveBeenCalled());
      expect(screen.getByText('Evaluating…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /start over instead/i })).toBeDisabled();

      releaseTrace();
      await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
      // CI fix (run 37121363027): the verdict text and confirmPending's own
      // clearing (a separate effect, keyed on state.step) land in different
      // render passes — a slower runner can paint "Verdict" one tick before
      // that effect has run. The behaviour is correct either way; wait for
      // the state instead of asserting one render early.
      // CR6 FX-2 pass 3 (TC-CR6-02k): once the result is shown the case is
      // finished, so the "unfinished pre-check… Start over instead" banner
      // is withdrawn (it overclaimed) — starting a new case from here is
      // "+ New pre-check", which must be usable. What this test pins (no
      // new case while the result is being worked out) is unchanged above.
      await waitFor(() => expect(screen.queryByRole('button', { name: /start over instead/i })).not.toBeInTheDocument());
      // Final review M-2: that sidebar button is never disabled, so being
      // enabled proves nothing — USE it and show a new case really starts.
      await userEvent.click(screen.getByRole('button', { name: /new pre-check/i }));
      expect(await screen.findByLabelText(/what ai tool do you want to use/i)).toHaveValue('');
      expect(screen.queryByText('Verdict', { selector: '.verdict__eyebrow' })).not.toBeInTheDocument();
    } finally {
      spy.mockRestore();
      sessionStorage.clear();
    }
  });
});
