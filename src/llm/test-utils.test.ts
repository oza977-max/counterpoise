import { describe, it, expect, vi, afterEach } from 'vitest';
import { createFakeModel } from './test-utils';

// The fake model is a test tool; these pin the three behaviours the spec demands of it.
afterEach(() => vi.useRealTimers());

describe('test-utils fake model', () => {
  it('rejects when its signal aborts, and records every request', async () => {
    const fake = createFakeModel({ kind: 'never' });
    const ac = new AbortController();
    const p = fake.fetch('http://localhost:11434/api/chat', { method: 'POST', body: '{"a":1}', signal: ac.signal });
    ac.abort('skip');
    await expect(p).rejects.toBeDefined();
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({ url: 'http://localhost:11434/api/chat', method: 'POST', body: '{"a":1}' });
    await expect(fake.fetch('http://x/', { signal: ac.signal })).rejects.toBeDefined();
  });
  it('a slow server answers at N ms on the fake clock', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const fake = createFakeModel({ kind: 'slow', ms: 20_000, then: { kind: 'honours-format' } });
    let done = false;
    const p = fake.fetch('http://localhost:11434/api/chat', { method: 'POST', body: '{"format":{}}' }).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(19_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });
  it('a redirect is refused when the call asks for redirect:error, and answered 307 otherwise', async () => {
    const fake = createFakeModel({ kind: 'redirect', location: 'https://other.example/' });
    await expect(fake.fetch('http://localhost:11434/api/chat', { redirect: 'error' })).rejects.toBeInstanceOf(TypeError);
    expect((await fake.fetch('http://localhost:11434/api/chat')).status).toBe(307);
  });
});
