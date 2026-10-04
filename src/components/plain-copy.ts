// R16 chunk B/C — shared plain-language copy (build/prompts/R16.md v2.1 §2.2,
// §2.4, §3). ONE source for every question, option, help, assumption and
// summary text in the guided form. Code-free (cross-cutting.md §7 Rule 4 —
// this module renders nothing and decides nothing; it only holds strings) so
// the guided form (chunk B), the questionnaire (chunk E) and the summary
// (chunk C) read the identical words. Option keys are stable, short strings
// — never shown to a submitter, only used internally (by plain-intake.ts and
// by the parity test's text -> key lookup) so a later copy edit never breaks
// the answer -> graph mapping.
//
// A few questions (3, 3supplier, 3aWhich, 11) also offer one option per
// policy platform/vendor/jurisdiction. Those are deliberately NOT listed
// here — this module holds only the STATIC copy — because the dynamic list
// depends on the loaded policy, which this file must never import (it would
// stop being code-free). StructuredForm.tsx and plain-intake.ts each build
// the dynamic options straight from the policy, using the registry entry's
// own id as that option's key.
//
// Vocabulary rule (R16-F §6, DR7-14): "check" already carries six different
// meanings across this product's screens (confirm an answer, review a
// graph, a policy reference check, a plausibility double-check, a 2LoD
// review, a verification-evidence check…). Do not reach for "check" for a
// NEW meaning in any text added here — prefer "confirm", "review", or "try
// again", whichever one is actually meant; reserve "check" for the senses
// already established.

import type {
  ActionType,
  DataClass,
  DataZone,
  DecisionBindingness,
  DecisionType,
  Exposure,
  ModelType,
  MultiInstanceCoordination,
  OutputReversibility,
  SystemAccessScope,
} from '../engine/types';
import type { PlausibilitySignal } from '../engine/plausibility';
// R16-F §5 (DR7-06). QuestionId/PlainAnswers are now engine-owned (ids and
// keys only, no words) — re-exported here so every existing component
// import of them from `./plain-copy` keeps working unchanged.
import type { AssumptionRef, QuestionId, PlainAnswers } from '../engine/plain-questions';
export type { QuestionId, PlainAnswers };

// R16-D2 §1 (D-95). `questionId` is widened to `string` (not `QuestionId`)
// because a questionnaire answer (chunk E, not yet built) will carry
// `'field:<graph field>'`, which is not a form QuestionId — this module
// never produces that form itself, but the shape has to allow it so E can
// reuse it unchanged. `shortLabel` and `fields` are new: a short phrase for
// use in a sentence ("answers you weren't sure about: {shortLabels}"), and
// the graph fields this specific answer set, used by the "No" screen's
// contributing-assumption check.
export interface Assumption {
  questionId: string;
  question: string;
  shortLabel: string;
  assumption: string;
  fields: string[];
}

// R16-D2 §1. One short label per question that offers "Not sure" — used in
// the "No" screen's "This is based on answers you weren't sure about: …"
// sentence (D-17/D-18) so a reviewer or submitter reads a short phrase
// rather than the full question text re-run into a list. Falls back to the
// question's own text (below) for any questionId not listed here — never
// undefined, so a sentence built from it is never literally blank.
const ASSUMPTION_SHORT_LABEL: Partial<Record<QuestionId, string>> = {
  '3': 'where the AI comes from',
  '3supplier': 'which supplier it is',
  '3a': 'which account you use',
  '3aWhich': 'which company assistant it is',
  '3platformZone': 'whether your information stays on your firm’s systems',
  '4': 'what kind of AI it is',
  '5': 'what information it uses',
  '6': 'what it does with what it produces',
  '6a': 'how much weight what it produces carries',
  '7': 'who sees what it produces',
  '9': 'whether a mistake can be put right',
  '11': 'which other countries’ rules apply',
  '12': 'whether it replaces something you use',
  '13': 'what it can get into by itself',
  '14': 'whether copies of it work together',
};

export interface PlainOption {
  key: string;
  text: string;
}

export interface PlainQuestion {
  id: QuestionId;
  text: string;
  /** Secondary, italicised guidance shown under the question — e.g. an
   *  example or "this tells us where your information will go." */
  help?: string;
  /** Tick-all (checkbox group) rather than single-select. */
  multi?: boolean;
  /** Free text with no closed option set (Q1, Q2, Q3supplierName, Q3model). */
  freeText?: boolean;
  /** Optional free-text field — the form may be completed with it blank. */
  optional?: boolean;
  options: PlainOption[];
}

export const INTRO_TEXT =
  'New pre-check — tell us about the AI you want to use. Answer in your own words. ' +
  '"Not sure" is always fine: we’ll take the careful assumption and show you what ' +
  'we assumed, so you or your AI risk team can correct it.';

