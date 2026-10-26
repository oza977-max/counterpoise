import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { loadPolicy } from '../store/policy';
import { loadPacks } from '../store/packs';
import { getPackSources } from '../store/pack-source';
import * as prefillModule from './prefill';
import { CORPUS_RAW, VERDICTS_RAW, loadCorpus, runModelTest } from './model-test';
import type { Corpus, RunModelTestArgs } from './model-test';
import { CORPUS_CASE_COUNT } from './model-setting';
import type { ModelSetting } from './model-setting';
import { createFakeModel } from './test-utils';
import type { FakeBehaviour, RecordedRequest } from './test-utils';
import { installEgressHarness } from '../test-support/egress-harness';
import { startCaseBudget } from '../components/model-test-budget';
import { QUESTION_WORDS } from '../components/plain-copy';
import { buildCatalogue, QUESTION_STRUCTURE } from '../engine/question-structure';
import type { JurisdictionPack, PolicyFile } from '../engine/types';

// R18-F (specs/intake-flow.md §27.11). The runner: the same requestPrefill and verifier as a real pre-check,
// only corpus text out, 60 seconds a case on a fake clock, Stop, and the bundled corpus byte-identical to
// the project's file. The scoring itself is tested in src/engine/question-fields.test.ts.

// Spy on the very function the description screen uses, keeping its behaviour.
vi.mock('./prefill', async (importOriginal) => {
  const real = await importOriginal<typeof import('./prefill')>();
  return { ...real, requestPrefill: vi.fn(real.requestPrefill) };
});

const ROOT = resolve(__dirname, '../..');
const LOCAL = 'http://localhost:11434';
const SETTING: ModelSetting = { version: 1, place: 'this-computer', url: LOCAL, model: 'alpha:7b' };

let policy: PolicyFile;
let packs: JurisdictionPack[];
let corpus: Corpus;

beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(ROOT, 'policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  policy = r.policy;
  const p = loadPacks(getPackSources());
  if (p.errors.length > 0) throw new Error('pack errors');
  packs = p.packs;
  const c = loadCorpus();
  if (!c) throw new Error('corpus did not load');
  corpus = c;
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(prefillModule.requestPrefill).mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function userContent(request: RecordedRequest): string {
  const messages = (request.json?.messages ?? []) as { role: string; content: string }[];
  return messages.find((m) => m.role === 'user')?.content ?? '';
}

/** A model that answers each corpus case's replaces-something question with the case's own known answer. */
function knowsQuestion12(request: RecordedRequest): FakeBehaviour {
  const content = userContent(request);
  const c = corpus.cases.find((x) => content.includes(x.prose));
  if (!c) throw new Error('a request that is not a corpus case');
  const gold = (c.graph.processing as { replaces_prior_model: boolean }).replaces_prior_model;
  const quote = c.prose.split(' ').slice(0, 3).join(' ');
  return { kind: 'honours-format', reply: JSON.stringify({ answers: [{ question: '12', values: [{ option: gold ? 'yes' : 'no', quote }] }] }) };
}

function args(over: Partial<RunModelTestArgs> = {}): RunModelTestArgs {
  return {
    setting: SETTING,
    corpus,
    catalogue: buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy),
    policy,
    packs,
    stop: new AbortController().signal,
    caseBudget: startCaseBudget,
    date: '2026-10-24',
    ...over,
  };
}

describe('the bundled corpus (TC-R18-MS-8-01, -03)', () => {
  it('TC-R18-MS-8-01: the bundled cases are the project\'s own file, byte for byte, and hold exactly 31 cases', () => {
    expect(CORPUS_RAW).toBe(readFileSync(resolve(ROOT, 'backtest/cases.json'), 'utf-8'));
    expect(VERDICTS_RAW).toBe(readFileSync(resolve(ROOT, 'backtest/engine-verdicts.json'), 'utf-8'));
    expect(corpus.cases).toHaveLength(31);
    expect(corpus.cases).toHaveLength(CORPUS_CASE_COUNT);
    // no case that is not in the file
    const ids = (JSON.parse(readFileSync(resolve(ROOT, 'backtest/cases.json'), 'utf-8')).cases as { id: string }[]).map((c) => c.id);
    expect(corpus.cases.map((c) => c.id)).toEqual(ids);
    for (const c of corpus.cases) expect(corpus.expected[c.id], c.id).toBeDefined();
  });

  it('a corpus that is not the expected shape does not load (nothing is guessed)', () => {
    expect(loadCorpus('not json', VERDICTS_RAW)).toBeNull();
    expect(loadCorpus('{"cases": [{"id": "X"}]}', VERDICTS_RAW)).toBeNull();
    expect(loadCorpus(CORPUS_RAW, '{"verdicts": {}}')).toBeNull();
  });
});

