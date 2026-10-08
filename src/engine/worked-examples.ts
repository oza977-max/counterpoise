// R18-A — the ten scripted worked examples of docs/try-these.md, as data
// (specs/intake-flow.md §27.12; implementation-guide §12.6 R18-A). One home for
// them: src/engine/try-these.test.ts pins every outcome from here, and later
// chunks' example list (R18-G) reads the same module.
//
// `description` is the text printed in the guide's block quote, with the quote's
// hard line breaks joined by single spaces (what a person pastes from the
// rendered page). `answers` are the guide's printed "Answers" lists as option
// KEYS (PlainAnswers), mapped once through optionKeyForText in a one-off script
// that was then deleted, and reviewed by hand against the printed words. They
// leave out Question 2 (the description is added by toPlainAnswers) and include
// the guide's common closing answers: any name, and "No" to "replaces something".
// The guide's "Things worth breaking" section is not scripted and is not here.
//
// Engine island: data and types only; the platform/jurisdiction keys are the
// policy's own ids (PLAT-INTERNAL-ML, UK, EU).

import type { PlainAnswers } from './plain-questions';

/** What the guide says the engine returns. Every field present is asserted. */
export interface WorkedExpectation {
  status?: 'approved' | 'approved_with_controls' | 'rejected';
  tier?: 'Low' | 'Medium' | 'High' | 'Critical';
  track?: string;
  bindingConstraint?: string;
  /** Exact control ids, in the engine's order. */
  controls?: string[];
  controlCount?: number;
  inheritedControls?: string[];
  downstreamReviews?: number;
  /** Exact provisional reasons, in order. */
  provisionalReasons?: string[];
  /** Reasons that must be among the provisional reasons. */
  provisionalIncludes?: string[];
  unclassifiedDecisionTypes?: string[];
}

/** An invitation in the guide to change one answer and re-run. */
export interface WorkedVariant {
  label: string;
  /** Answers replaced on top of the case's own. */
  change: PlainAnswers;
  expected: WorkedExpectation;
}

export interface WorkedExample {
  id: string;
  title: string;
  description: string;
  answers: PlainAnswers;
  expected: WorkedExpectation;
  variants?: WorkedVariant[];
}

