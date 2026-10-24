import casesRaw from '../../backtest/cases.json?raw';
import verdictsRaw from '../../backtest/engine-verdicts.json?raw';
import { requestPrefill } from './prefill';
import { CORPUS_CASE_COUNT, originOf } from './model-setting';
import type { ModelSetting } from './model-setting';
import { verifyPrefill } from '../engine/prefill-verify';
import { corpusGraph, scoreCase, tallyScores } from '../engine/question-fields';
import type { CaseScore, CorpusGraph, ExpectedVerdict } from '../engine/question-fields';
import type { DropReason, ModelTestResult, PrefillCatalogue } from '../engine/prefill-types';
import type { JurisdictionPack, PolicyFile } from '../engine/types';

// R18-F (specs/intake-flow.md §27.11, ADR-IF-R18-7). The in-app test: the chosen model reads each of the 31
// public worked cases and the fills are scored against the case's known correct answers.
//
// It calls the SAME requestPrefill and the SAME verifier (verifyPrefill, built the way IntakeFlow builds it) as
// a real pre-check - there is no second call path - so the only text that ever leaves is a corpus case's prose,
// to the declared model address, through that one function. The scorer is src/engine/question-fields.ts (pure).
// This file reads no clock: the 60-second budget, the stop signal and the date are supplied by the component.

/** The corpus as the project's own bytes: backtest/cases.json, bundled with `?raw` and parsed here (MS-8). */
export const CORPUS_RAW: string = casesRaw;
/** The engine's recorded verdict for every corpus case: backtest/engine-verdicts.json, bundled the same way. */
export const VERDICTS_RAW: string = verdictsRaw;

export interface CorpusCase {
  id: string;
  title: string;
  prose: string;
  graph: CorpusGraph;
}

export interface Corpus {
  cases: CorpusCase[];
  expected: Record<string, ExpectedVerdict>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parses the bundled corpus. Null when the bundled files are not the shape this test relies on (nothing is guessed). */
export function loadCorpus(rawCases: string = CORPUS_RAW, rawVerdicts: string = VERDICTS_RAW): Corpus | null {
  try {
    const parsedCases: unknown = JSON.parse(rawCases);
    const parsedVerdicts: unknown = JSON.parse(rawVerdicts);
    if (!isRecord(parsedCases) || !Array.isArray(parsedCases.cases)) return null;
    if (!isRecord(parsedVerdicts) || !isRecord(parsedVerdicts.verdicts)) return null;
    const cases: CorpusCase[] = [];
    const expected: Record<string, ExpectedVerdict> = {};
    for (const c of parsedCases.cases as unknown[]) {
      if (!isRecord(c) || typeof c.id !== 'string' || typeof c.prose !== 'string' || !isRecord(c.graph)) return null;
      const verdict = (parsedVerdicts.verdicts as Record<string, unknown>)[c.id];
      if (!isRecord(verdict) || typeof verdict.status !== 'string' || typeof verdict.tier !== 'string') return null;
      cases.push({ id: c.id, title: typeof c.title === 'string' ? c.title : c.id, prose: c.prose, graph: c.graph as unknown as CorpusGraph });
      expected[c.id] = { status: verdict.status, tier: verdict.tier };
    }
    return { cases, expected };
  } catch {
    return null;
  }
}

/** One case's time allowance, made by the component: a signal that aborts at the limit or when the run is stopped. */
export interface CaseBudget {
  signal: AbortSignal;
  /** Clears the timer. Called when the case ends, however it ends. */
  release: () => void;
}

export interface RunModelTestArgs {
  /** The saved setting, read once by the caller when the person pressed the button. */
  setting: ModelSetting;
  corpus: Corpus;
  catalogue: PrefillCatalogue;
  policy: PolicyFile;
  packs: JurisdictionPack[];
  /** Aborted when the person presses Stop (or leaves, or the setting changes). */
  stop: AbortSignal;
  /** Supplied by the component: the 60 seconds per case, as a timer it owns. */
  caseBudget: (stop: AbortSignal) => CaseBudget;
  /** The date written into the result (the component takes it; this file reads no clock). */
  date: string;
  /** Called as each case starts: n is 1-based. */
  onProgress?: (n: number, total: number) => void;
}

/**
 * Runs the test and returns the result record. A case that does not finish because the run was stopped is not
 * counted and not scored; a case with no usable answer within its budget is counted, scores every scored
 * question blank and its verdict as not reached.
 */
export async function runModelTest(args: RunModelTestArgs): Promise<ModelTestResult> {
  const { corpus, catalogue, policy, packs, stop } = args;
  const host = originOf(args.setting.url) ?? '';
  const scores: CaseScore[] = [];
  const discarded: Record<string, number> = {};
  let live: ModelSetting = args.setting;
  let stopped = false;

  for (const [index, c] of corpus.cases.entries()) {
    if (stop.aborted) {
      stopped = true;
      break;
    }
    args.onProgress?.(index + 1, corpus.cases.length);
    const budget = args.caseBudget(stop);
    let outcome;
    try {
      outcome = await requestPrefill({
        description: c.prose,
        catalogue,
        setting: live,
        signal: budget.signal,
        verify: (raw) => verifyPrefill(raw, catalogue, c.prose, policy),
      });
    } finally {
      budget.release();
    }
    if (stop.aborted) {
      stopped = true;
      break;
    }
    const expected = corpus.expected[c.id];
    if (!expected) throw new Error(`no recorded verdict for corpus case ${c.id}`);
    const gold = corpusGraph(c.id, c.graph);
    if (outcome.kind === 'ok') {
      // The mode that worked is carried to the next case in this run only; nothing is written to the saved setting.
      live = { ...live, mode: outcome.modeUsed };
      for (const [reason, n] of Object.entries(outcome.dropped) as [DropReason, number][]) {
        if (n > 0) discarded[reason] = (discarded[reason] ?? 0) + n;
      }
      scores.push(scoreCase({ gold, prefill: outcome.prefill, expected, policy, packs }));
    } else {
      scores.push(scoreCase({ gold, prefill: null, expected, policy, packs }));
    }
  }

  const tally = tallyScores(scores);
  return {
    model: args.setting.model,
    place: args.setting.place,
    host,
    date: args.date,
    casesRun: scores.length,
    stopped,
    verdictMatches: tally.verdictMatches,
    noAnswer: tally.noAnswer,
    discarded: Object.fromEntries(Object.entries(discarded).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    perQuestion: tally.perQuestion,
  };
}

export { CORPUS_CASE_COUNT };
