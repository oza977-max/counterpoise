import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import appetiteYaml from '../../../policy/appetite.yaml?raw';
import { setCurrentPolicyYaml } from '../../store/policy-source';
import { fillText, SLOW_FLOW_MS, DUP_CHECK_WAIT } from './fillText';

// TDD-2 mock budget = 1: the only mock is the external boundary (Anthropic SDK).
// Everything else — IndexedDB via fake-indexeddb, React rendering — is real.

// R5-GR-2: on the LLM path every extracted card must be confirmed before
// Proceed. The skeleton simulates the user, so it does what a user now must.
// No-ops on the form path (no confirm buttons render there).
async function confirmAllNodes(user: { click: (el: Element) => Promise<void> }) {
  for (;;) {
    const buttons = screen.queryAllByRole('button', { name: /^(this is right|i.ve checked this — it.s right)$/i });
    if (buttons.length === 0) break;
    await user.click(buttons[0]!);
  }
  // R16-E §4 (D-103): the jurisdiction confirm button no longer shares a
  // "— confirm" suffix with the node buttons above (that shared suffix
  // used to let this same loop catch both by accident) — every caller
  // already assumes this helper clears the WHOLE review gate before
  // clicking Proceed/Continue, so it is confirmed here too.
  const jurisdictionButton = screen.queryByRole('button', { name: /^(these are right|none of these — continue)$/i });
  if (jurisdictionButton) await user.click(jurisdictionButton);
}

// Every caller of confirmAllNodes goes on to click "Proceed" — always via
// findByRole, never getByRole. The last node's "Confirm" click re-renders
// the graph view, and "Proceed" appearing is that re-render's effect; a
// synchronous getByRole right after the loop returns can race it under load
// (intermittent full-suite-only failure — CI flake fix, 2026-09-01).

// BC-003: the mock reply carries quotes the real producer would write —
// verbatim substrings of the description each test types (the typed text is
// always `<unique phrase> + DETAIL`). A field with no verified quote is
// "guessed" and becomes a question, which these flows do not expect.
const DETAIL =
  ' Traditional ML model, internal vendor, Zone C, no autonomy, replacing no prior model; recommends, internal only, material, reversible, limited scale.';
const PROCESSING_QUOTES = {
  model_type: 'traditional ML model',
  autonomy_level: 'no autonomy',
  data_zone: 'Zone C',
  vendor: 'internal vendor',
  replaces_prior_model: 'replacing no prior model',
};
const OUTPUT_QUOTES = {
  action_type: 'recommends',
  exposure: 'internal only',
  decision_bindingness: 'material',
  output_reversibility: 'reversible',
  scale: 'limited scale',
};

const MOCK_GRAPH_INPUT = {
  input_nodes: [],
  processing_nodes: [
    {
      id: 'p1',
      label: 'email drafting model',
      model_type: 'traditional-ml',
      autonomy_level: 0,
      data_zone: 'Zone C',
      vendor: 'internal',
      replaces_prior_model: false,
      basis_quotes: PROCESSING_QUOTES,
    },
  ],
  output_nodes: [
    {
      id: 'o1',
      label: 'drafted email',
      action_type: 'recommend',
      exposure: 'internal-only',
      decision_bindingness: 'material',
      output_reversibility: 'reversible',
      scale: 'limited',
      basis_quotes: OUTPUT_QUOTES,
    },
  ],
  edges: [],
  jurisdictions: [],
};

const mockCreate = vi.fn().mockResolvedValue({
  content: [{ type: 'tool_use', name: 'extract_graph', input: MOCK_GRAPH_INPUT }],
});

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

