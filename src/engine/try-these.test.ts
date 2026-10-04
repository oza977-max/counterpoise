import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../store/policy';
import { loadPacks } from '../store/packs';
import { evaluate } from './evaluate';
import { buildGraphFromForm } from './build-graph-from-form';
import { plainAnswersToFormValues } from './plain-intake';
import { optionKeyForText } from '../components/plain-copy';
import type { PlainAnswers, QuestionId } from '../components/plain-copy';
import type { StructuredFormValues } from './build-graph-from-form';
import type { JurisdictionPack, PolicyFile } from './types';

// Pins every outcome printed in `docs/try-these.md`.
//
// That page tells a reader what to expect from eleven specific cases. Without
// this, a policy edit would silently make the page wrong — and a document that
// confidently describes behaviour the product no longer has is exactly the
// drift that let `track_floor` survive four review rounds (FN-007).
//
// Same pattern as `backtest-predictions.test.ts`, which pins the committee
// back-test pack for the same reason.
//
// If a policy change fails one of these: decide whether the NEW behaviour is
// right. If it is, update the expectation AND the prose in try-these.md
// together. Never update one alone.

const dir = resolve(__dirname, '../../policy');
let policy: PolicyFile;
let packs: JurisdictionPack[];

beforeAll(() => {
  const res = loadPolicy(readFileSync(resolve(dir, 'appetite.yaml'), 'utf-8'));
  if (!res.valid) throw new Error(`policy invalid: ${JSON.stringify(res.errors)}`);
  policy = res.policy;
  packs = loadPacks({
    'ss1-23': readFileSync(resolve(dir, 'packs/ss1-23.yaml'), 'utf-8'),
    'sr-26-2': readFileSync(resolve(dir, 'packs/sr-26-2.yaml'), 'utf-8'),
    'eu-ai-act': readFileSync(resolve(dir, 'packs/eu-ai-act.yaml'), 'utf-8'),
    dora: readFileSync(resolve(dir, 'packs/dora.yaml'), 'utf-8'),
  }).packs;
});

const base = { useCaseName: 'x', description: 'x', replacesPriorModel: false } as const;

// B-15: buildGraphFromForm's timestamp is now a parameter — fixed here
// since extracted_at feeds no condition this file's outcomes depend on.
const TS = '2026-01-01T00:00:00.000Z';

function run(v: StructuredFormValues) {
  const r = evaluate(buildGraphFromForm(v, TS, () => crypto.randomUUID()), policy, packs);
  if (!r.ok) throw new Error(`engine error: ${JSON.stringify(r.error)}`);
  return r.value;
}

