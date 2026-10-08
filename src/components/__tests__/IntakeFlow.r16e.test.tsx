import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import IntakeFlow from '../IntakeFlow';
import { setCurrentPolicyYaml } from '../../store/policy-source';
import appetiteYaml from '../../../policy/appetite.yaml?raw';
import { fillText, DUP_CHECK_WAIT, pressNext } from './fillText';

// R16-E — the description-first path speaks the form's words. End-to-end
// coverage for what only the real App/IntakeFlow wiring can prove: both
// extraction-error call sites, "Answer the questions instead", the
// graph_review screen's identical copy across its three entries, and a
// genuine evaluation failure on the description path.
//
// TDD-2 mock budget = 1: the Anthropic SDK boundary only, hoisted once for
// the whole file (the established pattern — see GraphReview.r6/r9's own
// files) — individual tests vary its behaviour with mockResolvedValueOnce/
// mockRejectedValueOnce, never a second, per-test module mock.
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

const DRAFT_KEY = 'aigate:intake-draft';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('aigate:api-key', 'test-key');
  mockCreate.mockReset();
});

describe('R16-E §5 (D-104): both extraction-error call sites share one message', () => {
  it('TC-R16-E-64: a fresh extraction failure and a retry failure show the identical plain message for the same error kind, plus "Answer the questions instead"', async () => {
    mockCreate.mockRejectedValue(new Error('network down'));
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'A probe for the extraction error screen.');
    await pressNext(user);
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));

    expect(await screen.findByText('We couldn’t reach the description reader just now.')).toBeInTheDocument();
    expect(screen.getByText('You can try again, or answer the questions yourself instead.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /answer the questions instead/i })).toBeInTheDocument();

    // Retry — the SAME call site's sibling — shows the identical message.
    // Verifying R16-E: the retry button was "Try extraction again" — machine
    // vocabulary the guard missed (it banned "extract" only as a whole word).
    await user.click(screen.getByRole('button', { name: /^try again$/i }));
    expect(await screen.findByText('We couldn’t reach the description reader just now.')).toBeInTheDocument();
  });
});

describe('R16-E §5: "Answer the questions instead" (SWITCH_TO_FORM)', () => {
  it('TC-R16-E-65: switches to the guided form with the typed description carried into question 2', async () => {
    mockCreate.mockRejectedValue(new Error('network down'));
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const marker = 'A probe for switching to the form after an extraction failure.';
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), marker);
    await pressNext(user);
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
    await screen.findByText('We couldn’t reach the description reader just now.');

    await user.click(screen.getByRole('button', { name: /answer the questions instead/i }));
    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
    expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue(marker);
    expect(screen.queryByText('We couldn’t reach the description reader just now.')).not.toBeInTheDocument();
  });
});

