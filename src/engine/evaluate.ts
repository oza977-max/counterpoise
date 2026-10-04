import {
  applyJurisdictionOverrides,
  caveatForFiredRule,
  chainEntryFor,
  evaluatePackHardLines,
  resolveActivePacks,
} from './jurisdiction';
import { evaluateHardLines } from './hard-lines';
import { provisionalReasons, unclassifiedDecisionTypes } from './provisional';
import { firmRequiredReviews } from './downstream-reviews';
import { fitsEnvelope, inheritableControls } from './envelope';
import { assignTrack } from './track';
import type { TrackAssignment } from './track';
import { assignTier } from './tier';
import type { TierAssignment } from './tier';
import { evaluateInvariants } from './invariants';
import type { TrippedInvariant } from './invariants';
import { buildStandingConditions } from './conditions';
import { solvControls } from './greedy-solver';
import type {
  ApprovedModel,
  Control,
  DataFlowGraph,
  DownstreamReviewSource,
  InheritanceChain,
  RegistryEntry,
  EngineError,
  EvaluationResult,
  JurisdictionPack,
  PolicyFile,
  Result,
  RuleRationale,
  TrippedInvariantDetail,
} from './types';

// Rule 1 (cross-cutting.md §7): engine is a pure island — no React, no idb, no SDK.
// evaluation-engine.md §3.1 pipeline, 9 steps. Pure function: no Date.now(),
// no Math.random(), no I/O anywhere in the call graph (NF-1, §7 determinism).
export function evaluate(
  graph: DataFlowGraph,
  policy: PolicyFile,
  packs: JurisdictionPack[] = [],
): Result<EvaluationResult, EngineError> {
  const hardLines = sortedById(policy.hard_lines);
  // Tracks are the ONE policy collection that is NOT sorted by id — this is
  // deliberate, not an oversight to fix later. Track assignment is
  // first-match/short-circuit (assignTrack, track.ts; evaluation-engine.md
  // §3.4), and the policy file declares its track rules in a load-bearing
  // order: TRACK-III-AGENTIC / TRACK-II-REPLACE / TRACK-II-AUTONOMY are
  // placed FIRST in policy/appetite.yaml precisely so those special cases
  // win before the general TRACK-III/TRACK-I/TRACK-II rules beneath them
  // (see the comment block above `tracks:` there — oracle rounds 001/002
  // fixed this exact ordering twice already, in the policy file itself).
  // `sortedById` here silently re-imposed alphabetical order
  // (TRACK-I, TRACK-II, TRACK-II-AUTONOMY, TRACK-II-REPLACE, TRACK-III,
  // TRACK-III-AGENTIC) UNDER that fix, undoing it one layer up in the
  // engine: e.g. a statistical model with autonomy >= 3 landed on TRACK-I
  // (alphabetically first) instead of TRACK-II-AUTONOMY, and an agentic
  // model that replaces a prior one landed on TRACK-II-REPLACE instead of
  // TRACK-III-AGENTIC. Determinism (NF-1) does not require id-sorting: the
  // policy file's array order is itself a fixed, deterministic input —
  // byte-identical across runs without being re-sorted. Every OTHER
  // collection below IS sorted because it has no such order dependency:
  // hard lines short-circuit but the firm authors them id-ordered by
  // convention; tiers/invariants/controls are evaluated in full and are
  // order-independent by construction (tier.ts takes the highest-ranked
  // match, invariants/controls are all evaluated, none short-circuit).
  // Tracks are the exception, not the rule — leave this one unsorted.
  const tracks = policy.tracks;
  const tiers = sortedById(policy.tiers);
  const invariants = sortedById(policy.invariants);
  const controls = sortedById(policy.controls);

  // Step 1 (V2-A, real for the first time): resolve loaded packs against
  // the graph's jurisdictions. Additive third param — callers without
  // packs are byte-identical to pre-V2-A behavior.
  const activePacks = resolveActivePacks(graph.jurisdictions, policy.jurisdictions, packs);
  const packVersions = Object.fromEntries(activePacks.map((p) => [p.pack_id, p.version]));

  // PV-6: resolve the inheritance chain BEFORE the hard-line short-circuit.
  // The chain records what a declared platform or vendor was assessed against
  // and where this use case left the envelope — a question a reviewer asks
  // just as often about a rejection as about an approval ("was residency
  // assessed?" has an answer either way).
  //
  // It used to be computed after the hard-line returns, so it survived only
  // rejections reached via an unsatisfiable invariant. Widening HL-002 in
  // oracle round 001 moved MNPI-in-Zone-B from that path onto the hard-line
  // path and exposed the gap — the requirement was never hard-line-specific,
  // the coverage just happened to be.
  const inheritance = resolveInheritance(graph, policy);

  // R16-A1 (§1.3, D-58): shared by BOTH hard-line return sites below — a
  // hard-line trip (base or pack) returns before jurisdiction overrides are
  // resolved (§3.1 step order, unchanged), so pack-required reviews are
  // never available here; firm rules, the unregistered-component path and
  // the model-governance path are. Computing this once keeps the pack
  // hard-line branch an exact mirror of the base one, which is the fix for
  // the documented bug (the pack branch used to set neither field at all).
  const baseHardLineSources = combineReviewSources(
    firmRequiredReviews(graph, policy),
    unapprovedComponentReviews(inheritance),
    modelGovernanceReviews(graph, policy),
  );

  // Step 2: hard lines — first trip is immediate rejection, no further steps.
  const hardLineResult = evaluateHardLines(graph, hardLines);
  if (hardLineResult.tripped) {
    // Spec (§3.3) doesn't assign tier/track on a hard-line rejection — no
    // control set can bring the use case into appetite regardless of tier,
    // so tier/track assignment is skipped entirely (§3.1 step order). Report
    // the ceiling values (Critical/I) since a hard-line trip is definitionally
    // the most severe outcome; downstream consumers should key off `status`
    // and `binding_constraint`, not tier/track, for hard-line rejections.
    return {
      ok: true,
      value: emptyResult({
        status: 'rejected',
        tier: 'Critical',
        track: 'I',
        binding_constraint: hardLineResult.hardLineId,
        binding_path: hardLineResult.graphPath,
        // CS-3, round 4. A rejection says don't do this; it does not say the
        // use case's other characteristics stopped being true. These are NOT
        // obligations owed today — they are what this shape of use case would
        // still require if it were re-scoped to come inside appetite, kept for
        // whoever picks it up next. The verdict screen labels them that way;
        // presenting them as current instructions would be the dishonest
        // reading (user decision, 2026-08-05).
        //
        // Pack overrides are not available here: a hard line returns before
        // jurisdiction resolution, by design (§3.1 step order). Firm rules,
        // the unregistered-component path and the model-governance path are
        // (R16-A1 §1.3 — all three merged into one sources list, with
        // downstream_reviews derived from it, the single source of truth).
        downstream_reviews: reviewStringsFrom(baseHardLineSources),
        downstream_review_sources: baseHardLineSources,
        policy_version: policy.version,
        ...(inheritance ? { inheritance } : {}),
        // Review finding, pass 1: the audit trail must record which pack
        // versions were in force even when a BASE hard line rejects —
        // otherwise indistinguishable from "no packs loaded".
        pack_versions: packVersions,
        explanation: {
          // Tier/track rationale honestly null — assignment was skipped,
          // the reported Critical/I are ceiling values, not assignments.
          tier_rationale: null,
          track_rationale: null,
          hard_lines_checked: hardLines.length,
          invariants_checked: 0,
          tripped_invariants: [],
          binding_reason: hardLineResult.reason,
          binding_regulatory_basis: hardLineResult.regulatoryBasis,
        },
      }, graph),
    };
  }

  // Step 2b (V2-A): pack-level hard lines — graph-only conditions,
  // same immediate-rejection semantics as base hard lines.
  const packHardLine = evaluatePackHardLines(graph, activePacks);
  if (packHardLine) {
    const { rule } = packHardLine;
    const reason = rule.effect.type === 'hard_line' ? rule.effect.reason : '';
    const caveat = caveatForFiredRule(rule, packHardLine.pack);
    return {
      ok: true,
      value: emptyResult({
        status: 'rejected',
        tier: 'Critical',
        track: 'I',
        binding_constraint: rule.id,
        binding_path: packHardLine.graphPath,
        // R16-A1 (§1.3, D-58): the documented bug fix — this branch used to
        // set neither field at all. Mirrors the base hard-line branch
        // exactly (same three producers, pack overrides unavailable here
        // for the same reason).
        downstream_reviews: reviewStringsFrom(baseHardLineSources),
        downstream_review_sources: baseHardLineSources,
        policy_version: policy.version,
        pack_versions: packVersions,
        ...(inheritance ? { inheritance } : {}),
        confidence_caveats: caveat ? [caveat] : [],
        explanation: {
          tier_rationale: null,
          track_rationale: null,
          hard_lines_checked: hardLines.length,
          invariants_checked: 0,
          tripped_invariants: [],
          binding_reason: reason,
          binding_regulatory_basis: `${rule.source.document} ${rule.source.section}`,
          regulatory_chain: [chainEntryFor(rule, `Hard-line rejection: ${reason}`, packHardLine.pack, graph)],
        },
      }, graph),
    };
  }

  // Step 3: track assignment (first-match short-circuit).
  const trackResult = assignTrack(graph, tracks);
  if (!trackResult.ok) return trackResult;

  // Step 4: tier assignment (impact-dominant, all rules evaluated).
  const tierAssignment = assignTier(graph, tiers);

  // Step 5 (V2-A, real): tier floors raise (never lower), obligations
  // supplement; every fired rule lands in the regulatory chain + caveats.
  const overrides = applyJurisdictionOverrides(graph, tierAssignment.tier, trackResult.value.track, activePacks);

  // R16-A1 (§1.3): the two FORWARD return sites below (unsatisfiable-
  // invariant rejection and the final assembly) both reach this point with
  // jurisdiction overrides already resolved, so all FOUR producers apply —
  // computed once here rather than re-derived at each site.
  const forwardSources = combineReviewSources(
    firmRequiredReviews(graph, policy),
    overrides.addedReviews,
    unapprovedComponentReviews(inheritance),
    modelGovernanceReviews(graph, policy),
  );

  // Step 6: invariant evaluation (no short-circuit — solver needs the full set).
  const tripped = evaluateInvariants(graph, invariants);

  // Step 6b (PV-A): what the declared platform/vendor's approval already
  // covers. Resolved above, before the hard-line short-circuit (PV-6).
  const inherited = inheritance?.inherited_controls ?? [];

  // Step 7: control solving. `inherited` was the parameter solvControls has
  // accepted since P3-C01 and never been given — PV-A closes that seam.
  const solverResult = solvControls(
    tripped.map((t) => t.invariantId),
    controls,
    inherited,
  );

  // V1.1-C01: rationale + tripped detail — data the earlier steps already
  // computed, now carried into the verdict instead of dropped (pure
  // function of the same sorted inputs; NF-1 determinism unchanged).
  const rationales = {
    tier_rationale: tierRationale(tierAssignment),
    track_rationale: trackRationale(trackResult.value),
  };
  const checkCounts = { hard_lines_checked: hardLines.length, invariants_checked: invariants.length };
  const trippedDetails = tripped.map(toTrippedDetail);
  // The binding constraint is "the rule that determined the outcome"
  // (§3.9) — so it must be the most severe tripped invariant, not simply
  // the first by id. With a realistic multi-invariant policy the
  // sorted-first choice names an essentially arbitrary rule on the
  // headline field. Ties break by id, preserving determinism.
  const binding = mostSevere(tripped, policy.controls, policy.binding_constraint_order);

  // Step 8: status determination.
  if (!solverResult.ok) {
    const bindingTripped = tripped.find((t) => t.invariantId === solverResult.unsatisfiableInvariant);
    return {
      ok: true,
      value: emptyResult({
        status: 'rejected',
        tier: overrides.finalTier,
        track: overrides.finalTrack,
        binding_constraint: solverResult.unsatisfiableInvariant,
        binding_path: bindingTripped?.graphPath ?? '',
        downstream_reviews: reviewStringsFrom(forwardSources),
        downstream_review_sources: forwardSources,
        policy_version: policy.version,
        pack_versions: packVersions,
        applied_overrides: overrides.appliedOverrides,
        confidence_caveats: overrides.caveats,
        // PV-6: the inheritance chain is part of the record of what was
        // assessed, so it survives a rejection. Dropping it here would lose
        // the answer to "was residency assessed?" for precisely the cases
        // that failed — found by driving an over-envelope case through the
        // engine, not by a unit test.
        ...(inheritance ? { inheritance } : {}),
        explanation: {
          ...rationales,
          ...checkCounts,
          tripped_invariants: trippedDetails,
          binding_reason: null,
          binding_regulatory_basis: bindingTripped?.regulatoryBasis ?? null,
          regulatory_chain: overrides.chain,
        },
      }, graph),
    };
  }

  const status = tripped.length > 0 || overrides.addedControls.length > 0 ? 'approved_with_controls' : 'approved';

  // CS-1 margin + VD-6/CS-4 boundary proximity. Both now come from the
  // solver rather than being recomputed here.
  //
  // HR-14: the previous local computation was `some tripped invariant is
  // covered by exactly one control`. With a control library that has one
  // control per invariant — which the shipped policy does — that is true
  // whenever anything trips and false otherwise, i.e. it restated
  // `tripped.length > 0` and carried no information. It is now derived from
  // the margin the solver actually achieved against the policy's target.
  // policy.safety_margin is consumed HERE, not in the solver. Oracle round 001
  // moved the comparison out: the solver reports what depth the control library
  // offers, and this line decides whether that clears the firm's target.
  const marginAchieved = solverResult.marginAchieved;
  const boundaryProximity = tripped.length > 0 && marginAchieved < policy.safety_margin;

  // Step 9: verdict assembly (pure — no identity/time fields).
  // binding_constraint names "the rule/invariant that determined the
  // outcome" (§3.9) — on a clean approved verdict, nothing tripped, so
  // there is no constraint to name. Leaving it empty avoids misleadingly
  // implying the matched track rule "bound" the outcome in the audit trail.
  return {
    ok: true,
    value: emptyResult({
      status,
      tier: overrides.finalTier,
      track: overrides.finalTrack,
      binding_constraint: binding?.invariantId ?? '',
      binding_path: binding?.graphPath ?? '',
      // Pack-required controls supplement the solver's minimal set
      // (BC-V2A-01: obligations only ever add).
      controls: [...new Set([...solverResult.controls, ...overrides.addedControls])].sort(),
      // CS-3 / R16-A1 (§1.3): four sources, all additive — the firm's own
      // configured processes, a jurisdiction pack's required_review, the
      // unregistered-component path and the model-governance path.
      // downstream_reviews is DERIVED from downstream_review_sources (their
      // review strings, de-duplicated) — one source of truth.
      downstream_reviews: reviewStringsFrom(forwardSources),
      downstream_review_sources: forwardSources,
      ...(inheritance ? { inheritance } : {}),
      // VD-7 (V1.2-B): the hypothesis this approval is conditional on —
      // statically populated from kri_thresholds + graph pins. Rejection
      // paths keep hypotheses empty (nothing was approved to condition).
      conditions: { hypotheses: buildStandingConditions(graph, policy, overrides.finalTier) },
      policy_version: policy.version,
      pack_versions: packVersions,
      applied_overrides: overrides.appliedOverrides,
      confidence_caveats: overrides.caveats,
      boundary_proximity: boundaryProximity,
      // CS-1: the achieved margin is reported, not just whether it was met.
      // With no alternative controls in the library this is 0 — which is the
      // honest answer, and the reason CS-1 is not yet satisfiable by content.
      margin_achieved: marginAchieved,
      margin_target: policy.safety_margin,
      single_covered_invariants: solverResult.singleCovered,
      explanation: {
        ...rationales,
        ...checkCounts,
        tripped_invariants: trippedDetails,
        binding_reason: null,
        binding_regulatory_basis: binding?.regulatoryBasis ?? null,
        regulatory_chain: overrides.chain,
      },
    }, graph),
  };
}

