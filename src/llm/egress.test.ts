import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, join, sep } from 'node:path';
import { loadPolicy } from '../store/policy';
import { requestPrefill } from './prefill';
import { updateModelSetting } from './model-setting';
import { confirmSemanticDuplicate } from './duplicate-check';
import { generateReasoningTrace } from './reasoning-trace';
import type { VerdictTraceData } from './reasoning-trace';
import { installEgressHarness } from '../test-support/egress-harness';
import type { EgressHarness } from '../test-support/egress-harness';
import { createFakeModel } from './test-utils';
import { verifyPrefill } from '../engine/prefill-verify';
import { buildCatalogue, QUESTION_STRUCTURE } from '../engine/question-structure';
import { QUESTION_WORDS } from '../components/plain-copy';
import type { PolicyFile } from '../engine/types';

// R18-C1 deliverable 9: egress guards (specs/intake-flow.md §27.5, NF-3). The harness wraps fetch,
// XMLHttpRequest, sendBeacon, WebSocket, EventSource, image sources and window.open.
// Limits, stated plainly: the harness records the `Image().src` setter only (an <img> element set another way,
// or CSS/font loads, are not seen); NF-3-06 proves that the no-redirect option is PASSED, not that a browser
// honours it; NF-3-05's `./client` mock proves only which HOST the key-based calls reach; and NF-3-07's
// regex scan is best effort (a call built another way, e.g. through an alias, would not match).

// The Anthropic SDK captures the real `fetch` when it is imported, so stubbing the global alone would let
// a test call go to the real network (it did, once, with a fake key). The only change here: the client
// the key-based calls build is given a fetch that looks the global up at call time, so the harness sees it.
vi.mock('./client', async (importOriginal) => {
  const real = await importOriginal<typeof import('./client')>();
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return {
    ...real,
    createClient: (apiKey: string) =>
      new Anthropic({ apiKey, dangerouslyAllowBrowser: true, fetch: (...a: Parameters<typeof fetch>) => globalThis.fetch(...a) }),
  };
});

const LOCAL = 'http://localhost:11434';
const SRC = resolve(__dirname, '..');
let policy: PolicyFile;
beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(SRC, '../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  policy = r.policy;
});

let harness: EgressHarness | undefined;
beforeEach(() => localStorage.clear());
afterEach(() => {
  harness?.restore();
  harness = undefined;
});

function modelAnswering(behaviour: Parameters<typeof createFakeModel>[0]) {
  const model = createFakeModel(behaviour);
  harness = installEgressHarness((url, init) => model.fetch(url, init));
  return { model, harness };
}

async function read(description: string, over: { place?: 'this-computer' | 'firm-server'; url?: string } = {}) {
  const s = updateModelSetting({ place: over.place ?? 'this-computer', url: over.url ?? LOCAL, model: 'alpha:7b' });
  if (!s.ok) throw new Error('setting refused');
  const catalogue = buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy);
  return requestPrefill({
    description,
    catalogue,
    setting: s.setting,
    signal: new AbortController().signal,
    verify: (raw) => verifyPrefill(raw, catalogue, description, policy),
  });
}

/** Every 14-character window of the description: any part of it, however small. */
function parts(description: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 14 <= description.length; i += 7) out.push(description.slice(i, i + 14));
  return out;
}