describe('docs/try-these.md — every printed outcome', () => {
  it('case 1: a clean internal dashboard is approved at Low with nothing attached [TC-PE-8-01]', () => {
    const v = run({ ...base, inputDataClass: 'Internal', inputDataZone: 'Zone C', modelType: 'statistical',
      autonomyLevel: 0, processingDataZone: 'Zone C', outputActionType: 'read', outputExposure: 'internal-only',
      decisionBindingness: 'non-binding', outputReversibility: 'reversible', outputScale: 'limited', jurisdictions: ['UK'] });
    expect(v.status).toBe('approved');
    expect(v.tier).toBe('Low');
    expect(v.controls).toHaveLength(0);
    expect(v.downstream_reviews).toHaveLength(0);
    expect(v.provisional_reasons).toHaveLength(0);
  });

  it('case 2: MNPI outside Zone C is rejected on HL-002 with NO controls proposed', () => {
    const v = run({ ...base, inputDataClass: 'MNPI', inputDataZone: 'Zone B', modelType: 'llm', autonomyLevel: 1,
      processingDataZone: 'Zone B', outputActionType: 'draft', outputExposure: 'internal-only',
      decisionBindingness: 'advisory', outputReversibility: 'reversible', outputScale: 'limited', jurisdictions: ['UK'] });
    expect(v.status).toBe('rejected');
    expect(v.binding_constraint).toBe('HL-002');
    // PE-4: hard lines are evaluated before control solving, so a rejection
    // never proposes mitigations. This is the assertion that would catch it.
    expect(v.controls).toHaveLength(0);
  });

  it('case 3: autonomous lending with no human is rejected on HL-003', () => {
    const v = run({ ...base, inputDataClass: 'Client PII', inputDataZone: 'Zone C', modelType: 'traditional-ml',
      autonomyLevel: 4, processingDataZone: 'Zone C', outputActionType: 'approve', outputExposure: 'client-facing',
      decisionBindingness: 'binding', outputReversibility: 'reversible', outputScale: 'at_scale',
      decisionType: 'credit-decision', hitl: false, jurisdictions: ['UK'] });
    expect(v.status).toBe('rejected');
    expect(v.binding_constraint).toBe('HL-003');
  });

  it('case 4: an agentic system with binding authority at L4 is rejected on HL-006', () => {
    const v = run({ ...base, inputDataClass: 'Internal', inputDataZone: 'Zone C', modelType: 'agentic',
      autonomyLevel: 4, processingDataZone: 'Zone C', outputActionType: 'execute', outputExposure: 'internal-shared',
      decisionBindingness: 'binding', outputReversibility: 'reversible', outputScale: 'at_scale', jurisdictions: ['UK'] });
    expect(v.status).toBe('rejected');
    expect(v.binding_constraint).toBe('HL-006');
  });

  it('case 5: two hard lines apply and the FIRST in rule order is the one named', () => {
    const irreversible: StructuredFormValues = { ...base, inputDataClass: 'Confidential', inputDataZone: 'Zone C',
      modelType: 'ml', autonomyLevel: 4, processingDataZone: 'Zone C', outputActionType: 'trade',
      outputExposure: 'market-facing', decisionBindingness: 'binding', outputReversibility: 'irreversible',
      outputScale: 'at_scale', decisionType: 'trading', jurisdictions: ['UK'] };
    // HL-001 (L4 + irreversible + market-facing) and HL-004 (autonomous
    // trading) both apply. The page tells the reader HL-001 is named.
    expect(run(irreversible).binding_constraint).toBe('HL-001');

    // …and that making it reversible leaves HL-004 as the named reason. The
    // page invites the reader to try exactly this, so it is pinned too.
    expect(run({ ...irreversible, outputReversibility: 'reversible' }).binding_constraint).toBe('HL-004');
  });

  it('case 6: a use case inside the platform envelope inherits its three controls [TC-PV-1-01] [TC-PV-8-01] [TC-PV-3-03]', () => {
    const v = run({ ...base, inputDataClass: 'Confidential', inputDataZone: 'Zone C', modelType: 'ml',
      autonomyLevel: 2, processingDataZone: 'Zone C', outputActionType: 'recommend', outputExposure: 'internal-shared',
      decisionBindingness: 'advisory', outputReversibility: 'reversible', outputScale: 'limited',
      platform: 'PLAT-INTERNAL-ML', jurisdictions: ['UK'] });
    expect(v.tier).toBe('Medium');
    expect(v.inheritance?.inherited_controls).toEqual(['CTRL-DRIFT-01', 'CTRL-ENC-01', 'CTRL-FINGERPRINT-01']);
    expect(v.controls).toHaveLength(0);
  });

  it('case 7: the same idea outside the envelope inherits nothing and costs 6 controls [TC-PV-8-01]', () => {
    const v = run({ ...base, inputDataClass: 'Client PII', inputDataZone: 'Zone B', modelType: 'llm',
      autonomyLevel: 1, processingDataZone: 'Zone B', outputActionType: 'draft', outputExposure: 'client-facing',
      decisionBindingness: 'advisory', outputReversibility: 'reversible', outputScale: 'at_scale',
      platform: 'PLAT-CLOUD-LLM', jurisdictions: ['UK'] });
    expect(v.tier).toBe('High');
    expect(v.inheritance?.inherited_controls ?? []).toHaveLength(0);
    // Policy v1.6 (2026-09-28) narrowed INV-DISCLOSE-01 / INV-ESCALATE-01 to
    // action types where clients deal with the AI directly; this case drafts
    // replies a person sends, so CTRL-DISCLOSE-01 and CTRL-ESCALATE-01 no
    // longer apply: 6 controls, not 8. docs/try-these.md says 6.
    expect(v.controls).toEqual(['CTRL-CITE-01', 'CTRL-CONDUCT-01', 'CTRL-ENC-01', 'CTRL-FINGERPRINT-01', 'CTRL-REDTEAM-01', 'CTRL-SYNTHMARK-01']);
  });

  it('case 8: hiring tiers High for the firm and is floored to Critical by the EU pack', () => {
    const eu: StructuredFormValues = { ...base, inputDataClass: 'Client PII', inputDataZone: 'Zone C',
      modelType: 'traditional-ml', autonomyLevel: 2, processingDataZone: 'Zone C', outputActionType: 'recommend',
      outputExposure: 'internal-shared', decisionBindingness: 'material', outputReversibility: 'reversible',
      outputScale: 'at_scale', decisionType: 'hiring', jurisdictions: ['EU'] };
    const v = run(eu);
    expect(v.tier).toBe('Critical');
    expect(v.provisional_reasons).toContain('unsigned_pack_rules');

    // The page invites the reader to re-run as UK-only and watch the tier
    // drop. If that stops happening the invitation is a lie.
    expect(run({ ...eu, jurisdictions: ['UK'] }).tier).toBe('High');
  });

  it('case 9: an unlisted decision type produces TWO provisional reasons, both named', () => {
    const v = run({ ...base, inputDataClass: 'Client PII', inputDataZone: 'Zone C', modelType: 'traditional-ml',
      autonomyLevel: 2, processingDataZone: 'Zone C', outputActionType: 'recommend', outputExposure: 'client-facing',
      decisionBindingness: 'material', outputReversibility: 'reversible', outputScale: 'at_scale',
      decisionTypeOther: 'collections prioritisation', jurisdictions: ['UK'] });
    expect(v.provisional_reasons).toEqual(['unsigned_pack_rules', 'unclassified_decision_type']);
    expect(v.unclassified_decision_types).toEqual(['collections prioritisation']);
  });

  it('case 10: the demo case — Critical, 7 controls, 2 reviews, bound by autonomy [TC-PE-3-01]', () => {
    const v = run({ ...base, inputDataClass: 'Client PII', inputDataZone: 'Zone C', modelType: 'traditional-ml',
      autonomyLevel: 3, processingDataZone: 'Zone C', outputActionType: 'approve', outputExposure: 'client-facing',
      decisionBindingness: 'binding', outputReversibility: 'reversible', outputScale: 'at_scale',
      decisionType: 'credit-decision', hitl: false, platform: 'PLAT-INTERNAL-ML', jurisdictions: ['UK', 'EU'] });
    expect(v.status).toBe('approved_with_controls');
    expect(v.tier).toBe('Critical');
    // changed by the track-order fix, 2026-09-28: traditional-ml at
    // autonomy 3 is TRACK-II-AUTONOMY ("autonomy >= 3 is Track II
    // regardless of model type"), which the policy file declares BEFORE
    // the general TRACK-I rule specifically so it wins here. evaluate()
    // previously sorted the tracks array by id before matching, which
    // alphabetised TRACK-I ahead of TRACK-II-AUTONOMY and silently
    // defeated that ordering — was 'I', correct value is 'II'.
    expect(v.track).toBe('II');
    expect(v.binding_constraint).toBe('INV-AUTONOMY-01');
    // v1.5: also trips INV-ACT-LOG-01 (approve + autonomy 3), adding
    // CTRL-LOG-01 — 6 -> 7. See docs/try-these.md's updated prose.
    expect(v.controls).toHaveLength(7);
    expect(v.downstream_reviews).toHaveLength(2);
    expect(v.provisional_reasons).toContain('unsigned_pack_rules');
  });
});

