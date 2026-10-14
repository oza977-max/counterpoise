import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../store/policy';
import { PLAIN_QUESTIONS, QUESTION_WORDS } from '../components/plain-copy';
import {
  QUESTION_STRUCTURE,
  REQUIRED_ORDER,
  allOptionKeys,
  buildCatalogue,
  deriveQuestionFields,
  isShown,
  optionsReproducing,
  structureFor,
} from './question-structure';
import { q3ShowsModelQuestion } from './plain-intake';
import type { PolicyFile } from './types';

// R18-C1 (specs/intake-flow.md §27.1, §27.4 step 1, §27.11): the question STRUCTURE lives in the
// engine, the WORDS in plain-copy.ts; they must cover exactly the same ids and option keys.

let realPolicy: PolicyFile;
beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  realPolicy = r.policy;
});

const entry = (id: string, plain_name?: string, extra: Record<string, unknown> = {}) =>
  ({ id, name: `[FIRM] ${id}`, approved_envelope: {}, satisfies_controls: [], ...(plain_name ? { plain_name } : {}), ...extra });

function policyWith(parts: Record<string, unknown>): PolicyFile {
  return { ...(realPolicy as object), ...parts } as unknown as PolicyFile;
}

describe('structure and words cover exactly the same ids and option keys (R18-C1)', () => {
  it('the same question ids, in the same order', () => {
    expect(QUESTION_STRUCTURE.map((q) => q.id)).toEqual(PLAIN_QUESTIONS.map((q) => q.id));
  });

  it.each(PLAIN_QUESTIONS.map((q) => q.id))('question %s: same kind and the same option keys in the same order', (id) => {
    const words = PLAIN_QUESTIONS.find((q) => q.id === id)!;
    const structure = structureFor(id)!;
    const wordKind = words.freeText ? 'free' : words.multi ? 'multi' : 'single';
    expect(structure.kind).toBe(wordKind);
    expect([...structure.options]).toEqual(words.options.map((o) => o.key));
  });

  it('the structure holds no words: every option key is a short machine key', () => {
    for (const q of QUESTION_STRUCTURE) {
      for (const key of q.options) expect(key).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('REQUIRED_ORDER is the order the form has always listed missing questions in (review pass 1, M7)', () => {
    expect([...REQUIRED_ORDER]).toEqual([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
      '3supplier', '3platformZone', '3a', '3aWhich', '4a', '6a', '6b', '8other', '13', '14',
    ]);
  });
  it('REQUIRED_ORDER names exactly the questions marked required, once each', () => {
    const marked = QUESTION_STRUCTURE.filter((q) => q.required).map((q) => q.id).sort();
    expect([...REQUIRED_ORDER].sort()).toEqual(marked);
    expect(new Set(REQUIRED_ORDER).size).toBe(REQUIRED_ORDER.length);
  });

  it('Question 3\'s model-name rule in the structure agrees with the engine\'s q3ShowsModelQuestion for every Q3 key', () => {
    for (const key of structureFor('3')!.options) {
      expect(isShown('3model', { '3': key }, realPolicy)).toBe(q3ShowsModelQuestion({ '3': key }));
    }
  });
});

describe('visibility data (the show... flags of the form, as data)', () => {
  it.each([
    ['3supplier', { '3': 'supplier-feature' }, true],
    ['3supplier', { '3': 'specialist-product' }, true],
    ['3supplier', { '3': 'firm-built' }, false],
    ['3a', { '3': 'outside-assistant' }, true],
    ['3a', { '3': 'not-sure' }, false],
    ['3supplierName', { '3supplier': 'not-on-list' }, true],
    ['3supplierName', { '3supplier': 'dont-know' }, false],
    ['4a', { '4': 'score' }, true],
    ['4a', { '4': 'language' }, false],
    ['6a', { '6': 'drafts' }, true],
    ['6a', { '6': 'acts-alone' }, false],
    ['6b', { '6': 'acts-alone' }, true],
    ['6b', { '6': 'read' }, false],
    ['8other', { '8': 'other' }, true],
    ['8other', { '8': 'credit' }, false],
    ['13', { '4': 'agentic' }, true],
    ['13', { '4': 'not-sure' }, true],
    ['13', { '4': 'score' }, false],
    ['14', { '4': 'agentic' }, true],
    ['14', {}, false],
  ] as const)('%s is shown for %j: %s', (id, answers, expected) => {
    expect(isShown(id, answers, realPolicy)).toBe(expected);
  });

  it('3platformZone is shown only for a platform that allows more than one zone', () => {
    const policy = policyWith({
      platforms: [
        entry('PLAT-MANY', 'Many', { approved_envelope: { data_zones: ['Zone B', 'Zone C'] } }),
        entry('PLAT-ONE', 'One', { approved_envelope: { data_zones: ['Zone B'] } }),
      ],
    });
    expect(isShown('3platformZone', { '3': 'PLAT-MANY' }, policy)).toBe(true);
    expect(isShown('3platformZone', { '3': 'PLAT-ONE' }, policy)).toBe(false);
    expect(isShown('3platformZone', { '3': 'firm-built' }, policy)).toBe(false);
  });

  it('3aWhich is shown only for a firm account with several company assistants', () => {
    const two = policyWith({ vendors: [entry('A', 'A', { kind: 'company_assistant' }), entry('B', 'B', { kind: 'company_assistant' })] });
    const one = policyWith({ vendors: [entry('A', 'A', { kind: 'company_assistant' })] });
    expect(isShown('3aWhich', { '3a': 'firm-account' }, two)).toBe(true);
    expect(isShown('3aWhich', { '3a': 'firm-account' }, one)).toBe(false);
    expect(isShown('3aWhich', { '3a': 'personal-account' }, two)).toBe(false);
  });
});

describe('buildCatalogue (§27.4 step 1)', () => {
  const policy = () =>
    policyWith({
      platforms: [entry('PLAT-A', 'The firm ML platform'), entry('PLAT-B')],
      vendors: [entry('SUP-1', 'Supplier One'), entry('SUP-2'), entry('ASSIST-1', 'Assistant One', { kind: 'company_assistant' })],
      jurisdictions: [{ code: 'UK', name: 'United Kingdom', pack_files: [] }, { code: 'XX', name: 'Elsewhere Land', pack_files: [] }],
    });

  it('holds exactly the select questions and never a free-text one', () => {
    const catalogue = buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy());
    expect([...catalogue.keys()]).toEqual([
      '3', '3supplier', '3a', '3aWhich', '3platformZone', '4', '4a', '5', '6', '6a', '6b', '7', '8', '9', '10', '11', '12', '13', '14',
    ]);
    for (const free of ['1', '2', '3supplierName', '3model', '8other'] as const) expect(catalogue.has(free)).toBe(false);
  });

  it('is a Map of Maps with the right kinds, so a model-supplied key cannot reach a prototype property', () => {
    const catalogue = buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy());
    expect(catalogue).toBeInstanceOf(Map);
    expect(catalogue.get('5')!.kind).toBe('multi');
    expect(catalogue.get('4')!.kind).toBe('single');
    expect(catalogue.get('5')!.options).toBeInstanceOf(Map);
    for (const key of ['toString', 'valueOf', 'hasOwnProperty', '__proto__', 'constructor']) {
      expect(catalogue.has(key as never)).toBe(false);
      expect(catalogue.get('5')!.options.has(key)).toBe(false);
    }
  });

  it('puts the policy-driven options where the form puts them, with their own words or a numbered neutral label', () => {
    const catalogue = buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy());
    const q3 = [...catalogue.get('3')!.options.values()];
    expect(q3.map((o) => o.key)).toEqual(['outside-assistant', 'supplier-feature', 'specialist-product', 'PLAT-A', 'PLAT-B', 'firm-built', 'not-sure']);
    expect(q3[3]!.text).toBe('The firm ML platform');
    expect(q3[4]!.text).toBe("Your firm's AI service 2");
    const suppliers = [...catalogue.get('3supplier')!.options.values()];
    expect(suppliers.map((o) => o.key)).toEqual(['SUP-1', 'SUP-2', 'not-on-list', 'dont-know']);
    expect(suppliers[1]!.text).toBe('Supplier 2');
    expect([...catalogue.get('3aWhich')!.options.keys()]).toEqual(['ASSIST-1', 'not-sure']);
    const countries = [...catalogue.get('11')!.options.values()];
    expect(countries.map((o) => o.key)).toEqual(['UK', 'XX', 'elsewhere-not-sure']);
    expect(countries[0]!.text).toBe('United Kingdom');
  });

  it('carries the static words from plain-copy and never the raw registry name', () => {
    const catalogue = buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy());
    const all = [...catalogue.values()].flatMap((q) => [...q.options.values()]);
    expect(all.every((o) => o.text.length > 0 && o.text !== o.key)).toBe(true);
    expect(all.some((o) => o.text.includes('[FIRM]'))).toBe(false);
  });

  it('allOptionKeys has no repeated key', () => {
    for (const q of QUESTION_STRUCTURE) {
      const keys = allOptionKeys(q, policy());
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('deriveQuestionFields and optionsReproducing (§27.11)', () => {
  it('pins the derived question -> graph-field table (a snapshot: a change to the mapping must be deliberate)', () => {
    const table = Object.fromEntries(
      [...deriveQuestionFields(QUESTION_STRUCTURE, realPolicy).entries()].map(([id, e]) => [id, e.scored ? e.fields : `not scored: ${e.why}`]),
    );
    expect(table).toEqual({
      '3': ['data_zone', 'platform', 'vendor'],
      '3supplier': ['vendor'],
      '3a': ['data_zone', 'vendor'],
      '3aWhich': 'not scored: the policy cannot show this question',
      '3platformZone': ['data_zone'],
      '4': ['model_type'],
      '4a': ['model_type'],
      '5': ['data_class'],
      '6': ['action_type', 'autonomy_level', 'decision_bindingness', 'hitl'],
      '6a': ['decision_bindingness'],
      '6b': ['action_type'],
      '7': ['exposure'],
      '8': ['decision_type', 'decision_type_other'],
      '9': ['output_reversibility'],
      '10': ['scale'],
      '11': ['jurisdictions'],
      '12': ['replaces_prior_model'],
      '13': ['system_access_scope'],
      '14': ['multi_instance_coordination'],
    });
  });

  it('is deterministic: two derivations are identical', () => {
    const a = JSON.stringify([...deriveQuestionFields(QUESTION_STRUCTURE, realPolicy)]);
    const b = JSON.stringify([...deriveQuestionFields(QUESTION_STRUCTURE, realPolicy)]);
    expect(a).toBe(b);
  });

  it('"how widely": a limited gold has exactly one reproducing option; an at_scale gold has two (so the question is not scored)', () => {
    expect(optionsReproducing('10', { scale: 'limited' }, QUESTION_STRUCTURE, realPolicy)).toEqual(['small']);
    expect(optionsReproducing('10', { scale: 'at_scale' }, QUESTION_STRUCTURE, realPolicy)).toEqual(['team', 'wide']);
  });

  it('a tick-all question is matched per option: one class ticked alone', () => {
    expect(optionsReproducing('5', { data_class: ['Public'] }, QUESTION_STRUCTURE, realPolicy)).toEqual(['public']);
  });

  it('no Q3 option reproduces an in-house vendor in Zone B (the form cannot express it), so the question is not scored', () => {
    expect(optionsReproducing('3', { vendor: 'internal', data_zone: 'Zone B' }, QUESTION_STRUCTURE, realPolicy)).toEqual([]);
  });

  it('a gold value the form cannot produce returns no option, and a free-text or unscored question returns none', () => {
    expect(optionsReproducing('10', { scale: 'enormous' }, QUESTION_STRUCTURE, realPolicy)).toEqual([]);
    expect(optionsReproducing('1', {}, QUESTION_STRUCTURE, realPolicy)).toEqual([]);
    expect(optionsReproducing('3aWhich', {}, QUESTION_STRUCTURE, realPolicy)).toEqual([]);
  });
});
