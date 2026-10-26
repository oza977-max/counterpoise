import type {
  ActionType,
  DataClass,
  DataZone,
  DecisionBindingness,
  DecisionType,
  Exposure,
  ModelType,
  SystemAccessScope,
} from '../engine/types';
import type { LifecycleStage } from '../store/types';
import type { Verdict } from '../types/verdict';

// Presentation copy for the guided intake form (user feedback, V2-E: "input
// data class, input data zone, AI model type... is not very business
// friendly, how will they know all this").
//
// The form previously exposed the engine's internal field names as labels
// and its raw enum values as options. Those are the canonical vocabulary
// (policy-schema.md §3.0) and must not change — they are what rules match
// on. So the fix is presentation-only: the values stay, the words the user
// reads become questions a front-office person can answer without a
// glossary. Rule 4 (cross-cutting.md §7) — no logic here, just strings.
//
// The technical term is kept in parentheses on each option so a risk or
// model-validation reader can still map an answer back to the vocabulary
// the policy and the verdict are written in.

export const DATA_CLASS_LABELS: Record<DataClass, string> = {
  Public: 'Public — already published or freely available (Public)',
  Internal: 'Everyday business information — nothing sensitive (Internal)',
  Confidential: 'Confidential business information — restricted internally (Confidential)',
  'Client PII': 'Personal details of clients — names, accounts, anything identifying them (Client PII)',
  MNPI: 'Price-sensitive information — live deals, unpublished results, inside information (MNPI)',
};

export const DATA_ZONE_LABELS: Record<DataZone, string> = {
  'Zone A': 'On the open internet — outside the firm’s control (Zone A)',
  'Zone B': 'With an outside supplier — a cloud or vendor service used under contract (Zone B)',
  'Zone C': 'Inside the firm only — our own systems (Zone C)',
};

export const MODEL_TYPE_LABELS: Record<ModelType, string> = {
  statistical: 'A calculation or scorecard — fixed rules and formulas (statistical)',
  'traditional-ml': 'A model trained on historical data to predict or score (traditional ML)',
  ml: 'A model trained on historical data — general machine learning (ML)',
  'deep-learning': 'A neural network — e.g. image, voice or pattern recognition (deep learning)',
  llm: 'A chatbot or writing assistant — understands and produces text (LLM)',
  'generative-ai': 'Generates new content — text, images, audio or code (generative AI)',
  agentic: 'Can decide its own steps and use other tools to get things done (agentic)',
};

export const EXPOSURE_LABELS: Record<Exposure, string> = {
  'internal-only': 'Just my own team (internal-only)',
  'internal-shared': 'Other teams across the firm (internal-shared)',
  'client-facing': 'Clients see it (client-facing)',
  'market-facing': 'It goes outside the firm — market, public or regulators (market-facing)',
};

export const BINDINGNESS_LABELS: Record<DecisionBindingness, string> = {
  'non-binding': 'Background only — nobody acts on it directly (non-binding)',
  advisory: 'One input among several into a human decision (advisory)',
  material: 'It substantially drives the decision a human then makes (material)',
  binding: 'It is the decision — the outcome follows automatically (binding)',
};

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  read: 'Finds or summarises information for someone to read (read)',
  inform: 'Answers questions or presents information directly — nothing is actioned (inform)',
  draft: 'Writes a first draft for a person to check and edit (draft)',
  recommend: 'Suggests what should be done, a person decides (recommend)',
  execute: 'Carries out the action itself (execute)',
  trade: 'Places or changes trades (trade)',
  approve: 'Signs things off on its own (approve)',
};

export const DECISION_TYPE_LABELS: Record<DecisionType, string> = {
  'credit-decision': 'Whether to lend, or on what terms (credit decision)',
  'lending-decision': 'Loan origination or limits (lending decision)',
  'fraud-detection': 'Spotting fraud or financial crime (fraud detection)',
  trading: 'Buying, selling or hedging positions (trading)',
  pricing: 'What to charge a client (pricing)',
  hiring: 'Recruitment, selection or promotion (hiring)',
  'regulatory-reporting': 'Numbers or statements that go to a regulator (regulatory reporting)',
  operational: 'Day-to-day internal processes (operational)',
};