describe('Walking Skeleton', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('aigate:api-key', 'test-key-for-skeleton');
    mockCreate.mockClear();
  });

  it('completes full flow end-to-end with real boundaries', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);

    // Step 1: description entry
    const input = screen.getByLabelText(/what ai tool do you want to use/i);
    await fillText(user, input, 'A tool that drafts client emails for relationship managers, pulling recent meeting notes, pending requests, preferred greeting style, signature blocks, and followup reminders into a polished first draft' + DETAIL);
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i}, DUP_CHECK_WAIT));

    // Step 2: graph extraction happened (real Anthropic tool_use call, mocked at the SDK boundary)
    // and the graph review step renders the extracted node.
    // R9: the checklist header also names the card, so the label appears
    // twice by design — assert at least one, not exactly one.
    expect((await screen.findAllByText(/email drafting model/i)).length).toBeGreaterThan(0);
    // gvm-test 007 (real-chain check): the graph came through the real
    // extractor and the mocked SDK boundary — not a silent fallback.
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // Step 3: proceed — zero uncertain fields means no questions, so the
    // flow lands directly on the real confirmation/attestation screen
    // (P4-C04, no more silent pass-through).
    await confirmAllNodes(user);
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));

    expect(await screen.findByRole('heading', { name: /confirm and evaluate/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /confirm and evaluate/i }));

    expect(await screen.findByText('Verdict', { selector: '.verdict__eyebrow' })).toBeInTheDocument();
    expect(screen.getByText(/approved|rejected/i)).toBeInTheDocument();

    // Step 4: register shows the use case row (real IndexedDB store write + read),
    // labelled from the extracted graph's first node per IntakeFlow.tsx.
    // Navigate to the Register view (P6-C01) via the sidebar.
    await user.click(screen.getByText('▤ Register'));
    expect(await screen.findByText('Register', { selector: '.register-view h2' })).toBeInTheDocument();
    expect(await screen.findByRole('row', { name: /email drafting model/i })).toBeInTheDocument();

    // TC-LC-2-01 (P6-C02): routeToWorkflow() drives the lifecycle stage from
    // the tier, not a hardcoded 'idea'. This fixture is internal-only but
    // MATERIAL, which oracle round 001 made a Medium-tier trigger — tiering
    // previously ignored how much weight the output carried, so an internal
    // material decision self-served on exposure alone. Medium is 2LoD-notify,
    // so the node lands at 'pre_checked'. Switch to 2LoD to see the chip.
    // R15-C1 renegotiation: selector updated from /role/i to /viewing as/i —
    // the role-switcher label changed (proposal §3.8), same lookup intent.
    // The Stage chip also now renders the STAGE_LABELS plain word, not the
    // raw 'pre_checked' enum.
    await user.selectOptions(screen.getByLabelText(/viewing as/i), '2LoD');
    expect(await screen.findByRole('button', { name: 'Awaiting 2LoD sign-off' })).toBeInTheDocument();
  }, SLOW_FLOW_MS);

  it('P4-C02: routes to the structured form on the no-api-key path and completes end-to-end without any LLM call [TC-NF-4-01]', async () => {
    localStorage.clear(); // no API key configured

    const user = userEvent.setup({ delay: null });
    render(<App />);

    const input = screen.getByLabelText(/what ai tool do you want to use/i);
    await fillText(user, input, 'A tool that drafts client emails');
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i}, DUP_CHECK_WAIT));

    // Structured intake banner renders instead of the old dead-end message.
    expect(await screen.findByText(/new pre-check — tell us about the ai you want to use/i)).toBeInTheDocument();

    // R16-B: the field-by-field form this used to drive is replaced by the
    // situational question set (build/prompts/R16.md §2.2) — adapted to the
    // same scenario: Client PII, the firm's in-house platform (Zone B,
    // vendor internal — same zone-crossing shape INV-DATA-01/CTRL-ENC-01
    // need, same as the retired "Zone B" + unset-vendor combination), a
    // draft a person checks, internal-only, non-binding, reversible,
    // limited, no jurisdiction named.
    await fillText(user, screen.getByLabelText(/what do you want to call it/i), 'Email drafting tool');
    // R16-W W-1 (D-67): question 2 now starts pre-filled with the first
    // screen's own description — clear it first so this fixture's own
    // wording is what ends up recorded, matching this test's pre-R16-W
    // behaviour exactly.
    await user.clear(screen.getByLabelText(/in a sentence or two/i));
    await fillText(user, screen.getByLabelText(/in a sentence or two/i), 'Drafts client emails from notes.');
    await user.click(screen.getByRole('radio', { name: /your firm.s in-house model platform/i }));
    // R16-W W-9 (D-79): PLAT-INTERNAL-ML allows both Zone B and Zone C, so
    // the new follow-up is required. "No — the platform passes it to an
    // outside supplier's AI" keeps this fixture's zone (Zone B) exactly as
    // it was before W-9 — the earliest-letter default — so none of this
    // test's other assertions change.
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

    // P8-C01 upstream fix: R3-JU-1 requires an explicit jurisdiction answer.
    // These journeys previously proceeded having told the engine nothing about
    // where the system operates.
    await user.click(screen.getByRole('checkbox', { name: /somewhere else, or not sure/i }));
    await user.click(screen.getByRole('radio', { name: /^no$/i }));
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    // R16-W W-3 (D-69): the form path no longer visits graph_review (whose
    // heading this used to check) — it goes straight to the summary.
    expect(await screen.findByText(/here.s what we understood/i)).toBeInTheDocument();
    expect(screen.getAllByText(/email drafting tool/i).length).toBeGreaterThan(0);
    // R16-W W-3 (D-69): the form path reaches confirmation directly from
    // Continue (FORM_SUBMITTED finds no questions for this graph, same as
    // the old Proceed-from-graph_review did) — there is no Proceed button
    // on this path to click any more.
    await confirmAllNodes(user);

    expect(await screen.findByRole('heading', { name: /confirm and evaluate/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /confirm and evaluate/i }));

    expect(await screen.findByText('Verdict', { selector: '.verdict__eyebrow' })).toBeInTheDocument();
    expect(screen.getByText(/approved|rejected/i)).toBeInTheDocument();

    // V1.3: proof-carrying controls — this Client-PII flow requires
    // CTRL-ENC-01, which carries the starter YAML's worked verification
    // example, so the CS-1 panel shows a VERIFIED chip.
    expect(screen.getByText(/the control set, with evidence status/i)).toBeInTheDocument();
    expect(screen.getByText('VERIFIED')).toBeInTheDocument();

    // Self-verifying, not just structurally implied: the LLM boundary was
    // never touched on the no-api-key path (review finding, pass 1).
    expect(mockCreate).not.toHaveBeenCalled();
  }, SLOW_FLOW_MS);

  it('P4-C03: an uncertain node generates a real question, answering it reaches a verdict', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: {
            input_nodes: [],
            processing_nodes: [
              {
                id: 'p1',
                label: 'risk scoring model',
                model_type: 'traditional-ml',
                autonomy_level: 0,
                data_zone: 'Zone A',
                vendor: 'internal',
                replaces_prior_model: false,
                uncertain: true,
              },
            ],
            output_nodes: [
              {
                id: 'o1',
                label: 'risk score',
                action_type: 'recommend',
                exposure: 'internal-only',
                decision_bindingness: 'material',
                output_reversibility: 'reversible',
                scale: 'limited',
              },
            ],
            edges: [],
            jurisdictions: [],
          },
        },
      ],
    });

    const user = userEvent.setup({ delay: null });
    render(<App />);

    const input = screen.getByLabelText(/what ai tool do you want to use/i);
    await fillText(user, input, 'A risk scoring tool for internal use');
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i}, DUP_CHECK_WAIT));

    expect((await screen.findAllByText(/risk scoring model/i)).length).toBeGreaterThan(0);
    await confirmAllNodes(user);
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));

    // A real targeted question renders — not a skipped/fake step. V1.2-B:
    // the progress line now carries the budget + provisional tier.
    expect(await screen.findByText(/question 1 of \d+/i)).toBeInTheDocument();

    // Answer every generated question until the flow reaches confirmation.
    // V2-C: a realistic policy generates questions across many fields, so
    // this answers whatever option the current question offers rather than
    // assuming a data-zone question (budget can reach 15).
    for (let i = 0; i < 20; i++) {
      const confirmButton = screen.queryByRole('button', { name: /confirm and evaluate/i });
      if (confirmButton) break;
      const firstOption = document.querySelector<HTMLButtonElement>('.questionnaire__options button');
      if (firstOption) {
        await user.click(firstOption);
        continue;
      }
      const submitAnswer = screen.queryByRole('button', { name: /submit answer/i });
      if (submitAnswer) {
        const textbox = screen.getByLabelText(/your answer/i);
        await fillText(user, textbox, 'test answer');
        await user.click(submitAnswer);
        continue;
      }
      break;
    }

    // A real "Confirm and evaluate" click is required — UC-6 attestation,
    // not a silent pass-through (P4-C04).
    expect(await screen.findByRole('heading', { name: /confirm and evaluate/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /confirm and evaluate/i }));

    expect(await screen.findByText('Verdict', { selector: '.verdict__eyebrow' })).toBeInTheDocument();
  }, SLOW_FLOW_MS);

  it('P4-C04: writes graph_confirmed then verdict_produced to the audit trail, in order, before showing the verdict (TC-UC-6-01/02/03)', async () => {
    const uniqueLabel = 'audit ordering check model';
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: {
            input_nodes: [],
            processing_nodes: [
              {
                id: 'p1',
                label: uniqueLabel,
                model_type: 'traditional-ml',
                autonomy_level: 0,
                data_zone: 'Zone C',
                vendor: 'internal',
                replaces_prior_model: false,
                basis_quotes: PROCESSING_QUOTES,
              },
            ],
            output_nodes: [
              {
                id: 'o1',
                label: 'output',
                action_type: 'recommend',
                exposure: 'internal-only',
                decision_bindingness: 'material',
                output_reversibility: 'reversible',
                scale: 'limited',
                basis_quotes: OUTPUT_QUOTES,
              },
            ],
            edges: [],
            jurisdictions: [],
          },
        },
      ],
    });

    const user = userEvent.setup({ delay: null });
    render(<App />);

    const input = screen.getByLabelText(/what ai tool do you want to use/i);
    await fillText(user, input, 'Audit ordering check: verifies that confirmation events precede verdict events, replaying sequence numbers, timestamps, writer identities, and tie breaking behaviour across rapid consecutive submissions' + DETAIL);
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i}, DUP_CHECK_WAIT));
    expect(await screen.findByText(uniqueLabel)).toBeInTheDocument();
    await confirmAllNodes(user);
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));
    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    expect(await screen.findByText('Verdict', { selector: '.verdict__eyebrow' })).toBeInTheDocument();

    const { getUseCases } = await import('../../store/register');
    const { getAll } = await import('../../store/audit');
    const useCases = await getUseCases('all');
    const useCase = useCases.find((u) => u.label === uniqueLabel);
    expect(useCase).toBeDefined();

    const events = await getAll(useCase!.use_case_id);
    // R16-F F-3 (DR7-05): the creation record is now written at Confirm, on
    // EITHER path (not only the form path) — the description path used to
    // have none at all. Order on the trail is fixed: use_case_created ->
    // graph_confirmed -> verdict_produced.
    expect(events.map((e) => e.event_type)).toEqual(['use_case_created', 'graph_confirmed', 'verdict_produced']);
    expect(new Date(events[1]!.occurred_at).getTime()).toBeLessThanOrEqual(new Date(events[2]!.occurred_at).getTime());

    expect(events[0]!.actor).toBe('1LoD'); // actor is the documented hardcoded-role placeholder (identity on the creation record)

    const verdictPayload = events[2]!.payload;
    expect(verdictPayload.type).toBe('verdict_produced');
    if (verdictPayload.type === 'verdict_produced') {
      expect(verdictPayload.verdict.use_case_id).toBe(useCase!.use_case_id); // the stored verdict_produced payload is the full Verdict object
      expect(verdictPayload.verdict.status).toBeDefined();
      expect(verdictPayload.verdict.attested_by).toBe('1LoD');
    }
  });

  // explore-001 D-001 (Critical, practitioner-classified). Double-clicking
  // "Confirm and evaluate" wrote graph_confirmed TWICE to the append-only
  // audit trail, produced no verdict, created no register node, and left the
  // user stranded on the Graph step.
  //
  // The old guard was `if (state.step !== 'confirmation') return`. dispatch()
  // is asynchronous, so two synchronous clicks both read the SAME render's
  // closure, both see 'confirmation', and both proceed — exactly the failure
  // CLAUDE.md describes: "a state update lands too late to prevent the second
  // call." Code review C-5 fixed this class in sample-register.ts; the
  // user-facing path had the same hole.
  it('explore-001 D-001: double-clicking confirm writes graph_confirmed exactly once', async () => {
    const uniqueLabel = 'double click guard model';
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: {
            input_nodes: [],
            processing_nodes: [
              {
                id: 'p1',
                label: uniqueLabel,
                model_type: 'traditional-ml',
                autonomy_level: 0,
                data_zone: 'Zone C',
                vendor: 'internal',
                replaces_prior_model: false,
                basis_quotes: PROCESSING_QUOTES,
              },
            ],
            output_nodes: [
              {
                id: 'o1',
                label: 'output',
                action_type: 'recommend',
                exposure: 'internal-only',
                decision_bindingness: 'material',
                output_reversibility: 'reversible',
                scale: 'limited',
                basis_quotes: OUTPUT_QUOTES,
              },
            ],
            edges: [{ from: 'p1', to: 'o1' }],
            jurisdictions: [],
          },
        },
      ],
    });

    const user = userEvent.setup({ delay: null });
    render(<App />);

    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'Double click guard: protects the confirm button against impatient repeated presses, suppressing duplicate submissions, stray keyboard activations, and bouncing touchscreen taps during slow renders' + DETAIL);
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i}, DUP_CHECK_WAIT));
    expect(await screen.findByText(uniqueLabel)).toBeInTheDocument();
    await confirmAllNodes(user);
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));

    const confirm = await screen.findByRole('button', { name: /confirm and evaluate/i });
    // Two clicks with NO await between them — the real double-click, where
    // both handlers run against the same pre-dispatch state.
    confirm.click();
    confirm.click();

    expect(await screen.findByText('Verdict', { selector: '.verdict__eyebrow' })).toBeInTheDocument();

    const { getUseCases } = await import('../../store/register');
    const { getAll } = await import('../../store/audit');
    const useCase = (await getUseCases('all')).find((u) => u.label === uniqueLabel);
    expect(useCase).toBeDefined();

    const events = await getAll(useCase!.use_case_id);
    const confirms = events.filter((e) => e.event_type === 'graph_confirmed');
    // The damage is un-cleanable: the trail is append-only by design.
    expect(confirms).toHaveLength(1);
    // R16-F F-3 (DR7-05): use_case_created is now written at Confirm too.
    expect(events.map((e) => e.event_type)).toEqual(['use_case_created', 'graph_confirmed', 'verdict_produced']);
  });

  it('P4-C04: a correction made during graph review survives through questionnaire and confirmation to the graph_confirmed audit event (BC-P4C04-03, review finding: full chain, not just one hop)', async () => {
    const uniqueLabel = 'correction survival check model';
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: {
            input_nodes: [],
            processing_nodes: [
              {
                id: 'p1',
                label: uniqueLabel,
                model_type: 'traditional-ml',
                autonomy_level: 0,
                data_zone: 'Zone C',
                vendor: 'internal',
                replaces_prior_model: false,
                basis_quotes: PROCESSING_QUOTES,
              },
            ],
            output_nodes: [
              {
                id: 'o1',
                label: 'output',
                action_type: 'recommend',
                exposure: 'internal-only',
                decision_bindingness: 'material',
                output_reversibility: 'reversible',
                scale: 'limited',
                basis_quotes: OUTPUT_QUOTES,
              },
            ],
            edges: [],
            jurisdictions: [],
          },
        },
      ],
    });

    const user = userEvent.setup({ delay: null });
    render(<App />);

    const input = screen.getByLabelText(/what ai tool do you want to use/i);
    await fillText(user, input, 'Correction survival check: carries a reviewer edited field through questionnaire, attestation, persistence, and ledger entry without losing that human override anywhere downstream' + DETAIL);
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i}, DUP_CHECK_WAIT));
    expect(await screen.findByText(uniqueLabel)).toBeInTheDocument();

    // Make a real correction in graph_review before proceeding — V1.1-C01:
    // a genuine field edit through the correction editor, not the old
    // stub that appended " (corrected)" to the label.
    await user.click(screen.getAllByRole('button', { name: /^edit$/i })[0]!);
    const zoneSelect = await screen.findByLabelText(`${uniqueLabel} — where your information goes`);
    await user.selectOptions(zoneSelect, 'Zone B');
    expect(zoneSelect).toHaveValue('Zone B');

    await confirmAllNodes(user);
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));
    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    expect(await screen.findByText('Verdict', { selector: '.verdict__eyebrow' })).toBeInTheDocument();

    const { getUseCases } = await import('../../store/register');
    const { getAll } = await import('../../store/audit');
    const useCases = await getUseCases('all');
    const useCase = useCases.find((u) => u.label === uniqueLabel);
    expect(useCase).toBeDefined();

    const events = await getAll(useCase!.use_case_id);
    const confirmedEvent = events.find((e) => e.event_type === 'graph_confirmed');
    expect(confirmedEvent).toBeDefined();
    if (confirmedEvent?.payload.type === 'graph_confirmed') {
      expect(confirmedEvent.payload.corrections_count).toBe(1);
    }
  });

  it('TC-UC-6-02: with every question answered but the graph unconfirmed, no verdict is produced until the explicit Confirm click', async () => {
    const uniqueLabel = 'confirmation gate model';
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: {
            input_nodes: [],
            processing_nodes: [
              {
                id: 'p1',
                label: 'confirmation gate model',
                model_type: 'traditional-ml',
                autonomy_level: 0,
                data_zone: 'Zone C',
                vendor: 'internal',
                replaces_prior_model: false,
                basis_quotes: PROCESSING_QUOTES,
              },
            ],
            output_nodes: [
              {
                id: 'o1',
                label: 'output',
                action_type: 'recommend',
                exposure: 'internal-only',
                decision_bindingness: 'material',
                output_reversibility: 'reversible',
                scale: 'limited',
                basis_quotes: OUTPUT_QUOTES,
              },
            ],
            edges: [],
            jurisdictions: [],
          },
        },
      ],
    });

    const user = userEvent.setup({ delay: null });
    render(<App />);

    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'Confirmation gate probe: sits at the final step waiting for a human to press the confirm control before any classification is computed, stored, or displayed to anyone' + DETAIL);
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i}, DUP_CHECK_WAIT));
    expect(await screen.findByText(uniqueLabel)).toBeInTheDocument();
    await confirmAllNodes(user);
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));

    // Awaiting confirmation: the Confirm control is offered, nothing has run.
    const confirm = await screen.findByRole('button', { name: /confirm and evaluate/i });
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByText('Verdict', { selector: '.verdict__eyebrow' })).not.toBeInTheDocument();

    const { getUseCases } = await import('../../store/register');
    const { getAll } = await import('../../store/audit');
    const before = (await getUseCases('all')).find((u) => u.label === uniqueLabel);
    // Nothing may be written for this case before the click (no use case row,
    // so certainly no verdict_produced event).
    expect(before).toBeUndefined();

    // Explicit Confirm: now a verdict exists, so the checks above can tell the difference.
    await user.click(confirm);
    expect(await screen.findByText('Verdict', { selector: '.verdict__eyebrow' })).toBeInTheDocument();
    const useCase = (await getUseCases('all')).find((u) => u.label === uniqueLabel);
    expect(useCase).toBeDefined();
    const events = await getAll(useCase!.use_case_id);
    expect(events.map((e) => e.event_type)).toContain('verdict_produced');
  }, SLOW_FLOW_MS);

  it('TC-UC-6-03: the graph_confirmed event carries the corrected graph version (2), not the original (1)', async () => {
    const uniqueLabel = 'confirmed version model';
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: {
            input_nodes: [],
            processing_nodes: [
              {
                id: 'p1',
                label: 'confirmed version model',
                model_type: 'traditional-ml',
                autonomy_level: 0,
                data_zone: 'Zone C',
                vendor: 'internal',
                replaces_prior_model: false,
                basis_quotes: PROCESSING_QUOTES,
              },
            ],
            output_nodes: [
              {
                id: 'o1',
                label: 'output',
                action_type: 'recommend',
                exposure: 'internal-only',
                decision_bindingness: 'material',
                output_reversibility: 'reversible',
                scale: 'limited',
                basis_quotes: OUTPUT_QUOTES,
              },
            ],
            edges: [],
            jurisdictions: [],
          },
        },
      ],
    });

    const user = userEvent.setup({ delay: null });
    render(<App />);

    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'Confirmed version probe: records which numbered edition of the reviewed picture a human signed off, after exactly one reviewer correction was applied to the first extraction' + DETAIL);
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i}, DUP_CHECK_WAIT));
    expect(await screen.findByText(uniqueLabel)).toBeInTheDocument();

    // Exactly one correction on the review screen (version 1 -> 2).
    await user.click(screen.getAllByRole('button', { name: /^edit$/i })[0]!);
    await user.selectOptions(await screen.findByLabelText(`${uniqueLabel} — where your information goes`), 'Zone B');

    await confirmAllNodes(user);
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));
    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    expect(await screen.findByText('Verdict', { selector: '.verdict__eyebrow' })).toBeInTheDocument();

    const { getUseCases } = await import('../../store/register');
    const { getAll } = await import('../../store/audit');
    const useCase = (await getUseCases('all')).find((u) => u.label === uniqueLabel);
    expect(useCase).toBeDefined();
    const events = await getAll(useCase!.use_case_id);
    const confirmed = events.find((e) => e.event_type === 'graph_confirmed');
    expect(confirmed).toBeDefined();
    if (confirmed?.payload.type !== 'graph_confirmed') throw new Error('wrong payload type');
    expect(confirmed.payload.corrections_count).toBe(1);
    expect(confirmed.payload.graph_version).toBe(2);
    expect(confirmed.payload.graph_version).not.toBe(1);
  }, SLOW_FLOW_MS);

  it('P5-C01: "Correct this classification?" re-enters graph_review, reuses the same use case, and appends graph_corrected/verdict_corrected without touching the original verdict_produced event', async () => {
    const uniqueLabel = 'correction flow check model';
    const buildGraphInput = () => ({
      input_nodes: [],
      processing_nodes: [
        {
          id: 'p1',
          label: uniqueLabel,
          model_type: 'traditional-ml',
          autonomy_level: 0,
          data_zone: 'Zone C',
          vendor: 'internal',
          replaces_prior_model: false,
          basis_quotes: PROCESSING_QUOTES,
        },
      ],
      output_nodes: [
        {
          id: 'o1',
          label: 'output',
          action_type: 'recommend',
          exposure: 'internal-only',
          decision_bindingness: 'material',
          output_reversibility: 'reversible',
          scale: 'limited',
          basis_quotes: OUTPUT_QUOTES,
        },
      ],
      edges: [],
      jurisdictions: [],
    });
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', name: 'extract_graph', input: buildGraphInput() }],
    });

    const user = userEvent.setup({ delay: null });
    render(<App />);

    // First pass: reach a verdict normally.
    const input = screen.getByLabelText(/what ai tool do you want to use/i);
    await fillText(user, input, 'Quartz xylophone probe intake: calibrates resonant percussion sensors, logging amplitude drift, harmonic distortion, bar temperature, mallet hardness, and tuning fork reference offsets nightly' + DETAIL);
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i}, DUP_CHECK_WAIT));
    expect(await screen.findByText(uniqueLabel)).toBeInTheDocument();
    await confirmAllNodes(user);
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));
    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    expect(await screen.findByText('Verdict', { selector: '.verdict__eyebrow' })).toBeInTheDocument();

    const { getUseCases } = await import('../../store/register');
    const { getAll } = await import('../../store/audit');
    const useCasesBefore = await getUseCases('all');
    const useCase = useCasesBefore.find((u) => u.label === uniqueLabel);
    expect(useCase).toBeDefined();
    const useCaseId = useCase!.use_case_id;

    const eventsBeforeCorrection = await getAll(useCaseId);
    // R16-F F-3 (DR7-05): use_case_created is now written at Confirm too.
    expect(eventsBeforeCorrection.map((e) => e.event_type)).toEqual([
      'use_case_created',
      'graph_confirmed',
      'verdict_produced',
    ]);
    const originalVerdictEvent = eventsBeforeCorrection[2]!;

    // Click "Correct this classification?" — re-enters graph_review.
    await user.click(screen.getByRole('button', { name: /correct this classification/i }));
    expect(await screen.findByText(/check what we read from your description/i)).toBeInTheDocument();

    // Make a real field correction, then walk back through to a new verdict.
    await user.click(screen.getAllByRole('button', { name: /^edit$/i })[0]!);
    await user.selectOptions(await screen.findByLabelText(`${uniqueLabel} — where your information goes`), 'Zone B');
    await confirmAllNodes(user);
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));
    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    expect(await screen.findByText('Verdict', { selector: '.verdict__eyebrow' })).toBeInTheDocument();

    // Same use case, not a new one (BC-P5C01-01).
    const useCasesAfter = await getUseCases('all');
    const matchingUseCases = useCasesAfter.filter((u) => u.use_case_id === useCaseId);
    expect(matchingUseCases).toHaveLength(1);

    const eventsAfterCorrection = await getAll(useCaseId);
    expect(eventsAfterCorrection.map((e) => e.event_type)).toEqual([
      'use_case_created',
      'graph_confirmed',
      'verdict_produced',
      'graph_corrected',
      'verdict_corrected',
    ]);

    // The original verdict_produced event is byte-identical — never modified.
    expect(eventsAfterCorrection[2]).toEqual(originalVerdictEvent);

    const verdictCorrectedEvent = eventsAfterCorrection[4]!;
    if (verdictCorrectedEvent.payload.type === 'verdict_corrected') {
      expect(verdictCorrectedEvent.payload.original_verdict_id).toBe(
        originalVerdictEvent.payload.type === 'verdict_produced' ? originalVerdictEvent.payload.verdict.id : undefined,
      );
    }
  }, SLOW_FLOW_MS);

  it('a genuine engine failure (no-track-match) shows an error and returns to graph_review instead of hanging on "Evaluating..." forever (live-found gap, now fixed)', async () => {
    localStorage.clear(); // no API key — structured form path, reproduces the exact scenario found live

    // Oracle round 001 made the shipped track list TOTAL, so no combination of
    // form answers can reach no-track-match any more. The error path still
    // matters: a firm edits its own policy, and a policy with a routing hole
    // must produce an honest error rather than a wrong verdict or a hang. So
    // the hole is now injected deliberately, by loading a policy whose tracks
    // have been stripped to TRACK-III only.
    const holed = appetiteYaml.replace(
      /^tracks:[\s\S]*?(?=^tiers:)/m,
      `tracks:
  - id: "TRACK-III"
    name: "Track III — AI Governance"
    description: "Deliberately incomplete track list — test fixture only"
    regulatory_basis: "test fixture"
    conditions:
      - field: "model_type"
        value: { in: ["llm"] }
    short_circuit: true

`,
    );
    setCurrentPolicyYaml(holed);

    const user = userEvent.setup({ delay: null });
    render(<App />);

    const input = screen.getByLabelText(/what ai tool do you want to use/i);
    await fillText(user, input, 'No track match check');
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i}, DUP_CHECK_WAIT));
    expect(await screen.findByText(/new pre-check — tell us about the ai you want to use/i)).toBeInTheDocument();

    // R16-B: adapted to the new questions, same no-track-match scenario —
    // deep-learning (via "recognises things in images, sound or
    // documents") matches no track in the holed policy above; "read"
    // conveniently keeps the same non-binding, no-6a-follow-up shape the
    // retired form field had.
    await fillText(user, screen.getByLabelText(/what do you want to call it/i), 'No track match tool');
    // R16-W W-1 (D-67): see the earlier test's comment on the same clear().
    await user.clear(screen.getByLabelText(/in a sentence or two/i));
    await fillText(user, screen.getByLabelText(/in a sentence or two/i), 'A tool with no matching track rule.');
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    await user.click(screen.getByRole('radio', { name: /recognises things in images, sound or documents/i }));
    await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
    await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
    await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
    await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
    await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
    await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
    // P8-C01 upstream fix: R3-JU-1 requires an explicit jurisdiction answer.
    // These journeys previously proceeded having told the engine nothing about
    // where the system operates.
    await user.click(screen.getByRole('checkbox', { name: /somewhere else, or not sure/i }));
    await user.click(screen.getByRole('radio', { name: /^no$/i }));
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    // R16-W W-3 (D-69): no Proceed button on this path any more — the form
    // reaches confirmation directly (see the P4-C02 test's comment above).
    await confirmAllNodes(user);
    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));

    // Must NOT hang on "Evaluating..." — a real error renders and the
    // flow returns to a working screen, not a dead end.
    expect(await screen.findByRole('alert')).toHaveTextContent(/evaluation could not complete/i);
    // R16-F F-2 (DR7-04): a form-path graph now returns to the FORM itself
    // (filled in, same case), never graph_review — which this path has
    // never visited on the way forward either (W-3). Superseded assertion:
    // this test used to check for "Confirm what we understood"
    // (graph_review's heading), which this path cannot reach.
    expect(await screen.findByLabelText(/what do you want to call it/i)).toHaveValue('No track match tool');
  }, SLOW_FLOW_MS);

  it('TC-LC-2-02 (P6-C02): a High-tier verdict routes the register node to lifecycle_stage "pre_checked" pending 2LoD approval, not auto-approved', async () => {
    localStorage.clear(); // no API key — structured form path, deterministic tier

    const user = userEvent.setup({ delay: null });
    render(<App />);

    const input = screen.getByLabelText(/what ai tool do you want to use/i);
    await fillText(user, input, 'High tier routing check');
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i}, DUP_CHECK_WAIT));
    expect(await screen.findByText(/new pre-check — tell us about the ai you want to use/i)).toBeInTheDocument();

    // R16-B: adapted to the new questions — traditional-ml via "gives a
    // score..." + "they can show which factors drove each result",
    // suggests/recommend with material weight, client-facing exposure
    // (still the TIER-HIGH trigger, policy/appetite.yaml).
    await fillText(user, screen.getByLabelText(/what do you want to call it/i), 'High tier tool');
    // R16-W W-1 (D-67): see the earlier test's comment on the same clear().
    await user.clear(screen.getByLabelText(/in a sentence or two/i));
    await fillText(user, screen.getByLabelText(/in a sentence or two/i), 'Client-facing decision support.');
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    await user.click(screen.getByRole('radio', { name: /gives a score, ranking, flag, category or forecast/i }));
    await user.click(screen.getByRole('radio', { name: /they can show which factors drove each result/i }));
    await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
    await user.click(screen.getByRole('radio', { name: /suggests, ranks or flags things/i }));
    await user.click(screen.getByRole('radio', { name: /usually what a decision is based on/i }));
    // client-facing exposure trips TIER-HIGH (policy/appetite.yaml).
    await user.click(screen.getByRole('radio', { name: /clients or customers/i }));
    await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
    await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
    await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
    // P8-C01 upstream fix: R3-JU-1 requires an explicit jurisdiction answer.
    // These journeys previously proceeded having told the engine nothing about
    // where the system operates.
    await user.click(screen.getByRole('checkbox', { name: /somewhere else, or not sure/i }));
    await user.click(screen.getByRole('radio', { name: /^no$/i }));
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    // R16-W W-3 (D-69): no Proceed button on this path any more — the form
    // reaches confirmation directly (see the P4-C02 test's comment above).
    await confirmAllNodes(user);
    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));

    expect(await screen.findByText('Verdict', { selector: '.verdict__eyebrow' })).toBeInTheDocument();

    await user.click(screen.getByText('▤ Register'));
    await user.selectOptions(screen.getByLabelText(/viewing as/i), '2LoD');
    // R15-C1 renegotiation: the Stage filter chip now renders the
    // STAGE_LABELS plain word ("Awaiting 2LoD sign-off"), not the raw
    // 'pre_checked' enum — same assertion, updated text.
    expect(await screen.findByRole('button', { name: 'Awaiting 2LoD sign-off' })).toBeInTheDocument();
  }, SLOW_FLOW_MS);

  it('P5-C02: the real LLM-generated reasoning trace renders in the verdict details section', async () => {
    // Distinguish calls by shape, not by queue order: extractGraph() and
    // confirmSemanticDuplicate() both pass `tools`; generateReasoningTrace()
    // does not. Robust against an extra duplicate-check LLM call shifting
    // a plain call-order queue out of sync.
    mockCreate.mockImplementation(async (args: { tools?: unknown }) => {
      if (args.tools) {
        return { content: [{ type: 'tool_use', name: 'extract_graph', input: MOCK_GRAPH_INPUT }] };
      }
      return {
        content: [{ type: 'text', text: 'Track II applies because the model produces a quantitative recommendation.' }],
      };
    });

    const user = userEvent.setup({ delay: null });
    render(<App />);

    const input = screen.getByLabelText(/what ai tool do you want to use/i);
    await fillText(user, input, 'Zxqvw plumbing inventory forecaster xyzzy: projects pipe fitting, valve, gasket, solder, flange, and copper elbow stock levels per warehouse, seasonal demand, supplier lead times, and reorder cadence' + DETAIL);
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i}, DUP_CHECK_WAIT));
    expect(await screen.findByText(/check what we read from your description/i)).toBeInTheDocument();
    await confirmAllNodes(user);
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));
    // FX7-6: slow IndexedDB, not an early read — this wait follows the
    // graph confirmation's case lock and hash-chained writes, which can pass
    // the 1 s default on a loaded machine. Same precedent as
    // confirmAndReachVerdict in IntakeFlow.r16d2.test.tsx.
    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }, { timeout: 5000 }));

    expect(await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 })).toBeInTheDocument();
    await user.click(screen.getByText(/reasoning trace/i));
    expect(
      await screen.findByText(/track ii applies because the model produces a quantitative recommendation/i),
    ).toBeInTheDocument();
  });

  it('TC-LC-4-02 (P7-C01): Counterpoise evaluates itself on first launch and appears in the register with a real verdict, without any user action', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);

    // No submission action taken — the seed fires from a mount effect, not
    // from anything the user does. Only navigate to see it.
    await user.click(screen.getByText('▤ Register'));
    await user.selectOptions(screen.getByLabelText(/viewing as/i), '2LoD');

    expect(await screen.findByText('Counterpoise (self-assessment)')).toBeInTheDocument();
  });

  it('P7-C03 Part A: Counterpoise self-assessment seeds exactly once across a genuine app re-mount, not just within one mount (extends P7-C01\'s single-mount race test)', async () => {
    const { selfAssessmentSeeded } = await import('../../seeds/aigate-self-assessment');

    const first = render(<App />);
    await first.findByText('▤ Register');
    // Wait for the ACTUAL seed completion signal the module exports for
    // exactly this purpose, not a guessed tick count. runSeed is a multi-hop
    // async chain (a DB read, then two sequential IndexedDB writes through
    // audit.ts's write queue); a single setTimeout(0) macrotask does not
    // reliably outlast that chain under CPU load from parallel test files —
    // this was the CI flake (2026-09-01).
    await selfAssessmentSeeded();
    first.unmount();

    const second = render(<App />);
    await second.findByText('▤ Register');
    await selfAssessmentSeeded();

    const { exportAll } = await import('../../store/register');
    const { nodes } = await exportAll();
    const aigateNodes = nodes.filter((n) => n.node_id === 'aigate-self-assessment');
    expect(aigateNodes).toHaveLength(1);
  });

  // TC-R15-C4-04: this test opens the R15-C4 YAML-editor disclosure (via the
  // shared Fold component's summary text) before finding the textarea; the
  // real-save assertions below (queued count, header policy version bump)
  // are otherwise unchanged.
  it('[TC-R15-C4-04] P7-C03 Part B: saving a valid policy via the Appetite framework editor is a real save — queues re-evaluation for existing active use cases and updates the header\'s policy version', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);

    await user.click(screen.getByText('§ Appetite framework'));
    // R15-C4: the YAML editor is behind a closed-by-default disclosure.
    // design-review round 4: migrated to the shared Fold component (native
    // <details>/<summary>) — click the summary text, not a button role.
    await user.click(await screen.findByText(/edit the rulebook as yaml/i));
    const textarea = await screen.findByLabelText(/policy yaml/i);
    const originalYaml = (textarea as HTMLTextAreaElement).value;
    // Version-agnostic: derive the current version and bump it, rather than
    // hardcoding a pair. The hardcoded 1.0 -> 1.1 broke the moment the starter
    // policy was itself revised (oracle round 001), which is a test coupled to
    // content it is not testing.
    const currentVersion = /version: "([^"]+)"/.exec(originalYaml)?.[1];
    expect(currentVersion).toBeDefined();
    const bumped = `${currentVersion!.split('.')[0]}.${Number(currentVersion!.split('.')[1]) + 1}`;

    const updatedYaml = originalYaml.replace(`version: "${currentVersion}"`, `version: "${bumped}"`);
    await user.click(textarea);
    await user.clear(textarea);
    await user.paste(updatedYaml);

    // SettingsPanel also has a (disabled) "Save" button — disambiguate.
    const saveButtons = screen.getAllByRole('button', { name: /^save$/i });
    await user.click(saveButtons.find((b) => !b.hasAttribute('disabled'))!);

    expect(await screen.findByText(/policy saved.*queued for re-evaluation/i)).toBeInTheDocument();

    // Header badge reflects the newly saved version without a page reload.
    // (findAllBy: the V1.2-C appetite view's meta line also shows the
    // version, so a single-match query would be ambiguous.)
    expect((await screen.findAllByText(new RegExp(`policy v${bumped.replace('.', '\\.')}`))).length).toBeGreaterThan(0);

    // A real save, not just a UI message: at least one previously-existing
    // active use case (from earlier tests in this file, sharing IndexedDB)
    // now has a re_evaluation_queued event for the new version.
    const { getUseCases } = await import('../../store/register');
    const { getAll } = await import('../../store/audit');
    const allUseCases = await getUseCases('all');
    let foundQueuedEvent = false;
    for (const uc of allUseCases) {
      const events = await getAll(uc.use_case_id);
      if (
        events.some(
          (e) => e.event_type === 're_evaluation_queued' && e.payload.type === 're_evaluation_queued' && e.payload.policy_version === bumped,
        )
      ) {
        foundQueuedEvent = true;
        break;
      }
    }
    expect(foundQueuedEvent).toBe(true);
  });

  it('V1.2-C / UC-2: the duplicate match card is REDACTED for 1LoD — tier shown, label never rendered', async () => {
    localStorage.clear(); // no API key -> keyword duplicate path, and role defaults to 1LoD
    const { addNode } = await import('../../store/register');
    const existingLabel = 'quorix zenbat flumtrek engine';
    await addNode({
      node_id: crypto.randomUUID(),
      node_type: 'use_case',
      label: existingLabel,
      created_at: new Date().toISOString(),
      metadata: {
        node_type: 'use_case',
        submitted_by: 'someone-else',
        lifecycle_stage: 'approved',
        current_verdict_id: null,
        tier: 'High',
        track: 'II',
      },
    });

    const user = userEvent.setup({ delay: null });
    render(<App />);
    const input = screen.getByLabelText(/what ai tool do you want to use/i);
    // High keyword overlap with the seeded label -> keyword duplicate hit.
    await fillText(user, input, 'quorix zenbat flumtrek checker');
    await user.click(screen.getByRole('button', { name: /^next/i }));

    // V2-B: the duplicate check is a GATE — the card renders at the
    // duplicate step and the flow does not proceed without confirmation.
    // R16-W §4 (D-74): title and 1LoD text replaced — the tier is dropped
    // for 1LoD (the drop IS the point: no tier claim on the redacted card).
    expect(await screen.findByText(/something similar has been checked before/i)).toBeInTheDocument();
    expect(screen.queryByText(/tier High/)).not.toBeInTheDocument();
    expect(screen.getByText(/a similar use is already on your firm.s register/i)).toBeInTheDocument();
    // BC-V12C-02: the matched label must be unreachable in the DOM.
    expect(screen.queryByText(new RegExp(existingLabel, 'i'))).not.toBeInTheDocument();
    // The next step is only reachable via explicit confirmation.
    expect(screen.queryByText(/new pre-check — tell us about the ai you want to use/i)).not.toBeInTheDocument();
    // R16-W §4 (D-74): the match-found continue button reads "Mine is
    // different — continue →", not the retired "This is a new use case →".
    await user.click(screen.getByRole('button', { name: /mine is different/i }));
    expect(await screen.findByText(/new pre-check — tell us about the ai you want to use/i)).toBeInTheDocument();
  });

  it('V1.2-C / UC-2: 2LoD sees the full duplicate match detail including the label', async () => {
    localStorage.clear();
    localStorage.setItem('aigate:role', '2LoD');
    const { addNode } = await import('../../store/register');
    const existingLabel = 'brindle vexomat quarlune pipeline';
    await addNode({
      node_id: crypto.randomUUID(),
      node_type: 'use_case',
      label: existingLabel,
      created_at: new Date().toISOString(),
      metadata: {
        node_type: 'use_case',
        submitted_by: 'someone-else',
        lifecycle_stage: 'approved',
        current_verdict_id: null,
        tier: 'Medium',
        track: 'III',
      },
    });

    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'brindle vexomat quarlune probe');
    await user.click(screen.getByRole('button', { name: /^next/i }));

    // V2-B gate: 2LoD sees the full match detail at the duplicate step.
    expect(await screen.findByText(/something similar has been checked before/i)).toBeInTheDocument();
    expect(screen.getByText(existingLabel)).toBeInTheDocument();
  });
});

