import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import * as packSource from '../../store/pack-source';
import { loadPacks } from '../../store/packs';
import { getAllForExport } from '../../store/audit';
import { getUseCases } from '../../store/register';
import { setRole } from '../../store/role';
import { POLICY_PROBLEM_MESSAGE } from '../plain-copy';

// GT7 / GB, D-1b (TC-CF-5-02b). A pack that fails to load joins the app's
// start-up gate: the "Policy file invalid" banner lists the loader's own
// reason text, evaluation is refused, and nothing reaches the audit trail.
//
// EBT exception (owner-accepted, code review 006/008) — FAULT INJECTION: the
// shipped packs are valid, so a broken pack cannot be produced on demand.
// getPackSources() in store/pack-source.ts is the one injection seam; the
// real loader, the real App and the real IntakeFlow all run unchanged.
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

const DRAFT_KEY = 'aigate:intake-draft';

const GRAPH = {
  id: 'g-gt7',
  version: 1,
  intake_method: 'structured_form' as const,
  extracted_at: '2026-01-01T00:00:00.000Z',
  jurisdictions: [],
  input_nodes: [{ id: 'i1', label: 'notes', data_class: 'Internal', data_zone: 'Zone C' }],
  processing_nodes: [
    { id: 'p1', label: 'summariser', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
  ],
  output_nodes: [
    { id: 'o1', label: 'summary', action_type: 'draft', exposure: 'internal-only', decision_bindingness: 'non-binding', output_reversibility: 'reversible', scale: 'limited' },
  ],
  edges: [{ from: 'i1', to: 'p1' }, { from: 'p1', to: 'o1' }],
};

/** Injects a broken pack beside the real ones; returns the loader's own reason text for it. */
function breakAPack(): string {
  const broken = { ...REAL_SOURCES, 'zz-broken.yaml': BROKEN_PACK };
  vi.mocked(packSource.getPackSources).mockReturnValue(broken);
  const reason = loadPacks(broken).errors.find((e) => e.packId === 'BAD-PACK')?.reason;
  if (!reason) throw new Error('fixture did not produce a pack error');
  return reason;
}

describe('GT7 D-1b — a broken pack joins the start-up gate (CF-5)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setRole('1LoD');
  });
  afterEach(() => {
    cleanup();
    vi.mocked(packSource.getPackSources).mockReturnValue(REAL_SOURCES);
  });

  it('TC-CF-5-02b: a pack that fails to load shows the banner with the loader reason (2LoD), refuses Confirm, and writes nothing to the trail', async () => {
    const reason = breakAPack();
    setRole('2LoD');
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'confirmation',
        description: 'A tool that summarises internal notes',
        graph: GRAPH,
        graphVersion: 1,
        corrections: [],
        answers: [],
        resolutionNotes: [],
        useCaseId: 'uc-gt7-pack',
        plainAnswers: { '1': 'Tool' },
        assumptions: [],
      }),
    );
    const user = userEvent.setup({ delay: null });
    render(<App />);

    const banner = document.querySelector('.app-policy-invalid')!;
    expect(banner).not.toBeNull();
    expect(banner.textContent).toMatch(/Policy file invalid/i);
    expect(banner.textContent).toMatch(/evaluation is disabled/i);
    expect(banner.textContent).toContain(reason);

    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    await waitFor(() => expect(screen.getAllByText(/rules file has a problem/i).length).toBeGreaterThan(0));
    expect(screen.queryByText('Verdict', { selector: '.verdict__eyebrow' })).not.toBeInTheDocument();

    // Let any (wrongly) started seeding settle, then prove the trail and register are empty.
    await new Promise((r) => setTimeout(r, 150));
    expect(await getAllForExport()).toEqual([]);
    expect(await getUseCases()).toEqual([]);
  });

  it('TC-CF-5-02c: a 1LoD submitter sees the plain sentence, never the raw pack reason', () => {
    const reason = breakAPack();
    render(<App />);
    const banner = document.querySelector('.app-policy-invalid')!;
    expect(banner.textContent).toMatch(/Policy file invalid/i);
    expect(banner.querySelector('ul')!.textContent).toBe(
      "Your AI risk team needs to fix the firm's rules file before checks can run.",
    );
    expect(banner.textContent).not.toContain(reason);
  });

  it('TC-CF-5-02d: the first evaluation gate (Continue on the review screen) refuses with the plain message', async () => {
    breakAPack();
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'graph_review',
        description: 'A tool that summarises internal notes',
        graph: GRAPH,
        graphVersion: 1,
        corrections: [],
        useCaseId: 'uc-gt7-pack-2',
        jurisdictionsConfirmed: true,
        unconfirmedNodeIds: [],
      }),
    );
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));
    expect((await screen.findAllByText(/rules file has a problem/i)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeInTheDocument();
    expect(POLICY_PROBLEM_MESSAGE).toMatch(/rules file has a problem/);
  });

  it('TC-CF-5-02e: with the shipped (valid) packs there is no banner and loadPackSet reports no errors', () => {
    const set = packSource.loadPackSet(packSource.getPackSources());
    expect(set.errors).toEqual([]);
    expect(set.packs.length).toBeGreaterThan(0);
    render(<App />);
    expect(document.querySelector('.app-policy-invalid')).toBeNull();
  });
});