export const PLAIN_QUESTIONS: PlainQuestion[] = [
  {
    id: '1',
    text: 'What do you want to call it?',
    freeText: true,
    options: [],
  },
  {
    id: '2',
    text: 'In a sentence or two, what will it do for you?',
    help: 'e.g. "Turn my client meeting notes into follow-up emails."',
    freeText: true,
    options: [],
  },
  {
    id: '3',
    text: 'Where does the AI come from?',
    help: 'This tells us where your information will go.',
    options: [
      {
        key: 'outside-assistant',
        text:
          'An AI assistant or website run by an outside company — including company accounts your firm set up — ' +
          'e.g. ChatGPT, Microsoft Copilot, Claude, Gemini, or an image or translation website',
      },
      {
        key: 'supplier-feature',
        text:
          'An AI feature inside software your firm already uses from a supplier — e.g. in Salesforce, Workday or Bloomberg',
      },
      {
        key: 'specialist-product',
        text:
          'A product your firm is buying from a specialist supplier — e.g. a credit-scoring, fraud-detection, customer-chatbot or coding tool',
      },
      // (d) one option per policy platform — appended dynamically by the
      // consumer, keyed by the platform's own registry id.
      { key: 'firm-built', text: 'Something a team in your firm built for this job' },
      { key: 'not-sure', text: 'Not sure yet' },
    ],
  },
  {
    id: '3supplier',
    text: 'Which supplier is it?',
    help:
      'Only pick a name if you’re sure it’s the one you use. If you’re not certain, choose "I don’t know" ' +
      'rather than guess — picking the wrong one could miss checks your actual tool needs.',
    options: [
      // one option per policy vendor of kind `supplier` — appended
      // dynamically, keyed by the vendor's own registry id.
      { key: 'not-on-list', text: 'Not on this list' },
      { key: 'dont-know', text: 'I don’t know' },
    ],
  },
  {
    id: '3supplierName',
    text: 'What is it called?',
    optional: true,
    freeText: true,
    options: [],
  },
  {
    id: '3model',
    text: 'Model name, if you know it',
    help: 'Optional — your AI risk team can confirm.',
    optional: true,
    freeText: true,
    options: [],
  },
  {
    id: '3a',
    text: 'Which version are you using?',
    options: [
      {
        key: 'firm-account',
        text:
          'The firm’s own account — I sign in with my work login, and the firm has a contract with the company',
      },
      { key: 'personal-account', text: 'A free or personal account' },
      { key: 'not-sure', text: 'Not sure' },
    ],
  },
  {
    id: '3aWhich',
    text: 'Which of your firm’s AI assistants is it?',
    options: [
      // one option per `company_assistant` vendor — appended dynamically,
      // keyed by the vendor's own registry id.
      { key: 'not-sure', text: 'Not sure' },
    ],
  },
  // W-9 (R16-W §1, D-79): shown only for a Q3 platform option that allows
  // more than one zone (StructuredForm filters these four options down to
  // the ones plain-intake.ts's platformZoneOptionKeys() says the chosen
  // platform allows, plus "Not sure" always). All four texts are static;
  // only the SUBSET shown varies by platform.
  {
    id: '3platformZone',
    text: 'Does your information stay on your firm’s own systems the whole time?',
    help:
      'Your firm’s platform can run some AI itself and pass other work to an outside supplier. If you ' +
      'don’t know which happens here, choose "Not sure".',
    options: [
      { key: 'firm-systems', text: 'Yes — the platform runs the AI on the firm’s own systems' },
      { key: 'outside-supplier', text: 'No — the platform passes it to an outside supplier’s AI' },
      { key: 'outside-service', text: 'No — it goes out to a public website or service' },
      { key: 'not-sure', text: 'Not sure' },
    ],
  },
  {
    id: '4',
    text:
      'What kind of AI is it? If more than one fits — for example, something that turns speech into text and writes ' +
      'a summary of it — pick the one nearest the bottom of this list.',
    help:
      'Different kinds of AI go wrong in different ways. (Whether it acts by itself is asked separately, in question 6.)',
    options: [
      {
        key: 'score',
        text:
          'Gives a score, ranking, flag, category or forecast — e.g. a credit score, a fraud alert, a ranking of CVs, the likely cause of a problem',
      },
      {
        key: 'perception',
        text: 'Recognises things in images, sound or documents — e.g. reads cheques, transcribes calls',
      },
      { key: 'language', text: 'Reads, summarises, translates, writes or answers questions in words' },
      { key: 'generative', text: 'Creates images, audio, video or code' },
      {
        key: 'agentic',
        text:
          'An AI agent that works through tasks on its own, using other tools or systems — e.g. sends messages, books things, updates records, changes code',
      },
      { key: 'not-sure', text: 'Not sure' },
    ],
  },
  {
    id: '4a',
    text: 'Could the people who built it show you why it gave a particular result?',
    options: [
      { key: 'rules', text: 'Yes — it follows fixed, written-down rules, like a scorecard' },
      { key: 'explainable', text: 'Yes — they can show which factors drove each result' },
      { key: 'unexplainable', text: 'No, or I don’t know' },
    ],
  },
  {
    id: '5',
    text: 'What information will it see or use? Tick all that apply.',
    help: 'We go by the most sensitive thing you tick.',
    multi: true,
    options: [
      {
        key: 'people',
        text:
          'Information about people — clients, applicants, staff or anyone else: names, contact details, account and ' +
          'financial details, CVs — anything about someone who can be identified',
      },
      {
        key: 'price-sensitive',
        text: 'Price-sensitive information — unannounced deals or results, anything that could move a share price',
      },
      {
        key: 'confidential',
        text:
          'Confidential firm information — internal data, code or documents not meant for outside the firm, whether or not they’re marked confidential',
      },
      { key: 'everyday', text: 'Everyday work information — emails, policies, general documents' },
      { key: 'typed-only', text: 'Only what I type in myself — no documents, records or data' },
      { key: 'public', text: 'Only public information — websites, published reports, news' },
      { key: 'not-sure', text: 'Not sure' },
    ],
  },
  {
    id: '6',
    text:
      'What happens with what it produces? If it does several things, pick the one where it has the most freedom.',
    help: 'The more it does on its own, the more safeguards it needs.',
    options: [
      { key: 'read', text: 'finds or summarises for people to read — nobody acts on it directly' },
      { key: 'answers', text: 'answers people’s questions directly, like a chat assistant' },
      {
        key: 'drafts',
        text: 'creates a draft — text, an image or code — and a person checks it before it’s used',
      },
      { key: 'suggests', text: 'suggests, ranks or flags things, and a person decides what to do' },
      {
        key: 'prepares',
        text: 'prepares an action — a payment, an order, an update — and a person approves each one before it goes ahead',
      },
      {
        key: 'acts-reviewed',
        text: 'decides or acts by itself, and a person reviews afterwards — every case or a sample',
      },
      { key: 'acts-bounded', text: 'acts by itself within limits someone set, with no routine review' },
      { key: 'acts-alone', text: 'acts entirely by itself, with no person involved at any point' },
      { key: 'not-sure', text: 'Not sure' },
    ],
  },
  {
    id: '6a',
    text: 'How much weight does what it produces carry?',
    options: [
      {
        key: 'little',
        text:
          'Little — it’s routine work, like an email, a picture or a first draft; nobody makes an important decision from it',
      },
      { key: 'one-input', text: 'It’s one input among several when someone makes a decision' },
      { key: 'usually-basis', text: 'It’s usually what a decision is based on — people tend to go with it' },
      { key: 'not-sure', text: 'Not sure' },
    ],
  },
  {
    id: '6b',
    text: 'What does it do when it acts?',
    options: [
      { key: 'trades', text: 'Places or changes trades' },
      { key: 'yes-no-decision', text: 'Makes a yes-or-no decision — e.g. accepts or declines an application, signs something off' },
      { key: 'something-else', text: 'Something else — sends, books, updates records, deploys changes' },
    ],
  },
  {
    id: '7',
    text: 'Who ends up seeing or receiving what it produces, in its final form? If more than one, pick the widest.',
    help: 'If it changes code, records or systems instead, think about who is affected by those changes.',
    options: [
      { key: 'me-or-team', text: 'Only me or my own team' },
      { key: 'other-teams', text: 'Other teams in the firm' },
      { key: 'clients', text: 'Clients or customers — including people applying to us' },
      {
        key: 'public-market',
        text: 'The public, the market or regulators — e.g. public social media, published reports',
      },
      { key: 'not-sure', text: 'Not sure' },
    ],
  },
  {
    id: '8',
    text: 'Which of these does it help decide, if any? Pick the closest.',
    options: [
      { key: 'credit', text: 'Whether to lend to someone, or on what terms' },
      {
        key: 'hiring',
        text: 'Who to hire or promote — including tools that only produce notes, transcripts or summaries a person later uses to decide',
      },
      { key: 'pricing', text: 'What to charge a client, or how something is priced or valued' },
      { key: 'trading', text: 'Buying or selling investments' },
      { key: 'fraud', text: 'Spotting fraud or financial crime' },
      { key: 'regulatory', text: 'Figures or statements sent to a regulator' },
      { key: 'operational', text: 'None of these — it’s for day-to-day work' },
      { key: 'other', text: 'Something else — describe it' },
    ],
  },
  {
    id: '8other',
    text: 'What kind of decision is it?',
    optional: false,
    freeText: true,
    options: [],
  },
  {
    id: '9',
    text: 'If it gets something wrong, can the mistake be caught and put right before it does lasting harm — to anyone?',
    options: [
      { key: 'yes', text: 'Yes' },
      { key: 'no', text: 'No — once it happens, it can’t be taken back' },
      { key: 'not-sure', text: 'Not sure' },
    ],
  },
  {
    id: '10',
    text: 'How widely will it be used?',
    help: 'Think about how much of the work it covers, not just how many people use it.',
    options: [
      { key: 'small', text: 'Just me, or a small trial' },
      { key: 'team', text: 'My team, as part of normal work' },
      { key: 'wide', text: 'Several teams, the whole business, or every case of a kind (e.g. all applications)' },
    ],
  },
  {
    id: '11',
    text: 'Which countries does it involve? Tick all.',
    help:
      'For public posts, tick where your firm is based. Otherwise tick where your firm (or your part of it) is based ' +
      'and where the people or business it affects are — people applying to you count. This is not about where the ' +
      'AI’s servers are.',
    multi: true,
    options: [
      // one option per policy jurisdiction — appended dynamically, keyed by
      // the jurisdiction's own code.
      { key: 'elsewhere-not-sure', text: 'Somewhere else, or not sure' },
    ],
  },
  {
    id: '12',
    text: 'Does it replace something you already use for the same job — a model, scorecard, rules or a spreadsheet calculation?',
    options: [
      { key: 'yes', text: 'Yes' },
      { key: 'no', text: 'No' },
      { key: 'not-sure', text: 'Not sure' },
    ],
  },
  {
    id: '13',
    text: 'What can it get into by itself? Tick all that apply.',
    multi: true,
    options: [
      { key: 'none', text: 'Nothing beyond what it’s given for the task' },
      { key: 'credentialed', text: 'It has its own logins, passwords or access tokens for other systems' },
      { key: 'deployment', text: 'It can change software or settings, or deploy updates, without a person' },
      { key: 'shared', text: 'It runs on computers or servers shared with other automated tools' },
      { key: 'not-sure', text: 'Not sure' },
    ],
  },
  {
    id: '14',
    text: 'Can copies of it, or other AI agents, pass work or messages to each other?',
    options: [
      { key: 'no', text: 'No — it works alone' },
      { key: 'yes', text: 'Yes' },
      { key: 'not-sure', text: 'Not sure' },
    ],
  },
];