describe('R16-E §4: the graph_review screen reads identically across its three entries (DR7-32/DC-7)', () => {
  function sharedGraph() {
    return {
      id: 'g1',
      version: 1,
      intake_method: 'llm' as const,
      extracted_at: '2026-01-01T00:00:00.000Z',
      input_nodes: [{ id: 'i1', label: 'x', data_class: 'Internal' as const, data_zone: 'Zone C' as const }],
      processing_nodes: [
        { id: 'p1', label: 'x', model_type: 'ml' as const, autonomy_level: 1, data_zone: 'Zone C' as const, vendor: 'internal', replaces_prior_model: false },
      ],
      output_nodes: [
        { id: 'o1', label: 'x', action_type: 'read' as const, exposure: 'internal-only' as const, decision_bindingness: 'non-binding' as const, output_reversibility: 'reversible' as const, scale: 'limited' as const },
      ],
      edges: [],
      jurisdictions: [],
    };
  }

  it('TC-R16-E-66: a fresh entry renders "Check what we read from your description"', () => {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'graph_review',
        description: 'd',
        graph: sharedGraph(),
        graphVersion: 1,
        corrections: [],
        useCaseId: 'uc-fresh',
        unconfirmedNodeIds: [],
        jurisdictionsConfirmed: true,
      }),
    );
    render(<IntakeFlow />);
    expect(screen.getByText('Check what we read from your description')).toBeInTheDocument();
  });

  it('TC-R16-E-66b: a correction re-entry (originalVerdictId set) renders the identical heading', () => {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'graph_review',
        description: 'd',
        graph: sharedGraph(),
        graphVersion: 1,
        corrections: [],
        useCaseId: 'uc-correction',
        originalVerdictId: 'v-1',
      }),
    );
    render(<IntakeFlow />);
    expect(screen.getByText('Check what we read from your description')).toBeInTheDocument();
  });

  it('TC-R16-E-66c: an evaluation-failure re-entry (afterFailedEvaluation set) renders the identical heading', () => {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'graph_review',
        description: 'd',
        graph: sharedGraph(),
        graphVersion: 1,
        corrections: [],
        useCaseId: 'uc-eval-failure',
        jurisdictionsConfirmed: true,
        afterFailedEvaluation: true,
      }),
    );
    render(<IntakeFlow />);
    expect(screen.getByText('Check what we read from your description')).toBeInTheDocument();
  });

  it('TC-R16-E-66d: a genuine evaluation failure on the description path re-enters graph_review with the new plain message', async () => {
    const holed = appetiteYaml.replace(
      /^tracks:[\s\S]*?(?=^tiers:)/m,
      `tracks:\n  - id: "TRACK-III"\n    name: "Track III"\n    description: "test fixture"\n    regulatory_basis: "test fixture"\n    conditions:\n      - field: "model_type"\n        value: { in: ["llm"] }\n    short_circuit: true\n\n`,
    );
    setCurrentPolicyYaml(holed);
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: {
            input_nodes: [],
            processing_nodes: [
              {
                id: 'p1',
                label: 'x',
                model_type: 'deep-learning',
                autonomy_level: 0,
                data_zone: 'Zone C',
                vendor: 'internal',
                replaces_prior_model: false,
                basis_quotes: {
                  model_type: 'deep learning image reader',
                  autonomy_level: 'no autonomy',
                  data_zone: 'our own systems',
                  vendor: 'built in-house',
                  replaces_prior_model: 'replacing no prior model',
                },
              },
            ],
            output_nodes: [
              {
                id: 'o1',
                label: 'x',
                action_type: 'read',
                exposure: 'internal-only',
                decision_bindingness: 'non-binding',
                output_reversibility: 'reversible',
                scale: 'limited',
                basis_quotes: {
                  action_type: 'It reads documents',
                  exposure: 'internal only',
                  decision_bindingness: 'non-binding',
                  output_reversibility: 'reversible',
                  scale: 'limited scale',
                },
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
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), // BC-003: long enough that every quote in the mock reply is a verbatim
      // substring of what is typed here.
      'No-track-match description probe: a deep learning image reader built in-house, in our own systems, with no autonomy, replacing no prior model. It reads documents, internal only, non-binding, reversible, at limited scale.');
    await pressNext(user);
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
    await screen.findByText('Check what we read from your description');
    for (;;) {
      const b = screen.queryAllByRole('button', { name: /^(this is right|i.ve checked this — it.s right)$/i })[0];
      if (!b) break;
      await user.click(b);
    }
    const jur = screen.queryByRole('button', { name: /^(these are right|none of these — continue)$/i });
    if (jur) await user.click(jur);
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong working out the result/i);
    expect(screen.getByText('Check what we read from your description')).toBeInTheDocument();
  });
});

