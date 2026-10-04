import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractGraph } from './graph-extractor';
import type { DataFlowGraph } from '../engine/types';

// gvm-test 007 close-out, chunk 3. Only the model SDK boundary is mocked.

const MODEL_REPLY = {
  input_nodes: [{ id: 'i1', label: 'client relationship notes', data_class: 'Client PII', data_zone: 'Zone B' }],
  processing_nodes: [
    {
      id: 'p1',
      label: 'email drafting model',
      model_type: 'llm',
      autonomy_level: 1,
      data_zone: 'Zone B',
      vendor: 'internal',
      replaces_prior_model: false,
    },
  ],
  output_nodes: [
    {
      id: 'o1',
      label: 'drafted email',
      action_type: 'draft',
      exposure: 'internal-only',
      decision_bindingness: 'non-binding',
      output_reversibility: 'reversible',
      scale: 'limited',
    },
  ],
  edges: [{ from: 'i1', to: 'p1' }, { from: 'p1', to: 'o1' }],
  jurisdictions: [],
};

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

// What the structure of a graph is, with the two fields that are meant to differ
// between runs (a fresh id and the extraction time) taken out.
function structure(g: DataFlowGraph) {
  const { id: _id, extracted_at: _at, ...rest } = g;
  return {
    node_types: {
      input: g.input_nodes.length,
      processing: g.processing_nodes.length,
      output: g.output_nodes.length,
    },
    edges: g.edges.map((e) => `${e.from}->${e.to}`),
    rest,
  };
}

describe('TC-UC-3-03 — extraction is structurally consistent', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('aigate:api-key', 'test-key');
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ content: [{ type: 'tool_use', name: 'extract_graph', input: MODEL_REPLY }] });
  });

  it('TC-UC-3-03: five extractions of one description give the same node types, edge directions and request to the model', async () => {
    const description = 'drafts client emails using relationship notes';
    const graphs: DataFlowGraph[] = [];
    for (let i = 0; i < 5; i++) {
      const result = await extractGraph(description);
      expect(result.ok).toBe(true);
      if (result.ok) graphs.push(result.value.graph);
    }
    expect(graphs).toHaveLength(5);

    const first = structure(graphs[0]!);
    expect(first.node_types).toEqual({ input: 1, processing: 1, output: 1 });
    expect(first.edges).toEqual(['i1->p1', 'p1->o1']);
    for (const g of graphs) expect(structure(g)).toEqual(first);

    // The only things allowed to differ run to run are the per-run id and time.
    expect(new Set(graphs.map((g) => g.id)).size).toBe(5);

    // The request is the same every time, and forces the one structured tool,
    // so the model cannot answer in a different shape.
    expect(mockCreate).toHaveBeenCalledTimes(5);
    const requests = mockCreate.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(new Set(requests).size).toBe(1);
    expect(mockCreate.mock.calls[0]![0].tool_choice).toEqual({ type: 'tool', name: 'extract_graph' });
  });

  it('a reply whose structure would break the node-type contract is refused rather than passed on', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', name: 'extract_graph', input: { ...MODEL_REPLY, processing_nodes: 'not a list' } }],
    });
    const result = await extractGraph('drafts client emails using relationship notes');
    expect(result.ok).toBe(false);
  });
});