export function findQuestion(id: QuestionId): PlainQuestion | undefined {
  return PLAIN_QUESTIONS.find((q) => q.id === id);
}

export function findOption(id: QuestionId, key: string): PlainOption | undefined {
  return findQuestion(id)?.options.find((o) => o.key === key);
}

// R16-F F-8 / §4 (DR7-08, DR7-11): shown when a tick-all answer about
// system access is refused by the engine's normaliseAccessScope — on the
// form's question 13 and in the correction screen's editor. The engine's own
// reasons name the internal field ("system_access_scope must have at least
// one value"): fine for a log, not for a person. Every refusal a person can
// reach has the same fix, so one sentence covers them all.
export const ACCESS_SCOPE_REFUSAL_TEXT =
  'Tick at least one option. “Nothing beyond what it’s given for the task” goes on its own — it can’t be ticked with the others.';

// ---------------------------------------------------------------------------
// R16-E §2 (D-101, DR7-26/28/29/31). ONE source for the targeted
// questionnaire's (chunk E, QuestionnaireStep) questions and option labels
// AND the review screen's (§4, GraphView's graph_review cards) field labels
// and value words — so the words a person edits are the words they'd have
// answered. Keyed by the GRAPH field (src/engine/types.ts's own names),
// unlike PLAIN_QUESTIONS above, which is keyed by the guided FORM's own
// question id. The description path never shows the form's situational
// Q1-14; this table is its field-level vocabulary instead.
export interface QuestionnaireFieldCopy {
  question: string;
  help?: string;
  /** A short phrase for a sentence — "Check \"{shortLabel}\" on the card
   *  …", "answers you weren't sure about: {shortLabel}" — never the full
   *  question text re-run into a list. */
  shortLabel: string;
  /** value -> label, keyed by the ENGINE value (e.g. 'Client PII', '2',
   *  'true') — both the targeted questionnaire's `IntakeQuestion.options`
   *  and GraphView's node fields carry engine values directly, never the
   *  form's own internal option keys ('people', 'score', …). */
  options: Record<string, string>;
  /** The stricter value "Not sure" sets, and the sentence completing "we
   *  assumed ___" when it does. Absent where the field offers no "Not
   *  sure" at all (decision_type, scale — the form has none either) or
   *  where the stricter answer is reached through its own named choice
   *  instead (vendor's "I don't know", declared_model_id's "I don't
   *  know" — see VENDOR_UNSURE_* below). */
  notSure?: { value: unknown; assumption: string };
}