export const WORKED_EXAMPLES: readonly WorkedExample[] = [
  {
    id: 'case-1',
    title: "Clean approval — nothing triggers",
    description:
      "A dashboard that summarises last month's internal ticket volumes for the operations team. It reads from our own reporting database and produces a written summary. Nobody acts on it automatically.",
    answers: {
      '1': 'Clean approval — nothing triggers',
      '3': 'firm-built',
      '4': 'score',
      '4a': 'rules',
      '5': ['everyday'],
      '6': 'read',
      '7': 'me-or-team',
      '8': 'operational',
      '9': 'yes',
      '10': 'small',
      '11': ['UK'],
      '12': 'no',
    },
    expected: { status: 'approved', tier: 'Low', track: 'I', controls: [], downstreamReviews: 0, provisionalReasons: [] },
  },
  {
    id: 'case-2',
    title: "Hard line — price-sensitive data outside the controlled zone",
    description:
      "A drafting assistant that helps the deals team write summaries of live transactions. It runs on a cloud service outside our own systems.",
    answers: {
      '1': 'Hard line — price-sensitive data outside the controlled zone',
      '3': 'outside-assistant',
      '3a': 'firm-account',
      '4': 'language',
      '5': ['price-sensitive'],
      '6': 'drafts',
      '6a': 'one-input',
      '7': 'me-or-team',
      '8': 'operational',
      '9': 'yes',
      '10': 'small',
      '11': ['UK'],
      '12': 'no',
    },
    expected: { status: 'rejected', bindingConstraint: 'HL-002', controls: [] },
  },
  {
    id: 'case-3',
    title: "Hard line — autonomous lending with nobody in the loop",
    description:
      "A model that approves or declines personal loan applications automatically. Once it decides, the decision goes straight to the customer with no human review.",
    answers: {
      '1': 'Hard line — autonomous lending with nobody in the loop',
      '3': 'firm-built',
      '4': 'score',
      '4a': 'explainable',
      '5': ['people'],
      '6': 'acts-alone',
      '6b': 'yes-no-decision',
      '7': 'clients',
      '8': 'credit',
      '9': 'yes',
      '10': 'wide',
      '11': ['UK'],
      '12': 'no',
    },
    expected: { status: 'rejected', bindingConstraint: 'HL-003' },
  },
  {
    id: 'case-4',
    title: "Hard line — an agent that binds the firm",
    description:
      "An agentic assistant that can decide its own steps, call internal systems and commit the firm to supplier orders without a checkpoint.",
    answers: {
      '1': 'Hard line — an agent that binds the firm',
      '3': 'firm-built',
      '4': 'agentic',
      '5': ['everyday'],
      '6': 'acts-alone',
      '6b': 'something-else',
      '7': 'other-teams',
      '8': 'operational',
      '9': 'yes',
      '10': 'wide',
      '11': ['UK'],
      '12': 'no',
      '13': ['none'],
      '14': 'no',
    },
    expected: { status: 'rejected', bindingConstraint: 'HL-006' },
  },
  {
    id: 'case-5',
    title: "Hard line — and a lesson about which one gets named",
    description:
      "An execution algorithm that buys and sells positions in the market on its own once it is switched on.",
    answers: {
      '1': 'Hard line — and a lesson about which one gets named',
      '3': 'firm-built',
      '4': 'score',
      '4a': 'unexplainable',
      '5': ['confidential'],
      '6': 'acts-alone',
      '6b': 'trades',
      '7': 'public-market',
      '8': 'trading',
      '9': 'no',
      '10': 'wide',
      '11': ['UK'],
      '12': 'no',
    },
    expected: { status: 'rejected', bindingConstraint: 'HL-001' },
    variants: [
      {
        label: 'make the mistake recoverable (answer Yes to the question about putting a mistake right)',
        change: { '9': 'yes' },
        expected: { status: 'rejected', bindingConstraint: 'HL-004' },
      },
    ],
  },
  {
    id: 'case-6',
    title: "Platform inheritance working",
    description:
      "A model that ranks internal support tickets by likely resolution time so the team can plan capacity. It runs on our approved internal ML platform.",
    answers: {
      '1': 'Platform inheritance working',
      '3': 'PLAT-INTERNAL-ML',
      '3platformZone': 'firm-systems',
      '4': 'score',
      '4a': 'unexplainable',
      '5': ['confidential'],
      '6': 'suggests',
      '6a': 'one-input',
      '7': 'other-teams',
      '8': 'operational',
      '9': 'yes',
      '10': 'small',
      '11': ['UK'],
      '12': 'no',
    },
    expected: { status: 'approved_with_controls', tier: 'Medium', track: 'II', controls: [], inheritedControls: ['CTRL-DRIFT-01', 'CTRL-ENC-01', 'CTRL-FINGERPRINT-01'] },
  },
  {
    id: 'case-7',
    title: "Platform inheritance withdrawn",
    description:
      "A chatbot on our approved cloud LLM service that drafts replies to customer questions about their accounts, using their personal details; a person sends each reply.",
    answers: {
      '1': 'Platform inheritance withdrawn',
      '3': 'PLAT-CLOUD-LLM',
      '4': 'language',
      '5': ['people'],
      '6': 'drafts',
      '6a': 'one-input',
      '7': 'clients',
      '8': 'operational',
      '9': 'yes',
      '10': 'wide',
      '11': ['UK'],
      '12': 'no',
    },
    expected: {
      status: 'approved_with_controls',
      tier: 'High',
      track: 'II',
      controls: ['CTRL-CITE-01', 'CTRL-CONDUCT-01', 'CTRL-ENC-01', 'CTRL-FINGERPRINT-01', 'CTRL-REDTEAM-01', 'CTRL-SYNTHMARK-01'],
      inheritedControls: [],
      downstreamReviews: 2,
    },
  },
  {
    id: 'case-8',
    title: "Jurisdiction changes the answer",
    description:
      "A model that screens job applications and shortlists candidates for interview. It is used for roles across our European entities.",
    answers: {
      '1': 'Jurisdiction changes the answer',
      '3': 'firm-built',
      '4': 'score',
      '4a': 'explainable',
      '5': ['people'],
      '6': 'suggests',
      '6a': 'usually-basis',
      '7': 'other-teams',
      '8': 'hiring',
      '9': 'yes',
      '10': 'wide',
      '11': ['EU'],
      '12': 'no',
    },
    expected: { status: 'approved_with_controls', tier: 'Critical', track: 'I', provisionalIncludes: ['unsigned_pack_rules'] },
    variants: [
      {
        label: 'tick only United Kingdom',
        change: { '11': ['UK'] },
        expected: { status: 'approved_with_controls', tier: 'High' },
      },
    ],
  },
  {
    id: 'case-9',
    title: "Both ways a verdict can be provisional at once",
    description:
      "A model that ranks overdue retail accounts so collections agents work the highest-recovery cases first.",
    answers: {
      '1': 'Both ways a verdict can be provisional at once',
      '3': 'firm-built',
      '4': 'score',
      '4a': 'explainable',
      '5': ['people'],
      '6': 'suggests',
      '6a': 'usually-basis',
      '7': 'clients',
      '8': 'other',
      '8other': 'collections prioritisation',
      '9': 'yes',
      '10': 'wide',
      '11': ['UK'],
      '12': 'no',
    },
    expected: {
      status: 'approved_with_controls',
      tier: 'High',
      track: 'I',
      provisionalReasons: ['unsigned_pack_rules', 'unclassified_decision_type'],
      unclassifiedDecisionTypes: ['collections prioritisation'],
    },
  },
  {
    id: 'case-10',
    title: "The full picture",
    description:
      "A model scores retail credit card applications for UK and German customers using income, employment history and bureau data, and automatically declines applications below a cutoff.",
    answers: {
      '1': 'The full picture',
      '3': 'PLAT-INTERNAL-ML',
      '3platformZone': 'firm-systems',
      '4': 'score',
      '4a': 'explainable',
      '5': ['people'],
      '6': 'acts-bounded',
      '6b': 'yes-no-decision',
      '7': 'clients',
      '8': 'credit',
      '9': 'yes',
      '10': 'wide',
      '11': ['UK', 'EU'],
      '12': 'no',
    },
    expected: {
      status: 'approved_with_controls',
      tier: 'Critical',
      track: 'II',
      bindingConstraint: 'INV-AUTONOMY-01',
      controlCount: 7,
      downstreamReviews: 2,
      provisionalIncludes: ['unsigned_pack_rules'],
    },
  },
];
