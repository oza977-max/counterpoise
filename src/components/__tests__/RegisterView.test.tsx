import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps } from 'react';
import RegisterView from '../RegisterView';
import { addNode } from '../../store/register';
import { append } from '../../store/audit';
import type { RegisterNode, RegisterNodeMetadata } from '../../store/types';
import type { Verdict } from '../../types/verdict';

// code-review-004 F1: RegisterView is a controlled component now — App owns
// selection + history. This harness supplies the minimal controlled wiring
// (plain state, no history) so these behavioural tests keep exercising the
// row-click -> detail -> back flow; the HISTORY semantics live in App and
// are covered by App.browserBack.test.tsx.
function RegisterViewHarness(props: Omit<ComponentProps<typeof RegisterView>, 'selectedId' | 'onSelectRow' | 'onCloseDetail'>) {
  const [sel, setSel] = useState<string | null>(null);
  return (
    <RegisterView {...props} selectedId={sel} onSelectRow={setSel} onCloseDetail={() => setSel(null)} />
  );
}


function makeUseCaseMetadata(
  overrides: Partial<Extract<RegisterNodeMetadata, { node_type: 'use_case' }>> = {},
): RegisterNodeMetadata {
  return {
    node_type: 'use_case',
    submitted_by: '1LoD',
    // R15-C1 renegotiation: default changed from 'idea' to 'pre_checked' so
    // these fixtures land in the 2LoD default "awaiting your sign-off" view
    // without every test needing to click "Show all" — preserves each
    // test's original intent (rows visible immediately after render).
    lifecycle_stage: 'pre_checked',
    current_verdict_id: null,
    tier: 'High',
    track: 'II',
    ...overrides,
  };
}

function makeUseCaseNode(overrides: Partial<RegisterNode> = {}): RegisterNode {
  return {
    node_id: overrides.node_id ?? crypto.randomUUID(),
    node_type: 'use_case',
    label: 'A tool that drafts client emails',
    created_at: new Date().toISOString(),
    metadata: makeUseCaseMetadata(),
    ...overrides,
  };
}

