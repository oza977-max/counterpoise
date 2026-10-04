import { z } from 'zod';
import type { AuditEvent, RegisterNode, RegisterEdge } from './types';
import {
  getAllForExport,
  importTailIfContinuesWithinQueue,
  backupAndReplaceAllRawEventsWithinQueue,
  currentTipWithinQueue,
  withAuditQueue,
  verifyChainOf,
  sha256Hex,
} from './audit';
import { exportAll, importRegister, backupAndReplaceRegister } from './register';

// RG-8 — verified hand-off bundle (2026-09-01; relabelled from RG-6 in
// code-review-005 F9/F27 — RG-6 already meant blast-radius queries in this
// product's requirement set, and this feature had never had a requirement
// id of its own). The core end-to-end gap: Counterpoise's whole value is a
// SUBMITTER and a REVIEWER who are different people, but the app runs
// entirely in one browser, so "1LoD" and "2LoD" were a role toggle on one
// machine. This module lets a bundle of the register + the append-only
// audit trail be exported from one machine and imported on another, with
// the hash chain used exactly as intended: an accidentally damaged file, or
// one edited without recomputing the chain, is caught on arrival — and, the
// honest hard part, two histories can only be merged when one is a PREFIX
// of the other.
//
// WHAT THE SEAL AND CHAIN DO NOT PROVE (code-review-005 F2). Both are plain
// SHA-256 over public, open-source logic — no key, no secret, no external
// anchor. They catch accidental corruption and an edit that was NOT
// followed by recomputing the downstream chain — the common case, and the
// gap this product used to leave wide open. They do NOT prove who produced
// the file: anyone holding it can edit it and recompute every hash and the
// seal to match, and import will accept the result (see the F2 test in
// handoff.test.ts, which builds exactly that and asserts it is accepted).
// This is the same "tamper-evident, not tamper-proof" honesty the local
// trail already states (types.ts's AuditEvent.hash comment) — a hand-off
// file just makes the file itself the thing an attacker could hold, so the
// UI, export/replace messages, and this comment all say the same thing:
// only import a bundle from someone you trust, sent by a route you trust.
//
// WHY PREFIX-ONLY IS THE CORRECT INVARIANT, NOT A LIMITATION.
// The hash chain is global: every event's hash depends on the one before
// it, back to genesis. Two chains grown independently on two machines share
// no common suffix and cannot be concatenated without either recomputing
// hashes (destroying the tamper-evidence that was verified at the source)
// or leaving a break (a false tamper signal). There is no honest general
// merge. But the hand-off workflow never produces divergent chains in
// normal use: A exports, B imports and appends its sign-off, B exports
// back, A imports. At every step one side's chain is a prefix of the
// other's. So the rule is exact: import succeeds iff the local chain and
// the bundle chain are prefix-compatible (one extends the other,
// byte-for-byte on the shared span); anything else means the two histories
// have genuinely diverged (the code's ImportOutcome calls this 'diverged'),
// and the import is REJECTED with no writes. This is idempotent
// (re-importing an already-absorbed bundle is a no-op) and it refuses
// precisely the case it cannot honestly handle.

export const HANDOFF_FORMAT_VERSION = 1;

// --- Bundle shape + validation -------------------------------------------
//
// code-review-005 F3/F4/F13/F20. The bundle travels between people, so it is
// untrusted input — the schema below now validates it structurally AND
// semantically before anything is hashed or written: every timestamp is a
// real ISO datetime (an unparseable one used to make the monotonic clock
// NaN and break every later local write for the rest of the session);
// event_type and payload.type are drawn from the actual AuditEventType
// union and must agree with each other; each payload variant's OWN required
// fields are checked (not just "some object with the right `type`" — a
// missing field used to render as a blank or "undefined" line in the audit
// trail, the product's core artefact); register-node metadata matches the
// real RegisterNodeMetadata shape and metadata.node_type agrees with the
// node's own node_type (a mismatch used to throw deep inside a Promise.all
// in register.ts and freeze the whole register list behind "Loading…").
// `verdict`/`correction` stay intentionally partial (passthrough) rather
// than mirroring every nested field of Verdict/GraphCorrection: only the
// fields this codebase actually dereferences are required, so the schema
// does not have to track two full complex types in two places, which is
// its own drift risk (the project's RF-1/RF-3 recurring findings) — the
// audit chain's own hash verification remains the deeper integrity gate.

const isoDatetime = z.string().datetime({ offset: true, message: 'must be a valid ISO datetime' });

const LIFECYCLE_STAGES = ['idea', 'exploring', 'pre_checked', 'approved', 'in_production', 'monitored', 'retired'] as const;
const lifecycleStageSchema = z.enum(LIFECYCLE_STAGES);

// code-review-005 round 2, N4. ConfidenceCaveat (src/engine/types.ts) in
// full — small and stable, like graphCorrectionSchema below.
//
// R16-F F-5 (DR7-01): `.passthrough()` here and on every other NESTED object
// schema below (rule rationale, tripped invariant, verdict conditions, graph
// correction), not just the top-level event/payload/node/edge ones. These
// sit inside hashed payloads too — a nested `z.object` strips an unknown key
// just the same, and the chain is then recomputed over the stripped copy, so
// a field a later version adds one level down would make an untouched file
// fail as "altered after it was exported" exactly like a top-level one.
const confidenceCaveatSchema = z
  .object({
    ruleId: z.string(),
    field: z.string(),
    reason: z.string(),
    confidence: z.enum(['low', 'medium', 'high']),
  })
  .passthrough();