describe('running the test (TC-R18-MS-4-01, -06, GI-12-04)', () => {
  it('31 cases, progress 1..31, counts that add up, a result naming the model, place and host', async () => {
    const fake = createFakeModel({ kind: 'custom', handle: (r) => knowsQuestion12(r) });
    vi.stubGlobal('fetch', fake.fetch);
    const seen: number[] = [];
    const result = await runModelTest(args({ onProgress: (n, total) => seen.push(total === 31 ? n : -1) }));
    expect(seen).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(result).toMatchObject({
      model: 'alpha:7b',
      place: 'this-computer',
      host: LOCAL,
      date: '2026-10-24',
      casesRun: 31,
      stopped: false,
      verdictMatches: 31,
      noAnswer: 0,
      discarded: {},
    });
    const q12 = result.perQuestion['12']!;
    expect(q12.wrong).toBe(0);
    expect(q12.blank).toBe(0);
    expect(q12.right).toBeGreaterThan(0);
    for (const [q, c] of Object.entries(result.perQuestion)) {
      expect(c.right + c.blank + c.wrong, q).toBeLessThanOrEqual(31);
    }
    expect(fake.requests).toHaveLength(31);
  });

  it('TC-R18-MS-4-06: the same requestPrefill the description screen uses is called once per case, and the screen\'s reading hook imports it from the same module', () => {
    // (the calls are counted in the next test; this one pins that there is one call path to the model)
    const hook = readFileSync(resolve(ROOT, 'src/components/useReadingAttempt.ts'), 'utf-8');
    const runner = readFileSync(resolve(ROOT, 'src/llm/model-test.ts'), 'utf-8');
    expect(hook).toMatch(/import \{[^}]*\brequestPrefill\b[^}]*\} from '\.\.\/llm\/prefill'/);
    expect(runner).toMatch(/import \{ requestPrefill \} from '\.\/prefill'/);
    expect(runner).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|new WebSocket|new EventSource/);
  });

  it('TC-R18-MS-4-06 / GI-12-04: 31 calls to requestPrefill; every request goes to the configured place and carries only one corpus case', async () => {
    const fake = createFakeModel({ kind: 'custom', handle: (r) => knowsQuestion12(r) });
    const harness = installEgressHarness((input, init) => fake.fetch(input, init));
    try {
      // a description the person typed and did not send must not be anywhere in a request
      const unsent = 'Secret plan for Project Falcon.';
      await runModelTest(args());
      expect(vi.mocked(prefillModule.requestPrefill)).toHaveBeenCalledTimes(31);
      expect(harness.records).toHaveLength(31);
      expect(new Set(harness.records.map((r) => r.channel))).toEqual(new Set(['fetch']));
      expect(new Set(harness.records.map((r) => r.url))).toEqual(new Set([`${LOCAL}/api/chat`]));
      for (const r of harness.records) {
        const content = userContent({ json: JSON.parse(r.body) } as RecordedRequest);
        const matching = corpus.cases.filter((c) => content.includes(c.prose));
        expect(matching, 'each request carries exactly one corpus case').toHaveLength(1);
        // after the case text there is nothing but the delimiter line
        expect(content.replace(matching[0]!.prose, '')).toMatch(/^\/no_think\n<<<DATA-[0-9A-F]+>>>\n\n<<<DATA-[0-9A-F]+>>>$/);
        expect(r.body).not.toContain('Falcon');
      }
      expect(harness.carrying(unsent)).toEqual([]);
    } finally {
      harness.restore();
    }
  });

  it('the same replies give a byte-identical result (determinism)', async () => {
    const run = async () => {
      vi.stubGlobal('fetch', createFakeModel({ kind: 'custom', handle: (r) => knowsQuestion12(r) }).fetch);
      return JSON.stringify(await runModelTest(args()));
    };
    expect(await run()).toBe(await run());
  });

  it('counts the fills the verifier dropped, by reason, across the run (TC-R18-MS-4-09)', async () => {
    // Every reply holds one real fill and one made-up option; the verifier drops the made-up one.
    const handle = (r: RecordedRequest): FakeBehaviour => {
      const base = knowsQuestion12(r);
      if (base.kind !== 'honours-format') throw new Error('unexpected');
      const parsed = JSON.parse(base.reply!) as { answers: { question: string; values: unknown[] }[] };
      parsed.answers.push({ question: '9', values: [{ option: 'not-an-option', quote: 'x y' }] });
      return { kind: 'honours-format', reply: JSON.stringify(parsed) };
    };
    vi.stubGlobal('fetch', createFakeModel({ kind: 'custom', handle }).fetch);
    const result = await runModelTest(args());
    expect(result.discarded).toEqual({ 'unknown-option': 31 });
  });

  it('a case whose reply cannot be used counts as no answer and scores its questions blank, not wrong', async () => {
    vi.stubGlobal('fetch', createFakeModel({ kind: 'content', content: 'not json at all' }).fetch);
    const result = await runModelTest(args());
    expect(result).toMatchObject({ casesRun: 31, stopped: false, verdictMatches: 0, noAnswer: 31 });
    for (const c of Object.values(result.perQuestion)) {
      expect(c.right).toBe(0);
      expect(c.wrong).toBe(0);
    }
    expect(result.perQuestion['12']!.blank).toBeGreaterThan(0);
  });
});