// PV-1/2/3/5/6. Pure: registries sorted by id, no I/O.
//
// Code review 001, C-3 and C-4. Two defects lived here:
//   C-3: `resolved` was `entries.length > 0` — true if EITHER component
//        matched, so an approved platform masked an unapproved vendor and
//        no unapproved-component review fired. PV-5 exists to prevent that.
//   C-4: the guards mixed a pre-lookup id (`platformId`) with a post-lookup
//        object (`vendor`), so a declared-but-unrecognised vendor returned
//        undefined and the caller never learned a vendor had been declared.
// Each declared component is now resolved and reported independently.
function resolveInheritance(graph: DataFlowGraph, policy: PolicyFile): InheritanceChain | undefined {
  const platformId = graph.processing_nodes.find((n) => n.platform)?.platform;
  const vendorId = graph.processing_nodes.find((n) => n.vendor)?.vendor;

  const platforms = sortedById(policy.platforms ?? []);
  const vendors = sortedById(policy.vendors ?? []);

  const platform = platformId ? platforms.find((p) => p.id === platformId) : undefined;
  const vendor = vendorId ? vendors.find((v) => v.id === vendorId) : undefined;

  // A bare `vendor: 'internal'` string on a policy with no vendor registry is
  // not a claim of approval — no chain is fabricated. But once a registry
  // EXISTS, a declared id that is absent from it is a real PV-5 finding and
  // must be reported rather than silently dropped.
  // `vendor` is NOT user input: build-graph-from-form.ts hardcodes
  // 'internal' and the intake form never asks for a vendor. So 'internal' is
  // a sentinel meaning "no third-party vendor", not a registry claim —
  // treating it as one would flag every use case submitted through the app
  // as using an unapproved vendor. Any OTHER value (e.g. the self-assessment
  // graph's 'Anthropic') is a real claim and is checked.
  const VENDOR_SENTINEL = 'internal';
  const platformIsClaim = platformId !== undefined;
  const vendorIsClaim = vendorId !== undefined && vendorId !== VENDOR_SENTINEL && vendors.length > 0;
  if (!platformIsClaim && !vendorIsClaim) return undefined;

  const entries: RegistryEntry[] = [platform, vendor].filter((e): e is RegistryEntry => e !== undefined);

  const dimensions = entries.flatMap((e) => fitsEnvelope(graph, e.approved_envelope));
  const inheritedControls = [
    ...new Set(
      entries.flatMap((e) =>
        inheritableControls(e.satisfies_controls, fitsEnvelope(graph, e.approved_envelope), e.coupled_clusters),
      ),
    ),
  ].sort();

  // Per-component resolution. `resolved` now means "every component that was
  // claimed resolved", so it can no longer be true while something declared
  // sits unrecognised.
  const unresolved: string[] = [];
  if (platformIsClaim && !platform) unresolved.push(platformId!);
  if (vendorIsClaim && !vendor) unresolved.push(vendorId!);

  return {
    ...(platformIsClaim ? { declared_platform: platformId } : {}),
    ...(vendorIsClaim ? { declared_vendor: vendorId } : {}),
    resolved: unresolved.length === 0,
    unresolved_components: unresolved.sort(),
    inherited_controls: inheritedControls,
    dimensions,
  };
}

