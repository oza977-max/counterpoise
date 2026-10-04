import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  describeAssumptions,
  summaryDestinationLine,
  SUMMARY_DESTINATION,
  QUESTIONNAIRE_COPY,
  questionnaireCopyForField,
  vendorNotOnListValue,
  extractionErrorMessage,
  EXTRACTION_ERROR_HELP,
  engineErrorMessage,
  plausibilityMessageForForm,
  plausibilityMessageForDescription,
  GRAPH_REVIEW_CARD_TITLES,
} from './plain-copy';
import type { AssumptionRef } from '../engine/plain-questions';
// CR6-25: the real sources TC-R16-E-11 derives its field list from, instead
// of hand-typing it (BC-003) — the same pattern
// src/store/plain-language-coverage.test.ts already uses for the policy
// side of this question.
import { QUOTE_FIELDS, AGENT_REACH_FIELDS } from '../llm/graph-extractor';
import { loadPolicy } from '../store/policy';
import { loadPacks } from '../store/packs';
import { getPackSources } from '../store/pack-source';
import type { JurisdictionPack, PolicyFile } from '../engine/types';

// R16-F §5 (DR7-06). plain-intake.ts (the engine) now returns assumption
// REFERENCES ({ questionId, optionKey }, plus the platform-zone case)
// instead of worded assumptions — describeAssumptions() is the one place,
// component-side, a reference becomes the worded Assumption every reader
// (UnderstoodSummary, the register) still needs. These tests cover the
// WORDING that plain-intake.test.ts's own mapping tests used to assert
// directly before this split (now reference-only there).

describe('describeAssumptions', () => {
  it('TC-R16-F-03: an empty list of references produces an empty list of assumptions', () => {
    expect(describeAssumptions([])).toEqual([]);
  });

  it('TC-R16-F-04 / TC-R16-B-01: a generic reference resolves to the exact worded assumption and question text (moved from plain-intake.test.ts)', () => {
    const refs: AssumptionRef[] = [
      { questionId: '4', optionKey: 'not-sure', fields: ['model_type'] },
      { questionId: '6', optionKey: 'not-sure', fields: ['action_type', 'autonomy_level', 'decision_bindingness', 'hitl'] },
      { questionId: '7', optionKey: 'not-sure', fields: ['exposure'] },
      { questionId: '9', optionKey: 'not-sure', fields: ['output_reversibility'] },
    ];
    const out = describeAssumptions(refs);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual({
      questionId: '4',
      question: 'What kind of AI is it? If more than one fits — for example, something that turns speech into text and writes a summary of it — pick the one nearest the bottom of this list.',
      shortLabel: 'what kind of AI it is',
      assumption:
        'an AI agent that can work on its own — the strictest case, because agents need the most safeguards. Change it if you can.',
      fields: ['model_type'],
    });
    expect(out[1]!.assumption).toBe(
      'it acts entirely by itself with no person involved at any point — the strictest case. This changes the result a lot; change it if you can.',
    );
    expect(out[2]!.assumption).toMatch(/widest audience/);
    expect(out[3]!.question).toMatch(/can the mistake be caught/i);
    expect(out[3]!.assumption).toMatch(/can’t be undone — the strictest case/);
  });

  it('TC-R16-F-05: a reference with no ASSUMPTION_TEXT entry is dropped silently, same as makeAssumption()', () => {
    // '4':'score' is a real question/option, but not a "Not sure" one —
    // no assumption text exists for it.
    const out = describeAssumptions([{ questionId: '4', optionKey: 'score', fields: ['model_type'] }]);
    expect(out).toEqual([]);
  });

  it('TC-R16-F-06: the 3platformZone case with earliestZone Zone B resolves to the "outside supplier" sentence', () => {
    const out = describeAssumptions([
      { questionId: '3platformZone', optionKey: 'not-sure', earliestZone: 'Zone B', fields: ['data_zone'] },
    ]);
    expect(out).toEqual([
      {
        questionId: '3platformZone',
        question: 'Does your information stay on your firm’s own systems the whole time?',
        shortLabel: 'whether your information stays on your firm’s systems',
        assumption: 'it may pass your information to an outside supplier — the stricter case.',
        fields: ['data_zone'],
      },
    ]);
  });

  it('TC-R16-F-07: the 3platformZone case with earliestZone Zone A resolves to the "outside website or service" sentence', () => {
    const out = describeAssumptions([
      { questionId: '3platformZone', optionKey: 'not-sure', earliestZone: 'Zone A', fields: ['data_zone'] },
    ]);
    expect(out[0]!.assumption).toBe('an outside website or service — the strictest case.');
  });

  it('a mix of generic and platform-zone references resolves each correctly, in order', () => {
    const out = describeAssumptions([
      { questionId: '9', optionKey: 'not-sure', fields: ['output_reversibility'] },
      { questionId: '3platformZone', optionKey: 'not-sure', earliestZone: 'Zone B', fields: ['data_zone'] },
    ]);
    expect(out.map((a) => a.questionId)).toEqual(['9', '3platformZone']);
  });
});

