import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPanel from '../SettingsPanel';
import { R18_COPY } from '../plain-copy';
import { MODEL_SETTING_KEY, MODEL_TEST_RESULTS_KEY, updateModelSetting } from '../../llm/model-setting';
import { enableLocalLlm } from '../../llm/local-provider';
import type { ModelPlace, ModelTestResult } from '../../engine/prefill-types';

// R18-B, the Settings model section (specs/intake-flow.md §27.8). Real component,
// real storage; only the network is faked (and the fake rejects when its signal
// aborts, TDD-2). Assertions are on what a person sees (role / name).

const S = R18_COPY.SETTINGS;
const LABEL = R18_COPY.PLACE_CHOICE_LABELS;
const FIRM = 'https://ai.example-firm.test:8443';
const LOCAL = 'http://localhost:11434';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function stored() {
  const raw = localStorage.getItem(MODEL_SETTING_KEY);
  return raw === null ? null : JSON.parse(raw);
}

function fakeFetch(reply: (url: string, init: RequestInit) => Response | 'hang' | 'throw') {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      const out = reply(url, init);
      if (out === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
      if (out === 'hang') {
        return new Promise<Response>((_res, rej) => {
          init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        });
      }
      return Promise.resolve(out);
    }),
  );
  return calls;
}
const tags = (...names: string[]) =>
  new Response(JSON.stringify({ models: names.map((name) => ({ name })) }), { status: 200 });

type User = ReturnType<typeof userEvent.setup>;

async function open(user: User) {
  await user.click(screen.getByText(S.SUMMARY));
  return screen.getByText(S.SUMMARY).closest('details') as HTMLElement;
}
async function choose(user: User, place: ModelPlace) {
  await user.click(screen.getByRole('radio', { name: LABEL[place] }));
}
async function type(user: User, label: string, text: string) {
  const field = screen.getByLabelText(label);
  await user.clear(field);
  if (text) {
    await user.click(field);
    await user.paste(text);
  }
}
async function save(user: User) {
  await user.click(screen.getByRole('button', { name: S.SAVE }));
}
async function fillAndSave(user: User, place: ModelPlace, url: string, model: string) {
  await choose(user, place);
  await type(user, S.ADDRESS_LABEL, url);
  await type(user, S.MODEL_LABEL, model);
  await save(user);
}
const sentenceFor = (place: ModelPlace, model: string, url = LOCAL) =>
  place === 'this-computer'
    ? `Your description will be read on this computer by ${model}. It never leaves your computer.`
    : place === 'firm-server'
      ? `Your description will be sent to your firm's server at ${url} and read by ${model}.`
      : `Your description will be sent to Ollama's cloud and read by ${model}.`;

