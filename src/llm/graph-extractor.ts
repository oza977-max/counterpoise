import { z } from 'zod';
import { getApiKey, createClient } from './client';
import { localChatJson, localLlmEnabled } from './local-provider';
import type { LlmResult } from './types';
import type { DataFlowGraph } from '../engine/types';
import {
  ACTION_TYPES,
  AGENT_REACH_FIELDS,
  DATA_CLASSES,
  DATA_ZONES,
  DECISION_BINDINGNESS,
  DECISION_TYPES,
  EXPOSURES,
  MODEL_TYPES,
  QUOTE_FIELDS,
} from '../engine/canonical-vocabulary';
import { ACCESS_SCOPE_CANONICAL_ORDER, normaliseAccessScope } from '../engine/access-scope';

// Rule 2 (cross-cutting.md §7): src/llm/* is the ONLY place the Anthropic SDK is imported.
//
// Deviation from intake-flow.md §4.1's literal signature: the spec passes a
// `policyPermittedValues` parameter, but the canonical vocabulary
// (policy-schema.md §3.0) is a fixed closed enum set, not derived from a
// per-policy loaded file — so it's baked directly into the tool schema
// below rather than threaded through as an argument. Flagged in the P4-C01
// handover as a product-facing deviation, not just an implementation note:
// a bank that wants to restrict vocabulary further than the canonical set
// (e.g. disallow `agentic` model types firm-wide) cannot do so via policy
// today — that would require this function to accept policy-scoped
// permitted values, a real future requirement, not addressed here.

