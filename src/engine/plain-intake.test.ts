import { describe, it, expect } from 'vitest';
import { plainAnswersToFormValues, platformZoneOptionKeys, q3ShowsModelQuestion } from './plain-intake';
import { buildGraphFromForm } from './build-graph-from-form';
import { evaluate } from './evaluate';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../store/policy';
import { loadPacks } from '../store/packs';
import { getPackSources } from '../store/pack-source';
import { describeAssumptions } from '../components/plain-copy';
// R16-F §5 (DR7-06): PlainAnswers is engine-owned (ids/keys only) —
// imported from its real source rather than round-tripping through the
// component layer's re-export.
import type { PlainAnswers } from './plain-questions';
import type { DataFlowGraph, PolicyFile } from './types';

// R16-B (§2.1, §2.2). Pure engine module — no React, no I/O, no Date.now,
// no Math.random (cross-cutting.md §7 Rule 1). buildGraphFromForm stays the
// only place ids and the timestamp are minted.

function policy(overrides: Partial<PolicyFile> = {}): PolicyFile {
  return {
    version: '1.0',
    policy_id: 'TEST',
    firm_name: 'Test',
    translation_attestation: { attested_by: 'x', role: 'x', date: 'x', raf_version_checked: 'x' },
    hard_lines: [],
    tracks: [],
    tiers: [],
    invariants: [],
    controls: [],
    kri_thresholds: {},
    jurisdictions: [
      { code: 'UK', name: 'United Kingdom', pack_files: [] },
      { code: 'EU', name: 'European Union', pack_files: [] },
    ],
    roles: {},
    tier_workflow: { Critical: 'x', High: 'x', Medium: 'x', Low: 'x' },
    safety_margin: 0.1,
    platforms: [
      {
        id: 'PLAT-CLOUD-LLM',
        name: 'Cloud LLM',
        approved_envelope: { data_zones: ['Zone B'] },
        satisfies_controls: [],
        plain_name: 'Your firm’s cloud AI assistant',
        vendor_id: 'VENDOR-APPROVED-LLM',
      },
      {
        id: 'PLAT-INTERNAL-ML',
        name: 'Internal ML',
        approved_envelope: { data_zones: ['Zone B', 'Zone C'] },
        satisfies_controls: [],
        plain_name: 'Your firm’s in-house model platform',
      },
    ],
    vendors: [
      {
        id: 'VENDOR-APPROVED-LLM',
        name: 'Approved LLM',
        approved_envelope: {},
        satisfies_controls: [],
        plain_name: 'Your firm’s company AI assistant account',
        kind: 'company_assistant',
      },
      {
        id: 'VENDOR-SUPPLIER-A',
        name: 'Supplier A',
        approved_envelope: {},
        satisfies_controls: [],
        plain_name: 'Supplier A plain name',
        kind: 'supplier',
      },
    ],
    ...overrides,
  };
}

const BASE: PlainAnswers = {
  '1': 'Test tool',
  '2': 'A test description.',
  '3': 'firm-built',
  '4': 'language',
  '5': ['everyday'],
  '6': 'read',
  '7': 'me-or-team',
  '8': 'operational',
  '9': 'yes',
  '10': 'small',
  '11': ['UK'],
  '12': 'no',
};

