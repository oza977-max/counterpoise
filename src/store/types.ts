import type { GraphCorrection } from '../engine/types';
import type { Verdict } from '../types/verdict';

// R16-D2 §1 (D-95). The persisted shape of src/components/plain-copy.ts's
// `Assumption` — declared here rather than imported, because src/store/*
// never imports from src/components/* (Rule 3, cross-cutting.md §7: the
// store is persistence-only and does not depend on the presentation
// layer that depends on it). The two are kept in sync by hand; a drift
// would surface immediately as a type error at IntakeFlow.tsx's write
// site, which passes a real `Assumption[]` into this field.
export interface AssumptionRecord {
  questionId: string;
  question: string;
  shortLabel: string;
  assumption: string;
  fields: string[];
}

// Full AuditEventType union per verdict-audit.md §4.3.
export type AuditEventType =
  | 'use_case_created'
  | 'duplicate_dismissed'
  | 'classification_adopted'
  | 'graph_confirmed'
  | 'verdict_produced'
  | 'graph_corrected'
  | 'verdict_corrected'
  | 'lifecycle_stage_changed'
  | 're_evaluation_queued'
  | 'twoloD_reviewed'
  | 'reasoning_trace_generated'
  | 'rule_dissent_filed'
  | 'sampling_reviewed'
  | 'control_ownership_assigned'
  | 'control_evidence_attested';

export interface AuditEvent {
  event_id: string;
  use_case_id: string;
  event_type: AuditEventType;
  occurred_at: string;
  actor: string;
  payload: AuditEventPayload;
  // Hash chain (explore-007 D-001 fix, round 8): every event is written with
  // a SHA-256 hash of its own content plus the hash of the event written
  // immediately before it, across the WHOLE trail — not per use case. Any
  // edit, reorder, or deletion of a past event that has later events after
  // it breaks the chain from that point forward, and verifyChain()
  // (store/audit.ts) detects that on read. Removing the NEWEST events leaves
  // a shorter chain that still verifies (CR8-04b) — not detectable without an
  // outside anchor.
  // `prev_hash` is null only for the very first event ever written.
  // This is tamper-EVIDENT, not tamper-PROOF: it is still a client-side
  // store, so a sophisticated attacker with full local access could in
  // principle recompute the entire chain consistently after an edit. What
  // it closes is the honest gap the product used to state outright — a
  // single altered event, or a deleted event with later ones after it, is
  // now detectable rather than invisible.
  prev_hash: string | null;
  hash: string;
}

