import { load } from 'js-yaml';
import { z } from 'zod';
import { CANONICAL_VOCABULARY } from '../engine/canonical-vocabulary';
import { getUseCases, hasPendingPolicyUpdate } from './register';
import { append } from './audit';
import { withCaseLock } from './db';
import type { LifecycleStage } from './types';
import type {
  HardLine,
  Invariant,
  PolicyFile,
  PolicyValidationError,
  PolicyValidationResult,
  Tier,
  TierRule,
  TrackRule,
} from '../engine/types';

// Rule 3 (cross-cutting.md §7): persistence-only — no React, no LLM imports.
// Real YAML + Zod validation loader (policy-schema.md §3-6), replacing the
// P1-C01 hardcoded stub.

// --- Zod schema: single source of truth for both runtime validation and the
// TypeScript type (Vanderkam — Effective TypeScript). Mirrors the PolicyFile
// interface in src/engine/types.ts.

const ConditionValueSchema: z.ZodType<unknown> = z.union([
  z.object({ gte: z.number() }).strict(),
  z.object({ lte: z.number() }).strict(),
  z.object({ in: z.array(z.unknown()) }).strict(),
  z.object({ not_in: z.array(z.unknown()) }).strict(),
  z.string(),
  z.number(),
  z.boolean(),
]);

const ConditionRecordSchema = z.record(z.string(), z.unknown());

const HardLineSchema = z.object({
  id: z.string(),
  description: z.string(),
  condition: ConditionRecordSchema,
  reason: z.string(),
  regulatory_basis: z.string(),
  // R16-A1 (CF-6 §1.2): optional plain-language text (VD-10). Absent falls
  // back to `reason` + the formal wording (chunk D1 renders the fallback).
  plain_reason: z.string().optional(),
  plain_change: z.string().optional(),
});

const TrackConditionSchema = z.object({
  field: z.string(),
  value: ConditionValueSchema,
});

const TrackRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  conditions: z.array(TrackConditionSchema),
  short_circuit: z.boolean(),
  regulatory_basis: z.string(),
});

const TierTriggerSchema = z.object({
  field: z.string(),
  value: ConditionValueSchema,
  regulatory_basis: z.string().optional(),
});

const TierRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  triggers: z.array(TierTriggerSchema),
});

const InvariantSchema = z.object({
  id: z.string(),
  description: z.string(),
  condition: ConditionRecordSchema,
  required_controls: z.array(z.string()),
  severity: z.string(),
  // V1.1-C01: optional citation, surfaced in the verdict explanation.
  regulatory_basis: z.string().optional(),
  // R16-A1 (CF-6 §1.2): optional plain-language reason, written from the
  // condition — may use the {audience}/{destination} placeholders (chunk D1
  // resolves them). Absent falls back to `description`.
  plain_reason: z.string().optional(),
});

// R10-CE (ADR-VA-R10-3): one axis of control effectiveness.
const EffectivenessAxisSchema = z.object({
  status: z.enum(['effective', 'deficient', 'not_assessed']),
  detail: z.string().optional(),
});

const ControlSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  resolves: z.array(z.string()),
  burden: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  verification: z.string(),
  // V1.3: proof-carrying controls — optional, absent = unverified.
  verification_evidence: z
    .object({
      status: z.enum(['verified', 'unverified']),
      detail: z.string().optional(),
      attested_by: z.string().optional(),
      attested_at: z.string().optional(),
      // R10-CE: optional design/operating effectiveness axes (COSO
      // vocabulary). Backward compatible — absent axes = legacy evidence.
      design: EffectivenessAxisSchema.optional(),
      operating: EffectivenessAxisSchema.optional(),
      // W-7 (R16-W §5, D-77): scopes "verified" to the platforms/vendors
      // the evidence actually covers. At least one list must be non-empty
      // when present — an applies_to with both lists empty would silently
      // scope the evidence to nothing, which is never what a policy author
      // means by writing it.
      applies_to: z
        .object({
          platforms: z.array(z.string().min(1)).optional(),
          vendors: z.array(z.string().min(1)).optional(),
        })
        .refine((v) => (v.platforms?.length ?? 0) > 0 || (v.vendors?.length ?? 0) > 0, {
          message: 'verification_evidence.applies_to must list at least one platform or vendor id',
        })
        .optional(),
    })
    .optional(),
  // R16-A1 (CF-6 §1.2): optional plain-language fields (VD-9). All absent
  // falls back to the formal name/description + `@`-token-free owner text
  // (chunk D1 renders the fallback); this schema only makes them exist.
  plain_action: z.string().optional(),
  plain_owner: z.string().optional(),
  plain_owner_with: z.string().optional(),
  // Review base ids this control's own action also satisfies — a firm
  // review id, a pack review rule id, or the sentinels PV-UNREGISTERED /
  // MODEL-REGISTRY. checkPolicyReferences (src/store/policy-references.ts)
  // checks each entry refers to something real; it is a referential check
  // only (grounding/PACK-AUTHORING.md's reviewer checklist covers whether
  // the control truly covers the review).
  covers_reviews: z.array(z.string().min(1)).optional(),
});

