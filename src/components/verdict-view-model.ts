// R16 chunk D1 (build/prompts/R16.md v2.1, §4.1). THE one computation behind
// the verdict's first screen. Pure — no React, no store calls (cross-
// cutting.md §7, principle 0.7) — so it can be unit-tested on its own and
// shared by every reader that needs a safeguard's status or plain-language
// text: the new first screen, and the existing WhatToDo, SignOffChecklist
// and evidence-panel (principle 0.5, "one computation per fact").
//
// Everything this module renders is checked against §0.1's no-bare-code
// rule: a control/review id that cannot be resolved against the loaded
// policy NEVER reaches its output as the id itself — see the "Safeguard {n}"
// and pack-review fallbacks below.
import type { Condition, Control, DataFlowGraph, DownstreamReviewRule, Exposure, JurisdictionPack, PackRule, PolicyFile, TrippedInvariantDetail, DataZone } from '../engine/types';
import type { Verdict } from '../types/verdict';
import type { AuditEvent, LifecycleStage } from '../store/types';
import { routeToWorkflow } from '../engine/workflow-router';
import { resolveApprovedModel } from '../engine/evaluate';
import { isVerdictProvisional, type ProvisionalReason } from '../engine/provisional';
import { maxBy } from '../engine/envelope';
// R16-D2 §2/§3 (D-95). The "No" screen's contributing-assumption check
// reads the worded Assumption shape (question/shortLabel/fields) — the
// same component-layer type StructuredForm/UnderstoodSummary already
// read. verdict-view-model.ts already sits in src/components/, so this is
// a same-layer import, not a new boundary (unlike src/store/types.ts,
// which declares its own copy rather than import from here — Rule 3).
import type { Assumption } from './plain-copy';
import { lookupCountryName } from './plain-copy';

export type SafeguardStatus = 'verified' | 'attested' | 'outstanding' | 'unknown';

export interface CoveredReview {
  plainName: string;
  /** The formal review text (`DownstreamReviewSource.review`) — kept
   *  alongside the plain name so the reviewer-section readers (WhatToDo),
   *  which show formal language unchanged, and the first screen, which
   *  shows only plain language, can each use the form they need from this
   *  one computation. */
  formalName: string;
  baseId: string;
}

export interface SafeguardView {
  id: string;
  status: SafeguardStatus;
  /** What must be in place — §4.4 fallback chain applied; never a bare code. */
  plainAction: string;
  /** Who usually arranges it, fully resolved (tokens, register override, partner). Empty string when nothing could be resolved at all (no policy, control unknown). */
  ownerText: string;
  yours: boolean;
  /** Why it applies to this case, from its tripped invariants, de-duplicated. */
  plainReasons: string[];
  /** Reviews on this verdict this safeguard's own action also satisfies. */
  coveredReviews: CoveredReview[];
  /** W-6 (R16-W §5, D-76): ONE grammatical sentence covering every review in
   *  `coveredReviews` — "(Doing this also completes {list} — one piece of
   *  work.)" — undefined when there is nothing covered. Computed here, not
   *  per-review at render time, so a safeguard covering two reviews prints
   *  one note, not two. */
  alsoCompletesNote?: string;
  attestedByName?: string;
  evidenceNote?: string;
  /** W-7 (R16-W §5, D-77): set only when the policy's verification_evidence
   *  is `status: 'verified'` but scoped (`applies_to`) away from this
   *  graph's platform/vendor, or the graph is unavailable to check against
   *  — the reason the evidence panel shows instead of the detail line.
   *  Undefined when evidence applies normally (unscoped) or there is no
   *  verified evidence to begin with. */
  evidenceScopeNote?: string;
}

export interface OwedReviewView {
  plainName: string;
  ownerText: string;
  baseId: string;
}

// R16-D2 §2 (VD-10, D-80). The "No" screen's own composition — undefined
// unless the verdict is rejected.
export interface NoScreenView {
  /** Which kind of rule said no — decides which §4.4 fallback chain and
   *  which fixed coda/"what would change" wording apply. */
  kind: 'hard_line' | 'pack_hard_line' | 'unsatisfiable' | 'other';
  /** The full "Why: …" sentence(s) — plain reason (or its fallback) plus
   *  the kind-specific coda, already composed. */
  reason: string;
  /** The full "What would change the answer: …" sentence(s) — undefined
   *  only for `kind: 'other'`, where nothing honest can be said about what
   *  would change an answer to a rule that cannot even be identified. */
  change?: string;
  /** Assumptions ("Not sure" answers) whose `fields` meet the binding
   *  rule's own condition keys — the ones named in "based on answers you
   *  weren't sure about". */
  contributingAssumptions: Assumption[];
  /** Assumptions the case has that did NOT contribute — drives the "(you
   *  weren't sure about other answers too…)" pointer to the reviewer
   *  section. */
  otherAssumptionCount: number;
}

// R16-D2 §2/§3/§4b. Optional inputs buildVerdictView did not need before
// this chunk, arriving in ONE trailing options object rather than three
// more positional arguments.
export interface VerdictViewOptions {
  /** The case's own assumptions (§3) — from `lastConfirmed` on the intake
   *  path, or `currentVerdictAttestationFields()` on the register path. */
  assumptions?: Assumption[];
  /** Every loaded jurisdiction pack — needed only to resolve a pack hard
   *  line's plain_reason/plain_change and its jurisdiction's plain name
   *  (§2); never consulted for anything evaluate() already decided. */
  packs?: JurisdictionPack[];
  /** §4b (D-97, W-7). The processing node's platform/vendor, used only
   *  when `graph` itself is unavailable (the register path, which does
   *  not persist it) — falls back to `'cannot-check'` when neither this
   *  nor `graph` says anything, exactly as before this option existed. */
  evidenceScope?: { platform?: string; vendor?: string };
  /** CR7-09. The case's audit trail. Read only to find a `twoloD_reviewed`
   *  event with action 'approved' for THIS verdict's id — that, and nothing
   *  else, is what lets the screen say "signed off". Absent = no sign-off
   *  event is known. */
  auditEvents?: AuditEvent[];
}