describe('summaryDestinationLine (F-9, DR7-09)', () => {
  it('TC-R16-F-08: with no plainAnswers, renders the base destination sentence unchanged', () => {
    expect(summaryDestinationLine('Zone C')).toBe(SUMMARY_DESTINATION['Zone C']);
  });

  it('TC-R16-F-09: an explicit 3platformZone "firm-systems" answer attributes the Zone C line', () => {
    const line = summaryDestinationLine('Zone C', { '3platformZone': 'firm-systems' });
    // Exact contract wording: "Your firm's own systems (you told us your
    // information stays on them)." — no period before the parenthesis.
    expect(line).toBe('Your firm’s own systems (you told us your information stays on them).');
  });

  it('TC-R16-F-10: an explicit 3platformZone "outside-supplier" answer attributes the Zone B line', () => {
    const line = summaryDestinationLine('Zone B', { '3platformZone': 'outside-supplier' });
    expect(line).toMatch(/\(you told us it goes to an outside supplier\)\.$/);
  });

  it('TC-R16-F-11: an explicit 3platformZone "outside-service" answer attributes the Zone A line', () => {
    const line = summaryDestinationLine('Zone A', { '3platformZone': 'outside-service' });
    expect(line).toMatch(/\(you told us it goes out to a public website or service\)\.$/);
  });

  it('a "Not sure" 3platformZone answer is not attributed — it is an assumption, not a stated fact', () => {
    const line = summaryDestinationLine('Zone B', { '3platformZone': 'not-sure' });
    expect(line).toBe(SUMMARY_DESTINATION['Zone B']);
  });

  it('a description-path call (plainAnswers undefined) never attributes', () => {
    expect(summaryDestinationLine('Zone A', undefined)).toBe(SUMMARY_DESTINATION['Zone A']);
  });
});

