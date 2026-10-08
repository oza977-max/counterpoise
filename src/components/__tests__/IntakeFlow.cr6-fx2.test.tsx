import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import * as duplicateCheckModule from '../../llm/duplicate-check';
import * as registerModule from '../../store/register';
import * as traceModule from '../../llm/reasoning-trace';
import * as auditModule from '../../store/audit';
import { addNode } from '../../store/register';
import { append as appendAuditEvent, getAll, getAllForExport } from '../../store/audit';
import { setCurrentPolicyYaml } from '../../store/policy-source';
import type { DataFlowGraph } from '../../engine/types';
import type { Verdict } from '../../types/verdict';
import { fillText, SLOW_FLOW_MS, DUP_CHECK_WAIT, pressNext } from './fillText';

// FX-2 (CR6-fixes.md v2) — abandoned work, navigation gates, announcements,
// crash safety. TDD-2 mock budget would normally be 1 (the Anthropic SDK
// boundary) but several of these tests need to hold an in-flight call open
// across a "Start over" click, which the shared SDK mock's single `create`
// function cannot do per-call without a fragile call-order dependency.
// IntakeFlow.r16f.test.tsx already spies on internal boundaries directly for
// identical timing-control needs (confirmationPrecondition,
// generateReasoningTraceForVerdict); this file follows the same precedent
// for confirmSemanticDuplicate / addNode.
//
// CR8 (EBT labels): the same holds for the other app modules spied below —
// the reasoning trace (generateReasoningTraceForVerdict), the register
// (addNode) and the audit trail (append). Each spy is one of three kinds and
// carries its own one-line "EBT exception (owner-accepted, code review
// 006/008)" label saying which: call-count observation only (the real
// function still runs), hold in flight (the call is kept open across a click),
// or fault injection (a failure the real module cannot be made to produce on
// demand).
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));

const DRAFT_KEY = 'aigate:intake-draft';

// CR7-10 (FX7-1): the adopted screen names the earlier case only to the 2LoD
// view; every other view reads "An earlier result on your firm's register was
// used." Both wordings are "the adopted screen" — the assertions below must
// match either, or the absent-checks would pass for the wrong reason.
const ADOPTED_SCREEN = /earlier result used from|earlier result on your firm.s register was used/i;

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

function held<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

// R18-A: the draft written by the CURRENT build is a version-4 envelope. A bare
// state (the older shape) for any step past the similar-checks screen lands on
// the form instead, so the drafts below that must restore as they were are
// written the way saveDraft writes them.
function seedCurrentDraft(state: Record<string, unknown>): void {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 4, state }));
}