// CR9-15 (code review 009). Cases 7 and 10 above are driven by hand-built form values; the page's reader
// answers plain questions. These drive the page's OWN answers — label text, as printed — through the real
// path (plainAnswersToFormValues -> buildGraphFromForm -> evaluate), so a change to the mapping, an option
// label or the policy that would make the page wrong fails here. Each row is [question, key, page label];
// the label is checked against the app's option text so the page wording is pinned too.
type PageAnswer = [QuestionId, string | string[], string | string[]];

function labelFor(id: QuestionId, key: string): string | undefined {
  if (id === '3') return policy.platforms?.find((p) => p.id === key)?.plain_name;
  if (id === '11') return policy.jurisdictions?.find((j) => j.code === key)?.name;
  return undefined;
}

function runPage(rows: PageAnswer[]) {
  const answers: PlainAnswers = {};
  for (const [id, key, label] of rows) {
    const keys = Array.isArray(key) ? key : [key];
    const labels = Array.isArray(label) ? label : [label];
    expect(labels).toHaveLength(keys.length);
    keys.forEach((k, i) => {
      const dynamic = labelFor(id, k);
      if (dynamic !== undefined) expect(dynamic.replace(/\u2019/g, "'"), `Q${id} ${k}`).toBe(labels[i]!.replace(/\u2019/g, "'"));
      else expect(optionKeyForText(id, labels[i]!), `Q${id} "${labels[i]}"`).toBe(k);
    });
    answers[id] = key;
  }
  const { values } = plainAnswersToFormValues({ '1': 'x', '2': 'x', ...answers }, policy);
  return run(values);
}