// R16-E §2 (D-101, DR7-31). QUESTIONNAIRE_COPY is the one source for the
// targeted questionnaire's questions/options AND the review screen's field
// labels and value words. Every field the generator can actually emit —
// every QUOTE_FIELDS entry (graph-extractor.ts) plus every condition-key
// field the real policy uses (verified against policy/appetite.yaml) —
// must have an explicit entry; a test fails otherwise (D-20's "no bare
// code ever reaches the first screen", extended to this screen).
describe('QUESTIONNAIRE_COPY (R16-E §2, D-101/DR7-31)', () => {
  // CR6-25 (BC-003): derived from the real sources at test time instead of
  // hand-typed. questionsForGuessedFields (question-generator.ts) can only
  // ever emit a field that appears in QUOTE_FIELDS/AGENT_REACH_FIELDS
  // (graph-extractor.ts — the only place `guessed[nodeId]` entries come
  // from); candidatesFromRules can only ever emit a field that is a
  // condition key on the real shipped policy's invariants/hard lines or its
  // loaded packs' rules. A hand-typed list could silently drift from
  // either source without this test noticing — exactly the defect class
  // that hid the CR6-05 gap (replaces_prior_model) until it was traced by
  // hand.
  let policy: PolicyFile;
  let packs: JurisdictionPack[];

  beforeAll(() => {
    const yaml = readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8');
    const result = loadPolicy(yaml);
    if (!result.valid) throw new Error('shipped policy invalid: ' + JSON.stringify(result.errors));
    policy = result.policy;
    const packResult = loadPacks(getPackSources());
    if (packResult.errors.length > 0) throw new Error('shipped packs invalid: ' + JSON.stringify(packResult.errors));
    packs = packResult.packs;
  });

  function everyFieldTheGeneratorCanEmit(): string[] {
    const fromQuoteFields = [
      ...QUOTE_FIELDS.input,
      ...QUOTE_FIELDS.processing,
      ...QUOTE_FIELDS.output,
      ...AGENT_REACH_FIELDS,
    ];
    const fromPolicyConditions = [...policy.invariants, ...policy.hard_lines].flatMap((r) => Object.keys(r.condition));
    const fromPackConditions = packs.flatMap((p) => p.rules).flatMap((r) => Object.keys(r.condition));
    return [...new Set([...fromQuoteFields, ...fromPolicyConditions, ...fromPackConditions])];
  }

  it('TC-R16-E-11: every field the generator can emit has an entry with a non-empty question and shortLabel', () => {
    for (const field of everyFieldTheGeneratorCanEmit()) {
      const copy = QUESTIONNAIRE_COPY[field];
      expect(copy, `missing QUESTIONNAIRE_COPY entry for "${field}"`).toBeDefined();
      expect(copy!.question.length).toBeGreaterThan(0);
      expect(copy!.shortLabel.length).toBeGreaterThan(0);
    }
  });

  it('TC-R16-E-12: data_class renders its exact question and five option labels, "Not sure" → Confidential', () => {
    const copy = QUESTIONNAIRE_COPY.data_class!;
    expect(copy.question).toBe('What’s the most sensitive information it will see or use?');
    expect(Object.keys(copy.options).sort()).toEqual(
      ['Client PII', 'Confidential', 'Internal', 'MNPI', 'Public'].sort(),
    );
    expect(copy.notSure?.value).toBe('Confidential');
  });

  it('TC-R16-E-13: decision_type offers exactly one lending option (credit-decision) and a "Something else" pseudo-option, never lending-decision, and no "Not sure"', () => {
    const copy = QUESTIONNAIRE_COPY.decision_type!;
    expect(copy.options['credit-decision']).toMatch(/whether to lend/i);
    expect(copy.options['lending-decision']).toBeUndefined();
    expect(copy.options.other).toMatch(/something else/i);
    expect(copy.notSure).toBeUndefined();
  });

  it('TC-R16-E-14: output_reversibility offers Q9\'s two real options only (never "unknown"), "Not sure" → irreversible', () => {
    const copy = QUESTIONNAIRE_COPY.output_reversibility!;
    expect(Object.keys(copy.options).sort()).toEqual(['irreversible', 'reversible']);
    expect(copy.notSure?.value).toBe('irreversible');
  });

  it('TC-R16-E-15: system_access_scope\'s "Not sure" is all three non-none values, canonically ordered', () => {
    expect(QUESTIONNAIRE_COPY.system_access_scope!.notSure?.value).toEqual([
      'shared_infrastructure',
      'credentialed_systems',
      'deployment_authority',
    ]);
  });

  it('TC-R16-E-16: scale and decision_type offer no "Not sure" — the form has none either', () => {
    expect(QUESTIONNAIRE_COPY.scale!.notSure).toBeUndefined();
    expect(QUESTIONNAIRE_COPY.decision_type!.notSure).toBeUndefined();
  });

  it('TC-R16-E-17: vendor and declared_model_id each offer "not-on-list" and "dont-know" static choices, with their own help text', () => {
    expect(QUESTIONNAIRE_COPY.vendor!.options['not-on-list']).toBe('Not on this list');
    expect(QUESTIONNAIRE_COPY.vendor!.options['dont-know']).toMatch(/don.t know/i);
    expect(QUESTIONNAIRE_COPY.vendor!.help).toMatch(/don.t know/i);
    expect(QUESTIONNAIRE_COPY.declared_model_id!.options['not-on-list']).toBe('Not on the list');
    expect(QUESTIONNAIRE_COPY.declared_model_id!.help).toMatch(/optional/i);
  });

  it('TC-R16-E-18: questionnaireCopyForField falls back to "Please check this detail" for a field with no entry — never the bare field id alone', () => {
    const copy = questionnaireCopyForField('some_future_field');
    expect(copy.question).toBe('Please check this detail: some future field.');
    expect(copy.options).toEqual({});
  });

  it('TC-R16-E-19: questionnaireCopyForField\'s fallback prefers a caller-supplied label over the bare field id', () => {
    const copy = questionnaireCopyForField('some_future_field', 'a thing we check');
    expect(copy.question).toBe('Please check this detail: a thing we check.');
  });

  it('TC-R16-E-20: vendorNotOnListValue wraps typed text, and falls back to an unlisted-supplier sentence when left blank', () => {
    // Curly apostrophe, as on the guided form (plain-intake.ts) — the straight
    // one this assertion first pinned was the inconsistency review pass 1 found.
    expect(vendorNotOnListValue('Acme Corp')).toBe('Acme Corp (not on your firm’s list)');
    expect(vendorNotOnListValue('')).toMatch(/an unlisted supplier/i);
    expect(vendorNotOnListValue('   ')).toMatch(/an unlisted supplier/i);
  });
});