// PV-5: name every unapproved component, not merely report that something
// was unapproved.
//
// R16-A1 (§1.3): returns a structured DownstreamReviewSource per component
// instead of a bare string, so this producer's output merges with the other
// three the same way. rule_id is the PV-UNREGISTERED sentinel plus the
// component name, joined by ":" — the base id (the part before ":") is what
// a control's covers_reviews entry matches (it names the bare sentinel
// once; it cannot know every component name in advance).
function unapprovedComponentReviews(inheritance: InheritanceChain | undefined): DownstreamReviewSource[] {
  if (!inheritance || inheritance.unresolved_components.length === 0) return [];
  return inheritance.unresolved_components.map((name) => ({
    rule_id: `PV-UNREGISTERED:${name}`,
    // The guided form's sentinel for "not on the list"
    // (StructuredForm.tsx:453,478) was printing verbatim into verdict prose
    // a banker reads. Naming it in words says the same thing without
    // exposing an implementation detail as though it were a vendor.
    review:
      name === '__other__'
        ? 'Full vendor/platform risk assessment required — the declared component is not on the approved list'
        : `Full vendor/platform risk assessment required — ${name} is not on the approved list`,
  }));
}

// R11-MG-2 (ADR-IF-R11-MG-1, evaluation-engine.md/policy-schema.md §10a).
// One level deeper than vendor: same resolve-against-registry, report-
// unresolved-or-unapproved pattern as `resolveInheritance` /
// `unapprovedComponentReviews` above, reused rather than reinvented.
// Deterministic (NF-1): pure function of sorted policy.approved_models and
// the graph's declared_model_id values, no I/O.
//
// R16-A1 (§1.3): structured DownstreamReviewSource per model, same reason as
// unapprovedComponentReviews above — rule_id is "MODEL-REGISTRY:<model id>",
// and the base id before ":" is what covers_reviews matches.
function modelGovernanceReviews(graph: DataFlowGraph, policy: PolicyFile): DownstreamReviewSource[] {
  const declared = [
    ...new Set(
      graph.processing_nodes
        .map((n) => n.declared_model_id)
        .filter((id): id is string => id !== undefined && id.length > 0),
    ),
  ].sort();
  if (declared.length === 0) return [];

  // Exact-id-first, family-fallback — see resolveApprovedModel below.
  const models = policy.approved_models ?? [];
  const resolve = (id: string) => resolveApprovedModel(models, id);

  return declared
    .filter((id) => {
      const entry = resolve(id);
      return entry === undefined || entry.is_approved === false;
    })
    .map((id) => ({
      rule_id: `MODEL-REGISTRY:${id}`,
      // Reserved-word discipline (CLAUDE.md gotcha, /approved|rejected/i):
      // "on the firm's registry within appetite" says the same thing as
      // "approved" without the banned word reaching a rendered string.
      review: `Model governance review required — ${id} is not on the firm's model registry within appetite`,
    }));
}

