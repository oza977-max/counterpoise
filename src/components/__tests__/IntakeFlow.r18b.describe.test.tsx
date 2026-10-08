import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { R18_COPY } from '../plain-copy';
import { MODEL_SETTING_KEY, MODEL_TEST_RESULTS_KEY, updateModelSetting, forgetModelSetting } from '../../llm/model-setting';
import { fillText, DUP_CHECK_WAIT, pressNext } from './fillText';
import type { ModelTestResult } from '../../engine/prefill-types';

// R18-B, the model status on the description screen (specs/intake-flow.md §27.8): above
// the Next button, from the STORED setting only when it validates. The real App, real
// storage; the network is a recording fake that must stay untouched in this chunk (no
// model is called for a pre-fill until R18-C1).

const FIRM = 'https://ai.example-firm.test:8443';
const LOCAL = 'http://localhost:11434';
const DEMO = R18_COPY.DEMO_NOTICE;

let fetchCalls: string[];
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  fetchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      fetchCalls.push(String(url));
      return Promise.reject(new TypeError('Failed to fetch'));
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function statusLine(): HTMLElement {
  const next = screen.getByRole('button', { name: /^next/i });
  const region = next.parentElement!.querySelector('.model-status__line');
  if (!region) throw new Error('no model status line above Next');
  return region as HTMLElement;
}
const page = () => document.body.textContent ?? '';
const sentence = {
  here: (m: string) => `Your description will be read on this computer by ${m}. It never leaves your computer.`,
  firm: (m: string, a: string) => `Your description will be sent to your firm's server at ${a} and read by ${m}.`,
  cloud: (m: string) => `Your description will be sent to Ollama's cloud and read by ${m}.`,
};