describe('plainAnswersToFormValues — Q3 (where the AI comes from)', () => {
  it('firm-built -> Zone C, vendor internal', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '3': 'firm-built' }, policy());
    expect(values.processingDataZone).toBe('Zone C');
    expect(values.vendor).toBe('internal');
  });

  it('not-sure -> Zone A, an unregistered vendor, and is listed as an assumption', () => {
    const { values, assumptions } = plainAnswersToFormValues({ ...BASE, '3': 'not-sure' }, policy());
    expect(values.processingDataZone).toBe('Zone A');
    expect(values.vendor).not.toBe('internal');
    expect(assumptions.some((a) => a.questionId === '3')).toBe(true);
  });

  it('a dynamic platform option resolves zone to the earliest letter among its allowed zones, and vendor to its vendor_id', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '3': 'PLAT-CLOUD-LLM' }, policy());
    expect(values.processingDataZone).toBe('Zone B');
    expect(values.vendor).toBe('VENDOR-APPROVED-LLM');
    expect(values.platform).toBe('PLAT-CLOUD-LLM');
  });

  it('a platform allowed in both Zone B and Zone C resolves to Zone B (the earliest letter)', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '3': 'PLAT-INTERNAL-ML' }, policy());
    expect(values.processingDataZone).toBe('Zone B');
  });

  it('a platform with no vendor_id defaults vendor to internal', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '3': 'PLAT-INTERNAL-ML' }, policy());
    expect(values.vendor).toBe('internal');
  });

  // R16-W W-9 (D-79, the UC-6b parity fix). PLAT-INTERNAL-ML allows both
  // Zone B and Zone C — the follow-up decides which, instead of always
  // defaulting to the earliest letter (Zone B).
  describe('Q3platformZone — the multi-zone platform follow-up', () => {
    it('TC-R16-W-01: "Yes — the platform runs the AI on the firm’s own systems" resolves to Zone C', () => {
      const { values, assumptions } = plainAnswersToFormValues(
        { ...BASE, '3': 'PLAT-INTERNAL-ML', '3platformZone': 'firm-systems' },
        policy(),
      );
      expect(values.processingDataZone).toBe('Zone C');
      expect(assumptions).toEqual([]);
    });

    it('TC-R16-W-02: "No — the platform passes it to an outside supplier’s AI" resolves to Zone B', () => {
      const { values, assumptions } = plainAnswersToFormValues(
        { ...BASE, '3': 'PLAT-INTERNAL-ML', '3platformZone': 'outside-supplier' },
        policy(),
      );
      expect(values.processingDataZone).toBe('Zone B');
      expect(assumptions).toEqual([]);
    });

    it('TC-R16-W-03: "No — it goes out to a public website or service" resolves to Zone A, for a platform that allows it', () => {
      const multiZone = policy({
        platforms: [
          {
            id: 'PLAT-ALL-ZONES',
            name: 'All zones',
            approved_envelope: { data_zones: ['Zone A', 'Zone B', 'Zone C'] },
            satisfies_controls: [],
            plain_name: 'A platform allowed in every zone',
          },
        ],
      });
      const { values } = plainAnswersToFormValues(
        { ...BASE, '3': 'PLAT-ALL-ZONES', '3platformZone': 'outside-service' },
        multiZone,
      );
      expect(values.processingDataZone).toBe('Zone A');
    });

    it('TC-R16-W-04: "Not sure" on PLAT-INTERNAL-ML (earliest allowed = Zone B) resolves to Zone B, with an assumption reference carrying earliestZone Zone B', () => {
      const { values, assumptions } = plainAnswersToFormValues(
        { ...BASE, '3': 'PLAT-INTERNAL-ML', '3platformZone': 'not-sure' },
        policy(),
      );
      expect(values.processingDataZone).toBe('Zone B');
      // R16-F §5 (DR7-06): the engine returns a REFERENCE — the worded
      // "outside supplier" sentence is asserted on describeAssumptions()
      // instead (src/components/plain-copy.test.ts).
      // R16-D2 §1 (D-95): the reference now also carries `fields` — the
      // graph fields THIS "Not sure" branch sets (here, just the zone).
      expect(assumptions).toEqual([
        { questionId: '3platformZone', optionKey: 'not-sure', earliestZone: 'Zone B', fields: ['data_zone'] },
      ]);
    });

    it('TC-R16-W-05: leaving the follow-up unanswered behaves exactly like "Not sure" (the default branch), not like an unresolved platform', () => {
      const { values, assumptions } = plainAnswersToFormValues(
        { ...BASE, '3': 'PLAT-INTERNAL-ML' },
        policy(),
      );
      expect(values.processingDataZone).toBe('Zone B');
      expect(assumptions).toEqual([
        { questionId: '3platformZone', optionKey: 'not-sure', earliestZone: 'Zone B', fields: ['data_zone'] },
      ]);
    });

    it('TC-R16-W-06: "Not sure" when the earliest allowed zone is A carries earliestZone Zone A instead', () => {
      const allowsA = policy({
        platforms: [
          {
            id: 'PLAT-ALL-ZONES',
            name: 'All zones',
            approved_envelope: { data_zones: ['Zone A', 'Zone C'] },
            satisfies_controls: [],
            plain_name: 'A platform allowed in two zones',
          },
        ],
      });
      const { values, assumptions } = plainAnswersToFormValues(
        { ...BASE, '3': 'PLAT-ALL-ZONES', '3platformZone': 'not-sure' },
        allowsA,
      );
      expect(values.processingDataZone).toBe('Zone A');
      expect(assumptions).toEqual([
        { questionId: '3platformZone', optionKey: 'not-sure', earliestZone: 'Zone A', fields: ['data_zone'] },
      ]);
    });

    it('TC-R16-W-07: a platform allowed in only one zone keeps the old mapping — no follow-up is read even if answered', () => {
      // PLAT-CLOUD-LLM allows only Zone B — the follow-up should never be
      // consulted even if a stray answer is present (e.g. left over from a
      // previously-selected multi-zone platform).
      const { values, assumptions } = plainAnswersToFormValues(
        { ...BASE, '3': 'PLAT-CLOUD-LLM', '3platformZone': 'firm-systems' },
        policy(),
      );
      expect(values.processingDataZone).toBe('Zone B');
      expect(assumptions).toEqual([]);
    });

    it('TC-R16-W-08: platformZoneOptionKeys orders Zone C, Zone B, Zone A (filtered to what the platform allows), "not-sure" always last', () => {
      const [, internal] = policy().platforms!;
      expect(platformZoneOptionKeys(internal!)).toEqual(['firm-systems', 'outside-supplier', 'not-sure']);

      const [allZones] = policy({
        platforms: [
          { id: 'x', name: 'x', approved_envelope: { data_zones: ['Zone A', 'Zone B', 'Zone C'] }, satisfies_controls: [] },
        ],
      }).platforms!;
      expect(platformZoneOptionKeys(allZones!)).toEqual([
        'firm-systems',
        'outside-supplier',
        'outside-service',
        'not-sure',
      ]);
    });
  });

  it('supplier-feature -> Zone B, and defers to Q3supplier for the vendor', () => {
    const { values } = plainAnswersToFormValues(
      { ...BASE, '3': 'supplier-feature', '3supplier': 'VENDOR-SUPPLIER-A' },
      policy(),
    );
    expect(values.processingDataZone).toBe('Zone B');
    expect(values.vendor).toBe('VENDOR-SUPPLIER-A');
  });

  it('specialist-product + "Not on this list" + a typed name -> "{text} (not on your firm\'s list)", never matched to the registry', () => {
    const { values } = plainAnswersToFormValues(
      {
        ...BASE,
        '3': 'specialist-product',
        '3supplier': 'not-on-list',
        '3supplierName': 'Supplier A plain name',
      },
      policy(),
    );
    // Even though the typed text is byte-identical to a real registry
    // vendor's plain_name, it must NOT resolve to that vendor's id (D-06).
    expect(values.vendor).toBe('Supplier A plain name (not on your firm’s list)'.replace('’', '’'));
    expect(values.vendor).not.toBe('VENDOR-SUPPLIER-A');
  });

  it('"Not on this list" with nothing typed -> the blank-safe fallback label', () => {
    const { values } = plainAnswersToFormValues(
      { ...BASE, '3': 'specialist-product', '3supplier': 'not-on-list', '3supplierName': '' },
      policy(),
    );
    expect(values.vendor).toBe('An unlisted supplier (not on your firm’s list)');
  });

  it('Q3supplier "I don’t know" -> unregistered, listed as an assumption', () => {
    const { values, assumptions } = plainAnswersToFormValues(
      { ...BASE, '3': 'specialist-product', '3supplier': 'dont-know' },
      policy(),
    );
    expect(values.vendor).not.toBe('internal');
    expect(values.vendor).not.toBe('VENDOR-SUPPLIER-A');
    expect(assumptions.some((a) => a.questionId === '3supplier')).toBe(true);
  });

  it('3model: a free-typed name not on the model registry becomes declaredModelIdOther', () => {
    // CR7-04: the model question is only asked for an outside assistant or a
    // supplier option, so the answer is read only then (BASE's firm-built
    // would now ignore it — see TC-CR7-04b).
    const { values } = plainAnswersToFormValues({ ...BASE, '3': 'outside-assistant', '3a': 'firm-account', '3model': 'gpt-4o-custom' }, policy());
    expect(values.declaredModelIdOther).toBe('gpt-4o-custom');
    expect(values.declaredModelId).toBeUndefined();
  });

  it('3model left blank names no model', () => {
    const { values } = plainAnswersToFormValues({ ...BASE }, policy());
    expect(values.declaredModelId).toBeUndefined();
    expect(values.declaredModelIdOther).toBeUndefined();
  });
});

describe('plainAnswersToFormValues — Q3a / Q3aWhich (outside assistant)', () => {
  const outside: PlainAnswers = { ...BASE, '3': 'outside-assistant' };

  it('the firm’s own account, with exactly one company-assistant vendor registered, resolves that vendor at Zone B', () => {
    const { values } = plainAnswersToFormValues({ ...outside, '3a': 'firm-account' }, policy());
    expect(values.processingDataZone).toBe('Zone B');
    expect(values.vendor).toBe('VENDOR-APPROVED-LLM');
  });

  it('with several company-assistant vendors, Q3aWhich selects the specific one', () => {
    const twoAssistants = policy({
      vendors: [
        { id: 'CA-1', name: 'A', approved_envelope: {}, satisfies_controls: [], kind: 'company_assistant' },
        { id: 'CA-2', name: 'B', approved_envelope: {}, satisfies_controls: [], kind: 'company_assistant' },
      ],
    });
    const { values } = plainAnswersToFormValues(
      { ...outside, '3a': 'firm-account', '3aWhich': 'CA-2' },
      twoAssistants,
    );
    expect(values.vendor).toBe('CA-2');
  });

  it('Q3aWhich "Not sure" -> Zone B, unregistered, listed as an assumption', () => {
    const twoAssistants = policy({
      vendors: [
        { id: 'CA-1', name: 'A', approved_envelope: {}, satisfies_controls: [], kind: 'company_assistant' },
        { id: 'CA-2', name: 'B', approved_envelope: {}, satisfies_controls: [], kind: 'company_assistant' },
      ],
    });
    const { values, assumptions } = plainAnswersToFormValues(
      { ...outside, '3a': 'firm-account', '3aWhich': 'not-sure' },
      twoAssistants,
    );
    expect(values.processingDataZone).toBe('Zone B');
    expect(values.vendor).not.toBe('CA-1');
    expect(values.vendor).not.toBe('CA-2');
    expect(assumptions.some((a) => a.questionId === '3aWhich')).toBe(true);
  });

  it('with no company-assistant vendor registered at all, the firm’s-own-account answer is still honest: unregistered', () => {
    const none = policy({ vendors: [] });
    const { values } = plainAnswersToFormValues({ ...outside, '3a': 'firm-account' }, none);
    expect(values.vendor).toBe('company AI assistant (not on your firm’s list)');
    expect(values.processingDataZone).toBe('Zone B');
  });

  it('a free or personal account -> Zone A, unregistered', () => {
    const { values } = plainAnswersToFormValues({ ...outside, '3a': 'personal-account' }, policy());
    expect(values.processingDataZone).toBe('Zone A');
    expect(values.vendor).not.toBe('internal');
  });

  it('Q3a "Not sure" -> Zone A, unregistered, listed as an assumption', () => {
    const { values, assumptions } = plainAnswersToFormValues({ ...outside, '3a': 'not-sure' }, policy());
    expect(values.processingDataZone).toBe('Zone A');
    expect(assumptions.some((a) => a.questionId === '3a')).toBe(true);
  });
});

