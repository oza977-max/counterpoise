import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { addNode, getUseCases } from '../../store/register';
import { getAll } from '../../store/audit';
import { fillText, DUP_CHECK_WAIT, pressNext } from './fillText';

/** A register entry the duplicate check will match on, seeded before render so
 *  the row is present regardless of App's fire-and-forget seeding. */
async function seedExistingUseCase(label: string) {
  const node = {
    node_id: crypto.randomUUID(),
    node_type: 'use_case' as const,
    label,
    created_at: '2026-07-29T00:00:00.000Z',
    metadata: {
      node_type: 'use_case' as const,
      submitted_by: '1LoD',
      lifecycle_stage: 'approved' as const,
      current_verdict_id: null,
      tier: 'High',
      track: 'II',
    },
  };
  await addNode(node);
  return node;
}

// explore-005 D-001 / D-002. The draft restore persists IntakeState and
// nothing else, so a step whose screen depends on component state written by
// the handler that normally enters it comes back broken. These tests drive
// the restore the way a reload does — a fresh render over a populated
// sessionStorage draft — rather than asserting on the reducer alone, because
// the defect lives in the gap between the two.
//
// TDD-2 mock budget = 1: the Anthropic SDK boundary only. sessionStorage is
// the real jsdom one (npm test sets --no-experimental-webstorage).
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: vi.fn() };
    },
  };
});

const DRAFT_KEY = 'aigate:intake-draft';
// R16-B (D-41): the guided-form draft key is now versioned — the old key
// is probed and cleared separately, by StructuredForm itself on mount, so
// an incompatible pre-R16 shape is reported once rather than silently
// misread. "Start over" clearing the CURRENT form draft is still the
// behaviour this test protects; it just targets the new key.
const FORM_DRAFT_KEY = 'aigate:intake-form-draft:v2';

describe('IntakeFlow — resuming a restored draft', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('resolves the duplicate check when the flow is restored at duplicate_check (D-001)', async () => {
    // Exactly what a reload on step 2 leaves behind: the step, and no record
    // of the check that step's screen is waiting on.
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ step: 'duplicate_check', description: 'A tool that drafts client emails' }),
    );

    render(<App />);

    // The way out of the step must appear without the user re-entering
    // anything. Before the fix this never resolves and no button is rendered.
    // R16-W §4 (D-74): no seeded match for this description, so the button
    // is the no-match screen's "Continue →", not the match-found screen's
    // "Mine is different — continue →".
    expect(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT)).toBeInTheDocument();
    expect(screen.queryByText(/checking the existing inventory/i)).not.toBeInTheDocument();
  });

  it('waits for the register to load before resolving the restored check (D-001)', async () => {
    // A row that exists BEFORE the render, so the count is not at the mercy
    // of App's fire-and-forget self-assessment seeding (explore-005 O-002).
    await addNode({
      node_id: 'existing-row',
      node_type: 'use_case',
      label: 'An existing register entry',
      created_at: '2026-07-29T00:00:00.000Z',
      metadata: {
        node_type: 'use_case',
        submitted_by: '1LoD',
        lifecycle_stage: 'idea',
        current_verdict_id: null,
        tier: null,
        track: null,
      },
    });

    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ step: 'duplicate_check', description: 'A tool that drafts client emails' }),
    );

    render(<App />);
    await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT);

    // Without the registerLoaded guard the restored check resolves against
    // an empty array and reports having checked nothing — a wrong answer
    // rendered as a confident one. Not an exact count: the seeding race in
    // O-002 can add a row, and pinning the number would make this flaky.
    expect(screen.queryByText(/checked 0 register/i)).not.toBeInTheDocument();
  });

  it('returns to a blank description entry when Start over instead is clicked (D-002)', async () => {
    const user = userEvent.setup({ delay: null });
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ step: 'duplicate_check', description: 'A tool that drafts client emails' }),
    );
    sessionStorage.setItem(FORM_DRAFT_KEY, JSON.stringify({ name: 'left over from the abandoned draft' }));

    render(<App />);
    await user.click(await screen.findByRole('button', { name: /start over instead/i }));

    const input = await screen.findByLabelText(/what ai tool do you want to use/i);
    expect(input).toHaveValue('');
    // Both drafts, not just the reducer's: a start-over that leaves the
    // guided form's answers behind has not started over.
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(sessionStorage.getItem(FORM_DRAFT_KEY)).toBeNull();
  });
});

