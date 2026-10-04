import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractGraph } from './graph-extractor';
import { questionsForGuessedFields } from '../engine/question-generator';

const MOCK_GRAPH_INPUT = {
  input_nodes: [{ id: 'i1', label: 'client relationship notes', data_class: 'Client PII', data_zone: 'Zone B' }],
  processing_nodes: [
    {
      id: 'p1',
      label: 'GPT-4 based email drafting model',
      model_type: 'llm',
      autonomy_level: 1,
      data_zone: 'Zone B',
      vendor: 'azure-openai-internal',
      replaces_prior_model: false,
      uncertain: true,
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

// Shared, hoisted mock fn so every `new Anthropic()` instance (one per
// extractGraph() call) reuses the same mock — required for per-test
// mockResolvedValueOnce overrides to actually take effect.
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

describe('extractGraph', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('calls the Anthropic API with a forced tool_use and returns a correctly structured DataFlowGraph', async () => {
    localStorage.setItem('aigate:api-key', 'test-key');

    const result = await extractGraph('drafts client emails using relationship notes');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.graph.input_nodes).toHaveLength(1);
      expect(result.value.graph.processing_nodes).toHaveLength(1);
      expect(result.value.graph.output_nodes).toHaveLength(1);
      expect(result.value.graph.edges).toHaveLength(2);
      expect(result.value.graph.intake_method).toBe('llm');
    }
  });

  it('TC-UC-3-02: preserves uncertain: true on nodes the LLM flagged as low-confidence', async () => {
    localStorage.setItem('aigate:api-key', 'test-key');

    const result = await extractGraph('drafts client emails');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.graph.processing_nodes[0]?.uncertain).toBe(true);
    }
  });

  it('returns no-api-key error cleanly when no key is configured', async () => {
    const result = await extractGraph('drafts client emails');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('no-api-key');
  });
});

describe('extractGraph — response validation (P4-C01 review finding: real Zod validation, not loose array checks)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('aigate:api-key', 'test-key');
  });

  it('rejects a response whose node uses a near-miss value outside the canonical vocabulary [TC-UC-3-04]', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: {
            ...MOCK_GRAPH_INPUT,
            input_nodes: [{ id: 'i1', label: 'notes', data_class: 'PII', data_zone: 'Zone B' }],
          },
        },
      ],
    });

    const result = await extractGraph('a use case with a malformed field');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('parse-error');
  });

  it('rejects a response missing required node fields', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: { ...MOCK_GRAPH_INPUT, processing_nodes: [{ id: 'p1', label: 'incomplete node' }] },
        },
      ],
    });

    const result = await extractGraph('a use case with a missing field');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('parse-error');
  });
});