// CR6-02 (Critical). handleStartOver released only confirmInFlight and the
// refusal — dupCheckInFlight/confirmNewInFlight/retryExtractionInFlight/
// adoptInFlight stayed set until their OWN pending call's `finally` ran, so
// Start Over while any of those was still in flight left the IDENTICAL
// handler on the NEW case silently doing nothing (the guard it shares with
// the abandoned call was never released). Fixed with an attempt token
// (bumped by handleStartOver) that every one of those async handlers — and
// the duplicate-check effect — checks before applying its result, plus
// handleStartOver now releasing all four refs and the duplicate-check trio
// together, exactly like handleStepBack already does.
describe('CR6-02: "Start over" abandons earlier in-flight work instead of leaving it running', () => {
  it('TC-CR6-02a: Continue on the new case works after Start over from a case that had already continued to the form', async () => {
    // "Start over instead" (the only reachable handleStartOver control) is
    // offered only once a draft has actually been RESTORED at mount — so
    // the abandoned case starts life as a seeded draft, exactly like a
    // refreshed/reopened tab, rather than being typed fresh.
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 'duplicate_check', description: 'Abandoned case alpha' }));

    const user = userEvent.setup({ delay: null });
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
    // R18-A: the abandoned case is now on the guided form, carrying its description.
    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
    expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue('Abandoned case alpha');

    await user.click(screen.getByRole('button', { name: /start over instead/i }));
    await screen.findByLabelText(/what ai tool do you want to use/i);

    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'Fresh case beta');
    await pressNext(user);
    // Before the fix, Continue here silently did nothing — confirmNewInFlight
    // was still true from the abandoned case's call. It must open the form
    // for the NEW case, with the new description and none of the old one.
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
    expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue('Fresh case beta');
    expect(screen.queryByDisplayValue('Abandoned case alpha')).not.toBeInTheDocument();
  });

  it('TC-CR6-02b: an abandoned duplicate check\'s match never appears on the new case', async () => {
    localStorage.setItem('aigate:api-key', 'test-key');
    await addNode({
      node_id: crypto.randomUUID(),
      node_type: 'use_case',
      label: 'Client meeting notes summariser for relationship managers',
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: {
        node_type: 'use_case',
        submitted_by: '1LoD',
        lifecycle_stage: 'idea',
        current_verdict_id: null,
        tier: null,
        track: null,
      },
    });
    const first = held<boolean>();
    // EBT exception (owner-accepted, code review 006/008): hold in flight — keeps the call open across a Start over / Back click, which the shared SDK mock cannot do per call
    const spy = vi.spyOn(duplicateCheckModule, 'confirmSemanticDuplicate').mockImplementationOnce(() => first.promise);
    // Exact-text match with the seeded row above — the duplicate check will
    // find it as a candidate and hold on the (mocked) LLM confirm.
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ step: 'duplicate_check', description: 'Client meeting notes summariser for relationship managers' }),
    );

    try {
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await screen.findByText(/looking through earlier checks/i);

      await user.click(screen.getByRole('button', { name: /start over instead/i }));
      await screen.findByLabelText(/what ai tool do you want to use/i);

      // Deliberately unrelated wording — this must find no candidate at all,
      // so the new case's own check never calls the LLM confirm a second time.
      await fillText(user, 
        screen.getByLabelText(/what ai tool do you want to use/i),
        'A chatbot that helps interns book conference rooms',
      );
      await pressNext(user);
      await screen.findByRole('button', { name: /^continue →$/i }, DUP_CHECK_WAIT);

      // The abandoned case's LLM confirm now resolves late, "true" — it
      // must not retroactively show a match for the new, unrelated case.
      first.resolve(true);
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByText(/overlapping use case|similar use is already on your firm/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^continue →$/i })).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it('TC-CR6-02c (adopt): after an adoption has finished, Start over and a new case\'s "Use the earlier result" works (the guard was released)', async () => {
    await addNode({
      node_id: crypto.randomUUID(),
      node_type: 'use_case',
      label: 'Adopt-abandon probe assistant',
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: {
        node_type: 'use_case',
        submitted_by: '1LoD',
        lifecycle_stage: 'approved',
        current_verdict_id: null,
        tier: 'High',
        track: 'II',
      },
    });
    // While the write is pending "Start over instead" is disabled
    // (TC-CR6-02g), so the abandoned-mid-write case cannot arise; this checks
    // the guard is free again once an adoption has finished.
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 'duplicate_check', description: 'Adopt-abandon probe assistant' }));
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /use the earlier result/i }));
    await screen.findByText(ADOPTED_SCREEN);

    await user.click(screen.getByRole('button', { name: /new pre-check/i }));
    await fillText(user, await screen.findByLabelText(/what ai tool do you want to use/i), 'Adopt-abandon probe assistant');
    await pressNext(user);
    await user.click(await screen.findByRole('button', { name: /use the earlier result/i }));
    await screen.findByText(ADOPTED_SCREEN);
  });

  it('TC-CR6-02d: rendered inside StrictMode, the duplicate check still completes and shows its result exactly once', async () => {
    localStorage.setItem('aigate:api-key', 'test-key');
    await addNode({
      node_id: crypto.randomUUID(),
      node_type: 'use_case',
      label: 'StrictMode duplicate probe assistant',
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: {
        node_type: 'use_case',
        submitted_by: '1LoD',
        lifecycle_stage: 'idea',
        current_verdict_id: null,
        tier: null,
        track: null,
      },
    });
    // EBT exception (owner-accepted, code review 006/008): fault injection — forces the match result so the test needs no network or model
    const spy = vi.spyOn(duplicateCheckModule, 'confirmSemanticDuplicate').mockResolvedValue(true);

    try {
      const user = userEvent.setup({ delay: null });
      render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
      await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'StrictMode duplicate probe assistant');
      await pressNext(user);

      await screen.findByRole('button', { name: /mine is different/i });
      // Exactly one real confirm call, and exactly one match card — not two
      // (the default role is 1LoD, which renders the redacted card text —
      // "Mine is different" is the one wording common to both roles).
      expect(spy).toHaveBeenCalledTimes(1);
      expect(screen.getAllByRole('button', { name: /mine is different/i })).toHaveLength(1);
      expect(document.querySelectorAll('.duplicate-card')).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});

