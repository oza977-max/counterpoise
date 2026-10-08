import type { IntakeState } from './intake-state';
import type { FormAnswerState, LastRead, AnswerSource, QuoteRef } from '../engine/prefill-types';
import type { QuestionId } from '../engine/plain-questions';
import { CHECKLIST_ITEM_IDS } from '../engine/mentioned';

// explore-001 D-002 / D-003. In-flight intake lived only in React state, so
// a refresh, a browser Back, or clicking "Register" mid-intake discarded the
// description, all eleven guided-form answers, the extracted graph and any
// node corrections — with no warning and no way back. For the planned
// back-test, where risk practitioners enter real use cases, that is the most
// likely cause of an abandoned session.
//
// sessionStorage rather than localStorage, deliberately:
//   * a half-finished draft should not outlive the browser session;
//   * it is per-tab, so two tabs cannot fight over one draft;
//   * it is not the audit trail — a draft is not evidence, and nothing here
//     is ever written to the append-only store.
const KEY = 'aigate:intake-draft';

// A draft is only worth keeping once the user has actually invested
// something. An empty description-entry step restores nothing, so persisting
// it would just mean restoring a blank form and claiming we saved their work.
function worthPersisting(state: IntakeState): boolean {
  if (state.step === 'description_entry') return state.description.trim().length > 0;
  return true;
}

// CR6-04 (Critical, BC-002: "persisted state carries a version and is
// migrated or refused on mismatch, never read as if current"). The draft is
// written in a small ENVELOPE, `{ version, state }`, so an incompatible
// version can be recognised instead of being read as if it were current.
//
// R18-A (specs/intake-flow.md §27.7): version 4. The pre-check now has ONE
// route (describe, then the form), and a draft saved by any earlier build
// (versions 1-3, steps that no longer exist or carry answers in a shape the form
// no longer reads) is not carried over answer by answer: it lands on the form with
// the description kept and no answers (loadDraftInfo below), and says so. The
// earlier per-shape migrations (CR6-04's undo-snapshot drop, CR7-28's return to the
// card review) are gone with the route they served.
const DRAFT_VERSION = 4;

interface DraftEnvelope {
  version: number;
  state: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function saveDraft(state: IntakeState): void {
  try {
    if (!worthPersisting(state)) {
      clearDraft();
      return;
    }
    const envelope = { version: DRAFT_VERSION, state };
    sessionStorage.setItem(KEY, JSON.stringify(envelope));
  } catch {
    // Storage can be unavailable (private mode, quota). Losing the draft is
    // the pre-existing behaviour, so a failure here degrades to it rather
    // than breaking intake.
  }
}

export interface DraftInfo {
  state: IntakeState;
  /** Retired. The CR7-28 return to the card review no longer exists; kept as a
   *  constant false so existing readers compile until R18-E removes the field. */
  migratedFromOldBuild: boolean;
  /** R18-NF-5. True when `state` is NOT what was saved: a draft from an earlier
   *  build (or one that fails validation) was turned into the safe landing, the
   *  form with the description kept and no answers. Computed at load and never
   *  persisted, so it is shown once and not on every reload. */
  earlierVersionNotice: boolean;
}

const MAX_DESCRIPTION_CHARS = 1_000_000; // not a rule on people: bounds what a hostile draft can make us hold

/** The safe landing for every draft this build cannot use as it is. */
function landing(description: string): IntakeState {
  return { step: 'graph_extraction', description, method: 'form' };
}

/** The description of a stored value, whatever its shape: a string is kept, anything
 *  else becomes empty. Looks in `.state` (an envelope) and then at the top (a bare
 *  version-1 state). Never throws. */
function salvageDescription(parsed: unknown): string {
  if (!isRecord(parsed)) return '';
  const inner = parsed.state;
  if (isRecord(inner) && typeof inner.description === 'string') return inner.description;
  if (typeof parsed.description === 'string') return parsed.description;
  return '';
}

// ---- validation of a stored value (BC-002: check and use it in one form) ----

const ANSWER_ID: Record<Exclude<QuestionId, '2'>, true> = {
  '1': true, '3': true, '3supplier': true, '3supplierName': true, '3model': true, '3a': true,
  '3aWhich': true, '3platformZone': true, '4': true, '4a': true, '5': true, '6': true, '6a': true,
  '6b': true, '7': true, '8': true, '8other': true, '9': true, '10': true, '11': true, '12': true,
  '13': true, '14': true,
};
const MAX_ANSWER_CHARS = 20_000;
const MAX_LIST = 100;
const MAX_KEY_CHARS = 200;
const MAX_QUOTE_CHARS = 300;

function boundedString(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max;
}

function validQuotes(v: unknown): v is QuoteRef[] {
  return (
    Array.isArray(v) &&
    v.length <= MAX_LIST &&
    v.every((q) => isRecord(q) && boundedString(q.option, MAX_KEY_CHARS) && boundedString(q.quote, MAX_QUOTE_CHARS))
  );
}

function validRead(v: unknown): boolean {
  return (
    isRecord(v) &&
    boundedString(v.model, 500) &&
    (v.place === 'this-computer' || v.place === 'firm-server' || v.place === 'ollama-cloud') &&
    boundedString(v.host, 500)
  );
}

function validSource(v: unknown): v is AnswerSource {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'typed':
    case 'not-carried':
      return true;
    case 'prefilled':
      return validQuotes(v.quotes) && validRead(v.read) && typeof v.confirmed === 'boolean';
    case 'changed':
      return validQuotes(v.from) && validRead(v.read);
    case 'record':
      return typeof v.confirmed === 'boolean' && (v.read === undefined || validRead(v.read));
    default:
      return false; // the set of kinds is closed
  }
}