describe('the status line is a status region above Next (deliverable 5)', () => {
  it('is a role=status element in the same block as the Next button, before it', () => {
    render(<App />);
    const region = statusLine();
    expect(region).toHaveAttribute('role', 'status');
    const next = screen.getByRole('button', { name: /^next/i });
    expect(region.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('no model, or none chosen (TC-R18-MS-2-02, TC-R18-PS-4-02)', () => {
  it('with nothing stored it says No model is connected., shows no notice and no promise', () => {
    render(<App />);
    expect(statusLine().textContent).toBe(R18_COPY.NO_MODEL_SENTENCE);
    expect(page()).not.toContain(DEMO);
    expect(page()).not.toMatch(/never leaves your computer/i);
    expect(screen.getByLabelText(/what ai tool do you want to use/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: R18_COPY.CHECKLIST_HEADING })).toBeInTheDocument();
  });

  it('TC-R18-MS-1-11: an old URL-only setting is migrated and the line says no model is connected, never a promise', () => {
    localStorage.setItem('aigate:local-llm-url', LOCAL);
    render(<App />);
    expect(statusLine().textContent).toBe(R18_COPY.NO_MODEL_SENTENCE);
    expect(page()).not.toMatch(/never leaves your computer/i);
    expect(localStorage.getItem('aigate:local-llm-url')).toBeNull();
  });

  it('BC-003: the old keys as the baseline wrote them show the this-computer sentence with the old model', () => {
    localStorage.setItem('aigate:local-llm-url', LOCAL);
    localStorage.setItem('aigate:local-llm-model', 'qwen3:4b');
    render(<App />);
    expect(statusLine().textContent).toContain(sentence.here('qwen3:4b'));
  });
});

describe('each place says its own sentence and no other (TC-R18-MS-2-01, -02, -03)', () => {
  it('TC-R18-MS-2-01 / -02: this computer', () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    render(<App />);
    expect(statusLine().textContent).toContain(sentence.here('qwen3:4b'));
    expect(statusLine().textContent).not.toContain("Your description will be sent to");
  });

  it('TC-R18-MS-2-01 / -02 / -03: the firm server, before any typing, with neither of the other sentences', () => {
    updateModelSetting({ place: 'firm-server', url: FIRM, model: 'qwen3:4b' });
    render(<App />);
    expect(screen.getByLabelText(/what ai tool do you want to use/i)).toHaveValue('');
    expect(statusLine().textContent).toContain(sentence.firm('qwen3:4b', FIRM));
    expect(page()).not.toMatch(/never leaves your computer/i);
    expect(page()).not.toContain("Your description will be sent to Ollama's cloud");
    expect(page()).not.toContain('Your description will be read on this computer');
  });

  it('TC-R18-MS-2-01 / -02: Ollama cloud', () => {
    updateModelSetting({ place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' });
    render(<App />);
    expect(statusLine().textContent).toContain(sentence.cloud('gemma4:cloud'));
    expect(page()).not.toMatch(/never leaves your computer/i);
  });

  it('TC-R18-MS-2-06: the small print stays in Settings and is not on the description screen', () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    render(<App />);
    expect(statusLine().textContent).not.toContain(R18_COPY.TUNNEL_SMALL_PRINT);
    expect(statusLine().textContent).not.toContain("We can't check that this is your firm's server");
  });
});

describe('a stored Anthropic key (TC-R18-MS-2-07)', () => {
  it('withholds the promise on the description screen and says what is sent; removed, the promise returns', () => {
    localStorage.setItem('aigate:api-key', 'sk-test-not-real');
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    const view = render(<App />);
    expect(statusLine().textContent).toContain(
      'A saved Anthropic key is also set, so the similar-case check and the explanation send text to Anthropic.',
    );
    expect(statusLine().textContent).not.toMatch(/never leaves your computer/i);
    view.unmount();
    localStorage.removeItem('aigate:api-key');
    render(<App />);
    expect(statusLine().textContent).toContain('It never leaves your computer.');
  });
});

describe('a rewritten setting is never under a promise (TC-R18-MS-1-10)', () => {
  it('the look-alike rewrite reads as not valid, with no promise, no notice, and no request', async () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    localStorage.setItem(
      MODEL_SETTING_KEY,
      JSON.stringify({ version: 1, place: 'this-computer', url: 'http://evil.example:11434', model: 'qwen3:4b' }),
    );
    const user = userEvent.setup({ delay: null });
    render(<App />);
    expect(statusLine().textContent).toBe(R18_COPY.INVALID_SETTING_SENTENCE);
    expect(page()).not.toMatch(/never leaves your computer/i);
    expect(page()).not.toContain(DEMO);

    // Reading the description makes no request, and the form says only what is true.
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'It reads client names and account details.');
    await pressNext(user);
    await user.click(await screen.findByRole('button', { name: /continue →|mine is different/i }, DUP_CHECK_WAIT));
    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
    expect(fetchCalls).toEqual([]);
    expect(page()).not.toMatch(/never leaves your computer/i);
  });

  it.each([
    ['unparseable', '{garbage'],
    ['a stored credential field', JSON.stringify({ version: 1, place: 'firm-server', url: FIRM, model: 'm:1', apiKey: 'x' })],
    ['a cloud-tagged model under this computer', JSON.stringify({ version: 1, place: 'this-computer', url: LOCAL, model: 'm:cloud' })],
    ['credentials in the address', JSON.stringify({ version: 1, place: 'firm-server', url: 'https://u:p@ai.example-firm.test', model: 'm:1' })],
  ])('%s reads as not valid', (_n, raw) => {
    localStorage.setItem(MODEL_SETTING_KEY, raw);
    render(<App />);
    expect(statusLine().textContent).toBe(R18_COPY.INVALID_SETTING_SENTENCE);
  });
});

describe('the unencrypted line (TC-R18-MS-6-01..03)', () => {
  it('TC-R18-MS-6-01: shown for an http firm address, in the status line', () => {
    updateModelSetting({ place: 'firm-server', url: 'http://ai.example-firm.test:8080', model: 'qwen3:4b' });
    render(<App />);
    expect(statusLine().textContent).toContain(R18_COPY.UNENCRYPTED_LINE);
  });
  it('TC-R18-MS-6-02: not shown for an https firm address, which keeps its sentence', () => {
    updateModelSetting({ place: 'firm-server', url: FIRM, model: 'qwen3:4b' });
    render(<App />);
    expect(statusLine().textContent).toContain(sentence.firm('qwen3:4b', FIRM));
    expect(page()).not.toContain(R18_COPY.UNENCRYPTED_LINE);
  });
  it('TC-R18-MS-6-03: never shown for this computer, even over http', () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    render(<App />);
    expect(page()).not.toContain(R18_COPY.UNENCRYPTED_LINE);
  });
  it('is not shown with no model, even if a firm http address is stored', () => {
    localStorage.setItem(MODEL_SETTING_KEY, JSON.stringify({ version: 1, place: 'firm-server', url: 'http://ai.example-firm.test', model: '' }));
    render(<App />);
    expect(statusLine().textContent).toBe(R18_COPY.NO_MODEL_SENTENCE);
    expect(page()).not.toContain(R18_COPY.UNENCRYPTED_LINE);
  });
});

describe('the demonstration notice (TC-R18-PS-4-01..03, -05)', () => {
  it.each([
    ['the firm server', { place: 'firm-server', url: FIRM, model: 'qwen3:4b' }],
    ["Ollama's cloud", { place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' }],
  ] as const)('TC-R18-PS-4-01: shown under %s', (_n, setting) => {
    updateModelSetting({ ...setting });
    render(<App />);
    expect(page()).toContain(DEMO);
  });

  it('TC-R18-PS-4-02: never under this computer or with no model', () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    const view = render(<App />);
    expect(page()).not.toContain(DEMO);
    expect(screen.getByLabelText(/what ai tool do you want to use/i)).toBeInTheDocument();
    view.unmount();
    forgetModelSetting();
    render(<App />);
    expect(page()).not.toContain(DEMO);
  });

  it('TC-R18-PS-4-02 (false state): not shown for a firm server with no model chosen, nor for an invalid setting', () => {
    localStorage.setItem(MODEL_SETTING_KEY, JSON.stringify({ version: 1, place: 'firm-server', url: FIRM, model: '' }));
    const view = render(<App />);
    expect(page()).not.toContain(DEMO);
    view.unmount();
    localStorage.setItem(MODEL_SETTING_KEY, JSON.stringify({ version: 1, place: 'firm-server', url: 'ftp://x', model: 'm:1' }));
    render(<App />);
    expect(page()).not.toContain(DEMO);
  });

  it('TC-R18-PS-4-03: plain text in the page flow, no dismiss control, no dialog, and Next is not blocked', async () => {
    updateModelSetting({ place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const notice = screen.getByText(DEMO);
    expect(notice.tagName).toBe('P');
    expect(notice.closest('[role="dialog"], [aria-modal="true"], dialog')).toBeNull();
    expect(within(notice.parentElement!).queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelectorAll('dialog, [role="dialog"], [aria-modal="true"]')).toHaveLength(0);
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'Something.');
    expect(screen.getByRole('button', { name: /^next/i })).toBeEnabled();
  });

  describe('TC-R18-PS-4-05: the shared-site sentence', () => {
    const realLocation = window.location;
    afterEach(() => vi.unstubAllGlobals());
    beforeEach(() => {
      fetchCalls = [];
    });

    function from(hostname: string) {
      vi.stubGlobal('location', { ...realLocation, hostname });
    }

    it('shows on github.io', () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('x'))));
      updateModelSetting({ place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' });
      from('oza977-max.github.io');
      render(<App />);
      expect(page()).toContain(R18_COPY.SHARED_ORIGIN_NOTE);
      expect(page()).toContain(DEMO);
    });
    it.each(['localhost', '127.0.0.1', 'evilgithub.io', 'github.io.evil.example'])('does not show on %s', (host) => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('x'))));
      updateModelSetting({ place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' });
      from(host);
      render(<App />);
      expect(page()).not.toContain(R18_COPY.SHARED_ORIGIN_NOTE);
      expect(page()).toContain(DEMO);
    });
    it('does not show on github.io when no notice is shown (this computer)', () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('x'))));
      updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
      from('oza977-max.github.io');
      render(<App />);
      expect(page()).not.toContain(R18_COPY.SHARED_ORIGIN_NOTE);
    });
  });
});