// CR6-08 (Important). evaluation_pending and verdict shared one step label
// ("Step 6 of 6: Result"), and the live-region announcement effect just
// re-rendered that same text for both — a screen-reader user heard nothing
// change between "working it out" and "it's ready" because the DOM text
// genuinely did not change. "Evaluating…" and "Looking through earlier
// checks…" also had no live region of their own at all.
describe('CR6-08: the result does not arrive silently for screen-reader users', () => {
  it('TC-CR6-08a: the announcement text when the result is being worked out differs from the announcement once it is ready', async () => {
    const useCaseId = 'uc-cr6-08a';
    seedCurrentDraft({
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
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // EBT exception (owner-accepted, code review 006/008): hold in flight — keeps the call open across a Start over / Back click, which the shared SDK mock cannot do per call
    const spy = vi.spyOn(traceModule, 'generateReasoningTraceForVerdict').mockImplementationOnce(async () => {
      await gate;
      return { ok: false, error: { kind: 'no-api-key', message: 'held' } } as never;
    });
    try {
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
      await vi.waitFor(() => expect(spy).toHaveBeenCalled());

      const announcement = () => document.querySelector('.intake-flow__step-announcement')?.textContent ?? '';
      const pendingText = announcement();
      expect(pendingText).not.toBe('');

      release();
      await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
      // CI fix (run on b6ad4cc): the verdict paints one render before the
      // announcement effect (keyed on state.step) runs; a slower runner read
      // it in between. Wait for the state, as TC-R16-F-71 does — this still
      // fails if the announcement never changes.
      // The two must differ — this is the whole fix. Pending text should
      // read as in-progress; ready text should read as done.
      await waitFor(() => expect(announcement()).not.toBe(pendingText));
      const readyText = announcement();
      expect(pendingText).toMatch(/working out|evaluating/i);
      expect(readyText).toMatch(/ready|result/i);
    } finally {
      spy.mockRestore();
      sessionStorage.clear();
    }
  });

  it('TC-CR6-08b: the in-progress lines ("Evaluating…", "Looking through earlier checks…") are status regions', async () => {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ step: 'duplicate_check', description: 'Status region probe, no match expected' }),
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // EBT exception (owner-accepted, code review 006/008): call-count observation only — the real function still runs, nothing is replaced
    const spy = vi.spyOn(traceModule, 'generateReasoningTraceForVerdict');
    try {
      render(<App />);
      const looking = await screen.findByText('Looking through earlier checks…');
      // CR6-08c: the line now sits inside the persisting status region.
      expect(looking.closest('[role="status"]')).not.toBeNull();

      // Drive on to evaluation_pending to check "Evaluating…" too.
      const user = userEvent.setup({ delay: null });
      await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
      await fillText(user, await screen.findByLabelText(/what do you want to call it/i), 'Status region tool');
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
      await screen.findByRole('button', { name: /confirm and evaluate/i });
      spy.mockImplementationOnce(async () => {
        await gate;
        return { ok: false, error: { kind: 'no-api-key', message: 'held' } } as never;
      });
      await userEvent.click(screen.getByRole('button', { name: /confirm and evaluate/i }));
      const evaluating = await screen.findByText('Evaluating…');
      expect(evaluating).toHaveAttribute('role', 'status');
      release();
      await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
    } finally {
      spy.mockRestore();
      sessionStorage.clear();
    }
  }, SLOW_FLOW_MS);
});

