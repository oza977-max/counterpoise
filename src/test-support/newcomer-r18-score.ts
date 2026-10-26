// R18-G GI-11 scorer. Reads tester answer files (test/newcomer-r18/README.md),
// maps option text to PlainAnswers through the app's own optionKeyForText, and
// scores with the REAL engine on the same path as src/engine/try-these.test.ts.
import { evaluate } from '../engine/evaluate';
import { buildGraphFromForm } from '../engine/build-graph-from-form';
import { plainAnswersToFormValues } from '../engine/plain-intake';
import { TIER_ORDER } from '../engine/tier';
import { optionKeyForText } from '../components/plain-copy';
import type { PlainAnswers, QuestionId } from '../components/plain-copy';
import { WORKED_EXAMPLES } from '../engine/worked-examples';
import type { EvaluationResult, JurisdictionPack, PolicyFile } from '../engine/types';

export interface AnswerFile {
  packet: string;
  answers: Record<string, string | string[]>;
  prefills: { question: string; status: 'ticked' | 'changed'; changedTo?: string }[];
  didntUnderstand: { item: string; why: string }[];
  expectNext?: string;
  ticksMean?: string;
}

const STATUS_RANK = { approved: 0, approved_with_controls: 1, rejected: 2 } as const;
const norm = (t: string) => t.replace(/[‘’]/g, "'");
const TS = '2026-01-01T00:00:00.000Z';

/** True when verdict `a` is LESS strict than `correct` (README scoring method). */
export function lessStrict(a: EvaluationResult, correct: EvaluationResult): boolean {
  if (STATUS_RANK[a.status] !== STATUS_RANK[correct.status]) return STATUS_RANK[a.status] < STATUS_RANK[correct.status];
  if (TIER_ORDER[a.tier] !== TIER_ORDER[correct.tier]) return TIER_ORDER[a.tier] < TIER_ORDER[correct.tier];
  const mine = new Set(a.controls);
  return a.controls.length < correct.controls.length && correct.controls.length > 0 && [...mine].every((c) => correct.controls.includes(c)) && mine.size < new Set(correct.controls).size;
}

export function textToKey(id: QuestionId, text: string, policy: PolicyFile): string | undefined {
  if (id === '3') {
    const p = policy.platforms?.find((x) => norm(x.plain_name ?? '') === norm(text));
    if (p) return p.id;
  }
  if (id === '11') {
    const j = policy.jurisdictions?.find((x) => x.name === text);
    if (j) return j.code;
  }
  return optionKeyForText(id, text);
}

export function mapAnswers(file: AnswerFile, policy: PolicyFile): { answers: PlainAnswers; unmapped: string[] } {
  const out: Record<string, unknown> = {};
  const unmapped: string[] = [];
  for (const [id, v] of Object.entries(file.answers)) {
    if (id === '1' || id === '2' || id === '8other') { out[id] = v; continue; }
    const conv = (t: string) => {
      const k = textToKey(id as QuestionId, t, policy);
      if (k === undefined) unmapped.push(`${id}: ${t}`);
      return k;
    };
    out[id] = Array.isArray(v) ? v.map(conv).filter((k): k is string => k !== undefined) : conv(v);
  }
  return { answers: out as PlainAnswers, unmapped };
}

function run(answers: PlainAnswers, description: string, policy: PolicyFile, packs: JurisdictionPack[]): EvaluationResult {
  const { values } = plainAnswersToFormValues({ ...answers, '2': description }, policy);
  const r = evaluate(buildGraphFromForm(values, TS, () => 'newcomer-r18-id'), policy, packs);
  if (!r.ok) throw new Error(`engine error: ${JSON.stringify(r.error)}`);
  return r.value;
}

const same = (a: unknown, b: unknown) =>
  Array.isArray(a) || Array.isArray(b)
    ? JSON.stringify([...((a as string[]) ?? [])].sort()) === JSON.stringify([...((b as string[]) ?? [])].sort())
    : a === b;

export interface PacketScore {
  packet: string;
  exampleId: string;
  perQuestion: { question: string; correct: boolean; given: unknown; expected: unknown }[];
  wrong: { question: string; lessStrictAlone: boolean | 'engine-error' }[];
  verdict: { tester: string; expected: string; lessStrict: boolean; matches: boolean };
  counts: { didntUnderstand: number; lessStrictAnswers: number; prefillsTicked: number; prefillsChanged: number };
  unmapped: string[];
}

const label = (v: EvaluationResult) => `${v.status}/${v.tier}/${v.track}/[${v.controls.join(',')}]`;

export function scorePacket(
  file: AnswerFile,
  exampleId: string,
  policy: PolicyFile,
  packs: JurisdictionPack[],
): PacketScore {
  const ex = WORKED_EXAMPLES.find((e) => e.id === exampleId);
  if (!ex) throw new Error(`unknown example ${exampleId}`);
  const { answers, unmapped } = mapAnswers(file, policy);
  const correctAnswers = ex.answers as Record<string, unknown>;
  const given = answers as Record<string, unknown>;
  const correctVerdict = run(ex.answers, ex.description, policy, packs);
  const perQuestion = Object.keys(correctAnswers)
    .filter((q) => q !== '1')
    .map((q) => ({ question: q, correct: same(given[q], correctAnswers[q]), given: given[q] ?? null, expected: correctAnswers[q] }));
  const wrong = perQuestion
    .filter((p) => !p.correct)
    .map((p) => {
      try {
        const sub = { ...ex.answers, [p.question]: given[p.question] } as PlainAnswers;
        if (given[p.question] === undefined) delete (sub as Record<string, unknown>)[p.question];
        return { question: p.question, lessStrictAlone: lessStrict(run(sub, ex.description, policy, packs), correctVerdict) };
      } catch {
        return { question: p.question, lessStrictAlone: 'engine-error' as const };
      }
    });
  let testerVerdict = correctVerdict;
  try { testerVerdict = run({ ...answers, '2': ex.description } as PlainAnswers, ex.description, policy, packs); } catch { /* keep */ }
  const ls = lessStrict(testerVerdict, correctVerdict);
  return {
    packet: file.packet,
    exampleId,
    perQuestion,
    wrong,
    verdict: { tester: label(testerVerdict), expected: label(correctVerdict), lessStrict: ls, matches: label(testerVerdict) === label(correctVerdict) },
    counts: {
      didntUnderstand: file.didntUnderstand.length,
      lessStrictAnswers: wrong.filter((w) => w.lessStrictAlone === true).length,
      prefillsTicked: file.prefills.filter((p) => p.status === 'ticked').length,
      prefillsChanged: file.prefills.filter((p) => p.status === 'changed').length,
    },
    unmapped,
  };
}