export const QUESTIONNAIRE_COPY: Record<string, QuestionnaireFieldCopy> = {
  data_class: {
    question: 'What’s the most sensitive information it will see or use?',
    shortLabel: 'what information it uses',
    options: {
      'Client PII':
        'Information about people — clients, applicants, staff or anyone else who can be identified',
      MNPI: 'Price-sensitive information — anything that could move a share price',
      Confidential: 'Confidential firm information',
      Internal: 'Everyday work information, or only what you type in yourself',
      Public: 'Only public information',
    },
    notSure: { value: 'Confidential', assumption: 'confidential firm information — the stricter case' },
  },
  data_zone: {
    question: 'Where will your information go?',
    shortLabel: 'where your information goes',
    options: {
      'Zone A': 'An outside website or service, outside your firm’s control',
      'Zone B': 'A supplier’s systems, outside your firm’s own',
      'Zone C': 'Your firm’s own systems',
    },
    notSure: { value: 'Zone A', assumption: 'an outside website with no contract — the strictest case' },
  },
  model_type: {
    question:
      'What kind of AI is it? If more than one fits — for example, something that turns speech into text and writes a summary of it — pick the one nearest the bottom of this list.',
    help:
      'Different kinds of AI go wrong in different ways. (Whether it acts by itself is asked separately, in question 6.)',
    shortLabel: 'what kind of AI it is',
    options: {
      statistical:
        'Gives a score, ranking, flag, category or forecast — and follows fixed, written-down rules, like a scorecard',
      'traditional-ml':
        'Gives a score, ranking, flag, category or forecast — and the people who built it can show which factors drove each result',
      ml: 'Gives a score, ranking, flag, category or forecast — and no one can easily show why it gave a particular result',
      'deep-learning': 'Recognises things in images, sound or documents — e.g. reads cheques, transcribes calls',
      llm: 'Reads, summarises, translates, writes or answers questions in words',
      'generative-ai': 'Creates images, audio, video or code',
      agentic:
        'An AI agent that works through tasks on its own, using other tools or systems — e.g. sends messages, books things, updates records, changes code',
    },
    notSure: {
      value: 'agentic',
      assumption:
        'an AI agent that can work on its own — the strictest case, because agents need the most safeguards. Change it if you can.',
    },
  },
  action_type: {
    question: 'What happens with what it produces?',
    shortLabel: 'what it does with what it produces',
    options: {
      read: 'It finds or summarises things for people to read',
      inform: 'It answers people’s questions directly',
      draft: 'It creates drafts',
      recommend: 'It suggests, ranks or flags things',
      execute: 'It carries out actions — sends, books, updates records or deploys changes',
      trade: 'It places or changes trades',
      approve: 'It makes yes-or-no decisions, like accepting an application',
    },
    notSure: { value: 'execute', assumption: 'it carries out actions by itself — the stricter case' },
  },
  autonomy_level: {
    question: 'How much does it do without a person?',
    shortLabel: 'how much it does without a person',
    options: {
      '0': 'Nothing by itself — people decide what to do with what it produces',
      '1': 'A person checks or approves each thing before it happens',
      '2': 'It decides or acts by itself, and a person reviews afterwards',
      '3': 'It acts by itself within limits someone set, with no routine review',
      '4': 'It acts entirely by itself, with no person involved at any point',
    },
    notSure: {
      value: '4',
      assumption:
        'it acts entirely by itself with no person involved at any point — the strictest case. This changes the result a lot; change it if you can.',
    },
  },
  hitl: {
    question: 'Does a person check what it produces before anything happens?',
    shortLabel: 'whether a person checks it first',
    options: { true: 'Yes', false: 'No' },
    notSure: { value: false, assumption: 'nobody checks it first — the stricter case' },
  },
  decision_bindingness: {
    question: 'How much weight does what it produces carry?',
    shortLabel: 'how much weight what it produces carries',
    options: {
      'non-binding':
        'Little — it’s routine work, like an email, a picture or a first draft; nobody makes an important decision from it',
      advisory: 'It’s one input among several when someone makes a decision',
      material: 'It’s usually what a decision is based on — people tend to go with it',
      binding: 'It’s acted on without a person deciding',
    },
    notSure: { value: 'material', assumption: 'usually what a decision is based on — the stricter case' },
  },
  exposure: {
    question:
      'Who ends up seeing or receiving what it produces, in its final form? If more than one, pick the widest.',
    help: 'If it changes code, records or systems instead, think about who is affected by those changes.',
    shortLabel: 'who sees what it produces',
    options: {
      'internal-only': 'Only me or my own team',
      'internal-shared': 'Other teams in the firm',
      'client-facing': 'Clients or customers — including people applying to us',
      'market-facing': 'The public, the market or regulators — e.g. public social media, published reports',
    },
    notSure: {
      value: 'market-facing',
      assumption: 'the public or the market — the widest audience. Change it if the real audience is narrower.',
    },
  },
  // DR7-29: ONE lending option (Q8's own credit/lending text); `lending-
  // decision` stays a legal engine value (extraction, older data) but is
  // not offered here — both are in CANONICAL_VOCABULARY and the generator
  // copies them all, so the engine still accepts either. "Something else"
  // (DR7-29) leaves `decision_type` unset and inserts a follow-up text
  // question for `decision_type_other` right after — dropping it would
  // give this path a lighter route than the form's own 8other.
  decision_type: {
    question: 'Which of these does it help decide, if any? Pick the closest.',
    shortLabel: 'what it helps decide',
    options: {
      'credit-decision': 'Whether to lend to someone, or on what terms',
      hiring:
        'Who to hire or promote — including tools that only produce notes, transcripts or summaries a person later uses to decide',
      pricing: 'What to charge a client, or how something is priced or valued',
      trading: 'Buying or selling investments',
      'fraud-detection': 'Spotting fraud or financial crime',
      'regulatory-reporting': 'Figures or statements sent to a regulator',
      operational: 'None of these — it’s for day-to-day work',
      // Pseudo-value: never a legal DecisionType. QuestionnaireStep
      // recognises it and inserts the decision_type_other follow-up
      // instead of writing it onto the graph.
      other: 'Something else — describe it',
    },
    // No "Not sure" — the form has none either.
  },
  decision_type_other: {
    question: 'What does it help decide?',
    shortLabel: 'what it helps decide',
    options: {},
  },
  output_reversibility: {
    question:
      'If it gets something wrong, can the mistake be caught and put right before it does lasting harm — to anyone?',
    shortLabel: 'whether a mistake can be put right',
    options: {
      reversible: 'Yes',
      irreversible: 'No — once it happens, it can’t be taken back',
    },
    notSure: {
      value: 'irreversible',
      assumption: 'it can’t be undone — the strictest case. Change it if a mistake can actually be caught and fixed.',
    },
  },
  scale: {
    question: 'How widely will it be used?',
    help: 'Think about how much of the work it covers, not just how many people use it.',
    shortLabel: 'how widely it’s used',
    options: {
      limited: 'Just me, or a small trial',
      at_scale:
        'My team, as part of normal work, or wider — several teams, the whole business, or every case of a kind (e.g. all applications)',
    },
    // No "Not sure" — the form has none either.
  },
  replaces_prior_model: {
    question:
      'Does it replace something you already use for the same job — a model, scorecard, rules or a spreadsheet calculation?',
    shortLabel: 'whether it replaces something you use',
    options: { true: 'Yes', false: 'No' },
    notSure: {
      value: true,
      assumption: 'it replaces something you already use — the stricter case. Change it if nothing is being replaced.',
    },
  },
  system_access_scope: {
    question: 'What can it get into by itself? Tick all that apply.',
    shortLabel: 'what it can get into by itself',
    options: {
      none: 'Nothing beyond what it’s given for the task',
      credentialed_systems: 'It has its own logins, passwords or access tokens for other systems',
      deployment_authority: 'It can change software or settings, or deploy updates, without a person',
      shared_infrastructure: 'It runs on computers or servers shared with other automated tools',
    },
    notSure: {
      value: ['shared_infrastructure', 'credentialed_systems', 'deployment_authority'],
      assumption:
        'it can reach other systems with its own logins, can deploy changes, and runs on shared infrastructure — the strictest case',
    },
  },
  multi_instance_coordination: {
    question: 'Can copies of it, or other AI agents, pass work or messages to each other?',
    shortLabel: 'whether copies of it work together',
    options: { no: 'No — it works alone', yes: 'Yes' },
    notSure: {
      value: 'unknown',
      assumption:
        'whether copies of it can pass work to each other isn’t known — treated as if they can, since that’s the stricter case',
    },
  },
  // DR7-28. Registry options (one per policy vendor of kind `supplier`) are
  // merged in by the caller (QuestionnaireStep, which has the policy) —
  // this table holds only the two fixed choices every vendor question
  // offers regardless of the firm's own list. See VENDOR_UNSURE_* below for
  // "I don't know"'s own value/assumption pair.
  vendor: {
    question: 'Which supplier is it?',
    help:
      'Only pick a name if you’re sure it’s the one you use. If you’re not certain, choose "I don’t know" rather than guess — picking the wrong one could miss checks your actual tool needs.',
    shortLabel: 'which supplier it is',
    options: { 'not-on-list': 'Not on this list', 'dont-know': 'I don’t know' },
  },
  vendor_name: {
    question: 'What is it called?',
    help: '(optional)',
    shortLabel: 'which supplier it is',
    options: {},
  },
  // DR7-28. "I don't know" here leaves the field unset — "none declared" —
  // the same honest-absence rule the form's own Q3model already follows
  // (D-27); no assumption is recorded, because nothing was assumed.
  declared_model_id: {
    question: 'Model name, if you know it',
    help: '(optional — your AI risk team can confirm)',
    shortLabel: 'which model it is',
    options: { 'not-on-list': 'Not on the list', 'dont-know': 'I don’t know' },
  },
  declared_model_id_name: {
    question: 'What is it called?',
    help: '(optional)',
    shortLabel: 'which model it is',
    options: {},
  },
};

// DR7-28. vendor's "I don't know" branch: the value written onto the graph
// (a plain, human-readable sentence, D-72's own style — never a bare
// "unregistered" sentinel) and the assumption sentence listed back, which
// is deliberately a DIFFERENT, more explanatory phrase — exactly as the
// form's own Q3supplier "dont-know" case already does (plain-intake.ts /
// ASSUMPTION_TEXT['3supplier:dont-know']) — so the two paths read alike.
export const VENDOR_UNSURE_VALUE = 'a supplier you weren’t sure of';
export const VENDOR_UNSURE_ASSUMPTION = 'a supplier your firm hasn’t assessed — the stricter case';

/** DR7-28. vendor's "Not on this list" branch, resolved once the follow-up
 *  text is in hand (or left blank) — mirrors plain-intake.ts's Q3supplier
 *  "not-on-list" case (D-64) exactly, so the same typed name reads the
 *  same way on both paths. */
export function vendorNotOnListValue(text: string): string {
  const trimmed = text.trim();
  return trimmed ? `${trimmed} (not on your firm’s list)` : 'An unlisted supplier (not on your firm’s list)';
}