const JurisdictionEntrySchema = z.object({
  code: z.string(),
  name: z.string(),
  pack_files: z.array(z.string()),
});

const RoleConfigSchema = z.object({ access: z.string() });

const TranslationAttestationSchema = z.object({
  attested_by: z.string(),
  role: z.string(),
  date: z.string(),
  raf_version_checked: z.string(),
});

// PV-1/PV-2: approved platform and vendor registries. Optional — a policy
// without them loads exactly as before, which is what keeps the 227-test
// suite and the published demo working.
const EnvelopeSchema = z.object({
  max_data_class: z.enum(['Public', 'Internal', 'Confidential', 'Client PII', 'MNPI']).optional(),
  max_exposure: z.enum(['internal-only', 'internal-shared', 'client-facing', 'market-facing']).optional(),
  max_autonomy_level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  data_zones: z.array(z.enum(['Zone A', 'Zone B', 'Zone C'])).optional(),
  jurisdictions: z.array(z.string().min(1)).optional(),
});

const RegistryEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  approved_envelope: EnvelopeSchema,
  satisfies_controls: z.array(z.string().min(1)),
  coupled_clusters: z.array(z.array(z.string().min(1))).optional(),
  // R16-A1 (CF-6 §1.2). Shared by both `platforms` and `vendors` entries —
  // see the RegistryEntry interface comment in src/engine/types.ts for why
  // `vendor_id` and `kind` are declared here even though each means
  // something on only one of the two registries. All optional; existing
  // registries load unchanged. `checkPolicyReferences` warns (never
  // blocks) on a platform/vendor with no `plain_name`.
  plain_name: z.string().min(1).optional(),
  vendor_id: z.string().min(1).optional(),
  // Default 'supplier' when absent — applied by the view-model that renders
  // it (chunk D1), not by this loader.
  kind: z.enum(['company_assistant', 'supplier']).optional(),
});

// R11-MG-1 (policy-schema.md §10a, ADR-PS-R11-1). Unknown provenance_class
// values are rejected by the enum — no unlisted class silently passes.
const ApprovedModelSchema = z.object({
  model_id: z.string().min(1),
  // CR6-19: optional plain-language name (see ApprovedModel.plain_name).
  plain_name: z.string().min(1).optional(),
  vendor: z.string().min(1),
  provenance_class: z.enum(['vendor_hosted', 'open_weights_self_hosted', 'fine_tuned_in_house']),
  is_approved: z.boolean(),
  license_note: z.string().optional(),
  benchmark_evidence: z
    .object({
      suite: z.string().min(1),
      date: z.string(),
      finance_domain: z.boolean(),
      detail: z.string().optional(),
    })
    .optional(),
  // R11-MG-1a (policy-schema.md §10a, ADR-PS-R11-1a): family-fallback
  // approval fields. Optional so every pre-R11-MG-1a policy stays valid.
  is_family: z.boolean().optional(),
  version_pattern: z.string().optional(),
  // R12-MG (ADR-PS-R12-1): meaningful for family entries — see
  // ApprovedModel.reattest_by in src/engine/types.ts.
  reattest_by: z.string().optional(),
});