describe('plainAnswersToFormValues — Q4 / Q4a (kind of AI)', () => {
  it('maps the five static kinds to the engine model types', () => {
    const cases: Array<[string, string]> = [
      ['perception', 'deep-learning'],
      ['language', 'llm'],
      ['generative', 'generative-ai'],
      ['agentic', 'agentic'],
    ];
    for (const [key, expected] of cases) {
      const { values } = plainAnswersToFormValues({ ...BASE, '4': key }, policy());
      expect(values.modelType).toBe(expected);
    }
  });

  it('"score" + 4a "fixed rules" -> statistical', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '4': 'score', '4a': 'rules' }, policy());
    expect(values.modelType).toBe('statistical');
  });

  it('"score" + 4a "they can show which factors" -> traditional-ml', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '4': 'score', '4a': 'explainable' }, policy());
    expect(values.modelType).toBe('traditional-ml');
  });

  it('"score" + 4a "No, or I don’t know" -> ml', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '4': 'score', '4a': 'unexplainable' }, policy());
    expect(values.modelType).toBe('ml');
  });

  it('Q4 "Not sure" -> agentic, listed as an assumption reference ({questionId, optionKey})', () => {
    const { values, assumptions } = plainAnswersToFormValues({ ...BASE, '4': 'not-sure' }, policy());
    expect(values.modelType).toBe('agentic');
    // R16-F §5 (DR7-06): the engine returns a reference, never the worded
    // text — the exact wording is asserted on describeAssumptions()
    // instead (src/components/plain-copy.test.ts).
    const a = assumptions.find((x) => x.questionId === '4');
    expect(a).toEqual({ questionId: '4', optionKey: 'not-sure', fields: ['model_type'] });
  });

  it('Q13/Q14 answers are read through when present, regardless of how Q4 was answered (agentic or Not sure)', () => {
    const { values } = plainAnswersToFormValues(
      { ...BASE, '4': 'not-sure', '13': ['credentialed'], '14': 'no' },
      policy(),
    );
    expect(values.systemAccessScope).toEqual(['credentialed_systems']);
    expect(values.multiInstanceCoordination).toBe('no');
  });
});

describe('plainAnswersToFormValues — Q5 (information it uses, tick-all)', () => {
  it('maps every static option to its data class', () => {
    const cases: Array<[string, string]> = [
      ['people', 'Client PII'],
      ['price-sensitive', 'MNPI'],
      ['confidential', 'Confidential'],
      ['everyday', 'Internal'],
      ['typed-only', 'Internal'],
      ['public', 'Public'],
    ];
    for (const [key, expected] of cases) {
      const { values } = plainAnswersToFormValues({ ...BASE, '5': [key] }, policy());
      expect(values.inputDataClasses).toEqual([expected]);
    }
  });

  it('TC-R16-B-02: UC-10 — ticking two different kinds of information produces one input node per distinct class', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '5': ['people', 'confidential'] }, policy());
    expect(values.inputDataClasses).toHaveLength(2);
    expect(values.inputDataClasses).toContain('Client PII');
    expect(values.inputDataClasses).toContain('Confidential');
  });

  it('two options that map to the same class collapse to one distinct input node', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '5': ['everyday', 'typed-only'] }, policy());
    expect(values.inputDataClasses).toEqual(['Internal']);
  });

  it('"Not sure" adds Confidential and is listed as an assumption', () => {
    const { values, assumptions } = plainAnswersToFormValues({ ...BASE, '5': ['not-sure'] }, policy());
    expect(values.inputDataClasses).toContain('Confidential');
    expect(assumptions.some((a) => a.questionId === '5')).toBe(true);
  });
});

describe('plainAnswersToFormValues — Q6 / Q6a / Q6b (what happens with the output)', () => {
  it('"read" -> read, level 0, non-binding, no 6a asked', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '6': 'read' }, policy());
    expect(values.outputActionType).toBe('read');
    expect(values.autonomyLevel).toBe(0);
    expect(values.decisionBindingness).toBe('non-binding');
    expect(values.hitl).toBeUndefined();
  });

  it('"answers directly" + 6a "one input among several" -> inform, level 0, advisory', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '6': 'answers', '6a': 'one-input' }, policy());
    expect(values.outputActionType).toBe('inform');
    expect(values.autonomyLevel).toBe(0);
    expect(values.decisionBindingness).toBe('advisory');
  });

  it('"creates a draft" + 6a "little" -> draft, level 1, hitl true, non-binding', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '6': 'drafts', '6a': 'little' }, policy());
    expect(values.outputActionType).toBe('draft');
    expect(values.autonomyLevel).toBe(1);
    expect(values.hitl).toBe(true);
    expect(values.decisionBindingness).toBe('non-binding');
  });

  it('"suggests" + 6a "usually what a decision is based on" -> recommend, level 1, hitl true, material', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '6': 'suggests', '6a': 'usually-basis' }, policy());
    expect(values.outputActionType).toBe('recommend');
    expect(values.autonomyLevel).toBe(1);
    expect(values.hitl).toBe(true);
    expect(values.decisionBindingness).toBe('material');
  });

  it('"prepares an action" -> execute, level 1, hitl true, material — fixed, no 6a asked', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '6': 'prepares' }, policy());
    expect(values.outputActionType).toBe('execute');
    expect(values.autonomyLevel).toBe(1);
    expect(values.hitl).toBe(true);
    expect(values.decisionBindingness).toBe('material');
  });

  it('"decides/acts, reviewed afterwards" + 6b "trades" -> trade, level 2, no hitl, binding', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '6': 'acts-reviewed', '6b': 'trades' }, policy());
    expect(values.outputActionType).toBe('trade');
    expect(values.autonomyLevel).toBe(2);
    expect(values.hitl).toBe(false);
    expect(values.decisionBindingness).toBe('binding');
  });

  it('"acts within set limits" + 6b "yes/no decision" -> approve, level 3, no hitl, binding', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '6': 'acts-bounded', '6b': 'yes-no-decision' }, policy());
    expect(values.outputActionType).toBe('approve');
    expect(values.autonomyLevel).toBe(3);
    expect(values.hitl).toBe(false);
  });

  it('"acts entirely alone" + 6b "something else" -> execute, level 4, no hitl, binding', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '6': 'acts-alone', '6b': 'something-else' }, policy());
    expect(values.outputActionType).toBe('execute');
    expect(values.autonomyLevel).toBe(4);
    expect(values.hitl).toBe(false);
  });

  it('TC-R16-B-03: Q6 "Not sure" -> execute, level 4, no hitl, binding, listed as an assumption reference', () => {
    const { values, assumptions } = plainAnswersToFormValues({ ...BASE, '6': 'not-sure' }, policy());
    expect(values.outputActionType).toBe('execute');
    expect(values.autonomyLevel).toBe(4);
    expect(values.hitl).toBe(false);
    expect(values.decisionBindingness).toBe('binding');
    const a = assumptions.find((x) => x.questionId === '6');
    expect(a).toEqual({
      questionId: '6',
      optionKey: 'not-sure',
      fields: ['action_type', 'autonomy_level', 'decision_bindingness', 'hitl'],
    });
  });

  it('Q6a "Not sure" -> material, listed as an assumption', () => {
    const { values, assumptions } = plainAnswersToFormValues({ ...BASE, '6': 'drafts', '6a': 'not-sure' }, policy());
    expect(values.decisionBindingness).toBe('material');
    expect(assumptions.some((a) => a.questionId === '6a')).toBe(true);
  });
});