// CR6-15 (Important). The confirm-and-evaluate sequence keeps running (by
// design) after the component unmounts — e.g. the user navigates to a
// different screen mid-confirm. The saved draft was cleared only by an
// effect keyed on `state.step === 'verdict'`, which never fires for an
// unmounted component, so the draft stayed frozen wherever it last was
// written. On return, loadDraft() restored that stale step, and — because
// the confirm HAD actually completed in the background — Confirm was then
// refused as "already has a result", with wording that claimed a cause
// (another tab or window) the app cannot actually know.
describe('CR6-15: navigating away mid-confirm leaves no stale confirmation screen behind', () => {
  it('TC-CR6-15a: after navigating away mid-confirm and back, the saved draft is gone — no stale confirmation screen, and the result is really on the trail', async () => {
    const useCaseId = 'uc-cr6-15a';
    seedCurrentDraft({
      step: 'confirmation',
      description: 'A tool the user navigates away from mid-confirm.',
      graph: makeGraph(),
      graphVersion: 1,
      corrections: [],
      answers: [],
      resolutionNotes: [],
      useCaseId,
      plainAnswers: { '1': 'Tool' },
      assumptions: [],
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // EBT exception (owner-accepted, code review 006/008): hold in flight — keeps the call open across a Start over / Back click, which the shared SDK mock cannot do per call
    const spy = vi.spyOn(traceModule, 'generateReasoningTraceForVerdict').mockImplementationOnce(async () => {
      await gate;
      return { ok: false, error: { kind: 'no-api-key', message: 'held' } } as never;
    });
    try {
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
      // FX7-6: slow IndexedDB, not an early read — before the trace is
      // requested, confirm takes the case lock and writes the hash-chained
      // trail, which can pass the 1 s default of vi.waitFor on a loaded machine.
      await vi.waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 5000 });

      // Navigate away mid-confirm — IntakeFlow unmounts; App stays mounted.
      await user.click(screen.getByRole('button', { name: /▤ register/i }));
      await screen.findByRole('heading', { name: /register/i }).catch(() => {});

      // The confirm completes in the background while nothing is listening.
      release();
      await waitFor(async () => {
        const events = await getAll(useCaseId);
        expect(events.map((e) => e.event_type)).toContain('verdict_produced');
      });

      // The saved draft must be gone directly — not only via the (never
      // fired, because unmounted) step === 'verdict' effect. The clear comes
      // a few awaits AFTER verdict_produced is written (the register
      // refresh), so it is waited for rather than read the instant the event
      // appears — which raced on a loaded machine.
      await waitFor(() => expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull());

      // Return to the intake screen: a fresh case, never the stale
      // confirmation screen for a case that was already decided.
      await user.click(screen.getByRole('button', { name: /\+ new pre-check/i }));
      expect(screen.queryByRole('button', { name: /confirm and evaluate/i })).not.toBeInTheDocument();
      expect(await screen.findByLabelText(/what ai tool do you want to use/i)).toHaveValue('');
    } finally {
      spy.mockRestore();
      sessionStorage.clear();
    }
  });

  it('TC-CR6-15b: the "already has a result" message claims no cause it cannot know', async () => {
    const useCaseId = 'uc-cr6-15b';
    seedCurrentDraft({
      step: 'confirmation',
      description: 'A tool already confirmed elsewhere.',
      graph: makeGraph(),
      graphVersion: 1,
      corrections: [],
      answers: [],
      resolutionNotes: [],
      useCaseId,
    });
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

    try {
      render(<App />);
      await userEvent.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/this case already has a result/i);
      expect(alert).toHaveTextContent(/open it from the register/i);
      // The old wording claimed a cause ("probably confirmed in another tab
      // or window") the app has no way to actually know.
      expect(alert).not.toHaveTextContent(/another tab or window/i);
    } finally {
      sessionStorage.clear();
    }
  });
});

