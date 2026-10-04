import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPanel from '../SettingsPanel';
import RegisterDetail from '../RegisterDetail';
import * as packSource from '../../store/pack-source';
import { getAllForExport } from '../../store/audit';
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

  it('TC-CF-5-02h: the register detail loads via loadPackSet and does not crash on a broken pack (the broken pack is simply absent)', async () => {
    breakAPack();
    const set = packSource.loadPackSet(packSource.getPackSources());
    expect(set.messages.length).toBeGreaterThan(0);
    expect(set.packs.map((p) => p.pack_id)).not.toContain('BAD-PACK');
    expect(set.packs.length).toBeGreaterThan(0);
    await addNode({
      node_id: 'uc-pack-detail',
      node_type: 'use_case',
      label: 'Detail under a broken pack',
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: { node_type: 'use_case', submitted_by: '1LoD', lifecycle_stage: 'pre_checked', current_verdict_id: null, tier: 'High', track: 'II' },
    });
    render(<RegisterDetail useCaseId="uc-pack-detail" role="1LoD" onBack={vi.fn()} />);
    expect(await screen.findByText(/Detail under a broken pack/)).toBeInTheDocument();
  });
});
