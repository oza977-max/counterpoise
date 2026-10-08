import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { addNode, getUseCases } from '../../store/register';
import { append, getAll } from '../../store/audit';
import type { Verdict } from '../../types/verdict';
import { fillText, SLOW_FLOW_MS, DUP_CHECK_WAIT, pressNext } from './fillText';

// R16-W (build/prompts/R16-W.md) — the owner-side walkthrough fixes,
// integration-level coverage. Unit-level coverage for the individual pieces
// lives in intake-state.test.ts (the reducer), plain-intake.test.ts (W-9's
// mapping), StructuredForm.test.tsx (W-1/W-2/W-4/W-9's UI), UnderstoodSummary
// .test.tsx (§2's rewrite) and verdict-view-model.test.ts/VerdictDisplay*
// .test.tsx (W-6/W-7/W-8). This file covers what only the full App wiring
// can prove: the form path's actual screen sequence, and what survives a
// refresh.
//
// TDD-2 mock budget = 1: the Anthropic SDK boundary only. No test here
// configures an API key, so every one of them drives the form path.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));

function makeVerdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    status: 'approved_with_controls',
    tier: 'High',
    track: 'II',
    binding_constraint: 'INV-DATA-01',
    binding_path: 'client notes → drafting model → drafted email',
    controls: ['CTRL-ENC-01'],
    downstream_reviews: [],
    conditions: { hypotheses: [] },
    policy_version: '1.9',
    pack_versions: {},
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
      hard_lines_checked: 5,
      invariants_checked: 20,
      tripped_invariants: [
        {
          id: 'INV-DATA-01',
          description: 'Client PII leaving the firm',
          severity: 'High',
          required_controls: ['CTRL-ENC-01'],
          graph_path: 'x',
        },
      ],
      binding_reason: null,
      binding_regulatory_basis: null,
    },
    id: 'v-precedent-1',
    use_case_id: 'uc-precedent-1',
    living_status: 'approved',
    living_status_updated_at: '2026-01-01T00:00:00.000Z',
    attested_by: '1LoD',
    attested_at: '2026-01-01T00:00:00.000Z',
    graph_version: 1,
    corrections: [],
    ...overrides,
  } as Verdict;
}

async function fillMinimalForm(user: ReturnType<typeof userEvent.setup>, name: string, description: string) {
  await fillText(user, screen.getByLabelText(/what do you want to call it/i), name);
  await user.clear(screen.getByLabelText(/in a sentence or two/i));
  await fillText(user, screen.getByLabelText(/in a sentence or two/i), description);
  await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
  await user.click(
    screen.getByRole('radio', { name: /reads, summarises, translates, writes or answers questions in words/i }),
  );
  await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
  await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
  await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
  await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
  await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
  await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
  await user.click(screen.getByRole('checkbox', { name: /somewhere else, or not sure/i }));
  await user.click(screen.getByRole('radio', { name: /^no$/i }));
}

async function reachFormScreen(user: ReturnType<typeof userEvent.setup>, description: string) {
  render(<App />);
  await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), description);
  await pressNext(user);
  await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
  await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
}

describe('R16-W W-3 (D-69): the form path never shows graph_review on the way to confirmation', () => {
  it('TC-R16-W-58: reaches "Here’s what we understood" directly — no "Confirm what we understood", no "worth a second look", no graph-review node cards', async () => {
    const user = userEvent.setup({ delay: null });
    await reachFormScreen(user, 'Zephyrquill morandane intake probe');
    await fillMinimalForm(user, 'Zephyrquill morandane sorter', 'Sorts internal documents.');
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    expect(await screen.findByText(/here.s what we understood/i)).toBeInTheDocument();
    expect(screen.queryByText(/confirm what we understood/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/worth a second look/i)).not.toBeInTheDocument();
    // graph_review renders GraphView's per-node cards (.graph-node); the
    // form path must never produce one.
    expect(document.querySelectorAll('.graph-node')).toHaveLength(0);
    // No bare engine field code anywhere on the summary screen.
    expect(document.body.textContent).not.toMatch(/\bDATA_ZONE\b|\bMODEL_TYPE\b/);
  }, SLOW_FLOW_MS);
});

