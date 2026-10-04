import { matchesCondition, matchedConditionValues, describeGraphPath } from './condition';
import type {
  AppliedOverride,
  ConfidenceCaveat,
  DataFlowGraph,
  DownstreamReviewSource,
  JurisdictionEntry,
  JurisdictionPack,
  PackRule,
  RegulatoryChainEntry,
  Tier,
  Track,
} from './types';

// V2-A: REAL pack resolution and override application, replacing the
// P3-C01 pass-through stubs. Rule 1: pure — active packs and rules are
// sorted by id; effects are a pure function of (graph, tier, packs).

const TIER_RANK: Record<Tier, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

// NF-7: a reviewer_name OR sign_off_date still carrying a [..]
// placeholder is UNSIGNED — an un-dated sign-off is not a sign-off
// (review finding, pass 1). The rule is a proposed interpretation, and
// any verdict relying on it must surface as provisional (BC-V2A-03).
//
// V2-E: adoption is decided at PACK level. A rule may carry its own
// sign-off only where a firm deviates locally; absent that, the pack's
// sign-off governs. One adoption decision per regulation is what a Legal
// function actually produces — a per-rule signature was a review burden
// no firm would complete, leaving every deployment permanently
// provisional.
const PLACEHOLDER = /\[[^\]]*\]/;

// V2-E: a rule whose `source.text` is still an authoring placeholder
// cannot be reviewed at all. `basis` is defined RELATIVE to the quote —
// "does this rule restate the quoted text?" is unanswerable when the
// quote announces it is not the real text. 6 of the 8 starter rules are
// in this state, so this is the normal case today, not an edge case.
//
// This must outrank the ordinary unsigned caveat: "pending firm adoption"
// implies the rule is ready and merely awaiting a signature, which would
// overstate what is here.
export function hasPlaceholderQuote(rule: PackRule): boolean {
  return /ILLUSTRATIVE|NOT VERBATIM/i.test(rule.source.text);
}

export function isUnsigned(rule: PackRule, pack?: { reviewer_name: string; sign_off_date: string }): boolean {
  const name = rule.reviewer_name ?? pack?.reviewer_name ?? '';
  const date = rule.sign_off_date ?? pack?.sign_off_date ?? '';
  if (!name || !date) return true;
  return PLACEHOLDER.test(name) || PLACEHOLDER.test(date);
}

// R6 finding (parity check R6, first run): `jurisdictionRegistry` was
// previously `_jurisdictionRegistry` — accepted and ignored. A pack file
// sitting in policy/packs/ therefore applied whenever a graph named its
// jurisdiction, regardless of whether the firm's policy declared operating
// there. The registry is the firm's statement of where it operates, so it
// gates which packs may fire.
//
// An EMPTY registry is deliberately treated as "not configured" rather than
// "nothing applies": every policy written before this was enforced has no
// registry, and blocking all packs would silently change every
// jurisdictional verdict — a worse failure than the one being fixed.
export function resolveActivePacks(
  jurisdictions: string[],
  jurisdictionRegistry: JurisdictionEntry[],
  loadedPacks: JurisdictionPack[] = [],
): JurisdictionPack[] {
  const declared = new Set(jurisdictionRegistry.map((j) => j.code));
  return loadedPacks
    .filter((p) => jurisdictions.includes(p.jurisdiction))
    .filter((p) => declared.size === 0 || declared.has(p.jurisdiction))
    .sort((a, b) => a.pack_id.localeCompare(b.pack_id));
}

type PackSignOff = { reviewer_name: string; reviewer_role: string; sign_off_date: string };