/** Returns a clean copy (own prototype, only known keys) or null. */
function cleanAnswerState(v: unknown): FormAnswerState | null {
  if (!isRecord(v)) return null;
  const out: FormAnswerState = {};
  for (const key of Object.keys(v)) {
    if (!Object.prototype.hasOwnProperty.call(ANSWER_ID, key)) return null;
    const entry = v[key];
    if (!isRecord(entry) || !validSource(entry.source)) return null;
    const value = entry.value;
    const okValue =
      boundedString(value, MAX_ANSWER_CHARS) ||
      (Array.isArray(value) && value.length <= MAX_LIST && value.every((x) => boundedString(x, MAX_KEY_CHARS)));
    if (!okValue) return null;
    out[key as Exclude<QuestionId, '2'>] = {
      value: Array.isArray(value) ? [...(value as string[])] : (value as string),
      source: entry.source,
    };
  }
  return out;
}

const FAILURES = new Set([
  'ok', 'not-configured', 'too-long', 'timed-out', 'skipped', 'not-read', 'setting-changed', 'invalid-setting',
  'nothing-found', 'retired', 'model-missing', 'not-included', 'allowance-used', 'signed-out', 'not-answering',
  'blocked-or-unreachable', 'unusable', 'other',
]);

function cleanLastRead(v: unknown): LastRead | null {
  if (!isRecord(v) || !boundedString(v.fingerprint, 64) || typeof v.outcome !== 'string' || !FAILURES.has(v.outcome)) return null;
  if (v.read !== undefined && !validRead(v.read)) return null;
  return {
    fingerprint: v.fingerprint,
    outcome: v.outcome as LastRead['outcome'],
    ...(v.read !== undefined ? { read: v.read as LastRead['read'] } : {}),
  };
}

const CHECKLIST_IDS = new Set<string>(CHECKLIST_ITEM_IDS);

function validNudge(v: unknown): boolean {
  return Array.isArray(v) && v.length <= CHECKLIST_ITEM_IDS.length && v.every((x) => typeof x === 'string' && CHECKLIST_IDS.has(x));
}

function graphLike(v: unknown): boolean {
  return isRecord(v) && Array.isArray(v.input_nodes) && Array.isArray(v.processing_nodes) && Array.isArray(v.output_nodes);
}

function validPlainAnswers(v: unknown): boolean {
  if (!isRecord(v)) return false;
  return Object.keys(v).every((k) => {
    const x = v[k];
    return Object.prototype.hasOwnProperty.call(ANSWER_ID, k) || k === '2'
      ? boundedString(x, MAX_DESCRIPTION_CHARS) || (Array.isArray(x) && x.every((y) => typeof y === 'string'))
      : false;
  });
}

const STEPS_WITH_GRAPH = new Set(['graph_review', 'questionnaire', 'contradiction_review', 'confirmation', 'evaluation_pending']);

/** A state read back from storage, checked field by field for what the screens read.
 *  Returns the state itself (its own object, never a prototype-carrying copy of the
 *  parsed one's `__proto__`) or null. Does not deep-check graphs; it checks that a step
 *  has the pieces its screen indexes into. */