// N4: RuleRationale / TrippedInvariantDetail / VerdictExplanation
// (src/engine/types.ts). explanation itself stays OPTIONAL on the schema
// below (VerdictDisplay.tsx already treats a missing explanation as a real,
// legacy-tolerant possibility — "BC-V11C01-04: verdicts persisted before
// V1.1-C01 lack `explanation`" — and every render site guards it with
// `explanation &&`), but once present its shape is required in full: several
// of its own fields (tripped_invariants, hard_lines_checked, ...) are read
// unguarded ONCE `explanation` itself is truthy (VerdictDisplay.tsx's
// WhyThisVerdict/"how fragile" sections; RegisterDetail.tsx's
// challengeableRules), so a bundle supplying a partially-shaped explanation
// object is exactly as dangerous as one supplying none — reject it instead.
const ruleRationaleSchema = z
  .object({
    rule_id: z.string(),
    rule_name: z.string().optional(),
    matched_field: z.string().optional(),
    regulatory_basis: z.string().optional(),
  })
  .passthrough();

const trippedInvariantDetailSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    severity: z.string(),
    regulatory_basis: z.string().optional(),
    required_controls: z.array(z.string()),
    graph_path: z.string(),
  })
  .passthrough();

const verdictExplanationSchema = z
  .object({
    tier_rationale: ruleRationaleSchema.nullable(),
    track_rationale: ruleRationaleSchema.nullable(),
    hard_lines_checked: z.number(),
    invariants_checked: z.number(),
    tripped_invariants: z.array(trippedInvariantDetailSchema),
    binding_reason: z.string().nullable(),
    binding_regulatory_basis: z.string().nullable(),
  })
  .passthrough(); // regulatory_chain (optional on the real type) and any future field ride through unvalidated — not dereferenced without its own `?? []`/`?.` guard anywhere in this codebase today.

// Load-bearing subset of Verdict (src/types/verdict.ts extends
// EvaluationResult, src/engine/types.ts) — every field register.ts's
// toSummary()/isVerdictProvisional()/hasPendingPolicyUpdate() OR
// VerdictDisplay.tsx/RegisterDetail.tsx dereference WITHOUT a `??`/`?.` guard
// (code-review-005 round 2, N4 — a bundle missing `confidence_caveats` used
// to pass this schema, then throw inside isVerdictProvisional/toSummary,
// which dropped the case from the register list and hung its own page on
// "Loading…" forever). Everything else on a real Verdict rides through via
// passthrough — mirroring the type field-for-field here would be its own
// drift risk (the project's RF-1/RF-3 recurring findings); this is
// deliberately the load-bearing subset, not the whole shape, same posture as
// graphCorrectionSchema's comment below.
const verdictSchema = z
  .object({
    id: z.string(),
    use_case_id: z.string(),
    status: z.enum(['approved', 'approved_with_controls', 'rejected']),
    policy_version: z.string(),
    // Real Tier/Track are non-null enums (src/engine/types.ts) — VerdictDisplay
    // dereferences `verdict.tier.toLowerCase()` unguarded, which throws on
    // null, the one value the PRE-round-2 schema allowed.
    tier: z.enum(['Critical', 'High', 'Medium', 'Low']),
    track: z.enum(['I', 'II', 'III']),
    // Absent-as-legacy is the one deliberate exception (isVerdictProvisional's
    // own documented legacy branch) — every other field here is required.
    provisional_reasons: z.array(z.string()).optional(),
    confidence_caveats: z.array(confidenceCaveatSchema),
    controls: z.array(z.string()),
    downstream_reviews: z.array(z.string()),
    conditions: z.object({ hypotheses: z.array(z.string()) }).passthrough(),
    margin_achieved: z.number(),
    margin_target: z.number(),
    single_covered_invariants: z.array(z.string()),
    boundary_proximity: z.boolean(),
    attested_at: isoDatetime,
    living_status: z.enum(['approved', 'amber', 'breached', 'revoked']),
    explanation: verdictExplanationSchema.optional(),
  })
  .passthrough();

// GraphCorrection (src/engine/types.ts) in full — it is a small, flat,
// stable type (unlike Verdict), so mirroring it exactly costs little and
// buys real protection for RegisterDetail's correction-record rendering.
// F-5: passthrough for the reason given above confidenceCaveatSchema.
const graphCorrectionSchema = z
  .object({
    correction_id: z.string(),
    graph_version_before: z.number(),
    graph_version_after: z.number(),
    node_id: z.string(),
    field: z.string(),
    original_value: z.unknown(),
    corrected_value: z.unknown(),
    corrected_by: z.string(),
    corrected_at: z.string(),
    reason: z.string().optional(),
    // R16-D2 §5 (CB-4): which screen produced this correction. Optional —
    // every pre-D2 correction predates it.
    correction_source: z.enum(['form', 'review', 'question']).optional(),
  })
  .passthrough();

// R16-D2 §1/§4 (D-95, DR7-19, EB-2/EC-5). The §1 Assumption shape, as
// persisted on graph_confirmed/verdict_corrected. `questionId` is a known
// form QuestionId OR a questionnaire field reference ('field:<graph
// field>', R16-E, not yet built — the import schema accepts the shape
// this chunk defines, not only the values this chunk's own UI produces).
// `fields` is an array of known graph field names — the same vocabulary
// condition.ts's collectFieldValues reads. The three free-text strings
// are bounded (non-empty, <=500 chars) so an oversized or empty field is
// rejected rather than rendering a blank/runaway reviewer line.
const ASSUMPTION_QUESTION_IDS = [
  '1', '2', '3', '3supplier', '3supplierName', '3model', '3a', '3aWhich', '3platformZone',
  '4', '4a', '5', '6', '6a', '6b', '7', '8', '8other', '9', '10', '11', '12', '13', '14',
] as const;
export const ASSUMPTION_GRAPH_FIELDS = [
  'data_class', 'data_zone', 'model_type', 'autonomy_level', 'vendor', 'platform',
  'declared_model_id', 'replaces_prior_model', 'system_access_scope',
  'multi_instance_coordination', 'action_type', 'exposure', 'decision_bindingness',
  'output_reversibility', 'scale', 'decision_type', 'decision_type_other', 'hitl',
  'jurisdictions',
] as const;
const boundedText = (max: number) => z.string().min(1).max(max);
const assumptionSchema = z
  .object({
    questionId: z.union([z.enum(ASSUMPTION_QUESTION_IDS), z.string().regex(/^field:[a-z_]+$/)]),
    question: boundedText(500),
    shortLabel: boundedText(500),
    assumption: boundedText(500),
    fields: z.array(z.enum(ASSUMPTION_GRAPH_FIELDS)),
  })
  .passthrough();