export type AuditEventPayload =
  | { type: 'use_case_created'; description: string; intake_method: 'llm' | 'structured_form' }
  // UC-2 (round 4). The duplicate check surfaces a match and the submitter
  // decides. Both outcomes are decisions about the inventory and both are
  // recorded: dismissing a match was previously invisible, so nobody could
  // afterwards tell a genuine new use case from a duplicate waved through.
  | { type: 'duplicate_dismissed'; candidate_use_case_id: string; candidate_label: string }
  // Adoption records where the classification came from. The adopted record
  // deliberately carries NO verdict of its own — nothing was evaluated, and
  // the sign-off page says so (register-lifecycle.md §15.2).
  | {
      type: 'classification_adopted';
      adopted_from_use_case_id: string;
      adopted_from_label: string;
      tier: string | null;
      track: string | null;
    }
  // submitter_note (2026-08-15): optional context for the 2LoD reviewer,
  // recorded with the attestation. Human-read at sign-off; never engine input.
  // contradiction_resolutions (2026-08-15): the explanations a submitter
  // gives when their description contradicted their structured answers.
  // Found evaporating during a user walkthrough — typed, required to
  // proceed, and never persisted. On an audit product that is a defect,
  // not a nice-to-have.
  // answer_contexts (R6-CX-1, 2026-08-16): optional context the submitter
  // typed on question answers. Human-read at sign-off; never engine input.
  | {
      type: 'graph_confirmed';
      graph_id: string;
      graph_version: number;
      corrections_count: number;
      submitter_note?: string;
      contradiction_resolutions?: string[];
      answer_contexts?: string[];
      // GT7 L-1 (P12): phrases in the typed description that tried to set the
      // case's own rating (engine/rating-instructions.ts). Written only on the
      // first confirmation of a description-path case and only when non-empty
      // (spread-if-present). A note for the reviewer — never engine input.
      rating_instructions?: string[];
      // R16-D2 §1/§4 (D-95, D-81, DR7-16, DR7-19). Every "Not sure" answer
      // this confirmation was based on, in the §1 shape — written only
      // when non-empty (spread-if-present, same discipline as
      // submitter_note above). RegisterDetail.tsx's
      // currentVerdictAttestationFields() is the one place that decides
      // which event's assumptions a reader sees for the CURRENT verdict.
      assumptions?: AssumptionRecord[];
    }
  | {
      type: 'verdict_produced';
      verdict: Verdict;
      reasoning_trace?: string;
      // R11-KL-2 (ADR-EE-R11-1): the ids of risk-knowledge-lens entries
      // whose condition matched the confirmed graph AT THE TIME OF THIS
      // EVALUATION — never a field on Verdict/EvaluationResult itself, so
      // evaluate()'s output stays byte-identical whether or not the lens is
      // loaded. Riding "beside the verdict" is the explicit R11-NF-1
      // allowance. The full graph is deliberately not persisted on the
      // register entry (ADR-RL-R3-1 consequences), so this is the id list a
      // later reader (e.g. RegisterDetail, at 2LoD sign-off) re-resolves
      // against the currently-loaded lens entries — condition re-matching
      // against the graph cannot happen later, but the domain identity can
      // still be shown. Optional so every pre-R11-KL verdict stays valid.
      knowledge_lens_matched_entry_ids?: string[];
      // R16-D2 §4b (D-97, W-7). The processing node's platform/vendor AT
      // EVALUATION TIME — rides beside the verdict exactly like
      // knowledge_lens_matched_entry_ids above, for the identical reason:
      // the graph is not persisted on the register entry, so a safeguard
      // whose evidence is scoped to a platform/vendor needs this to still
      // tell "already in place" from "outstanding" once the graph is gone.
      // Written spread-if-present (IntakeFlow.tsx): absent when the
      // processing node declared neither.
      evidence_scope?: { platform?: string; vendor?: string };
    }
  | { type: 'graph_corrected'; correction: GraphCorrection }
  | {
      type: 'verdict_corrected';
      original_verdict_id: string;
      new_verdict: Verdict;
      reasoning_trace?: string;
      // R11-KL-2: same allowance as verdict_produced's field above.
      knowledge_lens_matched_entry_ids?: string[];
      // F-4 (DR7-12, DR7-16). Same shapes, same spread-if-present write
      // discipline, as graph_confirmed's fields above — a correction used
      // to drop the submitter's note, their contradiction explanations and
      // their answer contexts entirely, because only the graph_confirmed
      // branch ever wrote them. RegisterDetail reads these from whichever
      // event recorded the CURRENT verdict (the latest verdict_corrected
      // when it came from a correction, else the case's graph_confirmed) —
      // one helper, used for all three fields.
      submitter_note?: string;
      contradiction_resolutions?: string[];
      answer_contexts?: string[];
      // R16-D2 §4 (D-81): same field as graph_confirmed's above, on
      // whichever event recorded THIS correction's own confirmation.
      assumptions?: AssumptionRecord[];
      // R16-D2 §4b: same field as verdict_produced's above.
      evidence_scope?: { platform?: string; vendor?: string };
      // R16-D2 §5/§8 (F2C-6), reworded CR8-19. The number of graph_corrected
      // events on the trail since the last result for this attempt — NOT the
      // number this one pass wrote. A zero means no answer changed since that
      // result, and eventDetail (RegisterDetail.tsx) reads it to render
      // "Re-checked — no answers changed." rather than implying something
      // changed. Optional: a pre-D2 verdict_corrected predates the field,
      // and an absent count is never read as zero (`=== 0`, not `!count`).
      corrections_count?: number;
    }
  | { type: 'lifecycle_stage_changed'; from_stage: LifecycleStage; to_stage: LifecycleStage }
  | { type: 're_evaluation_queued'; policy_version: string }
    // verdict-audit.md §13.4 (design review C-1). `verdict_id` follows the
  // pattern the schema already uses (`verdict_corrected.original_verdict_id`,
  // `reasoning_trace_generated.verdict_id`). It is the id of the verdict the
  // page RENDERED, threaded from the render — never re-derived at write time,
  // which would reintroduce the race it closes. Without it, an attestation is
  // recorded against whatever is current and it could never afterwards be
  // established which verdict was actually signed.
  | {
      type: 'twoloD_reviewed';
      action: 'approved' | 'rejected' | 'correction_requested';
      verdict_id: string;
      // Round 4 close-out (code review 003, blind panel). The trail recorded
      // `actor: role` — the string "2LoD", not a person — so it could not
      // afterwards say who signed. This is NOT authentication: the product has
      // no backend to authenticate against, and the UI says the name is
      // self-asserted. It records who claimed to be signing, which is the
      // difference between an anonymous approval and an attributable one.
      //
      // Optional on the type so attestations written before this change stay
      // readable; the UI refuses to write one without it.
      attested_by_name?: string;
      notes?: string;
    }
  | { type: 'reasoning_trace_generated'; verdict_id: string; trace: string }
  // Rule dissent (2026-08-15, FN-009). A 2LoD reviewer challenges a RULE the
  // verdict relied on — not the verdict itself. Advisory by construction: the
  // verdict stands unchanged, the lifecycle stage does not move, and the
  // dissent lands in the rule-improvement queue for the humans who author the
  // rulebook (grounding/PACK-AUTHORING.md). This is the human half of the
  // dissent-panel design; a machine judge would file through the same event,
  // marked by actor, never through a different door.
  // `verdict_id` is the id of the verdict the challenger was shown, threaded
  // from the render like twoloD_reviewed's (§13.4) — never re-derived at
  // write time. `rule_label` is carried only when the rule was picked from
  // the verdict's own rationale, so a free-typed reference stays visibly a
  // reference, not a resolved rule.
  | {
      type: 'rule_dissent_filed';
      verdict_id: string;
      rule_id: string;
      rule_label?: string;
      dissent: string;
      filed_by_name: string;
    }
  // R12-AB (ADR-VA-R12-1): written ONLY when a human actually reviews a
  // sampled verdict — nothing is stored or queued by isSampledForReview()
  // itself, which is re-applied at render time from the verdict id. Same
  // append-only, no-writer-here-yet split as the rest of this round: the UI
  // pass adds the write path. `verdict_id` follows the same threaded-from-
  // render pattern as twoloD_reviewed/rule_dissent_filed — never re-derived
  // at write time.
  | {
      type: 'sampling_reviewed';
      verdict_id: string;
      reviewed_by_name: string;
      outcome_note?: string;
    }
  // design-vision.md L-6 / explore-007 D-003 follow-up (2026-08-31). An
  // OUTSTANDING control had no owner, no target date, no age, no overdue
  // signal — a static status a human managed in email. This is the
  // honestly-scoped fix: assignment, not automation. No reminders, no
  // notifications, no ticketing — this app has no backend to run them
  // from, and faking that layer would be exactly the kind of overclaim
  // NF-2/L-3 exist to prevent. `verdict_id` follows the same threaded-
  // from-render pattern as twoloD_reviewed/rule_dissent_filed — never
  // re-derived at write time. Re-assigning (a later event for the same
  // control_id) is how the owner/date changes; the append-only trail
  // keeps every prior assignment, and the UI reads the latest.
  | {
      type: 'control_ownership_assigned';
      verdict_id: string;
      control_id: string;
      owner_name: string;
      target_date: string;
    }
  // RG-9 (2026-09-01). Closes the second core-loop gap: a verdict names
  // controls to put in place, but nothing in the app let a human record
  // that one WAS put in place — the "in place" status came only from a
  // hand-edited field in the policy YAML (verification_evidence.status),
  // which no reviewer working a case can touch. This event is a named
  // reviewer's attestation, ON THE REGISTER, that a control is in place,
  // with a free-text pointer to the evidence (a ticket, a config export,
  // a report). Deliberately DISTINCT from the policy's machine/hand-edited
  // `verified` status: the UI renders this as "attested (not verified)"
  // with the name, never as machine-verified — same honesty posture as
  // every other self-asserted name in this app (no sign-in, so no name is
  // authenticated). No file upload: a client-side store cannot hold
  // evidence files, and pretending to would be exactly the NF-2/L-3
  // overclaim this product refuses. `verdict_id` threaded from render like
  // the others; re-attesting is a later event and the UI reads the latest.
  | {
      type: 'control_evidence_attested';
      verdict_id: string;
      control_id: string;
      attested_by_name: string;
      evidence_note: string;
    };

