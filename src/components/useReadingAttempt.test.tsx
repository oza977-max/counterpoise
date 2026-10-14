import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode, type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../store/policy';
import { getAllForExport } from '../store/audit';
import { useReadingAttempt, READING_BUDGET_MS } from './useReadingAttempt';
import { updateModelSetting, readModelSetting, MODEL_SETTING_KEY } from '../llm/model-setting';
import type { ModelSetting } from '../llm/model-setting';
import { createFakeModel, MODEL_CONTENT } from '../llm/test-utils';
import type { FakeBehaviour } from '../llm/test-utils';
import { FIXTURE_DESCRIPTION } from '../llm/__fixtures__/server-replies';
import { verifyPrefill } from '../engine/prefill-verify';
import { buildCatalogue, QUESTION_STRUCTURE } from '../engine/question-structure';
import { QUESTION_WORDS, failureSentence } from './plain-copy';
import type { PolicyFile } from '../engine/types';

// R18-C1 deliverable 8: the reading attempt (specs/intake-flow.md §27.5, "Time and abort"). Built and
// tested here at the hook level; C2 wires it into IntakeFlow and adds the on-screen assertions for every
// case named below (the form, the sentence, the working indicator, the skip button).

const LOCAL = 'http://localhost:11434';
let policy: PolicyFile;
beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  policy = r.policy;
});

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setting(model = 'alpha:7b'): ModelSetting {
  const s = updateModelSetting({ place: 'this-computer', url: LOCAL, model });
  if (!s.ok) throw new Error('setting refused');
  return s.setting;
}

function install(b: FakeBehaviour) {
  const fake = createFakeModel(b);
  vi.stubGlobal('fetch', fake.fetch);
  return fake;
}

function begin(result: { current: ReturnType<typeof useReadingAttempt> }, s: ModelSetting, description = FIXTURE_DESCRIPTION) {
  const catalogue = buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy);
  act(() => {
    result.current.startReading({
      description,
      setting: s,
      catalogue,
      verify: (raw: unknown) => verifyPrefill(raw, catalogue, description, policy),
    });
  });
}

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const reasonOf = (r: { current: ReturnType<typeof useReadingAttempt> }) => {
  const o = r.current.outcome;
  return o && o.kind === 'none' ? o.reason : o?.kind;
};