// R16-D2 §4b (D-97). The processing node's platform/vendor at evaluation,
// carried beside the verdict. Both optional — written spread-if-present
// (absent entirely when the processing node declared neither); each
// string bounded like the assumption strings above, for the same reason.
const evidenceScopeSchema = z
  .object({
    platform: boundedText(200).optional(),
    vendor: boundedText(200).optional(),
  })
  .passthrough();

// Mirrors AuditEventPayload (src/store/types.ts) variant-for-variant: the
// `type` literal plus that variant's OWN required fields, so an incomplete
// payload is rejected at the boundary instead of rendering blank/"undefined"
// downstream (F13).
// F-5 (DR7-01). `.passthrough()` on every variant below (and on the event/
// node/metadata/edge schemas further down): a plain `z.object` strips
// unknown keys, and the seal + chain are then recomputed over the STRIPPED
// copy (computeSeal/eventContent below) — so any field a future
// app version adds (D2's assumptions was the motivating case) makes an
// untouched file fail import as "altered after it was exported" the
// moment an OLDER version receives it. `.passthrough()` keeps unknown
// fields exactly as sent, so they are hashed as sent; every FIELD THIS
// SCHEMA ALREADY KNOWS stays fully validated — passthrough only changes
// what happens to keys this schema has never heard of.
const auditPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('use_case_created'),
    description: z.string(),
    intake_method: z.enum(['llm', 'structured_form']),
  }).passthrough(),
  z.object({
    type: z.literal('duplicate_dismissed'),
    candidate_use_case_id: z.string(),
    candidate_label: z.string(),
  }).passthrough(),
  z.object({
    type: z.literal('classification_adopted'),
    adopted_from_use_case_id: z.string(),
    adopted_from_label: z.string(),
    tier: z.string().nullable(),
    track: z.string().nullable(),
  }).passthrough(),
  z.object({
    type: z.literal('graph_confirmed'),
    graph_id: z.string(),
    graph_version: z.number(),
    corrections_count: z.number(),
    submitter_note: z.string().optional(),
    contradiction_resolutions: z.array(z.string()).optional(),
    answer_contexts: z.array(z.string()).optional(),
    // GT7 L-1 (P12): optional — a bundle from before this field still imports.
    rating_instructions: z.array(z.string()).optional(),
    // R16-D2 §1/§4 (D-95, D-81): see assumptionSchema's own comment above.
    assumptions: z.array(assumptionSchema).optional(),
  }).passthrough(),
  z.object({
    type: z.literal('verdict_produced'),
    verdict: verdictSchema,
    reasoning_trace: z.string().optional(),
    knowledge_lens_matched_entry_ids: z.array(z.string()).optional(),
    // R16-D2 §4b (D-97): see evidenceScopeSchema's own comment above.
    evidence_scope: evidenceScopeSchema.optional(),
  }).passthrough(),
  z.object({
    type: z.literal('graph_corrected'),
    correction: graphCorrectionSchema,
  }).passthrough(),
  z.object({
    type: z.literal('verdict_corrected'),
    original_verdict_id: z.string(),
    new_verdict: verdictSchema,
    reasoning_trace: z.string().optional(),
    knowledge_lens_matched_entry_ids: z.array(z.string()).optional(),
    // F-4 (DR7-12, DR7-16): same shapes as graph_confirmed above.
    submitter_note: z.string().optional(),
    contradiction_resolutions: z.array(z.string()).optional(),
    answer_contexts: z.array(z.string()).optional(),
    // R16-D2 §1/§4/§4b/§8: same fields as graph_confirmed/verdict_produced
    // above, plus corrections_count: the graph_corrected events on the trail
    // since the last result for this attempt (CR8-19; F2C-6's
    // zero-correction "Re-checked" rendering).
    assumptions: z.array(assumptionSchema).optional(),
    evidence_scope: evidenceScopeSchema.optional(),
    corrections_count: z.number().optional(),
  }).passthrough(),
  z.object({
    type: z.literal('lifecycle_stage_changed'),
    from_stage: lifecycleStageSchema,
    to_stage: lifecycleStageSchema,
  }).passthrough(),
  z.object({
    type: z.literal('re_evaluation_queued'),
    policy_version: z.string(),
  }).passthrough(),
  z.object({
    type: z.literal('twoloD_reviewed'),
    action: z.enum(['approved', 'rejected', 'correction_requested']),
    verdict_id: z.string(),
    attested_by_name: z.string().optional(),
    notes: z.string().optional(),
  }).passthrough(),
  z.object({
    type: z.literal('reasoning_trace_generated'),
    verdict_id: z.string(),
    trace: z.string(),
  }).passthrough(),
  z.object({
    type: z.literal('rule_dissent_filed'),
    verdict_id: z.string(),
    rule_id: z.string(),
    rule_label: z.string().optional(),
    dissent: z.string(),
    filed_by_name: z.string(),
  }).passthrough(),
  z.object({
    type: z.literal('sampling_reviewed'),
    verdict_id: z.string(),
    reviewed_by_name: z.string(),
    outcome_note: z.string().optional(),
  }).passthrough(),
  z.object({
    type: z.literal('control_ownership_assigned'),
    verdict_id: z.string(),
    control_id: z.string(),
    owner_name: z.string(),
    target_date: z.string(),
  }).passthrough(),
  z.object({
    type: z.literal('control_evidence_attested'),
    verdict_id: z.string(),
    control_id: z.string(),
    attested_by_name: z.string(),
    evidence_note: z.string(),
  }).passthrough(),
]);

