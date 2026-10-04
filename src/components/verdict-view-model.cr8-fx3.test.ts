import { describe, it, expect } from 'vitest';
import { buildVerdictView } from './verdict-view-model';
import type { PolicyFile } from '../engine/types';
import type { Verdict } from '../types/verdict';

// FX8-3 / code review 008. P4 (sign-off): no surface says the person can start when a required
// sign-off is not on record, or when whether one is required cannot be determined (no stage, no valid
// policy). BC-005: each test renders the state in which the claim would be FALSE and asserts it absent.
// The view fields each sentence is derived from: signOffRequired / signedOff / signOffMissing /
// signOffUnknown (stage + policy.tier_workflow + the trail's twoloD_reviewed events).

function makeVerdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    status: 'approved_with_controls', tier: 'High', track: 'II', binding_constraint: 'INV-DATA-01',
    binding_path: 'a → b → c', controls: [], downstream_reviews: [], conditions: { hypotheses: [] },
    policy_version: '1.0', pack_versions: {}, applied_overrides: [], confidence_caveats: [], provisional_reasons: [],
    boundary_proximity: false, margin_achieved: 0, margin_target: 0.1, single_covered_invariants: [],
    explanation: { tier_rationale: null, track_rationale: null, hard_lines_checked: 5, invariants_checked: 20, tripped_invariants: [], binding_reason: null, binding_regulatory_basis: null },
    id: 'verdict-1', use_case_id: 'uc-1', living_status: 'approved', living_status_updated_at: '2026-01-01T00:00:00.000Z',
    attested_by: '1LoD', attested_at: '2026-01-01T00:00:00.000Z', graph_version: 1, corrections: [],
    ...overrides,
  } as Verdict;
}

function makePolicy(workflow: 'self-service' | '2LoD-approve', overrides: Partial<PolicyFile> = {}): PolicyFile {
  return {
    version: '1.0', policy_id: 'p', firm_name: 'f',
    translation_attestation: { attested_by: 'x', role: 'x', date: 'x', raf_version_checked: 'x' },
    hard_lines: [], tracks: [], tiers: [], invariants: [], controls: [], downstream_reviews: [], kri_thresholds: {},
    jurisdictions: [], roles: {},
    tier_workflow: { Critical: workflow, High: workflow, Medium: workflow, Low: workflow },
    safety_margin: 0.1, ...overrides,
  } as PolicyFile;
}

const CTRL = { id: 'C1', name: 'C1', description: 'd', resolves: [], burden: 1 as const, verification: 'v' };
const PERMISSIVE = /you can start|nobody|no sign-off needed|go ahead/i;

function allText(view: ReturnType<typeof buildVerdictView>): string[] {
  return [view.headline, view.whoSignsOff, ...view.nextSteps];
}

describe('FX8-3 CR8-02 — P4: nothing permissive when the sign-off is missing or undetermined', () => {
  it('TC-CR8-02a: required-but-missing sign-off (past pre_checked, no approving review) — no next step says "you can start"', () => {
    for (const controls of [[], ['C1']]) {
      const policy = makePolicy('2LoD-approve', { controls: [CTRL] });
      const view = buildVerdictView(makeVerdict({ controls }), policy, undefined, undefined, undefined, 'approved', { auditEvents: [] });
      expect(view.signOffMissing).toBe(true);
      expect(view.nextSteps.join('\n')).not.toMatch(/you can start/i);
      expect(view.nextSteps.join('\n')).toMatch(/confirm with them before you start/i);
      for (const t of allText(view)) expect(t).not.toMatch(PERMISSIVE);
    }
  });

  it('TC-CR8-02b: no valid policy, stage past pre_checked — no "you can start", no "nobody", anywhere', () => {
    for (const controls of [[], ['C1']]) {
      const view = buildVerdictView(makeVerdict({ controls }), undefined, undefined, undefined, undefined, 'approved', { auditEvents: [] });
      expect(view.signOffUnknown).toBe(true);
      for (const t of allText(view)) expect(t).not.toMatch(PERMISSIVE);
    }
  });

  it('TC-CR8-02c: no stage at all (the intake screen before saving) — no sign-off claim on any surface', () => {
    for (const policy of [undefined, makePolicy('self-service', { controls: [CTRL] })]) {
      for (const controls of [[], ['C1']]) {
        const view = buildVerdictView(makeVerdict({ controls }), policy, undefined, undefined, undefined, undefined, { auditEvents: [] });
        expect(view.signOffUnknown).toBe(true);
        expect(view.needsSignOff).toBe(false);
        expect(view.signOffMissing).toBe(false);
        for (const t of allText(view)) expect(t).not.toMatch(PERMISSIVE);
      }
    }
  });

  it('TC-CR8-02d: a determined self-service case (explicit stage + self-service policy) still says it can start', () => {
    const view = buildVerdictView(makeVerdict({ controls: [] }), makePolicy('self-service'), undefined, undefined, undefined, 'approved', { auditEvents: [] });
    expect(view.signOffUnknown).toBe(false);
    expect(view.headline).toBe('Yes — you can start.');
    expect(view.nextSteps.join('\n')).toMatch(/you can start/i);
    expect(view.whoSignsOff).toMatch(/^nobody/);
  });

  it('TC-CR8-02e: a signed-off case is unaffected by a missing policy or stage (the trail alone decides)', () => {
    const ev = {
      event_id: 'e', use_case_id: 'uc-1', event_type: 'twoloD_reviewed', occurred_at: '2026-01-02T00:00:00.000Z', actor: '2LoD',
      payload: { type: 'twoloD_reviewed', action: 'approved', verdict_id: 'verdict-1', attested_by_name: 'R' }, prev_hash: null, hash: 'h',
    } as never;
    const view = buildVerdictView(makeVerdict({ controls: [] }), undefined, undefined, undefined, undefined, undefined, { auditEvents: [ev] });
    expect(view.signedOff).toBe(true);
    expect(view.signOffUnknown).toBe(false);
    expect(view.headline).toMatch(/signed it off/);
  });
});