describe('the three places (TC-R18-MS-1-01..09)', () => {
  it('TC-R18-MS-1-01: the three choices carry their names, none is chosen, and Save with no place stores nothing', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).labels?.[0]?.textContent?.trim())).toEqual([
      'On this computer',
      "On my firm's server",
      "Ollama's cloud, through the Ollama app on this computer",
    ]);
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);

    await type(user, S.ADDRESS_LABEL, LOCAL);
    await type(user, S.MODEL_LABEL, 'qwen3:4b');
    await save(user);
    expect(screen.getByText(R18_COPY.REFUSAL_SENTENCES['no-place'])).toBeInTheDocument();
    expect(stored()).toBeNull();
  });

  it('TC-R18-MS-1-03: a cloud-tagged model is refused on this computer and saved under Ollama cloud', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await fillAndSave(user, 'this-computer', LOCAL, 'gemma4:cloud');
    expect(screen.getByText(R18_COPY.REFUSAL_SENTENCES['cloud-model-elsewhere'])).toBeInTheDocument();
    expect(stored()).toBeNull();
    await choose(user, 'ollama-cloud');
    await save(user);
    expect(stored()).toMatchObject({ place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' });
    expect(screen.getByText(S.SAVED)).toBeInTheDocument();
  });

  it('TC-R18-MS-1-04: the firm address is refused on this computer (nothing stored) and saved as the firm server', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await fillAndSave(user, 'this-computer', FIRM, 'qwen3:4b');
    expect(screen.getByText(R18_COPY.REFUSAL_SENTENCES['not-this-computer'])).toBeInTheDocument();
    expect(localStorage.getItem(MODEL_SETTING_KEY) ?? '').not.toContain('example-firm');
    await choose(user, 'firm-server');
    await save(user);
    expect(stored()).toMatchObject({ place: 'firm-server', url: FIRM });
  });

  it('TC-R18-MS-1-05: the saved setting records the choice and a reload shows it again', async () => {
    const user = userEvent.setup({ delay: null });
    const first = render(<SettingsPanel />);
    await open(user);
    await fillAndSave(user, 'this-computer', LOCAL, 'qwen3:4b');
    first.unmount();

    render(<SettingsPanel />);
    await open(user);
    expect(screen.getByRole('radio', { name: LABEL['this-computer'] })).toBeChecked();
    expect(screen.getByLabelText(S.ADDRESS_LABEL)).toHaveValue(LOCAL);
    expect(screen.getByLabelText(S.MODEL_LABEL)).toHaveValue('qwen3:4b');
    expect(screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked)).toHaveLength(1);
  });

  it('TC-R18-MS-1-06: a cloud-tagged model is refused under the firm server with the cloud-only sentence', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await fillAndSave(user, 'firm-server', FIRM, 'gpt-oss:120b-cloud');
    expect(screen.getByText(/can only be saved under Ollama's cloud/i)).toBeInTheDocument();
    expect(stored()).toBeNull();
  });

  it.each([
    'http://localhost.evil.example:11434',
    'http://127.0.0.1.evil.example:11434',
    'http://evil.example/localhost',
    'http://localhost@evil.example:11434',
  ])('TC-R18-MS-1-07: the look-alike %s is refused on this computer', async (bad) => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await fillAndSave(user, 'this-computer', bad, 'qwen3:4b');
    expect(stored()).toBeNull();
    expect(document.body.textContent).toMatch(/can.t be used|needs an address on this computer|Leave a user name/);
  });

  it.each(['http://localhost:11434', 'http://127.0.0.1:11434', 'http://[::1]:11434'])(
    'TC-R18-MS-1-07: %s is accepted on this computer',
    async (good) => {
      const user = userEvent.setup({ delay: null });
      render(<SettingsPanel />);
      await open(user);
      await fillAndSave(user, 'this-computer', good, 'qwen3:4b');
      expect(stored()).toMatchObject({ place: 'this-computer', url: good });
    },
  );

  it('TC-R18-MS-1-08: Ollama cloud with a firm address says the cloud choice goes through the Ollama app on this computer', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await fillAndSave(user, 'ollama-cloud', FIRM, 'gemma4:cloud');
    expect(screen.getByText(/through the Ollama app on this computer, so the address must be on this computer/i)).toBeInTheDocument();
    expect(stored()).toBeNull();
  });

  it('TC-R18-MS-1-09: Ollama cloud with an untagged model says it needs the cloud tag', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await fillAndSave(user, 'ollama-cloud', LOCAL, 'qwen3:4b');
    expect(screen.getByText(/needs a model carrying Ollama's cloud tag/i)).toBeInTheDocument();
    expect(stored()).toBeNull();
  });

  it('a refusal leaves an earlier valid setting in storage and does not say Saved', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await fillAndSave(user, 'this-computer', LOCAL, 'qwen3:4b');
    await type(user, S.MODEL_LABEL, 'other:cloud');
    await save(user);
    expect(stored()).toMatchObject({ model: 'qwen3:4b' });
    expect(screen.queryByText(S.SAVED)).not.toBeInTheDocument();
  });

  it('a double click on Save leaves one consistent stored setting', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await choose(user, 'this-computer');
    await type(user, S.ADDRESS_LABEL, LOCAL);
    await type(user, S.MODEL_LABEL, 'qwen3:4b');
    await user.dblClick(screen.getByRole('button', { name: S.SAVE }));
    expect(stored()).toEqual({ version: 1, place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
  });
});