function currentState(v: unknown): IntakeState | null {
  if (!isRecord(v) || typeof v.step !== 'string') return null;
  if (Object.prototype.hasOwnProperty.call(v, '__proto__')) return null;
  const desc = v.description;
  switch (v.step) {
    case 'description_entry':
      if (typeof desc !== 'string') return null;
      if (v.nudgeFor !== undefined && !validNudge(v.nudgeFor)) return null;
      if (v.decidedFor !== undefined && !boundedString(v.decidedFor, 64)) return null;
      return v as unknown as IntakeState;
    case 'duplicate_check':
      if (typeof desc !== 'string') return null;
      if (v.nudgeFor !== undefined && !validNudge(v.nudgeFor)) return null;
      return v as unknown as IntakeState;
    case 'graph_extraction':
      if (typeof desc !== 'string' || v.method !== 'form') return null;
      if (v.nudgeFor !== undefined && !validNudge(v.nudgeFor)) return null;
      if (v.decidedFor !== undefined && !boundedString(v.decidedFor, 64)) return null;
      if (v.useCaseId !== undefined && typeof v.useCaseId !== 'string') return null;
      if (v.plainAnswers !== undefined && !validPlainAnswers(v.plainAnswers)) return null;
      if (v.assumptions !== undefined && !Array.isArray(v.assumptions)) return null;
      if (v.originalGraph !== undefined && !graphLike(v.originalGraph)) return null;
      if (v.answerState !== undefined) {
        const clean = cleanAnswerState(v.answerState);
        if (clean === null) return null;
        return { ...(v as object), answerState: clean } as unknown as IntakeState;
      }
      return v as unknown as IntakeState;
    case 'verdict':
      return typeof v.verdictId === 'string' ? (v as unknown as IntakeState) : null;
    default:
      if (!STEPS_WITH_GRAPH.has(v.step)) return null;
      if (!graphLike(v.graph) || typeof v.useCaseId !== 'string') return null;
      if (v.step !== 'evaluation_pending' && typeof desc !== 'string') return null;
      if (v.plainAnswers !== undefined && !validPlainAnswers(v.plainAnswers)) return null;
      if (v.assumptions !== undefined && !Array.isArray(v.assumptions)) return null;
      if (v.answerState !== undefined) {
        const clean = cleanAnswerState(v.answerState);
        if (clean === null) return null;
        return { ...(v as object), answerState: clean } as unknown as IntakeState;
      }
      return v as unknown as IntakeState;
  }
}

/**
 * Reads the saved intake draft. `null` only when nothing is stored. Anything that is
 * stored but cannot be used as it is (an earlier version, a version from the future,
 * a damaged or hostile value) opens the form with the description kept (when it is a
 * string) and NO answers, and `earlierVersionNotice` says so. Never throws.
 */
export function loadDraftInfo(): DraftInfo | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === null || raw === '') return null;
  const unusable = (description: string): DraftInfo => ({
    state: landing(description),
    migratedFromOldBuild: false,
    earlierVersionNotice: true,
  });
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return unusable('');
    // A draft saved before versioning is the bare state itself (version 1).
    const envelope: DraftEnvelope =
      typeof parsed.version === 'number' && 'state' in parsed
        ? { version: parsed.version, state: parsed.state }
        : { version: 1, state: parsed };
    // An evaluation that was still running is reported as such whatever build saved
    // it: IntakeFlow only reads its step (the interrupted-check notice) and starts empty.
    if (isRecord(envelope.state) && envelope.state.step === 'evaluation_pending') {
      return { state: envelope.state as unknown as IntakeState, migratedFromOldBuild: false, earlierVersionNotice: false };
    }
    const description = salvageDescription(parsed);
    if (!Number.isInteger(envelope.version) || envelope.version !== DRAFT_VERSION) {
      // 1-3: an earlier build. 0, negative, fractional: damaged. Above 4: a future build.
      return unusable(description);
    }
    const state = currentState(envelope.state);
    if (state === null) return unusable(description);
    return { state, migratedFromOldBuild: false, earlierVersionNotice: false };
  } catch {
    return unusable('');
  }
}