// Register types per register-lifecycle.md §4.1–4.2.
export type RegisterNodeType = 'use_case' | 'ai_model' | 'platform' | 'vendor' | 'data_source' | 'control';

export interface RegisterNode {
  node_id: string;
  node_type: RegisterNodeType;
  label: string;
  created_at: string;
  metadata: RegisterNodeMetadata;
}

// Note: tier/track are typed string | null here (not the real Tier/Track union
// from src/engine/types.ts) to avoid a premature cross-import before P3-C01's
// engine lands fully — intentional, minor typing looseness for this chunk.
export type RegisterNodeMetadata =
  | {
      node_type: 'use_case';
      // Stored so the duplicate check can match against what was DESCRIBED,
      // not only the short name (2026-08-15). Optional: legacy nodes lack it.
      description?: string;
      submitted_by: string;
      lifecycle_stage: LifecycleStage;
      current_verdict_id: string | null;
      tier: string | null;
      track: string | null;
      // Set when the case was saved but writing its uses_model link failed, so
      // the register cannot tell "no model named" from "link lost".
      model_link_unrecorded?: boolean;
    }
  | { node_type: 'ai_model'; model_id: string; vendor: string; is_approved: boolean }
  | { node_type: 'platform'; platform_id: string; approved_envelope_summary: string }
  | { node_type: 'vendor'; vendor_name: string; approval_status: 'approved' | 'unapproved' | 'pending' }
  | { node_type: 'data_source'; data_class: string; data_zone: string }
  | { node_type: 'control'; control_id: string; burden: 1 | 2 | 3 | 4 | 5 };