describe('migration (TC-R18-MS-1-11)', () => {
  it('BC-003: the old keys as the baseline wrote them show as this computer, with the model, in Settings', async () => {
    enableLocalLlm('http://localhost:11434/', 'qwen3:4b');
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    expect(screen.getByRole('radio', { name: LABEL['this-computer'] })).toBeChecked();
    expect(screen.getByLabelText(S.MODEL_LABEL)).toHaveValue('qwen3:4b');
    expect(localStorage.getItem('aigate:local-llm-url')).toBeNull();
  });

  it('TC-R18-MS-1-11: an old URL-only setting shows the place and address and NO pre-selected model', async () => {
    localStorage.setItem('aigate:local-llm-url', LOCAL);
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    expect(screen.getByRole('radio', { name: LABEL['this-computer'] })).toBeChecked();
    expect(screen.getByLabelText(S.ADDRESS_LABEL)).toHaveValue(LOCAL);
    expect(screen.getByLabelText(S.MODEL_LABEL)).toHaveValue('');
    expect(localStorage.getItem('aigate:local-llm-model')).toBeNull();
  });
});

describe('bounds (TC-R18-MS-1-12)', () => {
  it('a 101-character model name and a name with U+202E are refused with a plain sentence and nothing is stored', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await fillAndSave(user, 'this-computer', LOCAL, 'm'.repeat(101));
    expect(screen.getByText(R18_COPY.REFUSAL_SENTENCES['model-too-long'])).toBeInTheDocument();
    await type(user, S.MODEL_LABEL, 'mod‮el');
    await save(user);
    expect(screen.getByText(R18_COPY.REFUSAL_SENTENCES['model-characters'])).toBeInTheDocument();
    expect(stored()).toBeNull();
  });

  it('an address of 501 characters is refused', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await fillAndSave(user, 'firm-server', 'https://ai.example-firm.test/' + 'a'.repeat(480), 'm:1');
    expect(screen.getByText(R18_COPY.REFUSAL_SENTENCES['address-too-long'])).toBeInTheDocument();
    expect(stored()).toBeNull();
  });
});