describe('RegisterView', () => {
  it('TC-RG-2-01: 1LoD view shows only the current actor\'s use cases with the §10.1 column set', async () => {
    const own = makeUseCaseNode({ node_id: crypto.randomUUID(), label: 'Mine' });
    const other = makeUseCaseNode({
      node_id: crypto.randomUUID(),
      label: 'Not mine',
      metadata: makeUseCaseMetadata({ submitted_by: 'other-actor' }),
    });
    await addNode(own);
    await addNode(other);

    render(<RegisterViewHarness role="1LoD" currentPolicyVersion="1.0" />);

    expect(await screen.findByText('Mine')).toBeInTheDocument();
    expect(screen.queryByText('Not mine')).not.toBeInTheDocument();
    // §10.1: no filter chips, no search bar in the 1LoD view.
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
  });

  // R15-C1/S4 renegotiation: register-lifecycle.md §10.2's Must-level column
  // set is amended (Stale + Sampling merge into one "Flags" column, Stage
  // joins the visible columns) — see the spec changelog entry dated
  // 2026-08-25. This test now asserts the amended set instead of the old
  // Stale-only column.
  it('TC-RG-2-02: 2LoD view shows all use cases across submitters with the amended §10.2 column set (Flags merged)', async () => {
    const a = makeUseCaseNode({ node_id: crypto.randomUUID(), label: 'From A' });
    const b = makeUseCaseNode({
      node_id: crypto.randomUUID(),
      label: 'From B',
      metadata: makeUseCaseMetadata({ submitted_by: 'actor-b' }),
    });
    await addNode(a);
    await addNode(b);

    render(<RegisterViewHarness role="2LoD" currentPolicyVersion="1.0" />);

    expect(await screen.findByText('From A')).toBeInTheDocument();
    expect(screen.getByText('From B')).toBeInTheDocument();
    expect(screen.getAllByText('1LoD').length + screen.getAllByText('actor-b').length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    // Flags column replaces the separate Stale/Sampling columns.
    expect(screen.getByRole('columnheader', { name: 'Flags' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Stale' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Sampling' })).not.toBeInTheDocument();
  });

  it('2LoD tier filter chip narrows the visible rows', async () => {
    const user = userEvent.setup();
    const high = makeUseCaseNode({ node_id: crypto.randomUUID(), label: 'High tier case' });
    const low = makeUseCaseNode({
      node_id: crypto.randomUUID(),
      label: 'Low tier case',
      metadata: makeUseCaseMetadata({ tier: 'Low' }),
    });
    await addNode(high);
    await addNode(low);

    render(<RegisterViewHarness role="2LoD" currentPolicyVersion="1.0" />);
    await screen.findByText('High tier case');
    expect(screen.getByText('Low tier case')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^High$/i }));

    expect(screen.getByText('High tier case')).toBeInTheDocument();
    expect(screen.queryByText('Low tier case')).not.toBeInTheDocument();
  });

  it('shows a stale badge when stale_assessment is true (verdict policy_version differs from currentPolicyVersion)', async () => {
    const node = makeUseCaseNode({ node_id: crypto.randomUUID(), label: 'Stale case' });
    await addNode(node);
    await append({
      event_id: crypto.randomUUID(),
      use_case_id: node.node_id,
      event_type: 'verdict_produced',
      occurred_at: new Date().toISOString(),
      actor: '1LoD',
      payload: {
        type: 'verdict_produced',
        verdict: {
          status: 'approved',
          tier: 'High',
          track: 'II',
          binding_constraint: 'INV-01',
          binding_path: 'a → b',
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
          id: 'v1',
          use_case_id: node.node_id,
          living_status: 'approved',
          living_status_updated_at: new Date().toISOString(),
          attested_by: '1LoD',
          attested_at: new Date().toISOString(),
          graph_version: 1,
          corrections: [],
        },
      },
    });

    render(<RegisterViewHarness role="2LoD" currentPolicyVersion="2.0" />);

    await screen.findByText('Stale case');
    expect(screen.getByText('Stale', { selector: '.register-view__stale-badge' })).toBeInTheDocument();
  });

  it('shows "No use cases submitted yet" for an empty 1LoD register', async () => {
    render(<RegisterViewHarness role="never-used-actor-id" currentPolicyVersion="1.0" />);
    expect(await screen.findByText(/no use cases submitted yet/i)).toBeInTheDocument();
  });

  it('TC-RG-5-01: "Export JSON" button (2LoD only) triggers a download whose Blob contains exported_at, nodes, and edges', async () => {
    const user = userEvent.setup();
    const node = makeUseCaseNode({ node_id: crypto.randomUUID(), label: 'Export target case' });
    await addNode(node);

    // TDD-2 mock budget = 1: jsdom has no real file-download API, and its
    // Blob shim lacks `.text()` — the Blob constructor is intercepted to
    // capture the raw JSON string it was built from instead.
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
      // 1LoD view has no Export button at all (§10.3: 2LoD only).
      const oneLoD = render(<RegisterViewHarness role="1LoD" currentPolicyVersion="1.0" />);
      await oneLoD.findByText('Export target case');
      expect(oneLoD.queryByRole('button', { name: /export json/i })).not.toBeInTheDocument();
      oneLoD.unmount();

      render(<RegisterViewHarness role="2LoD" currentPolicyVersion="1.0" />);
      await screen.findByText('Export target case');

      await user.click(screen.getByRole('button', { name: /export json/i }));

      expect(capturedJson).toBeDefined();
      const parsed = JSON.parse(capturedJson!);
      expect(typeof parsed.exported_at).toBe('string');
      expect(new Date(parsed.exported_at).toString()).not.toBe('Invalid Date');
      expect(Array.isArray(parsed.nodes)).toBe(true);
      expect(Array.isArray(parsed.edges)).toBe(true);
      expect(parsed.nodes.some((n: { node_id: string }) => n.node_id === node.node_id)).toBe(true);
    } finally {
      globalThis.Blob = OriginalBlob;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });
});

// ── V1.2-A: register detail + audit timeline + 2LoD actions ──

async function seedVerdictEvent(useCaseId: string, overrides: Partial<Verdict> = {}) {
  const verdict: Verdict = {
    status: 'approved_with_controls',
    tier: 'High',
    track: 'II',
    binding_constraint: 'INV-DATA-01',
    binding_path: 'a → b',
    controls: ['CTRL-ENC-01'],
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
    id: crypto.randomUUID(),
    use_case_id: useCaseId,
    living_status: 'approved',
    living_status_updated_at: new Date().toISOString(),
    attested_by: '1LoD',
    attested_at: new Date().toISOString(),
    graph_version: 1,
    corrections: [],
    ...overrides,
  };
  await append({
    event_id: crypto.randomUUID(),
    use_case_id: useCaseId,
    event_type: 'graph_confirmed',
    occurred_at: new Date().toISOString(),
    actor: '1LoD',
    payload: { type: 'graph_confirmed', graph_id: 'g1', graph_version: 1, corrections_count: 0 },
  });
  await append({
    event_id: crypto.randomUUID(),
    use_case_id: useCaseId,
    event_type: 'verdict_produced',
    occurred_at: new Date().toISOString(),
    actor: 'system',
    payload: { type: 'verdict_produced', verdict },
  });
  return verdict;
}