describe('TC-R18-NF-1-01: a model that never answers opens a blank form at 30 seconds', () => {
  it('at 29 s it is still reading (indicator and skip live); at 31 s the outcome is timed-out and nothing is pending', async () => {
    install({ kind: 'never' });
    const { result } = renderHook(() => useReadingAttempt());
    begin(result, setting());
    expect(READING_BUDGET_MS).toBe(30_000);
    await advance(29_000);
    expect(result.current.reading).toBe(true);
    expect(result.current.outcome).toBeNull();
    await advance(2_000);
    expect(result.current.reading).toBe(false);
    expect(reasonOf(result)).toBe('timed-out');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('TC-R18-GI-7-02: a model that never answers opens a blank form within the limit', () => {
  it('31 s: the timed-out outcome (the one plain sentence), no still-running state, nothing in the audit trail', async () => {
    install({ kind: 'never' });
    const { result } = renderHook(() => useReadingAttempt());
    begin(result, setting());
    await advance(31_000);
    expect(reasonOf(result)).toBe('timed-out');
    expect(result.current.reading).toBe(false);
    expect(failureSentence('timed-out', 'this-computer', LOCAL)).toBe('Nothing was filled in for you. Answer the questions below.');
    vi.useRealTimers();
    expect(await getAllForExport()).toHaveLength(0);
  });
});

describe('TC-R18-NF-1-02: skip opens the blank form at once', () => {
  it('skip at 5 s settles immediately without the clock advancing; the late reply has no effect', async () => {
    const fake = install({ kind: 'slow', ms: 20_000, then: { kind: 'honours-format' } });
    const { result } = renderHook(() => useReadingAttempt());
    begin(result, setting());
    await advance(5_000);
    act(() => result.current.skip());
    expect(reasonOf(result)).toBe('skipped');
    expect(result.current.reading).toBe(false);
    await advance(30_000);
    expect(reasonOf(result)).toBe('skipped');
    expect(result.current.outcome?.kind).toBe('none');
    expect(fake.requests).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('TC-R18-NF-1-03: while the model works the person sees that it is working', () => {
  it('reading stays true at 1, 10 and 19 s; the answer at 20 s ends it with the verified pre-fill', async () => {
    install({ kind: 'slow', ms: 20_000, then: { kind: 'honours-format' } });
    const { result } = renderHook(() => useReadingAttempt());
    begin(result, setting());
    for (const t of [1_000, 9_000, 9_000]) {
      await advance(t);
      expect(result.current.reading).toBe(true);
      expect(result.current.outcome).toBeNull();
    }
    await advance(1_000);
    expect(result.current.reading).toBe(false);
    expect(result.current.outcome?.kind).toBe('ok');
  });
});

describe('TC-R18-GI-7-07: a double press or a double mount makes one model call', () => {
  it('two presses in the same instant send one request', async () => {
    const fake = install({ kind: 'never' });
    const { result } = renderHook(() => useReadingAttempt());
    const s = setting();
    const catalogue = buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy);
    act(() => {
      for (let i = 0; i < 2; i++) {
        result.current.startReading({ description: FIXTURE_DESCRIPTION, setting: s, catalogue, verify: (raw) => verifyPrefill(raw, catalogue, FIXTURE_DESCRIPTION, policy) });
      }
    });
    await advance(10);
    expect(fake.requests).toHaveLength(1);
  });
  it('under StrictMode the reading starts once', async () => {
    const fake = install({ kind: 'never' });
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useReadingAttempt(), { wrapper });
    begin(result, setting());
    await advance(10);
    expect(fake.requests).toHaveLength(1);
  });
  it('after release (Back, Start over) and after unmount the first attempt leaves no pending timer', async () => {
    install({ kind: 'never' });
    const a = renderHook(() => useReadingAttempt());
    begin(a.result, setting());
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => a.result.current.release());
    await advance(1); // lets React's own bookkeeping timers run; only a leaked 30 s budget timer would remain
    expect(vi.getTimerCount()).toBe(0);
    const b = renderHook(() => useReadingAttempt());
    begin(b.result, setting());
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    b.unmount();
    await advance(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('TC-R18-GI-7-08: skip beats a simultaneous timeout', () => {
  it('skip at 29.999 s then 1 ms: the skipped outcome, once, and it does not turn into timed-out', async () => {
    install({ kind: 'never' });
    const { result } = renderHook(() => useReadingAttempt());
    begin(result, setting());
    await advance(29_999);
    act(() => result.current.skip());
    await advance(1);
    expect(reasonOf(result)).toBe('skipped');
    await advance(5_000);
    expect(reasonOf(result)).toBe('skipped');
  });
});

describe('TC-R18-GI-7-09: changing the model setting in another tab stops the read', () => {
  it('a storage event on aigate:model-setting gives setting-changed and no second request', async () => {
    const fake = install({ kind: 'never' });
    const { result } = renderHook(() => useReadingAttempt());
    begin(result, setting());
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: MODEL_SETTING_KEY }));
    });
    expect(reasonOf(result)).toBe('setting-changed');
    expect(failureSentence('setting-changed', 'this-computer', LOCAL)).toBe(
      'The model setting changed while it was reading, so nothing was filled in. Press Read my description again.',
    );
    await advance(40_000);
    expect(fake.requests).toHaveLength(1);
  });
  it('a storage event for another key does not stop it', async () => {
    install({ kind: 'never' });
    const { result } = renderHook(() => useReadingAttempt());
    begin(result, setting());
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'aigate:something-else' }));
    });
    expect(result.current.reading).toBe(true);
  });
});