async function reachTargetedQuestion(user: ReturnType<typeof userEvent.setup>, description: string) {
  render(<App />);
  await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), description);
  await pressNext(user);
  await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
  await screen.findByText('Check what we read from your description');
  // Re-query every iteration — clicking one card's confirm button
  // re-renders and removes it, which can leave a snapshot array's later
  // entries stale (same reasoning WalkingSkeleton.test.tsx's confirmAllNodes
  // documents).
  for (;;) {
    const b = screen.queryAllByRole('button', { name: /^(this is right|i.ve checked this — it.s right)$/i })[0];
    if (!b) break;
    await user.click(b);
  }
  const jur = screen.queryByRole('button', { name: /^(these are right|none of these — continue)$/i });
  if (jur) await user.click(jur);
  await user.click(screen.getByRole('button', { name: /^continue$/i }));
}

describe('R16-E BC-3: confirming the extractor\'s own access set writes no correction', () => {
  it('TC-R16-E-67: ticking the identical set the extractor already guessed records no correction', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: {
            input_nodes: [{ id: 'i1', label: 'notes', data_class: 'Internal', data_zone: 'Zone C', basis_quotes: { data_class: 'support tickets', data_zone: 'our own systems' } }],
            processing_nodes: [
              {
                id: 'p1',
                label: 'ticket agent',
                model_type: 'agentic',
                autonomy_level: 2,
                data_zone: 'Zone C',
                vendor: 'internal',
                replaces_prior_model: false,
                system_access_scope: ['shared_infrastructure'],
                multi_instance_coordination: 'no',
                basis_quotes: {
                  model_type: 'in-house agent',
                  autonomy_level: 'acts on its own',
                  data_zone: 'our own systems',
                  vendor: 'built in-house',
                  replaces_prior_model: 'replaces no earlier model',
                  multi_instance_coordination: 'works alone',
                  // system_access_scope deliberately has no quote — guessed
                  // (and forced guessed anyway on an agentic node, §1).
                },
              },
            ],
            output_nodes: [
              {
                id: 'o1',
                label: 'ticket updates',
                action_type: 'execute',
                exposure: 'internal-only',
                decision_bindingness: 'material',
                output_reversibility: 'reversible',
                scale: 'limited',
                basis_quotes: {
                  action_type: 'updates support tickets',
                  exposure: 'people can read the updates',
                  decision_bindingness: 'people can read the updates',
                  output_reversibility: 'can be corrected',
                  scale: 'a small trial',
                },
              },
            ],
            edges: [],
            jurisdictions: [],
          },
        },
      ],
    });
    const user = userEvent.setup({ delay: null });
    await reachTargetedQuestion(
      user,
      'This in-house agent updates support tickets. It acts on its own. It works alone, with no coordination. ' +
        'It was built in-house, and runs entirely on our own systems. People can read the updates it makes. ' +
        'Any mistake it makes can be corrected. It started as a small trial. It replaces no earlier model.',
    );

    await screen.findByText(/what it can get into by itself/i);
    await user.click(screen.getByRole('checkbox', { name: /it runs on computers or servers shared with other automated tools/i }));
    await user.click(screen.getByRole('button', { name: /^done$/i }));

    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });

    const { getAllForExport } = await import('../../store/audit');
    const all = await getAllForExport();
    const confirmed = all.find((e) => e.payload.type === 'graph_confirmed');
    expect(confirmed).toBeDefined();
    if (confirmed?.payload.type !== 'graph_confirmed') return;
    // Re-ticking the IDENTICAL set the extractor already guessed is not a
    // correction (BC-3) — only the system_access_scope answer was given,
    // and it changed nothing by content.
    expect(confirmed.payload.corrections_count).toBe(0);
  });
});