describe('TC-R18-NF-3-01: only the declared address receives any part of the description', () => {
  const DESC =
    'It reads client names and account details. Our UK team uses it for internal ticket volumes. ZEBRA-4471 quarterly mandate summaries for the treasury desk.';
  it('a format-honouring server: exactly one request carries the description, to localhost:11434, and no other channel sees any part', async () => {
    const { model, harness: h } = modelAnswering({ kind: 'honours-format' });
    await read(DESC);
    const carriers = h.records.filter((r) => parts(DESC).some((p) => r.url.includes(p) || r.body.includes(p) || Object.values(r.headers).some((v) => v.includes(p))));
    expect(carriers).toHaveLength(1);
    expect(carriers[0]!.channel).toBe('fetch');
    expect(new URL(carriers[0]!.url).host).toBe('localhost:11434');
    expect(h.records.filter((r) => r.channel !== 'fetch')).toHaveLength(0);
    // Nothing in any address or header, anywhere.
    expect(h.records.every((r) => !parts(DESC).some((p) => r.url.includes(p)))).toBe(true);
    expect(model.requests).toHaveLength(1);
  });
  it('a format-ignoring server gets two requests, both to the same address', async () => {
    const { harness: h } = modelAnswering({ kind: 'ignores-format' });
    await read(DESC);
    const carriers = h.carrying('ZEBRA-4471');
    expect(carriers).toHaveLength(2);
    expect(new Set(carriers.map((r) => new URL(r.url).host))).toEqual(new Set(['localhost:11434']));
    expect(h.records).toHaveLength(2);
  });
  it('a firm server: every request goes to the firm host only', async () => {
    const { harness: h } = modelAnswering({ kind: 'ignores-format' });
    await read(DESC, { place: 'firm-server', url: 'https://ai.example-firm.test:8443' });
    expect(new Set(h.records.map((r) => new URL(r.url).host))).toEqual(new Set(['ai.example-firm.test:8443']));
  });
  it('with no key set the duplicate check and the explanation send nothing at all', async () => {
    const { harness: h } = modelAnswering({ kind: 'honours-format' });
    expect(await confirmSemanticDuplicate(DESC, 'another case')).toBe(false);
    expect(h.records).toHaveLength(0);
  });
});