describe('TC-R18-GI-7-11: a setting changed in the same page stops the read and stores no stale mode', () => {
  it('the in-page notice gives setting-changed; the old request finishing later in tool mode stores nothing', async () => {
    // A server that ignores the abort and answers in tool mode at 10 s.
    const old = { ...setting('alpha:7b'), mode: 'tool' as const };
    vi.stubGlobal('fetch', () =>
      new Promise<Response>((resolveFetch) => {
        setTimeout(() => {
          const args = JSON.parse(MODEL_CONTENT.good);
          resolveFetch(new Response(JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'fill_form', arguments: args } }] }, done: true, done_reason: 'stop' }), { status: 200 }));
        }, 10_000);
      }),
    );
    const { result } = renderHook(() => useReadingAttempt());
    begin(result, old);
    await advance(2_000);
    act(() => {
      updateModelSetting({ model: 'beta:7b' }); // dispatches aigate:model-setting-changed in this document
    });
    expect(reasonOf(result)).toBe('setting-changed');
    await advance(20_000);
    expect(reasonOf(result)).toBe('setting-changed');
    expect(readModelSetting()?.mode).toBeUndefined();
    expect(readModelSetting()?.model).toBe('beta:7b');
  });
});

describe('TC-R18-GI-7-06: a reload while the model is reading lands on the form', () => {
  it('a fresh mount after the page went away is idle: no outcome, not reading, no second request, no timer', async () => {
    const fake = install({ kind: 'never' });
    const first = renderHook(() => useReadingAttempt());
    begin(first.result, setting());
    await advance(5_000);
    first.unmount(); // the reload
    const second = renderHook(() => useReadingAttempt());
    await advance(60_000);
    expect(second.result.current.reading).toBe(false);
    expect(second.result.current.outcome).toBeNull();
    expect(fake.requests).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    // C2 shows this sentence on the form after a reload (readNotice 'not-read').
    expect(failureSentence('not-read', 'this-computer', LOCAL)).toBe(
      'Nothing was filled in for you. Answer the questions below — or press Read my description again.',
    );
  });
});

describe('the attempt lifecycle', () => {
  it('a late reply after release is a no-op, and the guard is released so a new attempt can start', async () => {
    const fake = install({ kind: 'slow', ms: 10_000, then: { kind: 'honours-format' } });
    const { result } = renderHook(() => useReadingAttempt());
    begin(result, setting());
    act(() => result.current.release());
    await advance(15_000);
    expect(result.current.outcome).toBeNull();
    expect(result.current.reading).toBe(false);
    begin(result, setting());
    await advance(10_000);
    expect(fake.requests).toHaveLength(2);
    expect(result.current.outcome?.kind).toBe('ok');
  });
  it('the first attempt\'s timer does not leak into the next attempt', async () => {
    install({ kind: 'never' });
    const { result } = renderHook(() => useReadingAttempt());
    begin(result, setting());
    await advance(20_000);
    act(() => result.current.release());
    begin(result, setting());
    await advance(11_000); // 31 s after the FIRST start, 11 s into the second
    expect(result.current.reading).toBe(true);
    await advance(19_000);
    expect(reasonOf(result)).toBe('timed-out');
  });
  it('the first abort reason wins: skip then a setting change stays skipped', async () => {
    install({ kind: 'never' });
    const { result } = renderHook(() => useReadingAttempt());
    begin(result, setting());
    act(() => result.current.skip());
    act(() => {
      updateModelSetting({ model: 'beta:7b' });
    });
    expect(reasonOf(result)).toBe('skipped');
  });
  it('a finished attempt clears its timer and listeners: a setting change afterwards changes nothing', async () => {
    install({ kind: 'honours-format' });
    const { result } = renderHook(() => useReadingAttempt());
    begin(result, setting());
    await advance(10);
    expect(result.current.outcome?.kind).toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      updateModelSetting({ model: 'beta:7b' });
    });
    expect(result.current.outcome?.kind).toBe('ok');
  });
  it('a tampered snapshot is refused with no request (MS-1-10, send time)', async () => {
    const fake = install({ kind: 'honours-format' });
    const { result } = renderHook(() => useReadingAttempt());
    begin(result, { ...setting(), url: 'http://evil.example:11434' });
    await advance(10);
    expect(reasonOf(result)).toBe('invalid-setting');
    expect(fake.requests).toHaveLength(0);
  });
  it('a format-ignoring server: tool mode is remembered only because the stored setting still equals the snapshot', async () => {
    install({ kind: 'ignores-format' });
    const { result } = renderHook(() => useReadingAttempt());
    begin(result, setting());
    await advance(10);
    expect(result.current.outcome?.kind).toBe('ok');
    expect(readModelSetting()?.mode).toBe('tool');
  });
});