export const REVERSIBILITY_LABELS: Record<string, string> = {
  reversible: 'Yes — it can be corrected before any real harm (reversible)',
  irreversible: 'No — once it happens, it cannot be taken back (irreversible)',
  unknown: 'Not sure',
};

export const SCALE_LABELS: Record<string, string> = {
  limited: 'Occasionally, or a small pilot group (limited)',
  at_scale: 'Routinely, across the business (at scale)',
};

// "Autonomy level" as a term means nothing outside model risk. Asked as a
// question about who is in control, the same 0–4 scale is answerable.
export const AUTONOMY_LABELS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'It only provides information — it never acts (level 0)',
  1: 'A person checks and approves every action before it happens (level 1)',
  2: 'It acts, and a person reviews afterwards (level 2)',
  3: 'It acts on its own within limits someone set in advance (level 3)',
  4: 'It acts on its own with no human checkpoint (level 4)',
};

// v1.4 (2026-08-31): labels mirror the guided form's own option wording
// (StructuredForm sf-system-access / sf-multi-instance), same single-source
// rule as every other label map here.
export const SYSTEM_ACCESS_LABELS: Record<
  'none' | 'shared_infrastructure' | 'credentialed_systems' | 'deployment_authority',
  string
> = {
  none: 'Nothing beyond its own task’s data (none)',
  shared_infrastructure: 'Runs alongside other AI instances or processes on shared infrastructure (shared infrastructure)',
  credentialed_systems: 'Holds live credentials to systems beyond its immediate task (credentialed systems)',
  deployment_authority: 'Can push code, change configuration, or deploy with no separate human action (deployment authority)',
};

// R16-A1 (PE-9 §1.1): system_access_scope may now hold several ticked values
// at once. graph-summary.ts renders this field — this
// is the one place that turns either shape into display text, so it
// cannot drift on how a list reads. A single value renders byte-identical
// to before this change (`plainWithCode(SYSTEM_ACCESS_LABELS[value])`); a
// list renders every value's own "plain · code" phrase, joined — never a
// raw comma-joined lookup miss, which is what `SYSTEM_ACCESS_LABELS[list]`
// produced before this helper existed (undefined — a renderer crash
// waiting to happen, not a display difference).
export function systemAccessScopeLabel(value: SystemAccessScope | SystemAccessScope[]): string {
  const values = Array.isArray(value) ? value : [value];
  return values.map((v) => plainWithCode(SYSTEM_ACCESS_LABELS[v])).join('; ');
}

export const MULTI_INSTANCE_LABELS: Record<'yes' | 'no' | 'unknown', string> = {
  no: 'Runs alone — no coordination with other instances (no)',
  yes: 'Can exchange information with other instances or AI systems (yes)',
  unknown: 'Coordination not known (unknown)',
};