/** Exact-id-first, family-fallback (R11-MG-1a, ADR-PS-R11-1a). Both lookups
 *  use the same sorted-by-model_id order (NF-1), so resolution is a pure
 *  function of the policy's own stable order, never runtime-derived. Exported
 *  (CR7-41) so the register snapshot resolves a model the way the engine does
 *  instead of keeping its own exact-id copy. Pure; reads the models as given —
 *  a family lapsed by reattest_by is only unapproved once applyReattestExpiry
 *  has been applied to them. */
export function resolveApprovedModel(models: ApprovedModel[] | undefined, id: string): ApprovedModel | undefined {
  const sorted = sortedByModelId(models ?? []);
  const registry = new Map<string, ApprovedModel>(sorted.filter((m) => !m.is_family).map((m) => [m.model_id, m]));
  const exact = registry.get(id);
  if (exact) return exact;
  return sorted.find((f) => f.is_family === true && f.version_pattern !== undefined && id.startsWith(f.version_pattern));
}

function sortedByModelId(items: ApprovedModel[]): ApprovedModel[] {
  return [...items].sort((a, b) => a.model_id.localeCompare(b.model_id));
}

// R16-A1 (§1.3, D-04, D-57). One place that combines whichever producers
// apply at a given return site into the deterministic sources list every
// verdict carries, and derives the de-duplicated prose list from it — so
// `downstream_reviews` has exactly one source of truth
// (`downstream_review_sources`) at every one of evaluate()'s four return
// sites, not four independent re-derivations that could drift.
// C-5: two different firm-loaded packs can reuse the same rule id by
// coincidence — a rule id is unique WITHIN one pack's own rules, never
// guaranteed unique ACROSS every pack a firm loads together (and
// checkPolicyReferences warns when it happens, src/store/policy-
// references.ts). Only entries identical in BOTH rule_id and review text
// collapse (the same obligation arriving twice). A shared id with DIFFERENT
// review text is two real obligations and both are kept — collapsing on id
// alone silently dropped a review someone owes. Output is sorted by rule_id
// then review text so the order never depends on producer/pack order (NF-1).
function combineReviewSources(...producers: DownstreamReviewSource[][]): DownstreamReviewSource[] {
  const byKey = new Map<string, DownstreamReviewSource>();
  for (const source of producers.flat()) {
    const key = JSON.stringify([source.rule_id, source.review]);
    if (!byKey.has(key)) byKey.set(key, source);
  }
  return [...byKey.values()].sort((a, b) => {
    const byId = a.rule_id.localeCompare(b.rule_id);
    if (byId !== 0) return byId;
    return a.review < b.review ? -1 : a.review > b.review ? 1 : 0;
  });
}