describe('R16-E DR7-29: decision_type "Something else" follow-up, end to end', () => {
  it('TC-R16-E-68: picking "Something else" and typing a description leaves decision_type unset and records decision_type_other', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: {
            input_nodes: [{ id: 'i1', label: 'notes', data_class: 'Internal', data_zone: 'Zone C', basis_quotes: { data_class: 'flags items for review', data_zone: 'our own systems' } }],
            processing_nodes: [
              {
                id: 'p1',
                label: 'triage model',
                model_type: 'ml',
                autonomy_level: 1,
                data_zone: 'Zone C',
                vendor: 'internal',
                replaces_prior_model: false,
                basis_quotes: { model_type: 'a model', autonomy_level: 'a person checks', data_zone: 'our own systems', vendor: 'built in-house', replaces_prior_model: 'replaces no earlier model' },
              },
            ],
            output_nodes: [
              {
                id: 'o1',
                label: 'triage flags',
                action_type: 'recommend',
                exposure: 'internal-only',
                decision_bindingness: 'advisory',
                output_reversibility: 'reversible',
                scale: 'limited',
                decision_type: 'operational',
                basis_quotes: {
                  action_type: 'flags items for review',
                  exposure: 'a person checks each one',
                  decision_bindingness: 'a person checks each one',
                  output_reversibility: 'our own systems',
                  scale: 'built in-house',
                  // decision_type deliberately has no quote — guessed.
                },
              },
            ],
            edges: [],
            jurisdictions: [],
          },
        },
      ],
    });
    const user = userEvent.setup({ delay: null });
    await reachTargetedQuestion(
      user,
      'A model flags items for review. A person checks each one. It was built in-house. It runs on our own systems. It replaces no earlier model.',
    );

    await screen.findByText(/which of these does it help decide/i);
    await user.click(screen.getByRole('button', { name: /something else — describe it/i }));
    await screen.findByText(/what does it help decide/i);
    await fillText(user, screen.getByLabelText(/your answer/i), 'Collections prioritisation');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });

    // The typed follow-up reached the record: the summary's own "what it
    // helps decide" line (rendered moments ago, pre-confirm) already
    // proved decision_type_other was set and decision_type stayed unset
    // (summaryDecisionLine's own precedence) — this checks it also
    // reached the evaluated verdict, via the provisional "could still
    // change" line naming the unclassified type.
    expect(screen.getByText(/you described a decision we don.t have a rule for.*collections prioritisation/i)).toBeInTheDocument();
  });
});

describe('R16-E DR7-28: vendor "Not on this list", end to end', () => {
  it('TC-R16-E-69: typing a name wraps it as "{name} (not on your firm\'s list)"', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: {
            input_nodes: [{ id: 'i1', label: 'notes', data_class: 'Internal', data_zone: 'Zone B', basis_quotes: { data_class: 'drafts text', data_zone: 'a specialist supplier tool' } }],
            processing_nodes: [
              {
                id: 'p1',
                label: 'drafting tool',
                model_type: 'llm',
                autonomy_level: 1,
                data_zone: 'Zone B',
                vendor: 'a specialist supplier',
                replaces_prior_model: false,
                basis_quotes: { model_type: 'drafts text', autonomy_level: 'a person checks', data_zone: 'a specialist supplier tool', vendor: '', replaces_prior_model: 'replaces no earlier model' },
              },
            ],
            output_nodes: [
              {
                id: 'o1',
                label: 'drafts',
                action_type: 'draft',
                exposure: 'internal-only',
                decision_bindingness: 'non-binding',
                output_reversibility: 'reversible',
                scale: 'limited',
                basis_quotes: {
                  action_type: 'drafts text',
                  exposure: 'a person checks each one',
                  decision_bindingness: 'a person checks each one',
                  output_reversibility: 'a specialist supplier tool',
                  scale: 'a person checks each one',
                },
              },
            ],
            edges: [],
            jurisdictions: [],
          },
        },
      ],
    });
    const user = userEvent.setup({ delay: null });
    await reachTargetedQuestion(user, 'A specialist supplier tool drafts text. A person checks each one. It replaces no earlier model.');

    await screen.findByText(/which supplier is it/i);
    await user.click(screen.getByRole('button', { name: /^not on this list$/i }));
    await screen.findByText(/what is it called/i);
    await fillText(user, screen.getByLabelText(/your answer/i), 'Acme Drafting Co');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));

    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
    expect(screen.getAllByText(/acme drafting co \(not on your firm.s list\)/i).length).toBeGreaterThan(0);
  });
});