describe('Find models (TC-R18-MS-1-12, -13, MS-3-01, -03)', () => {
  it('TC-R18-MS-1-13: under Ollama cloud the list loads before any model is typed: one GET, no body, no case text', async () => {
    const calls = fakeFetch(() => tags('alpha:cloud', 'beta:cloud'));
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await choose(user, 'ollama-cloud');
    await type(user, S.ADDRESS_LABEL, LOCAL);
    await user.click(screen.getByRole('button', { name: S.FIND_MODELS }));
    const list = await screen.findByRole('list', { name: S.MODEL_LIST_LABEL });
    expect(within(list).getByRole('button', { name: /alpha:cloud/ })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /beta:cloud/ })).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://localhost:11434/api/tags');
    expect(calls[0]!.init.method ?? 'GET').toBe('GET');
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it('TC-R18-MS-3-01: every reported model is offered, picking one fills the field, and a typed one is accepted', async () => {
    fakeFetch(() => tags('alpha:1b', 'beta:7b', 'gamma:70b'));
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await choose(user, 'firm-server');
    await type(user, S.ADDRESS_LABEL, FIRM);
    await user.click(screen.getByRole('button', { name: S.FIND_MODELS }));
    const list = await screen.findByRole('list', { name: S.MODEL_LIST_LABEL });
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['alpha:1b', 'beta:7b', 'gamma:70b']);
    await user.click(within(list).getByRole('button', { name: /beta:7b/ }));
    expect(screen.getByLabelText(S.MODEL_LABEL)).toHaveValue('beta:7b');
    await type(user, S.MODEL_LABEL, 'delta:2b');
    await save(user);
    expect(stored()).toMatchObject({ model: 'delta:2b' });
    expect(within(list).queryByRole('button', { name: /delta/ })).not.toBeInTheDocument();
  });

  it('TC-R18-MS-1-12: a 150-character name is not offered and a U+200B name is shown escaped', async () => {
    fakeFetch(() => tags('ok:1b', 'x'.repeat(150), 'z​:1b'));
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await choose(user, 'this-computer');
    await type(user, S.ADDRESS_LABEL, LOCAL);
    await user.click(screen.getByRole('button', { name: S.FIND_MODELS }));
    const list = await screen.findByRole('list', { name: S.MODEL_LIST_LABEL });
    const names = within(list).getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['ok:1b', 'z⟦U+200B⟧:1b']);
    // picking the hidden-character name cannot be saved
    await user.click(within(list).getByRole('button', { name: /⟦U\+200B⟧/ }));
    await save(user);
    expect(stored()).toBeNull();
    expect(screen.getByText(R18_COPY.REFUSAL_SENTENCES['model-characters'])).toBeInTheDocument();
  });

  it('TC-R18-MS-3-03: an unreachable server gives one plain sentence, no raw error, and a typed model still saves', async () => {
    fakeFetch(() => 'throw');
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await choose(user, 'firm-server');
    await type(user, S.ADDRESS_LABEL, FIRM);
    await user.click(screen.getByRole('button', { name: S.FIND_MODELS }));
    expect(await screen.findByText(R18_COPY.FIND_MODELS_FAILED)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/failed to fetch|TypeError/i);
    await type(user, S.MODEL_LABEL, 'epsilon:3b');
    await save(user);
    expect(stored()).toMatchObject({ place: 'firm-server', model: 'epsilon:3b' });
  });

  it.each([['404', () => new Response('nope', { status: 404 })], ['HTML', () => new Response('<html></html>', { status: 200 })]])(
    'TC-R18-MS-3-03: a server answering %s gives the same sentence',
    async (_n, reply) => {
      fakeFetch(reply);
      const user = userEvent.setup({ delay: null });
      render(<SettingsPanel />);
      await open(user);
      await choose(user, 'this-computer');
      await type(user, S.ADDRESS_LABEL, LOCAL);
      await user.click(screen.getByRole('button', { name: S.FIND_MODELS }));
      expect(await screen.findByText(R18_COPY.FIND_MODELS_FAILED)).toBeInTheDocument();
    },
  );

  it('Find models validates the address first: a look-alike address makes no request and shows a refusal', async () => {
    const calls = fakeFetch(() => tags('a:1'));
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await choose(user, 'this-computer');
    await type(user, S.ADDRESS_LABEL, 'http://localhost@evil.example:11434');
    await user.click(screen.getByRole('button', { name: S.FIND_MODELS }));
    expect(calls).toHaveLength(0);
    expect(screen.getByText(R18_COPY.REFUSAL_SENTENCES['address-credentials'])).toBeInTheDocument();
  });

  it('Find models with no place chosen makes no request', async () => {
    const calls = fakeFetch(() => tags('a:1'));
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await type(user, S.ADDRESS_LABEL, LOCAL);
    await user.click(screen.getByRole('button', { name: S.FIND_MODELS }));
    expect(calls).toHaveLength(0);
    expect(screen.getByText(R18_COPY.REFUSAL_SENTENCES['no-place'])).toBeInTheDocument();
  });

  it('nothing is requested until Find models is pressed: typing an address and a model calls no server', async () => {
    const calls = fakeFetch(() => tags('a:1'));
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await choose(user, 'this-computer');
    await type(user, S.ADDRESS_LABEL, LOCAL);
    await type(user, S.MODEL_LABEL, 'qwen3:4b');
    await save(user);
    expect(calls).toHaveLength(0);
  });

  it('unmounting while the list is loading aborts the request', async () => {
    const calls = fakeFetch(() => 'hang');
    const user = userEvent.setup({ delay: null });
    const view = render(<SettingsPanel />);
    await open(user);
    await choose(user, 'this-computer');
    await type(user, S.ADDRESS_LABEL, LOCAL);
    await user.click(screen.getByRole('button', { name: S.FIND_MODELS }));
    await waitFor(() => expect(calls).toHaveLength(1));
    view.unmount();
    expect(calls[0]!.init.signal!.aborted).toBe(true);
  });
});

