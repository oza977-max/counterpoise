import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MODEL_SETTING_KEY,
  MODEL_TEST_RESULTS_KEY,
  MODEL_SETTING_CHANGED_EVENT,
  isLoopback,
  isCloudTagged,
  validateAddress,
  validateModelSetting,
  readModelSetting,
  modelSettingState,
  updateModelSetting,
  forgetModelSetting,
  listModels,
  modelLabel,
  readTestResults,
} from './model-setting';
import { enableLocalLlm } from './local-provider';
import type { ModelTestResult } from '../engine/prefill-types';

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const FIRM = 'https://ai.example-firm.test:8443';
const LOCAL = 'http://localhost:11434';

describe('isCloudTagged (TC-R18-MS-1-02)', () => {
  const rows: Array<[string, boolean]> = [
    ['gemma4:cloud', true],
    ['gemma4:Cloud', true],
    ['gpt-oss:120b-cloud', true],
    ['qwen3:4b', false],
    ['mycloud', false],
    ['llama3:cloud-v2', false],
    ['cloudy:7b', false],
    ['a:cloud', true],
    ['', false],
  ];
  it.each(rows)('TC-R18-MS-1-02: %j -> %s', (name, expected) => {
    expect(isCloudTagged(name)).toBe(expected);
  });
});

describe('isLoopback (TC-R18-MS-1-07)', () => {
  it.each([
    ['http://localhost:11434', true],
    ['http://127.0.0.1:11434', true],
    ['http://[::1]:11434', true],
    ['http://LOCALHOST:11434', true],
    ['http://localhost.evil.example:11434', false],
    ['http://127.0.0.1.evil.example:11434', false],
    ['http://evil.example/localhost', false],
    ['http://localhost@evil.example:11434', false],
    ['http://evil.example:11434#localhost', false],
    ['http://notlocalhost:11434', false],
    ['http://localhostx:11434', false],
    ['http://127.0.0.2:11434', false],
    ['not a url', false],
    ['', false],
  ])('TC-R18-MS-1-07: %s -> %s', (url, expected) => {
    expect(isLoopback(url)).toBe(expected);
  });
});