describe('R16-E: a "Not sure" answer on this path reaches the "No" screen\'s own assumptions list', () => {
  it('TC-R16-E-70: "Not sure" on output_reversibility trips HL-001 and the "No" screen names it', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: {
            input_nodes: [],
            processing_nodes: [
              {
                id: 'p1',
                label: 'client update model',
                model_type: 'ml',
                autonomy_level: 4,
                data_zone: 'Zone C',
                vendor: 'internal',
                replaces_prior_model: false,
                basis_quotes: { model_type: 'a model', autonomy_level: 'acts entirely on its own', data_zone: 'built in-house', vendor: 'built in-house', replaces_prior_model: 'replaces no earlier model' },
              },
            ],
            output_nodes: [
              {
                id: 'o1',
                label: 'client notifications',
                action_type: 'execute',
                exposure: 'client-facing',
                decision_bindingness: 'binding',
                output_reversibility: 'reversible',
                scale: 'limited',
                basis_quotes: {
                  action_type: 'sends client updates',
                  exposure: 'clients see these updates directly',
                  decision_bindingness: 'they take effect immediately',
                  scale: 'a small trial',
                  // output_reversibility deliberately has no quote — guessed.
                },
              },
            ],
            edges: [],
            jurisdictions: [],
          },
        },
      ],
    });
    const user = userEvent.setup({ delay: null });
    await reachTargetedQuestion(
      user,
      'A model sends client updates. It acts entirely on its own. It was built in-house. Clients see these ' +
        'updates directly, and they take effect immediately. It started as a small trial. It replaces no earlier model.',
    );

    await screen.findByText(/can the mistake be caught and put right/i);
    await user.click(screen.getByRole('button', { name: /^not sure$/i }));

    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });

    expect(screen.getByText(/this is based on answers you weren.t sure about/i)).toBeInTheDocument();
    expect(screen.getByText(/whether a mistake can be put right/i)).toBeInTheDocument();
  });
});

describe('R16-E §3: the multi-select answer reaches the graph in canonical order, however it was ticked', () => {
  it('TC-R16-E-72: ticking deployment_authority before shared_infrastructure still records the canonical order on the graph', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: {
            input_nodes: [],
            processing_nodes: [
              {
                id: 'p1',
                label: 'ops agent',
                model_type: 'agentic',
                autonomy_level: 2,
                data_zone: 'Zone C',
                vendor: 'internal',
                replaces_prior_model: false,
                multi_instance_coordination: 'no',
                basis_quotes: {
                  model_type: 'an agent',
                  autonomy_level: 'acts on its own',
                  data_zone: 'our own systems',
                  vendor: 'built in-house',
                  replaces_prior_model: 'replaces no earlier model',
                  multi_instance_coordination: 'works alone',
                },
              },
            ],
            output_nodes: [
              {
                id: 'o1',
                label: 'ops updates',
                action_type: 'execute',
                exposure: 'internal-only',
                decision_bindingness: 'material',
                output_reversibility: 'reversible',
                scale: 'limited',
                basis_quotes: {
                  action_type: 'updates records',
                  exposure: 'for our own team',
                  decision_bindingness: 'for our own team',
                  output_reversibility: 'can be corrected',
                  scale: 'for our own team',
                },
              },
            ],
            edges: [],
            jurisdictions: [],
          },
        },
      ],
    });
    const user = userEvent.setup({ delay: null });
    await reachTargetedQuestion(
      user,
      'An agent updates records. It acts on its own. It works alone. It was built in-house, and runs on our own systems, for our own team. Any mistake can be corrected. It replaces no earlier model.',
    );

    await screen.findByText(/what it can get into by itself/i);
    // Ticked in the REVERSE of canonical order (deployment_authority,
    // then credentialed_systems — canonical is shared_infrastructure,
    // credentialed_systems, deployment_authority).
    await user.click(screen.getByRole('checkbox', { name: /it can change software or settings, or deploy updates, without a person/i }));
    await user.click(screen.getByRole('checkbox', { name: /it has its own logins, passwords or access tokens for other systems/i }));
    await user.click(screen.getByRole('button', { name: /^done$/i }));

    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });

    // Rendered in canonical order on the reviewer's own record grid —
    // normaliseAccessScope's job (coerceAnswerValue), not the UI's.
    expect(
      screen.getByText(/credentialed_systems.*deployment_authority|credentialed systems.*deployment authority/i),
    ).toBeInTheDocument();
  });
});