const AUDIT_EVENT_TYPES = [
  'use_case_created',
  'duplicate_dismissed',
  'classification_adopted',
  'graph_confirmed',
  'verdict_produced',
  'graph_corrected',
  'verdict_corrected',
  'lifecycle_stage_changed',
  're_evaluation_queued',
  'twoloD_reviewed',
  'reasoning_trace_generated',
  'rule_dissent_filed',
  'sampling_reviewed',
  'control_ownership_assigned',
  'control_evidence_attested',
] as const;

const auditEventSchema = z
  .object({
    event_id: z.string(),
    use_case_id: z.string(),
    event_type: z.enum(AUDIT_EVENT_TYPES),
    occurred_at: isoDatetime,
    actor: z.string(),
    payload: auditPayloadSchema,
    prev_hash: z.string().nullable(),
    hash: z.string(),
  })
  // F-5 (DR7-01): see auditPayloadSchema's comment above.
  .passthrough()
  .refine((e) => e.event_type === e.payload.type, {
    message: 'event_type does not match payload.type',
  });

const REGISTER_NODE_TYPES = ['use_case', 'ai_model', 'platform', 'vendor', 'data_source', 'control'] as const;

// Mirrors RegisterNodeMetadata (src/store/types.ts) variant-for-variant.
// F-5 (DR7-01): `.passthrough()` on every variant, and on the node/edge
// schemas below — see auditPayloadSchema's comment above for why.
const registerNodeMetadataSchema = z.discriminatedUnion('node_type', [
  z.object({
    node_type: z.literal('use_case'),
    description: z.string().optional(),
    submitted_by: z.string(),
    lifecycle_stage: lifecycleStageSchema,
    current_verdict_id: z.string().nullable(),
    tier: z.string().nullable(),
    track: z.string().nullable(),
  }).passthrough(),
  z.object({
    node_type: z.literal('ai_model'),
    model_id: z.string(),
    vendor: z.string(),
    is_approved: z.boolean(),
  }).passthrough(),
  z.object({
    node_type: z.literal('platform'),
    platform_id: z.string(),
    approved_envelope_summary: z.string(),
  }).passthrough(),
  z.object({
    node_type: z.literal('vendor'),
    vendor_name: z.string(),
    approval_status: z.enum(['approved', 'unapproved', 'pending']),
  }).passthrough(),
  z.object({
    node_type: z.literal('data_source'),
    data_class: z.string(),
    data_zone: z.string(),
  }).passthrough(),
  z.object({
    node_type: z.literal('control'),
    control_id: z.string(),
    burden: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  }).passthrough(),
]);

const registerNodeSchema = z
  .object({
    node_id: z.string(),
    node_type: z.enum(REGISTER_NODE_TYPES),
    label: z.string(),
    created_at: isoDatetime,
    metadata: registerNodeMetadataSchema,
  })
  .passthrough()
  .refine((n) => n.node_type === n.metadata.node_type, {
    message: 'node_type does not match metadata.node_type',
  });

const registerEdgeSchema = z.object({
  edge_id: z.string(),
  from_node_id: z.string(),
  to_node_id: z.string(),
  edge_type: z.enum(['uses_model', 'runs_on_platform', 'provided_by_vendor', 'consumes_data_from', 'requires_control']),
  created_at: isoDatetime,
}).passthrough();

// Cheap pre-check so an unsupported format_version gets its OWN honest
// message (F3/F4/F13/F20) instead of the generic "not a bundle" one — run
// BEFORE the full schema, which would otherwise fail the same way for both.
const bundleEnvelopeSchema = z.object({ format: z.string(), format_version: z.number() }).passthrough();

const handoffBundleSchema = z.object({
  format: z.literal('aigate-handoff'),
  format_version: z.literal(HANDOFF_FORMAT_VERSION),
  exported_at: isoDatetime,
  app_version: z.string(),
  register: z.object({
    nodes: z.array(registerNodeSchema),
    edges: z.array(registerEdgeSchema),
  }),
  audit_events: z.array(auditEventSchema),
  // sha256 over the canonical serialisation of everything above. Covers the
  // register (which is NOT hash-chained) and binds it to the audit tip, so a
  // bundle whose register was altered in transit fails even though the audit
  // chain alone would still verify.
  seal: z.string(),
});

export interface HandoffBundle {
  format: 'aigate-handoff';
  format_version: typeof HANDOFF_FORMAT_VERSION;
  exported_at: string;
  app_version: string;
  register: { nodes: RegisterNode[]; edges: RegisterEdge[] };
  audit_events: AuditEvent[];
  seal: string;
}

// --- Canonical serialisation (deterministic; the seal depends on it) -----
//
// Sorted keys, sorted collections by their stable id, so two machines with
// the same logical state produce byte-identical input to the seal hash.
// Register nodes/edges are re-sorted by id; audit events keep their
// chain order (they are already globally ordered — see audit.ts's
// chain-linked export order — and the chain itself is order-sensitive).

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

function sealInput(
  register: { nodes: RegisterNode[]; edges: RegisterEdge[] },
  events: AuditEvent[],
): string {
  const nodes = [...register.nodes].sort((a, b) => a.node_id.localeCompare(b.node_id));
  const edges = [...register.edges].sort((a, b) => a.edge_id.localeCompare(b.edge_id));
  const tip = events.length > 0 ? events[events.length - 1]!.hash : 'EMPTY';
  return canonicalJson({ nodes, edges, audit_tip: tip, audit_count: events.length });
}

// Exported (code-review-005 F2) so tests proving the documented seal limit —
// "anyone holding the file can recompute it" — can do so with this module's
// own public function instead of re-implementing the algorithm privately.
export async function computeSeal(
  register: { nodes: RegisterNode[]; edges: RegisterEdge[] },
  events: AuditEvent[],
): Promise<string> {
  return sha256Hex(sealInput(register, events));
}

// --- Export ---------------------------------------------------------------

