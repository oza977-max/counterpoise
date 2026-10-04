import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { DataFlowGraph, EnvelopeDimensionFit, JurisdictionPack, PolicyFile, RuleRationale, TrippedInvariantDetail, VerdictExplanation } from '../engine/types';
import type { Assumption } from './plain-copy';
import { findControlName, findRuleDescription } from '../engine/find-rule-description';
import { fitsEnvelope, inheritableControls } from '../engine/envelope';
import { graphSummaryRows } from './graph-summary';
import { isVerdictProvisional } from '../engine/provisional';
import type { ProvisionalReason } from '../engine/provisional';
import type { Verdict } from '../types/verdict';
import type { AuditEvent, LifecycleStage } from '../store/types';
import { buildChallengeMemo } from './challenge-memo';
import type { KnowledgeMatch } from '../engine/knowledge-lens';
import { getCurrentPolicyYaml } from '../store/policy-source';
import { STATUS_LABEL, GRAPH_FIELD_LABELS } from './field-copy';
import { supplierDisplayName, approvedModelBaseLabelFor } from './plain-copy';
import { resolveApprovedModel } from '../engine/evaluate';
import { Fold } from './Fold';
// R16 chunk D1 (build/prompts/R16.md v2.1 §4.1): the one view-model behind
// the verdict's first screen AND the four readers that need a safeguard's
// status (this first screen, WhatToDo, SignOffChecklist, the evidence
// panel below) — "one computation per fact" (principle 0.5).
import { buildVerdictView, joinWithAnd, SIGNOFF_MISSING_CONFIRM, SIGNOFF_UNKNOWN_CONFIRM, usedStaleSources, type SafeguardStatus, type SafeguardView, type VerdictView } from './verdict-view-model';

// verdict-audit.md §5. Rule 4 (cross-cutting.md §7): presentation-only —
// static policy-description lookup for the reasoning-trace fallback is
// data lookup, not business logic.
interface VerdictDisplayProps {
  verdict: Verdict;
  auditEvents: AuditEvent[];
  policy?: PolicyFile;
  // V1.2-B: provenance panel + register status note — both optional so
  // older render paths (and tests) without them stay valid.
  graph?: DataFlowGraph;
  registerStage?: LifecycleStage;
  // UC-11, register path: the caller (RegisterDetail) has no graph, so it
  // decides from the register's own links (registerSaysNoModelNamed) whether
  // "No AI model is recorded" is provable. Ignored when `graph` is present.
  noModelNamed?: boolean;
  // Optional since P8-C06. register-lifecycle.md §15.1b: the sign-off page
  // reuses this component, and correction is a submitter action
  // (verdict-audit.md §6.1), not a reviewer one. Required-with-a-no-op would
  // have left a control on the reviewer's page that still invites the click.
  onCorrect?: () => void;
  // R10-CM: optional context for the challenge-memo export. Absent on older
  // render paths and tests; the download renders whenever a verdict exists,
  // falling back to a generic label.
  memoLabel?: string;
  memoDescription?: string;
  // R11-KL: the third lever, computed by the caller (IntakeFlow / Register-
  // Detail already compute this for KnowledgeLensPanel) and threaded through
  // so the memo export can restate it — never recomputed here.
  knowledgeLensMatches?: KnowledgeMatch[];
  // R15-C2 (finishing R14's partial R9-idiom pass; proposal §3.1, S2/S3):
  // the caller (RegisterDetail) owns role + stage, so it decides whether the
  // "Before you sign off" checklist and section nav render — the same
  // condition the action bar already renders on (2LoD role, stage awaiting
  // sign-off). VerdictDisplay never re-derives that gate itself.
  showSignOffChecklist?: boolean;
  // design-vision.md L-6 / explore-007 D-003 follow-up: owner/target-date
  // per outstanding control, keyed by control id — the latest
  // control_ownership_assigned event for this verdict, computed by the
  // caller (RegisterDetail already owns the audit-event read pattern for
  // this, same as filedRiskDomains/filedRiskDomainDates). Absent controls
  // are simply unassigned; no assignment is ever invented here.
  controlOwnership?: Record<string, { owner_name: string; target_date: string }>;
  onAssignControlOwner?: (controlId: string, ownerName: string, targetDate: string) => void;
  controlOwnerBusyId?: string | null;
  controlOwnerErrorId?: string | null;
  controlOwnerError?: string | null;
  // RG-9 control-evidence attestation — a reviewer records that a control is
  // in place, with an evidence note. Distinct from the policy's machine
  // `verified` status; rendered as "attested (not verified)".
  controlAttestations?: Record<string, { attested_by_name: string; evidence_note: string }>;
  // code-review-005 F19: the write is async and can fail, and two controls
  // can be saving at once — the caller resolves true/false so the form
  // (ControlEvidenceAttest) knows whether to close or stay open, and busy/
  // error state is now keyed per control id rather than a single shared
  // value that a second in-flight control would clobber.
  onAttestControlEvidence?: (controlId: string, attestedByName: string, evidenceNote: string) => Promise<boolean>;
  controlEvidenceBusyIds?: ReadonlySet<string>;
  controlEvidenceErrors?: ReadonlyMap<string, string>;
  // Whether RegisterDetail is rendering a risk-knowledge section below this
  // component (KnowledgeLensPanel or the "not evaluated" note) — used only
  // to decide whether the checklist/section-nav include that jump link.
  // Never used to hide or show anything else (G6 — no new role-conditional
  // rendering).
  hasRiskKnowledgeSection?: boolean;
  // R16-D2 §2/§3/§4b (D-95, D-96, D-97). This case's own "Not sure"
  // answers (for the "No" screen's contributing check, §2 item 3, and the
  // reviewer section's full list, §2 item 7) and every loaded pack (for a
  // pack hard line's plain_reason/plain_change and its jurisdiction's
  // plain name, §2 item 2). Both optional: an older verdict, or a render
  // path that predates this chunk, simply shows the §4.4 fallbacks.
  assumptions?: Assumption[];
  packs?: JurisdictionPack[];
  // R16-D2 §4b (D-97, W-7). The processing node's platform/vendor, read
  // from the event that recorded the current verdict — the register's own
  // substitute for `graph`, which it does not persist. Ignored whenever
  // `graph` itself is supplied (the intake result screen).
  evidenceScope?: { platform?: string; vendor?: string };
  // design-review-003 (2026-08-31, Panel A/C/D/G — four independent panels
  // converged on this fix): "Why this verdict" was the one analytical panel
  // never wrapped in Fold, so its unfolded-by-default state (R9's original,
  // deliberate choice for 2LoD reviewers) had no seam to vary for a
  // first-time non-technical reader. Same pattern as showSignOffChecklist —
  // the caller (RegisterDetail) owns role, decides the default, and passes
  // it down; VerdictDisplay never re-derives role itself.
  //
  // R16-D1: omitted now defaults to FALSE (closed) — was `true`. This is also
  // the default open/closed state of the new outer "reviewer section" this
  // chunk adds (§4.2 item 9: "collapsed for the submitter, open for 2LoD via
  // the existing reasoningDefaultOpen"). RegisterDetail always passes this
  // prop explicitly (`role === '2LoD'`), so its behaviour is unchanged by the
  // new default; IntakeFlow's submitter-facing render never passed it and so
  // picks up the new default, which is exactly the "collapsed for the
  // submitter" behaviour this chunk needs — with no edit to IntakeFlow.tsx
  // (file-ownership boundary; see the chunk D1 handover note). Flipping a
  // default changes no visible DOM query result in the existing suite: every
  // Testing Library query here finds text regardless of a closed <details>'s
  // open attribute, which is why this is safe against the many tests that
  // never pass this prop.
  //
  // design-review round 3 (2026-08-31, Panel D): now also gates the
  // fragility, regulatory-reasoning, and controls-with-evidence Folds — the
  // three panels grouped into beat 3 ("the basis") alongside Why. This is
  // still only a default-open/closed hint (Panel E): every Fold's content is
  // always in the DOM for every role, this never hides anything from a
  // role, it only changes what's expanded on first render. It deliberately
  // does NOT extend to beat 5's provenance/inheritance Folds (reference
  // material, not part of the reasoning a 2LoD reviewer must read) or to
  // beat 4's expiry section (which is not a Fold at all — see its own
  // comment at the render site).
  reasoningDefaultOpen?: boolean;
}

// BC-V12B-03: wording avoids the words "approved"/"rejected" — existing
// acceptance tests assert a single match on /approved|rejected/i.
const STAGE_NOTE: Partial<Record<LifecycleStage, string>> = {
  pre_checked: 'Saved to register — awaiting active 2LoD sign-off.',
  approved: 'Saved to register — self-service final.',
  in_production: 'Saved to register — in production.',
};

// M-3 (review pass 1) / CR8-11. The engine's model-governance review sentence names the declared
// model by its raw id and says "is not on the firm's registry" even for a model the policy LISTS but
// the firm has not yet accepted; swapping the id for the button label (which carries its own
// "— not yet accepted ..." suffix) produced a garbled sentence. So the whole sentence is rebuilt here
// as a pure function of (review, verdict, policy): the model id comes from the verdict's own review
// sources (rule MODEL-REGISTRY:<id>), the status from the engine's resolveApprovedModel (exact id,
// then family fallback — the way the engine itself classifies), the name from the bare plain name.
// Without a policy the engine's own text is kept — nothing is guessed. All four sites that print a
// review go through this one function.
function reviewWords(review: string, verdict: Verdict, policy: PolicyFile | undefined): string {
  const src = (verdict.downstream_review_sources ?? []).find((x) => x.review === review && x.rule_id.startsWith('MODEL-REGISTRY:'));
  if (!src || !policy) return review;
  const id = src.rule_id.slice(src.rule_id.indexOf(':') + 1);
  const entry = resolveApprovedModel(policy.approved_models, id);
  const lead = 'Model governance review required — ';
  if (entry === undefined) return `${lead}${id} is not on your firm's model list`;
  const name = (entry.is_family ? entry.plain_name?.trim() || id : approvedModelBaseLabelFor(policy.approved_models, id)) ?? id;
  // Review pass 1, I-1: this screen gets TODAY's policy, not the one the verdict was evaluated with.
  // Only an exact entry that still reads not-accepted can honestly say "not yet accepted"; a family
  // (it may have lapsed at evaluation) or an entry that reads accepted now gets wording that is always true.
  return !entry.is_family && entry.is_approved === false
    ? `${lead}${name} is listed but not yet accepted by your firm`
    : `${lead}${name} is on your firm's model list, but a model review was required when this was checked`;
}

// CR7-09 / BC-005. The 'approved' stage is reached by self-service AND by a
// 2LoD sign-off, so its note is derived from what the case needed
// (view.signOffRequired, from the tier's workflow) and what the trail shows
// (view.signedOff, a twoloD_reviewed 'approved' event for THIS verdict) —
// never a fixed "self-service final".
function stageNote(stage: LifecycleStage, view: VerdictView): string | undefined {
  if (stage === 'approved') {
    if (view.signedOff) return 'Saved to register — signed off by your AI risk team.';
    if (view.signOffRequired) return 'Saved to register — no sign-off from your AI risk team is recorded on this version.';
    // P4 (CR8-02): "self-service final" only where self-service is DETERMINED (explicit stage + policy routing).
    if (view.signOffUnknown) return 'Saved to register — whether your AI risk team had to sign this off is not known from this screen.';
    return STAGE_NOTE.approved;
  }
  // P6 (CR9 review): any later stage says the same unconfirmed-sign-off fact, never just the stage.
  if (stage === 'in_production') {
    if (view.signOffMissing) return `${STAGE_NOTE.in_production!.slice(0, -1)} — no sign-off from your AI risk team is recorded on this version.`;
    if (view.signOffUnknown) return `${STAGE_NOTE.in_production!.slice(0, -1)} — whether your AI risk team had to sign this off is not known from this screen.`;
  }
  return STAGE_NOTE[stage];
}

// Display labels for living_status — 'approved' maps to wording without the
// word itself (see the comment at the render site).
const LIVING_STATUS_LABEL: Record<Verdict['living_status'], string> = {
  approved: 'in good standing',
  amber: 'amber — condition under strain',
  breached: 'breached — a condition has been crossed',
  revoked: 'revoked',
};

// Tripped-invariant grouping (presentation only — severity is engine data,
// this just orders and buckets it). An unrecognised severity string still
// renders, appended after the known order, rather than being silently
// dropped from the count.
const KNOWN_SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
function severityGroups(invariants: TrippedInvariantDetail[]): Array<[string, TrippedInvariantDetail[]]> {
  const unknown = [...new Set(invariants.map((t) => t.severity).filter((s) => !KNOWN_SEVERITIES.includes(s)))].sort();
  return [...KNOWN_SEVERITIES, ...unknown]
    .map((s): [string, TrippedInvariantDetail[]] => [s, invariants.filter((t) => t.severity === s)])
    .filter(([, group]) => group.length > 0);
}

function Citation({ text }: { text?: string }) {
  if (!text) return null;
  return <span className="verdict__citation">{text}</span>;
}

