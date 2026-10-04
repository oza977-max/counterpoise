import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import VerdictDisplay from '../VerdictDisplay';
import type { Verdict } from '../../types/verdict';
import type { RegulatoryChainEntry } from '../../engine/types';

// GT7 D-3 (P11, NF-11): each regulation shown says what set it off, in plain
// words, and an OLD stored verdict without the field never shows an empty line.
function makeVerdict(chain: RegulatoryChainEntry[]): Verdict {
  return {
    status: 'approved_with_controls',
    tier: 'Critical',
    track: 'II',
    binding_constraint: '',
    binding_path: '',
    controls: [],
    downstream_reviews: [],
    conditions: { hypotheses: [] },
    policy_version: '1.3',
    pack_versions: { 'EU-AIACT': '0.1' },
    applied_overrides: [],
    confidence_caveats: [],
    provisional_reasons: [],
    boundary_proximity: false,
    margin_achieved: 0,
    margin_target: 0.1,
    single_covered_invariants: [],
    explanation: {
      tier_rationale: null,
      track_rationale: null,
      hard_lines_checked: 0,
      invariants_checked: 0,
      tripped_invariants: [],
      binding_reason: null,
      binding_regulatory_basis: null,
      regulatory_chain: chain,
    },
    id: 'v-ga-1',
    use_case_id: 'uc-ga-1',
    living_status: 'approved',
    living_status_updated_at: '2026-01-01T00:00:00.000Z',
    attested_by: '1LoD',
    attested_at: '2026-01-01T00:00:00.000Z',
    graph_version: 1,
    corrections: [],
  } as Verdict;
}

const ENTRY: RegulatoryChainEntry = {
  rule_id: 'EU-AIACT-TIER-01',
  document: 'EU AI Act',
  section: 'Annex III §5(b)',
  source_text: 'creditworthiness of natural persons',
  basis: 'derived',
  derived: 'Tier forced to Critical (was High) — most demanding standard applies.',
  sign_off: 'Legal — pending firm adoption',
};

describe('VerdictDisplay — what set each regulation off (GT7 D-3)', () => {
  it('TC-RA-9-01h: a chain entry with triggered_by shows "Applies because" in plain words, never the raw field or value', () => {
    render(
      <VerdictDisplay
        verdict={makeVerdict([{ ...ENTRY, triggered_by: [{ field: 'decision_type', value: 'credit-decision' }] }])}
        auditEvents={[]}
      />,
    );
    const line = screen.getByText(/Applies because/);
    expect(line.textContent).toMatch(/credit/i);
    expect(line.textContent).not.toContain('decision_type');
    expect(line.textContent).not.toContain('credit-decision');
  });

  it('TC-RA-9-01i: an unmapped field renders a generic plain sentence — no snake_case, no raw enum (NF-11)', () => {
    render(
      <VerdictDisplay
        verdict={makeVerdict([{ ...ENTRY, triggered_by: [{ field: 'some_future_field', value: 'odd-value' }] }])}
        auditEvents={[]}
      />,
    );
    const line = screen.getByText(/Applies because/);
    expect(line.textContent).toContain('one of your answers');
    expect(line.textContent).not.toMatch(/some_future_field|odd-value/);
  });

  it('TC-RA-9-01j: an OLD stored verdict (no triggered_by) or an empty one renders the entry with no "Applies because" line', () => {
    const { unmount } = render(<VerdictDisplay verdict={makeVerdict([ENTRY])} auditEvents={[]} />);
    expect(screen.getByText('EU-AIACT-TIER-01')).toBeInTheDocument();
    expect(screen.queryByText(/Applies because/)).not.toBeInTheDocument();
    unmount();
    render(<VerdictDisplay verdict={makeVerdict([{ ...ENTRY, triggered_by: [] }])} auditEvents={[]} />);
    expect(screen.getByText('EU-AIACT-TIER-01')).toBeInTheDocument();
    expect(screen.queryByText(/Applies because/)).not.toBeInTheDocument();
  });

  it('GT7-MN: a not_in entry reads as "not <excluded>", not as the other values', () => {
    render(
      <VerdictDisplay
        verdict={makeVerdict([{ ...ENTRY, triggered_by: [{ field: 'data_zone', value: 'Zone B', excluded: ['Zone A'] }] }])}
        auditEvents={[]}
      />,
    );
    const line = screen.getByText(/Applies because/);
    expect(line.textContent).toMatch(/it is not the case that .*open internet/);
    expect(line.textContent).not.toMatch(/outside supplier/);
  });
});