export function caveatForFiredRule(rule: PackRule, pack?: PackSignOff): ConfidenceCaveat | null {
  const cite = `${rule.source.document} ${rule.source.section}`;
  if (hasPlaceholderQuote(rule)) {
    return {
      ruleId: rule.id,
      field: 'jurisdiction_pack',
      confidence: 'low',
      reason: `${cite} — the source text for this rule is an authoring placeholder, not the regulation. It cannot be reviewed or relied on until the verbatim text is retrieved (grounding/PACK-AUTHORING.md).`,
    };
  }
  if (isUnsigned(rule, pack)) {
    return {
      ruleId: rule.id,
      field: 'jurisdiction_pack',
      confidence: 'low',
      // design-review-003 (Panels A/D/G): the requirement-code parenthetical
      // used to render verbatim on the verdict screen (explore-006 D-001) —
      // the same fact is already stated in plain words by
      // PROVISIONAL_REASON_LABEL.unsigned_pack_rules elsewhere on the page.
      reason: `${cite} — proposed interpretation, pending firm adoption (pack not adopted)`,
    };
  }
  // V2-E: the caveat now follows what the rule is DOING to the source
  // text, which anyone can check by reading the two side by side —
  // rather than a confidence grade someone had to invent.
  if (rule.basis === 'judgement') {
    return {
      ruleId: rule.id,
      field: 'jurisdiction_pack',
      confidence: 'low',
      reason: `${cite} — this rule rests on legal interpretation, not on the quoted text alone. Confirm with Compliance before relying on it (RA-11).`,
    };
  }
  if (rule.basis === 'derived') {
    return {
      ruleId: rule.id,
      field: 'jurisdiction_pack',
      confidence: 'medium',
      reason: `${cite} — inferred from the quoted text rather than stated in it. Check the inference holds for this use case (RA-11).`,
    };
  }
  return null;
}

export function chainEntryFor(
  rule: PackRule,
  derived: string,
  pack: PackSignOff | undefined,
  graph: DataFlowGraph,
): RegulatoryChainEntry {
  const name = rule.reviewer_name ?? pack?.reviewer_name ?? 'not yet adopted';
  const date = rule.sign_off_date ?? pack?.sign_off_date;
  const scope = rule.reviewer_name ? 'this rule' : 'pack';
  return {
    rule_id: rule.id,
    document: rule.source.document,
    section: rule.source.section,
    source_text: rule.source.text,
    basis: rule.basis,
    derived,
    triggered_by: matchedConditionValues(rule.condition, graph),
    sign_off: isUnsigned(rule, pack)
      ? `${name} · pending firm adoption`
      : `${name} · ${date} (adopted at ${scope} level)`,
  };
}

export interface PackHardLineHit {
  rule: PackRule;
  packId: string;
  pack: JurisdictionPack;
  graphPath: string;
}

// Rules inside a pack were already sorted before iteration; PACKS were not, so
// both of the functions below inherited their order from whatever the caller
// passed. `resolveActivePacks` sorts by pack_id (line 73), so the production
// path was always deterministic and no verdict was ever affected — but these
// are exported, the guarantee lived in the caller, and in
// `evaluatePackHardLines` the order decides WHICH hard line is reported as the
// reason for a rejection. Sorting here makes NF-1 hold by construction for
// every caller, per CLAUDE.md's sort-before-iterate rule.
// Found by TC-PE-6-01's determinism case, which calls these directly.
function sortedByPackId(packs: JurisdictionPack[]): JurisdictionPack[] {
  return [...packs].sort((a, b) => a.pack_id.localeCompare(b.pack_id));
}

// Pack-level hard lines: graph-only conditions, evaluated right after the
// base hard lines (before tier/track exist). First hit in sorted order.
export function evaluatePackHardLines(graph: DataFlowGraph, activePacks: JurisdictionPack[]): PackHardLineHit | null {
  for (const pack of sortedByPackId(activePacks)) {
    const rules = [...pack.rules].sort((a, b) => a.id.localeCompare(b.id));
    for (const rule of rules) {
      if (rule.effect.type !== 'hard_line') continue;
      if (matchesCondition(rule.condition, graph)) {
        return { rule, packId: pack.pack_id, pack, graphPath: describeGraphPath(graph) };
      }
    }
  }
  return null;
}

