import { load } from 'js-yaml';
import { z } from 'zod';
import { validateConditionFieldValue } from './policy';
import type { JurisdictionPack } from '../engine/types';

// V2-A. Rule 3 (cross-cutting.md §7): persistence-only. Pack loader per
// policy-schema.md §4: a rule missing ANY required field rejects the
// WHOLE pack, with an error naming the pack and the missing field
// (CF-5/RA-7 — a partially-valid regulatory pack is worse than none).

const PackRuleEffectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tier_floor'), minimum_tier: z.enum(['Critical', 'High', 'Medium', 'Low']) }),
  z.object({ type: z.literal('required_control'), control_id: z.string().min(1) }),
  // R16-A1 (CF-6 §1.2): optional plain-language fields, same shape as a
  // firm downstream_reviews rule's — the check and the team that runs it.
  // Absent falls back to `review` + the formal wording (chunk D1 renders
  // the fallback).
  z.object({
    type: z.literal('required_review'),
    review: z.string().min(1),
    plain_name: z.string().optional(),
    plain_owner: z.string().optional(),
  }),
  // R16-D2 §2 (DR7-20). Same optional pair as a firm hard line's (HardLineSchema,
  // policy.ts) — why the answer is no, and what would change it, in the
  // submitter's own words. Absent falls back to `reason` + the §4.4
  // pointer line (the "No" screen's view-model renders the fallback).
  z.object({
    type: z.literal('hard_line'),
    reason: z.string().min(1),
    plain_reason: z.string().optional(),
    plain_change: z.string().optional(),
  }),
]);

const PackRuleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  source: z.object({
    document: z.string().min(1),
    section: z.string().min(1),
    text: z.string().min(1),
    // V2-F: optional so pre-V2-F packs still load, but every rule a human
    // is expected to sign should carry one.
    source_url: z.string().min(1).optional(),
    retrieved_date: z.string().min(1).optional(),
  }),
  effect: PackRuleEffectSchema,
  condition: z.record(z.string(), z.unknown()),
  // V2-E: `basis` replaces the subjective High/Medium/Low confidence
  // score. Rule-level sign-off is now OPTIONAL — the pack header is the
  // unit of adoption; these fields only carry a firm's local deviation.
  basis: z.enum(['verbatim', 'derived', 'judgement']),
  reviewer_name: z.string().min(1).optional(),
  reviewer_role: z.string().min(1).optional(),
  sign_off_date: z.string().min(1).optional(),
});

const PackSchema = z.object({
  pack_id: z.string().min(1),
  version: z.string().min(1),
  jurisdiction: z.string().min(1),
  regulator: z.string().min(1),
  document: z.string().min(1),
  effective_date: z.string().min(1),
  reviewer_name: z.string().min(1),
  reviewer_role: z.string().min(1),
  sign_off_date: z.string().min(1),
  rules: z.array(PackRuleSchema).min(1),
  // R12-ST (ADR-PS-R12-1): pack-level freshness header, distinct from the
  // existing per-rule source.retrieved_date above. Optional so every pre-
  // R12 pack still loads unchanged.
  retrieved_date: z.string().min(1).optional(),
  max_staleness_days: z.number().optional(),
});

export interface PackLoadError {
  file: string;
  packId?: string;
  /** Set when the first schema problem is inside a rule and its id could be read. */
  ruleId?: string;
  reason: string;
}

export interface PackLoadResult {
  packs: JurisdictionPack[];
  errors: PackLoadError[];
}

export function loadPacks(sources: Record<string, string>): PackLoadResult {
  const packs: JurisdictionPack[] = [];
  const errors: PackLoadError[] = [];

  for (const file of Object.keys(sources).sort()) {
    let parsed: unknown;
    try {
      parsed = load(sources[file] ?? '');
    } catch (err) {
      errors.push({ file, reason: `YAML parse error: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }
    const packId =
      typeof parsed === 'object' && parsed !== null && typeof (parsed as Record<string, unknown>).pack_id === 'string'
        ? ((parsed as Record<string, unknown>).pack_id as string)
        : undefined;

    const result = PackSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue?.path ?? [];
      // D-1a: when the problem is inside rules.<n>, name that rule's id (read
      // defensively from the raw document — it may itself be the broken part).
      let ruleId: string | undefined;
      if (path[0] === 'rules' && typeof path[1] === 'number') {
        const rules = (parsed as { rules?: unknown } | null)?.rules;
        const rule = Array.isArray(rules) ? (rules[path[1]] as { id?: unknown } | undefined) : undefined;
        if (rule && typeof rule.id === 'string' && rule.id.length > 0) ruleId = rule.id;
      }
      const where = `pack ${packId ?? file}${ruleId ? ` rule ${ruleId}` : ''}`;
      errors.push({
        file,
        ...(packId ? { packId } : {}),
        ...(ruleId ? { ruleId } : {}),
        reason: `${where} rejected: missing/invalid field "${path.join('.') || '(root)'}" — ${issue?.message ?? 'schema error'}`,
      });
      continue;
    }

    // Review fix (pass 1): rule conditions get the SAME operator +
    // canonical-vocabulary validation as the main policy. A rule whose
    // condition can never fire is a silent regulatory hole — reject the
    // whole pack, naming pack + rule + field.
    //
    // Documented residual (pass 2): field-NAME typos still pass silently —
    // unknown field names are tolerated by design (forward-compat for
    // future non-graph condition keys like track/tier), so `decison_type`
    // would load and never fire. Closing this fully needs a known-field
    // allowlist with an escape hatch; pack authors should eyeball field
    // names against canonical-vocabulary.ts during authoring.
    const pack = result.data as JurisdictionPack;
    const conditionErrors: string[] = [];
    for (const rule of pack.rules) {
      for (const [field, value] of Object.entries(rule.condition)) {
        for (const err of validateConditionFieldValue(field, value)) {
          conditionErrors.push(`rule ${rule.id} condition "${field}": ${err.reason}`);
        }
      }
    }
    if (conditionErrors.length > 0) {
      errors.push({
        file,
        packId: pack.pack_id,
        reason: `pack ${pack.pack_id} rejected: ${conditionErrors[0]}`,
      });
      continue;
    }
    packs.push(pack);
  }

  // Determinism: stable order regardless of source-map iteration order.
  packs.sort((a, b) => a.pack_id.localeCompare(b.pack_id));
  return { packs, errors };
}