// §8's guard test for the WHOLE `graph_review` block (heading, checklist,
// GraphView's cards and the jurisdictions panel together) and for the
// extraction-error screen — GraphView.r16e.test.tsx and
// QuestionnaireStep.r16e.test.tsx cover those two components in isolation;
// this covers the surrounding IntakeFlow chrome too.
const BANNED = /\bZone A\b|\bZone B\b|\bZone C\b|\bdata_class\b|\bDATA_ZONE\b|\bautonomy\b|\bLLM\b|\bHITL\b|\bbinding\b|\bgraph\b|\bextract\w*|model proposed|\bguess(?:ed|ing)\b|local model|\bunregistered\b|parse-error|no-key/i;

describe('R16-E §8: the guard test, for the whole graph_review block and the extraction-error screen', () => {
  it('TC-R16-E-73: the graph_review block (heading, checklist, cards, jurisdictions panel) renders with none of the banned words', async () => {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'graph_review',
        description: 'd',
        graph: {
          id: 'g1',
          version: 1,
          intake_method: 'llm',
          extracted_at: '2026-01-01T00:00:00.000Z',
          input_nodes: [{ id: 'i1', label: 'notes', data_class: 'Client PII', data_zone: 'Zone A' }],
          processing_nodes: [
            {
              id: 'p1',
              label: 'agent',
              model_type: 'agentic',
              autonomy_level: 4,
              data_zone: 'Zone A',
              vendor: 'an AI service you weren’t sure about',
              replaces_prior_model: false,
              system_access_scope: ['shared_infrastructure'],
            },
          ],
          output_nodes: [
            {
              id: 'o1',
              label: 'actions',
              action_type: 'approve',
              exposure: 'client-facing',
              decision_bindingness: 'binding',
              output_reversibility: 'unknown',
              scale: 'limited',
            },
          ],
          edges: [],
          jurisdictions: ['UK'],
          // One card guessed (p1 — missing multi_instance_coordination
          // forces it, §1), one left to confirm (o1), one ignored
          // jurisdiction, one jurisdiction still to confirm — every
          // checklist branch and the jurisdictions panel all at once.
        },
        graphVersion: 1,
        corrections: [],
        useCaseId: 'uc-guard',
        unconfirmedNodeIds: ['o1'],
        guessedFields: { p1: ['multi_instance_coordination'] },
        ignoredJurisdictions: ['Internal'],
        jurisdictionsConfirmed: false,
      }),
    );
    const user = userEvent.setup({ delay: null });
    const { container } = render(<IntakeFlow />);
    // R16-E review pass 4: the "why" lines are hidden until clicked, so
    // a scan of the closed screen never read them — and one said
    // "binding". Open every card's before scanning.
    for (const b of screen.getAllByRole('button', { name: /why these values matter/i })) await user.click(b);
    expect(container.querySelectorAll('.graph-node__consequence').length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(BANNED);
  });

  it('TC-R16-E-74: the extraction-error screen renders with none of the banned words', async () => {
    mockCreate.mockRejectedValue(new Error('network down'));
    const user = userEvent.setup({ delay: null });
    const { container } = render(<App />);
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'A probe for the guard test.');
    await pressNext(user);
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
    await screen.findByRole('button', { name: /answer the questions instead/i });
    expect(container.textContent).not.toMatch(BANNED);
  });
});