describe('the where-it-goes sentence in Settings (TC-R18-MS-2-01, -02, -03, -06, -07)', () => {
  const cases: Array<[ModelPlace, string, string]> = [
    ['this-computer', LOCAL, 'qwen3:4b'],
    ['firm-server', 'https://ai.example-firm.test:8443', 'qwen3:4b'],
    ['ollama-cloud', LOCAL, 'gemma4:cloud'],
  ];

  it.each(cases)('TC-R18-MS-2-01: %s shows its own sentence and neither of the other two', async (place, url, model) => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    await fillAndSave(user, place, url, model);
    const text = section.textContent ?? '';
    expect(text).toContain(sentenceFor(place, model, url));
    for (const [other] of cases) {
      if (other !== place) expect(text).not.toContain(sentenceFor(other, model, url).split(' by ')[0]!.split(' at ')[0]!);
    }
  });

  it('TC-R18-MS-2-03: the sentence is in the set-up form while the choice is being made, before saving, marked as not yet saved', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    expect(section.textContent).not.toMatch(/Your description will be/);
    await choose(user, 'firm-server');
    await type(user, S.ADDRESS_LABEL, FIRM);
    await type(user, S.MODEL_LABEL, 'qwen3:4b');
    expect(section.textContent).toContain(sentenceFor('firm-server', 'qwen3:4b', FIRM));
    expect(section.textContent).toContain(S.NOT_SAVED_YET);
    expect(stored()).toBeNull();
    await save(user);
    expect(section.textContent).toContain(sentenceFor('firm-server', 'qwen3:4b', FIRM));
    expect(section.textContent).not.toContain(S.NOT_SAVED_YET);
  });

  it('BC-005: no sentence while the form does not validate (a promise is never shown over a refused address)', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    await choose(user, 'this-computer');
    await type(user, S.ADDRESS_LABEL, 'http://localhost.evil.example:11434');
    await type(user, S.MODEL_LABEL, 'qwen3:4b');
    expect(section.textContent).not.toMatch(/never leaves your computer/i);
    expect(section.textContent).not.toMatch(/Your description will be/);
  });

  it('TC-R18-MS-2-02: "never leaves your computer" is said only for this computer', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    expect(section.textContent).not.toMatch(/never leaves your computer/i); // no model configured
    await fillAndSave(user, 'firm-server', FIRM, 'qwen3:4b');
    expect(section.textContent).not.toMatch(/never leaves your computer/i);
    await choose(user, 'ollama-cloud');
    await type(user, S.ADDRESS_LABEL, LOCAL);
    await type(user, S.MODEL_LABEL, 'gemma4:cloud');
    expect(section.textContent).not.toMatch(/never leaves your computer/i);
    await choose(user, 'this-computer');
    await type(user, S.MODEL_LABEL, 'qwen3:4b');
    expect(section.textContent).toMatch(/never leaves your computer/i);
  });

  it('TC-R18-MS-2-06: this computer shows the tunnel small print, the firm server shows its own, never both', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    await choose(user, 'this-computer');
    expect(section.textContent).toContain(R18_COPY.TUNNEL_SMALL_PRINT);
    expect(section.textContent).not.toContain("We can't check that this is your firm's server");
    await choose(user, 'firm-server');
    expect(section.textContent).toContain("We can't check that this is your firm's server");
    expect(section.textContent).not.toContain(R18_COPY.TUNNEL_SMALL_PRINT);
    await choose(user, 'ollama-cloud');
    expect(section.textContent).not.toContain(R18_COPY.TUNNEL_SMALL_PRINT);
    expect(section.textContent).not.toContain("We can't check that this is your firm's server");
  });

  it('TC-R18-MS-2-07: with a stored Anthropic key the promise is withheld and the key sentence shows; removed, the promise returns', async () => {
    localStorage.setItem('aigate:api-key', 'sk-test-not-real');
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    const user = userEvent.setup({ delay: null });
    const view = render(<SettingsPanel />);
    const section = await open(user);
    expect(section.textContent).toContain(
      'A saved Anthropic key is also set, so the similar-case check and the explanation send text to Anthropic.',
    );
    expect(section.textContent).not.toMatch(/never leaves your computer/i);
    view.unmount();
    localStorage.removeItem('aigate:api-key');
    render(<SettingsPanel />);
    const again = await open(user);
    expect(again.textContent).toMatch(/It never leaves your computer\./);
    expect(again.textContent).not.toMatch(/Anthropic/);
  });

  it('TC-R18-MS-1-10 (Settings part): a stored setting rewritten to a look-alike address is shown as invalid, never under a promise', async () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    localStorage.setItem(MODEL_SETTING_KEY, JSON.stringify({ version: 1, place: 'this-computer', url: 'http://evil.example:11434', model: 'qwen3:4b' }));
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    expect(section.textContent).toContain(R18_COPY.INVALID_SETTING_SENTENCE);
    expect(section.textContent).not.toMatch(/never leaves your computer/i);
    expect(section.textContent).not.toMatch(/Your description will be/);
  });
});