describe('R16-W W-4 (D-70): changing an answer / stepping back reopens the form filled in', () => {
  it('TC-R16-W-59: Back from the questionnaire returns to the form with its answers intact', async () => {
    const DRAFT_KEY = 'aigate:intake-draft';
    // R18-A: written as the version-4 draft the form's Continue leaves behind.
    // Question 2 is the description (never a stored answer), so the description
    // is carried in `description` and the tool name in `plainAnswers`.
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ version: 4, state: {
        step: 'questionnaire',
        description: 'Carried description.',
        method: 'form',
        graph: {
          id: 'g1', version: 1, intake_method: 'structured_form', extracted_at: '2026-01-01T00:00:00.000Z',
          jurisdictions: [],
          input_nodes: [{ id: 'i1', label: 'x', data_class: 'Internal', data_zone: 'Zone C' }],
          processing_nodes: [{ id: 'p1', label: 'x', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false }],
          output_nodes: [{ id: 'o1', label: 'x', action_type: 'read', exposure: 'internal-only', decision_bindingness: 'non-binding', output_reversibility: 'reversible', scale: 'limited' }],
          edges: [],
        },
        questions: [{ id: 'Q1', text: 'x?', field: 'autonomy_level', triggered_by: ['INV-1'], answer_type: 'text' }],
        answers: [],
        resolutionNotes: [],
        corrections: [],
        useCaseId: 'uc-back-1',
        plainAnswers: { '1': 'Carried tool name' },
        assumptions: [],
      } }),
    );

    render(<App />);
    const back = await screen.findByRole('button', { name: /back/i });
    await userEvent.click(back);

    expect(await screen.findByLabelText(/what do you want to call it/i)).toHaveValue('Carried tool name');
    expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue('Carried description.');
    sessionStorage.clear();
  });

  it('TC-R16-W-60: "Change an answer" from confirmation reopens the form with its answers intact', async () => {
    const DRAFT_KEY = 'aigate:intake-draft';
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ version: 4, state: {
        step: 'confirmation',
        description: 'A tool that sorts internal mail queues.',
        graph: {
          id: 'g1', version: 1, intake_method: 'structured_form', extracted_at: '2026-01-01T00:00:00.000Z',
          jurisdictions: [],
          input_nodes: [{ id: 'i1', label: 'x', data_class: 'Internal', data_zone: 'Zone C' }],
          processing_nodes: [{ id: 'p1', label: 'x', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false }],
          output_nodes: [{ id: 'o1', label: 'x', action_type: 'read', exposure: 'internal-only', decision_bindingness: 'non-binding', output_reversibility: 'reversible', scale: 'limited' }],
          edges: [],
        },
        graphVersion: 1,
        corrections: [],
        answers: [],
        resolutionNotes: [],
        useCaseId: 'uc-change-1',
        plainAnswers: { '1': 'Reopened tool name', '2': 'Reopened description.' },
        assumptions: [],
      } }),
    );

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /change an answer/i }));

    expect(await screen.findByLabelText(/what do you want to call it/i)).toHaveValue('Reopened tool name');
    // R18-A: question 2 is the description's editor, not a stored answer.
    expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue('A tool that sorts internal mail queues.');
    sessionStorage.clear();
  });

  it('TC-R16-W-61: a refresh on confirmation keeps the "Not sure" assumptions list (restored from the draft, not a component useState)', async () => {
    const DRAFT_KEY = 'aigate:intake-draft';
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ version: 4, state: {
        step: 'confirmation',
        description: 'd',
        graph: {
          id: 'g1', version: 1, intake_method: 'structured_form', extracted_at: '2026-01-01T00:00:00.000Z',
          jurisdictions: [],
          input_nodes: [{ id: 'i1', label: 'x', data_class: 'Internal', data_zone: 'Zone A' }],
          processing_nodes: [{ id: 'p1', label: 'x', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone A', vendor: 'internal', replaces_prior_model: false }],
          output_nodes: [{ id: 'o1', label: 'x', action_type: 'read', exposure: 'internal-only', decision_bindingness: 'non-binding', output_reversibility: 'reversible', scale: 'limited' }],
          edges: [],
        },
        graphVersion: 1,
        corrections: [],
        answers: [],
        resolutionNotes: [],
        useCaseId: 'uc-refresh-1',
        plainAnswers: { '9': 'not-sure' },
        assumptions: [{ questionId: '9', question: 'If it gets something wrong, can the mistake be caught and put right before it does lasting harm — to anyone?', assumption: 'it can’t be undone — the strictest case. Change it if a mistake can actually be caught and fixed.' }],
      } }),
    );

    // A fresh render with no prior interaction simulates a reload exactly.
    render(<App />);
    expect(await screen.findByText(/things we assumed because you weren.t sure/i)).toBeInTheDocument();
    expect(screen.getByText(/it can.t be undone — the strictest case/i)).toBeInTheDocument();
    sessionStorage.clear();
  });
});