// Local-provider dispatch (2026-08-16). extractGraph's provider ranking:
// Anthropic key wins; with no key but a configured local model, the local
// path runs — and its output passes through the SAME Zod gate, so a local
// model emitting off-vocabulary values fails to parse-error exactly as the
// Claude path would (the gate is the door, whoever knocks).
describe('extractGraph — local open-model provider dispatch', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    // The Anthropic mock is shared across this file; clear its history so
    // "the SDK was not called" means THIS test, not the file so far.
    mockCreate.mockClear();
  });

  function stubLocal(content: string) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('aigate:local-llm-url', 'http://localhost:11434');
    localStorage.setItem('aigate:local-llm-model', 'qwen3:4b');
    return fetchMock;
  }

  it('with no key and a local model configured, extracts through the local provider', async () => {
    const fetchMock = stubLocal(JSON.stringify(MOCK_GRAPH_INPUT));

    const result = await extractGraph('drafts client emails using relationship notes');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.graph.intake_method).toBe('llm');
      expect(result.value.graph.input_nodes[0]?.data_class).toBe('Client PII');
    }
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('a saved Anthropic key outranks the local model', async () => {
    const fetchMock = stubLocal(JSON.stringify(MOCK_GRAPH_INPUT));
    localStorage.setItem('aigate:api-key', 'test-key');

    const result = await extractGraph('drafts client emails');

    expect(result.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('off-vocabulary local output fails the Zod gate as parse-error, never reaching the engine', async () => {
    const bad = { ...MOCK_GRAPH_INPUT, input_nodes: [{ id: 'i1', label: 'x', data_class: 'PII', data_zone: 'Zone B' }] };
    stubLocal(JSON.stringify(bad));

    const result = await extractGraph('drafts client emails');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('parse-error');
  });

  it('with neither key nor local model, still returns no-api-key', async () => {
    const result = await extractGraph('drafts client emails');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('no-api-key');
  });
});

// R16-E §1 (D-08, D-65, DR7-25). system_access_scope/multi_instance_coordination
// join the tool schema and its zod gate — the SAME normaliseAccessScope gate
// the form, GraphView and the questionnaire call (EC-6: no re-encoding).
describe('extractGraph — agent-reach fields (R16-E §1, D-08/D-65)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('aigate:api-key', 'test-key');
  });

  function processingNode(overrides: Record<string, unknown> = {}) {
    return {
      id: 'p1',
      label: 'agent',
      model_type: 'agentic',
      autonomy_level: 2,
      data_zone: 'Zone C',
      vendor: 'internal',
      replaces_prior_model: false,
      basis_quotes: { model_type: '', autonomy_level: '', data_zone: '', vendor: '' },
      ...overrides,
    };
  }

  function mockWith(processingNodes: unknown[]) {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: { ...MOCK_GRAPH_INPUT, processing_nodes: processingNodes },
        },
      ],
    });
  }

  it('TC-R16-E-01: a valid list of several values is accepted and canonically ordered', async () => {
    mockWith([
      processingNode({ system_access_scope: ['deployment_authority', 'shared_infrastructure'] }),
    ]);
    const result = await extractGraph('an agent');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.graph.processing_nodes[0]?.system_access_scope).toEqual([
        'shared_infrastructure',
        'deployment_authority',
      ]);
    }
  });

  it('TC-R16-E-02: a single-element list is accepted', async () => {
    mockWith([processingNode({ system_access_scope: ['credentialed_systems'] })]);
    const result = await extractGraph('an agent');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.graph.processing_nodes[0]?.system_access_scope).toEqual(['credentialed_systems']);
    }
  });

  it('TC-R16-E-03: "none" combined with another value fails the whole extraction (rejected)', async () => {
    mockWith([processingNode({ system_access_scope: ['none', 'shared_infrastructure'] })]);
    const result = await extractGraph('an agent');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('parse-error');
  });

  it('TC-R16-E-04: a duplicate value fails the whole extraction (rejected)', async () => {
    mockWith([processingNode({ system_access_scope: ['shared_infrastructure', 'shared_infrastructure'] })]);
    const result = await extractGraph('an agent');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('parse-error');
  });

  it('TC-R16-E-05: a value outside the four legal values fails the whole extraction (rejected)', async () => {
    mockWith([processingNode({ system_access_scope: ['root-access'] })]);
    const result = await extractGraph('an agent');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('parse-error');
  });

  it('TC-R16-E-06: absent on a non-agent is accepted and not guessed — no claim, no question', async () => {
    mockWith([processingNode({ model_type: 'llm' })]);
    const result = await extractGraph('a chat assistant');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.graph.processing_nodes[0]?.system_access_scope).toBeUndefined();
      expect(result.value.guessed.p1 ?? []).not.toContain('system_access_scope');
      expect(result.value.guessed.p1 ?? []).not.toContain('multi_instance_coordination');
    }
  });

  it('TC-R16-E-07: absent on an agentic node is forced guessed — an agent\'s reach is never silently "not stated"', async () => {
    mockWith([processingNode({ model_type: 'agentic' })]);
    const result = await extractGraph('an agent');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.graph.processing_nodes[0]?.system_access_scope).toBeUndefined();
      expect(result.value.guessed.p1).toContain('system_access_scope');
      expect(result.value.guessed.p1).toContain('multi_instance_coordination');
    }
  });

  it('TC-R16-E-08: a legal value with no verified quote is guessed, same mechanism as every other field', async () => {
    mockWith([
      processingNode({
        system_access_scope: ['shared_infrastructure'],
        basis_quotes: { model_type: '', autonomy_level: '', data_zone: '', vendor: '', system_access_scope: '' },
      }),
    ]);
    const result = await extractGraph('an agent');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.graph.processing_nodes[0]?.system_access_scope).toEqual(['shared_infrastructure']);
      expect(result.value.guessed.p1).toContain('system_access_scope');
    }
  });

  it('TC-R16-E-09: multi_instance_coordination accepts its three legal values and rejects anything else', async () => {
    mockWith([processingNode({ multi_instance_coordination: 'unknown' })]);
    const ok = await extractGraph('an agent');
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.graph.processing_nodes[0]?.multi_instance_coordination).toBe('unknown');

    mockWith([processingNode({ multi_instance_coordination: 'sometimes' })]);
    const bad = await extractGraph('an agent');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.kind).toBe('parse-error');
  });

  it('TC-R16-E-10: a verified quote keeps the field out of guessed, same as any other field', async () => {
    mockWith([
      processingNode({
        system_access_scope: ['credentialed_systems'],
        multi_instance_coordination: 'no',
        basis_quotes: {
          model_type: 'an AI agent',
          autonomy_level: 'acts on its own',
          data_zone: 'our own systems',
          vendor: 'built in-house',
          system_access_scope: 'its own service account',
          multi_instance_coordination: 'runs alone',
        },
      }),
    ]);
    const result = await extractGraph(
      'An AI agent that acts on its own, built in-house, running on our own systems with its own service account and runs alone.',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.guessed.p1 ?? []).not.toContain('system_access_scope');
      expect(result.value.guessed.p1 ?? []).not.toContain('multi_instance_coordination');
    }
  });
});