export interface VerdictView {
  isRejected: boolean;
  /** CR7-09. THE one answer: a sign-off is still OUTSTANDING (required by the
   *  tier's workflow and no approving 2LoD review recorded on this verdict).
   *  VerdictDisplay reads this; it no longer re-derives it from the stage. */
  needsSignOff: boolean;
  /** CR7-09. The tier's workflow required a sign-off (derived from the
   *  policy via the engine's routeToWorkflow, not from the stage). */
  signOffRequired: boolean;
  /** CR7-09. A `twoloD_reviewed` event with action 'approved' exists for
   *  this verdict's id. A correction request or a later (corrected) verdict
   *  does not count. */
  signedOff: boolean;
  /** Review pass 1 (M-1). A sign-off was required, the case is past the waiting stage, and no approving review of THIS verdict is on the trail. */
  signOffMissing: boolean;
  /** CR8-02 (P4). Whether a sign-off is required CANNOT be determined: no stage (the intake screen before
   *  the save lands) or no policy tier_workflow to route by, and no approving review on the trail. Every
   *  surface then says nothing permissive — no "you can start", no "nobody signs off". */
  signOffUnknown: boolean;
  headline: string;
  /** At most two distinct plain reasons, binding constraint first. */
  whyReasons: string[];
  /** True when more than two distinct reasons exist — render the "(Each safeguard below gives its own reason.)" note. */
  whyHasMore: boolean;
  nextSteps: string[];
  /** Every safeguard (verdict.controls order) — for readers that need the full set (WhatToDo, SignOffChecklist, the evidence panel). */
  safeguards: SafeguardView[];
  /** Outstanding (neither verified nor attested), yours-first — §4.2 item 4. */
  outstandingSafeguards: SafeguardView[];
  inPlaceSafeguards: SafeguardView[];
  attestedSafeguards: SafeguardView[];
  /** Count of outstanding safeguards — "neither machine-verified nor attested" (§4.2 item 1). */
  outstandingCount: number;
  /** Reviews not covered by any safeguard on this verdict, de-duplicated by plain name (D-04). */
  owedReviews: OwedReviewView[];
  /** Formal review strings (verdict.downstream_reviews entries) that are
   *  fully covered by a safeguard on this verdict — the one computation
   *  behind WhatToDo's "separate reviews" filter, replacing
   *  describesSameObligation's text heuristic with the real covers_reviews
   *  mechanism while keeping WhatToDo's own display vocabulary (formal
   *  names) unchanged. Always empty for a legacy verdict with no
   *  downstream_review_sources (§4.4 — nothing folded away). */
  coveredReviewFormalNames: string[];
  whoSignsOff: string;
  /** Shown when isVerdictProvisional(verdict), plus the independent RA-11 medium-caveat line. Empty when neither applies. */
  couldStillChange: string[];
  /** R16-D2 §2 (VD-10). The "No" screen's own composition — undefined
   *  unless `isRejected`. */
  no?: NoScreenView;
  /** R16-D2 §7 (DR7-34). Set only when at least one in-place (verified)
   *  safeguard's evidence is scoped (`applies_to`) and the scope matches
   *  this case's platform or supplier — the name shown in the first
   *  screen's "already in place" note. Undefined when no in-place
   *  safeguard is scoped (the note stays generic, unchanged). */
  inPlaceScopeName?: string;
}

/** UC-11 on the register path (CR7-11). The register keeps no graph, but the
 *  first confirmation writes a `uses_model` edge exactly when a model was
 *  declared (addUseCaseModelLink). So "no model was named" may be said only
 *  when ALL of these hold; any other case says nothing rather than guess:
 *   - the edges were read (`edges` defined — a failed read is not "none");
 *   - no `uses_model` edge exists;
 *   - the use case was created on or after MODEL_LINKS_SINCE, because an older
 *     case never had links written, so a missing edge proves nothing;
 *   - the case is not flagged `model_link_unrecorded` (the link write failed);
 *   - no `graph_corrected` event on its trail names a declared model — a
 *     correction after the first confirmation writes no link. */
export const MODEL_LINKS_SINCE = '2026-08-18T00:00:00.000Z';
export function registerSaysNoModelNamed(args: {
  useCaseCreatedAt: string | undefined;
  edges: ReadonlyArray<{ edge_type: string }> | undefined;
  events: ReadonlyArray<AuditEvent>;
  /** Set on the use_case node when the link write failed after the case was
   *  saved (IntakeFlow): the missing edge then proves nothing. */
  modelLinkUnrecorded?: boolean;
}): boolean {
  const { useCaseCreatedAt, edges, events } = args;
  if (args.modelLinkUnrecorded === true) return false;
  if (edges === undefined || useCaseCreatedAt === undefined) return false;
  if (useCaseCreatedAt < MODEL_LINKS_SINCE) return false;
  if (edges.some((e) => e.edge_type === 'uses_model')) return false;
  const correctedModel = events.some(
    (e) =>
      e.payload.type === 'graph_corrected' &&
      e.payload.correction.field === 'declared_model_id' &&
      e.payload.correction.corrected_value !== null &&
      e.payload.correction.corrected_value !== undefined,
  );
  return !correctedModel;
}

export type ControlOwnership = Record<string, { owner_name: string; target_date: string }>;
export type ControlAttestations = Record<string, { attested_by_name: string; evidence_note: string }>;

// ---------------------------------------------------------------------------
// §4.4 fallback pointer lines — reused across controls, invariants and firm
// reviews. Two distinct wordings, exactly as specified: "what this means for
// you" for a field that's merely absent, "what this involves" for a control
// id the policy doesn't even recognise.
const POINTER_MEANS_FOR_YOU = 'Ask your AI risk team what this means for you.';
const POINTER_INVOLVES = 'Ask your AI risk team what this involves.';

// §1.2 placeholder resolution. `{audience}` from the widest exposure across
// the graph's output nodes; `{destination}` from the least-controlled
// processing zone (A is least controlled, "stricter always means the
// earlier letter"). These rank tables mirror engine/envelope.ts's own
// (unexported) exposure ranking and the engine's A>B>C zone-strictness
// convention — duplicated here only as static ordering tables, not as a
// second computation of any verdict fact; `maxBy` itself is imported, not
// reimplemented (§1.5).
const AUDIENCE_LABELS: Record<Exposure, string> = {
  'client-facing': 'clients',
  'market-facing': 'the public or the market',
  'internal-shared': 'other teams',
  'internal-only': 'your team',
};
const EXPOSURE_WIDENESS: Record<Exposure, number> = {
  'internal-only': 0,
  'internal-shared': 1,
  'client-facing': 2,
  'market-facing': 3,
};
const DESTINATION_LABELS: Record<DataZone, string> = {
  'Zone A': 'an outside website or service',
  'Zone B': "the supplier's systems, which are outside your firm's own",
  'Zone C': "your firm's own systems",
};
const ZONE_LEAST_CONTROLLED: Record<DataZone, number> = { 'Zone A': 2, 'Zone B': 1, 'Zone C': 0 };

// Mirrors evaluate.ts's own (unexported) `VENDOR_SENTINEL` — 'internal' means
// "no third-party vendor", never a registry claim. Duplicated as a literal
// because src/engine/* cannot be edited by this chunk; it is a sentinel
// value, not logic.
const VENDOR_SENTINEL_INTERNAL = 'internal';

// When the graph is not available (a case reopened from the register, where
// the graph is deliberately not persisted), the placeholders must not fall back
// to the most reassuring value — "your team", "your firm's own systems" — which
// would state something false in the reason for a rule that only fires on wider
// exposure or an outside zone. These neutral phrasings are true for every rule
// that uses the placeholder: {audience} appears only in rules conditioned on
// client- or market-facing exposure, {destination} only in rules conditioned on
// Zone A or Zone B.
const AUDIENCE_UNKNOWN = 'clients or the public';
const DESTINATION_UNKNOWN = "a system outside your firm's own";

function resolveAudience(graph: DataFlowGraph | undefined): string {
  const exposures = graph?.output_nodes.map((n) => n.exposure) ?? [];
  const widest = maxBy(exposures, EXPOSURE_WIDENESS);
  return widest ? AUDIENCE_LABELS[widest] : AUDIENCE_UNKNOWN;
}