describe('plainAnswersToFormValues — Q7 (who sees it)', () => {
  it('maps every option', () => {
    const cases: Array<[string, string]> = [
      ['me-or-team', 'internal-only'],
      ['other-teams', 'internal-shared'],
      ['clients', 'client-facing'],
      ['public-market', 'market-facing'],
    ];
    for (const [key, expected] of cases) {
      const { values } = plainAnswersToFormValues({ ...BASE, '7': key }, policy());
      expect(values.outputExposure).toBe(expected);
    }
  });

  it('TC-R16-B-04: "Not sure" -> market-facing, listed as an assumption reference', () => {
    const { values, assumptions } = plainAnswersToFormValues({ ...BASE, '7': 'not-sure' }, policy());
    expect(values.outputExposure).toBe('market-facing');
    const a = assumptions.find((x) => x.questionId === '7');
    expect(a).toEqual({ questionId: '7', optionKey: 'not-sure', fields: ['exposure'] });
  });
});

describe('plainAnswersToFormValues — Q8 (decision type)', () => {
  it('maps the closed set', () => {
    const cases: Array<[string, string]> = [
      ['credit', 'credit-decision'],
      ['hiring', 'hiring'],
      ['pricing', 'pricing'],
      ['trading', 'trading'],
      ['fraud', 'fraud-detection'],
      ['regulatory', 'regulatory-reporting'],
      ['operational', 'operational'],
    ];
    for (const [key, expected] of cases) {
      const { values } = plainAnswersToFormValues({ ...BASE, '8': key }, policy());
      expect(values.decisionType).toBe(expected);
    }
  });

  it('"Something else" + 8other free text -> decisionTypeOther, decisionType stays undefined', () => {
    const { values } = plainAnswersToFormValues(
      { ...BASE, '8': 'other', '8other': 'collections prioritisation' },
      policy(),
    );
    expect(values.decisionType).toBeUndefined();
    expect(values.decisionTypeOther).toBe('collections prioritisation');
  });
});

describe('plainAnswersToFormValues — Q9 (can it be undone)', () => {
  it('Yes -> reversible, No -> irreversible', () => {
    expect(plainAnswersToFormValues({ ...BASE, '9': 'yes' }, policy()).values.outputReversibility).toBe('reversible');
    expect(plainAnswersToFormValues({ ...BASE, '9': 'no' }, policy()).values.outputReversibility).toBe('irreversible');
  });

  it('TC-R16-B-05: "Not sure" -> irreversible, listed as an assumption reference', () => {
    const { values, assumptions } = plainAnswersToFormValues({ ...BASE, '9': 'not-sure' }, policy());
    expect(values.outputReversibility).toBe('irreversible');
    const a = assumptions.find((x) => x.questionId === '9');
    expect(a).toEqual({ questionId: '9', optionKey: 'not-sure', fields: ['output_reversibility'] });
  });
});

describe('plainAnswersToFormValues — Q10 (how widely used)', () => {
  it('small -> limited; team and wide -> at_scale', () => {
    expect(plainAnswersToFormValues({ ...BASE, '10': 'small' }, policy()).values.outputScale).toBe('limited');
    expect(plainAnswersToFormValues({ ...BASE, '10': 'team' }, policy()).values.outputScale).toBe('at_scale');
    expect(plainAnswersToFormValues({ ...BASE, '10': 'wide' }, policy()).values.outputScale).toBe('at_scale');
  });
});

describe('plainAnswersToFormValues — Q11 (jurisdictions, tick-all)', () => {
  it('ticked jurisdiction codes pass through', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '11': ['UK', 'EU'] }, policy());
    expect(values.jurisdictions.sort()).toEqual(['EU', 'UK']);
  });

  it('"Somewhere else, or not sure" on its own gives an empty jurisdictions list (TC-CR7-23b)', () => {
    const { values, assumptions } = plainAnswersToFormValues({ ...BASE, '11': ['elsewhere-not-sure'] }, policy());
    expect(values.jurisdictions).toEqual([]);
    // unchanged: no assumption is added for the lone tick
    expect(assumptions.some((a) => a.questionId === '11')).toBe(false);
  });

  it('an unrecognised code is dropped rather than passed through unchecked', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '11': ['UK', 'ZZ'] }, policy());
    expect(values.jurisdictions).toEqual(['UK']);
  });
});

describe('plainAnswersToFormValues — Q12 (replaces something)', () => {
  it('Yes -> true, No -> false', () => {
    expect(plainAnswersToFormValues({ ...BASE, '12': 'yes' }, policy()).values.replacesPriorModel).toBe(true);
    expect(plainAnswersToFormValues({ ...BASE, '12': 'no' }, policy()).values.replacesPriorModel).toBe(false);
  });

  it('form path: "Not sure" -> true, recorded as an assumption and listed back — the same reading QUESTIONNAIRE_COPY.replaces_prior_model.notSure gives for the generated guessed-field question (plain-copy.ts:649-658)', () => {
    const { values, assumptions } = plainAnswersToFormValues({ ...BASE, '12': 'not-sure' }, policy());
    expect(values.replacesPriorModel).toBe(true);
    const a = assumptions.find((x) => x.questionId === '12');
    expect(a).toEqual({ questionId: '12', optionKey: 'not-sure', fields: ['replaces_prior_model'] });
  });
});