describe('validateAddress', () => {
  it('TC-R18-MS-1-07: accepts the three loopback forms under this computer', () => {
    for (const u of ['http://localhost:11434', 'http://127.0.0.1:11434', 'http://[::1]:11434']) {
      expect(validateAddress('this-computer', u)).toEqual({ ok: true, url: u });
    }
  });

  it('TC-R18-MS-1-07: refuses look-alike and credentialed addresses under this computer', () => {
    for (const u of [
      'http://localhost.evil.example:11434',
      'http://127.0.0.1.evil.example:11434',
      'http://evil.example/localhost',
      'http://localhost@evil.example:11434',
    ]) {
      expect(validateAddress('this-computer', u).ok, u).toBe(false);
    }
  });

  it('refuses a username or password under every place', () => {
    for (const place of ['this-computer', 'firm-server', 'ollama-cloud'] as const) {
      const r = validateAddress(place, 'http://user:secret@localhost:11434');
      expect(r).toEqual({ ok: false, reason: 'address-credentials' });
    }
    expect(validateAddress('firm-server', 'https://user@ai.example-firm.test')).toEqual({
      ok: false,
      reason: 'address-credentials',
    });
  });

  it('only http: and https: are accepted', () => {
    for (const u of ['ftp://localhost:11434', 'file:///etc/passwd', 'javascript:alert(1)', 'ws://localhost:11434', 'localhost:11434', 'ai.example-firm.test']) {
      expect(validateAddress('firm-server', u).ok, u).toBe(false);
    }
  });

  it('TC-R18-MS-1-04: a firm server accepts any http(s) address, with trailing slashes dropped and spaces trimmed', () => {
    expect(validateAddress('firm-server', FIRM)).toEqual({ ok: true, url: FIRM });
    expect(validateAddress('firm-server', '  http://ai.example-firm.test:8080/ ')).toEqual({
      ok: true,
      url: 'http://ai.example-firm.test:8080',
    });
    expect(validateAddress('firm-server', 'https://ai.example-firm.test/ollama/')).toEqual({
      ok: true,
      url: 'https://ai.example-firm.test/ollama',
    });
  });

  it('TC-R18-MS-1-08: Ollama cloud needs a loopback address', () => {
    expect(validateAddress('ollama-cloud', FIRM)).toEqual({ ok: false, reason: 'cloud-needs-app' });
    expect(validateAddress('ollama-cloud', LOCAL)).toEqual({ ok: true, url: LOCAL });
  });

  it('TC-R18-MS-1-04: this computer refuses a non-loopback address', () => {
    expect(validateAddress('this-computer', FIRM)).toEqual({ ok: false, reason: 'not-this-computer' });
  });

  it('TC-R18-MS-1-12: an address of 501 characters is refused, 500 is accepted; a host over 253 is refused', () => {
    const base = 'https://ai.example-firm.test/';
    const ok500 = base + 'a'.repeat(500 - base.length);
    expect(validateAddress('firm-server', ok500).ok).toBe(true);
    expect(validateAddress('firm-server', ok500 + 'a')).toEqual({ ok: false, reason: 'address-too-long' });
    const longHost = 'https://' + ('a'.repeat(60) + '.').repeat(4) + 'example.test';
    expect(longHost.length).toBeLessThan(500);
    expect(validateAddress('firm-server', longHost)).toEqual({ ok: false, reason: 'address-too-long' });
  });

  it('TC-R18-MS-1-12: control, format and private-use characters are refused, even where the URL parser would strip them', () => {
    for (const u of [
      'http://ai.example-firm.test/‮',
      'http://ai.example-firm.test/​',
      'http://ai.example-firm.test/',
      'http://ai.example-firm.test/\tx',
      'http://ai.example-firm\n.test',
      'http://ai.example-firm.test/\u0000',
    ]) {
      expect(validateAddress('firm-server', u), JSON.stringify(u)).toEqual({ ok: false, reason: 'address-characters' });
    }
  });

  it('an empty address is refused with its own reason', () => {
    expect(validateAddress('this-computer', '   ')).toEqual({ ok: false, reason: 'address-missing' });
  });

  it('a choice of place is required', () => {
    expect(validateAddress(undefined, LOCAL)).toEqual({ ok: false, reason: 'no-place' });
  });
});

