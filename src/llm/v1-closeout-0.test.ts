import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractGraph } from './graph-extractor';
import { questionsForGuessedFields } from '../engine/question-generator';

// gvm-test 007 close-out, chunk 0. The real extractor (real quote checking, real
// Zod gate) and the real question generator; the only mock is the model SDK.

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

const reply = (input: unknown) => ({ content: [{ type: 'tool_use', name: 'extract_graph', input }] });

// (A) an internal summariser whose description states everything the checks need.
const DESC_A =
  'An internal document summariser. It is a large language model, in-house vendor, running in Zone C, no autonomy, replacing no prior model; it reads internal policy documents, informs staff, internal only, advisory, reversible, limited scale.';
const GRAPH_A = {
  input_nodes: [
    { id: 'i1', label: 'policy documents', data_class: 'Internal', data_zone: 'Zone C', basis_quotes: { data_class: 'internal policy documents', data_zone: 'Zone C' } },
  ],
  processing_nodes: [
    {
      id: 'p1', label: 'summariser', model_type: 'llm', autonomy_level: 0, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false,
      basis_quotes: { model_type: 'large language model', autonomy_level: 'no autonomy', data_zone: 'Zone C', vendor: 'in-house vendor', replaces_prior_model: 'replacing no prior model' },
    },
  ],
  output_nodes: [
    {
      id: 'o1', label: 'summary', action_type: 'inform', exposure: 'internal-only', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited',
      basis_quotes: { action_type: 'informs staff', exposure: 'internal only', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited scale' },
    },
  ],
  edges: [],
  jurisdictions: [],
};

// (B) a client-facing trading assistant described in one breath: it never says
// what data it uses, where it runs, or what kind of decision it feeds.
const DESC_B = 'A client-facing trading assistant that suggests trades to our clients.';
const GRAPH_B = {
  input_nodes: [{ id: 'i1', label: 'client positions', data_class: 'Client PII', data_zone: 'Zone B', basis_quotes: {} }],
  processing_nodes: [
    {
      id: 'p1', label: 'trading assistant', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false,
      basis_quotes: { model_type: '', autonomy_level: '', data_zone: '', vendor: '', replaces_prior_model: '' },
    },
  ],
  output_nodes: [
    {
      id: 'o1', label: 'trade suggestion', action_type: 'trade', exposure: 'client-facing', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited',
      decision_type: 'trading',
      basis_quotes: { action_type: 'suggests trades', exposure: 'client-facing', decision_bindingness: '', output_reversibility: '', scale: '', decision_type: '' },
    },
  ],
  edges: [],
  jurisdictions: [],
};

async function questionsFor(description: string, graph: unknown) {
  mockCreate.mockResolvedValueOnce(reply(graph));
  const r = await extractGraph(description);
  if (!r.ok) throw new Error(`extraction failed: ${JSON.stringify(r.error)}`);
  return questionsForGuessedFields(r.value.guessed, r.value.graph);
}

describe('TC-UC-4-04: questions follow what each description leaves unstated — not one fixed list', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('aigate:api-key', 'test-key');
    mockCreate.mockReset();
  });

  it('TC-UC-4-04: the summariser and the trading assistant get different questions; only the trading assistant is asked about client data and market-sensitive output', async () => {
    const a = await questionsFor(DESC_A, GRAPH_A);
    const b = await questionsFor(DESC_B, GRAPH_B);

    // A states every checked field, so nothing about it needs asking.
    expect(a).toEqual([]);
    // B leaves most of it unstated, so it is asked — and the lists differ.
    expect(b.length).toBeGreaterThan(0);
    expect(b.map((q) => q.field)).not.toEqual(a.map((q) => q.field));

    const bFields = b.map((q) => q.field);
    // Client data handling (what the data is, where it goes) ...
    expect(bFields).toContain('data_class');
    expect(bFields).toContain('data_zone');
    // ... and the market-sensitive side of the output (what it helps decide).
    expect(bFields).toContain('decision_type');
    // A, which gave a quote for each, is asked about none of these.
    for (const f of ['data_class', 'data_zone', 'decision_type']) expect(a.map((q) => q.field)).not.toContain(f);
  });

  it('a field the description DOES state is not asked about, even for the trading assistant', async () => {
    const b = await questionsFor(DESC_B, GRAPH_B);
    const fields = b.map((q) => q.field);
    // "client-facing" and "suggests trades" are quoted verbatim in DESC_B.
    expect(fields).not.toContain('exposure');
    expect(fields).not.toContain('action_type');
  });
});