// Round 4 — UC-2. The duplicate check surfaced a match and offered exactly one
// action: "This is a new use case". The requirement's fit criterion says the
// submitter "may adopt the existing classification OR confirm their use case
// is genuinely new" — only the second half was built. And dismissing a match
// wrote nothing to the audit trail, so nobody could afterwards tell a genuine
// new use case from a duplicate waved through.
describe('Duplicate gate — both decisions exist and both are recorded (UC-2)', () => {
  it('TC-UC-2-03: dismissing a match records it in the audit trail', async () => {
    // Distinct label per test: IndexedDB is not cleared between tests in this
    // file, so a shared name lets the duplicate check match the OTHER test's
    // row and the assertions then read the wrong record.
    const existing = await seedExistingUseCase('Dismissal probe assistant');
    const user = userEvent.setup({ delay: null });
    render(<App />);

    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'Dismissal probe assistant');
    await pressNext(user);
    // R16-W §4 (D-74): this description keyword-matches the seeded row
    // above, so the match-found screen's own button ("Mine is different —
    // continue →") renders, not the no-match screen's "Continue →".
    await user.click(await screen.findByRole('button', { name: /mine is different/i }));

    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);

    const events = await getAll(existing.node_id);
    const dismissal = events.find((e) => e.payload.type === 'duplicate_dismissed');
    expect(dismissal, 'no duplicate_dismissed event written').toBeDefined();
  });

  it('TC-UC-2-02: adopting the classification creates a linked record and asks no intake questions', async () => {
    const existing = await seedExistingUseCase('Adoption probe assistant');
    const user = userEvent.setup({ delay: null });
    render(<App />);

    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'Adoption probe assistant');
    await pressNext(user);

    // R16-W §4 (D-74): "Adopt this classification" is now "Use the earlier
    // result".
    const adopt = await screen.findByRole('button', { name: /use the earlier result/i });
    await user.click(adopt);

    // The submitter is NOT asked intake questions — that is the point of
    // adopting.
    expect(screen.queryByText(/new pre-check — tell us about the ai you want to use/i)).not.toBeInTheDocument();

    // A new record exists, linked to the original, and the link says where the
    // classification came from.
    // Identify the adopted record by what it IS, not by "the other row" —
    // once O-002's fix made the register wait for the self-assessment seeding,
    // "the other row" could be the Counterpoise seed. An assertion that can match
    // the wrong record passes for the wrong reason.
    // Identify the adopted record by WHAT HAPPENED TO IT, not by name and not
    // by "the other row". Both of those matched the wrong record: "the other
    // row" picked up the Counterpoise seed once O-002's fix made the register wait
    // for seeding, and the label matched a same-named use case created by a
    // different test file in a full-suite run. The record that was adopted is
    // the one carrying a classification_adopted event — that is its identity.
    // handleAdoptClassification's onClick is `() => void handleAdoptClassification()`
    // — deliberately fire-and-forget, so `user.click` resolves once the
    // synchronous dispatch is done, not once the async write lands. Scanning
    // the register immediately after the click races that write under load
    // (this was an intermittent full-suite-only failure, never reproducible
    // in isolation — CI flake fix, 2026-09-01). waitFor closes the race.
    const match = await waitFor(async () => {
      const rows = await getUseCases('all');
      const withAdoption = await Promise.all(
        rows.map(async (r) => ({
          row: r,
          adoption: (await getAll(r.use_case_id)).find((e) => e.payload.type === 'classification_adopted'),
        })),
      );
      const found = withAdoption.find((x) => x.adoption !== undefined);
      expect(found, `no adopted record; rows: ${rows.map((r) => r.label).join(' | ')}`).toBeDefined();
      return found;
    });
    const adopted = match!.row;
    const adoption = match!.adoption;
    expect(adopted!.tier).toBe('High');

    expect(adoption).toBeDefined();
    expect(adoption && 'adopted_from_use_case_id' in adoption.payload && adoption.payload.adopted_from_use_case_id).toBe(
      existing.node_id,
    );

    // And it carries no verdict of its own, because nothing was evaluated.
    // The sign-off page states that plainly (register-lifecycle.md §15.2).
    expect(adopted!.current_verdict_status).toBeNull();
  });
});

// Code review round 3, Panel E. `handleConfirmNewUseCase` gained an audit
// write in round 4 (the duplicate_dismissed event) and did NOT gain the
// in-flight guard its two siblings in this same file already have. A
// double-click writes two events into an append-only trail, which cannot be
// cleaned up afterwards by design.
describe('The duplicate gate cannot double-write (round 4 review, Panel E)', () => {
  it('a double-click on "Mine is different — continue" appends exactly one dismissal', async () => {
    const existing = await seedExistingUseCase('Double-click probe assistant');
    render(<App />);

    const ta = await screen.findByLabelText(/what ai tool do you want to use/i);
    fireEvent.change(ta, { target: { value: 'Double-click probe assistant' } });
    fireEvent.click(screen.getByRole('button', { name: /^next/i }));

    // R16-W §4 (D-74): this description keyword-matches the seeded row
    // above, so the match-found screen's button renders.
    const confirm = await screen.findByRole('button', { name: /mine is different/i });

    // Two clicks inside one tick — a state update disabling the button lands
    // too late, which is why the guard has to be a synchronous ref.
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(async () => {
      expect((await getAll(existing.node_id)).some((e) => e.payload.type === 'duplicate_dismissed')).toBe(true);
    });

    const dismissals = (await getAll(existing.node_id)).filter((e) => e.payload.type === 'duplicate_dismissed');
    expect(dismissals).toHaveLength(1);
  });
});
