import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PolicyEditor from '../PolicyEditor';

// A rulebook file that fails to load must say WHERE it is broken, in full —
// pack, rule id and field path — as visible text, not cut short.
const BROKEN_UK_PACK = `
pack_id: "BROKEN-UK-PACK"
version: "1.0"
jurisdiction: "UK"
regulator: "PRA"
document: "Doc"
effective_date: "2026-01-01"
reviewer_name: "X"
reviewer_role: "Y"
sign_off_date: "2026-01-01"
rules:
  - id: "BROKEN-RULE-7"
    title: "Missing source text"
    source:
      document: "Doc"
      section: "S1"
    effect:
      type: "required_review"
      review: "R"
    condition: {}
    basis: "verbatim"
    reviewer_name: "X"
    reviewer_role: "Y"
    sign_off_date: "2026-01-01"
`;

vi.mock('../../store/pack-source', async (importActual) => {
  const actual = await importActual<typeof import('../../store/pack-source')>();
  return {
    ...actual,
    getPackSources: () => {
      const out: Record<string, string> = { ...actual.getPackSources() };
      for (const k of Object.keys(out)) if (k.endsWith('ss1-23.yaml')) out[k] = BROKEN_UK_PACK;
      return out;
    },
  };
});

describe('PolicyEditor — a broken rulebook file explains itself in full', () => {
  it('TC-CF-5-02j: the load error shows the pack, the rule id and the field path as visible text', () => {
    render(<PolicyEditor />);
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    const detail = document.querySelector('.policy-view__pack-state-detail');
    expect(detail).not.toBeNull();
    expect(detail!.textContent).toContain('BROKEN-UK-PACK');
    expect(detail!.textContent).toContain('BROKEN-RULE-7');
    expect(detail!.textContent).toMatch(/rules\.0\.source\.text/);
  });
});
