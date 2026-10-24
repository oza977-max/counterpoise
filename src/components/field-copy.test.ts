import { describe, it, expect } from 'vitest';
import { systemAccessScopeLabel, SYSTEM_ACCESS_LABELS, plainWithCode } from './field-copy';

// R16-A1 (PE-9 §1.1): system_access_scope widened to accept a list. Every
// renderer that displays the field must handle a list without crashing —
// this is the shared helper graph-summary.ts uses.
describe('systemAccessScopeLabel', () => {
  it('TC-R16-A1-21: a single value renders exactly as plainWithCode(SYSTEM_ACCESS_LABELS[value]) did before this change', () => {
    expect(systemAccessScopeLabel('shared_infrastructure')).toBe(
      plainWithCode(SYSTEM_ACCESS_LABELS.shared_infrastructure),
    );
  });

  it('TC-R16-A1-22: a list of values renders every value, joined, without crashing', () => {
    const label = systemAccessScopeLabel(['shared_infrastructure', 'credentialed_systems']);
    expect(label).toContain(plainWithCode(SYSTEM_ACCESS_LABELS.shared_infrastructure));
    expect(label).toContain(plainWithCode(SYSTEM_ACCESS_LABELS.credentialed_systems));
  });

  it('TC-R16-A1-23: a one-element list renders the same as the bare value it contains', () => {
    expect(systemAccessScopeLabel(['none'])).toBe(systemAccessScopeLabel('none'));
  });
});
