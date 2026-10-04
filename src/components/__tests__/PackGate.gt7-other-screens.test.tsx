import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPanel from '../SettingsPanel';
import RegisterDetail from '../RegisterDetail';
import * as packSource from '../../store/pack-source';
import { getAllForExport, append } from '../../store/audit';
import type { AuditEvent } from '../../store/types';
import type { JurisdictionPack } from '../../engine/types';
import { addNode, exportAll } from '../../store/register';
import { setRole } from '../../store/role';

// GT7 / GB pass-1 (E). A pack that fails to load must be handled the same way
// on every screen that loads packs: Settings refuses to seed, the register
// detail does not crash. EBT exception (owner-accepted): FAULT INJECTION via
// the one seam, getPackSources(); the real loader and components run.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));
vi.mock('../../store/pack-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/pack-source')>();
  return { ...actual, getPackSources: vi.fn(actual.getPackSources) };
});

const seenPacks: JurisdictionPack[][] = [];
vi.mock('../VerdictDisplay', () => ({
  default: (props: { packs?: JurisdictionPack[] }) => {
    seenPacks.push(props.packs ?? []);
    return null;
  },
}));

const REAL_SOURCES = { ...packSource.getPackSources() };

const BROKEN_PACK = `
pack_id: "BAD-PACK"
version: "1.0"
jurisdiction: "UK"
regulator: "PRA"
document: "Doc"
effective_date: "2026-01-01"
reviewer_name: "X"
reviewer_role: "Y"
sign_off_date: "2026-01-01"
rules:
  - id: "BAD-1"
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


function breakAPack() {
  vi.mocked(packSource.getPackSources).mockReturnValue({ ...REAL_SOURCES, 'zz-broken.yaml': BROKEN_PACK });
}

describe('GT7 pass-1 E — other pack loaders agree with the gate', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setRole('1LoD');
  });
  afterEach(() => {
    cleanup();
    vi.mocked(packSource.getPackSources).mockReturnValue(REAL_SOURCES);
  });

  it('TC-CF-5-02g: Settings refuses both seed actions on a broken pack and writes nothing', async () => {
    breakAPack();
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await user.click(screen.getByText(/demo data/i));
    await user.click(screen.getByRole('button', { name: /load sample use cases/i }));
    expect(await screen.findByText(/a regulatory rules file failed to load/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /reload investment-bank portfolio/i }));
    expect(await screen.findByText(/cannot load the portfolio.*failed to load/i)).toBeInTheDocument();
    expect(await getAllForExport()).toEqual([]);
    expect((await exportAll()).nodes).toEqual([]);
  });

  it('TC-CF-5-02h: RegisterDetail hands its verdict view only the packs that loaded — the broken pack is absent (GB pass-2 M3)', async () => {
    breakAPack();
    seenPacks.length = 0;
    await addNode({
      node_id: 'uc-pack-detail',
      node_type: 'use_case',
      label: 'Detail under a broken pack',
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: { node_type: 'use_case', submitted_by: '1LoD', lifecycle_stage: 'pre_checked', current_verdict_id: 'v-pd', tier: 'High', track: 'II' },
    });
    await append({
      event_id: 'e-pd-1',
      use_case_id: 'uc-pack-detail',
      event_type: 'verdict_produced',
      occurred_at: '2026-01-01T00:00:01.000Z',
      actor: '1LoD',
      payload: { type: 'verdict_produced', verdict: {
        status: 'approved_with_controls', tier: 'High', track: 'II', binding_constraint: 'INV-X', binding_path: 'a → b',
        controls: [], downstream_reviews: [], conditions: { hypotheses: [] }, policy_version: '1.0', pack_versions: {},
        applied_overrides: [], confidence_caveats: [], provisional_reasons: [], boundary_proximity: false,
        margin_achieved: 0, margin_target: 0.1, single_covered_invariants: [],
        explanation: {
          tier_rationale: null, track_rationale: null, hard_lines_checked: 0, invariants_checked: 0,
          tripped_invariants: [], binding_reason: null, binding_regulatory_basis: null, regulatory_chain: [],
        },
        id: 'v-pd', use_case_id: 'uc-pack-detail', living_status: 'approved', living_status_updated_at: '2026-01-01T00:00:00.000Z',
        attested_by: '1LoD', attested_at: '2026-01-01T00:00:00.000Z', graph_version: 1, corrections: [],
      } },
    } as unknown as AuditEvent);
    render(<RegisterDetail useCaseId="uc-pack-detail" role="1LoD" onBack={vi.fn()} />);
    expect(await screen.findByText(/Detail under a broken pack/)).toBeInTheDocument();
    await vi.waitFor(() => expect(seenPacks.length).toBeGreaterThan(0));
    const ids = seenPacks[seenPacks.length - 1]!.map((p) => p.pack_id);
    expect(ids).not.toContain('BAD-PACK');
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual(packSource.loadPackSet(REAL_SOURCES).packs.map((p) => p.pack_id));
  });
});