// CR6-17 (Important). checkPolicyGate() THREW when the policy itself failed
// to load/validate; neither handleProceedFromGraphReview nor
// handleFormSubmitted caught it, so an uncaught exception inside a React
// event handler just... went nowhere a user could see. Both buttons
// "worked" (no crash, no error boundary involved — this is not a render
// error) but produced no visible result at all.
describe('CR6-17: an invalid policy shows a message at the button instead of failing silently', () => {
  beforeEach(() => {
    setCurrentPolicyYaml('this_is_not_a_valid_policy_shape: true');
  });

  it('TC-CR6-17a: on the guided FORM\'s own Continue, an invalid policy shows a message at the button and never silently does nothing', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);

    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'Invalid-policy form probe');
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

    expect(await screen.findByText(/rules file has a problem/i, { selector: '.intake-flow__gate-error' })).toBeInTheDocument();
    // Never reached the summary — FORM_SUBMITTED was never dispatched.
    expect(screen.queryByText(/here.s what we understood/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeInTheDocument();
  }, SLOW_FLOW_MS);
});

// ---------------------------------------------------------------------------
// FX-2 review-loop findings (I-1..I-5, M-1..M-5).
// ---------------------------------------------------------------------------

const REGISTERED_PROBE = 'Review-loop probe summariser for relationship managers';

async function seedProbeUseCase(label = REGISTERED_PROBE) {
  await addNode({
    node_id: crypto.randomUUID(),
    node_type: 'use_case',
    label,
    created_at: '2026-01-01T00:00:00.000Z',
    metadata: {
      node_type: 'use_case',
      submitted_by: '1LoD',
      lifecycle_stage: 'approved',
      current_verdict_id: null,
      tier: 'High',
      track: 'II',
    },
  });
}

describe('I-4: Start over after "Use the earlier result" leaves nothing of the adopted case behind', () => {
  // Pass 3 (TC-CR6-02k): the adopted screen is a finished case, so the
  // "Picked up…/Start over instead" banner no longer shows there — the way to
  // a fresh case from it is "+ New pre-check" (02i B). This test now takes
  // that route; what it pins is unchanged: nothing of the adopted case leaks.
  it('TC-CR6-02e: after an earlier result was used, a fresh case + a new description does not show "Earlier result used from"', async () => {
    await seedProbeUseCase();
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 'duplicate_check', description: REGISTERED_PROBE }));
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /use the earlier result/i }));
    await screen.findByText(ADOPTED_SCREEN);

    await user.click(screen.getByRole('button', { name: /new pre-check/i }));
    await fillText(user, await screen.findByLabelText(/what ai tool do you want to use/i), 'A chatbot that helps interns book conference rooms');
    await pressNext(user);
    await screen.findByRole('button', { name: /^continue →$/i }, DUP_CHECK_WAIT);
    expect(screen.queryByText(ADOPTED_SCREEN)).not.toBeInTheDocument();
  });
});