// CR6-05 ("replaces something you already use?" is never asked on the
// description path). replaces_prior_model is required on every processing
// node (so the model must always answer true/false) but, before this fix,
// had no entry in QUOTE_FIELDS.processing or the tool schema's basis_quotes
// properties — an unquoted value was silently treated as having a basis,
// never guessed, never turned into a question, even though TRACK-II-REPLACE
// routes on it (policy/appetite.yaml).
describe('extractGraph — CR6-05 (replaces_prior_model is now quote-checked)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('aigate:api-key', 'test-key');
  });

  function mockWith(processingNodes: unknown[]) {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', name: 'extract_graph', input: { ...MOCK_GRAPH_INPUT, processing_nodes: processingNodes } },
      ],
    });
  }

  it('TC-CR6-05a: a realistic model reply with no quote for replaces_prior_model is guessed, and the real question generator turns it into a question', async () => {
    // A realistic full node shape (every required field present, basis_quotes
    // object present with real quotes for the OTHER fields) — only
    // replaces_prior_model's own quote is left blank, exactly the shape a
    // real model emits when it has no textual basis for that one field.
    mockWith([
      {
        id: 'p1',
        label: 'GPT-4 based email drafting model',
        model_type: 'llm',
        autonomy_level: 1,
        data_zone: 'Zone B',
        vendor: 'azure-openai-internal',
        replaces_prior_model: true,
        basis_quotes: {
          model_type: 'GPT-4 based',
          autonomy_level: '',
          data_zone: '',
          vendor: 'azure-openai-internal',
        },
      },
    ]);
    const result = await extractGraph('drafts client emails using the azure-openai-internal account');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guessed.p1).toContain('replaces_prior_model');

    const questions = questionsForGuessedFields(result.value.guessed, result.value.graph);
    expect(questions.some((q) => q.field === 'replaces_prior_model' && q.node_id === 'p1')).toBe(true);
  });

  it('TC-CR6-05c: a reply that quotes replaces_prior_model verbatim from the description is verified, not guessed', async () => {
    mockWith([
      {
        id: 'p1',
        label: 'GPT-4 based email drafting model',
        model_type: 'llm',
        autonomy_level: 1,
        data_zone: 'Zone B',
        vendor: 'azure-openai-internal',
        replaces_prior_model: true,
        basis_quotes: {
          model_type: 'GPT-4 based',
          autonomy_level: '',
          data_zone: '',
          vendor: 'azure-openai-internal',
          replaces_prior_model: 'replaces the old rules engine',
        },
      },
    ]);
    const result = await extractGraph(
      'drafts client emails using the azure-openai-internal account; it replaces the old rules engine',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guessed.p1 ?? []).not.toContain('replaces_prior_model');
    expect(result.value.provenance.p1?.replaces_prior_model).toBe('replaces the old rules engine');
  });
});