export function loadDraft(): IntakeState | null {
  return loadDraftInfo()?.state ?? null;
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/** CR7-16. A confirm or an adopt can finish AFTER the person has left it and
 *  started something else (both keep running when the screen unmounts —
 *  CR6-15). The unconditional `clearDraft()` they ended with then wiped the
 *  NEWER case's saved work. This clears only a draft that is this case's: the
 *  stored draft is absent, or carries this `useCaseId`. A draft with a
 *  different id, or none (a case just started), is left alone.
 *
 *  An adopt mints its id inside the handler, so the draft it came from — the
 *  duplicate-check step, which carries no id — can never match by id. The
 *  adopt passes the description it adopted on: a stored `duplicate_check`
 *  draft with that same description is the adopt's own and is cleared too
 *  (and only that one). */
export function clearDraftIfCase(useCaseId: string, opts?: { duplicateCheckDescription?: string }): void {
  const stored = loadDraft();
  if (stored === null) {
    clearDraft();
    return;
  }
  if ('useCaseId' in stored && stored.useCaseId === useCaseId) {
    clearDraft();
    return;
  }
  if (
    opts?.duplicateCheckDescription !== undefined &&
    stored.step === 'duplicate_check' &&
    stored.description === opts.duplicateCheckDescription
  ) {
    clearDraft();
  }
}

// The guided form keeps its answers in local component state, not in
// IntakeState, so persisting the reducer alone restored the step with an
// empty form — the work the user actually did was still lost. This is the
// second half of the D-002/D-003 fix, found by verifying the first half in
// the browser rather than trusting it.
//
// R18-A (specs/intake-flow.md §27.6, §27.7). The form draft now holds the form's
// ONE answer-state object: `{ version: 4, answerState, lastRead }` under a key whose
// suffix matches the envelope version (DR8-B-9). Question 2 is not in it — the
// description lives in the intake draft. `updateFormDraft` is the ONLY writer: it
// reads what is stored (validated), merges the patch and writes, so the form's
// per-keystroke save (answerState) and the intake component's save after a read
// (lastRead) can never overwrite each other's field.
//
// The two earlier keys are never read. R16-B (D-41) put raw PlainAnswers under
// `…:v2`; the original field-by-field form put `{ values, jurisdictionAnswer }`
// under the unversioned key. An old shape read as if current would feed values nobody
// chose through the question mapping, so each is only probed and removed.
const FORM_KEY = 'aigate:intake-form-draft:v4';
const FORM_KEY_V2 = 'aigate:intake-form-draft:v2';
const LEGACY_FORM_KEY = 'aigate:intake-form-draft';

export interface FormDraft {
  version: 4;
  answerState: FormAnswerState;
  lastRead: LastRead;
}

/** The value a draft starts from: nothing answered, the description never read. */
export const NEVER_READ: LastRead = { fingerprint: '', outcome: 'not-read' };

/** The stored form draft, validated in full, or null (absent, damaged, another version). */
export function loadFormDraft(): FormDraft | null {
  try {
    const raw = sessionStorage.getItem(FORM_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 4) return null;
    const answerState = cleanAnswerState(parsed.answerState);
    const lastRead = cleanLastRead(parsed.lastRead);
    if (answerState === null || lastRead === null) return null;
    return { version: 4, answerState, lastRead };
  } catch {
    return null;
  }
}

/** The only writer of the form draft. Reads, merges `patch`, writes. */
export function updateFormDraft(patch: Partial<Pick<FormDraft, 'answerState' | 'lastRead'>>): void {
  try {
    const current = loadFormDraft();
    const next: FormDraft = {
      version: 4,
      answerState: patch.answerState ?? current?.answerState ?? {},
      lastRead: patch.lastRead ?? current?.lastRead ?? NEVER_READ,
    };
    sessionStorage.setItem(FORM_KEY, JSON.stringify(next));
  } catch {
    /* degrade to the pre-existing behaviour */
  }
}

export function clearFormDraft(): void {
  try {
    sessionStorage.removeItem(FORM_KEY);
  } catch {
    /* nothing to do */
  }
}

/** R16-B (D-41), extended in R18-A. Checks BOTH earlier form-draft keys (`…:v2` and the
 *  unversioned one), removes whichever it finds, and returns whether any was found, so
 *  the caller (StructuredForm) can say so exactly once. Never reads or parses the
 *  content — an incompatible shape is not worth parsing, only removing. */
export function probeLegacyFormDraft(): boolean {
  let found = false;
  for (const key of [FORM_KEY_V2, LEGACY_FORM_KEY]) {
    try {
      if (sessionStorage.getItem(key) !== null) {
        sessionStorage.removeItem(key);
        found = true;
      }
    } catch {
      /* storage unavailable: nothing to find */
    }
  }
  return found;
}