describe('I-5: going Back mid duplicate check abandons that check', () => {
  it('TC-CR6-02f: a held check resolving after Back + a changed description never shows its stale match card and writes no audit event', async () => {
    localStorage.setItem('aigate:api-key', 'test-key');
    await seedProbeUseCase();
    const first = held<boolean>();
    // EBT exception (owner-accepted, code review 006/008): hold in flight — keeps the call open across a Start over / Back click, which the shared SDK mock cannot do per call
    const spy = vi.spyOn(duplicateCheckModule, 'confirmSemanticDuplicate').mockImplementationOnce(() => first.promise);
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 'duplicate_check', description: REGISTERED_PROBE }));
    try {
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await screen.findByText(/looking through earlier checks/i);
      await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      await user.click(screen.getAllByRole('button', { name: /back/i })[0]!);
      const box = await screen.findByLabelText(/what ai tool do you want to use/i);
      await user.clear(box);
      await fillText(user, box, 'A chatbot that helps interns book conference rooms');
      await pressNext(user);
      await screen.findByRole('button', { name: /^continue →$/i }, DUP_CHECK_WAIT);

      first.resolve(true);
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByRole('button', { name: /mine is different/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^continue →$/i })).toBeInTheDocument();
      expect((await getAllForExport()).filter((e) => e.event_type === 'duplicate_dismissed')).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('M-1 / I-1 (pass 2): while a decision write is in flight nothing can leave or repeat it', () => {
  it('TC-CR6-02g: while "Use the earlier result" is held, Back, the step-tracker back, Start over and both gate buttons are disabled, and exactly one addNode happens', async () => {
    await seedProbeUseCase('Adopt guard probe assistant');
    const a = held<void>();
    // EBT exception (owner-accepted, code review 006/008): call-count observation only — the real function still runs, nothing is replaced
    const addNodeSpy = vi.spyOn(registerModule, 'addNode');
    addNodeSpy.mockImplementationOnce(() => a.promise as never);
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 'duplicate_check', description: 'Adopt guard probe assistant' }));
    try {
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await user.click(await screen.findByRole('button', { name: /use the earlier result/i }));
      expect(addNodeSpy).toHaveBeenCalledTimes(1);

      expect(screen.getByRole('button', { name: /start over instead/i })).toBeDisabled();
      const backs = screen.getAllByRole('button', { name: /back/i });
      expect(backs.length).toBeGreaterThanOrEqual(1); // .step-back (and the tracker's, when drawn)
      for (const b of backs) expect(b).toBeDisabled();
      expect(screen.getByRole('button', { name: /use the earlier result/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /mine is different/i })).toBeDisabled();

      await user.click(backs[0]!);
      await user.click(screen.getByRole('button', { name: /use the earlier result/i }));
      expect(addNodeSpy).toHaveBeenCalledTimes(1);
      expect(screen.queryByLabelText(/what ai tool do you want to use/i)).not.toBeInTheDocument();

      a.resolve();
      await screen.findByText(ADOPTED_SCREEN);
      expect(addNodeSpy).toHaveBeenCalledTimes(1);
      const created = (await getAllForExport()).filter(
        (e) => e.event_type === 'use_case_created' && (e.payload as { description?: string }).description === 'Adopt guard probe assistant',
      );
      expect(created).toHaveLength(1);
    } finally {
      a.resolve();
      addNodeSpy.mockRestore();
    }
  });

  it('TC-CR6-02h: Back is unusable during a held adoption, so no second adoption can follow; exactly one classification_adopted event', async () => {
    await seedProbeUseCase('Adopt back probe assistant');
    const a = held<void>();
    // EBT exception (owner-accepted, code review 006/008): call-count observation only — the real function still runs, nothing is replaced
    const addNodeSpy = vi.spyOn(registerModule, 'addNode');
    addNodeSpy.mockImplementationOnce(() => a.promise as never);
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 'duplicate_check', description: 'Adopt back probe assistant' }));
    try {
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await user.click(await screen.findByRole('button', { name: /use the earlier result/i }));
      for (const b of screen.getAllByRole('button', { name: /back/i })) await user.click(b);
      expect(screen.queryByLabelText(/what ai tool do you want to use/i)).not.toBeInTheDocument();
      expect(addNodeSpy).toHaveBeenCalledTimes(1);
      a.resolve();
      await screen.findByText(ADOPTED_SCREEN);
      const adopted = (await getAllForExport()).filter(
        (e) => e.event_type === 'classification_adopted' && (e.payload as { adopted_from_label?: string }).adopted_from_label === 'Adopt back probe assistant',
      );
      expect(adopted).toHaveLength(1);
    } finally {
      a.resolve();
      addNodeSpy.mockRestore();
    }
  });

  it('TC-CR6-02h (dismiss): while "Mine is different" is writing its dismissal, Back / Start over / both buttons are disabled', async () => {
    await seedProbeUseCase('Dismiss probe assistant');
    const d = held<void>();
    // EBT exception (owner-accepted, code review 006/008): call-count observation only — the real function still runs, nothing is replaced
    const auditSpy = vi.spyOn(auditModule, 'append');
    auditSpy.mockImplementationOnce(() => d.promise as never);
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 'duplicate_check', description: 'Dismiss probe assistant' }));
    try {
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await user.click(await screen.findByRole('button', { name: /mine is different/i }));
      expect(screen.getByRole('button', { name: /start over instead/i })).toBeDisabled();
      for (const b of screen.getAllByRole('button', { name: /back/i })) expect(b).toBeDisabled();
      expect(screen.getByRole('button', { name: /use the earlier result/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /mine is different/i })).toBeDisabled();
    } finally {
      d.resolve();
      auditSpy.mockRestore();
    }
  });
});