function resolveDestination(graph: DataFlowGraph | undefined): string {
  // Every node's zone, not just the processing nodes': the data rules match a
  // zone on ANY node (condition.ts any-node semantics), so the reason must name
  // the least-controlled zone anywhere in the flow, or it can contradict the
  // rule it explains.
  const zones = graph ? [...graph.input_nodes, ...graph.processing_nodes].map((n) => n.data_zone) : [];
  const least = maxBy(zones, ZONE_LEAST_CONTROLLED);
  return least ? DESTINATION_LABELS[least] : DESTINATION_UNKNOWN;
}

// Exported (R16-E §3) so QuestionnaireStep's "why we ask" line can resolve
// a triggering invariant's own `plain_reason` the same way the verdict
// screen does — one computation per fact (R16.md §0 D-02), not a second,
// independently-maintained copy of the {audience}/{destination} resolution
// rule living beside this one.
export function fillPlaceholders(text: string, graph: DataFlowGraph | undefined): string {
  return text.replaceAll('{audience}', resolveAudience(graph)).replaceAll('{destination}', resolveDestination(graph));
}

// ---------------------------------------------------------------------------
// Plain reason for one tripped invariant — §4.4: "invariant without
// plain_reason → its description + the pointer line." The fallback base text
// is the invariant's description AS CAPTURED ON THE VERDICT (`t.description`)
// rather than re-read from today's policy, because the verdict is the record
// of what was actually decided; only the plain_reason lookup itself needs
// today's policy (plain-language text is presentation, re-editable later).
/** A formal description used as a §4.4 fallback, closed as a sentence
 *  before the pointer follows it — descriptions are written as titles with
 *  no full stop ("Autonomous trading execution"), so the pointer used to run
 *  straight on from them ("…execution Ask your AI risk team…"). */