// R5-GR-1 (intake-flow.md §15.1). One consequence line per FIELD, not per
// value: a per-value consequence would re-derive rule behaviour in copy,
// which drifts the first time a rule changes. These say WHY the field
// matters, in words that stay true across policy edits.
// R16-E review pass 4: every line reworded for a newcomer. The old lines
// spoke in the engine's and a reviewer's terms ("binding", "Levels 3–4",
// "registry", "floors", "severity", "instances", an incident name) on a
// screen that otherwise uses the form's own words — so each now opens with
// the form's own short label (QUESTIONNAIRE_COPY) and names options the way
// the form does. Still claim-safe: each says what the answer affects, never
// promises an outcome. Reserved-word discipline (CLAUDE.md,
// /approved|rejected/i) still holds — "accepted" stands in for the banned
// word on declared_model_id (R11-MG-2).
export const FIELD_CONSEQUENCES: Record<string, string> = {
  data_class: 'How sensitive the information is. Your firm’s strictest rules cover information about people and anything price-sensitive.',
  data_zone: 'Where your information goes. Some of the lines your firm never crosses depend on this — an outside website is treated most strictly.',
  model_type: 'What kind of AI it is. AI that writes or creates things, and AI agents that work through tasks on their own, come under extra rules.',
  autonomy_level: 'How much it does without a person. Once it acts by itself with no routine review, the strictest checks apply.',
  vendor: 'Which supplier it is. A supplier that isn’t on your firm’s list can change the result.',
  declared_model_id: 'Which model it is. A model that isn’t on your firm’s list of accepted models gets its own extra check.',
  action_type: 'What happens with what it produces. Carrying out actions or making yes-or-no decisions is treated far more strictly than drafting or suggesting.',
  exposure: 'Who sees what it produces. If clients, the public or the market see it, more is at stake.',
  decision_bindingness: 'How much weight what it produces carries. If it’s acted on without a person deciding, it’s treated as the decision itself.',
  output_reversibility: 'Whether a mistake can be put right. A mistake that can’t be taken back is treated as more serious.',
  scale: 'How widely it’s used. A mistake in a small trial and a mistake everywhere at once are different risks.',
  decision_type: 'What it helps decide. Some decisions — lending is one — always put a case in the most serious category.',
  hitl: 'Whether a person checks what it produces before anything happens as a result of it.',
  replaces_prior_model: 'Whether it takes over from something you use now. A replacement for an existing model, scorecard or spreadsheet calculation gets a closer look.',
  // 2026-08-31 — grounded in the August 2026 OpenAI/Hugging Face incident
  // (grounding/proposed-rules/agentic-infrastructure-access.md): the harm
  // path ran through shared infrastructure and credentials, not through any
  // business decision. These two fields let the rulebook see that dimension.
  // The rendered line no longer names the incident — a newcomer can't use it.
  system_access_scope:
    'What it can get into by itself, beyond what it’s given. Its own logins, the power to change software, and computers shared with other automated tools are how a contained tool ends up reaching much further than intended.',
  multi_instance_coordination:
    'Whether copies of it work together. Copies that pass work to each other can combine small permissions into something none of them could do alone — and “not sure” is worth a reviewer’s attention too.',
};

// Round-5 follow-up (user: "how would a user know what is Zone A? what is
// ML?"): tier and track were the last classified values a business reader
// meets with no translation. Meanings mirror policy/appetite.yaml's track
// definitions and the glossary — wording stays claim-safe: it says which
// oversight regime applies, never re-states rule outcomes.
export const TIER_MEANINGS: Record<string, string> = {
  Critical: 'the most serious category — decisions about people or major exposures. Waits for second-line sign-off.',
  High: 'a lot could go wrong if this misbehaves. Waits for second-line sign-off.',
  Medium: 'moderate stakes. Waits for second-line sign-off.',
  Low: 'low stakes — can proceed self-service, and stays on the record.',
};

export const TRACK_MEANINGS: Record<string, string> = {
  I: 'overseen as a traditional model, under classic model risk management.',
  // Track-order fix, 2026-09-28: the old wording ("it replaces a prior
  // model or acts with high autonomy") was false for the plain TRACK-II
  // rule itself (ordinary ML/generative models on MRM, no replacement or
  // autonomy involved) — true only for the TRACK-II-REPLACE / TRACK-II-
  // AUTONOMY special cases. Reworded to hold for all three.
  II: 'overseen as a model with extra scrutiny — machine-learning models, and any model that replaces a prior one or acts with high autonomy.',
  III: 'overseen by AI governance — generative or agentic AI that newer regulation carves out of the classic model definition.',
};