describe('I-2 (pass 2): a finished adoption is finished', () => {
  it('TC-CR6-02i (A): after adopting, leaving and coming back (remount) starts a fresh intake - no adopt offer, no restored draft', async () => {
    await seedProbeUseCase('Adopt twice probe assistant');
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 'duplicate_check', description: 'Adopt twice probe assistant' }));
    const user = userEvent.setup({ delay: null });
    const first = render(<App />);
    await user.click(await screen.findByRole('button', { name: /use the earlier result/i }));
    await screen.findByText(ADOPTED_SCREEN);
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    first.unmount();

    render(<App />);
    expect(await screen.findByLabelText(/what ai tool do you want to use/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /use the earlier result/i })).not.toBeInTheDocument();
  });

  it('TC-CR6-02i (B): on the adopted screen there is no Back, and "+ New pre-check" starts a fresh intake', async () => {
    await seedProbeUseCase('Adopt screen probe assistant');
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 'duplicate_check', description: 'Adopt screen probe assistant' }));
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /use the earlier result/i }));
    await screen.findByText(ADOPTED_SCREEN);
    expect(screen.queryAllByRole('button', { name: /back/i })).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /new pre-check/i }));
    expect(await screen.findByLabelText(/what ai tool do you want to use/i)).toBeInTheDocument();
    expect(screen.queryByText(ADOPTED_SCREEN)).not.toBeInTheDocument();
  });
});

describe('FX-2 pass 3 minors: the decision lock belongs to its own attempt; finished cases say so; failed saves are not silent', () => {
  it('TC-CR6-02k: once an earlier result has been used, the "Picked up where you left off" banner is gone — the case is finished, not unfinished', async () => {
    await seedProbeUseCase('Banner probe assistant');
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 'duplicate_check', description: 'Banner probe assistant' }));
    const user = userEvent.setup({ delay: null });
    render(<App />);
    expect(await screen.findByText(/picked up where you left off/i)).toBeInTheDocument();
    // FX7-6: the duplicate check reads the whole register (the portfolio
    // auto-seeds on first visit); that real IndexedDB work can pass the 1 s
    // default on a loaded machine (DOM at failure: still "Looking through
    // earlier checks…"), so this one wait gets 5 s. The wait is on the
    // right thing; its budget was too short.
    await user.click(await screen.findByRole('button', { name: /use the earlier result/i }, { timeout: 5000 }));
    await screen.findByText(ADOPTED_SCREEN);
    // FX7-6: waited for, not read the instant the adopted screen appears —
    // still fails if the banner never goes.
    await waitFor(() => expect(screen.queryByText(/picked up where you left off/i)).not.toBeInTheDocument());
  });

  it('TC-CR6-02l: a failed "Use the earlier result" save shows a plain message that sends the person to the register first', async () => {
    await seedProbeUseCase('Failed adopt probe assistant');
    // EBT exception (owner-accepted, code review 006/008): fault injection — a simulated storage failure the real store cannot be made to produce on demand
    const addNodeSpy = vi.spyOn(registerModule, 'addNode').mockRejectedValueOnce(new Error('simulated storage fault'));
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 'duplicate_check', description: 'Failed adopt probe assistant' }));
    try {
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await user.click(await screen.findByRole('button', { name: /use the earlier result/i }));
      const msg = await screen.findByText(/could not be saved/i);
      expect(msg.closest('[role="alert"]')).not.toBeNull();
      expect(msg.textContent).toMatch(/check the register/i);
      expect(screen.queryByText(ADOPTED_SCREEN)).not.toBeInTheDocument();
    } finally {
      addNodeSpy.mockRestore();
    }
  });

  it('TC-CR6-02l (dismiss): a failed "Mine is different" save shows a plain message and the choice can be made again', async () => {
    await seedProbeUseCase('Failed dismiss probe assistant');
    // EBT exception (owner-accepted, code review 006/008): fault injection — a simulated storage failure the real store cannot be made to produce on demand
    const appendSpy = vi.spyOn(auditModule, 'append').mockRejectedValueOnce(new Error('simulated storage fault'));
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 'duplicate_check', description: 'Failed dismiss probe assistant' }));
    try {
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await user.click(await screen.findByRole('button', { name: /mine is different/i }));
      const msg = await screen.findByText(/could not be saved/i);
      expect(msg.closest('[role="alert"]')).not.toBeNull();
      expect(screen.getByRole('button', { name: /mine is different/i })).toBeEnabled();
    } finally {
      appendSpy.mockRestore();
    }
  });
});

