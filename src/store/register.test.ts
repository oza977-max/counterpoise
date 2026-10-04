import { describe, it, expect, vi } from 'vitest';
import {
  addNode,
  addEdge,
  getUseCases,
  getUseCase,
  getBlastRadius,
  updateLifecycleStage,
  updateUseCaseVerdictSummary,
  exportAll,
  findLatestVerdictEvent,
  confirmationPrecondition,
} from './register';
import { getAll, append } from './audit';
import type { AuditEvent, RegisterNode, RegisterEdge } from './types';
import type { Verdict } from '../types/verdict';

function makeVerdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
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

function makeUseCaseNode(overrides: Partial<RegisterNode> = {}): RegisterNode {
  return {
    node_id: overrides.node_id ?? crypto.randomUUID(),
    node_type: 'use_case',
    label: 'A tool that drafts client emails',
    created_at: new Date().toISOString(),
    metadata: {
      node_type: 'use_case',
      submitted_by: 'user-1',
      lifecycle_stage: 'idea',
      current_verdict_id: null,
      tier: null,
      track: null,
    },
    ...overrides,
  };
}

describe('register store', () => {
  it('addNode() writes a use_case node, getUseCases("all") reads it back as a computed summary', async () => {
    const nodeId = crypto.randomUUID();
    const node = makeUseCaseNode({ node_id: nodeId, label: 'All-role probe' });

    await addNode(node);
    const summaries = await getUseCases('all');
    const found = summaries.find((s) => s.use_case_id === nodeId);

    expect(found).toBeDefined();
    expect(found?.label).toBe('All-role probe');
    expect(found?.submitted_by).toBe('user-1');
    expect(found?.lifecycle_stage).toBe('idea');
  });

  it('getUseCases(actorId) filters via the by_submitted_by index, only returning that actor\'s nodes', async () => {
    const actorA = `actor-a-${crypto.randomUUID()}`;
    const actorB = `actor-b-${crypto.randomUUID()}`;

    const nodeA = makeUseCaseNode({
      node_id: crypto.randomUUID(),
      label: 'Belongs to A',
      metadata: {
        node_type: 'use_case',
        submitted_by: actorA,
        lifecycle_stage: 'idea',
        current_verdict_id: null,
        tier: null,
        track: null,
      },
    });
    const nodeB = makeUseCaseNode({
      node_id: crypto.randomUUID(),
      label: 'Belongs to B',
      metadata: {
        node_type: 'use_case',
        submitted_by: actorB,
        lifecycle_stage: 'idea',
        current_verdict_id: null,
        tier: null,
        track: null,
      },
    });

    await addNode(nodeA);
    await addNode(nodeB);

    const resultsForA = await getUseCases(actorA);

    expect(resultsForA).toHaveLength(1);
    expect(resultsForA[0]?.label).toBe('Belongs to A');
  });

  it('getUseCase(useCaseId) returns a single computed summary', async () => {
    const nodeId = crypto.randomUUID();
    const node = makeUseCaseNode({ node_id: nodeId, label: 'Single lookup probe' });

    await addNode(node);
    const summary = await getUseCase(nodeId);

    expect(summary?.label).toBe('Single lookup probe');
  });

  it('getBlastRadius(componentNodeId) finds nodes referencing a component via edges, O(edges)', async () => {
    const componentId = crypto.randomUUID();
    const useCase1 = makeUseCaseNode({ node_id: crypto.randomUUID(), label: 'Consumer 1' });
    const useCase2 = makeUseCaseNode({ node_id: crypto.randomUUID(), label: 'Consumer 2' });
    const unrelated = makeUseCaseNode({ node_id: crypto.randomUUID(), label: 'Unrelated' });

    // Sequential awaited writes — TDD-3 realistic-fixture check: no race/partial-write
    // between back-to-back addNode calls affects a subsequent read.
    await addNode(useCase1);
    await addNode(useCase2);
    await addNode(unrelated);

    const edge1: RegisterEdge = {
      edge_id: crypto.randomUUID(),
      from_node_id: useCase1.node_id,
      to_node_id: componentId,
      edge_type: 'uses_model',
      created_at: new Date().toISOString(),
    };
    const edge2: RegisterEdge = {
      edge_id: crypto.randomUUID(),
      from_node_id: useCase2.node_id,
      to_node_id: componentId,
      edge_type: 'uses_model',
      created_at: new Date().toISOString(),
    };

    await addEdge(edge1);
    await addEdge(edge2);

    const blastRadius = await getBlastRadius(componentId);
    const ids = blastRadius.map((n) => n.node_id);

    expect(ids).toHaveLength(2);
    expect(ids).toContain(useCase1.node_id);
    expect(ids).toContain(useCase2.node_id);
    expect(ids).not.toContain(unrelated.node_id);
  });

  it('updateLifecycleStage() updates the node and appends a lifecycle_stage_changed audit event in the same call [TC-LC-1-01]', async () => {
    const nodeId = crypto.randomUUID();
    const node = makeUseCaseNode({ node_id: nodeId, label: 'Lifecycle probe' });

    await addNode(node);
    await updateLifecycleStage(nodeId, 'exploring', 'user-1');

    const summary = await getUseCase(nodeId);
    expect(summary?.lifecycle_stage).toBe('exploring');

    const auditEvents = await getAll(nodeId);
    const lifecycleEvent = auditEvents.find((e) => e.event_type === 'lifecycle_stage_changed');

    expect(lifecycleEvent).toBeDefined();
    expect(lifecycleEvent?.actor).toBe('user-1');
    expect(lifecycleEvent?.payload).toEqual({
      type: 'lifecycle_stage_changed',
      from_stage: 'idea',
      to_stage: 'exploring',
    });
  });

  it('updateUseCaseVerdictSummary() updates tier/track/currentVerdictId without throwing (P5-C01 review-caught bug: addNode() on the same node_id twice throws ConstraintError since it uses db.add())', async () => {
    const nodeId = crypto.randomUUID();
    const node = makeUseCaseNode({ node_id: nodeId, label: 'Correction probe' });
    await addNode(node);

    const newVerdictId = crypto.randomUUID();
    await updateUseCaseVerdictSummary(nodeId, { tier: 'High', track: 'II', currentVerdictId: newVerdictId });

    const summary = await getUseCase(nodeId);
    expect(summary?.tier).toBe('High');
    expect(summary?.track).toBe('II');

    const { nodes } = await exportAll();
    const updatedNode = nodes.find((n) => n.node_id === nodeId);
    expect(updatedNode?.metadata.node_type === 'use_case' && updatedNode.metadata.current_verdict_id).toBe(
      newVerdictId,
    );
  });

  it('getUseCase() computes current_verdict_status/last_evaluated_at/policy_version_at_evaluation from the audit trail, not from RegisterNodeMetadata (verdict-audit.md §8) [TC-PE-7-01]', async () => {
    const nodeId = crypto.randomUUID();
    const node = makeUseCaseNode({ node_id: nodeId, label: 'Verdict-scan probe' });
    await addNode(node);

    const verdict = makeVerdict({ id: crypto.randomUUID(), use_case_id: nodeId, status: 'rejected' });
    await append({
      event_id: crypto.randomUUID(),
      use_case_id: nodeId,
      event_type: 'verdict_produced',
      occurred_at: new Date().toISOString(),
      actor: '1LoD',
      payload: { type: 'verdict_produced', verdict },
    });

    const summary = await getUseCase(nodeId);
    expect(summary?.current_verdict_status).toBe('rejected');
    expect(summary?.last_evaluated_at).toEqual(expect.any(String));
    expect(summary?.policy_version_at_evaluation).toBe('1.0');
  });

  // TC-R3-JU-2-03. This is the "reaches a reader" assertion: the engine can
  // compute provisional_reasons perfectly and it is worth nothing if no
  // consumer surfaces it. Regulatory citations were computed and discarded for
  // the whole of V1 with no test failing, because nothing asserted they got
  // out of the engine.
  it('TC-R3-JU-2-03: a submission with no regulatory basis shows Provisional on its register row', async () => {
    const nodeId = crypto.randomUUID();
    await addNode(makeUseCaseNode({ node_id: nodeId, label: 'No jurisdiction answer' }));

    const verdict = makeVerdict({
      id: crypto.randomUUID(),
      use_case_id: nodeId,
      status: 'approved',
      pack_versions: {},
      provisional_reasons: ['no_regulatory_basis'],
    });
    await append({
      event_id: crypto.randomUUID(),
      use_case_id: nodeId,
      event_type: 'verdict_produced',
      occurred_at: new Date().toISOString(),
      actor: '1LoD',
      payload: { type: 'verdict_produced', verdict },
    });

    const summary = await getUseCase(nodeId);
    expect(summary?.provisional).toBe(true);
    // And the outcome survives alongside it (§13.3).
    expect(summary?.current_verdict_status).toBe('approved');
  });

  it('current_verdict_status keeps the real outcome and the provisional qualifier is carried alongside it', async () => {
    const nodeId = crypto.randomUUID();
    const node = makeUseCaseNode({ node_id: nodeId, label: 'Provisional probe' });
    await addNode(node);

    const verdict = makeVerdict({
      status: 'approved_with_controls',
      confidence_caveats: [{ ruleId: 'INV-DATA-01', field: 'model_type', confidence: 'low', reason: 'ambiguous description' }],
      // P8-C04: the engine now names the cause; the row reads it (ADR-EE-R3-1).
      provisional_reasons: ['unsigned_pack_rules'],
    });
    await append({
      event_id: crypto.randomUUID(),
      use_case_id: nodeId,
      event_type: 'verdict_produced',
      occurred_at: new Date().toISOString(),
      actor: '1LoD',
      payload: { type: 'verdict_produced', verdict },
    });

    const summary = await getUseCase(nodeId);
    // P8-C04 upstream fix. This asserted that Provisional REPLACED the status,
    // which contradicts evaluation-engine.md §13.3 — Provisional is a
    // qualifier carried alongside the status, not a fourth status. Replacing
    // it hid whether the provisional verdict was in or out of appetite, on the
    // page a reviewer signs off from.
    expect(summary?.current_verdict_status).toBe('approved_with_controls');
    expect(summary?.provisional).toBe(true);
  });

  it('a verdict_corrected event supersedes an earlier verdict_produced event for the computed summary [TC-VD-3-01]', async () => {
    const nodeId = crypto.randomUUID();
    const node = makeUseCaseNode({ node_id: nodeId, label: 'Correction-supersedes probe' });
    await addNode(node);

    const originalVerdict = makeVerdict({ id: 'v1', status: 'rejected' });
    await append({
      event_id: crypto.randomUUID(),
      use_case_id: nodeId,
      event_type: 'verdict_produced',
      occurred_at: '2026-01-01T00:00:00.000Z',
      actor: '1LoD',
      payload: { type: 'verdict_produced', verdict: originalVerdict },
    });

    const newVerdict = makeVerdict({ id: 'v2', status: 'approved' });
    await append({
      event_id: crypto.randomUUID(),
      use_case_id: nodeId,
      event_type: 'verdict_corrected',
      occurred_at: '2026-01-02T00:00:00.000Z',
      actor: '1LoD',
      payload: { type: 'verdict_corrected', original_verdict_id: 'v1', new_verdict: newVerdict },
    });

    const summary = await getUseCase(nodeId);
    expect(summary?.current_verdict_status).toBe('approved');
  });

  it('stale_assessment is true when policy_version_at_evaluation differs from the passed currentPolicyVersion, false otherwise', async () => {
    const nodeId = crypto.randomUUID();
    const node = makeUseCaseNode({ node_id: nodeId, label: 'Stale probe' });
    await addNode(node);

    const verdict = makeVerdict({ policy_version: '1.0' });
    await append({
      event_id: crypto.randomUUID(),
      use_case_id: nodeId,
      event_type: 'verdict_produced',
      occurred_at: new Date().toISOString(),
      actor: '1LoD',
      payload: { type: 'verdict_produced', verdict },
    });

    const staleSummary = await getUseCase(nodeId, '2.0');
    expect(staleSummary?.stale_assessment).toBe(true);

    const freshSummary = await getUseCase(nodeId, '1.0');
    expect(freshSummary?.stale_assessment).toBe(false);
  });

  it('getUseCases() with no verdict events leaves current_verdict_status null and stale_assessment false', async () => {
    const nodeId = crypto.randomUUID();
    const node = makeUseCaseNode({ node_id: nodeId, label: 'No-verdict probe' });
    await addNode(node);

    const summaries = await getUseCases('all', '1.0');
    const found = summaries.find((s) => s.use_case_id === nodeId);

    expect(found?.current_verdict_status).toBeNull();
    expect(found?.last_evaluated_at).toBeNull();
    expect(found?.policy_version_at_evaluation).toBeNull();
    expect(found?.stale_assessment).toBe(false);
  });

  it('exportAll() returns all nodes and edges (2LoD export)', async () => {
    const node = makeUseCaseNode({ node_id: crypto.randomUUID(), label: 'Export probe' });
    await addNode(node);

    const { nodes, edges } = await exportAll();

    expect(nodes.some((n) => n.node_id === node.node_id)).toBe(true);
    expect(Array.isArray(edges)).toBe(true);
  });
});