// R15-C1 (proposal §3.3): register Stage column + filter chips render raw
// `lifecycle_stage` enum values today ("pre_checked", "approved" — the
// audience's canonical vocabulary, not a business reader's). Presentation
// only (Rule 4) — the raw value is kept alongside via a data-* attribute
// on the cell for audit-trail reconciliation, it is not replaced.
//
// Builder check (proposal §3.3, "confirm against the Low-tier lifecycle
// before landing"): `workflow-router.ts`'s `self-service` branch (Low
// tier) routes straight to `lifecycle_stage: 'approved'` with
// `requires_twoLoD_action: false` — no 2LoD ever touches it. So the
// label for `approved` must not claim a person signed off on it.
// "Cleared" passes: it says the case is no longer pending, without
// asserting who or what action cleared it, so it is true for both the
// self-service Low-tier path and a 2LoD sign-off. "Signed off" would
// have overclaimed for the self-service case; "Approved" is banned
// outright by the reserved-word gate (G1, /approved|rejected/i).
// R15-C3 (proposal §3.5, skeptic amendment S1b — Must). graph-summary.ts's
// graphSummaryRows() renders raw engine vocabulary (`traditional-ml`, `L3`,
// `Zone B`, `execute`) on the two screens that ask a human to attest the
// graph is accurate: ConfirmationStep's "Confirm & attest" grid and
// VerdictDisplay's "What you told us" fold. S1b requires the fix to live
// HERE, at the shared source both call sites already import from
// (graph-summary.ts is explicitly "one source... no duplicated
// derivation" per its own header comment) — not patched independently in
// either component, which would let the two copies drift apart exactly as
// CLAUDE.md's specs/copy-drift warning describes.
//
// Each full *_LABELS entry above already carries "short plain phrase — extra
// detail (CODE)"; this derives "short plain phrase · CODE" from it rather
// than hand-duplicating a second copy of every string, so the short and
// long forms cannot say different things about the same value.
function extractParenCode(fullLabel: string): string {
  const m = fullLabel.match(/\(([^()]+)\)\s*$/);
  return m ? m[1]! : fullLabel;
}

function shortPhrase(fullLabel: string): string {
  const withoutCode = fullLabel.replace(/\s*\([^()]*\)\s*$/, '');
  const dashIndex = withoutCode.indexOf('—');
  return (dashIndex === -1 ? withoutCode : withoutCode.slice(0, dashIndex)).trim();
}

/** "A model trained on historical data · traditional ML" — the compact
 *  plain-phrase-then-quiet-code form graphSummaryRows() renders. */
export function plainWithCode(fullLabel: string): string {
  return `${shortPhrase(fullLabel)} · ${extractParenCode(fullLabel)}`;
}

// R15-C5 (proposal §3.6): graph-review field labels reuse the guided form's
// own question words (StructuredForm.tsx, built R15-C3) instead of a second,
// separately-invented phrasing for the same field. Named explicitly by the
// proposal; the engine field name stays visible as quiet code beside it —
// it is not deleted (the three-class code rule, proposal §4 #9).
export const GRAPH_FIELD_LABELS: Record<string, string> = {
  data_class: 'kind of information',
  decision_bindingness: 'how much weight its output carries',
  output_reversibility: 'can it be undone?',
  autonomy_level: 'how much it does without a person',
};

export const STAGE_LABELS: Record<LifecycleStage, string> = {
  idea: 'Idea',
  exploring: 'Exploring',
  pre_checked: 'Awaiting 2LoD sign-off',
  approved: 'Cleared',
  in_production: 'In production',
  monitored: 'Monitored',
  retired: 'Retired',
};

// design-review-003 (Panel B, verified against source): RegisterDetail's
// audit-trail timeline rendered the raw twoloD_reviewed.action value
// directly — including the literal word "rejected" — a live violation of
// the reserved-word gate (G1, /approved|rejected/i) this same file's
// STAGE_LABELS.approved comment already documents. Same fix, same reasons:
// "Cleared" and "Sent back" describe what happened without using either
// banned word.
export const ACTION_LABEL: Record<'approved' | 'rejected' | 'correction_requested', string> = {
  approved: 'Cleared',
  rejected: 'Sign-off declined',
  correction_requested: 'Correction requested',
};

// design-review-003 (Panels B/C, found independently): this exact map used
// to be defined twice, verbatim, in VerdictDisplay.tsx and RegisterDetail.tsx
// — a future status value added to one copy and not the other would let the
// verdict heading and the register chip disagree about the same field.
// Wording deliberately UNCHANGED from both prior copies: VerdictDisplay's
// C-6 test (VerdictDisplay.inheritance.test.tsx) asserts a single-match
// /approved|rejected/i occurrence on the page, and this is that one
// deliberate, tested exception to the reserved-word gate — not a bug to fix.
export const STATUS_LABEL: Record<Verdict['status'], string> = {
  approved: 'Approved',
  approved_with_controls: 'Approved with controls',
  rejected: 'Rejected',
};