// R16-E §5 (D-104, DR7-30/AB-1). One shared function for both extraction
// error call sites (IntakeFlow.tsx) — never two independently-worded copies.
describe('extractionErrorMessage (R16-E §5, D-104)', () => {
  it('TC-R16-E-51: no-api-key reads as the description reader not being set up', () => {
    expect(extractionErrorMessage('no-api-key')).toBe('The description reader isn’t set up on this computer.');
  });

  it('TC-R16-E-52: network-error reads as not being able to reach the description reader', () => {
    expect(extractionErrorMessage('network-error')).toMatch(/couldn.t reach the description reader/i);
  });

  it('TC-R16-E-53: parse-error reads as not being able to read the description reliably', () => {
    expect(extractionErrorMessage('parse-error')).toMatch(/couldn.t read your description reliably/i);
  });

  it('TC-R16-E-54: the shared help line offers both recovery paths', () => {
    expect(EXTRACTION_ERROR_HELP).toMatch(/try again/i);
    expect(EXTRACTION_ERROR_HELP).toMatch(/answer the questions/i);
  });
});

// CR6-12 (Minor). evaluate()'s EngineError.kind reached the screen as the
// raw enum string ("Evaluation failed: no-track-match") inside a sentence
// that then told the person to "review your answers" — every one of these
// kinds is the firm's own rules or policy file, never something a
// different answer would have avoided. One function, like
// extractionErrorMessage above: a plain sentence per kind that never
// blames the person's answers. Typed as the literal union rather than
// importing EngineError from src/engine/types — same reason
// extractionErrorMessage does not import LlmError from src/llm/*.
describe('engineErrorMessage (CR6-12)', () => {
  it('TC-CR6-12: every engine error kind reads as the firm\'s rules, never the person\'s answers, and never leaks the raw kind string', () => {
    const kinds = ['policy-invalid', 'hard-line-tripped', 'no-control-set', 'jurisdiction-conflict', 'no-track-match'] as const;
    for (const kind of kinds) {
      const message = engineErrorMessage(kind);
      expect(message, `kind: ${kind}`).not.toMatch(/review your answers/i);
      expect(message, `kind: ${kind}`).not.toContain(kind);
      expect(message.toLowerCase(), `kind: ${kind}`).toContain('firm');
      expect(message, `kind: ${kind}`).toMatch(/rules?\b/i);
    }
  });

  it('a no-control-set / no-track-match gap reads as a gap in the rules, not a fault in the answers', () => {
    expect(engineErrorMessage('no-control-set')).toMatch(/gap in the rules/i);
    expect(engineErrorMessage('no-track-match')).toMatch(/gap in the rules/i);
  });
});

// R16-E §4 (v2.1, F1B-1). The two paths' own wording for the same
// plausibility reference (src/engine/plausibility.ts returns a reference
// only — a signal name — never a sentence).
describe('plausibility wording, by path (R16-E §4, v2.1)', () => {
  it('TC-R16-E-55: the form path names its own question — unchanged from R16-F', () => {
    expect(plausibilityMessageForForm('sounds-internal')).toMatch(/where does the ai come from/i);
    expect(plausibilityMessageForForm('mentions-training')).toMatch(/what happens with what it produces/i);
    expect(plausibilityMessageForForm('says-person-reviews')).toMatch(/what happens with what it produces/i);
    expect(plausibilityMessageForForm('sounds-autonomous')).toMatch(/what happens with what it produces/i);
  });

  it('TC-R16-E-56: the description path names the review screen\'s own card and row — never a form question', () => {
    const message = plausibilityMessageForDescription('sounds-internal', 'The AI', 'where your information goes');
    // Why, then where — the pointer alone (what this case first pinned) told
    // a submitter to check something without saying what looked wrong.
    expect(message).toBe(
      'Your description sounds like the AI runs on your firm’s own systems, but we read that your information goes outside the firm. Check “where your information goes” on the card “The AI”.',
    );
    expect(message).not.toMatch(/where does the ai come from/i);
  });

  it('TC-R16-E-57: the three card titles are shared between this wording and GraphView\'s own column headings', () => {
    expect(GRAPH_REVIEW_CARD_TITLES).toEqual({ input: 'What it uses', processing: 'The AI', output: 'What comes out' });
  });
});