function rationaleLine(kind: 'Tier' | 'Track', value: string, rationale: RuleRationale) {
  if (rationale.rule_id === 'TIER-LOW-DEFAULT') {
    return (
      <p>
        {kind} {value} — no tier trigger matched (default).
      </p>
    );
  }
  // Rule names often begin with the same "Track II — " prefix this line
  // already renders — strip it rather than reading "Track II — Track II — …".
  const prefix = `${kind} ${value} — `.toLowerCase();
  const ruleName = rationale.rule_name?.toLowerCase().startsWith(prefix)
    ? rationale.rule_name.slice(prefix.length)
    : rationale.rule_name;
  return (
    <p>
      {kind} {value} —{' '}
      {rationale.matched_field ? (
        <>
          triggered by <code>{rationale.matched_field}</code>{' '}
        </>
      ) : ruleName ? (
        <>{ruleName} </>
      ) : null}
      (<code>{rationale.rule_id}</code>)
      <Citation text={rationale.regulatory_basis} />
    </p>
  );
}

function WhyThisVerdict({
  verdict,
  explanation,
  policy,
}: {
  verdict: Verdict;
  explanation: VerdictExplanation;
  policy?: PolicyFile;
}) {
  const isHardLineRejection = verdict.status === 'rejected' && explanation.binding_reason !== null;

  return (
    <div className="verdict__why">
      {/* User-reported: the panel listed rule IDs and never said what kind of
          rule they were or where they came from. The product's whole claim is
          that a verdict traces to a rule — which is worth nothing if the
          reader cannot tell the three kinds apart. Plain language, per the
          house rule; no jargon that is not immediately unpacked. */}
      <p className="verdict__why-primer">
        Every line below is a rule this use case was measured against. There are three kinds, and they behave
        differently:{' '}
        <strong>hard lines</strong> are checked first and are absolute — no control set can bring a use case back
        inside appetite once one is crossed. <strong>Invariants</strong> are your firm's risk appetite rules; each
        one names the controls that satisfy it, which is why a use case can come back inside appetite once those
        controls are in place.{' '}
        <strong>Jurisdiction-pack rules</strong> come from regulation rather than from your firm, and are set out
        separately in the regulatory reasoning chain below.
      </p>

      {isHardLineRejection && (
        <p className="verdict__why-reason">
          {explanation.binding_reason}
          <Citation text={explanation.binding_regulatory_basis ?? undefined} />
        </p>
      )}

      {explanation.tier_rationale ? (
        rationaleLine('Tier', verdict.tier, explanation.tier_rationale)
      ) : (
        <p>Tier and track shown are ceiling values — a hard-line rejection skips tier/track assignment.</p>
      )}
      {explanation.track_rationale && rationaleLine('Track', verdict.track, explanation.track_rationale)}

      {explanation.tripped_invariants.length > 0 && (
        <>
          <p className="verdict__tripped-label">
            The inherent position — the risk before any controls. These are rules from your firm's risk appetite
            that this use case does not yet satisfy. Each names the controls that would close it.
          </p>
          {/* User report (2026-08-17): a flat list of 9 same-weight rules read
              as jargon soup, even though each individual line is plain
              English — no way to tell "critical" from "medium" at a glance,
              no count to orient against. Grouping by severity + a one-line
              summary is presentation only: same data, same words, same
              engine output — just organised the way a reader actually scans
              a list of problems (worst first). */}
          <p className="verdict__tripped-summary">
            {severityGroups(explanation.tripped_invariants)
              .map(([severity, group]) => `${group.length} ${severity}`)
              .join(' · ')}
          </p>
          {severityGroups(explanation.tripped_invariants).map(([severity, group]) => {
            return (
              <div key={severity} className={`verdict__tripped-group verdict__tripped-group--${severity.toLowerCase()}`}>
                <h4 className="verdict__tripped-group-heading">
                  <span className={`verdict__severity verdict__severity--${severity.toLowerCase()}`}>{severity}</span>
                </h4>
                <ul className="verdict__tripped">
                  {group.map((t) => (
                    <li key={t.id}>
                      <code>{t.id}</code> — {t.description}
                      <Citation text={t.regulatory_basis} />
                      {t.required_controls.length > 0 && (
                        <span className="verdict__tripped-controls">
                          {' '}
                          Closed by:{' '}
                          {t.required_controls.map((cid, i) => {
                            const name = findControlName(policy, cid);
                            return (
                              <span key={cid}>
                                {i > 0 && '; '}
                                {name ?? cid}
                                {name && <code className="verdict__id-quiet">{cid}</code>}
                              </span>
                            );
                          })}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      )}

      <p className="verdict__checked">
        {isHardLineRejection ? (
          <>
            Evaluated against {explanation.hard_lines_checked} hard lines — <code>{verdict.binding_constraint}</code>{' '}
            tripped; evaluation stopped there.
          </>
        ) : (
          <>
            Evaluated against {explanation.hard_lines_checked} hard lines and {explanation.invariants_checked}{' '}
            firm rules (invariants) —{' '}
            {explanation.tripped_invariants.length === 0
              ? 'none triggered.'
              : `${explanation.tripped_invariants.length} triggered.`}
          </>
        )}
      </p>
    </div>
  );
}

// code-review-005 F25: the WhatToDo chip renders the short internal status
// word ("attested") plus the reader-facing qualifier — kept as a separate
// display label so the internal `status` string (compared elsewhere, e.g.
// `status === 'attested'`, and used to derive the CSS modifier class) never
// has to change shape just because the label grows a word. Lower-case, like
// every other chip on this list ("in place", "outstanding") — the CS-1
// evidence panel's ALL-CAPS "ATTESTED — NOT VERIFIED" is a different chip
// family (verdict__vchip) with its own convention; the two are not meant to
// match.
// R16-D1: WhatToDo's own four display-string statuses, unchanged, now
// derived from the view-model's abstract SafeguardStatus (one computation —
// verdict-view-model.ts's `safeguardStatus` — four readers).
const SAFEGUARD_STATUS_DISPLAY: Record<SafeguardStatus, string> = {
  verified: 'in place',
  attested: 'attested',
  outstanding: 'outstanding',
  unknown: 'evidence unknown',
};

const TODO_CHIP_LABEL: Record<string, string> = {
  'in place': 'in place',
  attested: 'attested — not verified',
  outstanding: 'outstanding',
  'evidence unknown': 'evidence unknown',
};

// R16-D1 (build/prompts/R16.md v2.1 §4.1): `describesSameObligation`'s
// text-heuristic match (deleted here) is replaced by the firm-authored,
// referential `covers_reviews` field — a control names the review ids its
// own action satisfies, checked at policy-load time like any other
// condition (grounding/PACK-AUTHORING.md's reviewer checklist), rather than
// guessed from significant-word overlap at render time. The matching now
// lives once, in verdict-view-model.ts, and both this component's "also
// covers" note and the "separate reviews" filter below read its result
// (`view.safeguards[].coveredReviews`, `view.coveredReviewFormalNames`).

/** The plain-language answer to "so what do I actually have to do?".
 *
 *  Deliberately NOT a new computation — every item here is read from the
 *  verdict the engine already produced. A second derivation of what is
 *  required would be a second source of truth about an appetite decision,
 *  which is the defect ADR-EE-R3-1 exists to prevent. */
function WhatToDo({
  verdict,
  policy,
  view,
  needsSignOff,
  expandedControls,
  setExpandedControls,
  controlOwnership,
  onAssignControlOwner,
  controlOwnerBusyId,
  controlOwnerErrorId,
  controlOwnerError,
  controlAttestations,
  onAttestControlEvidence,
  controlEvidenceBusyIds,
  controlEvidenceErrors,
}: {
  verdict: Verdict;
  policy?: PolicyFile;
  // R16-D1: the one computation of each safeguard's status and which
  // reviews it covers — see verdict-view-model.ts. This component keeps its
  // own rendered text (it moved into the reviewer section unchanged); only
  // the status/coverage SOURCE changed.
  view: VerdictView;
  // design-review-003 (Panel C): "needs sign-off" used to be independently
  // re-derived from registerStage in three places across two files — a
  // future workflow change (e.g. a routing stage between pre_checked and
  // approved) risked the sites disagreeing. Computed once by the caller now.
  needsSignOff: boolean;
  // R16-D1: lifted from a local useState to the main component so the first
  // screen's "Go to this safeguard" link can expand a specific control's
  // disclosure from outside this component (D-26, D-63) — the per-control
  // disclosure stays React-controlled either way.
  expandedControls: Set<string>;
  setExpandedControls: Dispatch<SetStateAction<Set<string>>>;
  controlOwnership?: Record<string, { owner_name: string; target_date: string }>;
  onAssignControlOwner?: (controlId: string, ownerName: string, targetDate: string) => void;
  controlOwnerBusyId?: string | null;
  controlOwnerErrorId?: string | null;
  controlOwnerError?: string | null;
  controlAttestations?: Record<string, { attested_by_name: string; evidence_note: string }>;
  onAttestControlEvidence?: (controlId: string, attestedByName: string, evidenceNote: string) => Promise<boolean>;
  controlEvidenceBusyIds?: ReadonlySet<string>;
  controlEvidenceErrors?: ReadonlyMap<string, string>;
}) {
  const rejected = verdict.status === 'rejected';
  // CR9-02 (P6): missing / unknown sign-off — the one shared wording, never "Nothing." or a start signal.
  const signOffConfirm = view.signOffMissing ? SIGNOFF_MISSING_CONFIRM : view.signOffUnknown ? SIGNOFF_UNKNOWN_CONFIRM : null;
  const controls = verdict.controls ?? [];
  const allReviews = verdict.downstream_reviews ?? [];
  // R16-D1: was describesSameObligation's significant-word text heuristic —
  // now the real, firm-authored covers_reviews mechanism, matched once in
  // the view-model (`coveredReviewFormalNames`) and read here. `allReviews`
  // (the untouched engine output) still drives the per-control note below;
  // `reviews` (this filtered list) drives everything a reader counts.
  const reviews = allReviews.filter((r) => !view.coveredReviewFormalNames.includes(r));
  // R15-C2 (proposal §3.1): "summary-then-detail; default collapsed per
  // item, Expand all". Status chip stays on the always-visible summary line
  // (Governance's clarification of Layout F8 — items move to "addressed",
  // they never vanish); the three-line body opens per item via a native
  // <details>, so open/closed state is programmatic (G3) without any extra
  // wiring. "Expand all" just opens every item's <details> at once.
  const allControlsExpanded = controls.length > 0 && controls.every((id) => expandedControls.has(id));
  const toggleExpandAll = () => setExpandedControls(allControlsExpanded ? new Set() : new Set(controls));

  return (
    <div className="verdict__todo" id="verdict-todo-section">
      <h3>What you need to do</h3>

      {rejected ? (
        <>
          <p className="verdict__todo-lead">
            This use case is outside appetite as described, and no set of controls changes that — it crosses a
            hard line (an absolute rule your firm cannot control its way around). There is nothing to implement.
          </p>
          <p className="verdict__todo-lead">
            Your options are to change the use case so it no longer crosses that line, or to take it to the
            accountable committee as a deliberate exception. The rule it crossed, and the regulation behind it,
            are set out below.
          </p>
        </>
      ) : controls.length === 0 && reviews.length === 0 ? (
        <p className="verdict__todo-lead">
          {signOffConfirm ? `Nothing to put in place — ${signOffConfirm}` : 'Nothing.'} This use case sits inside
          appetite as described, with no controls required and no further reviews triggered.
          {needsSignOff && ' It still needs a second-line sign-off before it is final.'}
        </p>
      ) : (
        <>
          {/* User report (2026-08-18): "Resolvable citations · CTRL-CITE-01 ·
              outstanding" tells a reader a code and a status but not what the
              control IS, why THIS case needs it, or what done looks like — the
              same honest-everywhere-legible-nowhere disease R9 cured on the
              review screen. The policy file already carries a plain
              description and a how-to-verify line for every control, and the
              verdict already knows which rule demanded it. Show all three,
              grouped so eleven items become three short lists. Nothing new is
              computed — every line is read from data already on screen. */}
          <p className="verdict__todo-lead">
            {controls.length > 0 && reviews.length > 0
              ? `Put ${controls.length} control${controls.length === 1 ? '' : 's'} in place, and ${reviews.length} separate review${reviews.length === 1 ? '' : 's'} that other teams own still appl${reviews.length === 1 ? 'ies' : 'y'}.`
              : controls.length > 0
                ? `Put ${controls.length} control${controls.length === 1 ? '' : 's'} in place.`
                : `${reviews.length} separate review${reviews.length === 1 ? '' : 's'} that other teams own still appl${reviews.length === 1 ? 'ies' : 'y'}.`}
            {needsSignOff && ' Then a second-line reviewer signs off.'}
            {signOffConfirm && ` Also, ${signOffConfirm}`}{' '}
            Each item below says what it is, why this case needs it, and what "in place" looks like.
          </p>

          {controls.length > 0 && (
            <>
              <div className="verdict__todo-group-head">
                <h4 className="verdict__todo-group">Controls to put in place</h4>
                <button type="button" className="verdict__todo-expand-all" onClick={toggleExpandAll}>
                  {allControlsExpanded ? 'Collapse all' : 'Expand all'}
                </button>
              </div>
              <ol className="verdict__todo-list">
                {controls.map((id) => {
                  const control = policy?.controls.find((c) => c.id === id);
                  const attestation = controlAttestations?.[id];
                  // R16-D1: one computation (verdict-view-model.ts's
                  // `safeguardStatus`) — four readers. Precedence (verified
                  // beats attested beats outstanding/unknown) is unchanged;
                  // only the source of truth moved.
                  const safeguard = view.safeguards.find((s) => s.id === id);
                  const status = SAFEGUARD_STATUS_DISPLAY[safeguard?.status ?? 'unknown'];
                  // Which of this verdict's tripped rules demanded this control
                  // — read from the explanation the engine already produced.
                  const demandedBy = (verdict.explanation?.tripped_invariants ?? []).filter((t) =>
                    t.required_controls.includes(id),
                  );
                  // R16-D1: reviews this control's covers_reviews names,
                  // read from the view-model's referential match (replacing
                  // describesSameObligation's text heuristic) — formal
                  // names, since this list is the reviewer section's own
                  // (unchanged) vocabulary.
                  const matchingReviews = safeguard?.coveredReviews.map((r) => r.formalName) ?? [];
                  return (
                    <li key={id} id={`verdict-todo-control-${id}`} className="verdict__todo-item" tabIndex={-1}>
                      <details
                        open={expandedControls.has(id) || undefined}
                        onToggle={(e) => {
                          const open = e.currentTarget.open;
                          setExpandedControls((prev) => {
                            const next = new Set(prev);
                            if (open) next.add(id);
                            else next.delete(id);
                            return next;
                          });
                        }}
                      >
                        <summary className="verdict__todo-head">
                          <strong>{control?.name ?? id}</strong>
                          {control?.name && <code className="verdict__id-quiet">{id}</code>}
                          <span className={`verdict__todo-chip verdict__todo-chip--${status.split(' ')[0]}`}>
                            {TODO_CHIP_LABEL[status] ?? status}
                          </span>
                        </summary>
                      {control?.description && (
                        <p className="verdict__todo-line">
                          <span className="verdict__todo-label">What it is:</span> {control.description}
                        </p>
                      )}
                      {demandedBy.length > 0 && (
                        <p className="verdict__todo-line">
                          <span className="verdict__todo-label">Why this case needs it:</span>{' '}
                          {demandedBy.map((t) => t.description).join('; ')}
                        </p>
                      )}
                      {control?.verification && (
                        <p className="verdict__todo-line">
                          <span className="verdict__todo-label">What &ldquo;in place&rdquo; looks like:</span>{' '}
                          {control.verification}
                        </p>
                      )}
                      {/* code-review-005 (usability testing): this control's own
                          obligation is the same real-world review a jurisdiction
                          pack separately names — shown once, here, rather than
                          twice under two different labels. */}
                      {matchingReviews.length > 0 && (
                        <p className="verdict__todo-line verdict__todo-also-satisfies">
                          <span className="verdict__todo-label">Also covers:</span>{' '}
                          {matchingReviews.join(', ')} — the same check under another name, so it is not listed
                          again below.
                        </p>
                      )}
                      {status === 'outstanding' && onAssignControlOwner && (
                        <ControlOwnerAssign
                          controlId={id}
                          assignment={controlOwnership?.[id]}
                          onAssign={onAssignControlOwner}
                          busy={controlOwnerBusyId === id}
                          error={controlOwnerErrorId === id ? controlOwnerError : null}
                        />
                      )}
                      {/* RG-9: the attest form shows while a control is still
                          outstanding (the action that moves it to "attested");
                          the attester + evidence show once it's attested — and
                          that display does not depend on a policy being loaded
                          (F12: a recorded attestation is not the policy's to
                          hide). Not shown once the policy marks it machine-"in
                          place" — a human attestation adds nothing over a
                          machine check. */}
                      {(status === 'outstanding' || status === 'attested') && onAttestControlEvidence && (
                        <ControlEvidenceAttest
                          controlId={id}
                          attestation={attestation}
                          onAttest={onAttestControlEvidence}
                          busy={controlEvidenceBusyIds?.has(id) ?? false}
                          error={controlEvidenceErrors?.get(id) ?? null}
                        />
                      )}
                      </details>
                    </li>
                  );
                })}
              </ol>
            </>
          )}

          {reviews.length > 0 && (
            <>
              <h4 className="verdict__todo-group">Separate reviews other teams own</h4>
              <p className="verdict__todo-group-sub">
                The verdict triggers these; it does not replace them.
              </p>
              <ul className="verdict__todo-list verdict__todo-list--reviews">
                {reviews.map((r) => (
                  <li key={r}>
                    <strong>{reviewWords(r, verdict, policy)}</strong>
                    <span className="verdict__todo-chip verdict__todo-chip--review">separate review</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {(needsSignOff || signOffConfirm) && (
            <>
              <h4 className="verdict__todo-group">Then</h4>
              <ul className="verdict__todo-list verdict__todo-list--reviews">
                <li>
                  <strong>Second-line sign-off</strong>
                  <span className="verdict__todo-status">
                    {' '}
                    {needsSignOff
                      ? '— this use case is above the self-service threshold, so it is not final until a second-line reviewer (2LoD) approves it'
                      : `— ${signOffConfirm}`}
                  </span>
                </li>
              </ul>
            </>
          )}
          <p className="verdict__todo-foot">
            <strong>Outstanding</strong> means the policy file carries no attestation that this control exists —{' '}
            <em>not</em> that someone checked and found it missing. In this version those statuses are attested by
            hand; machine-checked evidence is a later release.
          </p>
        </>
      )}
    </div>
  );
}

// design-vision.md L-6: assignment tracking, not automation — a name, a
// target date, an age, an overdue flag. No reminders or notifications; the
// app has no backend to run them from. Re-assigning overwrites the shown
// state (the caller keeps the LATEST control_ownership_assigned event).
function ControlOwnerAssign({
  controlId,
  assignment,
  onAssign,
  busy,
  error,
}: {
  controlId: string;
  assignment?: { owner_name: string; target_date: string };
  onAssign: (controlId: string, ownerName: string, targetDate: string) => void;
  busy: boolean;
  error?: string | null;
}) {
  const [ownerName, setOwnerName] = useState(assignment?.owner_name ?? '');
  const [targetDate, setTargetDate] = useState(assignment?.target_date ?? '');
  const [editing, setEditing] = useState(false);

  if (assignment && !editing) {
    // code-review-004 F8: this used Date.parse('yyyy-mm-dd') — which the
    // spec anchors to UTC MIDNIGHT — against Date.now(), a local instant.
    // West of UTC, a target the user picked as "today" was already hours
    // past UTC midnight and rendered overdue the moment it was saved; east
    // of UTC the count went the other way. A false "overdue" on a
    // compliance control is precisely the claim this product must not
    // make. Fixed by comparing CALENDAR DAYS in the viewer's own timezone:
    // the target parsed as a local date, against local today.
    const [ty, tm, td] = assignment.target_date.split('-').map(Number);
    const now = new Date();
    const days =
      ty && tm && td
        ? Math.round(
            (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
              new Date(ty, tm - 1, td).getTime()) /
              (24 * 60 * 60 * 1000),
          )
        : NaN;
    const overdue = days > 0;
    return (
      <p className="verdict__todo-line verdict__todo-owner">
        <span className="verdict__todo-label">Owner:</span> {assignment.owner_name} (name not verified) · target{' '}
        {assignment.target_date}
        {overdue ? (
          <span className="verdict__todo-owner-overdue"> · overdue {days} day{days === 1 ? '' : 's'}</span>
        ) : days === 0 ? (
          <span> · due today</span>
        ) : (
          Number.isFinite(days) && <span> · {-days} day{-days === 1 ? '' : 's'} to go</span>
        )}
        <button
          type="button"
          className="verdict__todo-owner-edit"
          onClick={() => setEditing(true)}
        >
          Reassign
        </button>
      </p>
    );
  }

  return (
    <form
      className="verdict__todo-owner-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ownerName.trim() || !targetDate) return;
        onAssign(controlId, ownerName.trim(), targetDate);
        setEditing(false);
      }}
    >
      <label>
        Owner
        <input
          type="text"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          placeholder="Name (not verified)"
          disabled={busy}
        />
      </label>
      <label>
        Target date
        <input
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          disabled={busy}
        />
      </label>
      <button type="submit" disabled={busy || !ownerName.trim() || !targetDate}>
        {busy ? 'Assigning…' : 'Assign'}
      </button>
      {error && <span className="verdict__todo-owner-error">{error}</span>}
    </form>
  );
}

// RG-9: a reviewer's on-the-record attestation that a control is in place,
// with a free-text evidence pointer. Mirrors ControlOwnerAssign's shape (a
// display+re-attest branch and a form branch). The honesty is load-bearing:
// this is a self-asserted human claim, rendered "attested (not verified)",
// NEVER shown as machine-verified — a client-side store can hold the claim
// and its evidence pointer, not the evidence itself, and must not pretend to.
//
// code-review-005 F19: onAttest resolves true/false rather than firing and
// forgetting — attesting control B while control A's write is still in
// flight must not look like a silent no-op, and a failed write must not
// look like a saved one. The form closes only once the write is CONFIRMED;
// on failure it stays open (with `error`, from the caller, rendered inline)
// so the reviewer can see the failure and retry without re-typing.
function ControlEvidenceAttest({
  controlId,
  attestation,
  onAttest,
  busy,
  error,
}: {
  controlId: string;
  attestation?: { attested_by_name: string; evidence_note: string };
  onAttest: (controlId: string, attestedByName: string, evidenceNote: string) => Promise<boolean>;
  busy: boolean;
  error?: string | null;
}) {
  const [name, setName] = useState(attestation?.attested_by_name ?? '');
  const [note, setNote] = useState(attestation?.evidence_note ?? '');
  const [editing, setEditing] = useState(false);

  if (attestation && !editing) {
    return (
      <p className="verdict__todo-line verdict__todo-attested">
        <span className="verdict__todo-label">Attested in place:</span> {attestation.attested_by_name} (name not
        verified) — evidence: &ldquo;{attestation.evidence_note}&rdquo;
        <button type="button" className="verdict__todo-owner-edit" onClick={() => setEditing(true)}>
          Re-attest
        </button>
      </p>
    );
  }

  return (
    <form
      className="verdict__todo-owner-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !note.trim()) return;
        const attestedByName = name.trim();
        const evidenceNote = note.trim();
        // Not awaited inline in the handler itself (onSubmit must stay
        // synchronous for preventDefault to matter) — the async work is the
        // IIFE below. Close only on confirmed success; on failure, stay open
        // so the typed values and the caller's `error` prop both remain
        // visible rather than the form silently resetting as if it saved.
        void (async () => {
          const ok = await onAttest(controlId, attestedByName, evidenceNote);
          if (ok) setEditing(false);
        })();
      }}
    >
      <label>
        Attested by
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Reviewer (not verified)"
          disabled={busy}
        />
      </label>
      <label>
        Evidence
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. TLS config export, ticket ref"
          disabled={busy}
        />
      </label>
      <button type="submit" disabled={busy || !name.trim() || !note.trim()}>
        {busy ? 'Recording…' : 'Attest in place'}
      </button>
      {error && <span className="verdict__todo-owner-error">{error}</span>}
    </form>
  );
}

function findReasoningTrace(verdict: Verdict, auditEvents: AuditEvent[]): string | null {
  // Most recent verdict_produced/verdict_corrected event for this verdict.
  const match = [...auditEvents].reverse().find((e) => {
    if (e.payload.type === 'verdict_produced' && e.payload.verdict.id === verdict.id) return true;
    if (e.payload.type === 'verdict_corrected' && e.payload.new_verdict.id === verdict.id) return true;
    return false;
  });
  if (!match) return null;
  if (match.payload.type === 'verdict_produced' || match.payload.type === 'verdict_corrected') {
    return match.payload.reasoning_trace ?? null;
  }
  return null;
}


// V2-E: replaces the CONFIDENCE: HIGH/MEDIUM/LOW chip. That grade was
// subjective — nobody could say what MEDIUM obliged a reader to do. This
// says what the rule does to its own quoted text, which the reader can
// check against the quote shown directly below it.
const BASIS_LABELS: Record<string, string> = {
  verbatim: 'STATES THE QUOTED TEXT',
  derived: 'INFERRED FROM THE TEXT',
  judgement: 'LEGAL JUDGEMENT',
};

// R12-BD-2: `derived` now carries the same salience as `judgement` — both
// name, in plain terms, that the regulator has not confirmed this reading.
const BASIS_HELP: Record<string, string> = {
  verbatim: 'This rule restates the quoted passage. Nothing was read into it.',
  derived: 'This rule is an inference from the quoted passage, not something it says outright. The regulator has not confirmed this reading — check the inference holds for your case.',
  judgement: 'This rule rests on a reading of the law that the quoted passage does not settle. The regulator has not confirmed this reading — a qualified person has to stand behind it.',
};

// R3-JU-6: the labelled cause, addressed to a later reader of the record. The
// two reasons are different claims and must not collapse into one badge
// (evaluation-engine.md §13.1) — "no regulatory basis" says none exists;
// "unsigned rules" says one exists that the firm has not adopted. Neither
// string contains the words "approved" or "rejected" (HR3-08).
const PROVISIONAL_REASON_LABEL: Record<ProvisionalReason, string> = {
  unsigned_pack_rules:
    'Rules from a jurisdiction pack were applied, but they are proposed readings of the law that your firm has not yet adopted.',
  // Terse on purpose. This is the labelled cause for the record; the full
  // explanation of the consequence is the body panel below (R3-JU-3), and
  // review pass 1 rightly flagged that near-identical wording in both places
  // reads as the same sentence printed twice.
  // "no regulatory rules were used" was the same overclaim as the body panel's
  // earlier drafts, just terser — the firm's own rules cite SS1/23, MAR, the
  // EU AI Act and more, and those citations render on this very screen. Seen
  // by reading the rendered page against its own citation list, not by a test.
  no_regulatory_basis: 'Cause: no jurisdiction pack applied, so no country rulebook was used.',
  // Names the consequence, not just the fact. A reader needs to know that the
  // tier they are looking at was set WITHOUT any decision-type rule, because
  // that is what determines whether they should trust it.
  unclassified_decision_type:
    'Cause: the decision type entered is not one your policy has a rule for, so no decision-type rule could be applied. The tier and track above rest on the other answers alone. This is a gap in the risk appetite policy — one for whoever owns it, not a legal question.',
};

// R12-MISC-1 (ADR-VA-R12-3): SHA-256 over the active policy YAML content,
// computed via WebCrypto — this is presentation-layer I/O (a hash of what's
// on screen), not engine business logic, so it belongs at the component
// layer, not inside the pure memo builder.
async function hashPolicyYaml(yaml: string): Promise<string> {
  const bytes = new TextEncoder().encode(yaml);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// R12-BD-3 / ADR-VA-R12-2: the family mapping is presentation-only — the
// engine's provisional_reasons enum is unchanged. Sign-off gaps are
// closeable paperwork; substantive caveats are real open questions.
const SIGNOFF_GAP_REASONS: ReadonlySet<ProvisionalReason> = new Set(['unsigned_pack_rules']);

export function classifyProvisionalReason(reason: ProvisionalReason): 'signoff_gap' | 'substantive' {
  return SIGNOFF_GAP_REASONS.has(reason) ? 'signoff_gap' : 'substantive';
}

/** R15-C2 (proposal §3.1, S2): "Before you sign off" — every line reads
 *  state already computed elsewhere on this page (no second derivation,
 *  ADR-EE-R3-1's discipline); every line is a jump link, not a checkbox.
 *  design-review round 3: since the in-page section nav was deleted, this
 *  checklist is now the SOLE place enforcing S2's anti-rubber-stamp rule —
 *  no line here may jump directly to the sign-off action. Keep it that way
 *  if this component is edited again; there is no other enforcement point. */
function SignOffChecklist({
  verdict,
  policy,
  view,
  hasRiskKnowledgeSection,
}: {
  verdict: Verdict;
  policy?: PolicyFile;
  // R16-D1: one computation of each safeguard's status (verdict-view-
  // model.ts) — this reader just counts it.
  view: VerdictView;
  hasRiskKnowledgeSection?: boolean;
}) {
  const reasons = verdict.provisional_reasons ?? [];
  const controls = verdict.controls ?? [];
  // design-review-003 (Panels A/B/D/G): this checklist is the screen's
  // designated fast first read, but its own first line used to lead with
  // a bare rule ID before any plain-language version reached the reader —
  // the exact pattern findRuleDescription already exists to fix, used two
  // hundred lines away in WhyThisVerdict (find-rule-description.ts).
  const bindingDescription = verdict.binding_constraint
    ? findRuleDescription(policy, verdict.binding_constraint)
    : undefined;
  // RG-9: three evidence tiers, counted separately so the checklist stays
  // honest — a reviewer's attestation is NOT folded into machine-verified.
  // Both counts are well-defined even with no policy loaded, same as before
  // (the view-model's `safeguardStatus` preserves that precedence) — only
  // the DISPLAY below hides the verified/outstanding split when there is no
  // policy to have read it from.
  const verified = view.inPlaceSafeguards.length;
  const attested = view.attestedSafeguards.length;
  // "Addressed" = verified OR attested; only these leave the outstanding
  // pile. This is what lets the list reach zero-outstanding once a reviewer
  // has attested each control — the RG-9 goal — without claiming any of them
  // are machine-verified.
  const outstanding = view.outstandingCount;
  const addressed = verified + attested;

  return (
    <div className="verdict__signoff-checklist">
      <h3>Before you sign off — check these first</h3>
      <ul className="verdict__signoff-checklist-list">
        {verdict.binding_constraint && (
          <li>
            <a href="#verdict-why-section">
              Decided by {bindingDescription ?? verdict.binding_path ?? 'the rule below'}
              {' '}<code className="verdict__id-quiet">{verdict.binding_constraint}</code>
            </a>
          </li>
        )}
        {controls.length > 0 && (
          <li>
            <a href="#verdict-controls-section">
              {/* code-review-005 F12: without a policy we cannot tell verified
                  from outstanding — printing those counts anyway is a
                  confident claim about evidence nobody checked, the same
                  overclaim BC-V13-03 already rules out for the per-control
                  chip (WhatToDo's `!policy` branch). An attestation is the
                  one thing still knowable regardless — it does not come from
                  the policy — so it is named here even in this branch. */}
              {!policy ? (
                <>
                  {controls.length} control{controls.length === 1 ? '' : 's'} named · evidence unknown — the
                  policy isn&rsquo;t loaded
                  {attested > 0 &&
                    `; ${attested} already attested by a reviewer (not verified)`}
                </>
              ) : (
                <>
                  {controls.length} control{controls.length === 1 ? '' : 's'} named · {outstanding} outstanding ·{' '}
                  {addressed} addressed · evidence: {verified} marked verified in your firm&rsquo;s policy file, {attested} attested by a
                  reviewer (not verified), {outstanding} outstanding
                </>
              )}
            </a>
          </li>
        )}
        {reasons.includes('no_regulatory_basis') && (
          <li>
            <a href="#verdict-jurisdiction-section">
              No country rulebook applied — firm rules only. If a jurisdiction does apply, say so on
              the intake form and evaluate again.
            </a>
          </li>
        )}
        {reasons.includes('unsigned_pack_rules') && (
          <li>
            <a href="#verdict-provisional-banner">
              Rulebook translation: unattested — the jurisdiction pack rules used here are proposed
              readings your firm has not yet adopted.
            </a>
          </li>
        )}
        {hasRiskKnowledgeSection && (
          <li>
            <a href="#risk-knowledge-section">
              Risk-knowledge coverage — informs the review; it does not decide the verdict.
            </a>
          </li>
        )}
      </ul>
      <p className="verdict__signoff-checklist-foot">Then sign off at the bottom.</p>
    </div>
  );
}

interface InheritanceSourceEntry {
  // CR6-11: 'combined' = both a platform and a supplier were declared but the
  // case's graph is not available (the register path), so the two cannot be
  // split back apart — one entry, from the verdict's own merged inheritance.
  source: 'platform' | 'supplier' | 'combined';
  declaredId: string;
  resolved: boolean;
  inheritedControls: string[];
  dimensions: EnvelopeDimensionFit[];
  note?: string;
  /** CR6-11b: the declared ids the verdict itself says are not on the
   *  registry (only set for the combined entry, where one badge cannot say
   *  which of the two). */
  unresolvedIds?: string[];
}

const INHERITANCE_SOURCE_LABEL: Record<InheritanceSourceEntry['source'], string> = {
  platform: 'Platform',
  supplier: 'Supplier',
  combined: 'Platform and supplier',
};

/** PV-6 / D-61 (R16-D1, flagged in the A2 handover and in appetite.yaml's own
 *  PLAT-CLOUD-LLM comment): `resolveInheritance()` (engine/evaluate.ts)
 *  merges a declared platform's and a declared vendor's envelope fits into
 *  one flat `dimensions` list with no source tag. That was harmless while a
 *  use case only ever declared one of the two; the platform→vendor_id link
 *  (chunk A2's policy data; the graph-side mapping is chunk B's form work)
 *  means a single processing node can now declare BOTH at once, and the two
 *  can constrain the SAME dimension — unlabelled, a reader could not tell
 *  the two "data_zones" rows apart, or which one belonged to which approval.
 *
 *  The common case (only one of the two declared — every verdict reachable
 *  before chunk B lands) needs no recomputation at all: the verdict's own
 *  merged fields already ARE that one source's, so they are reused as-is,
 *  just labelled. Only when BOTH are declared does this call the engine's
 *  own exported, pure `fitsEnvelope`/`inheritableControls` again, split by
 *  source — the SAME computation the engine already ran once merged, not a
 *  second one that could disagree with it. */
function inheritanceEntries(
  inheritance: NonNullable<Verdict['inheritance']>,
  policy: PolicyFile | undefined,
  graph: DataFlowGraph | undefined,
): InheritanceSourceEntry[] {
  const hasPlatform = inheritance.declared_platform !== undefined;
  const hasVendor = inheritance.declared_vendor !== undefined;
  if (!hasPlatform && !hasVendor) return [];

  if (hasPlatform !== hasVendor) {
    const source: InheritanceSourceEntry['source'] = hasPlatform ? 'platform' : 'supplier';
    const declaredId = (hasPlatform ? inheritance.declared_platform : inheritance.declared_vendor)!;
    return [
      {
        source,
        declaredId,
        resolved: inheritance.resolved,
        inheritedControls: inheritance.inherited_controls,
        dimensions: inheritance.dimensions,
      },
    ];
  }

  // Both declared at once — split the merged result back out by source.
  // CR6-11: without the graph that split cannot be recomputed. Returning no
  // entries left the summary saying "N controls inherited" over an empty
  // list; instead show ONE entry from the verdict's own (merged) inheritance
  // and say plainly that this record does not keep the two apart.
  if (!graph) {
    return [
      {
        source: 'combined',
        declaredId: `${inheritance.declared_platform} + ${inheritance.declared_vendor}`,
        resolved: inheritance.resolved,
        inheritedControls: inheritance.inherited_controls,
        dimensions: inheritance.dimensions,
        unresolvedIds: inheritance.unresolved_components,
        note: 'A platform and a supplier were both declared. This record does not keep the two apart, so what they cover is shown together.',
      },
    ];
  }
  const entries: InheritanceSourceEntry[] = [];
  const platform = policy?.platforms?.find((p) => p.id === inheritance.declared_platform);
  const platformDims = platform ? fitsEnvelope(graph, platform.approved_envelope) : [];
  entries.push({
    source: 'platform',
    declaredId: inheritance.declared_platform!,
    resolved: !inheritance.unresolved_components.includes(inheritance.declared_platform!),
    inheritedControls: platform ? inheritableControls(platform.satisfies_controls, platformDims, platform.coupled_clusters) : [],
    dimensions: platformDims,
  });
  const vendor = policy?.vendors?.find((v) => v.id === inheritance.declared_vendor);
  const vendorDims = vendor ? fitsEnvelope(graph, vendor.approved_envelope) : [];
  entries.push({
    source: 'supplier',
    declaredId: inheritance.declared_vendor!,
    resolved: !inheritance.unresolved_components.includes(inheritance.declared_vendor!),
    inheritedControls: vendor ? inheritableControls(vendor.satisfies_controls, vendorDims, vendor.coupled_clusters) : [],
    dimensions: vendorDims,
  });
  return entries;
}

/** R16-D1 (VD-9/VD-10, §4.2): the verdict's first screen — the only thing a
 *  first-time, non-technical reader needs: can I start and what has to
 *  happen first; why, in one or two reasons; my own next steps; the
 *  safeguards that must be in place (yours first); checks other teams run;
 *  who signs off; and, where the verdict is provisional, what could still
 *  change it. Renders entirely from `view` (verdict-view-model.ts) — no
 *  business logic here (Rule 4, cross-cutting.md §7).
 *
 *  A rejected verdict renders only its headline and the correct-your-
 *  answers affordance here: the "No" screen's own composition (VD-10, the
 *  hard line's reason, what would change it, who to talk to) is chunk D2's
 *  slice (build/prompts/R16.md §4.3) — this never fabricates that copy in
 *  its place, and the full hard-line reasoning is still one click away in
 *  the reviewer section below. */
function FirstScreen({
  view,
  onGoToSafeguard,
  onCorrect,
  showSubmitterAffordances,
}: {
  view: VerdictView;
  onGoToSafeguard: (controlId: string) => void;
  onCorrect?: () => void;
  showSubmitterAffordances: boolean;
}) {
  const hasSafeguards = view.outstandingSafeguards.length > 0 || view.inPlaceSafeguards.length > 0 || view.attestedSafeguards.length > 0;

  return (
    <div className="verdict__first-screen">
      <h2 className="verdict__first-headline">{view.headline}</h2>

      {/* R16-D2 §2 (VD-10). The "No" screen's own slice — why, by the kind
          of rule that said no; the "Not sure" answers that contributed;
          what would change the answer; who to talk to. No safeguards list,
          no next steps, no "who signs off" on a "No" (none of those render
          below either, since view-model leaves them empty for a rejected
          verdict). */}
      {view.isRejected && view.no && (
        <div className="verdict__no-screen">
          <p className="verdict__first-why">
            <strong>Why:</strong> {view.no.reason}
          </p>
          {view.no.contributingAssumptions.length > 0 && (
            <p className="verdict__no-contributing">
              This is based on answers you weren’t sure about:{' '}
              {joinWithAnd(view.no.contributingAssumptions.map((a) => a.shortLabel))}. If any of them is
              wrong, change it and check again.
              {view.no.otherAssumptionCount > 0 &&
                ' (You weren’t sure about other answers too — they’re listed in the full reasoning below.)'}
            </p>
          )}
          {view.no.change && (
            <p className="verdict__no-change">
              <strong>What would change the answer:</strong> {view.no.change}
            </p>
          )}
        </div>
      )}

      {view.whyReasons.length > 0 && (
        <p className="verdict__first-why">
          <strong>Why:</strong> {view.whyReasons.join('; and ')}
          {view.whyHasMore && ' (Each safeguard below gives its own reason.)'}
        </p>
      )}

      {view.nextSteps.length > 0 && (
        <div className="verdict__first-next-steps">
          <h3>Your next steps</h3>
          <ol>
            {view.nextSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {hasSafeguards && (
        <div className="verdict__first-safeguards">
          {/* G-8: a count of "(0)" above nothing is noise — the heading only
              when something is outstanding; the lines below keep their own words. */}
          {view.outstandingCount > 0 && (
            <h3>Safeguards that must be in place before you start ({view.outstandingCount})</h3>
          )}
          {view.outstandingSafeguards.length > 0 && (
            <ul className="verdict__first-safeguard-list">
              {view.outstandingSafeguards.map((s: SafeguardView) => (
                <li key={s.id} className="verdict__first-safeguard">
                  <p className="verdict__first-safeguard-action">{s.plainAction}</p>
                  {s.ownerText && (
                    <p className="verdict__first-safeguard-owner">
                      Who: {s.ownerText}
                      {/* W-8 (R16-W §5, D-78): a literal space text node before
                          the chip — "…with compliance" immediately followed by
                          a "yours" <span> with no space between them
                          concatenates to "complianceyours" for anything that
                          reads the element's text content (assistive tech
                          included). JSX drops an all-whitespace line between
                          two expression children entirely rather than
                          collapsing it to one space, so an explicit {' '} is
                          required here, not just source formatting. */}
                      {s.yours && (
                        <>
                          {' '}
                          <span className="verdict__first-yours-chip">yours</span>
                        </>
                      )}
                    </p>
                  )}
                  {s.plainReasons.length > 0 && (
                    <p className="verdict__first-safeguard-reason">Because {s.plainReasons.join('; ')}</p>
                  )}
                  {/* W-6 (R16-W §5, D-76): one note per safeguard, not one
                      per covered review — a safeguard covering two reviews
                      used to print two notes, and the old per-review
                      template broke on clause-shaped names ("This also
                      covers the supplier is assessed"). alsoCompletesNote
                      is the view-model's one computed sentence. */}
                  {s.alsoCompletesNote && (
                    <p className="verdict__first-also-covers">{s.alsoCompletesNote}</p>
                  )}
                  {s.yours && (
                    <button type="button" className="verdict__first-go-to" onClick={() => onGoToSafeguard(s.id)}>
                      Go to this safeguard
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {view.inPlaceSafeguards.length > 0 && (
            <p className="verdict__first-in-place">
              Already in place: {view.inPlaceSafeguards.map((s) => s.plainAction).join(', ')} (your firm&rsquo;s
              records show this
              {/* R16-D2 §7 (DR7-34). Extends the existing note — never a
                  second one — naming the platform/supplier this case uses
                  that a scoped safeguard's evidence actually matched. */}
              {view.inPlaceScopeName ? ` for ${view.inPlaceScopeName}` : ''})
            </p>
          )}
          {view.attestedSafeguards.map((s) => (
            <p key={s.id} className="verdict__first-attested">
              Reported in place by {s.attestedByName} (name not verified): {s.plainAction}
            </p>
          ))}
        </div>
      )}

      {view.owedReviews.length > 0 && (
        <div className="verdict__first-owed-reviews">
          <h3>Checks other teams run</h3>
          <ul>
            {view.owedReviews.map((r) => (
              <li key={r.plainName}>
                {r.plainName} — {r.ownerText}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!view.isRejected && (
        <p className="verdict__first-who-signs-off">
          <strong>Who signs off:</strong> {view.whoSignsOff}
        </p>
      )}

      {view.couldStillChange.length > 0 && (
        <div className="verdict__first-could-change">
          <h3>Could still change</h3>
          {view.couldStillChange.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}

      {showSubmitterAffordances && onCorrect && (
        <button type="button" className="verdict__first-correct" onClick={onCorrect}>
          {/* R16-D2 §2 item 5 (DR7-21): on a "No" this control REPLACES its
              usual wording — there is nothing else to "think" about, the
              rule already said no; "misunderstood how you'd use it" names
              the one thing that could change that. */}
          {view.isRejected
            ? 'If we’ve misunderstood how you’d use it, correct your answers and check again.'
            : 'Think we got something wrong? Correct your answers and check again.'}
        </button>
      )}

      {/* R16-D2 §2 item 6. Every "No", regardless of kind. */}
      {view.isRejected && (
        <p className="verdict__no-who-to-talk-to">
          <strong>Who to talk to:</strong> your AI risk team — the independent team that checks how the
          firm uses AI — if you think this is wrong or want to discuss another way to do this.
        </p>
      )}
    </div>
  );
}

export default function VerdictDisplay({ verdict, auditEvents, policy, graph, registerStage, noModelNamed, onCorrect, memoLabel, memoDescription, knowledgeLensMatches, showSignOffChecklist, hasRiskKnowledgeSection, assumptions, packs, evidenceScope, reasoningDefaultOpen = false, controlOwnership, onAssignControlOwner, controlOwnerBusyId, controlOwnerErrorId, controlOwnerError, controlAttestations, onAttestControlEvidence, controlEvidenceBusyIds, controlEvidenceErrors }: VerdictDisplayProps) {
  // design-review-003 (Panel C): computed once here instead of separately
  // inside WhatToDo and at the appetite-line below — see WhatToDo's prop
  // comment for why the duplication was a risk worth closing.
  // R16-D1 (§4.1): the one view-model behind the first screen below AND the
  // three existing readers (WhatToDo, SignOffChecklist, the evidence panel)
  // that need a safeguard's status — built once, per render, from the same
  // props every one of them already received.
  const view: VerdictView = buildVerdictView(verdict, policy, graph, controlOwnership, controlAttestations, registerStage, {
    assumptions,
    packs,
    evidenceScope,
    auditEvents,
  });
  // CR7-09: ONE derivation, in the view model — the stage no longer decides it.
  const needsSignOff = view.needsSignOff;

  // R16-D1: the reviewer section's own open/closed state, controlled (not
  // the Fold component's uncontrolled defaultOpen) so "Go to this safeguard"
  // (§4.2 item 4, D-26/D-63) can force it open from outside. Initialised
  // from reasoningDefaultOpen, same as every inner Fold.
  const [reviewerOpen, setReviewerOpen] = useState(reasoningDefaultOpen);
  // Lifted from WhatToDo's own local state (R15-C2) so the same click can
  // also expand one specific control's disclosure — the per-control
  // disclosure stays React-controlled either way (D-26/D-63: an anchor
  // alone would be closed again on the next render).
  const [expandedControls, setExpandedControls] = useState<Set<string>>(new Set());
  // One render-cycle "please scroll to this once the DOM reflects the state
  // above" signal — scrollIntoView has to run AFTER the reviewer section and
  // the target control's <details> have actually opened, not in the same
  // tick as the state updates that open them.
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!scrollTarget) return;
    const el = document.getElementById(`verdict-todo-control-${scrollTarget}`);
    // jsdom (this project's test environment) does not implement
    // scrollIntoView at all — optional-chaining the method itself, not just
    // the element, keeps this a safe no-op in tests and a real scroll in a
    // browser.
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    // §3 (DR7-10): scrolling alone never moved focus, so a keyboard or
    // screen-reader user following "Go to this safeguard" landed nowhere —
    // the scroll was a purely visual cue. The target (`tabIndex={-1}` on
    // its own container, below) is focusable without being in the normal
    // tab order.
    el?.focus?.({ preventScroll: true });
    setScrollTarget(null);
  }, [scrollTarget, reviewerOpen, expandedControls]);
  const handleGoToSafeguard = (controlId: string) => {
    setReviewerOpen(true);
    setExpandedControls((prev) => new Set(prev).add(controlId));
    setScrollTarget(controlId);
  };

  // code-review-005, R3-3 (round 3): downloadMemo is wired to its button as
  // `onClick={() => void downloadMemo()}` — a void-ed promise. A throw
  // anywhere in here (buildChallengeMemo on a verdict missing `explanation`
  // was the reproducing case; a WebCrypto/Blob failure would hit the same
  // path) used to reject that promise with nothing downloaded and nothing
  // shown. memoError makes that visible instead of silent.
  const [memoError, setMemoError] = useState<string | null>(null);
  // R10-CM (ADR-VA-R10-1): the memo is generated from what is already on
  // this screen and downloaded client-side. Nothing is written anywhere.
  // R12-MISC-1: async so the policy hash (WebCrypto) can be computed before
  // the memo is built and stamped into its header.
  const downloadMemo = async () => {
    try {
      const policyHash = await hashPolicyYaml(getCurrentPolicyYaml());
      const memo = buildChallengeMemo({
        label: memoLabel ?? 'AI use case',
        useCaseId: verdict.use_case_id,
        description: memoDescription,
        verdict,
        events: auditEvents,
        knowledgeLensMatches,
        policyHash,
      });
      const url = URL.createObjectURL(new Blob([memo], { type: 'text/markdown' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `challenge-memo-${verdict.use_case_id.slice(0, 8)}.md`;
      a.click();
      URL.revokeObjectURL(url);
      setMemoError(null);
    } catch (err) {
      setMemoError(err instanceof Error ? err.message : String(err));
    }
  };
  // §13.1a: the caveats remain the per-rule DETAIL rendered underneath the
  // banner — which rule is unadopted. They are no longer what determines
  // Provisional; that is `provisional_reasons`, read below. Filtering them
  // here is presentation, not a second derivation of the status.
  const lowCaveats = verdict.confidence_caveats.filter((c) => c.confidence === 'low');

  // Presentation-only (rule 4): reads the sign-off strings the engine already
  // produced. "[FIRM] — Technology Risk · pending firm adoption" → the role is
  // the segment between the em-dash and the dot separator. Distinct + sorted
  // so the list is stable (NF-1 discipline applies to rendering too).
  const pendingReviewers = [
    ...new Set(
      (verdict.explanation?.regulatory_chain ?? [])
        .filter((e) => e.sign_off.includes('pending firm adoption'))
        .map((e) => {
          const m = e.sign_off.match(/—\s*([^·]+)/);
          return m?.[1] ? m[1].trim() : null;
        })
        .filter((r): r is string => Boolean(r)),
    ),
  ].sort();
  const mediumCaveats = verdict.confidence_caveats.filter((c) => c.confidence === 'medium');
  // ADR-EE-R3-1: the engine determines Provisional and names its causes. This
  // was `lowCaveats.length > 0` — one of two independent derivations of the
  // same rule, the other in store/register.ts. Both are now reads.
  const isProvisional = isVerdictProvisional(verdict);

  // register-lifecycle.md §15.1b excludes BOTH the correction affordance and
  // the reasoning-trace disclosure from the reviewer's page: they belong to
  // the submitter's flow (verdict-audit.md §6.1). They are gated together and
  // named as one concept, because `onCorrect &&` in front of a trace
  // disclosure reads as though the trace were a correction concern, which it
  // is not. Review of P8-C06 raised this; the honest fix is the name, not a
  // second prop with no consumer — see FN-004 for when to split them.
  const showSubmitterAffordances = onCorrect !== undefined;

  const reasoningTrace = findReasoningTrace(verdict, auditEvents);
  const fallbackDescription = findRuleDescription(policy, verdict.binding_constraint);
  // BC-V11C01-04: verdicts persisted before V1.1-C01 lack `explanation` —
  // the type says required, but old audit-trail data may resurface.
  const explanation: VerdictExplanation | undefined = verdict.explanation ?? undefined;

  // CR8-17: only packs this verdict used (see usedStaleSources).
  const staleSources = usedStaleSources(verdict);

  // code-review-005 F8: computed once, here, so the CS-1 evidence panel's
  // Fold summary, its collapse condition, and its per-control chip all agree
  // — the exact self-contradiction the finding closes was a control shown
  // UNVERIFIED in this panel while an "attested" chip and the checklist's own
  // count, elsewhere on the SAME screen, said otherwise. R16-D1: `verified`/
  // `attested` now read the view-model's one safeguard-status computation
  // (same precedence as before: machine-verified beats attested beats
  // outstanding); `control`/`evidence` are still read directly from policy
  // for this panel's own detail fields (description, design/operating axes),
  // which are not part of the view-model's safeguard shape. Only meaningful
  // with a policy loaded (the no-policy branch below is its own, separate
  // BC-V13-03 "evidence unknown" case, untouched by this fix).
  const controlEvidenceStates = policy
    ? verdict.controls.map((id) => {
        const control = policy.controls.find((c) => c.id === id);
        const evidence = control?.verification_evidence;
        const safeguard = view.safeguards.find((s) => s.id === id);
        const verified = safeguard?.status === 'verified';
        const attested = safeguard?.status === 'attested';
        const attestation = attested ? controlAttestations?.[id] : undefined;
        // W-7 (D-77): the one case this panel adds — scoped evidence that
        // does not cover THIS tool. Only ever set by the view-model when
        // it is the reason `verified` came back false.
        return { id, control, evidence, verified, attested, attestation, evidenceScopeNote: safeguard?.evidenceScopeNote };
      })
    : [];

  return (
    <section className={`verdict verdict--${verdict.status}`} aria-label="Verdict">
      {/* R16-D1 (VD-9/VD-10, §4.2): the first screen — headline, why, next
          steps, safeguards, checks other teams run, who signs off, could
          still change, correct-your-answers. Everything else on this page
          (the formal status/tier/track, every rule checked, the evidence,
          the regulatory sources, and the reviewer's own actions) is
          unchanged and additive, inside the reviewer section below it. */}
      <FirstScreen view={view} onGoToSafeguard={handleGoToSafeguard} onCorrect={onCorrect} showSubmitterAffordances={showSubmitterAffordances} />

      <details
        id="verdict-reviewer-section"
        className="verdict__reviewer-section"
        open={reviewerOpen || undefined}
        onToggle={(e) => setReviewerOpen(e.currentTarget.open)}
      >
        <summary className="verdict__reviewer-summary">
          The full reasoning — every rule checked, the evidence, the sources, and the reviewer&rsquo;s actions
        </summary>
        <div className="verdict__reviewer-body">
      {/* CR7-11 (UC-11 fit criterion, D-27). Derived from the graph's
          processing nodes (declared_model_id); with no graph (the register
          path does not keep it) nothing is claimed either way. */}
      {(graph ? graph.processing_nodes.length > 0 && !graph.processing_nodes.some((n) => n.declared_model_id) : noModelNamed === true) && (
        <p className="verdict__no-model-named">No AI model is recorded for this use case — your AI risk team may ask which one it uses.</p>
      )}
      {/* R12-ST-1: an undismissable statement of fact, in the same honesty
          idiom as the PROVISIONAL banner but its own block — staleness never
          blocks a verdict, it just says the regulatory text behind it is
          overdue a fresh look. */}
      {staleSources.length > 0 && (
        <div className="verdict__stale-banner" role="alert">
          <strong>Review overdue</strong>
          {staleSources.map((s) => {
            const daysRetrieved = s.days_overdue + s.max_staleness_days;
            return (
              <p key={s.pack_id} data-stale-pack={s.pack_id}>
                Review overdue — this verdict cites regulatory text from <code>{s.pack_id}</code> last
                retrieved {daysRetrieved} days ago (window {s.max_staleness_days} days) — {s.days_overdue}{' '}
                day{s.days_overdue === 1 ? '' : 's'} past due.
              </p>
            );
          })}
        </div>
      )}

      {isProvisional && (
        <div className="verdict__provisional-banner" role="alert" id="verdict-provisional-banner">
          {/* User report (2026-08-15): "why do we always say legal review
              required — is it always legal?" It is not. Packs are signed by
              Legal/Compliance, Model Risk and Technology Risk depending on
              the regulation, and an unlisted decision type is an appetite
              question, not a legal one. The heading stopped presuming; where
              the chain's sign-off lines say WHO is pending, they are named. */}
          <strong>Provisional — review required before this is final</strong>
          {pendingReviewers.length > 0 && (
            <p className="verdict__provisional-owners">
              Waiting on: {pendingReviewers.join(', ')} — each named against its rule in the reasoning chain
              below.
            </p>
          )}
          {/* R3-JU-6 / review pass 2. The banner previously rendered only the
              low-confidence caveats, which exist ONLY for the unsigned-rules
              cause. A verdict provisional for the no-regulatory-basis cause
              therefore showed "legal review required" and nothing else — an
              unexplained demand, on the screen someone acts on. The engine had
              computed the cause and no one rendered it: the same
              computed-but-never-consumed defect that lost the regulatory
              citations for all of V1.

              P8-C05 owns the fuller prose statement for the submitter
              (R3-JU-3). This is the labelled cause, and it is here because
              this chunk is what made the empty banner reachable at scale. */}
          {/* R12-BD-3 / ADR-VA-R12-2: causes split into two families so a
              reader can tell "paperwork we can close" from "a real open
              question" at a glance, rather than reading a flat list and
              guessing which is which. */}
          {(['signoff_gap', 'substantive'] as const).map((family) => {
            const reasons = (verdict.provisional_reasons ?? []).filter(
              (r) => classifyProvisionalReason(r) === family,
            );
            if (reasons.length === 0) return null;
            return (
              <div key={family} className={`verdict__provisional-family verdict__provisional-family--${family}`}>
                <p className="verdict__provisional-family-heading">
                  {family === 'signoff_gap'
                    ? 'Sign-off gaps — paperwork that would close these'
                    : 'Substantive caveats — real open questions'}
                </p>
                {reasons.map((reason) => (
                  <p key={reason} data-provisional-reason={reason}>
                    {PROVISIONAL_REASON_LABEL[reason]}
                    {/* Name the decision type, don't just say one was unrecognised.
                        The engine computed `unclassified_decision_types` and the
                        first cut of this banner never rendered it — the
                        computed-but-never-consumed defect CLAUDE.md warns about,
                        walked into again. A cause with no subject cannot be acted
                        on: the firm needs to know WHICH decision type it has no
                        position on, because that is the hole in its framework. */}
                    {reason === 'unclassified_decision_type' &&
                      (verdict.unclassified_decision_types ?? []).length > 0 && (
                        <>
                          {' '}
                          Entered:{' '}
                          {(verdict.unclassified_decision_types ?? []).map((d, i) => (
                            <span key={d}>
                              {i > 0 && ', '}
                              <q>{d}</q>
                            </span>
                          ))}
                          .
                        </>
                      )}
                  </p>
                ))}
              </div>
            );
          })}
          {lowCaveats.map((c, i) => (
            <p key={i}>{c.reason}</p>
          ))}
        </div>
      )}

      <p className="verdict__eyebrow" id="verdict-section">Verdict</p>
      {/* §13.3: Provisional is a qualifier carried ALONGSIDE the status, not a
          fourth status. The heading used to be replaced by the word
          "Provisional", which hid the underlying determination — a reader
          could not tell whether the provisional verdict was in or out of
          appetite. The banner above already states the qualifier and its
          cause; the heading states what was decided. */}
      <h2 className="verdict__heading">
        {STATUS_LABEL[verdict.status]}
        {isProvisional && <span className="verdict__heading-qualifier"> · Provisional</span>}
      </h2>
      <p className="verdict__meta">
        <code>{verdict.use_case_id.slice(0, 8)}</code> · evaluated{' '}
        {new Date(verdict.attested_at).toLocaleDateString()}
      </p>
      {/* User report (2026-08-18): "it's not clear what the verdict is —
          too much happening." One plain sentence, first, that a newcomer can
          repeat back: the decision, what it hinges on, what happens next. */}
      <p className="verdict__appetite-line">
        {verdict.status === 'rejected'
          ? 'Outside appetite — it crosses a hard line (an absolute rule your firm cannot control its way around), so no set of controls can bring it inside. It cannot proceed as described.'
          : verdict.controls.length === 0
            ? 'Inside appetite as described — nothing to put in place.'
            : `Inside appetite once ${verdict.controls.length} control${verdict.controls.length === 1 ? ' is' : 's are'} in place${
                verdict.downstream_reviews.length > 0
                  ? `, with ${verdict.downstream_reviews.length} separate review${verdict.downstream_reviews.length === 1 ? '' : 's'} other teams own`
                  : ''
              }.`}
        {verdict.status !== 'rejected' &&
          needsSignOff &&
          ' Not final until a second-line reviewer (2LoD) signs off.'}
        {verdict.status !== 'rejected' && view.signedOff && ' Signed off by your AI risk team.'}
        {verdict.status !== 'rejected' &&
          (view.signOffMissing || view.signOffUnknown) &&
          ' Whether it is final is not confirmed yet — see your next steps.'}
      </p>

      {/* design-review round 3 (2026-08-31, Panels A+D — beat 1, "the
          decision"): tier/track and the binding constraint stay here,
          immediately under the appetite line — the review found deleting
          the binding-constraint block was based on a false premise (the
          appetite line never states which rule decided the case) and would
          have hidden a fact NF-11/VD-2 require stay visible. Only the
          binding constraint's gloss changes: it now resolves through the
          same findRuleDescription lookup every other rule-id render on this
          page uses, closing a pre-existing NF-11 gap the review also found. */}
      <div className="verdict__cards">
        <div className="verdict__stat">
          <span className="verdict__stat-label">Tier</span>
          <span className={`verdict__stat-value verdict__stat-value--${verdict.tier.toLowerCase()}`}>
            {verdict.tier}
          </span>
        </div>
        <div className="verdict__stat">
          <span className="verdict__stat-label">Track</span>
          <span className="verdict__stat-value">{verdict.track}</span>
        </div>
      </div>

      {verdict.binding_constraint && (
        <div className="verdict__binding">
          <p>
            Decided by {fallbackDescription ?? verdict.binding_path ?? 'the rule below'}{' '}
            <code className="verdict__id-quiet">{verdict.binding_constraint}</code>
          </p>
          {/* binding_path renders separately only when the line above used a
              real resolved description — when no description is available,
              binding_path is already the fallback text shown inline, and
              repeating it here would duplicate the exact same string. */}
          {verdict.binding_path && fallbackDescription && (
            <p className="verdict__binding-path">{verdict.binding_path}</p>
          )}
        </div>
      )}

      {mediumCaveats.length > 0 && (
        <div className="verdict__medium-caveat" role="alert">
          {mediumCaveats.map((c, i) => (
            <p key={i}>
              <code>{c.ruleId}</code> — {c.reason}
            </p>
          ))}
        </div>
      )}

      {/* design-review round 3 (beat 2, "what happens next"): WhatToDo
          unchanged — Panel G confirmed this beat already answers the
          reader's second question cleanly, right after the decision. */}
      <WhatToDo
        verdict={verdict}
        policy={policy}
        view={view}
        needsSignOff={needsSignOff}
        expandedControls={expandedControls}
        setExpandedControls={setExpandedControls}
        controlOwnership={controlOwnership}
        onAssignControlOwner={onAssignControlOwner}
        controlOwnerBusyId={controlOwnerBusyId}
        controlOwnerErrorId={controlOwnerErrorId}
        controlOwnerError={controlOwnerError}
        controlAttestations={controlAttestations}
        onAttestControlEvidence={onAttestControlEvidence}
        controlEvidenceBusyIds={controlEvidenceBusyIds}
        controlEvidenceErrors={controlEvidenceErrors}
      />

      {/* design-review round 3 (Panel A): no requirement pins the checklist
          to page-load-first; moving it here (after the reader knows the
          decision and the next step) lets it double as the entry point into
          the basis below, instead of acting as a second table of contents
          competing with the deleted nav. Same render condition as before —
          RegisterDetail still owns the gate. */}
      {showSignOffChecklist && (
        <SignOffChecklist
          verdict={verdict}
          policy={policy}
          view={view}
          hasRiskKnowledgeSection={hasRiskKnowledgeSection}
        />
      )}

      {/* design-review round 3 (beat 3, "the basis" — Panels A/C/D/G
          converged this is the one beat that's a genuinely clean fit: Why,
          fragility, and the regulatory reasoning chain already shared the
          Fold pattern before this round; fragility moves in from the old
          "what could change this" bucket because Panel C found it's a
          statement about the STRENGTH of the reasoning, not a forward-
          looking risk — a plain <section>, not a wrapping Fold, so each
          panel's own id/Fold/heading survives untouched (Panel D: Fold's
          `when=false` path drops the id prop, so reusing Fold here would
          have silently broken every jump link into this section). */}
      <section className="verdict__basis" aria-label="Why, and on what evidence">
      {explanation && (
        <Fold
          id="verdict-why-section"
          title="Why this verdict"
          defaultOpen={reasoningDefaultOpen}
          // design-review-003: a hard-line rejection's reasoning is the
          // single most important thing on the page for that verdict — the
          // same honesty-floor exception UNVERIFIED controls already get.
          when={!(verdict.status === 'rejected' && explanation.binding_reason !== null)}
          summary={
            verdict.status === 'rejected' && explanation.binding_reason !== null
              ? `${explanation.hard_lines_checked} hard lines checked — ${verdict.binding_constraint} tripped`
              : `${explanation.hard_lines_checked} hard lines · ${explanation.invariants_checked} firm rules — ${explanation.tripped_invariants.length} triggered`
          }
        >
          <WhyThisVerdict verdict={verdict} explanation={explanation} policy={policy} />
        </Fold>
      )}

      {explanation && explanation.tripped_invariants.length > 0 && (
        <Fold
          title="How fragile is this approval?"
          defaultOpen={reasoningDefaultOpen}
          summary={`${verdict.single_covered_invariants.length} rule${verdict.single_covered_invariants.length === 1 ? '' : 's'} held by a single control · margin of safety ${Math.round(verdict.margin_achieved * 100)}% (policy target: at least ${Math.round(verdict.margin_target * 100)}%)`}
        ><div className="verdict__chain">
          
          <p className="verdict__chain-sub">
            Some of the rules below are satisfied by exactly one control. If that control fails or is
            removed, the use case falls outside appetite immediately — there is no second control
            holding it. Those are the ones to watch.
          </p>
          <p className="verdict__chain-derived">
            Margin of safety:&ensp;
            {Math.round(verdict.margin_achieved * 100)}% of the triggered rules have more than one control
            available; the policy file&rsquo;s target is {Math.round(verdict.margin_target * 100)}%
            {verdict.boundary_proximity && ' — below target'}
          </p>
          {/* explore-007 D-004 fix (round 8): "your firm wants" implied a
              deliberate, firm-specific calibration decision — this number is
              read straight from the policy file's safety_margin field,
              which is 10% in the shipped starter config until a real firm
              sets its own. Worded as what it actually is (a policy target)
              regardless of whether it's been calibrated, rather than trying
              to detect "is this still the demo default" with a heuristic. */}
          <p className="verdict__chain-basis-help">
            Set in the policy file, not computed by the engine — a firm using the starter config as
            shipped has not yet chosen this number for itself.
          </p>
          {verdict.single_covered_invariants.length > 0 && (
            <>
              <p className="verdict__chain-derived">
                Resting on a single control&ensp;({verdict.single_covered_invariants.length})
              </p>
              {/* Was a bare comma-separated list of ids — "INV-CITE-01,
                  INV-CONDUCT-01, INV-SEC-01, INV-SYNTHMARK-01" — which the
                  reader had to scroll up and cross-reference one at a time.
                  The descriptions were already in the policy. */}
              <ul className="verdict__fragile">
                {verdict.single_covered_invariants.map((id) => {
                  const desc = findRuleDescription(policy, id);
                  return (
                    <li key={id}>
                      {desc ?? id}
                      {desc && <code className="verdict__id-quiet">{id}</code>}
                    </li>
                  );
                })}
              </ul>
              <p className="verdict__chain-basis-help">
                {verdict.margin_achieved === 0
                  ? 'No rule here has an alternative control in the library, so no control set can create headroom. That is a limit of the rulebook, not of this use case.'
                  : 'Each of these is held by one control and nothing else.'}
              </p>
            </>
          )}
        </div></Fold>
      )}

      {/* R3-JU-3 / verdict-audit.md §13.1. The chain panel below renders only
          when there is a chain, so a verdict with no active pack used to show
          nothing here at all — and "no regulation applies", "we did not check"
          and "the panel failed to render" are indistinguishable when all three
          look like nothing (Leveson). The explanation must be PRESENT, not the
          panel merely absent.

          Gated on the engine's own determination rather than on the chain
          being empty, because those are different facts: a verdict persisted
          before V1.1-C01 has no `explanation` at all, and describing that
          record as having no regulatory basis would be a claim about history
          nobody checked. */}
      {(verdict.provisional_reasons ?? []).includes('no_regulatory_basis') && (
        <div className="verdict__chain" data-no-regulatory-basis id="verdict-jurisdiction-section">
          <h3>No jurisdiction rulebook was applied</h3>
          <p className="verdict__chain-sub">
            No jurisdiction pack applied to this use case, so no country rulebook was used and
            there is no regulatory reasoning chain — no quoted source text, and none of the
            citations a pack would supply. Your firm&rsquo;s own policy still applied in full,
            including the regulatory citations it carries itself, shown above where they bear on
            this case.
          </p>
          <p className="verdict__chain-basis-help">
            If this use case does touch a country your firm has a rulebook for, say so on the
            intake form and evaluate it again.
          </p>
        </div>
      )}

      {explanation?.regulatory_chain && explanation.regulatory_chain.length > 0 && (
        <Fold
          id="verdict-jurisdiction-section"
          title="Regulatory reasoning — the rules from law"
          defaultOpen={reasoningDefaultOpen}
          summary={`${explanation.regulatory_chain!.length} rule${explanation.regulatory_chain!.length === 1 ? '' : 's'} from regulation fired${(verdict.provisional_reasons ?? []).includes('unsigned_pack_rules') ? ' — pending firm sign-off' : ''}; each quotes its source text`}
        ><div className="verdict__chain">
          
          <p className="verdict__chain-sub">Every pack rule that fired, traceable to source text.</p>
          {explanation.regulatory_chain.map((entry) => (
            <div key={entry.rule_id} className="verdict__chain-entry">
              <div className="verdict__chain-head">
                <code>{entry.rule_id}</code>
                <span className="verdict__chain-doc">
                  {entry.document} · {entry.section}
                </span>
                <span className={`verdict__conf verdict__conf--${entry.basis}`}>
                  {BASIS_LABELS[entry.basis]}
                </span>
              </div>
              <blockquote className="verdict__chain-quote">“{entry.source_text}”</blockquote>
              <p className="verdict__chain-derived">Derived:&ensp;{entry.derived}</p>
              <p className="verdict__chain-signoff">SIGN-OFF&ensp;{entry.sign_off}</p>
              <p className="verdict__chain-basis-help">{BASIS_HELP[entry.basis]}</p>
            </div>
          ))}
        </div></Fold>
      )}

      {verdict.controls.length > 0 &&
        (policy ? (
          // V1.3 (design-vision decision #3): proof-carrying controls —
          // MINIMAL CONTROL SET (CS-1) panel with per-control verification
          // status. BC-V13-02: absent evidence renders UNVERIFIED, never a
          // blank or implied pass. code-review-005 F8: a third state — a
          // reviewer's attestation on record, but no machine-verified
          // evidence — so this panel never again shows UNVERIFIED next to a
          // control the checklist and the to-do list both already call
          // "attested" elsewhere on the same screen.
          <Fold
            id="verdict-controls-section"
            title="The control set, with evidence status"
            defaultOpen={reasoningDefaultOpen}
            summary={
              controlEvidenceStates.every((s) => s.verified)
                ? `${verdict.controls.length} control${verdict.controls.length === 1 ? '' : 's'} — all VERIFIED`
                : `${verdict.controls.length} control${verdict.controls.length === 1 ? '' : 's'} — all addressed (verified or attested)`
            }
            when={controlEvidenceStates.every((s) => s.verified || s.attested)}
            headingInSummary={false}
          ><div className="verdict__controlset">
            <h3>The control set, with evidence status</h3>
            <p className="verdict__controlset-sub">
              The residual position — where the risk lands once these controls are in place. Smallest set that
              holds the appetite margin. V1: statuses are attested in the policy file; machine-checked evidence
              binding is V1.5.
            </p>
            {/* §15.1a (C-2). The verdict above is a historical record — what was
                decided and attested. These statuses are CURRENT: whether the
                evidence exists today. The two are deliberately different
                sources, and a reader who cannot tell which is which could sign
                off believing an old VERIFIED still holds. Saying so is the
                whole point of the split. */}
            <p className="verdict__controlset-asof">
              Evidence status is read from today&rsquo;s policy, not from the evaluation. The verdict
              above is the record of what was decided on{' '}
              {new Date(verdict.attested_at).toLocaleDateString()}.
            </p>
            <ul>
              {controlEvidenceStates.map(({ id, control, evidence, verified, attested, attestation, evidenceScopeNote }) => {
                return (
                  <li key={id}>
                    <div className="verdict__control-head">
                      {/* Name first, id quiet — a reader scans for the thing,
                          not the code (user report 2026-08-18). */}
                      <span className="verdict__control-name">{control?.name ?? id}</span>
                      {control?.name && <code className="verdict__id-quiet">{id}</code>}
                      <span
                        className={
                          verified
                            ? 'verdict__vchip verdict__vchip--verified'
                            : attested
                              ? 'verdict__vchip verdict__vchip--attested'
                              : 'verdict__vchip verdict__vchip--unverified'
                        }
                      >
                        {verified ? 'VERIFIED' : attested ? 'ATTESTED — NOT VERIFIED' : 'UNVERIFIED'}
                      </span>
                    </div>
                    {control && control.resolves.length > 0 && (
                      <p className="verdict__control-patches">Patches: {control.resolves.join(', ')}</p>
                    )}
                    {/* R10-CE (ADR-VA-R10-3): where the policy attests the two
                        COSO axes, render both. Legacy single-status evidence
                        has no axes and renders exactly as before. */}
                    {(evidence?.design || evidence?.operating) && (
                      <p className="verdict__control-axes">
                        {(['design', 'operating'] as const).map((axis) => {
                          const a = evidence?.[axis];
                          if (!a) return null;
                          return (
                            <span key={axis} className={`verdict__axischip verdict__axischip--${a.status}`}>
                              {axis === 'design' ? 'built right (design)' : 'working right (operating)'}:{' '}
                              {a.status === 'not_assessed' ? 'not assessed' : a.status}
                            </span>
                          );
                        })}
                      </p>
                    )}
                    {verified && evidence?.detail && (
                      <p className="verdict__control-evidence">
                        {evidence.detail}
                        {evidence.attested_by ? ` — attested by ${evidence.attested_by}` : ''}
                        {evidence.attested_at ? ` (${evidence.attested_at})` : ''}
                      </p>
                    )}
                    {/* W-7 (R16-W §5, D-77): the policy's evidence IS marked
                        verified, but its applies_to scope doesn't cover (or
                        can't be checked against) this tool — say exactly
                        that, rather than either claiming it or going silent. */}
                    {!verified && evidenceScopeNote && (
                      <p className="verdict__control-evidence verdict__control-evidence--scope">{evidenceScopeNote}</p>
                    )}
                    {/* F8: the reviewer's on-the-record claim, shown beside the
                        chip — never merged with the machine-VERIFIED evidence
                        line above, and never rendered once verified is true
                        (machine-verified beats attested, same precedence as
                        WhatToDo). "(name not verified)" for the same reason
                        every other self-asserted name in this app carries it:
                        there is no sign-in to check it against. */}
                    {attested && attestation && (
                      <p className="verdict__control-evidence verdict__control-evidence--attested">
                        Attested by {attestation.attested_by_name} (name not verified) — evidence: &ldquo;
                        {attestation.evidence_note}&rdquo;
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div></Fold>
        ) : (
          // BC-V13-03: no policy, so no fabricated chips. §15.1a is explicit
          // that the status renders as UNKNOWN rather than UNVERIFIED —
          // absence of a policy is not evidence of absent evidence. Saying
          // nothing at all would be the same defect in the other direction:
          // a reader cannot distinguish "not checked" from "nothing to show".
          //
          // code-review-005 round 2, N5: a control with a RECORDED
          // attestation (controlAttestations, from the audit trail — not the
          // policy file) is not "unknown" just because no policy is loaded;
          // the attestation exists independently of today's policy, same as
          // it does in the with-policy branch above. Showing EVIDENCE UNKNOWN
          // here for a control the checklist and the to-do list, elsewhere on
          // this SAME screen, already call "attested" was the contradiction —
          // same precedence rule as controlEvidenceStates above (machine-
          // verified beats attested beats unknown), minus the "verified" tier
          // this branch has no policy to check against.
          <div className="verdict__controlset" id="verdict-controls-section">
            <h3>The control set, with evidence status</h3>
            <ul>
              {verdict.controls.map((id) => {
                // R16-D1: reads the view-model's one status computation,
                // same as the with-policy branch above — behaviourally
                // identical to reading controlAttestations directly here
                // (the view-model's no-policy rule is exactly "attested ?
                // 'attested' : 'unknown'"), but now the single source.
                const attested = view.safeguards.find((s) => s.id === id)?.status === 'attested';
                const attestation = attested ? controlAttestations?.[id] : undefined;
                return (
                  <li key={id}>
                    <div className="verdict__control-head">
                      <code>{id}</code>
                      {attestation ? (
                        <span className="verdict__vchip verdict__vchip--attested">ATTESTED — NOT VERIFIED</span>
                      ) : (
                        <span className="verdict__vchip verdict__vchip--unknown">EVIDENCE UNKNOWN</span>
                      )}
                    </div>
                    {attestation && (
                      <p className="verdict__control-evidence verdict__control-evidence--attested">
                        Attested by {attestation.attested_by_name} (name not verified) — evidence: &ldquo;
                        {attestation.evidence_note}&rdquo;
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="verdict__controlset-asof">
              No policy is loaded, so whether evidence exists for these controls could not be
              checked. That is not the same as having no evidence.
            </p>
          </div>
        ))}

      {/* CS-3. On an approved verdict these are obligations the submitter owes
          alongside the pre-check. On a REJECTED one they are not owed at all —
          the pre-check said don't do this — so they are labelled as the
          forward path: what this shape of use case would still require if it
          were re-scoped to come inside appetite. Same data, different claim,
          and presenting the second as the first would be an instruction nobody
          is under (user decision, 2026-08-05). */}
      {verdict.downstream_reviews.length > 0 &&
        (verdict.status === 'rejected' ? (
          <div className="verdict__downstream verdict__downstream--forward">
            <p className="verdict__downstream-label">If this use case is re-scoped</p>
            <p>
              Nothing here is required of you now — this verdict is out of appetite. Kept for
              whoever takes it forward: a use case of this shape would also need{' '}
              {verdict.downstream_reviews.map((r) => reviewWords(r, verdict, policy)).join(', ')}. Those are separate from the appetite
              question, so bringing this inside appetite would not remove them.
            </p>
          </div>
        ) : (
          <div className="verdict__downstream">
            <p>Downstream reviews: {verdict.downstream_reviews.map((r) => reviewWords(r, verdict, policy)).join(', ')}</p>
            {/* CS-3's fit criterion: "with the policy rule that triggered each
                one named". A required review with no traceable cause is an
                instruction with no author — a reviewer cannot check it, argue
                with it, or tell a firm rule from a regulatory one. The engine
                computed this from the start and every call site threw it away
                (code review round 3, Panel B). */}
            {(verdict.downstream_review_sources ?? []).length > 0 && (
              <ul className="verdict__downstream-sources">
                {(verdict.downstream_review_sources ?? []).map((s) => (
                  // C-5: two packs may share a rule id with different review
                  // text — both are kept by the engine, so the key needs both.
                  <li key={`${s.rule_id}|${s.review}`}>
                    {reviewWords(s.review, verdict, policy)} — required by{' '}
                    <code className={s.rule_id.startsWith('MODEL-REGISTRY:') ? 'verdict__id-quiet' : undefined}>{s.rule_id}</code>
                    {s.regulatory_basis ? <Citation text={s.regulatory_basis} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>

      {/* design-review round 3 (beat 4, "what could go wrong" — Panel G,
          re-confirmed by Panel C): the old "what could change this" bucket
          also held fragility, inheritance, and living-status, none of which
          are forward-looking the way expiry is — they moved out (fragility
          into beat 3 above, inheritance and living-status into beat 5
          below). What's left is the one thing that genuinely fits, and
          Panel G found folding it away by default hides exactly the fact a
          first-time, non-technical reader is most likely to want unprompted
          ("could this fall apart later?") — so unlike every other analytical
          panel on this page, this one is NOT a Fold. It always renders open,
          for every audience, no click required. */}
      {verdict.conditions.hypotheses.length > 0 && (
        <section className="verdict__conditions" aria-label="What could go wrong">
          <h3>What could go wrong — and when this expires</h3>
          <p className="verdict__conditions-sub">
            <strong>Nothing to do today.</strong> This verdict was reached on the assumption that the system
            stays inside the bounds below. If it drifts outside any of them — or the deployment moves to a
            different data zone, or is given more autonomy — <strong>the approval no longer holds and the use
            case has to come back through this gate.</strong>
          </p>
          <p className="verdict__conditions-sub">
            <strong>Who checks, and when:</strong> nobody automatically. In this version these are read at the
            next scheduled re-review — whoever owns the model is responsible for noticing sooner. Continuous
            monitoring against these thresholds is a later release, and until it exists this list is a
            statement of assumptions rather than an alarm.
          </p>
          {/* The last two entries restate the data zone and autonomy already
              shown in Record & provenance below. Reported as duplication, and
              it read that way because nothing said the two were making
              different claims: provenance records what was DECLARED, these
              record the bound the verdict DEPENDS ON. Same value, different
              force. Labelled rather than deleted — dropping them would remove
              the expiry condition, which is the part that matters. */}
          <ul>
            {verdict.conditions.hypotheses.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </section>
      )}

      {/* design-review round 3 (beat 5, "the record"): provenance,
          platform/vendor inheritance, living status, and the audit/export
          affordances — reference material for whoever needs to check the
          record later, not part of the reader's first pass. Inheritance
          moves in from the old beat 4 (it's provenance of an existing
          approval, not a forward-looking risk); living-status moves in for
          the same reason (a status readout, not a trigger). */}
      {graph && (
        <Fold title="What you told us" summary="The answers this verdict was computed from, as attested at submission"><div className="verdict__provenance">

          {/* Reported as duplicating the standing conditions. It does repeat
              the data zone and autonomy level — deliberately, because the two
              panels make different claims about the same value: this is what
              was DECLARED and attested to, that is the bound the verdict
              DEPENDS ON. Saying so is cheaper than removing either. */}
          <p className="verdict__conditions-sub">
            The answers this verdict was computed from, as attested at submission. The data zone and autonomy
            level also appear above as expiry conditions — same values, different purpose: here they are what
            you declared, there they are the bounds the approval depends on.
          </p>
          <div className="confirmation__grid">
            {graphSummaryRows(graph).map((row) => (
              <div key={row.label} className="confirmation__grid-cell">
                <span className="confirmation__grid-label">{row.label}</span>
                <span className="confirmation__grid-value">{row.value}</span>
              </div>
            ))}
          </div>
        </div></Fold>
      )}

      {/* R16-D2 §2 item 7. Every assumption the case has — contributing to
          a "No" or not — so a reviewer can see the full set a submitter
          was "Not sure" about, not only the ones the "No" screen singles
          out as having driven the outcome. Renders for any verdict with
          assumptions, not only a rejected one: the register and the
          intake screen agree on this case's own facts either way. */}
      {assumptions && assumptions.length > 0 && (
        <Fold
          title="Answers the submitter wasn’t sure about"
          summary={`${assumptions.length} answer${assumptions.length === 1 ? '' : 's'} marked "Not sure"`}
        >
          <ul className="verdict__assumptions">
            {assumptions.map((a) => (
              <li key={a.questionId}>
                <strong>{a.question}</strong> — we assumed {a.assumption.replace(/\.+$/, '')}.
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {verdict.inheritance && (
        <Fold
          title="Platform & supplier inheritance"
          summary={
            verdict.inheritance
              ? verdict.inheritance.resolved
                ? `On the covered registry — ${verdict.inheritance.inherited_controls.length} control${verdict.inheritance.inherited_controls.length === 1 ? '' : 's'} inherited`
                : `${verdict.inheritance.unresolved_components.length} declared component${verdict.inheritance.unresolved_components.length === 1 ? '' : 's'} not on the covered registry${verdict.inheritance.inherited_controls.length > 0 ? ` — ${verdict.inheritance.inherited_controls.length} control${verdict.inheritance.inherited_controls.length === 1 ? '' : 's'} still inherited from the listed one` : ' — nothing inherited'}`
              : ''
          }
        ><div className="verdict__chain">

          <p className="verdict__chain-sub">
            What an existing platform or supplier approval already covered, and the envelope that
            justified it. Controls are inherited only where this use case sits inside the covered
            envelope.
          </p>

          {/* R16-D1 (PV-6, D-61): one entry per declared component, each
              labelled by source ("Platform" / "Supplier") in its own header
              AND on each of its dimension rows — see inheritanceEntries'
              own comment for why this no longer flattens platform and
              vendor fits into one unlabelled list. */}
          {inheritanceEntries(verdict.inheritance, policy, graph).map((entry) => (
            <div className="verdict__chain-entry" key={entry.source}>
              <div className="verdict__chain-head">
                <span className="verdict__chain-source">{INHERITANCE_SOURCE_LABEL[entry.source]}</span>
                <code>{entry.declaredId.split(' + ').map((id) => supplierDisplayName(id, policy).name).join(' + ')}</code>
                <span className={`verdict__conf verdict__conf--${entry.resolved ? 'registered' : 'unregistered'}`}>
                  {entry.unresolvedIds && entry.unresolvedIds.length > 0
                    ? entry.unresolvedIds.length === entry.declaredId.split(' + ').length
                      ? 'Not on the registry'
                      : 'Partly on the registry'
                    : entry.resolved ? 'On the covered registry' : 'Not on the registry'}
                </span>
              </div>

              {entry.note && <p className="verdict__chain-derived">{entry.note}</p>}

              {entry.inheritedControls.length > 0 && (
                <p className="verdict__chain-derived">
                  {/* design-review-003 (Panel B): every other control list on
                      this page resolves the id through policy.controls before
                      showing it — this one used to print the raw id list. */}
                  Inherited:&ensp;
                  {entry.inheritedControls.map((id) => findControlName(policy, id) ?? id).join(', ')}{' '}
                  — already satisfied by this approval, so not re-imposed here.
                </p>
              )}
              {entry.unresolvedIds && entry.unresolvedIds.length > 0 && (
                <p className="verdict__chain-derived">
                  Not on the covered registry:&ensp;{entry.unresolvedIds.map((id) => supplierDisplayName(id, policy).name).join(', ')}. A full
                  supplier and platform risk assessment is required for {entry.unresolvedIds.length === 1 ? 'it' : 'them'}.
                </p>
              )}
              {entry.inheritedControls.length === 0 && !entry.unresolvedIds && (
                entry.resolved ? (
                  <p className="verdict__chain-derived">
                    Nothing inherited:&ensp;its approval does not cover this use case, so its
                    controls are assessed from scratch.
                  </p>
                ) : (
                  <p className="verdict__chain-derived">
                    Nothing inherited:&ensp;this component is not on the covered registry. A full
                    supplier and platform risk assessment is required.
                  </p>
                )
              )}
              {/* FX-4 pass 2 (TC-CR6-11c): the listed component is on the
                  registry but this use case sits outside its envelope — say
                  why it inherits nothing, beside the unlisted one's line. */}
              {entry.inheritedControls.length === 0 &&
                entry.unresolvedIds &&
                entry.unresolvedIds.length > 0 &&
                entry.unresolvedIds.length < entry.declaredId.split(' + ').length && (
                <p className="verdict__chain-derived">
                  Nothing inherited from the listed one either:&ensp;its approval does not cover this
                  use case, so its controls are assessed from scratch.
                </p>
              )}
              {entry.inheritedControls.length === 0 && entry.unresolvedIds && entry.unresolvedIds.length === 0 && (
                <p className="verdict__chain-derived">
                  Nothing inherited:&ensp;their approval does not cover this use case, so its
                  controls are assessed from scratch.
                </p>
              )}

              {entry.dimensions.length > 0 && (
                <ul className="verdict__tripped">
                  {entry.dimensions.map((d, i) => (
                    <li key={`${i}-${d.dimension}`}>
                      {/* D-61: the source label repeats on each row, not just
                          the header above — a platform+supplier pair can
                          constrain the SAME dimension, and a reader scanning
                          rows (rather than reading top-down) must still be
                          able to tell which approval each one belongs to. */}
                      <span className="verdict__chain-source verdict__chain-source--quiet">
                        {INHERITANCE_SOURCE_LABEL[entry.source]}
                      </span>{' '}
                      {/* design-review-003 (Panel B): field-copy.ts already
                          maintains GRAPH_FIELD_LABELS for this exact field-key
                          set, consumed elsewhere (the intake form, graph
                          summaries) — this list used to bypass it and print
                          the raw internal key. */}
                      {GRAPH_FIELD_LABELS[d.dimension] ?? d.dimension}
                      {GRAPH_FIELD_LABELS[d.dimension] && (
                        <code className="verdict__id-quiet"> {d.dimension}</code>
                      )}{' '}
                      <span className={`verdict__severity verdict__severity--${d.fits ? 'low' : 'critical'}`}>
                        {d.fits ? 'Within envelope' : 'Outside envelope'}
                      </span>{' '}
                      — cleared for {d.ceiling}
                      {d.observed !== undefined && <>; this use case has {d.observed}</>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div></Fold>
      )}

      {/* VD-6. The engine wrote living_status on every verdict since V1 and
          nothing ever rendered it — found 2026-08-15 by the traceability
          close-out, not by a test, which is the ninth instance of the
          computed-but-never-consumed defect this repo documents. In V1 it is
          always "approved" at issue (the other states arrive with live
          monitoring in V2), so the copy says what the field is FOR rather
          than pretending it is being watched. */}
      <p className="verdict__living-status">
        {/* The RAW value 'approved' cannot render here: the acceptance suite
            holds a single-match /approved|rejected/i guard over the verdict
            (BC-V12B-03), and this word broke it — the third time this session
            the trap in CLAUDE.md has fired. Display labels; the raw value
            stays on the stored verdict untouched. */}
        Living status: <strong>{LIVING_STATUS_LABEL[verdict.living_status]}</strong> · as of{' '}
        {new Date(verdict.living_status_updated_at).toLocaleDateString()} — this is the verdict's standing
        against its expiry conditions above. In this version it only changes at re-review.
      </p>

      {registerStage && stageNote(registerStage, view) && (
        <p className="verdict__stage-note" role="status">
          {stageNote(registerStage, view)}
        </p>
      )}

      {/* Rendered only where correction is actually available. Absence here
          is the requirement, not an oversight (TC-R3-RD-8-01). Kept next to
          the reasoning trace: both are gated on showSubmitterAffordances
          (FN-004) because they're one concept — the submitter's own view of
          their record — not two independent controls that happen to share a
          boolean.
          R16-D2 §2 item 5 (DR7-21): not rendered on a "No" — the first
          screen's own correction control (FirstScreen, above) is the ONE
          correction control there; this second one stays as it is on every
          other verdict. */}
      {showSubmitterAffordances && onCorrect && !view.isRejected && (
        <button type="button" onClick={onCorrect}>
          Correct this classification?
        </button>
      )}

      {showSubmitterAffordances && (
      <details className="verdict__trace">
        <summary>Reasoning trace</summary>
        {reasoningTrace ? (
          <>
            {/* Jailbreak-review gap (2026-08-15): the LLM's retelling rendered
                with no provenance label, so a reader could take AI prose as
                the verdict's official reasoning. The verdict's authority is
                the deterministic panels above; this is commentary. */}
            <p className="verdict__trace-provenance">
              Written by the optional AI model as a plain-English retelling. It is not part of the
              verdict: the authoritative reasoning is the rule-by-rule panels above, and if this
              prose ever disagrees with them, the panels win.
            </p>
            <p>{reasoningTrace}</p>
          </>
        ) : fallbackDescription ? (
          <p>
            <code>{verdict.binding_constraint}</code> — {fallbackDescription}
          </p>
        ) : (
          <p>
            Narrative summary not generated — this optional plain-English retelling needs a
            configured model (Settings). It adds nothing to the outcome above: the rules, citations
            and required controls shown on this page are the complete basis for the decision.
          </p>
        )}
      </details>
      )}

      {/* R10-CM: export in the reviewer's language. The memo restates the
          record — every provisional/pending/unverified marker survives into
          it verbatim (ADR-VA-R10-1). */}
      <div className="verdict__memo-export">
        <button type="button" onClick={() => void downloadMemo()}>
          Download effective-challenge memo (markdown)
        </button>
        <p className="verdict__memo-export-note">
          A 2LoD-style memo generated from this record. It restates the record; it does not strengthen it.
        </p>
        {/* code-review-005, R3-3: a throw in downloadMemo used to vanish
            inside a void-ed promise — nothing downloaded, nothing shown. */}
        {memoError && (
          <p className="verdict__memo-export-error" role="alert">
            Couldn&apos;t generate the memo: {memoError}
          </p>
        )}
      </div>

      <p className="verdict__caveat">
        Audit trail is append-only and hash-chained — an edited event, or a deleted event with later
        events after it, breaks the chain (see the chain check on the audit trail below); removing the
        newest events can&apos;t be detected from inside this browser. It is still client-side with no
        external anchor, so it cannot rule out a full, consistent rewrite by someone with local access.
      </p>
        </div>
      </details>
    </section>
  );
}