/** R16-E review pass 2. The words for a recorded supplier: the registry's
 *  plain name for a registered one (its id is internal — "VENDOR-APPROVED-LLM"
 *  must never reach a submitter's screen), plain words for "built inside the
 *  firm", and anything else as written (a typed or model-read name). One
 *  lookup, used by the review screen and the summary's "Through:" line. */
export function supplierDisplayName(
  vendor: string,
  policy: { platforms?: Array<{ id: string; plain_name?: string }>; vendors?: Array<{ id: string; plain_name?: string }> } | undefined,
): { name: string; registered: boolean } {
  if (vendor === 'internal') return { name: 'None — your firm built it', registered: false };
  const match = [...(policy?.platforms ?? []), ...(policy?.vendors ?? [])].find((r) => r.id === vendor);
  if (match) return { name: match.plain_name ?? 'a supplier on your firm’s list', registered: true };
  // G-7: an id-shaped value (capitals, digits, hyphens/underscores, no
  // spaces — "VENDOR-GONE-01", "VENDOR-LLM-v1") that matches nothing is an
  // internal id for something not on the list; it never reaches a screen
  // raw. An ordinary name a person typed ("Anthropic") shows as written.
  // CR6-G7b: "id-shaped" is judged against the policy's OWN registry id
  // shape (the prefix of its vendor/platform ids, e.g. "VENDOR-", "PLAT-").
  // Real names like "Q-Corp" or "ACME-Vision" look the same in general, so
  // with no policy to learn the shape from, the value shows as written.
  const prefixes = new Set(
    [...(policy?.platforms ?? []), ...(policy?.vendors ?? [])]
      .map((r) => /^[A-Z][A-Z0-9]*[-_]/.exec(r.id)?.[0])
      .filter((p): p is string => !!p),
  );
  if (ID_SHAPED.test(vendor) && [...prefixes].some((p) => vendor.startsWith(p))) return { name: 'a supplier not on your firm’s list', registered: false };
  return { name: vendor, registered: false };
}

const ID_SHAPED = /^[A-Z][A-Z0-9]*(?:[-_][A-Za-z0-9]+)+$/;

/** CR6-23: a jurisdiction code as the policy's own country name; a code the
 *  policy does not list is never shown as itself. The one lookup behind the
 *  summary's country list and the "No" screen's countryPhrase. */
export const UNLISTED_COUNTRY = 'another country';
export function lookupCountryName(
  code: string,
  policy: { jurisdictions?: Array<{ code: string; name: string }> } | undefined,
): string | undefined {
  return policy?.jurisdictions?.find((j) => j.code === code)?.name;
}
export function countryName(
  code: string,
  policy: { jurisdictions?: Array<{ code: string; name: string }> } | undefined,
): string {
  return lookupCountryName(code, policy) ?? UNLISTED_COUNTRY;
}

/** CR6-23b: a list of country names for display — the policy's own names in
 *  order, with every unlisted code folded into one phrase ("another country"
 *  or "N other countries") so the same phrase never repeats. */
export function countryNameList(
  codes: string[],
  policy: { jurisdictions?: Array<{ code: string; name: string }> } | undefined,
): string[] {
  const listed: string[] = [];
  let unlisted = 0;
  for (const code of codes) {
    const n = lookupCountryName(code, policy);
    if (n === undefined) unlisted += 1;
    else if (!listed.includes(n)) listed.push(n);
  }
  if (unlisted === 1) listed.push(UNLISTED_COUNTRY);
  else if (unlisted > 1) listed.push(`${unlisted} other countries`);
  return listed;
}

/** §2's catch-all (D-20's "no bare code ever reaches the first screen",
 *  extended to the targeted questionnaire): every field the generator can
 *  emit has an explicit entry above, proved by a guard test — this exists
 *  only so a field nobody anticipated still renders a safe, honest
 *  question instead of a crash or the bare field id. `label` is the
 *  caller's own best name for the field (its GraphView row label, or an
 *  R16-W SUMMARY_LABELS heading) when it has one. */
export function questionnaireCopyForField(field: string, label?: string): QuestionnaireFieldCopy {
  const known = QUESTIONNAIRE_COPY[field];
  if (known) return known;
  const name = label ?? field.replace(/_/g, ' ');
  return {
    question: `Please check this detail: ${name}.`,
    shortLabel: name,
    options: {},
  };
}

// R16-E §4 (DR7-26). The description-path review screen's three card
// titles — shared with `plausibilityMessageForDescription` below and with
// GraphView.tsx's own column headings, so neither can drift from the
// other.
export const GRAPH_REVIEW_CARD_TITLES = {
  input: 'What it uses',
  processing: 'The AI',
  output: 'What comes out',
} as const;

// R16-E §4 (v2.1, F1B-1). The two paths' own wording for a plausibility
// reference (src/engine/plausibility.ts's PlausibilitySignal — the engine
// returns a reference only, never a sentence). The form path names its
// own question (unchanged from R16-F); the description path names the
// review screen's card and row instead, since it never shows the form's
// questions. No sentence is split between the engine and either screen,
// and no field code or card id ever reaches the screen.
const PLAUSIBILITY_FORM_TEXT: Record<PlausibilitySignal, string> = {
  'sounds-internal':
    'Your description sounds like the AI runs on your firm’s own systems, but your answers say your information goes outside the firm. Check “Where does the AI come from?” — it affects several rules.',
  'mentions-training':
    'Your description mentions training or fine-tuning, which isn’t something we ask about directly. Check “What happens with what it produces?” — pick the option that describes what the finished tool does, not the training itself.',
  'says-person-reviews':
    'Your description says a person reviews this, but your answers say it acts without that review. Check “What happens with what it produces?” — pick the option that matches whether someone reviews it.',
  'sounds-autonomous':
    'Your description sounds like it acts without a person involved, but your answers say a person is involved. Check “What happens with what it produces?” — pick the option that matches how much it does on its own.',
};

export function plausibilityMessageForForm(signal: PlausibilitySignal): string {
  return PLAUSIBILITY_FORM_TEXT[signal];
}

// What looks inconsistent, in the description path's own terms ("we read",
// not "your answers" — on this path the values were read from the
// description). Verifying R16-E: the first version kept only the "where to
// look" half, so a submitter was told to check something without being told
// why — the R16-F messages it replaced had always said why.
const PLAUSIBILITY_DESCRIPTION_REASON: Record<PlausibilitySignal, string> = {
  'sounds-internal':
    'Your description sounds like the AI runs on your firm’s own systems, but we read that your information goes outside the firm.',
  'mentions-training':
    'Your description mentions training or fine-tuning, which isn’t something we ask about directly — what matters here is what the finished tool does.',
  'says-person-reviews': 'Your description says a person reviews this, but we read that it acts without that review.',
  'sounds-autonomous':
    'Your description sounds like it acts without a person involved, but we read that a person is involved.',
};

/** The description path's own wording (v2.1): why it looks inconsistent,
 *  then the review screen's card and row to check — never a form question
 *  this path does not show. */
export function plausibilityMessageForDescription(signal: PlausibilitySignal, card: string, row: string): string {
  return `${PLAUSIBILITY_DESCRIPTION_REASON[signal]} Check “${row}” on the card “${card}”.`;
}