// Round 4 — charter 004 D-004. The register row was titled from
// `graph.input_nodes[0].label`, which the form builds as
// "<use case name> — input" (build-graph-from-form.ts:51). Every use case
// submitted through the intake form therefore appeared in the register — and
// on the 2LoD sign-off page — under the name of the data feeding it rather
// than its own. The seeds set the label directly, which is why they looked
// correct and this went unnoticed for four rounds.
describe('Register row naming (charter 004 D-004)', () => {
  it('titles the use case after the system, not after its input node', async () => {
    localStorage.clear();
    const user = userEvent.setup({ delay: null });
    render(<App />);

    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'A tool that drafts client emails');
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i}, DUP_CHECK_WAIT));

    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
    // R16-B: adapted to the new questions — same Client PII / in-house
    // platform (Zone B, vendor internal) / drafted-for-review scenario.
    await fillText(user, screen.getByLabelText(/what do you want to call it/i), 'Mortgage servicing assistant');
    // R16-W W-1 (D-67): see the earlier test's comment on the same clear().
    await user.clear(screen.getByLabelText(/in a sentence or two/i));
    await fillText(user, screen.getByLabelText(/in a sentence or two/i), 'Drafts servicing letters.');
    await user.click(screen.getByRole('radio', { name: /your firm.s in-house model platform/i }));
    // R16-W W-9 (D-79): PLAT-INTERNAL-ML allows both Zone B and Zone C, so
    // the new follow-up is required. "No — the platform passes it to an
    // outside supplier's AI" keeps this fixture's zone (Zone B) exactly as
    // it was before W-9 — the earliest-letter default — so none of this
    // test's other assertions change.
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

    // R16-W W-3 (D-69): the form path reaches confirmation directly — no
    // graph_review heading and no Proceed button on this path any more.
    await screen.findByText(/here.s what we understood/i);
    await confirmAllNodes(user);
    await screen.findByRole('heading', { name: /confirm and evaluate/i });
    await user.click(screen.getByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' });

    await user.click(screen.getByText('▤ Register'));

    // The register lists AI systems. Its row is the system's name.
    expect(await screen.findByText('Mortgage servicing assistant')).toBeInTheDocument();
    expect(screen.queryByText(/Mortgage servicing assistant — input/)).not.toBeInTheDocument();
  }, SLOW_FLOW_MS);
});