// CR6-06 (Critical) — stored answers outside the current options skip the
// stricter-reading rule. A stale supplier/company-assistant/platform id (the
// registry entry was removed or renamed) or an unrecognised value for Q4/6/7/
// 12 (an old option key a draft or an older build still has on file) must
// take that question's own "Not sure" path — the strictest value AND its
// assumption — exactly as if the person had answered "Not sure" themselves.
// Before this fix each of these silently fell through to a value with NO
// assumption recorded, so a reviewer had no way to know the answer had been
// reinterpreted at all.
describe('plainAnswersToFormValues — CR6-06 (stale/unrecognised stored answers take the "Not sure" path)', () => {
  it('TC-CR6-06a: a stale/removed Q3supplier id takes the same path as "I don\'t know" — same vendor label, listed as an assumption', () => {
    const stale = plainAnswersToFormValues(
      { ...BASE, '3': 'supplier-feature', '3supplier': 'VENDOR-SUPPLIER-REMOVED' },
      policy(),
    );
    const dontKnow = plainAnswersToFormValues(
      { ...BASE, '3': 'supplier-feature', '3supplier': 'dont-know' },
      policy(),
    );
    expect(stale.values.vendor).toBe(dontKnow.values.vendor);
    expect(stale.values.vendor).toBe('a supplier you weren’t sure of');
    const a = stale.assumptions.find((x) => x.questionId === '3supplier');
    expect(a).toEqual({ questionId: '3supplier', optionKey: 'dont-know', fields: ['vendor'] });
  });

  it('TC-CR6-06b: a stale/removed Q3 platform id takes the "Not sure" path — Zone A, the unregistered vendor label, listed as an assumption', () => {
    const stale = plainAnswersToFormValues({ ...BASE, '3': 'PLAT-REMOVED-OLD' }, policy());
    const notSure = plainAnswersToFormValues({ ...BASE, '3': 'not-sure' }, policy());
    expect(stale.values.inputDataZone).toBe('Zone A');
    expect(stale.values.vendor).toBe(notSure.values.vendor);
    expect(stale.values.platform).toBeUndefined();
    const a = stale.assumptions.find((x) => x.questionId === '3');
    expect(a).toEqual({ questionId: '3', optionKey: 'not-sure', fields: ['data_zone', 'vendor'] });
  });

  it('a stale/removed Q3aWhich id (several company-assistant vendors registered) takes the "Not sure" path, listed as an assumption', () => {
    const pol = policy({
      vendors: [
        { id: 'CA-1', name: 'A', approved_envelope: {}, satisfies_controls: [], kind: 'company_assistant' },
        { id: 'CA-2', name: 'B', approved_envelope: {}, satisfies_controls: [], kind: 'company_assistant' },
      ],
    });
    const stale = plainAnswersToFormValues(
      { ...BASE, '3': 'outside-assistant', '3a': 'firm-account', '3aWhich': 'CA-REMOVED' },
      pol,
    );
    const notSure = plainAnswersToFormValues(
      { ...BASE, '3': 'outside-assistant', '3a': 'firm-account', '3aWhich': 'not-sure' },
      pol,
    );
    expect(stale.values.vendor).toBe(notSure.values.vendor);
    const a = stale.assumptions.find((x) => x.questionId === '3aWhich');
    expect(a).toEqual({ questionId: '3aWhich', optionKey: 'not-sure', fields: ['vendor'] });
  });

  it('TC-CR6-06c: an unrecognised Q6 value takes the same path as "Not sure" — execute, level 4, no hitl, binding, listed as an assumption', () => {
    const stale = plainAnswersToFormValues({ ...BASE, '6': 'some-removed-option' }, policy());
    const notSure = plainAnswersToFormValues({ ...BASE, '6': 'not-sure' }, policy());
    expect(stale.values.outputActionType).toBe(notSure.values.outputActionType);
    expect(stale.values.autonomyLevel).toBe(notSure.values.autonomyLevel);
    expect(stale.values.hitl).toBe(notSure.values.hitl);
    expect(stale.values.decisionBindingness).toBe(notSure.values.decisionBindingness);
    const a = stale.assumptions.find((x) => x.questionId === '6');
    expect(a).toEqual({
      questionId: '6',
      optionKey: 'not-sure',
      fields: ['action_type', 'autonomy_level', 'decision_bindingness', 'hitl'],
    });
  });

  it('an unrecognised Q4 value takes the "Not sure" path — agentic, listed as an assumption', () => {
    const { values, assumptions } = plainAnswersToFormValues({ ...BASE, '4': 'some-removed-option' }, policy());
    expect(values.modelType).toBe('agentic');
    expect(assumptions.find((a) => a.questionId === '4')).toEqual({
      questionId: '4',
      optionKey: 'not-sure',
      fields: ['model_type'],
    });
  });

  it('an unrecognised Q7 value takes the "Not sure" path — market-facing, listed as an assumption (unlike the real "public-market" option, which is a definite answer and stays unassumed)', () => {
    const stale = plainAnswersToFormValues({ ...BASE, '7': 'some-removed-option' }, policy());
    expect(stale.values.outputExposure).toBe('market-facing');
    expect(stale.assumptions.find((a) => a.questionId === '7')).toEqual({
      questionId: '7',
      optionKey: 'not-sure',
      fields: ['exposure'],
    });

    const publicMarket = plainAnswersToFormValues({ ...BASE, '7': 'public-market' }, policy());
    expect(publicMarket.values.outputExposure).toBe('market-facing');
    expect(publicMarket.assumptions).toEqual([]);
  });

  it('TC-CR6-06e: a stale Q5 tick (alone or mixed with real ticks) takes the "Not sure" path — Confidential, listed as an assumption', () => {
    for (const ticks of [['old-key'], ['public', 'old-key']]) {
      const { values, assumptions } = plainAnswersToFormValues({ ...BASE, '5': ticks }, policy());
      expect(values.inputDataClasses).toContain('Confidential');
      expect(assumptions.find((a) => a.questionId === '5')).toEqual({
        questionId: '5',
        optionKey: 'not-sure',
        fields: ['data_class'],
      });
    }
    // A clean, current tick stays unassumed.
    expect(plainAnswersToFormValues({ ...BASE, '5': ['public'] }, policy()).assumptions.find((a) => a.questionId === '5')).toBeUndefined();
  });

  it('TC-CR6-06f: an unrecognised Q9 value takes the "Not sure" path — irreversible, listed as an assumption', () => {
    const { values, assumptions } = plainAnswersToFormValues({ ...BASE, '9': 'some-removed-option' }, policy());
    expect(values.outputReversibility).toBe('irreversible');
    expect(assumptions.find((a) => a.questionId === '9')).toEqual({
      questionId: '9',
      optionKey: 'not-sure',
      fields: ['output_reversibility'],
    });
  });

  it('TC-CR6-06f: an unrecognised Q14 value takes the "Not sure" path — unknown, listed as an assumption', () => {
    const { values, assumptions } = plainAnswersToFormValues({ ...BASE, '14': 'some-removed-option' }, policy());
    expect(values.multiInstanceCoordination).toBe('unknown');
    expect(assumptions.find((a) => a.questionId === '14')).toEqual({
      questionId: '14',
      optionKey: 'not-sure',
      fields: ['multi_instance_coordination'],
    });
  });

  it('TC-CR6-06f: an unrecognised Q6a value takes the "Not sure" path — material, listed as an assumption', () => {
    const { values, assumptions } = plainAnswersToFormValues(
      { ...BASE, '6': 'suggests', '6a': 'some-removed-option' },
      policy(),
    );
    expect(values.decisionBindingness).toBe('material');
    expect(assumptions.find((a) => a.questionId === '6a')).toEqual({
      questionId: '6a',
      optionKey: 'not-sure',
      fields: ['decision_bindingness'],
    });
  });

  it('an unrecognised Q12 value takes the "Not sure" path — true, listed as an assumption', () => {
    const { values, assumptions } = plainAnswersToFormValues({ ...BASE, '12': 'some-removed-option' }, policy());
    expect(values.replacesPriorModel).toBe(true);
    expect(assumptions.find((a) => a.questionId === '12')).toEqual({
      questionId: '12',
      optionKey: 'not-sure',
      fields: ['replaces_prior_model'],
    });
  });
});

