import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../store/policy';
import { loadPacks } from '../store/packs';
import { findOption } from '../components/plain-copy';
import type { QuestionId } from '../components/plain-copy';
import { WORKED_EXAMPLES } from '../engine/worked-examples';
import type { JurisdictionPack, PolicyFile } from '../engine/types';
import { scorePacket } from './newcomer-r18-score';
import type { AnswerFile } from './newcomer-r18-score';

// R18-G GI-11. Runs the scorer over test/newcomer-r18/answers/*.json and writes results.json.
// Run: npm test -- src/test-support/newcomer-r18-score.test.ts
const root = resolve(__dirname, '../..');
const dir = resolve(root, 'test/newcomer-r18');
const ansDir = resolve(dir, 'answers');
const files = existsSync(ansDir) ? readdirSync(ansDir).filter((f) => /^P\d+\.json$/.test(f)).sort() : [];
let policy: PolicyFile;
let packs: JurisdictionPack[];
beforeAll(() => {
  const res = loadPolicy(readFileSync(resolve(root, 'policy/appetite.yaml'), 'utf-8'));
  if (!res.valid) throw new Error('policy invalid');
  policy = res.policy;
  const p = (n: string) => readFileSync(resolve(root, `policy/packs/${n}.yaml`), 'utf-8');
  packs = loadPacks({ 'ss1-23': p('ss1-23'), 'sr-26-2': p('sr-26-2'), 'eu-ai-act': p('eu-ai-act'), dora: p('dora') }).packs;
});

// Builds an answer file in the tester's shape from an example's own correct answers (used by the proof tests).
function fromExample(packet: string, exampleId: string, override: Record<string, string> = {}): AnswerFile {
  const ex = WORKED_EXAMPLES.find((e) => e.id === exampleId)!;
  const answers: Record<string, string | string[]> = {};
  for (const [q, v] of Object.entries(ex.answers as Record<string, unknown>)) {
    if (q === '1' || q === '8other') { answers[q] = v as string; continue; }
    const text = (k: string) =>
      q === '3' && k.startsWith('PLAT-') ? policy.platforms!.find((x) => x.id === k)!.plain_name! :
      q === '11' ? policy.jurisdictions!.find((x) => x.code === k)!.name :
      findOption(q as QuestionId, k)!.text;
    answers[q] = Array.isArray(v) ? v.map(text) : text(v as string);
  }
  for (const [q, k] of Object.entries(override)) answers[q] = findOption(q as QuestionId, k)!.text;
  return { packet, answers, prefills: [{ question: '6', status: 'ticked' }], didntUnderstand: [] };
}

describe('newcomer-r18 scorer: proof it works [R18-G GI-11]', () => {
  it('all-correct answers (P1) score 0 less-strict and the expected verdict', () => {
    const s = scorePacket(fromExample('P1', 'case-1'), 'case-1', policy, packs);
    expect(s.unmapped).toEqual([]);
    expect(s.wrong).toEqual([]);
    expect(s.counts.lessStrictAnswers).toBe(0);
    expect(s.verdict.matches).toBe(true);
    expect(s.verdict.lessStrict).toBe(false);
  });
  it('a human-review answer on the autonomous-lending case (P2) IS caught as less strict', () => {
    const s = scorePacket(fromExample('P2', 'case-3', { '6': 'prepares' }), 'case-3', policy, packs);
    expect(s.wrong.map((w) => w.question)).toEqual(['6']);
    expect(s.wrong[0]!.lessStrictAlone).toBe(true);
    expect(s.counts.lessStrictAnswers).toBe(1);
    expect(s.verdict.lessStrict).toBe(true);
  });
});

const packetExample = (): Record<string, { exampleId: string }> => JSON.parse(readFileSync(resolve(dir, 'packet-meta.json'), 'utf-8'));

describe.skipIf(files.length === 0)('newcomer-r18 results over answers/*.json', () => {
  it('scores every answer file and writes results.json', () => {
    const meta = packetExample();
    const results = files.map((f) => {
      const file = JSON.parse(readFileSync(resolve(ansDir, f), 'utf-8')) as AnswerFile;
      return scorePacket(file, meta[file.packet]!.exampleId, policy, packs);
    });
    const totals = {
      didntUnderstand: results.reduce((n, r) => n + r.counts.didntUnderstand, 0),
      lessStrictAnswers: results.reduce((n, r) => n + r.counts.lessStrictAnswers, 0),
      prefillsTicked: results.reduce((n, r) => n + r.counts.prefillsTicked, 0),
      prefillsChanged: results.reduce((n, r) => n + r.counts.prefillsChanged, 0),
      verdictsLessStrict: results.filter((r) => r.verdict.lessStrict).length,
    };
    writeFileSync(resolve(dir, 'results.json'), JSON.stringify({ totals, results }, null, 2) + '\n');
    expect(results.length).toBe(files.length);
  });
});