describe('try-these cases driven from the page\u2019s plain answers (CR9-15)', () => {
  it('TC-CR9-15a: case 7 — High, nothing inherited, exactly 6 controls, both downstream reviews', () => {
    const v = runPage([
      ['3', 'PLAT-CLOUD-LLM', 'Your firm\u2019s cloud AI assistant'],
      ['4', 'language', 'Reads, summarises, translates, writes or answers questions in words'],
      ['5', ['people'], ['Information about people \u2014 clients, applicants, staff or anyone else: names, contact details, account and financial details, CVs \u2014 anything about someone who can be identified']],
      ['6', 'drafts', 'creates a draft \u2014 text, an image or code \u2014 and a person checks it before it\u2019s used'],
      ['6a', 'one-input', 'It\u2019s one input among several when someone makes a decision'],
      ['7', 'clients', 'Clients or customers \u2014 including people applying to us'],
      ['8', 'operational', 'None of these \u2014 it\u2019s for day-to-day work'],
      ['9', 'yes', 'Yes'],
      ['10', 'wide', 'Several teams, the whole business, or every case of a kind (e.g. all applications)'],
      ['11', ['UK'], ['United Kingdom']],
    ]);
    expect(v.status).toBe('approved_with_controls');
    expect(v.tier).toBe('High');
    expect(v.track).toBe('II');
    expect(v.inheritance?.inherited_controls ?? []).toHaveLength(0);
    expect(v.controls).toEqual(['CTRL-CITE-01', 'CTRL-CONDUCT-01', 'CTRL-ENC-01', 'CTRL-FINGERPRINT-01', 'CTRL-REDTEAM-01', 'CTRL-SYNTHMARK-01']);
    expect(v.downstream_reviews).toHaveLength(2);
    expect(v.downstream_reviews.join(' | ')).toMatch(/information security review/i);
    expect(v.downstream_reviews.join(' | ')).toMatch(/vendor risk assessment/i);
  });

  it('TC-CR9-15b: case 10 — Critical, Track II, bound by autonomy, 7 controls, both downstream reviews, provisional', () => {
    const v = runPage([
      ['3', 'PLAT-INTERNAL-ML', 'Your firm\u2019s in-house model platform'],
      ['3platformZone', 'firm-systems', 'Yes \u2014 the platform runs the AI on the firm\u2019s own systems'],
      ['4', 'score', 'Gives a score, ranking, flag, category or forecast \u2014 e.g. a credit score, a fraud alert, a ranking of CVs, the likely cause of a problem'],
      ['4a', 'explainable', 'Yes \u2014 they can show which factors drove each result'],
      ['5', ['people'], ['Information about people \u2014 clients, applicants, staff or anyone else: names, contact details, account and financial details, CVs \u2014 anything about someone who can be identified']],
      ['6', 'acts-bounded', 'acts by itself within limits someone set, with no routine review'],
      ['6b', 'yes-no-decision', 'Makes a yes-or-no decision \u2014 e.g. accepts or declines an application, signs something off'],
      ['7', 'clients', 'Clients or customers \u2014 including people applying to us'],
      ['8', 'credit', 'Whether to lend to someone, or on what terms'],
      ['9', 'yes', 'Yes'],
      ['10', 'wide', 'Several teams, the whole business, or every case of a kind (e.g. all applications)'],
      ['11', ['UK', 'EU'], ['United Kingdom', 'European Union']],
    ]);
    expect(v.status).toBe('approved_with_controls');
    expect(v.tier).toBe('Critical');
    expect(v.track).toBe('II');
    expect(v.binding_constraint).toBe('INV-AUTONOMY-01');
    expect(v.controls).toHaveLength(7);
    expect(v.downstream_reviews).toHaveLength(2);
    expect(v.provisional_reasons).toContain('unsigned_pack_rules');
  });
});