describe('plainAnswersToFormValues — Q13 (agent access, tick-all)', () => {
  it('maps ticked kinds to the engine access-scope values', () => {
    const { values } = plainAnswersToFormValues(
      { ...BASE, '4': 'agentic', '13': ['credentialed', 'shared'] },
      policy(),
    );
    expect(values.systemAccessScope).toEqual(['shared_infrastructure', 'credentialed_systems']);
  });

  it('"Nothing beyond..." ticked alone -> system access scope is ["none"]', () => {
    const { values } = plainAnswersToFormValues(
      { ...BASE, '4': 'agentic', '13': ['none'] },
      policy(),
    );
    expect(values.systemAccessScope).toEqual(['none']);
  });

  // F-8 (DR7-08). Before R16-F, "none" ticked together with another kind
  // was hand-resolved to ["none"] unconditionally, silently discarding the
  // other ticks. The real form's own exclusivity (StructuredForm.tsx's
  // toggleMulti) never lets a person reach this combination, but a stale
  // draft or a hand-built PlainAnswers object can — routed through the
  // single checker (normaliseAccessScope), this is now a REFUSAL, not a
  // silent resolution: systemAccessScope stays unstated, the same way any
  // other unanswered-looking Q13 does. The submitter-facing half of this
  // fix is that the form's OWN required check (StructuredForm.test.tsx)
  // calls the identical function and never lets this reach Continue.
  it('F-8 (DR7-08): "none" ticked together with another kind is refused, not silently resolved to "none" — systemAccessScope stays unstated', () => {
    const { values } = plainAnswersToFormValues(
      { ...BASE, '4': 'agentic', '13': ['none', 'shared'] },
      policy(),
    );
    expect(values.systemAccessScope).toBeUndefined();
  });

  it('TC-R16-B-06: "Not sure" -> all three non-none kinds, listed as an assumption reference', () => {
    const { values, assumptions } = plainAnswersToFormValues(
      { ...BASE, '4': 'agentic', '13': ['not-sure'] },
      policy(),
    );
    expect(values.systemAccessScope).toEqual(
      expect.arrayContaining(['shared_infrastructure', 'credentialed_systems', 'deployment_authority']),
    );
    expect(values.systemAccessScope).toHaveLength(3);
    expect(assumptions.find((a) => a.questionId === '13')).toEqual({
      questionId: '13',
      optionKey: 'not-sure',
      fields: ['system_access_scope'],
    });
  });

  it('Q13 unanswered (not an agent) leaves systemAccessScope unstated', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '4': 'language' }, policy());
    expect(values.systemAccessScope).toBeUndefined();
  });
});

describe('plainAnswersToFormValues — Q14 (instance coordination)', () => {
  it('maps no/yes directly', () => {
    expect(
      plainAnswersToFormValues({ ...BASE, '4': 'agentic', '14': 'no' }, policy()).values.multiInstanceCoordination,
    ).toBe('no');
    expect(
      plainAnswersToFormValues({ ...BASE, '4': 'agentic', '14': 'yes' }, policy()).values.multiInstanceCoordination,
    ).toBe('yes');
  });

  it('"Not sure" -> unknown, listed as an assumption', () => {
    const { values, assumptions } = plainAnswersToFormValues(
      { ...BASE, '4': 'agentic', '14': 'not-sure' },
      policy(),
    );
    expect(values.multiInstanceCoordination).toBe('unknown');
    expect(assumptions.some((a) => a.questionId === '14')).toBe(true);
  });
});

describe('plainAnswersToFormValues — basics', () => {
  it('carries the name and description through unchanged', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '1': 'My tool', '2': 'Does a thing.' }, policy());
    expect(values.useCaseName).toBe('My tool');
    expect(values.description).toBe('Does a thing.');
  });

  it('every assumption reference carries a questionId and an optionKey (R16-F §5: the worded text is a describeAssumptions() concern, not this module\'s)', () => {
    const { assumptions } = plainAnswersToFormValues({ ...BASE, '9': 'not-sure' }, policy());
    const a = assumptions.find((x) => x.questionId === '9');
    expect(a).toEqual({ questionId: '9', optionKey: 'not-sure', fields: ['output_reversibility'] });
  });

  it('no assumptions are recorded when nothing was "Not sure"', () => {
    const { assumptions } = plainAnswersToFormValues(BASE, policy());
    expect(assumptions).toEqual([]);
  });
});