const EXTRACT_GRAPH_SCHEMA = {
  type: 'object',
  properties: {
    input_nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          data_class: { type: 'string', enum: DATA_CLASSES },
          data_zone: { type: 'string', enum: DATA_ZONES },
          basis_quotes: {
          type: 'object',
          properties: { data_class: { type: 'string' },data_zone: { type: 'string' } },
          required: ['data_class', 'data_zone'],
        },
        },
        required: ['id', 'label', 'data_class', 'data_zone', 'basis_quotes'],
      },
    },
    processing_nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          model_type: { type: 'string', enum: MODEL_TYPES },
          autonomy_level: { type: 'integer', minimum: 0, maximum: 4 },
          data_zone: { type: 'string', enum: DATA_ZONES },
          vendor: { type: 'string' },
          // R11-MG-2 (ADR-IF-R11-MG-1): optional proposed field, subject to
          // the same quote-verification mechanism as vendor. Not in the
          // node's `required` list — unresolvable is guessed, same as any
          // other field (R6 machinery), never a hard extraction failure.
          declared_model_id: { type: 'string' },
          // CR6-05: required value field (never optional, see `required`
          // below) — but its QUOTE is deliberately NOT added to this
          // sub-object's own `required` list, for the same reason
          // declared_model_id/system_access_scope/multi_instance_coordination
          // aren't: a model with no textual basis must be free to leave the
          // quote blank (or omit the key) so verifyQuotes() demotes the
          // field to guessed, rather than being pressured to fabricate a
          // quote just to satisfy the schema.
          replaces_prior_model: { type: 'boolean' },
          uncertain: { type: 'boolean' },
          // R16-E §1 (D-08, D-65). Both optional and both subject to the
          // same guessed/question machinery as every other field above —
          // never a hard extraction failure. A list, not a single enum: an
          // agent can both hold its own credentials AND run on shared
          // infrastructure at once. `enum` here is steering only (the API's
          // tool_choice forcing is best-effort, same note as every other
          // enum in this schema) — the real gate is the zod schema below.
          system_access_scope: { type: 'array', items: { type: 'string', enum: ACCESS_SCOPE_CANONICAL_ORDER } },
          multi_instance_coordination: { type: 'string', enum: ['no', 'yes', 'unknown'] },
          basis_quotes: {
          type: 'object',
          // CR6-05: replaces_prior_model joins the per-field list that
          // tells the model what it may quote — it was required on the
          // node (line above) but missing here, so an unquoted value was
          // never guessed and never became a question (the whole CR6-05
          // bug). Not added to the `required` array below, same reason as
          // declared_model_id/system_access_scope/multi_instance_coordination.
          properties: { model_type: { type: 'string' },autonomy_level: { type: 'string' },data_zone: { type: 'string' },vendor: { type: 'string' },declared_model_id: { type: 'string' },replaces_prior_model: { type: 'string' },system_access_scope: { type: 'string' },multi_instance_coordination: { type: 'string' } },
          required: ['model_type', 'autonomy_level', 'data_zone', 'vendor'],
        },
        },
        required: ['id', 'label', 'model_type', 'autonomy_level', 'data_zone', 'vendor', 'replaces_prior_model', 'basis_quotes'],
      },
    },
    output_nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          action_type: { type: 'string', enum: ACTION_TYPES },
          exposure: { type: 'string', enum: EXPOSURES },
          decision_bindingness: { type: 'string', enum: DECISION_BINDINGNESS },
          output_reversibility: { type: 'string', enum: ['reversible', 'irreversible', 'unknown'] },
          scale: { type: 'string', enum: ['limited', 'at_scale'] },
          decision_type: { type: 'string', enum: DECISION_TYPES },
          // B-9: the free-text escape hatch for an unclassified decision
          // (engine/types.ts's OutputNode.decision_type_other) — absent from
          // both schemas below until now, so the description path could
          // never populate it and the engine's unclassified-decision safety
          // net (unclassifiedDecisionTypes in provisional.ts) could never
          // fire from an LLM-extracted graph. Bounded like the hand-off's
          // free-text fields (src/store/handoff.ts's boundedText) — a
          // decision-type label is a short phrase, never a paragraph.
          // CR7-31: without this a model fills the field with filler ("n/a")
          // beside a listed decision_type, and the engine treats any typed
          // value as an unclassified decision (Provisional).
          decision_type_other: {
            type: 'string',
            maxLength: 200,
            description: 'Use only when no listed decision type fits; otherwise omit.',
          },
          hitl: { type: 'boolean' },
          basis_quotes: {
          type: 'object',
          // decision_type/hitl quotes optional like their values (review 004
          // finding 1: omitting them here made those fields unconditionally
          // "guessed" — the model was never even asked for their basis).
          properties: { action_type: { type: 'string' },exposure: { type: 'string' },decision_bindingness: { type: 'string' },output_reversibility: { type: 'string' },scale: { type: 'string' },decision_type: { type: 'string' },hitl: { type: 'string' } },
          required: ['action_type', 'exposure', 'decision_bindingness', 'output_reversibility', 'scale'],
        },
        },
        required: ['id', 'label', 'action_type', 'exposure', 'decision_bindingness', 'output_reversibility', 'scale', 'basis_quotes'],
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
      },
    },
    jurisdictions: { type: 'array', items: { type: 'string' } },
  },
  required: ['input_nodes', 'processing_nodes', 'output_nodes', 'edges', 'jurisdictions'],
} as const;