// P8-C06. The export is the deliverable, so something must assert it exists
// and behaves — an unexported helper that P8-C07 then re-implements is exactly
// the duplication this chunk removes, and it would not fail any test.
describe('findLatestVerdictEvent (exported for P8-C07)', () => {
  it('returns the most recent verdict-bearing payload, ignoring other event types', () => {
    const first = makeVerdict({ id: 'v1', binding_constraint: 'INV-OLD-01' });
    const second = makeVerdict({ id: 'v2', binding_constraint: 'INV-NEW-01' });

    const events: AuditEvent[] = [
      {
        event_id: 'e1',
        use_case_id: 'uc1',
        event_type: 'verdict_produced',
        occurred_at: '2026-01-01T00:00:00.000Z',
        actor: '1LoD',
        payload: { type: 'verdict_produced', verdict: first },
        prev_hash: null,
        hash: 'test-hash-e1',
      },
      {
        event_id: 'e2',
        use_case_id: 'uc1',
        event_type: 'twoloD_reviewed',
        occurred_at: '2026-01-02T00:00:00.000Z',
        actor: '2LoD',
        payload: { type: 'twoloD_reviewed', action: 'approved', verdict_id: 'v1' },
        prev_hash: 'test-hash-e1',
        hash: 'test-hash-e2',
      },
      {
        event_id: 'e3',
        use_case_id: 'uc1',
        event_type: 'verdict_corrected',
        occurred_at: '2026-01-03T00:00:00.000Z',
        actor: '1LoD',
        payload: { type: 'verdict_corrected', original_verdict_id: 'v1', new_verdict: second },
        prev_hash: 'test-hash-e2',
        hash: 'test-hash-e3',
      },
    ];

    const latest = findLatestVerdictEvent(events);
    // The corrected verdict supersedes the produced one — a reviewer must sign
    // off against what is current, not what was first recorded.
    expect(latest?.type).toBe('verdict_corrected');
    expect(latest && 'new_verdict' in latest && latest.new_verdict.binding_constraint).toBe('INV-NEW-01');
  });

  it('returns undefined when the trail carries no verdict at all', () => {
    // The seeded Counterpoise self-assessment is the real case on every install, so
    // P8-C07's no-verdict branch depends on this being undefined, not a throw.
    expect(findLatestVerdictEvent([])).toBeUndefined();
  });
});