// CR8-17: the overdue line counts only stale sources whose pack the verdict actually used —
// derived from verdict.pack_versions (the engine's record of the active packs). stale_sources stays as recorded.
describe('FX8-3 CR8-17 — overdue regulatory text counts only the packs this verdict used', () => {
  const stale = (id: string) => ({ pack_id: id, retrieved_date: '2026-01-01', days_overdue: 5, max_staleness_days: 90 });
  const overdue = (view: ReturnType<typeof buildVerdictView>) => view.couldStillChange.some((l) => /overdue/i.test(l));

  it('TC-CR8-17: a stale pack the verdict did not use — no overdue line', () => {
    const verdict = makeVerdict({ pack_versions: { 'US-PACK': '1' }, stale_sources: [stale('EU-PACK')] } as Partial<Verdict>);
    expect(overdue(buildVerdictView(verdict, undefined, undefined, undefined, undefined, undefined))).toBe(false);
  });

  it('TC-CR8-17-1: a stale pack the verdict used — the line is shown', () => {
    const verdict = makeVerdict({ pack_versions: { 'EU-PACK': '1' }, stale_sources: [stale('EU-PACK')] } as Partial<Verdict>);
    expect(overdue(buildVerdictView(verdict, undefined, undefined, undefined, undefined, undefined))).toBe(true);
  });

  it('TC-CR8-17-2: a legacy verdict with no pack_versions at all — no overdue line (nothing to say it was used)', () => {
    const verdict = makeVerdict({ stale_sources: [stale('EU-PACK')] } as Partial<Verdict>);
    delete (verdict as { pack_versions?: unknown }).pack_versions;
    expect(overdue(buildVerdictView(verdict, undefined, undefined, undefined, undefined, undefined))).toBe(false);
  });
});

describe('FX8-3 review pass 1 follow-ups', () => {
  it('TC-CR8-02i: stages idea / exploring / retired make no sign-off claim; approved / in_production / monitored may', () => {
    for (const stage of ['idea', 'exploring', 'retired'] as const) {
      const view = buildVerdictView(makeVerdict({ controls: [] }), makePolicy('self-service'), undefined, undefined, undefined, stage, { auditEvents: [] });
      expect(view.signOffUnknown, stage).toBe(true);
      for (const t of allText(view)) expect(t, stage).not.toMatch(PERMISSIVE);
    }
    for (const stage of ['approved', 'in_production', 'monitored'] as const) {
      const view = buildVerdictView(makeVerdict({ controls: [] }), makePolicy('self-service'), undefined, undefined, undefined, stage, { auditEvents: [] });
      expect(view.signOffUnknown, stage).toBe(false);
    }
  });

  it('TC-CR8-02j: the unknown-case headline opens "Not yet confirmed."', () => {
    const view = buildVerdictView(makeVerdict({ controls: ['C1'] }), makePolicy('self-service', { controls: [CTRL] }), undefined, undefined, undefined, undefined, { auditEvents: [] });
    expect(view.headline).toMatch(/^Not yet confirmed\./);
  });

  it('TC-CR8-17-4: pack_versions holds pack A while the stale source is pack B — no overdue line', () => {
    const verdict = makeVerdict({
      pack_versions: { 'PACK-A': '1' },
      stale_sources: [{ pack_id: 'PACK-B', retrieved_date: '2026-01-01', days_overdue: 5, max_staleness_days: 90 }],
    } as Partial<Verdict>);
    const view = buildVerdictView(verdict, undefined, undefined, undefined, undefined, undefined);
    expect(view.couldStillChange.some((l) => /overdue/i.test(l))).toBe(false);
  });
});