const PolicyFileSchema = z.object({
  platforms: z.array(RegistryEntrySchema).optional(),
  vendors: z.array(RegistryEntrySchema).optional(),
  // R11-MG-1: optional so every pre-R11 policy still loads unchanged.
  approved_models: z.array(ApprovedModelSchema).optional(),
  version: z.string(),
  policy_id: z.string(),
  firm_name: z.string(),
  translation_attestation: TranslationAttestationSchema,
  hard_lines: z.array(HardLineSchema),
  tracks: z.array(TrackRuleSchema),
  tiers: z.array(TierRuleSchema),
  invariants: z.array(InvariantSchema),
  // CS-3: optional, so every existing policy file stays valid. A firm with no
  // configured downstream processes has none — which is a different thing
  // from the mechanism not existing, and that was the defect.
  downstream_reviews: z
    .array(
      z.object({
        id: z.string().min(1),
        review: z.string().min(1),
        condition: ConditionRecordSchema,
        regulatory_basis: z.string().optional(),
        // R16-A1 (CF-6 §1.2): the check and the team that runs it, in plain
        // words. Both optional; absent falls back to `review` + the formal
        // wording (chunk D1 renders the fallback).
        plain_name: z.string().optional(),
        plain_owner: z.string().optional(),
      }),
    )
    .optional(),
  controls: z.array(ControlSchema),
  kri_thresholds: z.record(z.string(), z.record(z.string(), z.unknown())),
  jurisdictions: z.array(JurisdictionEntrySchema),
  roles: z.record(z.string(), RoleConfigSchema),
  tier_workflow: z.record(z.string(), z.string()),
  safety_margin: z.number(),
  // Oracle round 002: the binding-constraint tie-break was engine-only, so a
  // comment about code was standing in for a rule of the appetite. Optional so
  // a firm's existing policy stays valid; evaluate() falls back to the same
  // order when it is absent.
  binding_constraint_order: z.array(z.enum(['severity', 'control_burden', 'id'])).optional(),
  // R12-AB (ADR-VA-R12-1): see PolicyFile.sampling_rate in
  // src/engine/types.ts. Optional, 1-in-K semantics.
  sampling_rate: z.number().optional(),
  // explore-007 D-002 (round 8): see PolicyFile.governance_mapping in
  // src/engine/types.ts. Optional — a policy without it renders Counterpoise's
  // generic Track description only, exactly as before this field existed.
  governance_mapping: z
    .record(
      z.enum(['I', 'II', 'III']),
      z.object({
        committee: z.string().min(1),
        note: z.string().optional(),
      }),
    )
    .optional(),
});

// --- ADR-002 (policy-schema.md §8): only these operator keys are valid inside
// a condition-value object. Bare equality (string/number/boolean) is separate.
const ALLOWED_CONDITION_OPERATORS = new Set(['gte', 'lte', 'in', 'not_in']);

// Canonical vocabulary (policy-schema.md §3.0) — imported from
// src/engine/canonical-vocabulary.ts, the single runtime source of truth
// used to validate condition values. Only fields whose values are
// drawn from a closed enum are checked; unrecognised fields pass through
// (forward compatibility — Kleppmann Ch. 4).

const REQUIRED_TIERS: Tier[] = ['Critical', 'High', 'Medium', 'Low'];

function operatorErrors(field: string, value: unknown): PolicyValidationError[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const keys = Object.keys(value as Record<string, unknown>);
  const invalidKeys = keys.filter((k) => !ALLOWED_CONDITION_OPERATORS.has(k));
  if (invalidKeys.length === 0) {
    return [];
  }
  return invalidKeys.map((k) => ({
    kind: 'policy-invalid' as const,
    field,
    reason: `condition operator "${k}" is not one of gte, lte, in, not_in`,
  }));
}

// R16-A1 (PE-9 §1.1): fields whose graph value may be a LIST (today, only
// system_access_scope — condition.ts's collectFieldValues expands an array
// into one candidate per element). Any OTHER operator is meaningless on
// such a field (there is no well-defined "greater than" or "excludes a
// list" over a set of ticked values), so only `in` is permitted. Declared
// here, next to CANONICAL_VOCABULARY, for the same reason that lives beside
// it: one place a reader checks to see every special-cased field name.
// Exported for src/store/policy-references.ts: checkPolicyReferences() does
// its own defense-in-depth sweep over every condition in the policy AND the
// packs passed to it (including policy.downstream_reviews[], which this
// file's own runSemanticChecks does not walk — see that function's
// docstring), so it needs the same field set and the same in-only
// predicate used here.
export const LIST_VALUED_FIELDS = new Set<string>(['system_access_scope']);

export function isInOnlyCondition(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length === 1 && keys[0] === 'in';
}

function listValuedFieldErrors(field: string, value: unknown): PolicyValidationError[] {
  if (!LIST_VALUED_FIELDS.has(field) || isInOnlyCondition(value)) return [];
  return [
    {
      kind: 'policy-invalid',
      field,
      reason: `"${field}" is a list-valued field and supports only the "in" operator — bare equality, gte, lte and not_in are not well-defined over a set of ticked values`,
    },
  ];
}