function buildExtractionPrompt(description: string): string {
  // The two added guidance blocks each close a misread observed in live
  // runs against the local model (2026-08-16, first-live-run session):
  // "internal platform" was placed in Zone A twice in two runs (systematic
  // Zone A bias), and "train a model" — no matching action_type enum —
  // was silently forced to the string-similar "trade" with no uncertainty
  // flag. Schema-forced decoding guarantees a LEGAL value, so wrong-but-
  // valid is the failure mode prompts must defend against.
  return [
    'Extract a structured data-flow graph from this AI use case description.',
    'Use ONLY the permitted enum values in the tool schema for classified fields.',
    'If you cannot determine a field with confidence from the description, set',
    'uncertain: true on that node and make a reasonable best-guess value anyway',
    '(the value is still required, but flag your confidence).',
    '',
    'Data zone guidance: systems described as internal, on-premise, in-house,',
    "or on the firm's own or approved internal platform are Zone C. Anything",
    'running on or hosted by an external vendor, supplier or cloud service —',
    'even an approved one under contract — is Zone B, not Zone C. The open',
    'internet and consumer tools are Zone A. Do not default to any zone',
    'without a signal.',
    '',
    'Jurisdictions are countries or legal regions only (for example UK, EU,',
    'US). Business areas, departments and platforms are NOT jurisdictions —',
    'if the description names no country or region, return an empty list.',
    '',
    'For every entry in each node\'s basis_quotes, COPY THE EXACT PHRASE from',
    'the description (a verbatim substring — never a paraphrase) that you',
    'based that field\'s value on. If the description does not state it, use',
    'an empty string. Quotes are mechanically checked against the description;',
    'a paraphrased or invented quote is treated as no quote at all.',
    '',
    'Never map an activity onto a similar-sounding enum value: if the',
    'description describes something with no matching value (for example,',
    'model training is not an action type), pick the least-wrong value and',
    'set uncertain: true on that node where the schema allows it. A wrong',
    'value stated confidently is worse than a flagged guess.',
    '',
    `Description: ${description}`,
  ].join('\n');
}

// Real Zod schema (intake-flow.md §4.4 mandates one) — the API's tool_choice
// forcing is best-effort model steering, not a hard contract; a model can
// still emit a near-miss value ("PII" instead of "Client PII") that the
// hand-written JSON schema merely discouraged. This is the actual gate:
// anything outside the canonical vocabulary fails parsing and returns
// parse-error, never silently reaches evaluate() with wrong-shaped data
// (P4-C01 review finding #1).
const InputNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  data_class: z.enum(DATA_CLASSES as [string, ...string[]]),
  data_zone: z.enum(DATA_ZONES as [string, ...string[]]),
  basis_quotes: z.record(z.string()).optional(),
});

const ProcessingNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  model_type: z.enum(MODEL_TYPES as [string, ...string[]]),
  autonomy_level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  data_zone: z.enum(DATA_ZONES as [string, ...string[]]),
  vendor: z.string(),
  // R11-MG-2: optional proposed value — an unresolvable quote demotes it to
  // guessed via the same verifyQuotes() mechanism as vendor (QUOTE_FIELDS
  // below), it never blocks extraction.
  declared_model_id: z.string().optional(),
  replaces_prior_model: z.boolean(),
  uncertain: z.boolean().optional(),
  // R16-E §1 (D-08, D-65, EC-6). The gate CALLS normaliseAccessScope — the
  // SAME single implementation the form, GraphView's correction editor and
  // the questionnaire's multi-select all call — rather than re-encoding its
  // rules (non-empty, one of the four known values, no duplicates, `none`
  // never with another value, canonical order). A `{ ok: false }` raises a
  // zod issue, so an illegal list fails the whole extraction the same way
  // an out-of-enum value on any other field does — never silently narrowed.
  system_access_scope: z
    .array(z.string())
    .optional()
    .transform((val, ctx) => {
      if (val === undefined) return undefined;
      const result = normaliseAccessScope(val);
      if (!result.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.reason });
        return z.NEVER;
      }
      return result.value;
    }),
  multi_instance_coordination: z.enum(['no', 'yes', 'unknown']).optional(),
  basis_quotes: z.record(z.string()).optional(),
});

const OutputNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  action_type: z.enum(ACTION_TYPES as [string, ...string[]]),
  exposure: z.enum(EXPOSURES as [string, ...string[]]),
  decision_bindingness: z.enum(DECISION_BINDINGNESS as [string, ...string[]]),
  output_reversibility: z.enum(['reversible', 'irreversible', 'unknown']),
  scale: z.enum(['limited', 'at_scale']),
  decision_type: z.enum(DECISION_TYPES as [string, ...string[]]).optional(),
  // B-9: bounded free text, same discipline as the hand-off's bounded
  // strings — short enough for a decision-type label, never a runaway value.
  decision_type_other: z.string().max(200).optional(),
  hitl: z.boolean().optional(),
  basis_quotes: z.record(z.string()).optional(),
});