describe('RegisterDetail (V1.2-A)', () => {
  it('B3/B4: clicking a register row opens the detail view with the immutable audit-trail timeline', async () => {
    const user = userEvent.setup();
    const node = makeUseCaseNode({ node_id: crypto.randomUUID(), label: 'Timeline probe case' });
    await addNode(node);
    await seedVerdictEvent(node.node_id);

    render(<RegisterViewHarness role="2LoD" currentPolicyVersion="1.0" />);
    await user.click(await screen.findByText('Timeline probe case'));

    expect(await screen.findByText(/audit trail/i, { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByText('graph_confirmed')).toBeInTheDocument();
    expect(screen.getByText('verdict_produced')).toBeInTheDocument();
    expect(screen.getByText(/approved with controls · High · Track II/i)).toBeInTheDocument();
    // explore-007 D-001 fix (round 8): the audit trail is now genuinely
    // hash-chained and verified live, not just asserted as "not
    // tamper-evident" — see the honest-caveat test below for the updated
    // wording and the chain-integrity check it now proves.
    expect(screen.getByText(/hash-chained to the one before it/i)).toBeInTheDocument();
  });

  it('B5: 2LoD Approve appends twoloD_reviewed then lifecycle_stage_changed and advances the stage to approved', async () => {
    const user = userEvent.setup();
    const node = makeUseCaseNode({
      node_id: crypto.randomUUID(),
      label: 'Approval probe case',
      metadata: makeUseCaseMetadata({ lifecycle_stage: 'pre_checked', tier: 'Critical' }),
    });
    await addNode(node);
    await seedVerdictEvent(node.node_id, { tier: 'Critical' });

    render(<RegisterViewHarness role="2LoD" currentPolicyVersion="1.0" />);
    await user.click(await screen.findByText('Approval probe case'));

    expect(await screen.findByText(/awaiting 2LoD action/i)).toBeInTheDocument();
    // Round 4 close-out: the attestation now records who signed, so these
    // pre-existing journeys must name someone — as a real reviewer must.
    await user.type(screen.getByLabelText(/your name/i), 'Priya Nair');
    await user.click(screen.getByRole('button', { name: /^approve$/i }));

    const banner = await screen.findByText(/lifecycle advanced to/i);
    expect(banner).toBeInTheDocument();
    // TC-CR6-29: the success banner never renders the reserved words.
    expect(banner.textContent).not.toMatch(/approved|rejected/i);
    expect(banner.textContent).toMatch(/cleared by 2LoD/i);

    const { getAll } = await import('../../store/audit');
    const events = await getAll(node.node_id);
    const types = events.map((e) => e.event_type);
    const reviewedIdx = types.indexOf('twoloD_reviewed');
    const stageIdx = types.indexOf('lifecycle_stage_changed');
    expect(reviewedIdx).toBeGreaterThan(-1);
    expect(stageIdx).toBeGreaterThan(reviewedIdx);
    const reviewed = events[reviewedIdx]!;
    if (reviewed.payload.type === 'twoloD_reviewed') {
      expect(reviewed.payload.action).toBe('approved');
    }

    const { getUseCase } = await import('../../store/register');
    const summary = await getUseCase(node.node_id);
    expect(summary?.lifecycle_stage).toBe('approved');
  });

  it('B5: Request correction appends twoloD_reviewed (correction_requested, with notes) only — stage unchanged', async () => {
    const user = userEvent.setup();
    const node = makeUseCaseNode({
      node_id: crypto.randomUUID(),
      label: 'Correction request probe',
      metadata: makeUseCaseMetadata({ lifecycle_stage: 'pre_checked' }),
    });
    await addNode(node);
    await seedVerdictEvent(node.node_id);

    render(<RegisterViewHarness role="2LoD" currentPolicyVersion="1.0" />);
    await user.click(await screen.findByText('Correction request probe'));

    await user.type(await screen.findByLabelText(/notes/i), 'Zone looks wrong');
    await user.type(screen.getByLabelText(/your name/i), 'Priya Nair');
    await user.click(screen.getByRole('button', { name: /request correction/i }));

    expect(await screen.findByText(/correction requested — recorded in the audit trail/i)).toBeInTheDocument();

    const { getAll } = await import('../../store/audit');
    const events = await getAll(node.node_id);
    const reviewed = events.find((e) => e.event_type === 'twoloD_reviewed');
    expect(reviewed).toBeDefined();
    if (reviewed?.payload.type === 'twoloD_reviewed') {
      expect(reviewed.payload.action).toBe('correction_requested');
      expect(reviewed.payload.notes).toBe('Zone looks wrong');
    }
    expect(events.some((e) => e.event_type === 'lifecycle_stage_changed')).toBe(false);

    const { getUseCase } = await import('../../store/register');
    const summary = await getUseCase(node.node_id);
    expect(summary?.lifecycle_stage).toBe('pre_checked');
  });

  it('review finding, pass 1: a double-click on Approve writes exactly ONE twoloD_reviewed and ONE lifecycle_stage_changed into the append-only trail', async () => {
    const user = userEvent.setup();
    const node = makeUseCaseNode({
      node_id: crypto.randomUUID(),
      label: 'Double click probe',
      metadata: makeUseCaseMetadata({ lifecycle_stage: 'pre_checked' }),
    });
    await addNode(node);
    await seedVerdictEvent(node.node_id);

    render(<RegisterViewHarness role="2LoD" currentPolicyVersion="1.0" />);
    await user.click(await screen.findByText('Double click probe'));

    // Round 4 close-out: an attestation now names who signed.
    await user.type(screen.getByLabelText(/your name/i), 'Priya Nair');
    const approve = await screen.findByRole('button', { name: /^approve$/i });
    await user.dblClick(approve);

    expect(await screen.findByText(/lifecycle advanced to/i)).toBeInTheDocument();

    const { getAll } = await import('../../store/audit');
    const events = await getAll(node.node_id);
    expect(events.filter((e) => e.event_type === 'twoloD_reviewed')).toHaveLength(1);
    expect(events.filter((e) => e.event_type === 'lifecycle_stage_changed')).toHaveLength(1);
  });

  it('B6/BC-V12A-03: 1LoD sees the scope explainer in the list and NO action bar in the detail view', async () => {
    const user = userEvent.setup();
    const node = makeUseCaseNode({
      node_id: crypto.randomUUID(),
      label: 'Role gate probe',
      metadata: makeUseCaseMetadata({ lifecycle_stage: 'pre_checked' }),
    });
    await addNode(node);
    await seedVerdictEvent(node.node_id);

    render(<RegisterViewHarness role="1LoD" currentPolicyVersion="1.0" />);
    expect(await screen.findByText(/viewing as 1LoD/i)).toBeInTheDocument();

    await user.click(screen.getByText('Role gate probe'));
    expect(await screen.findByText(/audit trail/i, { selector: 'h3' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
  });
});

// explore-002 observation. The heading asserted "Immutable audit trail" above
// the events while the client-side qualifier sat below them — the strong word
// read first, the qualifier last or not at all on a long trail. "Immutable"
// also overstates what a browser-held store can support (NF-2: never claim
// more than can be proved).
describe('RegisterDetail — audit trail honesty (explore-002)', () => {
  it('does not claim immutability, and qualifies the trail before the events are read', async () => {
    const user = userEvent.setup();
    const node = makeUseCaseNode({ node_id: crypto.randomUUID(), label: 'Honesty probe case' });
    await addNode(node);
    await seedVerdictEvent(node.node_id);

    render(<RegisterViewHarness role="2LoD" currentPolicyVersion="1.0" />);
    await user.click(await screen.findByText('Honesty probe case'));

    expect(await screen.findByText(/audit trail/i, { selector: 'h3' })).toBeInTheDocument();
    expect(screen.queryByText(/immutable/i)).not.toBeInTheDocument();
    // explore-007 D-001 fix (round 8): the trail is now genuinely
    // hash-chained (detectable tampering) but still honestly qualified —
    // it's client-side, so a full consistent rewrite can't be ruled out.
    expect(screen.getByText(/hash-chained to the one before it/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot rule out someone with full local access/i)).toBeInTheDocument();

    // The qualifier must PRECEDE the events in document order — that was the
    // whole finding, not the wording alone.
    // P8-C07 upstream fix. The sign-off page now renders VerdictDisplay, which
    // carries its own NF-2 caveat (VerdictDisplay.tsx:601), so this query
    // matched two elements. Scoped to the PAGE's caveat — which is the one
    // whose document position this test is actually about. Same collision
    // class as HR3-08, different string: a single-match query on text that a
    // newly-reused component also renders.
    const caveat = screen.getByText(/client-side, browser-held store/i);
    const firstEvent = screen.getByText('graph_confirmed');
    expect(caveat.compareDocumentPosition(firstEvent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