export async function exportBundle(appVersion: string): Promise<HandoffBundle> {
  const register = await exportAll();
  const audit_events = await getAllForExport(); // chain-ordered
  const seal = await computeSeal(register, audit_events);
  return {
    format: 'aigate-handoff',
    format_version: HANDOFF_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    app_version: appVersion,
    register,
    audit_events,
    seal,
  };
}

// --- Import ---------------------------------------------------------------

export type ImportOutcome =
  | 'invalid_format' // not a bundle / schema failed
  | 'tampered' // seal or internal chain broken
  | 'up_to_date' // bundle == local, nothing to do
  | 'local_ahead' // local already extends the bundle, nothing to do
  | 'merged' // bundle extended local; events/register absorbed
  | 'imported_into_empty' // local was empty; whole bundle absorbed (code-review-005 F27: was 'adopted', which collided with the unrelated classification_adopted audit event)
  | 'replaced' // user-confirmed: local discarded (backup taken), bundle installed
  | 'diverged' // two histories that cannot be merged — rejected, no writes
  // round 2, N1: the audit trail (source of truth) WAS replaced, but the
  // register (derived view) failed to follow. A distinct, honest outcome —
  // returned, never thrown — so the caller can offer a real way to finish
  // (finishRegisterReplace) instead of a message that has to claim both
  // "replaced" and "not changed" about the same operation.
  | 'partially_replaced'
  // round 2, N2: the local audit tip no longer matches the tip the caller's
  // backup file actually exported — something was written locally (in the
  // one reachable-in-one-tab window: a case opened and signed off while a
  // replace was pending) between "save a backup" and "confirm replace".
  // Refused, nothing written; the backup no longer covers everything a
  // replace would discard.
  | 'backup_out_of_date'
  // round 2, N1: finishRegisterReplace's own re-check found the local audit
  // tip has moved on since the partial replace it is trying to finish —
  // finishing now would install a register that no longer matches what the
  // audit trail (the source of truth) actually says. Refused; reload.
  | 'finish_out_of_date'
  // round 3, R3-1: partially_replaced's ONLY record that the register still
  // needs finishing used to be React state in RegisterView
  // (awaitingFinish/pendingReplace/backupReady) — gone the moment the user
  // switches view (App.tsx unmounts RegisterView) or reloads. Re-importing
  // the SAME bundle after that used to walk straight into the plain
  // up_to_date branch (the audit trail really does already match) and never
  // look at the register at all, leaving it silently wrong with no UI path
  // back to finishRegisterReplace. The up_to_date check now also compares
  // the register (registersMatch, below); a mismatch there returns this
  // outcome instead, so RegisterView can offer "Finish updating the
  // register" again for a bundle whose audit side already landed.
  | 'register_needs_finishing';

export interface ImportResult {
  outcome: ImportOutcome;
  message: string;
  eventsAdded: number;
}

// round 2, N2. The audit tip (hash + event count) the UI recorded at the
// moment it actually built and downloaded the backup file — read INSIDE the
// audit queue (exportBundle -> audit.getAllForExport, itself queued), so it
// is the tip that bundle's audit_events actually contains, not a
// best-effort snapshot from some other moment. Passed back into
// replaceWithBundle so the replace can refuse, atomically, if the local
// trail has moved on since.
export interface AuditTip {
  hash: string | null;
  count: number;
}

// --- F14: remember successful syncs, so a later divergence reads as a
// warning rather than a reassurance --------------------------------------
//
// A browser's FIRST hand-off receipt always diverges (every browser seeds
// its own demo cases), so the first-time message is deliberately calm. Once
// a sync has actually succeeded, a LATER divergence means something the
// product cannot explain away as normal — the wrong file, both sides
// editing at once, or an altered file — so the message changes to a
// warning. localStorage is the simplest durable, per-browser marker that
// survives reloads without a schema migration on either IndexedDB database;
// it is best-effort (private browsing can block it) and never used for
// anything safety-critical — only for which of two pieces of copy to show.
const LAST_SYNCED_TIP_KEY = 'aigate-handoff-last-synced-tip';

function recordSyncedTip(tipHash: string | null): void {
  try {
    if (tipHash === null) {
      localStorage.removeItem(LAST_SYNCED_TIP_KEY);
    } else {
      localStorage.setItem(LAST_SYNCED_TIP_KEY, tipHash);
    }
  } catch {
    /* localStorage unavailable — the sync marker is advisory copy, not a safety mechanism */
  }
}

// CR7-15: "Clear all data and start over" forgets that a sync ever happened —
// the marker only chooses between two pieces of copy, and keeping it after the
// data it described is gone would make a first-ever import read as a repeat.
export function clearHandoffSyncMarker(): void {
  try {
    localStorage.removeItem(LAST_SYNCED_TIP_KEY);
  } catch {
    /* localStorage unavailable — the marker is advisory */
  }
}

function hasSyncedBefore(): boolean {
  try {
    return localStorage.getItem(LAST_SYNCED_TIP_KEY) !== null;
  } catch {
    return false;
  }
}

// TEST-ONLY (code-review-005 F14). Mirrors audit.__resetChainStateForTests /
// db.__resetDbsForTests — simulating a "fresh browser" in one test process
// needs this reset alongside those. Not a runtime path.
export function __resetHandoffSyncStateForTests(): void {
  try {
    localStorage.removeItem(LAST_SYNCED_TIP_KEY);
  } catch {
    /* ignore */
  }
}

const FIRST_TIME_DIVERGED_MESSAGE =
  "This bundle and your copy have different histories, so they can't be merged. The first time you receive a case this is normal — your browser starts with its own demo cases. You can save a backup of yours and replace it with this bundle.";

const REPEAT_DIVERGED_MESSAGE =
  "Warning: this bundle doesn't continue the history you last synced. That shouldn't happen at this stage — it can mean the wrong file, both of you changing the case at once, or a file that was altered. Check with the sender before replacing anything.";