describe('the unencrypted line (TC-R18-MS-6-01..03)', () => {
  it('TC-R18-MS-6-01: a plain-http firm address saves, and the line shows', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    await fillAndSave(user, 'firm-server', 'http://ai.example-firm.test:8080', 'qwen3:4b');
    expect(stored()).toMatchObject({ url: 'http://ai.example-firm.test:8080' });
    expect(section.textContent).toContain(R18_COPY.UNENCRYPTED_LINE);
  });

  it('TC-R18-MS-6-02: an https firm address shows the sentence and no such line', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    await fillAndSave(user, 'firm-server', FIRM, 'qwen3:4b');
    expect(section.textContent).toContain(sentenceFor('firm-server', 'qwen3:4b', FIRM));
    expect(section.textContent).not.toContain(R18_COPY.UNENCRYPTED_LINE);
  });

  it('TC-R18-MS-6-03: this computer never shows the line, even over http', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    await fillAndSave(user, 'this-computer', LOCAL, 'qwen3:4b');
    expect(section.textContent).toContain(sentenceFor('this-computer', 'qwen3:4b'));
    expect(section.textContent).not.toContain(R18_COPY.UNENCRYPTED_LINE);
  });

  it('the line is not shown for an http address that was refused or not typed (false state)', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    await choose(user, 'firm-server');
    expect(section.textContent).not.toContain(R18_COPY.UNENCRYPTED_LINE);
    await type(user, S.ADDRESS_LABEL, 'http://u:p@ai.example-firm.test');
    expect(section.textContent).not.toContain(R18_COPY.UNENCRYPTED_LINE);
  });
});

describe('copy and controls (TC-R18-MS-3-02, PS-5-02)', () => {
  it('TC-R18-MS-3-02: no model name or recommendation, an empty model field, no list options chosen for the person', async () => {
    fakeFetch(() => 'throw');
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    expect(screen.getByLabelText(S.MODEL_LABEL)).toHaveValue('');
    expect(section.querySelectorAll('option[selected], [aria-selected="true"]')).toHaveLength(0);
    expect(section.textContent).not.toMatch(/qwen|gemma|gpt-oss|\bllama|mistral|recommended|\bbest\b|we suggest/i);
    expect(document.body.textContent).not.toMatch(/tested with the open-source/i);
  });

  it('TC-R18-PS-5-02: no password-type control, no label asking for a key, token, secret or password, and the stored setting has no credential field', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    expect(section.querySelectorAll('input[type="password"]')).toHaveLength(0);
    const names = [...section.querySelectorAll('input, button, select, textarea, label, legend')].map(
      (el) => `${el.textContent} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('placeholder') ?? ''}`,
    );
    expect(names.filter((n) => /\b(key|token|secret|password)\b/i.test(n))).toEqual([]);
    await fillAndSave(user, 'firm-server', FIRM, 'qwen3:4b');
    expect(Object.keys(stored()).sort()).toEqual(['model', 'place', 'url', 'version']);
  });

  it('the old probe controls and the hard-coded model copy are gone', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    expect(screen.queryByRole('button', { name: /test & save/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/disable local model/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/qwen|digest: sha256/i);
  });

  it('the resend note and the interface note are shown once a place is chosen', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    await choose(user, 'firm-server');
    expect(section.textContent).toContain(R18_COPY.FALLBACK_RESEND_NOTE);
    expect(section.textContent).toContain(S.ADDRESS_HELP);
  });
});