// Round 4, step 5. Build verification 003 found these correct by inspection
// with no test naming their scenario — true by construction, undefended.
describe('Register and audit guarantees that were untested (round 4)', () => {
  it('TC-VD-3-02: a correction record carries who, when, which field, and both values [TC-UC-7-01]', async () => {
    const nodeId = crypto.randomUUID();
    await addNode(makeUseCaseNode({ node_id: nodeId, label: 'Correction record probe' }));

    const correction = {
      correction_id: crypto.randomUUID(),
      node_id: 'p1',
      graph_version_before: 1,
      graph_version_after: 2,
      field: 'processing_data_zone',
      original_value: 'Zone C',
      corrected_value: 'Zone B',
      corrected_by: '1LoD',
      corrected_at: '2026-08-05T10:00:00.000Z',
    };

    await append({
      event_id: crypto.randomUUID(),
      use_case_id: nodeId,
      event_type: 'graph_corrected',
      occurred_at: '2026-08-05T10:00:00.000Z',
      actor: '1LoD',
      payload: { type: 'graph_corrected', correction },
    });

    const events = await getAll(nodeId);
    const recorded = events.find((e) => e.payload.type === 'graph_corrected');
    expect(recorded).toBeDefined();
    if (!recorded || recorded.payload.type !== 'graph_corrected') return;

    // All five, together. A correction missing any one of them cannot be
    // audited: you would know something changed but not what, or not who.
    const c = recorded.payload.correction;
    expect(c.field).toBe('processing_data_zone');
    expect(c.original_value).toBe('Zone C');
    expect(c.corrected_value).toBe('Zone B');
    expect(c.corrected_by).toBe('1LoD');
    expect(c.corrected_at).toBe('2026-08-05T10:00:00.000Z');
  });

  it('TC-LC-1-02: a lifecycle change records both ends of the transition, so a skip is visible', async () => {
    const nodeId = crypto.randomUUID();
    await addNode(makeUseCaseNode({ node_id: nodeId, label: 'Stage transition probe' }));

    await updateLifecycleStage(nodeId, 'pre_checked', '1LoD');
    await updateLifecycleStage(nodeId, 'approved', '2LoD');

    const stageEvents = (await getAll(nodeId)).filter((e) => e.payload.type === 'lifecycle_stage_changed');
    expect(stageEvents).toHaveLength(2);

    // The trail records from AND to, so a stage that was skipped is visible in
    // the record rather than inferable only from its absence. The product does
    // not block skips — LC-1 asks that transitions be recorded, and a bank
    // that legitimately fast-tracks a case must be able to see it happened.
    const payloads = stageEvents.map((e) => (e.payload.type === 'lifecycle_stage_changed' ? e.payload : null));
    expect(payloads[0]).toMatchObject({ to_stage: 'pre_checked' });
    expect(payloads[1]).toMatchObject({ from_stage: 'pre_checked', to_stage: 'approved' });
  });

  it('TC-NF-2-01: the audit trail exposes no update or delete path [TC-VD-4-01]', async () => {
    // code-review-005 F7: this used to be a keyword blocklist ('update',
    // 'delete', 'remove', 'edit', 'clear', 'put'), and the hand-off replace
    // primitive evaded it by name alone — `replaceAllRawEvents` (and its
    // successor, `backupAndReplaceAllRawEventsWithinQueue`) contains none of
    // those words, so the blocklist would have passed even though a
    // UI-reachable path can now clear and rewrite the whole trail (a
    // bounded, documented exception: a verified bundle, user-confirmed,
    // backup taken first — see handoff.ts's replaceWithBundle). A blocklist
    // can only catch names someone thought to list; an ALLOWLIST inverts the
    // failure mode — every export must be named here on purpose, so ANY new
    // write path, whatever it is called, fails this test until someone
    // consciously adds it.
    //
    // code-review-005 round 2, N3: `append`/`importTailIfContinues`/
    // `backupAndReplaceAllRawEvents` each grew a *WithinQueue sibling (or, in
    // the two multi-word cases, were renamed to it outright — nothing needed
    // the old top-level self-queuing form once every caller that must touch
    // both this module's queue and register.ts's queue does so through
    // `withAuditQueue`) so a caller already holding the audit queue
    // (register.ts's updateLifecycleStage; handoff.ts's replaceWithBundle /
    // importBundle / finishRegisterReplace) can extend that SAME turn across
    // a nested register.ts call instead of racing it as a separate one — see
    // audit.ts's withAuditQueue doc for why that nesting order is now fixed
    // everywhere in this codebase.
    const auditModule = await import('./audit');
    const names = Object.keys(auditModule).sort();

    const ALLOWED_AUDIT_EXPORTS = [
      '__resetChainStateForTests',
      '__recomputeChainForTests',
      'append',
      'appendWithinQueue',
      'backupAndReplaceAllRawEventsWithinQueue',
      'currentTipWithinQueue',
      'getAll',
      'getAllForExport',
      'importTailIfContinuesWithinQueue',
      'sha256Hex',
      'verifyChain',
      'verifyChainOf',
      'withAuditQueue',
    ].sort();

    expect(names).toEqual(ALLOWED_AUDIT_EXPORTS);
  });

  it('TC-RG-8-26: code-review-005 F3: getUseCases() skips an unreadable register row instead of throwing and freezing the whole list', async () => {
    // Realistic bad-file shape: a node the OUTER register_nodes.by_type index
    // finds as 'use_case' (so getUseCases()'s own filter includes it), but
    // whose metadata disagrees (node_type: 'ai_model') — exactly the
    // register-node/metadata mismatch code-review-005's import validation
    // now rejects at the hand-off boundary (handoff.ts), kept here as
    // defence in depth for any OTHER way a row like this could exist (a
    // write from before that validation existed, or a future writer that
    // forgets it). toSummary() throws on exactly this mismatch (register.ts's
    // own explicit guard) — before F3, that throw propagated out of
    // Promise.all and took every OTHER row down with it.
    const goodId = crypto.randomUUID();
    await addNode(makeUseCaseNode({ node_id: goodId, label: 'Readable row' }));

    const badId = crypto.randomUUID();
    const badNode = {
      node_id: badId,
      node_type: 'use_case',
      label: 'Corrupt row',
      created_at: new Date().toISOString(),
      metadata: {
        node_type: 'ai_model',
        model_id: 'whatever',
        vendor: 'unknown',
        is_approved: false,
      },
    } as unknown as RegisterNode;
    await addNode(badNode);

    // EBT-3: deliberate fault injection, not a mock of a real failure. The
    // console spy captures/suppresses the error toSummary() logs for this
    // hand-built, type-bypassing bad row — no real write path (including the
    // hand-off import boundary) can produce a node:metadata mismatch like it.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let summaries: Awaited<ReturnType<typeof getUseCases>>;
    let wasLogged: boolean;
    try {
      summaries = await getUseCases('all');
      // Read the spy's call history BEFORE restoring — mockRestore() also
      // clears .mock.calls (it does what mockReset()/mockClear() do first),
      // so asserting on it afterwards would always see zero regardless of
      // what actually happened.
      wasLogged = consoleErrorSpy.mock.calls.length > 0;
    } finally {
      consoleErrorSpy.mockRestore();
    }

    expect(summaries.some((s) => s.use_case_id === goodId)).toBe(true);
    expect(summaries.some((s) => s.use_case_id === badId)).toBe(false);
    expect(wasLogged).toBe(true);
  });

  it('TC-RG-1-02: a blast-radius query returns exactly the referencing use cases at scale [TC-RG-1-01]', async () => {
    // RG-1's scale half. 200 unrelated entries alongside two that share a
    // component: the query must return the two and nothing else, and do it
    // without walking into quadratic behaviour.
    // The component id needs no node of its own — getBlastRadius resolves
    // edges by to_node_id (register.ts:236), exactly as the existing
    // blast-radius test does.
    const componentId = crypto.randomUUID();

    const referencing: string[] = [];
    for (let i = 0; i < 2; i++) {
      const id = crypto.randomUUID();
      await addNode(makeUseCaseNode({ node_id: id, label: `Sharer ${i}` }));
      await addEdge({
        edge_id: crypto.randomUUID(),
        from_node_id: id,
        to_node_id: componentId,
        edge_type: 'uses_model',
        created_at: new Date().toISOString(),
      });
      referencing.push(id);
    }
    for (let i = 0; i < 200; i++) {
      await addNode(makeUseCaseNode({ node_id: crypto.randomUUID(), label: `Unrelated ${i}` }));
    }

    const started = performance.now();
    const radius = await getBlastRadius(componentId);
    const elapsed = performance.now() - started;

    const ids = radius.map((n) => n.node_id).sort();
    expect(ids).toEqual([...referencing].sort());
    // RG-1-02 allows 2 seconds. A generous ceiling that still catches a
    // quadratic scan, rather than a micro-benchmark that flakes under load.
    expect(elapsed).toBeLessThan(2000);
  });
});