// R16-E §5 (D-104, DR7-30/AB-1). The extraction error has TWO call sites
// (IntakeFlow.tsx's handleConfirmNewUseCase and handleRetryExtraction) —
// both read this one function, so the two can never drift apart (a v2.1
// fix-verification finding: an earlier plan would have let them). Typed as
// the literal union rather than importing `LlmError` from `src/llm/*` — a
// components file reads its own words, not the SDK layer's error type.
export function extractionErrorMessage(kind: 'no-api-key' | 'network-error' | 'parse-error'): string {
  switch (kind) {
    case 'no-api-key':
      return 'The description reader isn’t set up on this computer.';
    case 'network-error':
      return 'We couldn’t reach the description reader just now.';
    case 'parse-error':
      return 'We couldn’t read your description reliably.';
  }
}

export const EXTRACTION_ERROR_HELP = 'You can try again, or answer the questions yourself instead.';

// CR7-37. What a person is told when the firm's own rules file cannot be used.
// Plain, and it says whose problem it is and who can fix it — the field paths
// and reason strings (`invariants[3].condition: …`) are for whoever edits the
// file, so they go to the console, never into an alert a submitter reads.
export const POLICY_PROBLEM_MESSAGE =
  'Your firm’s rules file has a problem, so this can’t be checked right now. Nothing about your answers is at fault — your AI risk team can fix it in the Appetite framework screen.';

// CR6-12 (Minor). evaluate()'s EngineError.kind used to reach the screen as
// the raw enum string inside "Evaluation failed: {kind}", itself then
// wrapped in "...Review your answers and try again." — every one of these
// kinds is the firm's own rules, policy file or pack authoring, never
// something a different answer from the person would have avoided. One
// plain sentence per kind, same posture as extractionErrorMessage above —
// and, like it, typed as the literal union rather than importing
// EngineError from src/engine/types: a components file reads its own
// words, not the engine layer's error type.
export function engineErrorMessage(
  kind: 'policy-invalid' | 'hard-line-tripped' | 'no-control-set' | 'jurisdiction-conflict' | 'no-track-match',
): string {
  switch (kind) {
    case 'policy-invalid':
      return 'Your firm’s rules file has a problem, so this can’t be worked out right now. Nothing about your answers is at fault.';
    case 'hard-line-tripped':
      return 'One of your firm’s own always-block rules has a problem, so this can’t be worked out right now. Nothing about your answers is at fault.';
    case 'no-control-set':
      return 'Your firm’s rules don’t yet say what would make this acceptable — that’s a gap in the rules, not something wrong with your answers.';
    case 'jurisdiction-conflict':
      return 'Two of your firm’s rule sets disagree about the countries involved here, so this can’t be worked out right now. Nothing about your answers is at fault.';
    case 'no-track-match':
      return 'Your firm’s rules don’t yet cover this particular combination of answers — that’s a gap in the rules, not something wrong with your answers.';
  }
}

