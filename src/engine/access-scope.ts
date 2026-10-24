import type { SystemAccessScope } from './types';

// R16-A1 (PE-9, §1.1, D-65, D-24). Rule 1 (cross-cutting.md §7): pure engine
// helper — no I/O, no clock, no randomness. This is the SINGLE
// implementation of the system_access_scope validation + canonicalisation
// rule. Every caller that accepts a tick-all answer for "what can this
// system reach by itself" (the guided form's Q13, the questionnaire's
// multi-select, and coerceAnswerValue) calls this rather than re-deriving the rule, so the
// four legal values, their canonical order and the `none`-exclusivity rule
// can never drift between call sites.
//
// Shape is preserved, not forced to always-array: a caller that hands in one
// bare value (today's single-select form, StructuredForm.tsx) gets one bare
// value back; a caller that hands in a list (the tick-all controls this
// round adds) gets a canonically-ordered, deduplicated list back. This keeps
// every existing single-value caller's output byte-identical to before this
// change, which is what buildGraphFromForm relies on.
export type NormaliseAccessScopeResult =
  | { ok: true; value: SystemAccessScope | SystemAccessScope[] }
  | { ok: false; reason: string };

// D-24: canonical order, applied whenever more than one value survives.
export const ACCESS_SCOPE_CANONICAL_ORDER: SystemAccessScope[] = [
  'none',
  'shared_infrastructure',
  'credentialed_systems',
  'deployment_authority',
];

const KNOWN_VALUES = new Set<string>(ACCESS_SCOPE_CANONICAL_ORDER);

export function normaliseAccessScope(input: unknown): NormaliseAccessScopeResult {
  const wasArray = Array.isArray(input);
  const raw: unknown[] = input === undefined || input === null ? [] : wasArray ? input : [input];

  if (raw.length === 0) {
    return { ok: false, reason: 'system_access_scope must have at least one value' };
  }

  for (const v of raw) {
    if (typeof v !== 'string' || !KNOWN_VALUES.has(v)) {
      return {
        ok: false,
        reason: `system_access_scope: "${String(v)}" is not one of none, shared_infrastructure, credentialed_systems, deployment_authority`,
      };
    }
  }

  const values = raw as string[];
  const unique = new Set(values);
  if (unique.size !== values.length) {
    return { ok: false, reason: 'system_access_scope: duplicate values are not allowed' };
  }

  if (unique.has('none') && unique.size > 1) {
    return { ok: false, reason: '"none" cannot be combined with another system_access_scope value' };
  }

  const ordered = ACCESS_SCOPE_CANONICAL_ORDER.filter((v) => unique.has(v));

  if (!wasArray) {
    return { ok: true, value: ordered[0] as SystemAccessScope };
  }
  return { ok: true, value: ordered };
}

// R16-F §4 (DR7-11). Do two system_access_scope values name the same kinds?
// Order is ignored and a bare (non-array) value counts as a one-item set, so
// a correction that re-saves the same kinds — reordered, or against a value
// stored before the tick-all editor existed — is recognised as no change.
export function sameAccessScopeSet(a: unknown, b: unknown): boolean {
  const key = (v: unknown): string =>
    (v === undefined ? [] : Array.isArray(v) ? v.map(String) : [String(v)]).sort().join(',');
  return key(a) === key(b);
}