// The ./client mock above only makes the SDK use the global fetch; this proves which HOST is contacted, nothing more.
describe('TC-R18-NF-3-05: the key-based calls are declared and covered (request part)', () => {
  const TRACE = { status: 'in_appetite', tier: 'Low', track: 'Standard', binding_constraint_id: 'x', binding_constraint_description: 'd', binding_path: 'p', tripped_invariants: [], track_rationale: null, tier_rationale: null, regulatory_chain: [], binding_reason: null, binding_regulatory_basis: null, controls_required: [], downstream_reviews: [], applied_overrides: [], confidence_caveats: [], policy_version: '1', pack_versions: {} } as unknown as VerdictTraceData;
  it('with aigate:api-key set, the duplicate check and the explanation call only the Anthropic address', async () => {
    localStorage.setItem('aigate:api-key', 'test-key-not-a-real-key');
    harness = installEgressHarness(async (url) => {
      const body = url.includes('/v1/messages')
        ? JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'text', text: 'A short trace.' }, { type: 'tool_use', id: 't', name: 'confirm_duplicate', input: { is_duplicate: false } }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
        : '{}';
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    await confirmSemanticDuplicate('A description about client names.', 'another case');
    const r = await generateReasoningTrace(TRACE, 'test-key-not-a-real-key');
    expect(r.ok).toBe(true);
    expect(harness.records.length).toBeGreaterThanOrEqual(2);
    expect(new Set(harness.records.map((r) => new URL(r.url).host))).toEqual(new Set(['api.anthropic.com']));
    expect(harness.records.every((r) => r.channel === 'fetch')).toBe(true);
  });
  it('with no key, nothing but the declared model address is contacted', async () => {
    const { harness: h } = modelAnswering({ kind: 'honours-format' });
    await confirmSemanticDuplicate('A description about client names.', 'another case');
    await read('Our UK team uses it for internal ticket volumes.');
    expect(new Set(h.records.map((r) => new URL(r.url).host))).toEqual(new Set(['localhost:11434']));
  });
});

// Proves the option is passed on the one request (redirect: 'error'); it cannot prove a browser enforces it.
describe('TC-R18-NF-3-06: a redirect cannot carry the description elsewhere', () => {
  it('a 307 to another host: no request reaches the other host, the options refuse redirects, and the failure is a plain outcome', async () => {
    const { harness: h } = modelAnswering({ kind: 'redirect', location: 'https://other.example/collect' });
    const out = await read('It reads client names and account details. Our UK team uses it.');
    expect(out.kind).toBe('none');
    expect(h.records.some((r) => r.url.includes('other.example'))).toBe(false);
    expect(h.records).toHaveLength(1);
    expect(h.records[0]!.options).toMatchObject({ redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    // C2 adds the on-screen assertion (the blank form and its sentence).
  });
});

// The image channel records the `.src` setter only.
describe('the harness itself sees every channel', () => {
  it('records fetch, XHR, beacon, WebSocket, EventSource, image src and window.open', () => {
    harness = installEgressHarness();
    void fetch('https://a.test/', { method: 'POST', body: 'f' }).catch(() => undefined);
    const x = new XMLHttpRequest();
    x.open('POST', 'https://b.test/');
    x.send('x');
    navigator.sendBeacon('https://c.test/', 'b');
    new WebSocket('wss://d.test/');
    new EventSource('https://e.test/');
    const img = new Image();
    img.src = 'https://f.test/p.gif';
    window.open('https://g.test/');
    expect(harness.records.map((r) => r.channel)).toEqual(['fetch', 'xhr', 'beacon', 'websocket', 'eventsource', 'image', 'open']);
  });
});

// ---- NF-3-07: only the listed files call out ----

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

// Best effort: a textual scan; it will not see a call reached through an alias or a dynamic import.
const CALLERS = /\bfetch\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bWebSocket\b|\bEventSource\b|\bcreateClient\b|from\s+['"]@anthropic-ai\/sdk['"]/;

/** The only production files that may reach the network (model-test.ts arrives with R18-F). */
const ALLOWED = [
  'llm/prefill.ts',
  'llm/model-setting.ts',
  'llm/model-test.ts',
  'llm/duplicate-check.ts',
  'llm/reasoning-trace.ts',
  'llm/client.ts',
];
/** Test support: may name the channels (to fake them) but must never be imported by production code. */
const TEST_SUPPORT = ['llm/test-utils.ts', 'llm/__fixtures__/server-replies.ts', 'test-support/egress-harness.ts'];

const isTestFile = (rel: string) => /\.test\.tsx?$/.test(rel) || rel.split(sep).includes('__tests__') || rel === 'test-setup.ts';

describe('TC-R18-NF-3-07: only the listed files call fetch', () => {
  const files = walk(SRC)
    .map((p) => relative(SRC, p).split(sep).join('/'))
    .filter((r) => /\.tsx?$/.test(r) && !isTestFile(r));

  it('the matches are only the listed model and key-call files', () => {
    const matches = files.filter((rel) => CALLERS.test(stripComments(readFileSync(resolve(SRC, rel), 'utf-8'))));
    const unexpected = matches.filter((m) => !ALLOWED.includes(m) && !TEST_SUPPORT.includes(m));
    expect(unexpected).toEqual([]);
    expect(matches).toContain('llm/prefill.ts');
  });

  it('a new file containing one does not pass (the scan detects each call form)', () => {
    for (const sample of ["await fetch('x')", 'new XMLHttpRequest()', 'navigator.sendBeacon(u)', 'new WebSocket(u)', 'new EventSource(u)', 'createClient(k)', "import A from '@anthropic-ai/sdk'"]) {
      expect(CALLERS.test(stripComments(sample))).toBe(true);
    }
    expect(CALLERS.test(stripComments('// fetch( is only named in a comment'))).toBe(false);
  });

  it('no production file imports the test support', () => {
    const offenders = files.filter((rel) => {
      if (TEST_SUPPORT.includes(rel)) return false;
      return /test-utils|egress-harness|__fixtures__/.test(stripComments(readFileSync(resolve(SRC, rel), 'utf-8')));
    });
    expect(offenders).toEqual([]);
  });

  it('the test support files exist (so the list cannot rot)', () => {
    for (const f of TEST_SUPPORT) expect(files).toContain(f);
  });
});