describe('60 seconds a case, on a fake clock (TC-R18-MS-4-03, NF-1-04)', () => {
  it('TC-R18-MS-4-03 / TC-R18-NF-1-04: a case answered at 59 s is scored; one answered at 61 s is "no answer" and counted blank', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const two: Corpus = { cases: corpus.cases.slice(0, 2), expected: corpus.expected };
    const fake = createFakeModel({
      kind: 'custom',
      handle: (r, i) => ({ kind: 'slow', ms: i === 0 ? 59_000 : 61_000, then: knowsQuestion12(r) }),
    });
    vi.stubGlobal('fetch', fake.fetch);
    const run = runModelTest(args({ corpus: two }));
    await vi.advanceTimersByTimeAsync(59_000); // case 1 answers
    await vi.advanceTimersByTimeAsync(60_000); // case 2 reaches its 60 s limit first
    const result = await run;
    expect(result.casesRun).toBe(2);
    expect(result.stopped).toBe(false);
    expect(result.noAnswer).toBe(1);
    expect(result.perQuestion['12']).toEqual({ right: 1, blank: 1, wrong: 0 });
    expect(result.verdictMatches).toBe(1);
    // the slow reply of case 2 arrives after the limit and changes nothing
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.requests).toHaveLength(2);
  });

  it('the limit is exactly 60 seconds: a reply at 59.9 s counts, one at 60 s does not', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const one: Corpus = { cases: corpus.cases.slice(0, 1), expected: corpus.expected };
    vi.stubGlobal('fetch', createFakeModel({ kind: 'custom', handle: (r) => ({ kind: 'slow', ms: 59_900, then: knowsQuestion12(r) }) }).fetch);
    const early = runModelTest(args({ corpus: one }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await early).noAnswer).toBe(0);
    vi.stubGlobal('fetch', createFakeModel({ kind: 'custom', handle: (r) => ({ kind: 'slow', ms: 60_001, then: knowsQuestion12(r) }) }).fetch);
    const late = runModelTest(args({ corpus: one }));
    await vi.advanceTimersByTimeAsync(60_001);
    expect((await late).noAnswer).toBe(1);
  });
});

describe('Stop (TC-R18-MS-4-02, NF-1-05)', () => {
  it('TC-R18-MS-4-02: stopped after 12 cases reports 12 cases and "stopped", and no further request is made', async () => {
    const stop = new AbortController();
    const fake = createFakeModel({
      kind: 'custom',
      handle: (r, i) => (i >= 12 ? { kind: 'never' } : knowsQuestion12(r)),
    });
    vi.stubGlobal('fetch', fake.fetch);
    const run = runModelTest(args({ stop: stop.signal, onProgress: (n) => n === 13 && queueMicrotask(() => stop.abort('skip')) }));
    const result = await run;
    expect(result).toMatchObject({ casesRun: 12, stopped: true, verdictMatches: 12 });
    expect(fake.requests).toHaveLength(13); // the 13th was in flight when Stop was pressed
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.requests).toHaveLength(13); // and nothing was sent after it
  });

  it('TC-R18-NF-1-05: Stop while a case waits (40 s in) scores nothing for that case', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const stop = new AbortController();
    vi.stubGlobal('fetch', createFakeModel({ kind: 'never' }).fetch);
    const run = runModelTest(args({ stop: stop.signal }));
    await vi.advanceTimersByTimeAsync(40_000);
    stop.abort('skip');
    const result = await run;
    expect(result).toMatchObject({ casesRun: 0, stopped: true, verdictMatches: 0, noAnswer: 0, perQuestion: {} });
  });

  it('a run stopped before it starts sends nothing', async () => {
    const stop = new AbortController();
    stop.abort('skip');
    const fake = createFakeModel({ kind: 'content', content: '{}' });
    vi.stubGlobal('fetch', fake.fetch);
    const result = await runModelTest(args({ stop: stop.signal }));
    expect(result).toMatchObject({ casesRun: 0, stopped: true });
    expect(fake.requests).toHaveLength(0);
  });
});

describe('the one call path (TC-R18-MS-4-06): nothing but requestPrefill talks to the model', () => {
  it('no production file other than the listed ones under src/llm calls fetch (the egress scan still passes with model-test.ts added)', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const full = join(d, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(full);
      }
    };
    walk(resolve(ROOT, 'src/llm'));
    const callers = files.filter((f) => /\bfetch\s*\(/.test(readFileSync(f, 'utf-8'))).map((f) => f.slice(ROOT.length + 1));
    expect(callers).not.toContain('src/llm/model-test.ts');
  });
});
