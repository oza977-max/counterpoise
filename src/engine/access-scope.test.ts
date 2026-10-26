import { describe, it, expect } from 'vitest';
import { normaliseAccessScope, sameAccessScopeSet, ACCESS_SCOPE_CANONICAL_ORDER } from './access-scope';

// R16-A1 (PE-9, §1.1, D-65). normaliseAccessScope is the SINGLE
// implementation of the system_access_scope validation + canonical-order
// rule — every caller (the form's Q13, the questionnaire's
// multi-select, coerceAnswerValue)
// is expected to call this rather than re-deriving the rule.
describe('normaliseAccessScope', () => {
  it('TC-R16-A1-01: accepts a single known value and preserves its shape (bare string, not wrapped in an array)', () => {
    const r = normaliseAccessScope('shared_infrastructure');
    expect(r).toEqual({ ok: true, value: 'shared_infrastructure' });
  });

  it('TC-R16-A1-02: accepts an array, dedupes nothing needed, and returns it in canonical order', () => {
    const r = normaliseAccessScope(['deployment_authority', 'shared_infrastructure']);
    expect(r).toEqual({ ok: true, value: ['shared_infrastructure', 'deployment_authority'] });
  });

  it('TC-R16-A1-03: shuffled tick order produces the byte-identical canonical array regardless of input order', () => {
    const a = normaliseAccessScope(['deployment_authority', 'credentialed_systems', 'shared_infrastructure']);
    const b = normaliseAccessScope(['shared_infrastructure', 'deployment_authority', 'credentialed_systems']);
    const c = normaliseAccessScope(['credentialed_systems', 'shared_infrastructure', 'deployment_authority']);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a).toEqual({
      ok: true,
      value: ['shared_infrastructure', 'credentialed_systems', 'deployment_authority'],
    });
  });

  it('TC-R16-A1-04: rejects an empty array (non-empty rule)', () => {
    const r = normaliseAccessScope([]);
    expect(r.ok).toBe(false);
  });

  it('TC-R16-A1-05: rejects undefined/null as having no value', () => {
    expect(normaliseAccessScope(undefined).ok).toBe(false);
    expect(normaliseAccessScope(null).ok).toBe(false);
  });

  it('TC-R16-A1-06: rejects an unknown value, single or inside a list', () => {
    expect(normaliseAccessScope('root access to everything').ok).toBe(false);
    expect(normaliseAccessScope(['none', 'sudo']).ok).toBe(false);
  });

  it('TC-R16-A1-07: rejects duplicate values in a list', () => {
    const r = normaliseAccessScope(['shared_infrastructure', 'shared_infrastructure']);
    expect(r.ok).toBe(false);
  });

  it('TC-R16-A1-08: rejects "none" combined with another value, in either order', () => {
    expect(normaliseAccessScope(['none', 'shared_infrastructure']).ok).toBe(false);
    expect(normaliseAccessScope(['shared_infrastructure', 'none']).ok).toBe(false);
  });

  it('TC-R16-A1-09: accepts "none" alone, as a single value or a one-element list', () => {
    expect(normaliseAccessScope('none')).toEqual({ ok: true, value: 'none' });
    expect(normaliseAccessScope(['none'])).toEqual({ ok: true, value: ['none'] });
  });

  it('TC-R16-A1-10: ACCESS_SCOPE_CANONICAL_ORDER is none, shared_infrastructure, credentialed_systems, deployment_authority', () => {
    expect(ACCESS_SCOPE_CANONICAL_ORDER).toEqual([
      'none',
      'shared_infrastructure',
      'credentialed_systems',
      'deployment_authority',
    ]);
  });
});

// R16-F §4 (DR7-11). The correction handler's "is this actually a change?"
// check — moved here from IntakeFlow.tsx while verifying R16-F, so it could
// be tested at all (the editor itself can never re-save an identical set:
// every click changes it, so the check is defence in depth for other
// callers of onCorrect).
describe('sameAccessScopeSet', () => {
  it('TC-R16-F-63: treats order and a bare stored value as the same set, and different kinds as different', () => {
    expect(sameAccessScopeSet(['credentialed_systems', 'shared_infrastructure'], ['shared_infrastructure', 'credentialed_systems'])).toBe(true);
    expect(sameAccessScopeSet('shared_infrastructure', ['shared_infrastructure'])).toBe(true);
    expect(sameAccessScopeSet(undefined, [])).toBe(true);
    expect(sameAccessScopeSet(['shared_infrastructure'], ['shared_infrastructure', 'credentialed_systems'])).toBe(false);
    expect(sameAccessScopeSet('none', ['deployment_authority'])).toBe(false);
  });
});