describe('validateModelSetting', () => {
  it('TC-R18-MS-1-01: a place must be chosen', () => {
    expect(validateModelSetting({ place: undefined, url: LOCAL, model: 'qwen3:4b' })).toEqual({ ok: false, reason: 'no-place' });
    expect(validateModelSetting({ place: '' as never, url: LOCAL, model: 'qwen3:4b' })).toEqual({ ok: false, reason: 'no-place' });
    expect(validateModelSetting({ place: 'elsewhere' as never, url: LOCAL, model: 'qwen3:4b' })).toEqual({ ok: false, reason: 'no-place' });
  });

  it('TC-R18-MS-1-03: a cloud-tagged model is refused on this computer and accepted through Ollama cloud', () => {
    expect(validateModelSetting({ place: 'this-computer', url: LOCAL, model: 'gemma4:cloud' })).toEqual({
      ok: false,
      reason: 'cloud-model-elsewhere',
    });
    expect(validateModelSetting({ place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' })).toEqual({
      ok: true,
      setting: { place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' },
    });
  });

  it('TC-R18-MS-1-04: the firm address is refused on this computer and accepted for the firm server', () => {
    expect(validateModelSetting({ place: 'this-computer', url: FIRM, model: 'qwen3:4b' }).ok).toBe(false);
    expect(validateModelSetting({ place: 'firm-server', url: FIRM, model: 'qwen3:4b' })).toEqual({
      ok: true,
      setting: { place: 'firm-server', url: FIRM, model: 'qwen3:4b' },
    });
  });

  it('TC-R18-MS-1-06: a cloud-tagged model is refused under the firm server', () => {
    expect(validateModelSetting({ place: 'firm-server', url: FIRM, model: 'gpt-oss:120b-cloud' })).toEqual({
      ok: false,
      reason: 'cloud-model-elsewhere',
    });
  });

  it('TC-R18-MS-1-08: Ollama cloud with a firm address is refused for the address (before the model)', () => {
    expect(validateModelSetting({ place: 'ollama-cloud', url: FIRM, model: 'gemma4:cloud' })).toEqual({
      ok: false,
      reason: 'cloud-needs-app',
    });
  });

  it('TC-R18-MS-1-09: Ollama cloud needs a cloud-tagged model', () => {
    expect(validateModelSetting({ place: 'ollama-cloud', url: LOCAL, model: 'qwen3:4b' })).toEqual({
      ok: false,
      reason: 'cloud-needs-tag',
    });
  });

  it('a model is required to save, and the case of the tag does not matter', () => {
    expect(validateModelSetting({ place: 'this-computer', url: LOCAL, model: '  ' })).toEqual({ ok: false, reason: 'model-missing' });
    expect(validateModelSetting({ place: 'ollama-cloud', url: LOCAL, model: 'Gemma4:CLOUD' }).ok).toBe(true);
  });

  it('TC-R18-MS-1-12: a model name of 101 characters or with U+202E is refused; 100 is accepted', () => {
    expect(validateModelSetting({ place: 'this-computer', url: LOCAL, model: 'm'.repeat(100) }).ok).toBe(true);
    expect(validateModelSetting({ place: 'this-computer', url: LOCAL, model: 'm'.repeat(101) })).toEqual({ ok: false, reason: 'model-too-long' });
    expect(validateModelSetting({ place: 'this-computer', url: LOCAL, model: 'm‮odel' })).toEqual({ ok: false, reason: 'model-characters' });
    expect(validateModelSetting({ place: 'this-computer', url: LOCAL, model: 'm​odel' })).toEqual({ ok: false, reason: 'model-characters' });
  });

  it('trims the model name', () => {
    expect(validateModelSetting({ place: 'this-computer', url: LOCAL, model: '  qwen3:4b ' })).toEqual({
      ok: true,
      setting: { place: 'this-computer', url: LOCAL, model: 'qwen3:4b' },
    });
  });
});

describe('readModelSetting and modelSettingState', () => {
  it('nothing stored reads as none', () => {
    expect(readModelSetting()).toBeNull();
    expect(modelSettingState()).toEqual({ kind: 'none' });
  });

  it('TC-R18-MS-1-05: a saved setting reads back as it was written', () => {
    const r = updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    expect(r.ok).toBe(true);
    expect(readModelSetting()).toEqual({ version: 1, place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    expect(modelSettingState()).toEqual({
      kind: 'valid',
      setting: { version: 1, place: 'this-computer', url: LOCAL, model: 'qwen3:4b' },
    });
  });

  it('BC-003: the old keys as enableLocalLlm wrote them migrate to this computer, with their model, and are removed', () => {
    enableLocalLlm('http://localhost:11434/', ' qwen3:4b ');
    expect(localStorage.getItem('aigate:local-llm-url')).toBe('http://localhost:11434');
    expect(readModelSetting()).toEqual({ version: 1, place: 'this-computer', url: 'http://localhost:11434', model: 'qwen3:4b' });
    expect(localStorage.getItem('aigate:local-llm-url')).toBeNull();
    expect(localStorage.getItem('aigate:local-llm-model')).toBeNull();
    expect(JSON.parse(localStorage.getItem(MODEL_SETTING_KEY)!)).toMatchObject({ place: 'this-computer' });
  });

  it('TC-R18-MS-1-11: an old URL-only setting migrates without inventing a model', () => {
    localStorage.setItem('aigate:local-llm-url', LOCAL);
    const s = readModelSetting();
    expect(s).toEqual({ version: 1, place: 'this-computer', url: LOCAL, model: '' });
    expect(localStorage.getItem('aigate:local-llm-url')).toBeNull();
    expect(localStorage.getItem('aigate:local-llm-model')).toBeNull();
    expect(modelSettingState()).toMatchObject({ kind: 'no-model' });
  });

  it('an old model key with no old URL is dropped, and no setting is invented', () => {
    localStorage.setItem('aigate:local-llm-model', 'qwen3:4b');
    expect(readModelSetting()).toBeNull();
    expect(localStorage.getItem('aigate:local-llm-model')).toBeNull();
    expect(localStorage.getItem(MODEL_SETTING_KEY)).toBeNull();
  });

  it('migration happens once: a second read does not recreate the setting after Forget', () => {
    localStorage.setItem('aigate:local-llm-url', LOCAL);
    readModelSetting();
    forgetModelSetting();
    expect(readModelSetting()).toBeNull();
  });

  it.each([
    ['not json', '{nope'],
    ['an array', '[]'],
    ['a string', '"x"'],
    ['null', 'null'],
    ['wrong version', JSON.stringify({ version: 2, place: 'this-computer', url: LOCAL, model: 'm' })],
    ['unknown place', JSON.stringify({ version: 1, place: 'moon', url: LOCAL, model: 'm' })],
    ['url not a string', JSON.stringify({ version: 1, place: 'this-computer', url: 5, model: 'm' })],
    ['oversized model', JSON.stringify({ version: 1, place: 'this-computer', url: LOCAL, model: 'm'.repeat(5000) })],
    ['oversized url', JSON.stringify({ version: 1, place: 'firm-server', url: 'http://a.test/' + 'x'.repeat(5000), model: 'm' })],
    ['unknown mode', JSON.stringify({ version: 1, place: 'this-computer', url: LOCAL, model: 'm', mode: 'chat' })],
    ['a credential field', JSON.stringify({ version: 1, place: 'this-computer', url: LOCAL, model: 'm', apiKey: 'x' })],
  ])('a tampered stored value (%s) reads as unreadable, never as a setting', (_n, raw) => {
    localStorage.setItem(MODEL_SETTING_KEY, raw);
    expect(readModelSetting()).toBeNull();
    expect(modelSettingState()).toEqual({ kind: 'invalid' });
  });

  it('TC-R18-MS-1-10: a well-formed setting rewritten to a look-alike address is invalid, with the setting still readable', () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    localStorage.setItem(
      MODEL_SETTING_KEY,
      JSON.stringify({ version: 1, place: 'this-computer', url: 'http://evil.example:11434', model: 'qwen3:4b' }),
    );
    expect(modelSettingState()).toEqual({ kind: 'invalid' });
  });

  it('a stored cloud-tagged model under this computer is invalid', () => {
    localStorage.setItem(MODEL_SETTING_KEY, JSON.stringify({ version: 1, place: 'this-computer', url: LOCAL, model: 'x:cloud' }));
    expect(modelSettingState()).toEqual({ kind: 'invalid' });
  });
});

describe('updateModelSetting', () => {
  it('TC-R18-MS-1-01: refuses to write without a valid place, and leaves storage untouched', () => {
    const r = updateModelSetting({ url: LOCAL, model: 'qwen3:4b' });
    expect(r).toEqual({ ok: false, reason: 'no-place' });
    expect(localStorage.getItem(MODEL_SETTING_KEY)).toBeNull();
  });

  it('TC-R18-MS-1-03 / -04 / -08: a refused save stores nothing', () => {
    expect(updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'gemma4:cloud' }).ok).toBe(false);
    expect(updateModelSetting({ place: 'this-computer', url: FIRM, model: 'qwen3:4b' }).ok).toBe(false);
    expect(updateModelSetting({ place: 'ollama-cloud', url: FIRM, model: 'gemma4:cloud' }).ok).toBe(false);
    expect(localStorage.getItem(MODEL_SETTING_KEY)).toBeNull();
  });

  it('TC-R18-MS-1-01 (second save): a refused save leaves the earlier valid setting in place', () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    updateModelSetting({ place: 'firm-server', url: FIRM, model: 'bad‮' });
    expect(readModelSetting()).toMatchObject({ place: 'this-computer', model: 'qwen3:4b' });
  });

  it('TC-R18-MS-5-08: mode is kept by a mode-only patch and reset when model, address or place changes', () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'alpha:1b' });
    updateModelSetting({ mode: 'tool' });
    expect(readModelSetting()?.mode).toBe('tool');
    updateModelSetting({ mode: 'tool' });
    expect(readModelSetting()?.mode).toBe('tool');

    updateModelSetting({ model: 'beta:7b' });
    expect(readModelSetting()?.mode).toBeUndefined();

    updateModelSetting({ mode: 'format' });
    updateModelSetting({ url: 'http://127.0.0.1:11434' });
    expect(readModelSetting()?.mode).toBeUndefined();

    updateModelSetting({ mode: 'tool' });
    updateModelSetting({ place: 'firm-server', url: FIRM });
    expect(readModelSetting()?.mode).toBeUndefined();
    expect(readModelSetting()).toMatchObject({ place: 'firm-server', url: FIRM, model: 'beta:7b' });
  });

  it('TC-R18-MS-5-08: saving the same place, address and model again keeps the remembered mode', () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'alpha:1b' });
    updateModelSetting({ mode: 'tool' });
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'alpha:1b' });
    expect(readModelSetting()?.mode).toBe('tool');
  });

  it('re-reads storage before writing: a patch merges onto what is stored now, not onto an earlier read', () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'alpha:1b' });
    localStorage.setItem(
      MODEL_SETTING_KEY,
      JSON.stringify({ version: 1, place: 'this-computer', url: LOCAL, model: 'beta:7b' }),
    );
    updateModelSetting({ mode: 'tool' });
    expect(readModelSetting()).toEqual({ version: 1, place: 'this-computer', url: LOCAL, model: 'beta:7b', mode: 'tool' });
  });

  it('a mode-only patch cannot launder a tampered stored setting', () => {
    localStorage.setItem(
      MODEL_SETTING_KEY,
      JSON.stringify({ version: 1, place: 'this-computer', url: 'http://evil.example:11434', model: 'm' }),
    );
    const r = updateModelSetting({ mode: 'tool' });
    expect(r.ok).toBe(false);
    expect(JSON.parse(localStorage.getItem(MODEL_SETTING_KEY)!)).not.toHaveProperty('mode');
  });

  it('the stored value never contains a credential field', () => {
    updateModelSetting({ place: 'firm-server', url: FIRM, model: 'alpha:7b' });
    expect(Object.keys(JSON.parse(localStorage.getItem(MODEL_SETTING_KEY)!)).sort()).toEqual(['model', 'place', 'url', 'version']);
  });

  it('dispatches the in-page change event on a write, and not on a refusal', () => {
    const seen = vi.fn();
    window.addEventListener(MODEL_SETTING_CHANGED_EVENT, seen);
    try {
      updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'gemma4:cloud' });
      expect(seen).not.toHaveBeenCalled();
      updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
      expect(seen).toHaveBeenCalledTimes(1);
      forgetModelSetting();
      expect(seen).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener(MODEL_SETTING_CHANGED_EVENT, seen);
    }
    expect(MODEL_SETTING_CHANGED_EVENT).toBe('aigate:model-setting-changed');
  });

  it('TC-R18-MS-3-03: a setting migrated without a model accepts a typed model later', () => {
    localStorage.setItem('aigate:local-llm-url', LOCAL);
    readModelSetting();
    expect(updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'epsilon:3b' }).ok).toBe(true);
    expect(readModelSetting()?.model).toBe('epsilon:3b');
  });
});