const GraphEdgeSchema = z.object({ from: z.string(), to: z.string() });

const ExtractedGraphSchema = z.object({
  input_nodes: z.array(InputNodeSchema),
  processing_nodes: z.array(ProcessingNodeSchema),
  output_nodes: z.array(OutputNodeSchema),
  edges: z.array(GraphEdgeSchema),
  jurisdictions: z.array(z.string()),
});

// R6 (intake-flow.md §16, ADR-IF-R6-1): what extraction now returns. The
// graph is unchanged engine input; provenance and guessed-ness travel
// BESIDE it as intake artifacts — putting them on the graph would push
// presentation metadata through the engine island and every persisted
// verdict.
export interface GraphExtraction {
  graph: DataFlowGraph;
  /** provenance[nodeId][field] = the VERIFIED verbatim quote. */
  provenance: Record<string, Record<string, string>>;
  /** guessed[nodeId] = decision-bearing fields with no verified basis. */
  guessed: Record<string, string[]>;
}

/** R6-PV-2. Case- and whitespace-insensitive; no fuzzy matching, no
 *  semantics. The machine only answers "did the user actually write these
 *  words" — whether the words SUPPORT the value stays the human's call. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function verifyQuotes(
  description: string,
  kind: 'input' | 'processing' | 'output',
  node: Record<string, unknown>,
): { verified: Record<string, string>; guessed: string[] } {
  // B-8: `basis_quotes` is required in the JSON tool schema but OPTIONAL in
  // the zod gate (defence in depth for a provider that doesn't enforce the
  // schema as strictly, e.g. the local open-model path) — so a node with NO
  // basis_quotes object at all is a real, reachable shape, not merely a
  // legacy/pre-R6 fixture. Treating it as "nothing to verify, nothing
  // guessed" (the old behaviour) silently granted every one of its
  // decision-bearing fields the SAME standing as a verified quote. A node
  // with zero quoted evidence must read exactly like `basis_quotes: {}` —
  // every field below falls through to the `else` branch and is guessed.
  const desc = normalise(description);
  const quotes = (node.basis_quotes as Record<string, string> | undefined) ?? {};
  const verified: Record<string, string> = {};
  const guessed: string[] = [];
  for (const field of QUOTE_FIELDS[kind]) {
    // An absent optional VALUE (decision_type, hitl) claims nothing, so it
    // needs no basis and is not a guess.
    if (node[field] === undefined || node[field] === null) continue;
    const quote = (quotes[field] ?? '').trim();
    if (quote && desc.includes(normalise(quote))) {
      verified[field] = quote;
    } else {
      // Empty OR fabricated: either way there is no basis, and a fabricated
      // quote must never render as provenance (R6-PV-2).
      guessed.push(field);
    }
  }
  // R16-E §1 (D-08): an agent's reach is never silently "not stated" — push
  // the two agent-reach fields into `guessed` even when absent, so a
  // question is still asked. Deduplicated against the loop above (a
  // present-but-unquoted value is already guessed; this only adds the
  // absent case).
  if (kind === 'processing' && node.model_type === 'agentic') {
    for (const field of AGENT_REACH_FIELDS) {
      if ((node[field] === undefined || node[field] === null) && !guessed.includes(field)) {
        guessed.push(field);
      }
    }
  }
  return { verified, guessed };
}

function parseExtraction(input: unknown, description: string): GraphExtraction | null {
  const result = ExtractedGraphSchema.safeParse(input);
  if (!result.success) return null;

  // R6: verify quotes per node, then STRIP basis_quotes so the graph the
  // engine sees is unchanged (ADR-IF-R6-1).
  const provenance: Record<string, Record<string, string>> = {};
  const guessed: Record<string, string[]> = {};
  const strip = <T extends { id: string; basis_quotes?: Record<string, string> }>(
    kind: 'input' | 'processing' | 'output',
    nodes: T[],
  ): Omit<T, 'basis_quotes'>[] =>
    nodes.map((node) => {
      const { basis_quotes: _basis, ...rest } = node;
      // CR7-31: a listed decision_type wins — a free-text label beside it is
      // filler and would make the result Provisional (provisional.ts reads it).
      if (kind === 'output' && (rest as Record<string, unknown>).decision_type !== undefined) {
        delete (rest as Record<string, unknown>).decision_type_other;
      }
      const check = verifyQuotes(description, kind, node as Record<string, unknown>);
      if (Object.keys(check.verified).length > 0) provenance[node.id] = check.verified;
      if (check.guessed.length > 0) guessed[node.id] = check.guessed;
      return rest;
    });

  const data = result.data;
  // Zod's z.enum(...) infers each enum field as the widened `string` type
  // (the runtime arrays aren't `as const` tuples), so the static type here
  // is looser than DataFlowGraph's literal unions even though every value
  // has already been checked at runtime against the exact same
  // canonical-vocabulary arrays. The cast below is a typing formality, not
  // a validation bypass — real runtime enum checking already happened above.
  const graph = {
    id: crypto.randomUUID(),
    version: 1,
    input_nodes: strip('input', data.input_nodes),
    processing_nodes: strip('processing', data.processing_nodes),
    output_nodes: strip('output', data.output_nodes),
    edges: data.edges,
    jurisdictions: data.jurisdictions,
    intake_method: 'llm',
    extracted_at: new Date().toISOString(),
  } as unknown as DataFlowGraph;

  return { graph, provenance, guessed };
}

export async function extractGraph(description: string): Promise<LlmResult<GraphExtraction>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    // Provider order is a deliberate ranking, not a race: a saved Anthropic
    // key wins (stronger extractor), then a configured local open model
    // (free, on-device), then the guided form (no LLM at all). Both LLM
    // paths exit through the SAME Zod gate below — the local provider's
    // decoder-level schema guarantees shape, but only parseDataFlowGraph
    // guarantees the canonical vocabulary, and nothing reaches evaluate()
    // without it.
    if (localLlmEnabled()) {
      const raw = await localChatJson(buildExtractionPrompt(description), EXTRACT_GRAPH_SCHEMA);
      if (!raw.ok) return raw;
      const extraction = parseExtraction(raw.value, description);
      if (!extraction) return { ok: false, error: { kind: 'parse-error', raw: raw.value } };
      return { ok: true, value: extraction };
    }
    return { ok: false, error: { kind: 'no-api-key' } };
  }

  try {
    const client = createClient(apiKey);
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048, // mirrors local-provider.ts's num_predict — see the note there
      tools: [
        {
          name: 'extract_graph',
          description: 'Extract a structured data-flow graph from an AI use case description',
          input_schema: EXTRACT_GRAPH_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: 'extract_graph' },
      messages: [{ role: 'user', content: buildExtractionPrompt(description) }],
    });

    const toolUseBlock = response.content.find(
      (block): block is Extract<typeof block, { type: 'tool_use' }> => block.type === 'tool_use',
    );

    if (!toolUseBlock) {
      return { ok: false, error: { kind: 'parse-error', raw: response } };
    }

    const extraction = parseExtraction(toolUseBlock.input, description);
    if (!extraction) {
      return { ok: false, error: { kind: 'parse-error', raw: response } };
    }

    return { ok: true, value: extraction };
  } catch (err) {
    return { ok: false, error: { kind: 'network-error', message: err instanceof Error ? err.message : String(err) } };
  }
}
