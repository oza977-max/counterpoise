import { describe, it, expect } from 'vitest';
import {
  applyJurisdictionOverrides,
  caveatForFiredRule,
  evaluatePackHardLines,
  isUnsigned,
  resolveActivePacks,
} from './jurisdiction';
import type { DataFlowGraph, JurisdictionPack, PackRule } from './types';

// V2-A: rewritten from the P3-C01 stub tests — the pass-through is gone.

function graph(overrides: Partial<DataFlowGraph> = {}): DataFlowGraph {
  return {
    id: 'g1',
    version: 1,
    input_nodes: [],
    processing_nodes: [
      { id: 'p1', label: 'x', model_type: 'ml', autonomy_level: 1, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false },
    ],
    output_nodes: [
      { id: 'o1', label: 'y', action_type: 'recommend', exposure: 'internal-shared', decision_bindingness: 'material', output_reversibility: 'reversible', scale: 'limited', decision_type: 'hiring' },
    ],
    edges: [],
    jurisdictions: ['EU'],
    intake_method: 'structured_form',
    extracted_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function rule(overrides: Partial<PackRule> = {}): PackRule {
  return {
    id: 'EU-AIACT-TIER-02',
    title: 'Annex III employment screening',
    source: { document: 'EU AI Act', section: 'Annex III §4(a)', text: 'recruitment or selection of natural persons…' },
    effect: { type: 'tier_floor', minimum_tier: 'Critical' },
    condition: { decision_type: { in: ['hiring'] } },
    basis: 'derived',
    reviewer_name: '[FIRM] — Legal/Compliance',
    reviewer_role: 'Head of Compliance',
    sign_off_date: '[DATE]',
    ...overrides,
  };
}

function pack(rules: PackRule[], overrides: Partial<JurisdictionPack> = {}): JurisdictionPack {
  return {
    pack_id: 'EU-AIACT',
    version: '1.0',
    jurisdiction: 'EU',
    regulator: 'European Commission',
    document: 'EU AI Act (Reg. 2024/1689)',
    effective_date: '2024-08-01',
    reviewer_name: '[FIRM] — Legal/Compliance',
    reviewer_role: 'Head of Compliance',
    sign_off_date: '[DATE]',
    rules,
    ...overrides,
  };
}

describe('resolveActivePacks (V2-A)', () => {
  it('activates only packs whose jurisdiction is on the graph, sorted by pack_id [TC-RA-1-02]', () => {
    const eu = pack([rule()]);
    const uk = pack([rule({ id: 'UK-1' })], { pack_id: 'SS1-23', jurisdiction: 'UK' });
    expect(resolveActivePacks(['EU'], [], [uk, eu]).map((p) => p.pack_id)).toEqual(['EU-AIACT']);
    expect(resolveActivePacks(['EU', 'UK'], [], [uk, eu]).map((p) => p.pack_id)).toEqual(['EU-AIACT', 'SS1-23']);
    expect(resolveActivePacks([], [], [uk, eu])).toEqual([]);
  });
});

describe('applyJurisdictionOverrides (V2-A)', () => {
  it('BC-V2A-01: a tier_floor raises the tier and never lowers it [TC-PE-6-02]', () => {
    const raised = applyJurisdictionOverrides(graph(), 'Medium', 'II', [pack([rule()])]);
    expect(raised.finalTier).toBe('Critical');
    expect(raised.appliedOverrides).toHaveLength(1);
    expect(raised.chain[0]?.derived).toMatch(/forced to Critical \(was Medium\)/);

    const lowFloor = rule({ effect: { type: 'tier_floor', minimum_tier: 'Low' } });
    const notLowered = applyJurisdictionOverrides(graph(), 'High', 'II', [pack([lowFloor])]);
    expect(notLowered.finalTier).toBe('High');
    expect(notLowered.chain[0]?.derived).toMatch(/already satisfied/);
  });

  it('track is never changed; obligations supplement (controls + reviews deduped, sorted)', () => {
    const r1 = rule({ id: 'A-1', effect: { type: 'required_review', review: 'Independent model validation (2LoD)' } });
    const r2 = rule({ id: 'A-2', effect: { type: 'required_control', control_id: 'CTRL-LOG-01' } });
    const result = applyJurisdictionOverrides(graph(), 'Medium', 'III', [pack([r2, r1])]);
    expect(result.finalTrack).toBe('III');
    // Pinned expectation changed by R16-A1 (review sources), 2026-10-02:
    // addedReviews is now structured `{ review, rule_id }`, not a bare
    // string — the rule_id is what lets a control's covers_reviews match
    // this specific pack rule.
    expect(result.addedReviews).toEqual([{ review: 'Independent model validation (2LoD)', rule_id: 'A-1' }]);
    expect(result.addedControls).toEqual(['CTRL-LOG-01']);
    // rules applied in id order regardless of array order
    expect(result.chain.map((c) => c.rule_id)).toEqual(['A-1', 'A-2']);
  });

  it('a non-matching condition fires nothing', () => {
    const r = rule({ condition: { decision_type: { in: ['trading'] } } });
    const result = applyJurisdictionOverrides(graph(), 'Medium', 'II', [pack([r])]);
    expect(result.finalTier).toBe('Medium');
    expect(result.chain).toEqual([]);
    expect(result.caveats).toEqual([]);
  });
});

describe('NF-7 / RA-11 caveats (V2-A)', () => {
  it('BC-V2A-03: an unsigned fired rule yields a LOW caveat naming pending adoption [TC-NF-7-01]', () => {
    const caveat = caveatForFiredRule(rule());
    expect(isUnsigned(rule())).toBe(true);
    expect(caveat?.confidence).toBe('low');
    expect(caveat?.reason).toMatch(/pending firm adoption/i);
  });

  it('review fix, pass 1: a real reviewer name with a [DATE] placeholder is still UNSIGNED — an un-dated sign-off is not a sign-off', () => {
    const undated = rule({ reviewer_name: 'A. Mensah', sign_off_date: '[DATE]' });
    expect(isUnsigned(undated)).toBe(true);
    expect(caveatForFiredRule(undated)?.confidence).toBe('low');
  });

  it('a signed Medium rule yields a medium caveat; signed High yields none', () => {
    const signed = rule({ reviewer_name: 'A. Mensah', sign_off_date: '2026-05-14' });
    expect(caveatForFiredRule(signed)?.confidence).toBe('medium');
    expect(caveatForFiredRule({ ...signed, basis: 'verbatim' })).toBeNull();
  });
});

describe('evaluatePackHardLines (V2-A)', () => {
  it('a matching pack hard_line rule is hit with the graph path; non-matching is not', () => {
    const hl = rule({
      id: 'EU-AIACT-HL-01',
      effect: { type: 'hard_line', reason: 'Prohibited practice.' },
      condition: { decision_type: { in: ['hiring'] } },
    });
    const hit = evaluatePackHardLines(graph(), [pack([hl])]);
    expect(hit?.rule.id).toBe('EU-AIACT-HL-01');
    expect(hit?.graphPath.length).toBeGreaterThan(0);
    expect(evaluatePackHardLines(graph({ jurisdictions: ['EU'], output_nodes: [] }), [pack([hl])])).toBeNull();
  });
});

// V2-E — user feedback: "who signed off on that interpretation, and how
// confident they were — I don't know how this will work, don't think it's
// practically implementable."
//
// Two changes those tests pin: sign-off is a PACK-level act that rules
// inherit (Legal issues one position per regulation, not a signature per
// YAML line), and the subjective High/Medium/Low confidence grade is
// replaced by `basis` — what the rule does to its own quoted text, which
// a reviewer can check by reading the two side by side.
describe('V2-E: pack-level adoption and objective basis', () => {
  const SIGNED = { reviewer_name: 'A. Counsel', reviewer_role: 'Head of Compliance', sign_off_date: '2026-03-01' };

  it('a rule with no sign-off of its own inherits its pack’s adoption', () => {
    const r = rule({ reviewer_name: undefined, reviewer_role: undefined, sign_off_date: undefined });
    expect(isUnsigned(r, pack([r], SIGNED))).toBe(false);
    expect(isUnsigned(r, pack([r]))).toBe(true); // pack still has [FIRM]/[DATE]
  });

  it('an unadopted pack makes every rule under it provisional, whatever its basis', () => {
    const r = rule({ basis: 'verbatim', reviewer_name: undefined, sign_off_date: undefined });
    const caveat = caveatForFiredRule(r, pack([r]));
    expect(caveat?.confidence).toBe('low');
    expect(caveat?.reason).toMatch(/pending firm adoption/i);
  });

  it('basis drives the caveat once the pack is adopted', () => {
    const verbatim = rule({ basis: 'verbatim', reviewer_name: undefined, sign_off_date: undefined });
    const derived = rule({ basis: 'derived', reviewer_name: undefined, sign_off_date: undefined });
    const judgement = rule({ basis: 'judgement', reviewer_name: undefined, sign_off_date: undefined });

    // A rule that merely restates the quoted text needs no caveat — there
    // is nothing for a reader to second-guess.
    expect(caveatForFiredRule(verbatim, pack([verbatim], SIGNED))).toBeNull();
    expect(caveatForFiredRule(derived, pack([derived], SIGNED))?.confidence).toBe('medium');
    expect(caveatForFiredRule(judgement, pack([judgement], SIGNED))?.confidence).toBe('low');
  });

  it('the reasoning chain says whose sign-off it is and at what level', () => {
    const inherited = rule({ reviewer_name: undefined, sign_off_date: undefined });
    const local = rule({ ...SIGNED, reviewer_name: 'B. Deviation' });

    const { chain } = applyJurisdictionOverrides(graph(), 'Low', 'II', [pack([inherited], SIGNED)]);
    expect(chain[0]?.sign_off).toBe('A. Counsel · 2026-03-01 (adopted at pack level)');
    expect(chain[0]?.basis).toBe('derived');

    const localChain = applyJurisdictionOverrides(graph(), 'Low', 'II', [pack([local], SIGNED)]).chain;
    expect(localChain[0]?.sign_off).toBe('B. Deviation · 2026-03-01 (adopted at this rule level)');
  });
});

// V2-E follow-up — user asked how pack sign-off actually works in
// practice. Auditing that surfaced the real blocker: 6 of the 8 starter
// rules still carry authoring-placeholder quotes, and one of those
// declared basis "verbatim" — a flat contradiction, since the quote
// itself says it is not the verbatim text.
describe('placeholder source text cannot be reviewed', () => {
  const SIGNED = { reviewer_name: 'A. Counsel', reviewer_role: 'Head of Compliance', sign_off_date: '2026-03-01' };

  it('an authoring placeholder outranks "pending adoption" — the rule is not merely unsigned, it is unreviewable', () => {
    const r = rule({
      basis: 'verbatim',
      reviewer_name: undefined,
      sign_off_date: undefined,
      source: { document: 'SS1/23', section: '§3.4', text: '[ILLUSTRATIVE — NOT VERBATIM] something about validation' },
    });
    const caveat = caveatForFiredRule(r, pack([r], SIGNED));
    expect(caveat?.confidence).toBe('low');
    expect(caveat?.reason).toMatch(/authoring placeholder, not the regulation/i);
    // Must NOT read as a signature-away-from-ready.
    expect(caveat?.reason).not.toMatch(/pending firm adoption/i);
  });

  it('a real quote on an adopted pack produces no caveat', () => {
    const r = rule({ basis: 'verbatim', reviewer_name: undefined, sign_off_date: undefined });
    expect(caveatForFiredRule(r, pack([r], SIGNED))).toBeNull();
  });
});

// R6 finding (parity check, first run). `resolveActivePacks` accepted the
// policy's jurisdiction registry as `_jurisdictionRegistry` and ignored it,
// so a pack file present on disk applied whenever a graph named its
// jurisdiction — whether or not the firm's policy declared that jurisdiction
// at all. The registry is the firm's statement of where it operates; a pack
// outside it should not be able to change a verdict.
describe('R6 — the policy jurisdiction registry gates which packs may apply', () => {
  const ukPack = pack([rule({ id: 'UK-1' })], { pack_id: 'SS1-23', jurisdiction: 'UK' });
  const jpPack = pack([rule({ id: 'JP-1' })], { pack_id: 'FSA-JP', jurisdiction: 'JP' });
  const registry = [{ code: 'UK', name: 'United Kingdom', pack_files: [] }];

  it('excludes a pack whose jurisdiction the policy does not declare', () => {
    const active = resolveActivePacks(['UK', 'JP'], registry, [ukPack, jpPack]);
    expect(active.map((p) => p.pack_id)).toEqual(['SS1-23']);
  });

  it('an empty registry is treated as "not yet configured", not as "nothing applies"', () => {
    // Every existing policy predates the registry being enforced. Treating an
    // empty registry as a total block would silently disable all packs and
    // change every jurisdictional verdict — a far worse failure than the one
    // being fixed.
    const active = resolveActivePacks(['UK', 'JP'], [], [ukPack, jpPack]);
    expect(active.map((p) => p.pack_id)).toEqual(['FSA-JP', 'SS1-23']);
  });
});

// TC-PE-6-01 / TC-RA-2-01 — "the most demanding standard governs".
//
// Both cases previously asserted that a UK Track II displaces a US Track III,
// i.e. a `track_floor` effect. That effect type does not exist and its absence
// is deliberate (types.ts:205; evaluation-engine.md:172), so the cases failed
// build verification 003 and 004 against an engine that was behaving as
// designed. PE-6's wording was corrected in round 4; the cases are corrected
// here, and this is the test that pins what "most demanding" actually means.
//
// The supplement model is the STRICTER reading, which is the point: picking one
// pack as "governing" would discard the obligations the other one imposed.
describe('TC-PE-6-01 / TC-RA-2-01 — most demanding governs across jurisdictions', () => {
  const ukPack = pack(
    [
      rule({
        id: 'SS1-UK-REV-01',
        effect: { type: 'required_review', review: 'Independent model validation (2LoD)' },
        source: { document: 'SS1/23', section: 'Principle 1', text: 'a quantitative method…' },
      }),
      rule({ id: 'SS1-UK-TIER-01', effect: { type: 'tier_floor', minimum_tier: 'High' } }),
    ],
    { pack_id: 'SS1-23', jurisdiction: 'UK', document: 'PRA SS1/23' },
  );

  const usPack = pack(
    [rule({ id: 'SR26-US-CTRL-01', effect: { type: 'required_control', control_id: 'CTRL-DOC-01' } })],
    { pack_id: 'SR-26-2', jurisdiction: 'US', document: 'SR 26-2' },
  );

  const multi = graph({ jurisdictions: ['UK', 'US'] });

  it('applies BOTH packs — obligations are unioned, not chosen between [TC-RA-1-03]', () => {
    const result = applyJurisdictionOverrides(multi, 'Medium', 'III', [ukPack, usPack]);
    // The US control survives alongside the UK review. Dropping either would
    // be the failure mode the old "governing standard" wording invited.
    expect(result.addedControls).toContain('CTRL-DOC-01');
    // Pinned expectation changed by R16-A1 (review sources), 2026-10-02:
    // addedReviews entries are now structured, keyed by rule_id.
    expect(result.addedReviews).toContainEqual({
      review: 'Independent model validation (2LoD)',
      rule_id: 'SS1-UK-REV-01',
    });
    expect(result.chain.map((c) => c.rule_id).sort()).toEqual(['SR26-US-CTRL-01', 'SS1-UK-REV-01', 'SS1-UK-TIER-01']);
  });

  it('TC-R16-A1-47: addedReviews is sorted by rule_id, deterministically, across multiple firing review rules', () => {
    const r1 = rule({ id: 'Z-1', effect: { type: 'required_review', review: 'Review Z' } });
    const r2 = rule({ id: 'A-1', effect: { type: 'required_review', review: 'Review A' } });
    const result = applyJurisdictionOverrides(graph(), 'Medium', 'III', [pack([r1, r2])]);
    expect(result.addedReviews).toEqual([
      { review: 'Review A', rule_id: 'A-1' },
      { review: 'Review Z', rule_id: 'Z-1' },
    ]);
  });

  it('takes the highest tier floor across packs, and never lowers the tier', () => {
    const raised = applyJurisdictionOverrides(multi, 'Medium', 'III', [ukPack, usPack]);
    expect(raised.finalTier).toBe('High');

    // Already above every floor — the packs must not pull it back down.
    const alreadyHigher = applyJurisdictionOverrides(multi, 'Critical', 'III', [ukPack, usPack]);
    expect(alreadyHigher.finalTier).toBe('Critical');
  });

  it('leaves the track exactly as the firm’s own rules assigned it', () => {
    // The heart of the correction: no pack moves the track, in either
    // direction. "Most demanding" is expressed in obligations, not in track.
    for (const baseTrack of ['I', 'II', 'III'] as const) {
      const result = applyJurisdictionOverrides(multi, 'Medium', baseTrack, [ukPack, usPack]);
      expect(result.finalTrack).toBe(baseTrack);
    }
  });

  it('order of the packs does not change the outcome (NF-1 determinism)', () => {
    const a = applyJurisdictionOverrides(multi, 'Medium', 'III', [ukPack, usPack]);
    const b = applyJurisdictionOverrides(multi, 'Medium', 'III', [usPack, ukPack]);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