// Round 4 — charter 004 D-001. The description was captured, used for
// extraction, and never shown to the user again — so the screen that asks
// "is this graph right?" gave them nothing to check it against.
describe('The submitted description is shown back (charter 004 D-001)', () => {
  it('renders what the user typed on the graph review screen [TC-UC-1-01]', async () => {
    localStorage.clear();
    const user = userEvent.setup({ delay: null });
    render(<App />);

    const typed = 'A tool that drafts client emails from CRM notes';
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), typed);
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i}, DUP_CHECK_WAIT));

    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
    // R16-W W-1 (D-67, charter 004 D-001's own guarantee carried onto the
    // form path): the form path no longer visits graph_review at all
    // (W-3), so "what you told us" is no longer re-displayed there for
    // this path — it is instead PRE-FILLED into question 2, editable,
    // which is the new mechanism that keeps the submitter's own words from
    // being silently dropped. Asserted before it is deliberately edited
    // below (editing it is what carries the description forward from then
    // on, per W-1).
    expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue(typed);

    // R16-B: adapted to the new questions — same Client PII / in-house
    // platform (Zone B, vendor internal) / drafted-for-review scenario.
    await fillText(user, screen.getByLabelText(/what do you want to call it/i), 'Email drafter');
    await user.clear(screen.getByLabelText(/in a sentence or two/i));
    await fillText(user, screen.getByLabelText(/in a sentence or two/i), 'Drafts emails.');
    await user.click(screen.getByRole('radio', { name: /your firm.s in-house model platform/i }));
    // R16-W W-9 (D-79): PLAT-INTERNAL-ML allows both Zone B and Zone C, so
    // the new follow-up is required. "No — the platform passes it to an
    // outside supplier's AI" keeps this fixture's zone (Zone B) exactly as
    // it was before W-9 — the earliest-letter default — so none of this
    // test's other assertions change.
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

    // R16-W W-3 (D-69): the form path reaches the summary directly.
    await screen.findByText(/here.s what we understood/i);
  }, SLOW_FLOW_MS);
});