// Steps shared by import and replace so neither can skip a check: shape,
// duplicate ids, seal, and the incoming chain's own internal integrity.
//
// CR6-01 (code review 006, Critical). This used to check the seal and the
// hash chain — and callers used to STORE — zod's PARSED bundle
// (`parsed.data`). zod's object parsing rebuilds every event, and every
// nested payload, as a NEW object with keys in the SCHEMA's declaration
// order (passthrough extras appended after); eventContent (audit.ts) hashes
// `JSON.stringify(e.payload)` in whatever key order the object it is given
// actually has. The real producer computed each event's stored `.hash` over
// ITS OWN (insertion) key order — whatever order the application code that
// called append() happened to write the payload literal in, which has no
// reason to match the schema's declared field order and routinely does not
// (e.g. IntakeFlow.tsx's verdict_corrected payload writes corrections_count
// right after knowledge_lens_matched_entry_ids; the schema declares
// corrections_count last). Re-hashing the schema-reordered copy therefore
// recomputed a DIFFERENT string and never matched — every real, untampered
// bundle was rejected as "tampered". The fix validates the SHAPE with the
// schema exactly as before (parsed.data, below, is still used everywhere
// only a field's VALUE is read — duplicate-id scan, register comparison,
// message assembly), but hashes, verifies and — if accepted — stores the
// RAW events exactly as the input wrote them: `raw`'s own audit_events,
// parsed from JSON, which preserves the source text's key order. A stored
// event must keep the order it was hashed in, or a LATER verifyChain() call
// (reading it back from IndexedDB) would recompute over the stored,
// reordered copy and report the chain broken all over again — so storage
// (importTailIfContinuesWithinQueue, backupAndReplaceAllRawEventsWithinQueue)
// takes these same raw events from each caller below, not parsed.data's.
async function validateBundle(
  raw: unknown,
): Promise<{ bundle: HandoffBundle; rawEvents: AuditEvent[] } | { failure: ImportResult }> {
  // 1. format_version gets its own honest message (F3/F4/F13/F20) — checked
  //    before the strict schema, which would otherwise fail identically for
  //    "not a bundle at all" and "a bundle from a different app version".
  const envelope = bundleEnvelopeSchema.safeParse(raw);
  if (!envelope.success || envelope.data.format !== 'aigate-handoff') {
    return { failure: { outcome: 'invalid_format', message: 'This file is not a Counterpoise hand-off bundle.', eventsAdded: 0 } };
  }
  if (envelope.data.format_version !== HANDOFF_FORMAT_VERSION) {
    return {
      failure: {
        outcome: 'invalid_format',
        message: "This hand-off file was made by a different version of Counterpoise and can't be imported here.",
        eventsAdded: 0,
      },
    };
  }

  // 2. Full shape + semantic validation (see the block comment above the
  //    schemas): every event/node/edge field present, correctly typed, from
  //    the known type sets, with each variant's own required fields checked.
  const parsed = handoffBundleSchema.safeParse(raw);
  if (!parsed.success) {
    return { failure: { outcome: 'invalid_format', message: 'This file is not a Counterpoise hand-off bundle.', eventsAdded: 0 } };
  }
  const bundle = parsed.data as HandoffBundle;

  // Safe to read straight off `raw`: the safeParse above just confirmed it
  // conforms to handoffBundleSchema at every level, including every field
  // this relies on — see the CR6-01 comment above.
  const rawEvents = (raw as { audit_events: unknown[] }).audit_events as AuditEvent[];

  // 3. Duplicate event ids inside one bundle (F3/F4/F13/F20) — a bundle
  //    cannot be internally self-consistent if it claims the same event
  //    twice, and importTailIfContinuesWithinQueue's db.add() would only fail loudly
  //    AFTER the seal/chain checks below had already passed.
  const seenIds = new Set<string>();
  for (const e of bundle.audit_events) {
    if (seenIds.has(e.event_id)) {
      return {
        failure: {
          outcome: 'invalid_format',
          message: `This bundle has more than one event with the id "${e.event_id}" and cannot be imported.`,
          eventsAdded: 0,
        },
      };
    }
    seenIds.add(e.event_id);
  }

  // 4. Tamper in transit: recompute the seal over the bundle's own contents.
  //    CR6-01: rawEvents, not bundle.audit_events — see the comment above.
  const expectedSeal = await computeSeal(bundle.register, rawEvents);
  if (expectedSeal !== bundle.seal) {
    return {
      failure: {
        outcome: 'tampered',
        message: 'This bundle was altered after it was exported — its seal does not match its contents. Nothing was imported.',
        eventsAdded: 0,
      },
    };
  }

  // 5. Internal chain integrity of the incoming events, independent of the
  //    local store — the FULL walk (linkage + each event's content hash), so
  //    a payload edited in transit is caught here even in the case the seal
  //    (which binds only the tip) would not cover.
  //    CR6-01: rawEvents, not bundle.audit_events — see the comment above.
  const incoming = await verifyChainOf(rawEvents);
  if (!incoming.ok) {
    return {
      failure: {
        outcome: 'tampered',
        message: `The bundle's audit chain is broken at event ${incoming.brokenAtEventId} (${incoming.reason}). Nothing was imported.`,
        eventsAdded: 0,
      },
    };
  }
  return { bundle, rawEvents };
}

// round 2, N1's distinct, honest outcome for "the audit trail was replaced,
// but the register step then failed" — returned by BOTH replaceWithBundle
// and finishRegisterReplace, worded so the two can never contradict each
// other the way a caught-and-rethrown message with a fixed sentence
// appended to it could (the exact N1 bug: "your audit trail was replaced"
// and "your register was not changed" about the same call).
function partiallyReplacedResult(auditEventCount: number, err: unknown): ImportResult {
  return {
    outcome: 'partially_replaced',
    // round 3, R3-1: the old closing sentence ("...or reload to see the
    // latest audit trail") was a dead end dressed as a neutral option —
    // reloading loses the only record that the register still needs
    // finishing (RegisterView's own React state) and left no UI path back
    // to finishRegisterReplace. Now true either way: leaving the page is
    // recoverable, because re-importing the same file is offered a finish
    // step (register_needs_finishing, the up_to_date branch below).
    message: `Your audit trail was replaced with this bundle's (${auditEventCount} events) — that part is done and cannot be undone. The register view could not be updated to match: ${
      err instanceof Error ? err.message : String(err)
    }. Use "Finish updating the register" to try again. If you leave this page before finishing, import the same file again and you'll be offered the finish step.`,
    eventsAdded: auditEventCount,
  };
}