describe('the label beside the model (TC-R18-GI-12-01, -02, -03, -06)', () => {
  const run = (over: Partial<ModelTestResult> = {}): ModelTestResult => ({
    model: 'gemma4:cloud', place: 'ollama-cloud', host: LOCAL, date: '2026-10-07', casesRun: 31, stopped: false,
    verdictMatches: 21, discarded: {}, perQuestion: {}, ...over,
  });
  const seed = (r: ModelTestResult) =>
    localStorage.setItem(MODEL_TEST_RESULTS_KEY, JSON.stringify({ version: 1, results: [r] }));

  it('TC-R18-GI-12-01: no result is untested and carries neither a count nor the caveat', () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    render(<App />);
    expect(statusLine().textContent).toContain('qwen3:4b: untested');
    expect(statusLine().textContent).not.toMatch(/tested \d/);
    expect(statusLine().textContent).not.toContain(R18_COPY.TEST_ASSUMPTION_SUFFIX);
  });

  it('TC-R18-GI-12-02 / -06: a completed run reads tested 21/31 on the date with the caveat, and not untested', () => {
    updateModelSetting({ place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' });
    seed(run());
    render(<App />);
    expect(statusLine().textContent).toContain('gemma4:cloud: tested 21/31 on 2026-10-07 (measured as if you check every filled answer)');
    expect(statusLine().textContent).not.toContain('untested');
  });

  it('TC-R18-GI-12-03: a result for one model does not label the next', () => {
    updateModelSetting({ place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' });
    seed(run());
    updateModelSetting({ place: 'this-computer', model: 'qwen3:4b' });
    render(<App />);
    expect(statusLine().textContent).toContain('qwen3:4b: untested');
    expect(statusLine().textContent).not.toContain('tested 21/31');
  });

  it('a stopped run reads as untested with the partial note (never tested)', () => {
    updateModelSetting({ place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' });
    seed(run({ stopped: true, casesRun: 7 }));
    render(<App />);
    expect(statusLine().textContent).toContain('untested (a partial test stopped after 7 of 31 cases)');
    expect(statusLine().textContent).not.toContain('tested 21/31');
  });

  it('a result for the same model name at another address does not label this one', () => {
    updateModelSetting({ place: 'ollama-cloud', url: 'http://127.0.0.1:11434', model: 'gemma4:cloud' });
    seed(run());
    render(<App />);
    expect(statusLine().textContent).toContain('gemma4:cloud: untested');
  });
});

describe('the status follows the setting without a reload (in-page change event)', () => {
  it('saving, changing and forgetting in the page update the line', async () => {
    render(<App />);
    expect(statusLine().textContent).toBe(R18_COPY.NO_MODEL_SENTENCE);
    act(() => {
      updateModelSetting({ place: 'firm-server', url: FIRM, model: 'alpha:7b' });
    });
    expect(statusLine().textContent).toContain(sentence.firm('alpha:7b', FIRM));
    expect(page()).toContain(DEMO);
    act(() => {
      updateModelSetting({ model: 'beta:7b' });
    });
    expect(statusLine().textContent).toContain(sentence.firm('beta:7b', FIRM));
    expect(statusLine().textContent).not.toContain('alpha:7b');
    act(() => {
      forgetModelSetting();
    });
    expect(statusLine().textContent).toBe(R18_COPY.NO_MODEL_SENTENCE);
    expect(page()).not.toContain(DEMO);
  });

  it('a change made in another tab (storage event) shows too', () => {
    render(<App />);
    localStorage.setItem(MODEL_SETTING_KEY, JSON.stringify({ version: 1, place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: MODEL_SETTING_KEY }));
    });
    expect(statusLine().textContent).toContain(sentence.cloud('gemma4:cloud'));
  });
});

describe('no model is called by anything this chunk builds', () => {
  it('rendering the description screen with every kind of setting makes no request', () => {
    for (const s of [
      { place: 'this-computer', url: LOCAL, model: 'qwen3:4b' },
      { place: 'firm-server', url: FIRM, model: 'qwen3:4b' },
      { place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' },
    ] as const) {
      localStorage.clear();
      updateModelSetting({ ...s });
      const view = render(<App />);
      view.unmount();
    }
    expect(fetchCalls).toEqual([]);
  });
});