function vocabularyErrors(field: string, value: unknown): PolicyValidationError[] {
  const allowed = CANONICAL_VOCABULARY[field];
  if (!allowed) return [];

  const errors: PolicyValidationError[] = [];
  const checkValue = (v: unknown) => {
    if (typeof v === 'string' && !allowed.includes(v)) {
      errors.push({
        kind: 'policy-invalid',
        field,
        reason: `condition value "${v}" is not in canonical vocabulary for ${field}`,
      });
    }
  };

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.in)) obj.in.forEach(checkValue);
    if (Array.isArray(obj.not_in)) obj.not_in.forEach(checkValue);
  } else {
    checkValue(value);
  }
  return errors;
}

// Exported for src/store/packs.ts (V2-A review fix): pack rule conditions
// must pass the same operator + canonical-vocabulary validation as the
// main policy — a typo'd field or malformed operator would otherwise
// produce a regulatory rule that silently never fires (CF-5/RA-7).
export function validateConditionFieldValue(field: string, value: unknown): PolicyValidationError[] {
  return [...operatorErrors(field, value), ...vocabularyErrors(field, value), ...listValuedFieldErrors(field, value)];
}

function validateConditionRecord(record: Record<string, unknown>): PolicyValidationError[] {
  return Object.entries(record).flatMap(([field, value]) =>
    validateConditionFieldValue(field, value),
  );
}

function validateHardLines(hardLines: HardLine[]): PolicyValidationError[] {
  return hardLines.flatMap((hl) => validateConditionRecord(hl.condition));
}

function validateTracks(tracks: TrackRule[]): PolicyValidationError[] {
  return tracks.flatMap((t) =>
    t.conditions.flatMap((c) => validateConditionFieldValue(c.field, c.value)),
  );
}

const VALID_TIER_NAMES = new Set(['Critical', 'High', 'Medium', 'Low']);

function validateTiers(tiers: TierRule[]): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];
  for (const t of tiers) {
    // assignTier() (evaluation-engine.md §3.5) keys tier identity off this
    // free-text `name` field — an unrecognized name would silently fail
    // every TIER_ORDER comparison at eval time, under-tiering the use case.
    // Fail loud here instead.
    if (!VALID_TIER_NAMES.has(t.name)) {
      errors.push({
        kind: 'policy-invalid',
        field: `tiers[${t.id}].name`,
        reason: `tier name "${t.name}" is not one of Critical, High, Medium, Low`,
      });
    }
    for (const trig of t.triggers) {
      errors.push(...validateConditionFieldValue(trig.field, trig.value));
    }
  }
  return errors;
}

function validateInvariants(invariants: Invariant[]): PolicyValidationError[] {
  return invariants.flatMap((inv) => validateConditionRecord(inv.condition));
}

// Explicit semantic checks (policy-schema.md §6) — beyond what the Zod shape
// already guarantees (e.g. non-empty arrays, tier_workflow completeness).
function runSemanticChecks(policy: PolicyFile): {
  errors: PolicyValidationError[];
  warnings: string[];
} {
  const errors: PolicyValidationError[] = [];
  const warnings: string[] = [];

  if (!policy.version || policy.version.trim().length === 0) {
    errors.push({ kind: 'policy-invalid', field: 'version', reason: 'version field missing' });
  }

  if (policy.firm_name === '[FIRM]') {
    warnings.push('firm_name is still [FIRM] placeholder');
  }

  if (!Array.isArray(policy.hard_lines)) {
    errors.push({
      kind: 'policy-invalid',
      field: 'hard_lines',
      reason: 'hard_lines section missing',
    });
  }

  if (!Array.isArray(policy.controls) || policy.controls.length === 0) {
    errors.push({
      kind: 'policy-invalid',
      field: 'controls',
      reason: 'controls section is empty — at least one control required',
    });
  }

  if (!Array.isArray(policy.tracks) || policy.tracks.length === 0) {
    errors.push({
      kind: 'policy-invalid',
      field: 'tracks',
      reason: 'tracks section has no rules',
    });
  }

  if (!Array.isArray(policy.tiers) || policy.tiers.length === 0) {
    errors.push({
      kind: 'policy-invalid',
      field: 'tiers',
      reason: 'tiers section has no rules',
    });
  }

  for (const tier of REQUIRED_TIERS) {
    if (!policy.tier_workflow || !(tier in policy.tier_workflow)) {
      errors.push({
        kind: 'policy-invalid',
        field: 'tier_workflow',
        reason: `tier_workflow missing entry for ${tier}`,
      });
    }
  }

  if (
    typeof policy.safety_margin !== 'number' ||
    policy.safety_margin < 0 ||
    policy.safety_margin > 1
  ) {
    errors.push({
      kind: 'policy-invalid',
      field: 'safety_margin',
      reason: 'safety_margin must be 0.0–1.0',
    });
  }

  errors.push(...validateHardLines(policy.hard_lines ?? []));
  errors.push(...validateTracks(policy.tracks ?? []));
  errors.push(...validateTiers(policy.tiers ?? []));
  errors.push(...validateInvariants(policy.invariants ?? []));

  return { errors, warnings };
}

