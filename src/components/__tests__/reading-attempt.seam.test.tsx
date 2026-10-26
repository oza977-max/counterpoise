import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../../store/policy';
import { useReadingAttempt } from '../useReadingAttempt';
import { requestPrefill } from '../../llm/prefill';
import { updateModelSetting, readModelSetting } from '../../llm/model-setting';
import type { ModelSetting } from '../../llm/model-setting';
import { verifyPrefill } from '../../engine/prefill-verify';
import { buildCatalogue, QUESTION_STRUCTURE } from '../../engine/question-structure';
import { QUESTION_WORDS } from '../plain-copy';
import type { PolicyFile } from '../../engine/types';

// R18-C1 outside-in seam test (build/prompts/R18-C1.md, TDD-1). From a real description and a real
// catalogue, through the real reading attempt (useReadingAttempt -> requestPrefill -> verifyPrefill),
// to a verified Prefill — with a fake model standing in for the server. Written FIRST and committed
// Red; the units are then built from its failures. The fake is a minimal inline one here; the
// reusable version lives in src/llm/test-utils.ts.
//
// Planned API this test pins:
//   useReadingAttempt() -> { reading, outcome, startReading(input), skip(), release() }
//   startReading({ description, setting, catalogue, verify })
//   requestPrefill({ description, catalogue, setting, signal, verify }) -> Promise<PrefillOutcome>
//   verifyPrefill(raw, catalogue, description, policy) -> { prefill, dropped }
//   buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy) -> PrefillCatalogue (a Map)

const ADDRESS = 'http://localhost:11434';
const DESCRIPTION = 'Our UK team will use it to summarise internal ticket volumes.';
const REPLY = {
  answers: [
    { question: '11', values: [{ option: 'UK', quote: 'Our UK team' }] },
    { question: '5', values: [{ option: 'everyday', quote: 'internal ticket volumes' }] },
  ],
};

interface Seen {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

let policy: PolicyFile;
beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  policy = r.policy;
});

function fakeModel(behaviour: 'honours-format' | 'ignores-format') {
  const seen: Seen[] = [];
  const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    seen.push({ url: String(url), method: init?.method ?? 'GET', body });
    const json = (message: unknown) =>
      new Response(JSON.stringify({ message, done: true, done_reason: 'stop' }), { status: 200 });
    if (body.format !== undefined && behaviour === 'honours-format') {
      return json({ role: 'assistant', content: JSON.stringify(REPLY) });
    }
    if (body.format !== undefined) {
      return json({ role: 'assistant', content: 'Sure, here is what I found in your description.' });
    }
    return json({
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: 'fill_form', arguments: REPLY } }],
    });
  });
  vi.stubGlobal('fetch', fake);
  return seen;
}

function settingSnapshot(): ModelSetting {
  const saved = updateModelSetting({ place: 'this-computer', url: ADDRESS, model: 'alpha:7b' });
  if (!saved.ok) throw new Error('setting not saved');
  return saved.setting;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

async function readOnce(setting: ModelSetting) {
  const catalogue = buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy);
  const { result } = renderHook(() => useReadingAttempt());
  act(() => {
    result.current.startReading({
      description: DESCRIPTION,
      setting,
      catalogue,
      verify: (raw: unknown) => verifyPrefill(raw, catalogue, DESCRIPTION, policy),
    });
  });
  await waitFor(() => expect(result.current.outcome).not.toBeNull());
  return result.current.outcome!;
}

describe('R18-C1 seam: description + catalogue + fake model -> verified Prefill', () => {
  it('a format-honouring server: one request, both answers verified with their own quotes', async () => {
    const seen = fakeModel('honours-format');
    const outcome = await readOnce(settingSnapshot());
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(`${ADDRESS}/api/chat`);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.modeUsed).toBe('format');
    expect([...outcome.prefill.keys()].sort()).toEqual(['11', '5']);
    expect(outcome.prefill.get('11')!.values).toEqual([{ option: 'UK', quote: 'Our UK team' }]);
    expect(outcome.prefill.get('5')!.values).toEqual([{ option: 'everyday', quote: 'internal ticket volumes' }]);
  });

  it('a server that ignores the format: exactly two requests, both to the same address, then tool mode succeeds', async () => {
    const seen = fakeModel('ignores-format');
    const outcome = await readOnce(settingSnapshot());
    expect(seen).toHaveLength(2);
    expect(new Set(seen.map((s) => s.url))).toEqual(new Set([`${ADDRESS}/api/chat`]));
    expect(seen[0]!.body.format).toBeDefined();
    expect(seen[1]!.body.format).toBeUndefined();
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.modeUsed).toBe('tool');
    expect(outcome.prefill.size).toBe(2);
    // The mode that worked is remembered, because the stored setting still equals the snapshot.
    expect(readModelSetting()?.mode).toBe('tool');
  });

  it('requestPrefill alone: the same answer, with no description in any address', async () => {
    const seen = fakeModel('honours-format');
    const setting = settingSnapshot();
    const catalogue = buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy);
    const outcome = await requestPrefill({
      description: DESCRIPTION,
      catalogue,
      setting,
      signal: new AbortController().signal,
      verify: (raw) => verifyPrefill(raw, catalogue, DESCRIPTION, policy),
    });
    expect(outcome.kind).toBe('ok');
    expect(seen.every((s) => !s.url.includes('Our'))).toBe(true);
  });
});