// R16-F F-1 (DR7-02, DR7-03). Read-only — the check `runConfirmAndEvaluate`
// (IntakeFlow.tsx) makes FIRST inside withCaseLock, before any write, to
// refuse a repeat confirm or correction. These tests exercise the store
// read directly; IntakeFlow.r16f.test.tsx covers the UI-level refusal.
describe('confirmationPrecondition', () => {
  it('TC-R16-F-15: a fresh confirm on a case with no trail at all is "ok"', async () => {
    expect(await confirmationPrecondition(crypto.randomUUID())).toBe('ok');
  });

  it('TC-R16-F-16: a fresh confirm is "already-decided" when the trail already holds a verdict_produced for the case, even with no register node written yet', async () => {
    const useCaseId = crypto.randomUUID();
    await append({
      event_id: crypto.randomUUID(),
      use_case_id: useCaseId,
      event_type: 'verdict_produced',
      occurred_at: new Date().toISOString(),
      actor: '1LoD',
      payload: { type: 'verdict_produced', verdict: makeVerdict({ use_case_id: useCaseId }) },
    });
    // Deliberately no addNode() here — the audit signal alone must be
    // enough to refuse, independent of whether the register write landed.
    expect(await confirmationPrecondition(useCaseId)).toBe('already-decided');
  });

  it('TC-R16-F-17: a fresh confirm is "already-decided" when a register node already exists for the case, even with no verdict_produced event', async () => {
    const useCaseId = crypto.randomUUID();
    await addNode(makeUseCaseNode({ node_id: useCaseId }));
    // Deliberately no verdict_produced event — the register signal alone
    // must be enough to refuse.
    expect(await confirmationPrecondition(useCaseId)).toBe('already-decided');
  });

  it('TC-R16-F-18: a fresh confirm is "ok" when the case has a graph_confirmed but no verdict yet (a genuine evaluation retry, not a repeat)', async () => {
    const useCaseId = crypto.randomUUID();
    await append({
      event_id: crypto.randomUUID(),
      use_case_id: useCaseId,
      event_type: 'graph_confirmed',
      occurred_at: new Date().toISOString(),
      actor: '1LoD',
      payload: { type: 'graph_confirmed', graph_id: 'g1', graph_version: 1, corrections_count: 0 },
    });
    expect(await confirmationPrecondition(useCaseId)).toBe('ok');
  });

  // getUseCase()'s current_verdict_id is COMPUTED from the audit trail's
  // latest verdict_produced/verdict_corrected event (register.ts's
  // toSummary/findLatestVerdictEvent) — not read off the register node's
  // own metadata.current_verdict_id directly — so these two tests write
  // real verdict events, matching what the real write path produces.
  it('TC-R16-F-19: a correction is "ok" when the trail\'s current verdict still matches the one being corrected', async () => {
    const useCaseId = crypto.randomUUID();
    await addNode(makeUseCaseNode({ node_id: useCaseId }));
    await append({
      event_id: crypto.randomUUID(),
      use_case_id: useCaseId,
      event_type: 'verdict_produced',
      occurred_at: new Date().toISOString(),
      actor: '1LoD',
      payload: { type: 'verdict_produced', verdict: makeVerdict({ id: 'v-current', use_case_id: useCaseId }) },
    });
    expect(await confirmationPrecondition(useCaseId, 'v-current')).toBe('ok');
  });

  it('TC-R16-F-20: a correction is "corrected-elsewhere" when another correction already moved the trail\'s current verdict on', async () => {
    const useCaseId = crypto.randomUUID();
    await addNode(makeUseCaseNode({ node_id: useCaseId }));
    await append({
      event_id: crypto.randomUUID(),
      use_case_id: useCaseId,
      event_type: 'verdict_produced',
      occurred_at: '2026-01-01T00:00:00.000Z',
      actor: '1LoD',
      payload: { type: 'verdict_produced', verdict: makeVerdict({ id: 'v-original', use_case_id: useCaseId }) },
    });
    // Another tab's correction already landed, moving the current verdict
    // on to v-newer.
    await append({
      event_id: crypto.randomUUID(),
      use_case_id: useCaseId,
      event_type: 'verdict_corrected',
      occurred_at: '2026-01-02T00:00:00.000Z',
      actor: '1LoD',
      payload: {
        type: 'verdict_corrected',
        original_verdict_id: 'v-original',
        new_verdict: makeVerdict({ id: 'v-newer', use_case_id: useCaseId }),
      },
    });
    // This tab still thinks it is correcting v-original — stale.
    expect(await confirmationPrecondition(useCaseId, 'v-original')).toBe('corrected-elsewhere');
  });

  it('TC-R16-F-21: a correction against a case with no register node at all is "ok" — nothing to conflict with', async () => {
    expect(await confirmationPrecondition(crypto.randomUUID(), 'v-whatever')).toBe('ok');
  });
});