// R16-D2 §1 (D-95). The guard test: no hand-kept table of "which fields
// does this 'Not sure' answer set" survives unchecked. For every question
// that offers "Not sure" (or, for 3supplier, its "dont-know" equivalent),
// build the graph from the "Not sure" answer and from each of the
// question's other answers (all other questions held fixed), and assert
// the UNION of graph fields whose value differs from the "Not sure" graph
// equals the `fields` the mapping itself reported for that assumption —
// two independently-derived things, compared against each other, not
// against a hand-typed expectation this test could drift from the way
// the production table it replaces could have.
describe('plainAnswersToFormValues — TC-R16-D2-19: the "Not sure" fields guard (§1, D-95)', () => {
  // Every graph field any node or the graph itself carries (engine/types.ts
  // InputNode/ProcessingNode/OutputNode/DataFlowGraph) — the same universe
  // condition.ts#collectFieldValues can ever be asked about.
  const CANDIDATE_GRAPH_FIELDS = [
    'data_class', 'data_zone', 'model_type', 'autonomy_level', 'vendor', 'platform',
    'declared_model_id', 'replaces_prior_model', 'system_access_scope',
    'multi_instance_coordination', 'action_type', 'exposure', 'decision_bindingness',
    'output_reversibility', 'scale', 'decision_type', 'decision_type_other', 'hitl',
    'jurisdictions',
  ];

  // Mirrors condition.ts#collectFieldValues's own flattening (deliberately
  // re-implemented, not imported: this test must hold even if that
  // function's internals change, since it is checking a PRODUCT claim —
  // "fields names what a condition can match on" — not that function's
  // implementation).
  function fieldValues(graph: DataFlowGraph, field: string): unknown[] {
    const values: unknown[] = [];
    const nodes = [...graph.input_nodes, ...graph.processing_nodes, ...graph.output_nodes] as unknown as Array<
      Record<string, unknown>
    >;
    for (const node of nodes) {
      if (field in node) {
        const v = node[field];
        if (Array.isArray(v)) values.push(...v);
        else values.push(v);
      }
    }
    if (field === 'jurisdictions') values.push(...graph.jurisdictions);
    return values;
  }

  function differingFields(a: DataFlowGraph, b: DataFlowGraph): string[] {
    return CANDIDATE_GRAPH_FIELDS.filter(
      (field) => JSON.stringify([...fieldValues(a, field)].sort()) !== JSON.stringify([...fieldValues(b, field)].sort()),
    );
  }

  function graphFor(answers: PlainAnswers, pol: PolicyFile): DataFlowGraph {
    // B-15: buildGraphFromForm's timestamp is now a parameter — fixed here
    // since extracted_at is not one of CANDIDATE_GRAPH_FIELDS and this
    // guard never compares it.
    return buildGraphFromForm(plainAnswersToFormValues(answers, pol).values, '2026-01-01T00:00:00.000Z', () => crypto.randomUUID());
  }

  // Every question fully answered with a definite, non-"Not sure" value —
  // the shared base every case below overrides just the question under
  // test on top of.
  const BASE_FULL: PlainAnswers = {
    '1': 'Tool',
    '2': 'Desc.',
    '3': 'PLAT-CLOUD-LLM',
    '4': 'score',
    '4a': 'rules',
    '5': ['everyday'],
    '6': 'drafts',
    '6a': 'little',
    '7': 'me-or-team',
    '8': 'operational',
    '9': 'yes',
    '10': 'small',
    '11': ['UK'],
    '12': 'no',
    '13': ['none'],
    '14': 'no',
  };

  const basePolicy = policy();
  // 3aWhich is only ever asked when more than one company-assistant
  // vendor is registered — a policy variant just for that one case.
  const twoAssistantsPolicy = policy({
    vendors: [
      { id: 'CA-1', name: 'A', approved_envelope: {}, satisfies_controls: [], kind: 'company_assistant' },
      { id: 'CA-2', name: 'B', approved_envelope: {}, satisfies_controls: [], kind: 'company_assistant' },
    ],
  });

  interface GuardCase {
    label: string;
    questionId: string;
    optionKey: string;
    pol?: PolicyFile;
    notSure: PlainAnswers;
    alternates: PlainAnswers[];
  }

  const CASES: GuardCase[] = [
    {
      label: '3:not-sure — where the AI comes from',
      questionId: '3',
      optionKey: 'not-sure',
      notSure: { ...BASE_FULL, '3': 'not-sure' },
      alternates: [
        { ...BASE_FULL, '3': 'firm-built' },
        { ...BASE_FULL, '3': 'outside-assistant', '3a': 'firm-account' },
        { ...BASE_FULL, '3': 'supplier-feature', '3supplier': 'VENDOR-SUPPLIER-A' },
        { ...BASE_FULL, '3': 'specialist-product', '3supplier': 'VENDOR-SUPPLIER-A' },
      ],
    },
    {
      label: '3supplier:dont-know — which supplier it is',
      questionId: '3supplier',
      optionKey: 'dont-know',
      notSure: { ...BASE_FULL, '3': 'supplier-feature', '3supplier': 'dont-know' },
      alternates: [
        { ...BASE_FULL, '3': 'supplier-feature', '3supplier': 'not-on-list', '3supplierName': 'Foo' },
        { ...BASE_FULL, '3': 'supplier-feature', '3supplier': 'VENDOR-SUPPLIER-A' },
      ],
    },
    {
      label: '3a:not-sure — which account you use',
      questionId: '3a',
      optionKey: 'not-sure',
      notSure: { ...BASE_FULL, '3': 'outside-assistant', '3a': 'not-sure' },
      alternates: [
        { ...BASE_FULL, '3': 'outside-assistant', '3a': 'firm-account' },
        { ...BASE_FULL, '3': 'outside-assistant', '3a': 'personal-account' },
      ],
    },
    {
      label: '3aWhich:not-sure — which company assistant it is',
      questionId: '3aWhich',
      optionKey: 'not-sure',
      pol: twoAssistantsPolicy,
      notSure: { ...BASE_FULL, '3': 'outside-assistant', '3a': 'firm-account', '3aWhich': 'not-sure' },
      alternates: [{ ...BASE_FULL, '3': 'outside-assistant', '3a': 'firm-account', '3aWhich': 'CA-2' }],
    },
    {
      label: '3platformZone:not-sure — whether information stays on firm systems',
      questionId: '3platformZone',
      optionKey: 'not-sure',
      notSure: { ...BASE_FULL, '3': 'PLAT-INTERNAL-ML', '3platformZone': 'not-sure' },
      alternates: [
        { ...BASE_FULL, '3': 'PLAT-INTERNAL-ML', '3platformZone': 'firm-systems' },
        { ...BASE_FULL, '3': 'PLAT-INTERNAL-ML', '3platformZone': 'outside-supplier' },
      ],
    },
    {
      label: '4:not-sure — what kind of AI it is',
      questionId: '4',
      optionKey: 'not-sure',
      notSure: { ...BASE_FULL, '4': 'not-sure' },
      alternates: [
        { ...BASE_FULL, '4': 'score', '4a': 'rules' },
        { ...BASE_FULL, '4': 'perception' },
        { ...BASE_FULL, '4': 'language' },
        { ...BASE_FULL, '4': 'generative' },
        { ...BASE_FULL, '4': 'agentic' },
      ],
    },
    {
      label: '5:not-sure — what information it uses',
      questionId: '5',
      optionKey: 'not-sure',
      notSure: { ...BASE_FULL, '5': ['not-sure'] },
      alternates: [
        { ...BASE_FULL, '5': ['people'] },
        { ...BASE_FULL, '5': ['price-sensitive'] },
        { ...BASE_FULL, '5': ['confidential'] },
        { ...BASE_FULL, '5': ['everyday'] },
        { ...BASE_FULL, '5': ['public'] },
      ],
    },
    {
      label: '6:not-sure — what it does with what it produces',
      questionId: '6',
      optionKey: 'not-sure',
      notSure: { ...BASE_FULL, '6': 'not-sure' },
      alternates: [
        { ...BASE_FULL, '6': 'read' },
        { ...BASE_FULL, '6': 'answers', '6a': 'little' },
        { ...BASE_FULL, '6': 'drafts', '6a': 'little' },
        { ...BASE_FULL, '6': 'suggests', '6a': 'little' },
        { ...BASE_FULL, '6': 'prepares' },
        { ...BASE_FULL, '6': 'acts-reviewed', '6b': 'trades' },
        { ...BASE_FULL, '6': 'acts-bounded', '6b': 'yes-no-decision' },
        { ...BASE_FULL, '6': 'acts-alone', '6b': 'something-else' },
      ],
    },
    {
      label: '6a:not-sure — how much weight what it produces carries',
      questionId: '6a',
      optionKey: 'not-sure',
      notSure: { ...BASE_FULL, '6': 'drafts', '6a': 'not-sure' },
      alternates: [
        { ...BASE_FULL, '6': 'drafts', '6a': 'little' },
        { ...BASE_FULL, '6': 'drafts', '6a': 'one-input' },
        { ...BASE_FULL, '6': 'drafts', '6a': 'usually-basis' },
      ],
    },
    {
      label: '7:not-sure — who sees what it produces',
      questionId: '7',
      optionKey: 'not-sure',
      notSure: { ...BASE_FULL, '7': 'not-sure' },
      alternates: [
        { ...BASE_FULL, '7': 'me-or-team' },
        { ...BASE_FULL, '7': 'other-teams' },
        { ...BASE_FULL, '7': 'clients' },
        { ...BASE_FULL, '7': 'public-market' },
      ],
    },
    {
      label: '9:not-sure — whether a mistake can be put right',
      questionId: '9',
      optionKey: 'not-sure',
      notSure: { ...BASE_FULL, '9': 'not-sure' },
      alternates: [{ ...BASE_FULL, '9': 'yes' }, { ...BASE_FULL, '9': 'no' }],
    },
    {
      label: '12:not-sure — whether it replaces something you use',
      questionId: '12',
      optionKey: 'not-sure',
      notSure: { ...BASE_FULL, '12': 'not-sure' },
      alternates: [{ ...BASE_FULL, '12': 'yes' }, { ...BASE_FULL, '12': 'no' }],
    },
    {
      label: '13:not-sure — what it can get into by itself',
      questionId: '13',
      optionKey: 'not-sure',
      notSure: { ...BASE_FULL, '13': ['not-sure'] },
      alternates: [
        { ...BASE_FULL, '13': ['none'] },
        { ...BASE_FULL, '13': ['credentialed'] },
        { ...BASE_FULL, '13': ['deployment'] },
        { ...BASE_FULL, '13': ['shared'] },
        { ...BASE_FULL, '13': ['credentialed', 'shared'] },
      ],
    },
    {
      label: '14:not-sure — whether copies of it work together',
      questionId: '14',
      optionKey: 'not-sure',
      notSure: { ...BASE_FULL, '14': 'not-sure' },
      alternates: [{ ...BASE_FULL, '14': 'no' }, { ...BASE_FULL, '14': 'yes' }],
    },
  ];

  it('TC-R16-D2-19: every "Not sure"/"dont-know" assumption\'s reported `fields` equals the union of graph fields that actually differ from each of the question\'s other answers', () => {
    expect(CASES).toHaveLength(14); // §1's own enumeration — all 14, none dropped silently.
    for (const c of CASES) {
      const pol = c.pol ?? basePolicy;
      const { assumptions } = plainAnswersToFormValues(c.notSure, pol);
      const reported = assumptions.find((a) => a.questionId === c.questionId && a.optionKey === c.optionKey);
      expect(reported, `${c.label}: no assumption reference was recorded at all`).toBeDefined();

      const notSureGraph = graphFor(c.notSure, pol);
      const union = new Set<string>();
      for (const alt of c.alternates) {
        for (const field of differingFields(notSureGraph, graphFor(alt, pol))) union.add(field);
      }
      expect([...union].sort(), c.label).toEqual([...reported!.fields].sort());
    }
  });
});