describe('forgetModelSetting (TC-R18-NF-3-08)', () => {
  it('removes the setting and the test results, and nothing else', () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    localStorage.setItem(MODEL_TEST_RESULTS_KEY, JSON.stringify({ version: 1, results: [] }));
    localStorage.setItem('aigate:policy-yaml', 'kept');
    forgetModelSetting();
    expect(localStorage.getItem(MODEL_SETTING_KEY)).toBeNull();
    expect(localStorage.getItem(MODEL_TEST_RESULTS_KEY)).toBeNull();
    expect(localStorage.getItem('aigate:policy-yaml')).toBe('kept');
  });
});

/** A fake fetch that records its calls and rejects when its signal aborts (TDD-2). */
function fakeFetch(reply: (url: string, init: RequestInit) => Promise<Response> | Response | 'hang') {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const out = reply(url, init);
    if (out === 'hang') {
      return new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      });
    }
    return Promise.resolve(out);
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('listModels', () => {
  it('TC-R18-MS-3-01 / MS-1-13: GET {url}/api/tags with no body and the safety options, returning every reported name', async () => {
    const calls = fakeFetch(() => json({ models: [{ name: 'alpha:1b' }, { name: 'beta:7b' }, { name: 'gamma:70b' }] }));
    const names = await listModels({ place: 'this-computer', url: LOCAL }, new AbortController().signal);
    expect(names).toEqual(['alpha:1b', 'beta:7b', 'gamma:70b']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://localhost:11434/api/tags');
    const init = calls[0]!.init;
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe('error');
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeDefined();
  });

  it('TC-R18-MS-1-13: works under Ollama cloud before any model is typed', async () => {
    fakeFetch(() => json({ models: [{ name: 'alpha:cloud' }, { name: 'beta:cloud' }] }));
    expect(await listModels({ place: 'ollama-cloud', url: LOCAL })).toEqual(['alpha:cloud', 'beta:cloud']);
  });

  it('TC-R18-MS-1-12: drops names over 100 characters and keeps a hidden-character name as it is (display escapes it)', async () => {
    fakeFetch(() => json({ models: [{ name: 'ok:1b' }, { name: 'x'.repeat(150) }, { name: 'z​:1b' }, { name: 'x'.repeat(100) }] }));
    const names = await listModels({ place: 'this-computer', url: LOCAL });
    expect(names).toEqual(['ok:1b', 'z​:1b', 'x'.repeat(100)]);
  });

  it('ignores entries that are not objects with a string name, and duplicates', async () => {
    fakeFetch(() => json({ models: [null, 5, {}, { name: 7 }, { name: '' }, { name: 'a:1' }, { name: 'a:1' }, 'str'] }));
    expect(await listModels({ place: 'this-computer', url: LOCAL })).toEqual(['a:1']);
  });

  it('TC-R18-MS-3-03: returns [] on 404, on HTML, on bad JSON, on a wrong shape and on a thrown fetch', async () => {
    fakeFetch(() => new Response('nope', { status: 404 }));
    expect(await listModels({ place: 'this-computer', url: LOCAL })).toEqual([]);
    fakeFetch(() => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    expect(await listModels({ place: 'this-computer', url: LOCAL })).toEqual([]);
    fakeFetch(() => json({ models: 'many' }));
    expect(await listModels({ place: 'this-computer', url: LOCAL })).toEqual([]);
    fakeFetch(() => json([1, 2]));
    expect(await listModels({ place: 'this-computer', url: LOCAL })).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await listModels({ place: 'this-computer', url: LOCAL })).toEqual([]);
  });

  it('a redirect (fetch rejects under redirect:error) returns []', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('redirect mode is set to error'))));
    expect(await listModels({ place: 'firm-server', url: FIRM })).toEqual([]);
  });

  it('makes no request when the address does not validate for the place', async () => {
    const calls = fakeFetch(() => json({ models: [{ name: 'a:1' }] }));
    expect(await listModels({ place: 'this-computer', url: 'http://evil.example:11434' })).toEqual([]);
    expect(await listModels({ place: 'ollama-cloud', url: FIRM })).toEqual([]);
    expect(await listModels({ place: 'firm-server', url: 'http://u:p@ai.example-firm.test' })).toEqual([]);
    expect(await listModels({ place: undefined as never, url: LOCAL })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('gives up after 4 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fakeFetch(() => 'hang');
      const p = listModels({ place: 'this-computer', url: LOCAL });
      await vi.advanceTimersByTimeAsync(3999);
      let settled = false;
      void p.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(await p).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops when the caller aborts', async () => {
    fakeFetch(() => 'hang');
    const c = new AbortController();
    const p = listModels({ place: 'this-computer', url: LOCAL }, c.signal);
    c.abort();
    expect(await p).toEqual([]);
  });

  it('an already-aborted signal makes no request', async () => {
    const calls = fakeFetch(() => json({ models: [{ name: 'a:1' }] }));
    const c = new AbortController();
    c.abort();
    expect(await listModels({ place: 'this-computer', url: LOCAL }, c.signal)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

const result = (over: Partial<ModelTestResult>): ModelTestResult => ({
  model: 'gemma4:cloud',
  place: 'ollama-cloud',
  host: 'http://localhost:11434',
  date: '2026-10-07',
  casesRun: 31,
  stopped: false,
  verdictMatches: 21,
  discarded: {},
  perQuestion: {},
  ...over,
});
const sett = { model: 'gemma4:cloud', place: 'ollama-cloud' as const, url: 'http://localhost:11434' };

describe('modelLabel (TC-R18-GI-12-*)', () => {
  it('TC-R18-GI-12-01: no result is untested', () => {
    expect(modelLabel(sett, [])).toEqual({ kind: 'untested' });
  });

  it('TC-R18-GI-12-02: a completed run is tested with its matches and date', () => {
    expect(modelLabel(sett, [result({})])).toEqual({ kind: 'tested', matches: 21, date: '2026-10-07' });
  });

  it('TC-R18-GI-12-03: a result belongs to one model, one place and one host', () => {
    const r = [result({})];
    expect(modelLabel({ ...sett, model: 'qwen3:4b' }, r)).toEqual({ kind: 'untested' });
    expect(modelLabel({ ...sett, place: 'firm-server' }, r)).toEqual({ kind: 'untested' });
    expect(modelLabel({ ...sett, url: 'http://127.0.0.1:11434' }, r)).toEqual({ kind: 'untested' });
    expect(modelLabel({ ...sett, url: 'http://localhost:11434/' }, r)).toMatchObject({ kind: 'tested' });
    expect(modelLabel({ ...sett, url: 'http://localhost:11434/some/path' }, r)).toMatchObject({ kind: 'tested' });
  });

  it('only a completed run counts: a stopped run is partial, and never tested', () => {
    expect(modelLabel(sett, [result({ stopped: true, casesRun: 12, verdictMatches: 9 })])).toEqual({ kind: 'partial', casesRun: 12 });
  });

  it('a completed run wins over a newer stopped one; the newest completed one wins', () => {
    const rs = [
      result({ stopped: true, casesRun: 3 }),
      result({ date: '2026-10-06', verdictMatches: 25 }),
      result({ date: '2026-10-01', verdictMatches: 5 }),
    ];
    expect(modelLabel(sett, rs)).toEqual({ kind: 'tested', matches: 25, date: '2026-10-06' });
  });

  it('a setting with no valid address has no host and so no result', () => {
    expect(modelLabel({ ...sett, url: 'not a url' }, [result({})])).toEqual({ kind: 'untested' });
  });
});

describe('readTestResults', () => {
  it('nothing stored is an empty list', () => {
    expect(readTestResults()).toEqual([]);
  });

  it('reads a well-formed list, newest first, capped at 20', () => {
    const many = Array.from({ length: 25 }, (_, i) => result({ date: `2026-10-${String(i + 1).padStart(2, '0')}` }));
    localStorage.setItem(MODEL_TEST_RESULTS_KEY, JSON.stringify({ version: 1, results: many }));
    const got = readTestResults();
    expect(got).toHaveLength(20);
    expect(got[0]!.date).toBe('2026-10-01');
  });

  it.each([
    ['not json', '{x'],
    ['wrong version', JSON.stringify({ version: 9, results: [] })],
    ['a bare array', JSON.stringify([result({})])],
    ['a row with the wrong type', JSON.stringify({ version: 1, results: [{ ...result({}), casesRun: 'many' }] })],
    ['a row with an unknown place', JSON.stringify({ version: 1, results: [{ ...result({}), place: 'moon' }] })],
  ])('a tampered stored list (%s) reads as empty', (_n, raw) => {
    localStorage.setItem(MODEL_TEST_RESULTS_KEY, raw);
    expect(readTestResults()).toEqual([]);
  });
});
