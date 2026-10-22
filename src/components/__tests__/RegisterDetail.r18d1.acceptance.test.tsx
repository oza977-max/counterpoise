import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import RegisterDetail from '../RegisterDetail';
import { addNode } from '../../store/register';
import { append } from '../../store/audit';
import { loadPolicy } from '../../store/policy';
import type { RegisterNode, AuditEvent } from '../../store/types';
import type { Verdict } from '../../types/verdict';
import type { PolicyFile } from '../../engine/types';

// R18-D1 acceptance test (outside-in, written first, committed alone while Red).
// TDD-1 of build/prompts/R18-D1.md: a saved case whose graph_confirmed carries answer_sources
// (specs/intake-flow.md §27.13) is opened on the register. The detail must say, in plain words:
//   - which model read the description, and where it ran (past tense, as configured);
//   - "N of M answers were filled in by a model and confirmed by you, and K was changed by you";
//   - per answer, who supplied it, with its quote;
//   - when a quote is no longer in the description;
//   - and never the present-tense "never leaves your computer" promise.
// The record is hand-made, realistic, and shaped exactly as §27.13 says. D1 builds the read side only.

const shippedYaml = readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8');
const loaded = loadPolicy(shippedYaml);
if (!loaded.valid) throw new Error('shipped policy invalid');
const POLICY: PolicyFile = loaded.policy;

const DESCRIPTION = 'It reads client names and account details to draft emails. Our UK team will use it every morning.';

const ANSWER_SOURCES = {
  reads: [{ model: 'alpha:7b', place: 'this-computer', host: 'http://localhost:11434' }],
  answers: [
    { question_id: '1', value: 'Client email drafting assistant', origin: 'typed' },
    {
      question_id: '5',
      value: ['people'],
      origin: 'prefilled_confirmed',
      quotes: [{ option: 'people', quote: 'client names' }],
      quote_in_final_description: true,
      read: 0,
    },
    {
      question_id: '7',
      value: 'clients',
      origin: 'prefilled_confirmed',
      quotes: [{ option: 'clients', quote: 'our customers' }],
      quote_in_final_description: false,
      read: 0,
    },
    { question_id: '9', value: 'yes', origin: 'typed' },
    {
      question_id: '11',
      value: ['US'],
      origin: 'prefilled_changed',
      quotes: [{ option: 'UK', quote: 'Our UK team' }],
      changed_from: [{ option: 'UK', quote: 'Our UK team' }],
      quote_in_final_description: true,
      read: 0,
    },
  ],
};

function verdict(useCaseId: string): Verdict {
  return {
    status: 'approved_with_controls',
    tier: 'High',
    track: 'II',
    binding_constraint: 'INV-DATA-01',
    binding_path: 'client notes → drafting model → drafted email',
    controls: [],
    downstream_reviews: [],
    conditions: { hypotheses: [] },
    policy_version: '1.3',
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
      hard_lines_checked: 4,
      invariants_checked: 6,
      tripped_invariants: [],
      binding_reason: null,
      binding_regulatory_basis: null,
    },
    id: `v-${useCaseId}`,
    use_case_id: useCaseId,
    living_status: 'approved',
    living_status_updated_at: '2026-10-22T09:00:00.000Z',
    attested_by: '1LoD',
    attested_at: '2026-10-22T09:00:00.000Z',
  } as unknown as Verdict;
}

async function seed(useCaseId: string, sources: unknown | undefined) {
  await addNode({
    node_id: useCaseId,
    node_type: 'use_case',
    label: 'Client email drafting assistant',
    created_at: '2026-10-22T09:00:00.000Z',
    metadata: { node_type: 'use_case', submitted_by: '1LoD', lifecycle_stage: 'pre_checked' },
  } as RegisterNode);
  const base = { use_case_id: useCaseId, actor: '1LoD' } as const;
  await append({
    ...base,
    event_id: crypto.randomUUID(),
    event_type: 'use_case_created',
    occurred_at: '2026-10-22T09:00:00.000Z',
    payload: { type: 'use_case_created', description: DESCRIPTION, intake_method: 'structured_form' },
  } as AuditEvent);
  await append({
    ...base,
    event_id: crypto.randomUUID(),
    event_type: 'graph_confirmed',
    occurred_at: '2026-10-22T09:00:01.000Z',
    payload: {
      type: 'graph_confirmed',
      graph_id: 'g-1',
      graph_version: 1,
      corrections_count: 0,
      ...(sources !== undefined ? { answer_sources: sources } : {}),
    },
  } as AuditEvent);
  await append({
    ...base,
    event_id: crypto.randomUUID(),
    event_type: 'verdict_produced',
    occurred_at: '2026-10-22T09:00:02.000Z',
    payload: { type: 'verdict_produced', verdict: verdict(useCaseId) },
  } as AuditEvent);
}

describe('R18-D1 acceptance: the register shows where each answer came from', () => {
  it('TC-R18-GI-5-01: acceptance - the detail names the read, the share line, each origin and the gone quote', async () => {
    const id = crypto.randomUUID();
    await seed(id, ANSWER_SOURCES);
    const { container } = render(<RegisterDetail useCaseId={id} role="2LoD" policy={POLICY} onBack={() => {}} />);

    // The model and where it ran, in the past tense, as configured.
    expect(await screen.findByText(/read by alpha:7b by the program at http:\/\/localhost:11434 on the computer in use/i)).toBeInTheDocument();

    // The same share line as the confirmation screen, counted from the rows: 2 confirmed, 1 changed, 4 select answers.
    expect(
      screen.getByText('2 of 4 answers were filled in by a model and confirmed by you, and 1 was changed by you'),
    ).toBeInTheDocument();

    // One line per answer: the value in words, then who supplied it.
    const list = screen.getByRole('list', { name: /where each answer came from/i });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    const row = (re: RegExp) => rows.find((r) => re.test(r.textContent ?? ''))!;

    expect(row(/Client email drafting assistant/)).toHaveTextContent(/typed by you/);
    expect(row(/Tick all that apply/)).toHaveTextContent(/filled from your description and confirmed by you — “client names”/);
    expect(row(/Which countries does it involve/)).toHaveTextContent(/United States/);
    expect(row(/Which countries does it involve/)).toHaveTextContent(/changed by you \(from United Kingdom — “Our UK team”/);

    // The quote that has left the description is said so, on its own answer only.
    expect(row(/Who ends up seeing/)).toHaveTextContent(/the quote is no longer in your description/);
    expect(row(/Tick all that apply/)).not.toHaveTextContent(/no longer in your description/);

    // The register never repeats the present-tense promise.
    expect(container.textContent).not.toMatch(/never leaves your computer/i);
  });
});