describe('the label (TC-R18-GI-12-01, -02, -03, -06)', () => {
  const result = (over: Partial<ModelTestResult> = {}): ModelTestResult => ({
    model: 'gemma4:cloud', place: 'ollama-cloud', host: LOCAL, date: '2026-10-07', casesRun: 31, stopped: false,
    verdictMatches: 21, discarded: {}, perQuestion: {}, ...over,
  });
  const seedResult = (r: ModelTestResult) =>
    localStorage.setItem(MODEL_TEST_RESULTS_KEY, JSON.stringify({ version: 1, results: [r] }));

  it('TC-R18-GI-12-01: a model with no result is untested, with no count and no suffix', async () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    expect(section.textContent).toContain('qwen3:4b: untested');
    expect(section.textContent).not.toMatch(/tested \d+\/31/);
    expect(section.textContent).not.toContain(R18_COPY.TEST_ASSUMPTION_SUFFIX);
  });

  it('TC-R18-GI-12-02 and -06: a completed result reads tested 21/31 on the date, with the caveat', async () => {
    updateModelSetting({ place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' });
    seedResult(result());
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    expect(section.textContent).toContain('gemma4:cloud: tested 21/31 on 2026-10-07 (measured as if you check every filled answer)');
    expect(section.textContent).not.toContain('untested');
  });

  it('TC-R18-GI-12-03: the result belongs to the model it was run for, not to the next one chosen', async () => {
    updateModelSetting({ place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' });
    seedResult(result());
    updateModelSetting({ place: 'this-computer', model: 'qwen3:4b' });
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    expect(section.textContent).toContain('qwen3:4b: untested');
    expect(section.textContent).not.toContain('tested 21/31');
  });

  it('a stopped run is untested with the partial note', async () => {
    updateModelSetting({ place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' });
    seedResult(result({ stopped: true, casesRun: 12 }));
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    expect(section.textContent).toContain('untested (a partial test stopped after 12 of 31 cases)');
    expect(section.textContent).not.toContain('tested 21/31');
  });
});

describe('save path and mode (TC-R18-MS-5-08)', () => {
  it('TC-R18-MS-5-08: changing the model, then the address, then the place through Save forgets the remembered mode', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    await fillAndSave(user, 'this-computer', LOCAL, 'alpha:1b');
    updateModelSetting({ mode: 'tool' });
    expect(stored().mode).toBe('tool');

    await save(user); // same values again: the mode is kept
    expect(stored().mode).toBe('tool');

    await type(user, S.MODEL_LABEL, 'beta:7b');
    await save(user);
    expect(stored().mode).toBeUndefined();

    updateModelSetting({ mode: 'format' });
    await type(user, S.ADDRESS_LABEL, 'http://127.0.0.1:11434');
    await save(user);
    expect(stored().mode).toBeUndefined();

    updateModelSetting({ mode: 'tool' });
    await choose(user, 'firm-server');
    await type(user, S.ADDRESS_LABEL, FIRM);
    await save(user);
    expect(stored().mode).toBeUndefined();
    expect(stored()).toMatchObject({ place: 'firm-server', url: FIRM, model: 'beta:7b' });
  });
});

describe('Forget the model setting and Clear all data (TC-R18-NF-3-08, MS-5-04, NF-3-02)', () => {
  const reload = vi.fn();
  const realLocation = window.location;
  beforeEach(() => {
    reload.mockClear();
    vi.stubGlobal('location', { ...realLocation, reload });
  });

  const resultsJson = JSON.stringify({
    version: 1,
    results: [{ model: 'qwen3:4b', place: 'this-computer', host: LOCAL, date: '2026-10-07', casesRun: 31, stopped: false, verdictMatches: 20, discarded: {}, perQuestion: {} }],
  });

  async function openClearConfirmation(user: User) {
    await user.click(screen.getByText(/demo data/i));
    await user.click(screen.getByRole('button', { name: /clear all data and start over/i }));
  }

  it('TC-R18-NF-3-08: with a setting, the confirmation says it is kept; Clear all data keeps the setting, its mode and its results; and drafts go', async () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    updateModelSetting({ mode: 'tool' });
    localStorage.setItem(MODEL_TEST_RESULTS_KEY, resultsJson);
    sessionStorage.setItem('aigate:intake-draft', JSON.stringify({ description: 'a distinctive draft text' }));
    const settingBefore = localStorage.getItem(MODEL_SETTING_KEY);
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await openClearConfirmation(user);
    expect(screen.getByRole('alert').textContent).toContain(R18_COPY.CLEAR_KEEPS_SETTING);
    await user.click(screen.getByRole('button', { name: /yes, delete everything/i }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(localStorage.getItem(MODEL_SETTING_KEY)).toBe(settingBefore);
    expect(JSON.parse(localStorage.getItem(MODEL_SETTING_KEY)!).mode).toBe('tool');
    expect(localStorage.getItem(MODEL_TEST_RESULTS_KEY)).toBe(resultsJson);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('distinctive draft');
  });

  it('TC-R18-NF-3-08 (false state): with no setting saved neither the sentence nor the Forget control is anywhere', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await openClearConfirmation(user);
    expect(screen.getByRole('alert').textContent).not.toContain('Your model setting (including its address)');
    expect(screen.queryByRole('button', { name: R18_COPY.FORGET_SETTING_LABEL })).not.toBeInTheDocument();
  });

  it('the kept-setting sentence is also in the message when the delete is incomplete', async () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    const resetStore = await import('../../store/reset');
    const spy = vi.spyOn(resetStore, 'clearAllLocalData').mockResolvedValueOnce({ complete: false, incomplete: ['aigate-audit (blocked)'] });
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await openClearConfirmation(user);
    await user.click(screen.getByRole('button', { name: /yes, delete everything/i }));
    expect((await screen.findByText(/not everything could be deleted/i)).textContent).toContain(R18_COPY.CLEAR_KEEPS_SETTING);
    spy.mockRestore();
  });

  it('TC-R18-NF-3-08: Forget the model setting removes both keys, empties the form, and the control and sentence go with it', async () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    localStorage.setItem(MODEL_TEST_RESULTS_KEY, resultsJson);
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    await user.click(screen.getByRole('button', { name: R18_COPY.FORGET_SETTING_LABEL }));
    expect(localStorage.getItem(MODEL_SETTING_KEY)).toBeNull();
    expect(localStorage.getItem(MODEL_TEST_RESULTS_KEY)).toBeNull();
    expect(screen.queryByRole('button', { name: R18_COPY.FORGET_SETTING_LABEL })).not.toBeInTheDocument();
    expect(screen.getByLabelText(S.MODEL_LABEL)).toHaveValue('');
    expect(screen.getByLabelText(S.ADDRESS_LABEL)).toHaveValue('');
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(section.textContent).not.toMatch(/Your description will be/);
    expect(section.textContent).toContain(R18_COPY.FORGOTTEN_SENTENCE);
  });

  it('the Forget control is not offered before anything is saved (false state)', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await open(user);
    expect(screen.queryByRole('button', { name: R18_COPY.FORGET_SETTING_LABEL })).not.toBeInTheDocument();
  });

  it('Forget is offered for an unreadable stored setting too, so a person can clear it', async () => {
    localStorage.setItem(MODEL_SETTING_KEY, '{garbage');
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    expect(section.textContent).toContain(R18_COPY.INVALID_SETTING_SENTENCE);
    await user.click(screen.getByRole('button', { name: R18_COPY.FORGET_SETTING_LABEL }));
    expect(localStorage.getItem(MODEL_SETTING_KEY)).toBeNull();
  });
});

describe('a change made elsewhere on the page shows here without a reload', () => {
  it('updateModelSetting from outside the panel refreshes its stored sentence', async () => {
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    const section = await open(user);
    expect(section.textContent).not.toMatch(/Your description will be/);
    await waitFor(() => {
      updateModelSetting({ place: 'ollama-cloud', url: LOCAL, model: 'gemma4:cloud' });
      expect(section.textContent).toContain("Your description will be sent to Ollama's cloud and read by gemma4:cloud.");
    });
  });
});