export type RegisterEdgeType =
  | 'uses_model'
  | 'runs_on_platform'
  | 'provided_by_vendor'
  | 'consumes_data_from'
  | 'requires_control';

export interface RegisterEdge {
  edge_id: string;
  from_node_id: string;
  to_node_id: string;
  edge_type: RegisterEdgeType;
  created_at: string;
}

export type LifecycleStage =
  | 'idea'
  | 'exploring'
  | 'pre_checked'
  | 'approved'
  | 'in_production'
  | 'monitored'
  | 'retired';

export interface UseCaseSummary {
  use_case_id: string;
  label: string;
  description?: string;
  submitted_by: string;
  submitted_at: string;
  lifecycle_stage: LifecycleStage;
  tier: string | null;
  track: string | null;
  // evaluation-engine.md §13.3: Provisional is NOT a fourth status — it is a
  // qualifier carried alongside the status. The register used to overwrite the
  // status with 'provisional', which hid what was actually decided. Rare
  // before round 3 (only unsigned pack rules triggered it); universal
  // afterwards, which is what exposed it.
  current_verdict_status: 'approved' | 'approved_with_controls' | 'rejected' | null;
  provisional: boolean;
  last_evaluated_at: string | null;
  policy_version_at_evaluation: string | null;
  stale_assessment: boolean;
  // R12-BD-3: re-exposes the verdict's own provisional_reasons — never a
  // second derivation, just carried through so the register's pilot line
  // can classify causes without loading every case's full verdict record.
  provisional_reasons: string[];
  // R12-AB-1: the id of the current verdict, needed by isSampledForReview();
  // absent when there is no verdict.
  current_verdict_id: string | null;
  // R12-AB-1: computed here (register.ts already loads the full audit trail
  // per row) — true when this is a self-served Low-tier decided verdict
  // that the deterministic sampling function selected AND no
  // sampling_reviewed event exists yet for it.
  sampling_review_due: boolean;
}