function reviewStringsFrom(sources: DownstreamReviewSource[]): string[] {
  return [...new Set(sources.map((s) => s.review))].sort();
}

function tierRationale(assignment: TierAssignment): RuleRationale {
  return {
    rule_id: assignment.triggeringRuleId,
    ...(assignment.triggeringField ? { matched_field: assignment.triggeringField } : {}),
    ...(assignment.triggeringRegulatoryBasis ? { regulatory_basis: assignment.triggeringRegulatoryBasis } : {}),
  };
}

function trackRationale(assignment: TrackAssignment): RuleRationale {
  return {
    rule_id: assignment.ruleId,
    rule_name: assignment.ruleName,
    ...(assignment.regulatoryBasis ? { regulatory_basis: assignment.regulatoryBasis } : {}),
  };
}

const SEVERITY_RANK: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

// Which tripped invariant is THE binding one — the single string the verdict
// screen leads with and the audit trail records as the reason.
//
// Highest severity wins. Ties then break on the CHEAPEST control that would
// satisfy the invariant — its unavoidable cost — and only then on id.
//
// The burden tie-break is oracle round 001's fix. Previously ties broke on id
// alone — alphabetically — so C-02 (three invariants, all severity High)
// reported INV-DATA-01 purely because "DATA" sorts before "HALLUC". Two
// independent adjudicators reading the same policy both named INV-HALLUC-01,
// and both gave the same reason: the binding constraint is the one that drives
// the heaviest requirement, not the one earliest in the alphabet. Six of the
// seven binding-constraint disagreements in that round shared this cause.
//
// Deterministic (NF-1): burden is a fixed integer in the policy and id breaks
// any remaining tie, so the ordering is total and independent of input order.
const DEFAULT_BINDING_ORDER: Array<'severity' | 'control_burden' | 'id'> = [
  'severity',
  'control_burden',
  'id',
];