// round 3, R3-1. Deterministic, field-precise comparison between the local
// register and a bundle's register: the same node/edge SETS (by id) and, for
// every id present on both sides, the exact fields the bundle carries.
// Reuses canonicalJson — the same serialisation the seal itself hashes — over
// each side sorted by id first (the same sort sealInput uses), so storage
// order never matters and "matches" means byte-identical content, never
// merely the same ids.
function registersMatch(
  local: { nodes: readonly RegisterNode[]; edges: readonly RegisterEdge[] },
  bundleRegister: { nodes: readonly RegisterNode[]; edges: readonly RegisterEdge[] },
): boolean {
  const sortedNodes = (ns: readonly RegisterNode[]) => [...ns].sort((a, b) => a.node_id.localeCompare(b.node_id));
  const sortedEdges = (es: readonly RegisterEdge[]) => [...es].sort((a, b) => a.edge_id.localeCompare(b.edge_id));
  return (
    canonicalJson(sortedNodes(local.nodes)) === canonicalJson(sortedNodes(bundleRegister.nodes)) &&
    canonicalJson(sortedEdges(local.edges)) === canonicalJson(sortedEdges(bundleRegister.edges))
  );
}

// round 3, R3-1. The honest wording for register_needs_finishing: the audit
// trail (source of truth) genuinely has nothing left to absorb from this
// bundle — this is NOT a tampered or stale bundle — but the register (a
// derived view) never caught up, almost always because an earlier replace
// reached partially_replaced and the finish step was never completed before
// this component's state was lost.
const REGISTER_NEEDS_FINISHING_MESSAGE =
  'Your audit trail already matches this bundle\'s — there\'s nothing new to import there. Your register hasn\'t caught up to it yet, most likely because an earlier replace was interrupted before the register step finished. Use "Finish updating the register" to bring it up to date.';

const REPLACED_MESSAGE = (auditEventCount: number) =>
  `Your register was replaced with this bundle (${auditEventCount} events). Your previous register is in the backup file you saved.`;

// The explicit, user-confirmed way out of 'diverged'. Found by a live dry run
// (2026-09-27): every browser seeds its own demo cases on first load, so a
// reviewer's register is never empty and never a prefix of the submitter's —
// plain import refused EVERY real two-machine hand-off. Replacing is honest
// only because the caller (a) asks the user and (b) hands them a backup of
// the register being discarded first (RegisterView's two-step confirmation,
// code-review-005 F1). Same seal + chain checks as import.
//
// code-review-005 F6: the audit trail (source of truth) is replaced BEFORE
// the register (a derived view) — a mid-way failure then leaves the source
// of truth already correct and only the presentation layer stale, never the
// reverse (a register showing a stage/verdict its own trail cannot justify).
// F16: the audit replace is an atomic "read what's discarded, then discard
// it" step. Round 2 (N1/N2/N3) restructures the REST of this function:
//
// - N3: the whole operation — the audit replace AND the register replace —
//   now runs inside ONE withAuditQueue() turn (audit outer, register inner,
//   this codebase's one fixed nesting order — see audit.ts's withAuditQueue
//   doc). Previously these were two separate top-level calls with a gap
//   between them a concurrent updateLifecycleStage() could land in, leaving
//   the (already-replaced) audit trail recording an approval the
//   (not-yet-replaced, or already-replaced-and-now-stale) register did not
//   agree with. Holding the queue across both steps means no other
//   audit-outer/register-inner operation can interleave.
// - N2: `expectedBackupTip`, when given, is checked ATOMICALLY with the
//   audit replace (inside backupAndReplaceAllRawEventsWithinQueue) against
//   the CURRENT local tip — refusing as 'backup_out_of_date' if anything
//   local changed since the caller's backup was actually built.
// - N1: a register-step failure AFTER the audit trail was replaced is a
//   distinct, honest, RETURNED outcome ('partially_replaced'), never a
//   thrown error with a fixed "nothing changed" sentence appended to it.
export async function replaceWithBundle(raw: unknown, expectedBackupTip?: AuditTip): Promise<ImportResult> {
  const v = await validateBundle(raw);
  if ('failure' in v) return v.failure;
  const { bundle, rawEvents } = v;

  return withAuditQueue(async () => {
    // CR6-01: rawEvents (as the input wrote them), not bundle.audit_events
    // (zod-reparsed, schema key order) — what gets stored must stay the
    // order it was hashed in. See validateBundle's comment above.
    const auditResult = await backupAndReplaceAllRawEventsWithinQueue(rawEvents, expectedBackupTip);
    if (auditResult.kind === 'backup_out_of_date') {
      return {
        outcome: 'backup_out_of_date',
        message:
          'Your register changed after you saved the backup, so nothing was replaced. Save a new backup of yours, then replace.',
        eventsAdded: 0,
      };
    }
    // auditResult.kind === 'replaced' — the audit trail (source of truth) now
    // holds the bundle's events. From here, ONLY the register step remains.

    try {
      await backupAndReplaceRegister(bundle.register.nodes, bundle.register.edges);
    } catch (err) {
      // The audit trail is already replaced and cannot be un-replaced from
      // here; recordSyncedTip reflects that the audit side DID sync, even
      // though the register did not yet follow.
      recordSyncedTip(bundle.audit_events.at(-1)?.hash ?? null);
      return partiallyReplacedResult(bundle.audit_events.length, err);
    }

    recordSyncedTip(bundle.audit_events.at(-1)?.hash ?? null);
    return { outcome: 'replaced', message: REPLACED_MESSAGE(bundle.audit_events.length), eventsAdded: bundle.audit_events.length };
  });
}