// A worked case's answers (backtest/worked-case-answers.json) were typed
// independently of this file and use plain ASCII apostrophes throughout
// ("they're", "can't"); this module's own option text uses the typographic
// ’ form. Normalising both sides before comparing means the parity
// test's text->key lookup is not hostage to which quote character either
// document happened to use — a real difference in MEANING should fail the
// lookup, a difference in QUOTE GLYPH should not.
function normaliseQuotes(s: string): string {
  return s.replace(/[‘’']/g, "'");
}

/** Reverse lookup used only by the parity test: a worked case's answers are
 *  written blind, in the exact option TEXT (§2.3) — never the key — so the
 *  test must translate text back to a key before calling
 *  plainAnswersToFormValues(), which only understands keys. Static options
 *  only; the caller handles the dynamic platform/vendor/jurisdiction options
 *  itself (see plain-intake.ts's resolve* helpers). */
export function optionKeyForText(id: QuestionId, text: string): string | undefined {
  const target = normaliseQuotes(text);
  return findQuestion(id)?.options.find((o) => normaliseQuotes(o.text) === target)?.key;
}

// §2.3 assumption texts, keyed `${questionId}:${optionKey}`. Exact wording
// where the contract quotes it; a consistent, plainly-written sentence in
// the same voice where it does not (§0.1's "every Not sure is listed back"
// still applies even where v2.1 did not pin the exact words — see the R16-B
// handover for the explicit list of which ones were interpreted).
export const ASSUMPTION_TEXT: Record<string, string> = {
  '3:not-sure': 'an outside website with no contract — the strictest case',
  '3supplier:dont-know': 'a supplier your firm hasn’t assessed — the stricter case',
  '3a:not-sure': 'a personal account with no firm contract — the stricter case',
  '3aWhich:not-sure': 'one of your firm’s AI assistants, but not confirmed which — the stricter case',
  '4:not-sure':
    'an AI agent that can work on its own — the strictest case, because agents need the most safeguards. Change it if you can.',
  '5:not-sure': 'confidential firm information — the stricter case',
  '6:not-sure':
    'it acts entirely by itself with no person involved at any point — the strictest case. This changes the result a lot; change it if you can.',
  '6a:not-sure': 'usually what a decision is based on — the stricter case',
  '7:not-sure': 'the public or the market — the widest audience. Change it if the real audience is narrower.',
  '9:not-sure': 'it can’t be undone — the strictest case. Change it if a mistake can actually be caught and fixed.',
  '11:elsewhere-not-sure':
    'only the countries you listed apply — you also ticked “somewhere else, or not sure”, and no other country’s rules were checked.',
  '12:not-sure': 'it replaces something you already use — the stricter case. Change it if nothing is being replaced.',
  '13:not-sure':
    'it can reach other systems with its own logins, can deploy changes, and runs on shared infrastructure — the strictest case',
  '14:not-sure':
    'whether copies of it can pass work to each other isn’t known — treated as if they can, since that’s the stricter case',
};

export function assumptionText(id: QuestionId, optionKey: string): string | undefined {
  return ASSUMPTION_TEXT[`${id}:${optionKey}`];
}

export function makeAssumption(id: QuestionId, optionKey: string, fields: string[]): Assumption | undefined {
  const text = assumptionText(id, optionKey);
  const question = findQuestion(id);
  if (!text || !question) return undefined;
  return {
    questionId: id,
    question: question.text,
    shortLabel: ASSUMPTION_SHORT_LABEL[id] ?? question.text,
    assumption: text,
    fields,
  };
}

// R16-F §5 (DR7-06). The component-layer counterpart to the engine's
// AssumptionRef: `plain-intake.ts` returns references ({ questionId,
// optionKey }, plus the platform-zone case below) instead of worded
// assumptions, and this is the one place a reference becomes the worded
// `Assumption` a submitter reads. Every caller of `plainAnswersToFormValues`
// converts once, immediately — never carrying a raw ref past that point.
export function describeAssumptions(refs: AssumptionRef[]): Assumption[] {
  const out: Assumption[] = [];
  for (const ref of refs) {
    if ('earliestZone' in ref) {
      // W-9 (R16-W §1, D-79): the wording depends on which zone is
      // earliest for the platform the submitter picked, computed at the
      // mapping call site — never a fixed per-option string this module's
      // own code-free ASSUMPTION_TEXT table could hold. Mirrors
      // plain-intake.ts's own pre-R16-F inline branch exactly.
      const question = findQuestion(ref.questionId);
      if (!question) continue;
      out.push({
        questionId: ref.questionId,
        question: question.text,
        shortLabel: ASSUMPTION_SHORT_LABEL[ref.questionId] ?? question.text,
        assumption:
          ref.earliestZone === 'Zone A'
            ? 'an outside website or service — the strictest case.'
            : 'it may pass your information to an outside supplier — the stricter case.',
        fields: ref.fields,
      });
      continue;
    }
    const a = makeAssumption(ref.questionId, ref.optionKey, ref.fields);
    if (a) out.push(a);
  }
  return out;
}

// §3 — "Here's what we understood" section labels (chunk C). Plain,
// code-free headings for UnderstoodSummary; the values beside each are
// derived from the graph by graph-summary.ts / UnderstoodSummary.tsx, never
// computed here.
export const SUMMARY_LABELS = {
  destination: 'Where your information will go',
  dataClasses: 'The information it will use',
  behaviour: 'What it does and who sees it',
  // R16-W §2 (D-71): new section — output_reversibility was computed and
  // never shown on the submitter's own summary.
  reversibility: 'If it gets something wrong',
  decisions: 'What it helps decide',
  scaleAndCountries: 'How widely it’s used, and where',
  agentReach: 'What it can reach by itself',
  agentCoordination: 'Whether copies of it work together',
  assumptionsFormPath: 'Things we assumed because you weren’t sure',
  assumptionsDescriptionPath: 'Things we couldn’t tell from your description',
  detailsDisclosure: 'Show the details the rules use',
  changeAnswer: 'Change an answer',
} as const;

// ---------------------------------------------------------------------------
// R16-W §2 — "Here's what we understood", in the form's own words (D-71).
// Before this, the summary read the graph through the REVIEWER cards'
// labels (field-copy.ts) — a different vocabulary, written for a 2LoD
// reader, not the newcomer this screen is actually for ("Personal details
// of clients" for "Information about people…", "via unregistered…" for the
// supplier, no line at all for the kind of AI or whether a mistake can be
// put right). SUMMARY_* below is graph value -> sentence, written from the
// newcomer-tested QUESTION wording (§2.2) instead — still graph-based (one
// truth: what gets evaluated), just a different, submitter-facing WORDING
// of the same facts. The collapsed "Show the details the rules use" grid
// keeps field-copy.ts's labels unchanged — that is the reviewer's own
// vocabulary, on purpose (§3: "reviewer vocabulary stays there").

export const SUMMARY_DESTINATION: Record<DataZone, string> = {
  'Zone A': 'An outside website or service, outside your firm’s control.',
  'Zone B': 'A supplier’s systems, outside your firm’s own.',
  'Zone C': 'Your firm’s own systems.',
};

// F-9 (DR7-09). W-9's "Does your information stay on your firm's own
// systems the whole time?" (question 3platformZone) is self-attested, like
// every other form answer — when it is what actually set the destination
// zone (an explicit answer, never the "Not sure" default), the summary says
// so, the same honesty posture as every other self-reported fact on this
// screen. Keyed by the question's own option keys, not the resulting zone,
// because the TEXT differs by which answer was given even when two answers
// could resolve to the same zone on a different platform.
const DESTINATION_ATTRIBUTION_3PLATFORMZONE: Partial<Record<string, string>> = {
  'firm-systems': 'you told us your information stays on them',
  'outside-supplier': 'you told us it goes to an outside supplier',
  'outside-service': 'you told us it goes out to a public website or service',
};

/** §2 "Where your information will go" (F-9, DR7-09): the plain destination
 *  sentence, with a parenthetical attribution when the zone came from an
 *  explicit answer to the 3platformZone follow-up rather than a default or
 *  a "Not sure" assumption. Form path only — `plainAnswers` is undefined on
 *  the description path, which never asks this question, so the
 *  attribution never fires there. */
export function summaryDestinationLine(zone: DataZone, plainAnswers?: PlainAnswers): string {
  const base = SUMMARY_DESTINATION[zone];
  const answer = plainAnswers?.['3platformZone'];
  const attribution = typeof answer === 'string' ? DESTINATION_ATTRIBUTION_3PLATFORMZONE[answer] : undefined;
  return attribution ? `${base.replace(/\.$/, '')} (${attribution}).` : base;
}

export const SUMMARY_DATA_CLASS: Record<DataClass, string> = {
  'Client PII': 'Information about people — clients, applicants, staff or anyone else who can be identified',
  MNPI: 'Price-sensitive information — anything that could move a share price',
  Confidential: 'Confidential firm information',
  Internal: 'Everyday work information, or only what you type in yourself',
  Public: 'Only public information',
};

export const SUMMARY_MODEL_TYPE: Record<ModelType, string> = {
  statistical: 'A score or forecast from fixed, written-down rules, like a scorecard',
  'traditional-ml': 'A score, ranking or forecast whose builders can show what drove each result',
  ml: 'A score, ranking or forecast whose builders can’t easily show why it gave a result',
  'deep-learning': 'AI that recognises things in images, sound or documents',
  llm: 'AI that reads, summarises, translates, writes or answers questions in words',
  'generative-ai': 'AI that creates images, audio, video or code',
  agentic: 'An AI agent that works through tasks on its own, using other tools or systems',
};

// §2 item 2 ("what happens with its output") — autonomy_level + action_type
// (+ hitl), the same split §2.2's Q6/Q6a/Q6b already draws between acting
// alone (autonomy >= 2) and supervised (autonomy <= 1). Each clause map
// carries its own leading punctuation and spacing so the join in
// summaryBehaviourLine is a plain concatenation, never a second place that
// could get the separator wrong.
const SUMMARY_AUTONOMOUS_BASE: Record<2 | 3 | 4, string> = {
  2: 'It decides or acts by itself, and a person reviews afterwards',
  3: 'It acts by itself within limits someone set, with no routine review',
  4: 'It acts entirely by itself, with no person involved at any point',
};
const SUMMARY_AUTONOMOUS_ACTION_CLAUSE: Partial<Record<ActionType, string>> = {
  // CR6-16: an AI acting by itself with these four used to read as the bare
  // base line, silently omitting what it actually does.
  read: ' — it finds or summarises things for people to read',
  inform: ' — it answers people’s questions directly',
  draft: ' — it creates drafts',
  recommend: ' — it suggests, ranks or flags things',
  trade: ' — it places or changes trades',
  approve: ' — it makes yes-or-no decisions, like accepting an application',
  execute: ' — it sends, books, updates records or deploys changes',
};
const SUMMARY_SUPERVISED_BASE: Partial<Record<ActionType, string>> = {
  read: 'It finds or summarises things for people to read — nobody acts on it directly',
  inform: 'It answers people’s questions directly, like a chat assistant',
  draft: 'It creates a draft',
  recommend: 'It suggests, ranks or flags things',
  execute: 'It prepares an action',
  trade: 'It prepares an action',
  approve: 'It prepares an action',
};
const SUMMARY_SUPERVISED_HITL_CLAUSE: Partial<Record<ActionType, string>> = {
  draft: ', and a person checks it before it’s used',
  recommend: ', and a person decides what to do',
  execute: ', and a person approves each one before it goes ahead',
  trade: ', and a person approves each one before it goes ahead',
  approve: ', and a person approves each one before it goes ahead',
};

/** §2 item 2: what happens with the output, in the newcomer-tested wording —
 *  the same autonomy_level/action_type/hitl combination the engine's
 *  invariants match on, never a second decision about what it means. */
export function summaryBehaviourLine(
  autonomyLevel: 0 | 1 | 2 | 3 | 4,
  actionType: ActionType,
  hitl: boolean | undefined,
): string {
  if (autonomyLevel >= 2) {
    const base = SUMMARY_AUTONOMOUS_BASE[autonomyLevel as 2 | 3 | 4];
    return base + (SUMMARY_AUTONOMOUS_ACTION_CLAUSE[actionType] ?? '');
  }
  const base = SUMMARY_SUPERVISED_BASE[actionType] ?? '';
  return base + (hitl === true ? SUMMARY_SUPERVISED_HITL_CLAUSE[actionType] ?? '' : '');
}

export const SUMMARY_BINDINGNESS: Record<DecisionBindingness, string> = {
  'non-binding': 'What it produces carries little weight — nobody makes an important decision from it',
  advisory: 'What it produces is one input among several when someone decides',
  material: 'What it produces is usually what a decision is based on',
  binding: 'What it produces is acted on without a person deciding',
};

/** §2 item 3: the weight line shows only for inform/draft/recommend at
 *  autonomy_level <= 1 — acting-alone output has no "weight" question left
 *  to ask; §2.2 never asks Q6a there either. */
export function summaryShowsWeight(actionType: ActionType, autonomyLevel: 0 | 1 | 2 | 3 | 4): boolean {
  return autonomyLevel <= 1 && (actionType === 'inform' || actionType === 'draft' || actionType === 'recommend');
}

export const SUMMARY_EXPOSURE: Record<Exposure, string> = {
  'internal-only': 'Only you or your own team see what it produces',
  'internal-shared': 'Other teams in the firm see what it produces',
  'client-facing': 'Clients or customers see what it produces',
  'market-facing': 'The public, the market or regulators see what it produces',
};

export const SUMMARY_REVERSIBILITY: Record<OutputReversibility, string> = {
  reversible: 'The mistake can be caught and put right before it does lasting harm',
  irreversible: 'The mistake can’t be taken back once it happens',
  unknown: 'Not known whether a mistake can be put right',
};

export const SUMMARY_DECISION_TYPE: Record<DecisionType, string> = {
  'credit-decision': 'Whether to lend to someone, or on what terms',
  'lending-decision': 'Whether to lend to someone, or on what terms',
  hiring: 'Who to hire or promote',
  pricing: 'What to charge a client, or how something is priced or valued',
  trading: 'Buying or selling investments',
  'fraud-detection': 'Spotting fraud or financial crime',
  'regulatory-reporting': 'Figures or statements sent to a regulator',
  operational: 'Nothing specific — it’s for day-to-day work',
};

/** §2 "What it helps decide": decision_type, then the free-typed
 *  decision_type_other, then the "none" fallback — same precedence
 *  UnderstoodSummary already applied, now with the "ask your AI risk team"
 *  clause and the new fallback wording. */
export function summaryDecisionLine(
  decisionType: DecisionType | undefined,
  decisionTypeOther: string | undefined,
): string {
  if (decisionType) return SUMMARY_DECISION_TYPE[decisionType];
  if (decisionTypeOther) {
    return `${decisionTypeOther} — not one of the kinds we have rules for, so your AI risk team will look at it`;
  }
  return 'Nothing in particular';
}

export const SUMMARY_SCALE: Record<'limited' | 'at_scale', string> = {
  limited: 'Just you, or a small trial',
  at_scale: 'Your team as part of normal work, or wider',
};

export const SUMMARY_NO_COUNTRIES = 'None of the listed countries — somewhere else, or not sure';

export const SUMMARY_ACCESS_SCOPE: Record<SystemAccessScope, string> = {
  none: 'Nothing beyond what it’s given for the task',
  credentialed_systems: 'Its own logins, passwords or access tokens for other systems',
  deployment_authority: 'It can change software or settings, or deploy updates, without a person',
  shared_infrastructure: 'It runs on computers or servers shared with other automated tools',
};

export const SUMMARY_MULTI_INSTANCE: Record<MultiInstanceCoordination, string> = {
  no: 'It works alone',
  yes: 'Copies of it, or other AI agents, pass work or messages to each other',
  unknown: 'Not known whether copies of it, or other AI agents, pass work to each other',
};

// Never-render rule (D-23): a platform or supplier without a plain_name gets
// this neutral label instead of the bare [FIRM] placeholder or a raw
// registry id.
export function neutralPlatformLabel(n: number): string {
  return `Your firm's AI service ${n}`;
}

export function neutralSupplierLabel(n: number): string {
  return `Supplier ${n}`;
}

/** UNSIGNED-MODEL (owner-approved 2026-10-03): the one label for a model the
 *  policy lists — button, "Recorded:" line and review row all read it. A
 *  listed model the firm has not accepted (is_approved false) says so. */
export const UNACCEPTED_MODEL_SUFFIX = ' — not yet accepted by your firm, so it gets an extra check';
export function neutralModelLabel(n: number): string {
  return `Model ${n}`;
}

/** The label of every listed (non-family) model, in the list's own order.
 *  A model with no plain_name gets a numbered neutral label — never the raw
 *  id (CR7-35b) — numbered only among the unnamed, as suppliers are. */
export function approvedModelOptionList(
  models: ReadonlyArray<{ model_id: string; plain_name?: string; is_approved: boolean; is_family?: boolean }> | undefined,
): Array<{ value: string; label: string }> {
  return modelOptionsWithBase(models).map(({ value, label }) => ({ value, label }));
}

function modelOptionsWithBase(
  models: ReadonlyArray<{ model_id: string; plain_name?: string; is_approved: boolean; is_family?: boolean }> | undefined,
): Array<{ value: string; label: string; base: string }> {
  let neutralIndex = 0;
  return (models ?? [])
    .filter((m) => !m.is_family)
    .map((m) => {
      // A blank plain_name counts as none (TC-CR7-35d) — never a blank button.
      const base = m.plain_name?.trim() ? m.plain_name : neutralModelLabel(++neutralIndex);
      return { value: m.model_id, label: m.is_approved === false ? base + UNACCEPTED_MODEL_SUFFIX : base, base };
    });
}

/** CR8-11. The BARE plain name of a listed (non-family) model — the label without the
 *  UNACCEPTED_MODEL_SUFFIX the button adds on top, for use inside a sentence that says the status itself. */
export function approvedModelBaseLabelFor(
  models: Parameters<typeof approvedModelOptionList>[0],
  modelId: string,
): string | undefined {
  return modelOptionsWithBase(models).find((o) => o.value === modelId)?.base;
}

/** The label for a declared model id, or undefined when the policy does not
 *  list it (the caller then shows what the person typed, as written). */
export function approvedModelLabelFor(
  models: Parameters<typeof approvedModelOptionList>[0],
  modelId: string,
): string | undefined {
  return approvedModelOptionList(models).find((o) => o.value === modelId)?.label;
}

// GT7 L-1 (P12). A description that tells the tool how to rate the case is
// flagged, never obeyed. Wording lives here (presentation), the detection in
// engine/rating-instructions.ts. No quoted phrase ever reaches the record line.
export function ratingInstructionWarning(phrases: readonly string[]): string {
  const quoted = phrases
    .slice(0, 2)
    // GB pass-1 D: the review screen is asserted with a single-match
    // /approved|rejected/i query, so those words never appear in a quote.
    .map((p) => `\u201C${p.replace(/\b(approved|rejected)\b/gi, '[\u2026]')}\u201D`)
    .join(' and ');
  return `Your description tells us how to rate it (${quoted}). We don\u2019t follow that, but it may have affected what we read \u2014 check each card below before confirming.`;
}

export const RATING_INSTRUCTION_CONFIRM_LINE =
  'Your description tried to set its own rating. We don\u2019t follow that, but it may have affected what we read \u2014 check each card above before confirming.';

export const RATING_INSTRUCTION_AUDIT_LINE = 'The description tried to set its own rating \u2014 check the cards.';
