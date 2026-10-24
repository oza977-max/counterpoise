import type {
  ActionType,
  DataClass,
  DataZone,
  DecisionBindingness,
  DecisionType,
  Exposure,
  ModelType,
} from './types';
import { ACCESS_SCOPE_CANONICAL_ORDER } from './access-scope';

// Canonical attribute vocabulary (policy-schema.md §3.0) — single runtime
// source of truth shared by src/store/policy.ts (condition-value validation)
// and src/llm/graph-extractor.ts (tool schema + response validation), so
// the two can't silently drift apart (P4-C01 review finding #2).
export const DATA_CLASSES = ['Public', 'Internal', 'Confidential', 'Client PII', 'MNPI'] satisfies DataClass[];
export const DATA_ZONES = ['Zone A', 'Zone B', 'Zone C'] satisfies DataZone[];
export const MODEL_TYPES = [
  'statistical',
  'traditional-ml',
  'ml',
  'deep-learning',
  'llm',
  'generative-ai',
  'agentic',
] satisfies ModelType[];
export const EXPOSURES = [
  'internal-only',
  'internal-shared',
  'client-facing',
  'market-facing',
] satisfies Exposure[];
export const DECISION_BINDINGNESS = ['non-binding', 'advisory', 'material', 'binding'] satisfies DecisionBindingness[];
// 'inform' added 2026-08-17 (sweep-001 finding, decided by the user): a
// chatbot ANSWERING questions had no honest value and was schema-forced to
// the string-similar 'trade'. 'inform' = presents information or answers
// directly; distinct from 'read' (retrieves/summarises for a reader) and
// from 'recommend' (proposes an action). Deliberately matches none of the
// strict action lists in the policy.
export const ACTION_TYPES = ['read', 'inform', 'draft', 'recommend', 'execute', 'trade', 'approve'] satisfies ActionType[];
export const DECISION_TYPES = [
  'credit-decision',
  'lending-decision',
  'fraud-detection',
  'trading',
  'pricing',
  'hiring',
  'regulatory-reporting',
  'operational',
] satisfies DecisionType[];

// R16-A1 (PE-9): system_access_scope is both a closed-enum field (so a typo'd
// value in a condition fails loud at load, same as every field above) AND
// the one LIST-VALUED field (src/store/policy.ts's `LIST_VALUED_FIELDS`) —
// the two checks are independent and both apply to it.
export const SYSTEM_ACCESS_SCOPES = ACCESS_SCOPE_CANONICAL_ORDER;

export const CANONICAL_VOCABULARY: Record<string, readonly string[]> = {
  data_class: DATA_CLASSES,
  data_zone: DATA_ZONES,
  model_type: MODEL_TYPES,
  exposure: EXPOSURES,
  decision_bindingness: DECISION_BINDINGNESS,
  action_type: ACTION_TYPES,
  decision_type: DECISION_TYPES,
  system_access_scope: SYSTEM_ACCESS_SCOPES,
};

// The fields a description-reading step could ever have left without a quoted basis. Moved here from the retired
// model route (R18-E, specs/intake-flow.md §27.10) because two tests still use them as live guards of the
// assumption-field catalogues: plain-copy.test.ts (every such field has plain wording) and
// store/assumption-fields.test.ts (every such field is one the hand-off lets an assumption name).
export const QUOTE_FIELDS: Record<'input' | 'processing' | 'output', string[]> = {
  input: ['data_class', 'data_zone'],
  processing: [
    'model_type',
    'autonomy_level',
    'data_zone',
    'vendor',
    'replaces_prior_model',
    'declared_model_id',
    'system_access_scope',
    'multi_instance_coordination',
  ],
  output: ['action_type', 'exposure', 'decision_bindingness', 'output_reversibility', 'scale', 'decision_type', 'hitl'],
};

// An agentic node's reach is never silently "not stated": both fields below were forced into the guessed list when
// the model said nothing about them. Kept with QUOTE_FIELDS for the same two guards.
export const AGENT_REACH_FIELDS = ['system_access_scope', 'multi_instance_coordination'] as const;