// round 2, N1. The way out of 'partially_replaced': re-applies the SAME
// bundle's register only, and only after re-confirming (atomically, inside
// the same withAuditQueue() turn) that the local audit tip still equals the
// bundle's tip — i.e. nothing else has touched the audit trail since the
// replace that got the audit side this far. If it has (another partial
// replace, an import, or — were it not for this same fixed lock order — a
// concurrent approval), finishing now would install a register that no
// longer matches what the audit trail actually says, so this refuses
// ('finish_out_of_date') rather than finish blind.
export async function finishRegisterReplace(raw: unknown): Promise<ImportResult> {
  const v = await validateBundle(raw);
  if ('failure' in v) return v.failure;
  const { bundle } = v;
  const bundleTip: AuditTip = { hash: bundle.audit_events.at(-1)?.hash ?? null, count: bundle.audit_events.length };

  return withAuditQueue(async () => {
    const localTip = await currentTipWithinQueue();
    if (localTip.hash !== bundleTip.hash || localTip.count !== bundleTip.count) {
      return {
        outcome: 'finish_out_of_date',
        message:
          "Your audit trail has changed since it was replaced, so the register can't be safely finished from here. Reload the page to see the current state.",
        eventsAdded: 0,
      };
    }

    try {
      await backupAndReplaceRegister(bundle.register.nodes, bundle.register.edges);
    } catch (err) {
      return partiallyReplacedResult(bundle.audit_events.length, err);
    }

    recordSyncedTip(bundleTip.hash);
    return { outcome: 'replaced', message: REPLACED_MESSAGE(bundle.audit_events.length), eventsAdded: bundle.audit_events.length };
  });
}

export async function importBundle(raw: unknown): Promise<ImportResult> {
  const v = await validateBundle(raw);
  if ('failure' in v) return v.failure;
  const { bundle, rawEvents } = v;

  // code-review-005 F5, restructured round 2 (N3): read-the-local-chain,
  // check-the-prefix, and write-the-tail happen as one unbroken step
  // (importTailIfContinuesWithinQueue), and the WHOLE operation — that step
  // AND the nested register merge below — now runs inside one
  // withAuditQueue() turn, the same audit-outer/register-inner nesting
  // replaceWithBundle uses, so a concurrent updateLifecycleStage() cannot
  // land between this function's audit step and its register step either.
  return withAuditQueue(async () => {
    // CR6-01: rawEvents (as the input wrote them), not bundle.audit_events
    // (zod-reparsed, schema key order) — what gets stored must stay the
    // order it was hashed in. See validateBundle's comment above.
    const tailResult = await importTailIfContinuesWithinQueue(rawEvents);

    if (tailResult.kind === 'diverged') {
      return {
        outcome: 'diverged',
        message: hasSyncedBefore() ? REPEAT_DIVERGED_MESSAGE : FIRST_TIME_DIVERGED_MESSAGE,
        eventsAdded: 0,
      };
    }
    if (tailResult.kind === 'local_ahead') {
      recordSyncedTip(bundle.audit_events.at(-1)?.hash ?? null);
      return { outcome: 'local_ahead', message: 'Your copy already contains everything in this bundle and more. Nothing to import.', eventsAdded: 0 };
    }
    if (tailResult.kind === 'up_to_date') {
      recordSyncedTip(bundle.audit_events.at(-1)?.hash ?? null);
      // round 3, R3-1: the audit trail matching is not the whole story — a
      // replace that reached partially_replaced leaves the audit trail
      // looking EXACTLY like this (local already equals the bundle) while
      // the register never followed. This is the one path that can detect
      // that honestly, whether the partial replace happened in this same
      // session or was lost entirely (a view switch, a reload) before it
      // could be finished.
      const localRegister = await exportAll();
      if (!registersMatch(localRegister, bundle.register)) {
        return { outcome: 'register_needs_finishing', message: REGISTER_NEEDS_FINISHING_MESSAGE, eventsAdded: 0 };
      }
      return { outcome: 'up_to_date', message: 'Your copy is already up to date with this bundle. Nothing to import.', eventsAdded: 0 };
    }

    // tailResult.kind === 'imported'. When the tail IS the whole bundle, the
    // local chain was empty beforehand — imported_into_empty; otherwise it is
    // a genuine merge of the new tail onto an existing chain.
    const outcome: ImportOutcome = tailResult.added === bundle.audit_events.length ? 'imported_into_empty' : 'merged';

    // code-review-005 F6: register (derived view) written AFTER the audit
    // trail (source of truth, already updated by
    // importTailIfContinuesWithinQueue above) — a failure here leaves the
    // trail correct and only the register stale, which RegisterView
    // surfaces rather than swallows. Unlike replaceWithBundle (N1), this
    // path still throws: no pre-existing self-contradiction bug was found
    // on the merge path (RegisterView's import handler never appends a
    // fixed sentence to a caught error), so round 2 leaves its wording
    // unchanged and fixes only the lock ordering (N3) around it.
    try {
      await importRegister(bundle.register.nodes, bundle.register.edges);
    } catch (err) {
      throw new Error(
        `The audit trail was updated (${tailResult.added} event${tailResult.added === 1 ? '' : 's'}), but the register view could not be refreshed: ${
          err instanceof Error ? err.message : String(err)
        }. Reload to see the latest state.`,
      );
    }

    recordSyncedTip(bundle.audit_events.at(-1)?.hash ?? null);

    return outcome === 'imported_into_empty'
      ? { outcome, message: `Imported ${tailResult.added} events into an empty register.`, eventsAdded: tailResult.added }
      : { outcome, message: `Merged ${tailResult.added} new event${tailResult.added === 1 ? '' : 's'} from this bundle.`, eventsAdded: tailResult.added };
  });
}