function asSentence(s: string | undefined): string {
  // Tolerates a missing description: a stored control or rule can lack one
  // (older data, hand-written fixtures), and this must never crash the page.
  const t = (s ?? '').trim();
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function invariantPlainReason(t: TrippedInvariantDetail, policy: PolicyFile | undefined, graph: DataFlowGraph | undefined): string {
  const plain = policy?.invariants.find((i) => i.id === t.id)?.plain_reason;
  if (plain) return fillPlaceholders(plain, graph);
  const d = asSentence(t.description);
  return d ? `${d} ${POINTER_MEANS_FOR_YOU}` : POINTER_MEANS_FOR_YOU;
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Safeguard (control) display resolution.

/** §4.4: control without plain_action → formal name + description + pointer;
 *  control id not in the loaded policy, or no policy loaded → "Safeguard
 *  {n}" + the "involves" pointer — NEVER the bare code. `n` is the control's
 *  1-based position in `verdict.controls` (deterministic, already sorted by
 *  id per NF-1) — not a position among only the unresolved ones, so it stays
 *  stable as a cross-reference however many other controls resolve. */
function safeguardPlainAction(control: Control | undefined, position: number): string {
  if (!control) return `Safeguard ${position + 1}. ${POINTER_INVOLVES}`;
  if (control.plain_action) return control.plain_action;
  const d = asSentence(control.description);
  return d ? `${control.name} — ${d} ${POINTER_MEANS_FOR_YOU}` : `${control.name}. ${POINTER_MEANS_FOR_YOU}`;
}

/** §1.2 token rendering + register-assignment override. */
function resolveOwner(
  control: Control | undefined,
  graph: DataFlowGraph | undefined,
  assignment: { owner_name: string; target_date: string } | undefined,
): { ownerText: string; yours: boolean } {
  if (assignment) {
    // D-30: no "not verified" here — that phrase is reserved for attestations.
    return { ownerText: `${assignment.owner_name} (assigned on your firm's register), due ${assignment.target_date}`, yours: false };
  }
  if (!control?.plain_owner) {
    return { ownerText: '', yours: false };
  }

  let base: string;
  let yours: boolean;
  if (control.plain_owner === '@submitter') {
    base = 'you or your manager (as the person responsible for this use)';
    yours = true;
  } else if (control.plain_owner === '@model_owner') {
    const vendor = graph?.processing_nodes.find((n) => n.vendor)?.vendor;
    if (!graph) {
      // Graph not available (a case reopened from the register): whether the
      // model was bought or built is unknown, so say neither.
      base = 'the team responsible for the model';
      yours = false;
    } else if (vendor && vendor !== VENDOR_SENTINEL_INTERNAL) {
      base = 'you or your manager (as the person responsible for this use), working with the supplier';
      yours = true;
    } else {
      base = 'the team that built the model';
      yours = false;
    }
  } else {
    base = control.plain_owner;
    yours = false;
  }

  if (control.plain_owner_with) {
    base += base.endsWith('working with the supplier') ? ` and ${control.plain_owner_with}` : `, with ${control.plain_owner_with}`;
  }
  return { ownerText: base, yours };
}

// W-7 (R16-W §5, D-77). Firm-level evidence (e.g. "platform allow-list
// pins TLS 1.3") does not prove anything about a tool the evidence's own
// `applies_to` scope does not cover — claiming it would state more than
// the firm's records prove (NF-7). Absent `applies_to` = applies
// everywhere (the pre-W-7 behaviour, unchanged).
type EvidenceApplies = 'applies' | 'does-not-apply' | 'cannot-check';

// R16-D2 §4b (D-97). `fallbackScope` is read only when `graph` itself is
// absent (the register path, which does not persist the graph) — when
// `graph` IS present this is byte-identical to the pre-D2 function, so
// every existing caller (the intake result screen, which always has the
// graph) is unaffected.
function evidenceApplies(
  appliesTo: { platforms?: string[]; vendors?: string[] } | undefined,
  graph: DataFlowGraph | undefined,
  fallbackScope?: { platform?: string; vendor?: string },
): EvidenceApplies {
  if (!appliesTo) return 'applies';
  if (graph) {
    const node = graph.processing_nodes[0];
    const platformMatches = node?.platform !== undefined && (appliesTo.platforms ?? []).includes(node.platform);
    const vendorMatches = node?.vendor !== undefined && (appliesTo.vendors ?? []).includes(node.vendor);
    return platformMatches || vendorMatches ? 'applies' : 'does-not-apply';
  }
  if (fallbackScope) {
    const platformMatches = fallbackScope.platform !== undefined && (appliesTo.platforms ?? []).includes(fallbackScope.platform);
    const vendorMatches = fallbackScope.vendor !== undefined && (appliesTo.vendors ?? []).includes(fallbackScope.vendor);
    return platformMatches || vendorMatches ? 'applies' : 'does-not-apply';
  }
  return 'cannot-check';
}

/** A registry plain name placed mid-sentence: the shipped names are labels
 *  written to start a line ("Your firm's cloud AI assistant"), so a leading
 *  "Your" is lower-cased — "…show this for your firm's cloud AI assistant".
 *  Only that word: a proper name ("Microsoft Copilot") is left alone. */
function nameInSentence(name: string): string {
  return name.replace(/^Your\b/, 'your');
}

// R16-D2 §7 (DR7-34). Which registered platform or supplier's name covers
// the first screen's "already in place" note — the one THIS case uses
// that a scoped, verified safeguard's `applies_to` actually matched.
// Platform wins when both would match (one case has one platform and one
// supplier, so this is the only tie that can occur). An entry with no
// plain_name gives no name — never its bare id on the first screen.
function resolveInPlaceScopeName(
  verdict: Verdict,
  policy: PolicyFile | undefined,
  safeguards: SafeguardView[],
  graph: DataFlowGraph | undefined,
  fallbackScope: { platform?: string; vendor?: string } | undefined,
): string | undefined {
  const scope = graph ? { platform: graph.processing_nodes[0]?.platform, vendor: graph.processing_nodes[0]?.vendor } : fallbackScope;
  if (!scope) return undefined;
  const verifiedScopedAppliesTo = verdict.controls
    .filter((cid) => safeguards.find((s) => s.id === cid)?.status === 'verified')
    .map((cid) => policy?.controls.find((c) => c.id === cid)?.verification_evidence)
    .filter((e) => e?.status === 'verified' && e.applies_to)
    .map((e) => e!.applies_to!);
  if (verifiedScopedAppliesTo.length === 0) return undefined;
  if (scope.platform !== undefined && verifiedScopedAppliesTo.some((a) => (a.platforms ?? []).includes(scope.platform!))) {
    // No plain_name → undefined: the note stays generic rather than show an
    // internal id on the first screen (the loader already warns about a
    // registry entry without a plain_name).
    const name = policy?.platforms?.find((p) => p.id === scope.platform)?.plain_name;
    return name ? nameInSentence(name) : undefined;
  }
  if (scope.vendor !== undefined && verifiedScopedAppliesTo.some((a) => (a.vendors ?? []).includes(scope.vendor!))) {
    const name = policy?.vendors?.find((v) => v.id === scope.vendor)?.plain_name;
    return name ? nameInSentence(name) : undefined;
  }
  return undefined;
}

/** §5 "Reviewer evidence panel" text — only ever shown when the policy's
 *  evidence WOULD have been verified but for the scope mismatch (callers
 *  gate on that; see buildVerdictView's safeguard loop). */
function evidenceScopeNote(
  appliesTo: { platforms?: string[]; vendors?: string[] },
  applies: EvidenceApplies,
  policy: PolicyFile | undefined,
): string {
  const names = [
    ...(appliesTo.platforms ?? []).map((id) => policy?.platforms?.find((p) => p.id === id)?.plain_name ?? id),
    ...(appliesTo.vendors ?? []).map((id) => policy?.vendors?.find((v) => v.id === id)?.plain_name ?? id),
  ].map(nameInSentence);
  const joined = joinWithAnd(names);
  return applies === 'cannot-check'
    ? `Your firm's records show this for ${joined} — we couldn't check whether that includes this tool.`
    : `Your firm's records show this for ${joined} — not for this tool.`;
}

function safeguardStatus(
  controlId: string,
  policy: PolicyFile | undefined,
  attestations: ControlAttestations | undefined,
  graph: DataFlowGraph | undefined,
  fallbackScope?: { platform?: string; vendor?: string },
): SafeguardStatus {
  const attested = attestations?.[controlId] !== undefined;
  if (!policy) return attested ? 'attested' : 'unknown';
  const control = policy.controls.find((c) => c.id === controlId);
  if (control?.verification_evidence?.status === 'verified') {
    if (evidenceApplies(control.verification_evidence.applies_to, graph, fallbackScope) === 'applies') return 'verified';
  }
  return attested ? 'attested' : 'outstanding';
}

// ---------------------------------------------------------------------------
// Review instances — §1.3/§1.4/§4.4. One per DownstreamReviewSource; the
// BASE id (before the first ":") is what a control's covers_reviews entry
// and the sentinel checks below match against.
interface ReviewInstance {
  baseId: string;
  formalName: string;
  plainName: string;
  ownerText: string;
}

// W-6 (R16-W §5, D-76): both renamed to noun phrases — these plainNames
// feed BOTH "Checks other teams run" (a list item, already fine as a noun
// phrase) AND the new single "(Doing this also completes {list} — one
// piece of work.)" sentence (§4.2 item 4), where the OLD clause-shaped
// name ("the supplier is assessed") read as "(This also covers the
// supplier is assessed — one piece of work.)" — grammatically broken.
const PV_UNREGISTERED_PLAIN = { name: "adding the supplier to your firm's list", owner: 'your vendor-risk team' };
const MODEL_REGISTRY_PLAIN = { name: "adding the model to your firm's list of known models", owner: 'your AI risk team' };
// UNSIGNED-MODEL: a model the firm lists but has not accepted owes the firm's
// acceptance, not a registry entry it already has.
const MODEL_UNACCEPTED_PLAIN = { name: 'your AI risk team accepting this model', owner: 'your AI risk team' };
// §4.4: "pack review → 'a regulatory review required for this kind of use —
// ask your AI risk team which'" (D-15). Every base id that is neither a firm
// downstream_reviews id nor one of the two sentinels is, by §1.3's
// four-source enumeration, a pack rule id. CR6-13: when the loaded packs
// are available (options.packs) and the rule is a required_review with its
// own plain_name / plain_owner, those words are used; this generic line is
// only the fallback for a pack not loaded or a rule without them.
const PACK_REVIEW_FALLBACK_NAME = 'a regulatory review required for this kind of use — ask your AI risk team which';
const PACK_REVIEW_FALLBACK_OWNER = 'your AI risk team';

function baseReviewId(ruleId: string): string {
  const idx = ruleId.indexOf(':');
  return idx === -1 ? ruleId : ruleId.slice(0, idx);
}

function resolveReviewPlain(
  baseId: string,
  policy: PolicyFile | undefined,
  packs: JurisdictionPack[] = [],
  formalReview?: string,
  ruleId?: string,
): { name: string; owner: string } {
  if (baseId === 'PV-UNREGISTERED') return PV_UNREGISTERED_PLAIN;
  if (baseId === 'MODEL-REGISTRY') {
    // The model id is everything after the first ":" (ids such as qwen3:4b
    // carry their own colon).
    const modelId = ruleId !== undefined ? ruleId.slice(ruleId.indexOf(':') + 1) : undefined;
    // UNSIGNED-MODEL review: "listed" means the policy resolves the id the way
    // the engine does (exact non-family entry, else a family whose
    // version-pattern prefix matches it) — NOT "is_approved is false here". The
    // engine only owes this review for an unlisted or unaccepted model, and
    // this screen reads the policy as written: a family lapsed by its
    // reattest_by date still reads is_approved true, and a stored case keeps
    // owing the review after the firm later accepts the model.
    // One rule, the engine's own (exported resolveApprovedModel) — no copy.
    const listed = modelId !== undefined && resolveApprovedModel(policy?.approved_models, modelId) !== undefined;
    return listed ? MODEL_UNACCEPTED_PLAIN : MODEL_REGISTRY_PLAIN;
  }
  // CR7-29: a firm rule and a pack rule may share an id. The firm's words are
  // used only when the review text the verdict recorded is the firm rule's own
  // (the engine writes `rule.review` for a firm rule); otherwise fall through
  // to the pack loop. A legacy source with no review text matches by id alone.
  const firmRule: DownstreamReviewRule | undefined = policy?.downstream_reviews?.find(
    (r) => r.id === baseId && (formalReview === undefined || r.review === formalReview),
  );
  if (firmRule) {
    return {
      name: firmRule.plain_name ?? `${firmRule.review} ${POINTER_MEANS_FOR_YOU}`,
      owner: firmRule.plain_owner ?? PACK_REVIEW_FALLBACK_OWNER,
    };
  }
  // CR6-13: first match across packs in the packs array's own order
  // (loadPacks sorts by pack_id — deterministic, as findPackHardLineRule).
  for (const pack of packs) {
    // CR6-13b: two packs may share a rule id with different review text —
    // the rule whose own review is the one the verdict recorded is the match.
    const rule = pack.rules.find(
      (r) => r.id === baseId && r.effect.type === 'required_review' && (formalReview === undefined || r.effect.review === formalReview),
    );
    if (rule && rule.effect.type === 'required_review') {
      return {
        name: rule.effect.plain_name ?? PACK_REVIEW_FALLBACK_NAME,
        owner: rule.effect.plain_owner ?? PACK_REVIEW_FALLBACK_OWNER,
      };
    }
  }
  return { name: PACK_REVIEW_FALLBACK_NAME, owner: PACK_REVIEW_FALLBACK_OWNER };
}

/** §4.4: "verdict without review sources (older data) → every review listed
 *  separately; nothing folded away." A legacy instance's baseId is '' —
 *  deliberately never matched by any real covers_reviews entry, so it can
 *  never be folded into a safeguard. */
function buildReviewInstances(verdict: Verdict, policy: PolicyFile | undefined, packs: JurisdictionPack[] = []): ReviewInstance[] {
  const sources = verdict.downstream_review_sources;
  if (sources !== undefined) {
    return sources.map((s) => {
      const baseId = baseReviewId(s.rule_id);
      const { name, owner } = resolveReviewPlain(baseId, policy, packs, s.review, s.rule_id);
      return { baseId, formalName: s.review, plainName: name, ownerText: owner };
    });
  }
  return (verdict.downstream_reviews ?? []).map((r) => ({ baseId: '', formalName: r, plainName: r, ownerText: PACK_REVIEW_FALLBACK_OWNER }));
}

// ---------------------------------------------------------------------------
// §4.2 copy templates.

// CR9-02 (P6): the ONE wording of "the sign-off is not confirmed", per state. Used by the next step, the
// "What you need to do" box (zero branch, lead and "Then" row). Lower-case, so each use reads in its own
// sentence: after a dash, after "Also, ", or capitalised as a step.
export const SIGNOFF_MISSING_CONFIRM =
  'no sign-off from your AI risk team is on record for this version, so confirm with them before you start.';
export const SIGNOFF_UNKNOWN_CONFIRM =
  "we can't tell yet whether your AI risk team must sign this off, so check with them before you start.";

function headlineText(status: Verdict['status'], needsSignOff: boolean, n: number, signedOff = false, signOffMissing = false, signOffUnknown = false): string {
  if (status === 'rejected') return 'No — not as described.';
  if (signedOff) {
    if (n === 0) return 'Yes — you can start. Your AI risk team has signed it off.';
    if (n === 1) return 'Nearly. You can start once 1 safeguard is in place — your AI risk team has signed it off.';
    return `Nearly. You can start once ${n} safeguards are in place — your AI risk team has signed it off.`;
  }
  if (needsSignOff) {
    if (n === 0) return 'Not yet. You can start once your AI risk team has signed it off.';
    if (n === 1) return 'Not yet. You can start once your AI risk team has signed it off and 1 safeguard is in place.';
    return `Not yet. You can start once your AI risk team has signed it off and all ${n} safeguards are in place.`;
  }
  if (signOffMissing) {
    // Non-permissive (BC-005): a required sign-off with none on record is not a
    // green light, and this screen cannot say it is merely pending either.
    if (n === 0) return 'No sign-off from your AI risk team is on record for this version — confirm with them before you start.';
    if (n === 1) return 'Not confirmed. No sign-off from your AI risk team is on record, and 1 safeguard is still to put in place.';
    return `Not confirmed. No sign-off from your AI risk team is on record, and ${n} safeguards are still to put in place.`;
  }
  if (signOffUnknown) {
    // CR8-02 (P4): whether a sign-off is required is not known on this screen — say nothing permissive.
    if (n === 0) return "We can't tell from this screen whether your AI risk team must sign this off — confirm with them before you start.";
    if (n === 1) return "Not yet confirmed. We can't tell whether your AI risk team must sign this off, and 1 safeguard is still to put in place.";
    return `Not yet confirmed. We can't tell whether your AI risk team must sign this off, and ${n} safeguards are still to put in place.`;
  }
  if (n === 0) return 'Yes — you can start.';
  if (n === 1) return 'Nearly. You can start once 1 safeguard is in place — no sign-off needed.';
  return `Nearly. You can start once ${n} safeguards are in place — no sign-off needed.`;
}

// Exported so VerdictDisplay.tsx's "No" screen can join
// `no.contributingAssumptions`' short labels the same way every other list
// on this screen already is ("a" / "a and b" / "a, b and c") — one
// implementation, not a second one living beside it in the component.
export function joinWithAnd(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function mentionsAiRiskTeam(text: string): boolean {
  return /\bAI risk team\b/i.test(text);
}

function buildNextSteps(args: {
  needsSignOff: boolean;
  signOffMissing: boolean;
  signOffUnknown: boolean;
  outstandingSafeguards: SafeguardView[];
  owedReviews: OwedReviewView[];
  provisionalReasons: readonly ProvisionalReason[];
}): string[] {
  const { needsSignOff, signOffMissing, signOffUnknown, outstandingSafeguards, owedReviews, provisionalReasons } = args;
  const steps: string[] = [];
  // P4 (CR8-02): when a required sign-off is not on record, or whether one is required can't be
  // determined, no step — least of all the finish line — says the person can start.
  const signOffUnclear = signOffMissing || signOffUnknown;

  if (needsSignOff) {
    steps.push(
      'Send this result to your AI risk team — the independent team that checks how the firm uses AI. They review the use in principle and sign it off; the safeguards can be finished after.',
    );
    if (outstandingSafeguards.some((s) => mentionsAiRiskTeam(s.ownerText))) {
      steps.push('(Your AI risk team can help you set this up; signing off the use overall is a separate step.)');
    }
  }

  if (signOffMissing) {
    steps.push(SIGNOFF_MISSING_CONFIRM.charAt(0).toUpperCase() + SIGNOFF_MISSING_CONFIRM.slice(1));
  }

  if (outstandingSafeguards.length > 0) {
    const total = outstandingSafeguards.length;
    const yoursCount = outstandingSafeguards.filter((s) => s.yours).length;
    if (yoursCount === total) {
      steps.push(
        total === 1
          ? "Put the safeguard below in place — it's yours to arrange (you or your manager)."
          : "Put the safeguards below in place — they're yours to arrange (you or your manager).",
      );
    } else if (yoursCount === 0) {
      steps.push('Ask the team named against each safeguard below to put it in place, and agree a date. None of them is yours to do yourself.');
    } else {
      steps.push(
        `Ask the team named against each safeguard below to put it in place, and agree a date. ${yoursCount} of them ${
          yoursCount === 1 ? 'is' : 'are'
        } yours to arrange — marked "yours" and listed first. "You or your manager" means your side of the business: agree between you who takes each one.`,
      );
    }
  }

  if (owedReviews.length > 0) {
    const teams = joinWithAnd(dedupeStrings(owedReviews.map((r) => r.ownerText)));
    steps.push(`Also send this result to ${teams} — they run their own checks, listed below. Ask each team whether you must wait for theirs before you start.`);
  }

  if (provisionalReasons.includes('no_regulatory_basis')) {
    steps.push('Tell us which countries it involves, then check again — the answer may change.');
  }

  // "finish" — D-38: "Then" appears only after a preceding step.
  const hasOutstanding = outstandingSafeguards.length > 0;
  let finish: string;
  if (signOffUnclear) {
    finish = hasOutstanding
      ? 'Start only once your AI risk team has confirmed where the sign-off stands, and every safeguard below is in place.'
      : 'Start only once your AI risk team has confirmed where the sign-off stands.';
  } else if (needsSignOff && hasOutstanding) {
    finish = "Start only when both are done: it's signed off, and every safeguard below is in place.";
  } else if (needsSignOff) {
    finish = "Start once it's signed off.";
  } else if (steps.length === 0) {
    finish = "You can start. It's saved on your firm's register of AI uses, which your AI risk team can see.";
  } else {
    finish = "Then you can start. It's saved on your firm's register of AI uses, which your AI risk team can see.";
  }
  steps.push(finish);

  if ((needsSignOff || signOffUnclear) && hasOutstanding) {
    steps.push('Not sure who these teams are? Ask your AI risk team when you send them this result.');
  }

  return steps;
}

/** CR8-17. The stale sources that count for THIS verdict: only packs the verdict actually used, read from
 *  verdict.pack_versions (the engine's record of the active packs). A legacy verdict with no pack_versions
 *  has nothing saying a pack was used, so none count. `stale_sources` itself stays as recorded; this is a
 *  display filter, shared by the first screen's line and the reviewer banner. */
export function usedStaleSources(verdict: Verdict): NonNullable<Verdict['stale_sources']> {
  const used = verdict.pack_versions ?? {};
  return (verdict.stale_sources ?? []).filter((s) => Object.prototype.hasOwnProperty.call(used, s.pack_id));
}

function buildCouldStillChange(verdict: Verdict): string[] {
  const lines: string[] = [];
  const reasons = verdict.provisional_reasons;
  if (isVerdictProvisional(verdict)) {
    if (reasons?.includes('unsigned_pack_rules')) {
      lines.push(
        "Some country-specific rules it used haven't been formally adopted by your firm yet — your AI risk team can tell you which. If they're adopted as written, this result stays the same.",
      );
    }
    if (reasons?.includes('unclassified_decision_type')) {
      const typed = verdict.unclassified_decision_types ?? [];
      const quoted = typed.map((t) => `"${t}"`).join(', ');
      lines.push(
        `You described a decision we don't have a rule for (${quoted}), so nothing specific to it was checked — your AI risk team will look at it.`,
      );
    }
    if (!reasons || reasons.length === 0) {
      lines.push('This result may still change — your AI risk team can tell you why.');
    }
  }
  // CR7-39: the review-overdue banner lives in the collapsed reasoning section;
  // derived from verdict.stale_sources, so it is absent when there are none.
  if (usedStaleSources(verdict).length > 0) {
    lines.push(
      "Some of the regulatory text behind this result is overdue for a fresh look — it was last checked longer ago than your firm's window allows. Your AI risk team can tell you which.",
    );
  }
  // RA-11: independent of provisional status — a medium caveat never makes a
  // verdict provisional (only 'low' does), but it must still surface.
  if (verdict.confidence_caveats.some((c) => c.confidence === 'medium')) {
    lines.push('Some rules it used are worded with less certainty than usual — check this result with your compliance team before relying on it.');
  }
  return lines;
}

// ---------------------------------------------------------------------------
// §2 (VD-10). The "No" screen's own composition.

const HARD_LINE_CODA = "That's a line your firm never crosses, and no safeguard can make up for it.";

/** A plain_reason never carries its own trailing period (policy authoring
 *  convention — every `plain_reason` in the shipped policy is a clause,
 *  not a sentence); its §4.4 FALLBACK does, because it ends in a complete
 *  sentence of its own (the pointer line, shared with other callers that
 *  use it standalone). Stripping a single trailing period before
 *  appending a further clause or sentence is what keeps both cases
 *  reading as one well-punctuated sentence rather than ".." or ".,". */
function withoutTrailingPeriod(s: string): string {
  return s.replace(/\.$/, '');
}

/** The core clause of a "Why:" sentence — the rule's plain_reason when it
 *  has one, else its formal description (§4.4 fallback), flagged so the
 *  pointer line follows the WHOLE sentence. (Verifying R16-D2: splicing the
 *  pointer into the middle produced "…for this exposure Ask your AI risk
 *  team what this means for you, and your firm has no safeguard…".) */
function reasonCore(
  plainReason: string | undefined,
  description: string,
  graph: DataFlowGraph | undefined,
): { text: string; fallback: boolean } {
  return plainReason
    ? { text: withoutTrailingPeriod(fillPlaceholders(plainReason, graph).trim()), fallback: false }
    : { text: withoutTrailingPeriod((description ?? '').trim()), fallback: true };
}

/** The finished "Why:" sentence, with the §4.4 pointer after it when the
 *  core was a fallback. */
function withPointerIfFallback(sentence: string, fallback: boolean): string {
  return fallback ? `${sentence} ${POINTER_MEANS_FOR_YOU}` : sentence;
}

/** "What would change the answer: …" — shared by a firm and a pack hard
 *  line (§2 item 4 draws no distinction between them here). */
function hardLineChange(plainChange: string | undefined, graph: DataFlowGraph | undefined): string {
  // A-2: {audience}/{destination} are filled here exactly as plain_reason's are.
  return plainChange
    ? `${asSentence(fillPlaceholders(plainChange, graph))} Then check again.`
    : `change how it would be used, then check again. ${POINTER_MEANS_FOR_YOU}`;
}

/** A pack's jurisdiction CODE ("EU") as words that read inside "the rules
 *  your firm has adopted for …": the policy's own name for it, with "the"
 *  where English needs one ("the United Kingdom", "the European Union",
 *  but "Canada"). A code the policy does not list never reaches the screen
 *  as itself. (Verifying R16-D2: the first build used the code, and its
 *  tests passed only because their sample packs spelled the code as words.) */
// Starts with a word that takes "the", contains " of " ("the Republic of
// Ireland", "the Isle of Man"), or ends with one (R16-D2 review pass 1: the
// first version missed every "X of Y" name).
const NEEDS_THE =
  /^(United |European |Republic |Kingdom |Commonwealth |Federation |Federal |Isle |State of )| of |(Union|Kingdom|States|Republic|Islands|Emirates|Netherlands|Philippines|Bahamas|Gambia|Maldives)$/;
function countryPhrase(code: string, policy: PolicyFile | undefined): string {
  const name = lookupCountryName(code, policy);
  if (!name) return 'the countries it involves';
  return NEEDS_THE.test(name) ? `the ${name}` : name;
}

/** A pack rule with a `hard_line` effect, found by binding_constraint id
 *  across every loaded pack — the id space is flat (a pack rule id is not
 *  namespaced by pack), so the first match across packs, in the packs
 *  array's own order, is the rule; loadPacks() sorts packs by pack_id
 *  (NF-1), so this is deterministic. */
function findPackHardLineRule(
  bindingConstraint: string,
  packs: JurisdictionPack[],
): { rule: PackRule; pack: JurisdictionPack } | undefined {
  for (const pack of packs) {
    const rule = pack.rules.find((r) => r.id === bindingConstraint && r.effect.type === 'hard_line');
    if (rule) return { rule, pack };
  }
  return undefined;
}

/** D-80. An assumption "contributed" when any of its `fields` appears
 *  among the binding rule's own condition keys — for a pack rule, the
 *  PACK rule's condition, never the firm's. No condition at all (the
 *  `other`/unknown-id kind) means nothing can honestly be said to have
 *  contributed. */
function contributingAssumptions(assumptions: Assumption[], condition: Condition | undefined): Assumption[] {
  if (!condition) return [];
  const keys = Object.keys(condition);
  return assumptions.filter((a) => a.fields.some((f) => keys.includes(f)));
}

function buildNoScreen(
  verdict: Verdict,
  policy: PolicyFile | undefined,
  packs: JurisdictionPack[],
  assumptions: Assumption[],
  graph: DataFlowGraph | undefined,
): NoScreenView {
  const bindingId = verdict.binding_constraint;
  const firmHardLine = policy?.hard_lines.find((h) => h.id === bindingId);
  const packMatch = findPackHardLineRule(bindingId, packs);
  const trippedMatch = (verdict.explanation?.tripped_invariants ?? []).find((t) => t.id === bindingId);

  let kind: NoScreenView['kind'];
  let reason: string;
  let change: string | undefined;
  let condition: Condition | undefined;

  if (firmHardLine) {
    kind = 'hard_line';
    const core = reasonCore(firmHardLine.plain_reason, firmHardLine.description, graph);
    // CR6-18: an empty core (a blank description) must not leave a stray ". "
    // in front of the coda — the sentence is composed without it.
    reason = withPointerIfFallback(core.text ? `${core.text}. ${HARD_LINE_CODA}` : HARD_LINE_CODA, core.fallback);
    change = hardLineChange(firmHardLine.plain_change, graph);
    condition = firmHardLine.condition;
  } else if (packMatch && packMatch.rule.effect.type === 'hard_line') {
    kind = 'pack_hard_line';
    const country = countryPhrase(packMatch.pack.jurisdiction, policy);
    const effect = packMatch.rule.effect;
    const packCore = effect.plain_reason ? withoutTrailingPeriod(fillPlaceholders(effect.plain_reason, graph).trim()) : '';
    reason = packCore
      ? `${packCore}. It's one of the rules your firm has adopted for ${country}, and no safeguard can make up for it.`
      : effect.plain_reason
        ? `It's one of the rules your firm has adopted for ${country}, and no safeguard can make up for it.`
        : `one of the rules your firm has adopted for ${country} rules this out. ${POINTER_MEANS_FOR_YOU}`;
    change = hardLineChange(effect.plain_change, graph);
    condition = packMatch.rule.condition;
  } else if (trippedMatch) {
    // CS-2: no control in the library resolves this tripped invariant.
    kind = 'unsatisfiable';
    const invariant = policy?.invariants.find((i) => i.id === bindingId);
    const core = reasonCore(invariant?.plain_reason, trippedMatch.description, graph);
    reason = withPointerIfFallback(
      core.text ? `${core.text}, and your firm has no safeguard that resolves it.` : 'Your firm has no safeguard that resolves it.',
      core.fallback,
    );
    change = 'change how it would be used, or ask your AI risk team whether the firm can add a safeguard for this.';
    condition = policy?.invariants.find((i) => i.id === bindingId)?.condition;
  } else {
    // An id found nowhere loaded — never the bare id on the first screen,
    // and nothing honest can be said about what would change it.
    kind = 'other';
    reason = `one of your firm's rules rules this out. ${POINTER_MEANS_FOR_YOU}`;
    condition = undefined;
  }

  const contributing = contributingAssumptions(assumptions, condition);

  return {
    kind,
    reason,
    ...(change !== undefined ? { change } : {}),
    contributingAssumptions: contributing,
    otherAssumptionCount: assumptions.length - contributing.length,
  };
}

// ---------------------------------------------------------------------------

/** §4.1: the one view-model behind the verdict's first screen and the four
 *  readers that need a safeguard's status (WhatToDo, SignOffChecklist, the
 *  evidence panel, and the first screen itself). Pure: same inputs, same
 *  output, every time (NF-1's discipline extended to presentation). */
// Review pass 1, M-2: the permissive self-service reading is only made at the stages a self-service case
// actually occupies. At idea / exploring / retired nothing is claimed.
const SELF_SERVICE_READABLE_STAGES: ReadonlySet<LifecycleStage> = new Set<LifecycleStage>(['approved', 'in_production', 'monitored']);

export function buildVerdictView(
  verdict: Verdict,
  policy: PolicyFile | undefined,
  graph: DataFlowGraph | undefined,
  ownership: ControlOwnership | undefined,
  attestations: ControlAttestations | undefined,
  stage: LifecycleStage | undefined,
  options: VerdictViewOptions = {},
): VerdictView {
  const isRejected = verdict.status === 'rejected';
  // CR7-09: whether a sign-off was required comes from the tier's workflow
  // (the engine's router), not from the stage — a signed-off case moves on to
  // 'approved' and used to read as "no sign-off needed". With no stage (the
  // intake screen before saving) nothing is claimed, as before.
  const signOffRequired =
    stage === 'pre_checked' || (stage !== undefined && policy?.tier_workflow !== undefined && routeToWorkflow(verdict.tier, policy).lifecycle_stage === 'pre_checked');
  // From the trail ALONE (review pass 1, I-1): an approving 2LoD review of THIS
  // verdict is a fact whatever the policy says today — a later tier_workflow
  // edit, or no policy at all, must not turn it back into "nobody".
  const signedOff = (options.auditEvents ?? []).some(
    (e) => e.payload.type === 'twoloD_reviewed' && e.payload.action === 'approved' && e.payload.verdict_id === verdict.id,
  );
  // Pending only while the case is actually waiting (stage pre_checked). At a
  // later stage with no approving review on this verdict the screen claims
  // neither "pending" nor "no sign-off needed" — only that none is recorded
  // (M-1).
  const needsSignOff = signOffRequired && !signedOff && stage === 'pre_checked';
  const signOffMissing = signOffRequired && !signedOff && stage !== undefined && stage !== 'pre_checked';
  // CR8-02 (P4): "no sign-off needed" is only said where self-service is DETERMINED — an explicit stage and a
  // policy whose tier_workflow routes this tier to self-service. No stage, or no valid policy, and no approving
  // review: unknown, and every surface stays non-permissive. (The intake result has no stage until the save
  // lands, so a genuine self-service case reads cautiously for that moment — accepted.)
  const signOffUnknown = !signOffRequired && !signedOff && (stage === undefined || policy?.tier_workflow === undefined || !SELF_SERVICE_READABLE_STAGES.has(stage));

  // Rejected verdicts carry no safeguards, next steps or could-still-change
  // lines from THIS view-model — the headline still covers the rejected
  // case (§4.2 item 1 lists it explicitly) so the first screen never
  // renders blank. The "No" screen's own composition (VD-10, §2) is `no`.
  if (isRejected) {
    return {
      isRejected: true,
      needsSignOff,
      signOffRequired,
      signedOff,
      signOffMissing,
      signOffUnknown,
      headline: headlineText('rejected', needsSignOff, 0),
      whyReasons: [],
      whyHasMore: false,
      nextSteps: [],
      safeguards: [],
      outstandingSafeguards: [],
      inPlaceSafeguards: [],
      attestedSafeguards: [],
      outstandingCount: 0,
      owedReviews: [],
      coveredReviewFormalNames: [],
      whoSignsOff: '',
      couldStillChange: [],
      no: buildNoScreen(verdict, policy, options.packs ?? [], options.assumptions ?? [], graph),
    };
  }

  const tripped = verdict.explanation?.tripped_invariants ?? [];
  const reviewInstances = buildReviewInstances(verdict, policy, options.packs ?? []);

  // Which base ids does ANY safeguard on this verdict cover? Used to split
  // review instances into covered (folded into a safeguard) vs. owed.
  const coveredBaseIds = new Set<string>();
  for (const cid of verdict.controls) {
    const control = policy?.controls.find((c) => c.id === cid);
    for (const base of control?.covers_reviews ?? []) coveredBaseIds.add(base);
  }

  const safeguards: SafeguardView[] = verdict.controls.map((cid, position) => {
    const control = policy?.controls.find((c) => c.id === cid);
    const status = safeguardStatus(cid, policy, attestations, graph, options.evidenceScope);
    const { ownerText, yours } = resolveOwner(control, graph, ownership?.[cid]);
    const plainReasons = dedupeStrings(
      tripped.filter((t) => t.required_controls.includes(cid)).map((t) => invariantPlainReason(t, policy, graph)),
    );
    const coveredReviews: CoveredReview[] = (control?.covers_reviews ?? []).length
      ? reviewInstances
          .filter((inst) => (control?.covers_reviews ?? []).includes(inst.baseId))
          .map((inst) => ({ plainName: inst.plainName, formalName: inst.formalName, baseId: inst.baseId }))
      : [];
    // W-6 (D-76): one sentence, every covered review listed once, "a" /
    // "a and b" / "a, b and c" — never one note per review.
    const alsoCompletesNote =
      coveredReviews.length > 0
        ? `(Doing this also completes ${joinWithAnd(coveredReviews.map((r) => r.plainName))} — one piece of work.)`
        : undefined;
    const attestation = attestations?.[cid];
    // W-7 (D-77): a scope note is only meaningful for evidence that WOULD
    // have been verified but for the scope mismatch.
    const evidence = control?.verification_evidence;
    const appliesTo = evidence?.status === 'verified' ? evidence.applies_to : undefined;
    const applies = appliesTo ? evidenceApplies(appliesTo, graph, options.evidenceScope) : 'applies';
    return {
      id: cid,
      status,
      plainAction: safeguardPlainAction(control, position),
      ownerText,
      yours,
      plainReasons,
      coveredReviews,
      ...(alsoCompletesNote ? { alsoCompletesNote } : {}),
      ...(attestation ? { attestedByName: attestation.attested_by_name, evidenceNote: attestation.evidence_note } : {}),
      ...(appliesTo && applies !== 'applies' ? { evidenceScopeNote: evidenceScopeNote(appliesTo, applies, policy) } : {}),
    };
  });

  const outstandingAll = safeguards.filter((s) => s.status === 'outstanding' || s.status === 'unknown');
  // Array.prototype.sort is stable (ES2019+) — ties keep verdict.controls'
  // own deterministic order.
  const outstandingSafeguards = [...outstandingAll].sort((a, b) => Number(b.yours) - Number(a.yours));
  const inPlaceSafeguards = safeguards.filter((s) => s.status === 'verified');
  const attestedSafeguards = safeguards.filter((s) => s.status === 'attested');
  const outstandingCount = outstandingAll.length;
  // R16-D2 §7 (DR7-34).
  const inPlaceScopeName = resolveInPlaceScopeName(verdict, policy, safeguards, graph, options.evidenceScope);

  const owedInstances = reviewInstances.filter((inst) => !coveredBaseIds.has(inst.baseId));
  const owedReviews: OwedReviewView[] = [];
  const seenNames = new Set<string>();
  for (const inst of owedInstances) {
    if (seenNames.has(inst.plainName)) continue;
    seenNames.add(inst.plainName);
    owedReviews.push({ plainName: inst.plainName, ownerText: inst.ownerText, baseId: inst.baseId });
  }

  // WhatToDo's own "separate reviews" filter (formal vocabulary, unchanged —
  // §4.2/item 3): a formal review string is fully covered only when EVERY
  // instance sharing that text is covered — two firm rules can share one
  // formal name (DR-INFOSEC-01/02) and only one of them might be covered.
  const coveredReviewFormalNames = dedupeStrings(
    [...new Set(reviewInstances.map((inst) => inst.formalName))].filter((name) =>
      reviewInstances.filter((inst) => inst.formalName === name).every((inst) => coveredBaseIds.has(inst.baseId)),
    ),
  );

  // Why (§4.2 item 2): binding constraint's reason first, then the rest in
  // their existing (deterministic) order; distinct text only; cap at two.
  const byBindingFirst = [...tripped].sort((a, b) => {
    if (a.id === verdict.binding_constraint) return -1;
    if (b.id === verdict.binding_constraint) return 1;
    return 0;
  });
  const whyAll = dedupeStrings(byBindingFirst.map((t) => invariantPlainReason(t, policy, graph)));

  const headline = headlineText(verdict.status, needsSignOff, outstandingCount, signedOff, signOffMissing, signOffUnknown);
  const nextSteps = buildNextSteps({
    needsSignOff,
    signOffMissing,
    signOffUnknown,
    outstandingSafeguards,
    owedReviews,
    provisionalReasons: verdict.provisional_reasons ?? [],
  });
  const whoSignsOff = signedOff
    ? 'your AI risk team — signed off by your AI risk team on this version of the result.'
    : needsSignOff
    ? "your AI risk team. Until they do, this result isn't final."
    : signOffMissing
    ? 'your AI risk team — no sign-off is recorded on this version of the result.'
    : signOffUnknown
    ? "not known from this screen — ask your AI risk team whether this needs their sign-off."
    : "nobody — it's low-stakes enough for you to go ahead once the safeguard is in place.";

  return {
    isRejected: false,
    needsSignOff,
    signOffRequired,
    signedOff,
    signOffMissing,
    signOffUnknown,
    headline,
    whyReasons: whyAll.slice(0, 2),
    whyHasMore: whyAll.length > 2,
    nextSteps,
    safeguards,
    outstandingSafeguards,
    inPlaceSafeguards,
    attestedSafeguards,
    outstandingCount,
    owedReviews,
    coveredReviewFormalNames,
    whoSignsOff,
    couldStillChange: buildCouldStillChange(verdict),
    ...(inPlaceScopeName ? { inPlaceScopeName } : {}),
  };
}