// R16-F F-3 (DR7-05): the creation write itself moved from the form's
// first Continue to Confirm (inside the F-1 case lock, runConfirmAndEvaluate)
// — the "one use case, one creation event" INVARIANT this test pins is
// unchanged (and still holds, by construction, now that there is only
// ever one write site); only WHEN it is written moved, which is why this
// test — already driving the flow through to Confirm before checking the
// trail — needed no change to its own assertions.
describe('R16-W W-4 (D-70): one use case, one creation event', () => {
  it('TC-R16-W-62: submit, Change an answer, submit again — exactly one use_case_created for the intake, and the confirmed use case has that id', async () => {
    const user = userEvent.setup({ delay: null });
    const marker = 'Brindlewick tansy fathomgate assistant';
    await reachFormScreen(user, marker);
    await fillMinimalForm(user, marker, 'Checks the resubmission does not duplicate the creation event.');
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByText(/here.s what we understood/i);

    // Change an answer, then resubmit without changing anything.
    await user.click(screen.getByRole('button', { name: /change an answer/i }));
    expect(await screen.findByLabelText(/what do you want to call it/i)).toHaveValue(marker);
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByText(/here.s what we understood/i);
    await user.click(screen.getByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' });

    const rows = await getUseCases('all');
    const mine = rows.find((r) => r.label === marker);
    expect(mine, `no register row named "${marker}"; rows: ${rows.map((r) => r.label).join(' | ')}`).toBeDefined();

    const events = await getAll(mine!.use_case_id);
    const creations = events.filter((e) => e.event_type === 'use_case_created');
    expect(creations).toHaveLength(1);
    // W-1: the creation event records question 2's text (what the person
    // left there), not the first screen's words.
    if (creations[0]!.payload.type === 'use_case_created') {
      expect(creations[0]!.payload.description).toBe('Checks the resubmission does not duplicate the creation event.');
    }
  }, SLOW_FLOW_MS);
});

// R16-F F-3 (DR7-05): see TC-R16-W-62's comment above — the write moved to
// Confirm; "question 2's final text" is still what gets recorded, read at
// the same point (typedDescription, threaded from the confirmation state)
// either way.
describe('R16-W W-1 (D-67): the text left in question 2 is the description from then on', () => {
  it('TC-R16-W-66: the trail and the register record question 2’s edited text, not the first screen’s words', async () => {
    const user = userEvent.setup({ delay: null });
    const marker = 'Tollgrave inkwhistle carrier';
    await reachFormScreen(user, 'First-screen words that the person then replaces.');
    await fillMinimalForm(user, marker, 'Edited words in question two.');
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByText(/here.s what we understood/i);
    await user.click(screen.getByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' });

    const rows = await getUseCases('all');
    const mine = rows.find((r) => r.label === marker);
    expect(mine, `no register row named "${marker}"`).toBeDefined();
    expect(mine!.description).toBe('Edited words in question two.');
    const created = (await getAll(mine!.use_case_id)).find((e) => e.event_type === 'use_case_created');
    expect(created?.payload.type === 'use_case_created' ? created.payload.description : undefined).toBe(
      'Edited words in question two.',
    );
  }, SLOW_FLOW_MS);
});

describe('Confirm guard across intakes (found by the R16-W walkthrough)', () => {
  it('TC-R16-W-67: after one successful confirmation, "+ New pre-check" starts a case whose "Confirm and evaluate" still works — no reload needed', async () => {
    const user = userEvent.setup({ delay: null });
    const first = 'Quillmarsh ferngate first tool';
    await reachFormScreen(user, 'The first case in this tab.');
    await fillMinimalForm(user, first, 'The first case in this tab.');
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByText(/here.s what we understood/i);
    await user.click(screen.getByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' });

    // The sidebar item is a real <button> (R16-F §3) — getByText still
    // finds it via the click event bubbling from its text.
    await user.click(screen.getByText('+ New pre-check'));
    const second = 'Marrowdeep lanternfall second tool';
    await fillText(user, await screen.findByLabelText(/what ai tool do you want to use/i), 'The second case in this tab.');
    await pressNext(user);
    // "Continue →" when nothing similar is found; "Mine is different —
    // continue →" if the first case is offered as similar — either way on.
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
    await fillMinimalForm(user, second, 'The second case in this tab.');
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByText(/here.s what we understood/i);
    await user.click(screen.getByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' });

    const labels = (await getUseCases('all')).map((r) => r.label);
    expect(labels).toContain(first);
    expect(labels).toContain(second);
    // FX7-6: this test is two complete form-to-verdict flows in one case
    // (the point of it); on a heavily loaded machine that stays past 5 s even
    // after the cheaper fill, so it gets 15 s — the only per-test timeout added here.
  }, SLOW_FLOW_MS);
});

describe('R16-W W-3 (D-69): similar decided cases on the form-path confirmation screen', () => {
  it('TC-R16-W-63: a similarly-described, already-decided use case shows as a collapsed "similar decided case" panel on the summary, before the optional note', async () => {
    const marker = 'Glimmercrest volant hazebury engine';
    await addNode({
      node_id: 'precedent-row-1',
      node_type: 'use_case',
      label: marker,
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: {
        node_type: 'use_case',
        description: marker,
        submitted_by: '1LoD',
        lifecycle_stage: 'approved',
        current_verdict_id: 'v-precedent-1',
        tier: 'High',
        track: 'II',
      },
    });
    await append({
      event_id: crypto.randomUUID(),
      use_case_id: 'precedent-row-1',
      event_type: 'verdict_produced',
      occurred_at: '2026-01-01T00:00:01.000Z',
      actor: 'system',
      payload: { type: 'verdict_produced', verdict: makeVerdict({ use_case_id: 'precedent-row-1' }) },
    });

    const user = userEvent.setup({ delay: null });
    // The FIRST-screen description drives the hard DUPLICATE gate (0.4
    // Jaccard threshold, duplicate.ts) — kept at zero overlap with the
    // seeded row's label so this reaches the form normally. The precedent
    // match (0.15 threshold, precedent.ts) is driven separately, by the
    // auto-generated input-node label sharing two words with the seeded
    // row's label ("Glimmercrest volant …") — enough to clear 0.15, nowhere
    // near enough to clear the duplicate gate's own, much higher bar.
    await reachFormScreen(user, 'Checks summary panel precedent matching behaviour');
    await fillMinimalForm(user, 'Glimmercrest volant reporting tool', 'Unrelated to the seeded row’s own description.');
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    await screen.findByText(/here.s what we understood/i);
    await waitFor(() => {
      // Scoped to the collapsed summary ("N similar decided case(s) —
      // show") — SimilarCases' own <h3>Similar decided cases</h3> inside
      // ALSO matches a bare /similar decided case/i, which is correct
      // (both exist once the panel is expanded in the DOM) but ambiguous
      // for a single-match query.
      expect(screen.getByText(/similar decided case.*— show/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/precedent informs, the rules decide/i)).toBeInTheDocument();
  }, SLOW_FLOW_MS);
});

describe('R16-W W-5 (D-75): the knowledge-lens panel is collapsed on the intake verdict screen', () => {
  it('TC-R16-W-65: a real verdict with a knowledge-lens match renders the panel inside a collapsed-by-default <details>, after the reviewer section', async () => {
    const user = userEvent.setup({ delay: null });
    const marker = 'Oxmantle driftquill cindergale advisor';
    await reachFormScreen(user, marker);
    // Client PII through the in-house platform's Zone B option (the same
    // scenario WalkingSkeleton's P4-C02 test uses) trips INV-DATA-01, which
    // grounding/risk-knowledge.yaml's real "Privacy & Security" entry covers.
    await fillText(user, screen.getByLabelText(/what do you want to call it/i), marker);
    await user.clear(screen.getByLabelText(/in a sentence or two/i));
    await fillText(user, screen.getByLabelText(/in a sentence or two/i), 'Drafts client emails from notes.');
    await user.click(screen.getByRole('radio', { name: /your firm.s in-house model platform/i }));
    await user.click(screen.getByRole('radio', { name: /the platform passes it to an outside supplier/i }));
    await user.click(
      screen.getByRole('radio', { name: /reads, summarises, translates, writes or answers questions in words/i }),
    );
    await user.click(screen.getByRole('checkbox', { name: /information about people/i }));
    await user.click(screen.getByRole('radio', { name: /creates a draft/i }));
    await user.click(screen.getByRole('radio', { name: /^little/i }));
    await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
    await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
    await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
    await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
    await user.click(screen.getByRole('checkbox', { name: /somewhere else, or not sure/i }));
    await user.click(screen.getByRole('radio', { name: /^no$/i }));
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    await screen.findByText(/here.s what we understood/i);
    await user.click(screen.getByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' });

    const summary = screen.queryByText(/what outside research says about this kind of ai use/i);
    if (!summary) {
      // This scenario's precise invariant set can shift with policy edits;
      // the behaviour under test (collapsed wrapper) only matters when a
      // match exists at all. Documented rather than silently skipped.
      throw new Error('no knowledge-lens match rendered for this scenario — the test fixture needs revisiting, not the assertion loosening');
    }
    const details = summary.closest('details')!;
    expect(details).not.toBeNull();
    expect(details.hasAttribute('open')).toBe(false);
  }, SLOW_FLOW_MS);
});

describe('R16-W §4 (D-74): the opening-screen copy', () => {
  it('TC-R16-W-64: the subtitle, welcome note, and describe step all read the new plain-language text', async () => {
    render(<App />);
    expect(
      screen.getByText(/we.ll check it against your firm.s rules and tell you whether you can go ahead/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/the decision comes from your firm.s written rules, not from ai/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/what ai tool do you want to use, and what will it do for you/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^next →$/i })).toBeInTheDocument();
    expect(screen.getByText(/you can check and change everything before anything is decided/i)).toBeInTheDocument();
  });
});
