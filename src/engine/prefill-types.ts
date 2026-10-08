// R18-A — the shared vocabularies of Round 18, in one home (specs/intake-flow.md
// §27.1, DR8-B-14 / C-13). TYPES ONLY: no runtime code, no imports beyond engine
// types, so src/llm, src/store and the components can all import these without
// importing one another to get a type. Later chunks fill in behaviour.

import type { QuestionId } from './plain-questions';

/** Where the model runs (§27.8). */
export type ModelPlace = 'this-computer' | 'firm-server' | 'ollama-cloud';

/** The 13 things a description can mention (§27.2). */
export type ChecklistItemId =
  | 'where-ai-comes-from'
  | 'kind-of-ai'
  | 'can-explain'
  | 'information-used'
  | 'what-it-does-with-output'
  | 'weight-of-output'
  | 'who-receives'
  | 'what-it-decides'
  | 'mistake-recoverable'
  | 'how-widely'
  | 'countries'
  | 'replaces-something'
  | 'agentic-reach';

/** One option of a select question: its key and the plain text shown for it. */
export interface PrefillCatalogueOption {
  key: string;
  text: string;
}

/** One select question of the catalogue (§27.4). Maps, so a model-supplied key
 *  can never reach an object prototype property (DR8-E-7). */
export interface PrefillCatalogueQuestion {
  kind: 'single' | 'multi';
  options: ReadonlyMap<string, PrefillCatalogueOption>;
}

/** The closed set of questions and option keys a pre-fill may use. */
export type PrefillCatalogue = ReadonlyMap<QuestionId, PrefillCatalogueQuestion>;

/** One verified value: an option key and the exact quote that supports it. */
export interface PrefillValue {
  option: string;
  quote: string;
}

export interface PrefillAnswer {
  values: PrefillValue[];
}

export type Prefill = Map<QuestionId, PrefillAnswer>;

/** Why a single value was dropped by the verifier (§27.4 rules, in order).
 *  The spec lists the rules but does not name the reasons; named here. */
export type DropReason =
  | 'malformed-reply'
  | 'unknown-question'
  | 'duplicate-question'
  | 'unknown-option'
  | 'invalid-option'
  | 'too-many-values'
  | 'duplicate-option'
  | 'bad-quote'
  | 'quote-not-in-description'
  | 'rating-instruction'
  | 'hidden';

export interface VerifyResult {
  prefill: Prefill;
  dropped: Record<DropReason, number>;
}

/** Exactly the union of §27.5. */
export type PrefillFailure =
  | 'not-configured'
  | 'too-long'
  | 'timed-out'
  | 'skipped'
  | 'not-read'
  | 'setting-changed'
  | 'invalid-setting'
  | 'nothing-found'
  | 'retired'
  | 'model-missing'
  | 'not-included'
  | 'allowance-used'
  | 'signed-out'
  | 'not-answering'
  | 'blocked-or-unreachable'
  | 'unusable'
  | 'other';

/** The model, place and origin a read was configured with (§27.13). */
export interface ReadRecord {
  model: string;
  place: ModelPlace;
  /** Origin: scheme, host and port, no path (e.g. 'http://localhost:11434'). */
  host: string;
}

export type PrefillOutcome =
  | {
      kind: 'ok';
      prefill: Prefill;
      dropped: Record<DropReason, number>;
      snapshot: ReadRecord;
      modeUsed: 'format' | 'tool';
    }
  | { kind: 'none'; reason: PrefillFailure; snapshot?: ReadRecord };

export interface QuoteRef {
  option: string;
  quote: string;
}

/** Where one form answer came from (§27.6). */
export type AnswerSource =
  | { kind: 'typed' }
  | { kind: 'prefilled'; quotes: QuoteRef[]; read: ReadRecord; confirmed: boolean }
  | { kind: 'changed'; from: QuoteRef[]; read: ReadRecord }
  | { kind: 'record'; confirmed: boolean; read?: ReadRecord }
  | { kind: 'not-carried' };

/** The form's only answer store. Question 2 is NOT in it: it is the description. */
export type FormAnswerState = Partial<
  Record<QuestionId, { value: string | string[]; source: AnswerSource }>
>;

/** The text the model last read, as a fingerprint. '' means "never read" and
 *  differs from every text's fingerprint. */
export interface LastRead {
  fingerprint: string;
  outcome: 'ok' | PrefillFailure;
  read?: ReadRecord;
}

/** One row of the record's answer sources (§27.13). */
export interface AnswerSourceRecord {
  question_id: string;
  value: string | string[];
  origin: 'typed' | 'prefilled_confirmed' | 'prefilled_changed' | 'from_earlier_record';
  quotes?: QuoteRef[];
  changed_from?: QuoteRef[];
  quote_in_final_description?: boolean;
  read?: number;
}

/** One in-app test run (§27.11). */
export interface ModelTestResult {
  model: string;
  place: ModelPlace;
  host: string;
  date: string;
  casesRun: number;
  stopped: boolean;
  verdictMatches: number;
  discarded: Record<string, number>;
  perQuestion: Record<string, { right: number; blank: number; wrong: number }>;
}