function mostSevere(
  tripped: TrippedInvariant[],
  controls: Control[],
  order: Array<'severity' | 'control_burden' | 'id'> = DEFAULT_BINDING_ORDER,
): TrippedInvariant | undefined {
  const burdenById = new Map(controls.map((c) => [c.id, c.burden]));
  // Cheapest, not heaviest. Where an invariant lists several resolving
  // controls the firm only has to do one of them, so the heaviest overstates
  // what the invariant actually costs — an invariant offering a cheap route
  // would outrank one with no route but its own expensive control.
  const weight = (t: TrippedInvariant): number => {
    const burdens = t.requiredControls.map((id) => burdenById.get(id) ?? 0);
    return burdens.length > 0 ? Math.min(...burdens) : 0;
  };

  // Comparators applied in the order the POLICY declares, so the rule the
  // verdict is defended with is the rule a reader can find in appetite.yaml.
  const comparators: Record<string, (a: TrippedInvariant, b: TrippedInvariant) => number> = {
    severity: (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
    control_burden: (a, b) => weight(b) - weight(a),
    id: (a, b) => a.invariantId.localeCompare(b.invariantId),
  };

  return [...tripped].sort((a, b) => {
    for (const key of order) {
      const cmp = comparators[key]?.(a, b) ?? 0;
      if (cmp !== 0) return cmp;
    }
    // Total ordering guaranteed even if a firm omits `id` from the declared
    // order — determinism (NF-1) is not the policy author's to opt out of.
    return a.invariantId.localeCompare(b.invariantId);
  })[0];
}

function toTrippedDetail(t: TrippedInvariant): TrippedInvariantDetail {
  return {
    id: t.invariantId,
    description: t.description,
    severity: t.severity,
    required_controls: t.requiredControls,
    graph_path: t.graphPath,
    ...(t.regulatoryBasis ? { regulatory_basis: t.regulatoryBasis } : {}),
  };
}

function sortedById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

// `graph` is REQUIRED, not optional, and deliberately so. The provisional
// determination below is derived here precisely because this is the single
// choke point every return path funnels through — an optional parameter would
// let a caller omit it and silently produce a verdict that reads as "no
// unclassified decision type" when nobody ever looked. TypeScript now forces
// every path, including the two early hard-line rejections, to supply it.
function emptyResult(overrides: Partial<EvaluationResult>, graph: DataFlowGraph): EvaluationResult {
  const base: EvaluationResult = {
    status: 'approved',
    tier: 'Low',
    track: 'III',
    binding_constraint: '',
    binding_path: '',
    controls: [],
    downstream_reviews: [],
    conditions: { hypotheses: [] },
    policy_version: '',
    pack_versions: {},
    applied_overrides: [],
    confidence_caveats: [],
    boundary_proximity: false,
    margin_achieved: 1,
    margin_target: 0,
    single_covered_invariants: [],
    // Stub flag inlined (was emptyExplanation(), a one-use helper) — no
    // behaviour change, same literal, same single call site.
    explanation: {
      tier_rationale: null,
      track_rationale: null,
      hard_lines_checked: 0,
      invariants_checked: 0,
      tripped_invariants: [],
      binding_reason: null,
      binding_regulatory_basis: null,
    },
    provisional_reasons: [],
    ...overrides,
  };
  // Derived AFTER the spread, at the single construction choke point every
  // return path funnels through — so no path, including the early hard-line
  // rejections, can omit it. A verdict silently lacking the field would read
  // as "not provisional" to every consumer.
  return {
    ...base,
    provisional_reasons: provisionalReasons(base.confidence_caveats, base.pack_versions, graph),
    unclassified_decision_types: unclassifiedDecisionTypes(graph),
  };
}