// B-8 (a node with no quotes at all skips the guessed-field mechanism).
// basis_quotes is required in the JSON tool schema but optional in the zod
// gate (defence in depth for a less strict provider, e.g. the local
// open-model path) — a node that omits the key entirely used to short-
// circuit to "nothing guessed", silently granting every field on it the
// same standing as a verified quote.
describe('extractGraph — B-8 (missing basis_quotes guesses every field)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('aigate:api-key', 'test-key');
  });

  it('TC-CR6-B8: an input node with no basis_quotes object at all has every one of its quote fields guessed', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: {
            ...MOCK_GRAPH_INPUT,
            // Realistic shape minus the basis_quotes key — legal under the
            // zod gate (optional), and the exact shape a less strict
            // provider (e.g. the local open-model path) can still produce.
            input_nodes: [{ id: 'i1', label: 'client relationship notes', data_class: 'Client PII', data_zone: 'Zone B' }],
          },
        },
      ],
    });

    const result = await extractGraph('drafts client emails using relationship notes');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both of input's quote fields (data_class, data_zone) have defined
    // values and no quote at all — both must be guessed, in QUOTE_FIELDS'
    // own order.
    expect(result.value.guessed.i1).toEqual(['data_class', 'data_zone']);
    expect(result.value.provenance.i1).toBeUndefined();
  });
});

// B-9 (the extraction cannot mark an unclassified decision). decision_type_
// other (engine/types.ts) was absent from both the tool schema and the zod
// gate, so the description path could never populate it and the engine's
// unclassified-decision safety net could never fire from an LLM-extracted
// graph.
describe('extractGraph — B-9 (decision_type_other reaches the graph)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('aigate:api-key', 'test-key');
  });

  function mockOutputNode(overrides: Record<string, unknown> = {}) {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          name: 'extract_graph',
          input: {
            ...MOCK_GRAPH_INPUT,
            output_nodes: [
              {
                id: 'o1',
                label: 'collections priority list',
                action_type: 'recommend',
                exposure: 'internal-only',
                decision_bindingness: 'advisory',
                output_reversibility: 'reversible',
                scale: 'limited',
                ...overrides,
              },
            ],
          },
        },
      ],
    });
  }

  it('TC-CR6-B9: a free-typed, unclassified decision label reaches the graph as decision_type_other, with no decision_type set', async () => {
    mockOutputNode({ decision_type_other: 'collections prioritisation' });

    const result = await extractGraph('ranks accounts for collections follow-up');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.graph.output_nodes[0]?.decision_type_other).toBe('collections prioritisation');
    expect(result.value.graph.output_nodes[0]?.decision_type).toBeUndefined();
  });

  it('TC-CR6-B9b: the tool schema declares the same 200-character bound on decision_type_other as the zod gate', async () => {
    mockOutputNode({ decision_type_other: 'collections prioritisation' });
    await extractGraph('ranks accounts for collections follow-up');
    const call = mockCreate.mock.calls[0]![0] as {
      tools: { input_schema: { properties: { output_nodes: { items: { properties: Record<string, { maxLength?: number }> } } } } }[];
    };
    const prop = call.tools[0]!.input_schema.properties.output_nodes.items.properties.decision_type_other;
    expect(prop?.maxLength).toBe(200);
  });

  // CR7-31. A model that fills decision_type_other with filler beside a listed
  // decision_type made the verdict Provisional (provisional.ts reads it). The
  // listed type wins; the filler is dropped, and the tool schema says when to
  // use the field.
  it('TC-CR7-31: decision_type_other is dropped when decision_type is set', async () => {
    mockOutputNode({ decision_type: 'credit-decision', decision_type_other: 'n/a' });
    const result = await extractGraph('ranks accounts for collections follow-up');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = result.value.graph.output_nodes[0];
    expect(node?.decision_type).toBe('credit-decision');
    expect(node?.decision_type_other).toBeUndefined();
    expect(node && 'decision_type_other' in node).toBe(false);
  });

  it('TC-CR7-31b: the tool schema tells the model to use decision_type_other only when no listed type fits', async () => {
    mockOutputNode({ decision_type_other: 'collections prioritisation' });
    await extractGraph('ranks accounts for collections follow-up');
    const call = mockCreate.mock.calls[0]![0] as {
      tools: { input_schema: { properties: { output_nodes: { items: { properties: Record<string, { description?: string }> } } } } }[];
    };
    const prop = call.tools[0]!.input_schema.properties.output_nodes.items.properties.decision_type_other;
    expect(prop?.description).toMatch(/only when no listed decision type fits/i);
    expect(prop?.description).toMatch(/omit/i);
  });

  it('a decision_type_other longer than the bound fails the whole extraction (rejected), not silently truncated', async () => {
    mockOutputNode({ decision_type_other: 'x'.repeat(201) });

    const result = await extractGraph('ranks accounts for collections follow-up');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('parse-error');
  });
});