// CR7-04 (engine half). The model question (3model) is asked only when Q3 is
// an outside assistant or a supplier option — StructuredForm's showQ3Model.
// A value left in the answers from an earlier Q3 choice must not reach the graph.
describe('CR7-04 — 3model is read only when the model question is shown', () => {
  it('TC-CR7-04b: q3ShowsModelQuestion is true for outside-assistant, supplier-feature, specialist-product only', () => {
    expect(q3ShowsModelQuestion({ ...BASE, '3': 'outside-assistant' })).toBe(true);
    expect(q3ShowsModelQuestion({ ...BASE, '3': 'supplier-feature' })).toBe(true);
    expect(q3ShowsModelQuestion({ ...BASE, '3': 'specialist-product' })).toBe(true);
    for (const q3 of ['firm-built', 'not-sure', 'PLAT-CLOUD-LLM']) {
      expect(q3ShowsModelQuestion({ ...BASE, '3': q3 }), q3).toBe(false);
    }
    expect(q3ShowsModelQuestion({ ...BASE, '3': undefined } as unknown as PlainAnswers)).toBe(false);
  });

  it('TC-CR7-04c: a stale 3model left behind after Q3 changed to firm-built names no model', () => {
    const { values } = plainAnswersToFormValues({ ...BASE, '3': 'firm-built', '3model': 'gpt-4o-custom' }, policy());
    expect(values.declaredModelId).toBeUndefined();
    expect(values.declaredModelIdOther).toBeUndefined();
  });

  it('TC-CR7-04d: the same 3model is read when Q3 is a supplier option', () => {
    const { values } = plainAnswersToFormValues(
      { ...BASE, '3': 'supplier-feature', '3supplier': 'VENDOR-SUPPLIER-A', '3model': 'gpt-4o-custom' },
      policy(),
    );
    expect(values.declaredModelIdOther).toBe('gpt-4o-custom');
  });
});

// CR7-23 (owner decisions): a listed country stays checked when "Somewhere
// else, or not sure" is also ticked, and the unknown country is listed back
// as an assumption. The result is NOT marked provisional on that account.
describe('CR7-23 — listed country kept alongside "Somewhere else, or not sure"', () => {
  it('TC-CR7-23a: UK + elsewhere keeps UK and lists the unchecked country as an assumption', () => {
    const { values, assumptions } = plainAnswersToFormValues({ ...BASE, '11': ['UK', 'elsewhere-not-sure'] }, policy());
    expect(values.jurisdictions).toEqual(['UK']);
    expect(assumptions.find((a) => a.questionId === '11')).toEqual({
      questionId: '11',
      optionKey: 'elsewhere-not-sure',
      fields: ['jurisdictions'],
    });
    const worded = describeAssumptions(assumptions).find((a) => a.questionId === '11');
    expect(worded?.assumption).toMatch(/no other country/i);
    expect(worded?.shortLabel).not.toBe(worded?.question);
  });

  it('TC-CR7-23c: with the shipped policy and packs the UK pack applies and the result is not provisional for want of a regulatory basis', () => {
    const yaml = readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8');
    const loaded = loadPolicy(yaml);
    if (!loaded.valid) throw new Error('policy invalid');
    const pk = loadPacks(getPackSources());
    const answers: PlainAnswers = { ...BASE, '11': ['UK', 'elsewhere-not-sure'] };
    const { values } = plainAnswersToFormValues(answers, loaded.policy);
    const graph = buildGraphFromForm(values, '2026-01-01T00:00:00Z', () => 'id');
    const r = evaluate(graph, loaded.policy, pk.packs);
    if (!r.ok) throw new Error('evaluate failed');
    expect(Object.keys(r.value.pack_versions).length).toBeGreaterThan(0);
    expect(r.value.provisional_reasons).not.toContain('no_regulatory_basis');
  });
});

// CR7-41 investigation: plain-intake.ts compares the typed model name exactly
// only to choose WHICH form field carries it (declaredModelId vs
// declaredModelIdOther). buildGraphFromForm maps both to the same
// declared_model_id, so a typed member of a listed family reaches the engine
// unchanged and the engine's own family resolution accepts it. Pinned so a
// future change cannot make the field choice matter.
describe('CR7-41 — a typed family member reaches the graph as typed', () => {
  it('TC-CR7-41c: a typed name the family would accept becomes declared_model_id exactly as typed', () => {
    const p = policy({
      approved_models: [
        { model_id: 'gpt-4o-*', vendor: 'V', provenance_class: 'vendor_hosted', is_approved: true, is_family: true, version_pattern: 'gpt-4o-' },
      ],
    });
    const { values } = plainAnswersToFormValues({ ...BASE, '3': 'outside-assistant', '3a': 'firm-account', '3model': 'gpt-4o-2024-08-06' }, p);
    const graph = buildGraphFromForm(values, '2026-01-01T00:00:00Z', () => 'id');
    expect(graph.processing_nodes[0]?.declared_model_id).toBe('gpt-4o-2024-08-06');
  });
});