export interface JurisdictionOverrideResult {
  finalTrack: Track;
  finalTier: Tier;
  appliedOverrides: AppliedOverride[];
  addedControls: string[];
  // R16-A1 (§1.3): structured `{ review, rule_id }` instances, not bare
  // strings — one of the four producers evaluate() merges into
  // downstream_review_sources, keyed by the firing pack rule's own id so a
  // control's covers_reviews can match it (same shape, same reason, as
  // unapprovedComponentReviews/modelGovernanceReviews in evaluate.ts).
  addedReviews: DownstreamReviewSource[];
  chain: RegulatoryChainEntry[];
  caveats: ConfidenceCaveat[];
}

export function applyJurisdictionOverrides(
  graph: DataFlowGraph,
  baseTier: Tier,
  baseTrack: Track,
  activePacks: JurisdictionPack[] = [],
): JurisdictionOverrideResult {
  let finalTier = baseTier;
  const appliedOverrides: AppliedOverride[] = [];
  const addedControls: string[] = [];
  const addedReviews: DownstreamReviewSource[] = [];
  const chain: RegulatoryChainEntry[] = [];
  const caveats: ConfidenceCaveat[] = [];

  for (const pack of sortedByPackId(activePacks)) {
    const rules = [...pack.rules].sort((a, b) => a.id.localeCompare(b.id));
    for (const rule of rules) {
      if (rule.effect.type === 'hard_line') continue; // handled pre-tier
      if (!matchesCondition(rule.condition, graph)) continue;

      let derived: string;
      if (rule.effect.type === 'tier_floor') {
        // BC-V2A-01: most-demanding-standard — a floor only ever raises.
        const floor = rule.effect.minimum_tier;
        if (TIER_RANK[floor] > TIER_RANK[finalTier]) {
          derived = `Tier forced to ${floor} (was ${finalTier}) — most demanding standard applies.`;
          finalTier = floor;
        } else {
          derived = `Tier floor ${floor} already satisfied by ${finalTier}.`;
        }
      } else if (rule.effect.type === 'required_control') {
        addedControls.push(rule.effect.control_id);
        derived = `Added required control ${rule.effect.control_id}.`;
      } else {
        // R16-A1 (§1.3): the rule's own id is the source's rule_id — this
        // IS the pack review rule id named in a control's covers_reviews
        // (e.g. "SS1-UK-REV-01"), so no translation happens between here
        // and the loader check / view-model that matches against it.
        addedReviews.push({ review: rule.effect.review, rule_id: rule.id });
        derived = `Added downstream review "${rule.effect.review}".`;
      }

      appliedOverrides.push({ packCode: pack.pack_id, ruleId: rule.id, effect: derived });
      chain.push(chainEntryFor(rule, derived, pack, graph));
      const caveat = caveatForFiredRule(rule, pack);
      if (caveat) caveats.push(caveat);
    }
  }

  // Track is never changed by packs — obligations supplement, they do not
  // reclassify (repo-updates §4.2 decision; grounding §C).
  return {
    finalTrack: baseTrack,
    finalTier,
    appliedOverrides,
    addedControls: [...new Set(addedControls)].sort(),
    // C-5: rule_id is unique WITHIN one pack's own rules (one push per
    // (pack, rule) visited here), but NOT guaranteed unique across every
    // pack a firm loads together — two different packs can reuse the same
    // id by coincidence. That cross-pack case is de-duplicated one level up,
    // in evaluate.ts's combineReviewSources (the single choke point every
    // producer, including this one, funnels through) — this list only needs
    // its own deterministic rule_id sort, the same every producer uses.
    addedReviews: [...addedReviews].sort((a, b) => a.rule_id.localeCompare(b.rule_id)),
    chain,
    caveats,
  };
}