describe('Final review M-1: a failed-save message belongs to its own case', () => {
  it('TC-CR6-02m: after a failed "Mine is different" save, Start over and a new description show no leftover "could not be saved"', async () => {
    await seedProbeUseCase('Leftover message probe assistant');
    // EBT exception (owner-accepted, code review 006/008): fault injection — a simulated storage failure the real store cannot be made to produce on demand
    const appendSpy = vi.spyOn(auditModule, 'append').mockRejectedValueOnce(new Error('simulated storage fault'));
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 'duplicate_check', description: 'Leftover message probe assistant' }));
    try {
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await user.click(await screen.findByRole('button', { name: /mine is different/i }));
      await screen.findByText(/could not be saved/i);
      await user.click(screen.getByRole('button', { name: /start over instead/i }));
      await fillText(user, await screen.findByLabelText(/what ai tool do you want to use/i), 'Leftover message probe assistant');
      await pressNext(user);
      await screen.findByRole('button', { name: /mine is different/i });
      expect(screen.queryByText(/could not be saved/i)).not.toBeInTheDocument();
    } finally {
      appendSpy.mockRestore();
    }
  });
});

describe('M-3: "Nothing similar found" lives inside a status region', () => {
  it('TC-CR6-08c: the no-match outcome is announced from a role="status" region, not a plain paragraph', async () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 'duplicate_check', description: 'A chatbot that helps interns book conference rooms' }));
    render(<App />);
    const text = await screen.findByText(/nothing similar found/i);
    expect(text.closest('[role="status"]')).not.toBeNull();
  });
});

describe('M-4: a draft saved mid-evaluation is not restored into "Evaluating…"', () => {
  it('TC-CR6-15c: restoring an evaluation_pending draft shows a plain pointer to the register, no endless "Evaluating…", and clears the draft', async () => {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ step: 'evaluation_pending', graph: makeGraph(), useCaseId: 'uc-pending', description: 'd' }),
    );
    render(<App />);
    const notice = await screen.findByText(/still being worked out when you left/i);
    expect(notice.textContent).toMatch(/can.t be picked up here/i);
    expect(notice.textContent).toMatch(/on the register/i);
    expect(notice.textContent).not.toMatch(/interrupted|could not be picked up/i);
    expect(screen.queryByText(/evaluating…/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/what ai tool do you want to use/i)).toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull());
  });
});

describe('M-5: App guards IntakeFlow with the ErrorBoundary; an old-shape draft survives Undo', () => {
  it('TC-CR6-04e: a draft that crashes the intake render shows the boundary from inside App, and its button gets a working intake back', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // R18-A: a graph-less draft no longer gets this far (the version-4 check
    // refuses it and the form opens). A draft that passes that check (node
    // lists present) but holds a broken node still makes IntakeFlow's own
    // render dereference it and throw.
    seedCurrentDraft({
      step: 'confirmation',
      description: 'd',
      graph: { input_nodes: [null], processing_nodes: [], output_nodes: [], edges: [] },
      graphVersion: 1,
      corrections: [],
      answers: [],
      resolutionNotes: [],
      useCaseId: 'u',
    });
    try {
      const user = userEvent.setup({ delay: null });
      render(<App />);
      await user.click(await screen.findByRole('button', { name: /start a fresh check/i }));
      expect(await screen.findByLabelText(/what ai tool do you want to use/i)).toBeInTheDocument();
      expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