export function loadPolicy(yaml: string): PolicyValidationResult {
  let parsed: unknown;
  try {
    parsed = load(yaml);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      errors: [{ kind: 'policy-invalid', field: 'yaml', reason }],
      warnings: [],
    };
  }

  const zodResult = PolicyFileSchema.safeParse(parsed);
  if (!zodResult.success) {
    const errors: PolicyValidationError[] = zodResult.error.issues.map((issue) => ({
      kind: 'policy-invalid',
      field: issue.path.join('.') || '(root)',
      reason: issue.message,
    }));
    return { valid: false, errors, warnings: [] };
  }

  const policy = zodResult.data as PolicyFile;
  const { errors, warnings } = runSemanticChecks(policy);

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // R11-MG-1 (ADR-PS-R11-1): sorted by model_id before validation completes
  // — same determinism discipline (NF-1) every other policy collection
  // already follows (evaluate.ts's sortedById()).
  if (policy.approved_models) {
    policy.approved_models = [...policy.approved_models].sort((a, b) =>
      a.model_id.localeCompare(b.model_id),
    );
  }

  return { valid: true, policy, warnings };
}

// register-lifecycle.md §8 (LC-4). Deviation from the spec's literal
// signature: imports register.ts/audit.ts directly instead of taking
// injected RegisterStore/AuditStore parameters — those interface types
// don't exist anywhere in this codebase; register.ts already imports
// audit.ts the same way (store-to-store imports are an established
// pattern here).
const ACTIVE_LIFECYCLE_STAGES: readonly LifecycleStage[] = ['approved', 'in_production', 'pre_checked'];

// P7-C03: return type widened from Promise<void> to report a queued
// count — no existing caller used the return value, so this is a
// non-breaking change. Lets PolicyEditor.tsx's Save flow report an
// honest "N use cases queued" message instead of a vague confirmation.
export async function onPolicyUpdated(newVersion: string): Promise<{ queuedCount: number; alreadyPendingCount: number }> {
  const allUseCases = await getUseCases('all');
  const active = allUseCases.filter((uc) => ACTIVE_LIFECYCLE_STAGES.includes(uc.lifecycle_stage));

  let queuedCount = 0;
  let alreadyPendingCount = 0;
  for (const uc of active) {
    // CR8-09: the check AND the append run under the per-case lock, so two
    // saves overlapping in this tab queue each case once (the first to take
    // the lock appends; the second then sees it pending). The pending check is
    // therefore made INSIDE the lock. A save now waits behind a Confirm that
    // holds the same case's lock — acceptable. Cross-tab ordering is the same
    // lock's job where the browser has navigator.locks (db.ts).
    await withCaseLock(uc.use_case_id, async () => {
      // CR7-06c: skip a case already queued and not yet re-evaluated — a
      // re_evaluation_queued event NEWER than its latest verdict (the same rule
      // the "Policy updated" banner uses). A retry after a part-way failure
      // therefore queues each case once; a save after a later verdict queues
      // again. Deliberately not keyed on the version string: a re-save of the
      // same version with edited YAML must still queue.
      // A skipped case keeps its EARLIER queued event, which names the policy
      // version of that earlier save — not newVersion. That is accurate: the
      // event records when the case was queued and under which version, and the
      // case is still waiting for its re-evaluation, which will run against the
      // current policy whichever save queued it.
      if (await hasPendingPolicyUpdate([uc.use_case_id])) {
        alreadyPendingCount += 1;
        return;
      }
      // BC-P6C02-02: lifecycle_stage is NOT changed here — only queued for
      // re-evaluation. It moves to 'pre_checked' only on a human-triggered
      // re-run or a changed verdict (§8).
      await append({
        event_id: crypto.randomUUID(),
        use_case_id: uc.use_case_id,
        event_type: 're_evaluation_queued',
        occurred_at: new Date().toISOString(),
        actor: 'system',
        payload: { type: 're_evaluation_queued', policy_version: newVersion },
      });
      queuedCount += 1;
    });
  }

  return { queuedCount, alreadyPendingCount };
}
