import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import App from '../../App';
import MakeItSmarter from '../MakeItSmarter';
import {
  R18_COPY,
  OLLAMA_DOCS_CHECKED,
  OLLAMA_DOCS_URL,
  PUBLIC_SITE_ORIGIN,
  originsCommand,
  placeSentence,
} from '../plain-copy';
import { MODEL_SETTING_KEY, updateModelSetting, forgetModelSetting } from '../../llm/model-setting';

// R18-G, the "Make it smarter" panel (specs/intake-flow.md §27.12, R18-PS-2).

const LOCAL = 'http://localhost:11434';
const FIRM = 'https://ai.example-firm.test:8443';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const panel = () => screen.queryByRole('region', { name: /make it smarter/i });

describe('TC-R18-PS-2-01: the panel with no model, the one-line status with one', () => {
  it('with nothing stored it shows the titled panel with its explanation', () => {
    render(<App />);
    const p = panel();
    expect(p).not.toBeNull();
    expect(within(p!).getByRole('heading', { name: R18_COPY.PANEL_HEADING })).toBeInTheDocument();
    expect(p!.textContent).toContain(R18_COPY.PANEL_EXPLANATION);
  });

  it('an address with no model name (old URL-only setting) is still no model: the panel shows', () => {
    localStorage.setItem('aigate:local-llm-url', LOCAL);
    render(<App />);
    expect(panel()).not.toBeNull();
  });

  it('with a model on this computer the panel is gone and the one-line status names the model and the place', () => {
    updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    render(<App />);
    expect(panel()).toBeNull();
    const line = document.querySelector('.model-status__line')!;
    expect(line.textContent).toContain('qwen3:4b');
    expect(line.textContent).toContain(placeSentence({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' }, false));
    expect(document.body.textContent).not.toContain(R18_COPY.PANEL_EXPLANATION);
  });

  it('an invalid stored setting is not "no model": no panel, and the status says the setting is not valid', () => {
    localStorage.setItem(MODEL_SETTING_KEY, '{not json');
    render(<App />);
    expect(panel()).toBeNull();
    expect(document.querySelector('.model-status__line')!.textContent).toBe(R18_COPY.INVALID_SETTING_SENTENCE);
  });

  it('saving a model in this page, then forgetting it, swaps the panel and the status without a reload', async () => {
    render(<App />);
    expect(panel()).not.toBeNull();
    await act(async () => {
      updateModelSetting({ place: 'this-computer', url: LOCAL, model: 'qwen3:4b' });
    });
    expect(panel()).toBeNull();
    await act(async () => {
      forgetModelSetting();
    });
    expect(panel()).not.toBeNull();
  });

  it('renders nothing before the first read of the stored setting (no flash for someone who has a model)', () => {
    // A server render runs no effects, so it is exactly the first paint.
    expect(renderToString(<MakeItSmarter />)).toBe('');
  });
});

describe('TC-R18-PS-2-02: exactly two commands, a link and a dated check', () => {
  function text() {
    render(<MakeItSmarter />);
    return screen.getByRole('region', { name: /make it smarter/i });
  }

  it('has exactly two commands in code style: ollama signin and the allowed-origins setting for this page', () => {
    const p = text();
    expect(Array.from(p.querySelectorAll('code')).map((c) => c.textContent)).toEqual([
      'ollama signin',
      originsCommand(window.location.origin),
    ]);
  });

  it('links Ollama\'s own documentation and shows the date the link was last checked, from the constant', () => {
    const p = text();
    const link = within(p).getByRole('link', { name: R18_COPY.PANEL_LINK_TEXT });
    expect(link).toHaveAttribute('href', OLLAMA_DOCS_URL);
    expect(new URL(OLLAMA_DOCS_URL).protocol).toBe('https:');
    expect(OLLAMA_DOCS_CHECKED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.textContent).toContain(`Link last checked ${OLLAMA_DOCS_CHECKED}`);
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('names no other command, model name, version or price (false-state scan of the whole panel)', () => {
    const p = text();
    const prose = p.cloneNode(true) as HTMLElement;
    prose.querySelectorAll('code').forEach((c) => c.remove());
    const t = prose.textContent ?? '';
    // no second command: no shell verb after "ollama", no pipe, no sudo, no curl, no brew/winget
    expect(t).not.toMatch(/\bollama (run|pull|serve|list|ps|create|rm|cp|show|stop)\b|\bsudo\b|\bcurl\b|\bbrew\b|\bwinget\b|\bexport\b|\bset \w+=|\|/i);
    // no model name, version or price
    expect(t).not.toMatch(/qwen|gemma|llama\d|mistral|phi\d|deepseek|gpt|claude|\bv?\d+\.\d+(\.\d+)?\b|[$£€]|\bfree\b|\bprice|\bper month\b|\bcost/i);
    // the only digits in the prose are the date
    expect((t.replace(`Link last checked ${OLLAMA_DOCS_CHECKED}`, '').match(/\d/g) ?? []).length).toBe(0);
    expect(p.querySelectorAll('code')).toHaveLength(2);
  });

  it('the public site\'s allowed-origins setting is the one the docs print', () => {
    expect(originsCommand(PUBLIC_SITE_ORIGIN)).toBe('OLLAMA_ORIGINS=https://oza977-max.github.io');
  });

  it('uses no word the verdict screen\'s single-match query looks for', () => {
    const t = text().textContent ?? '';
    expect(t).not.toMatch(/approved|rejected/i);
    for (const k of ['PANEL_HEADING', 'PANEL_EXPLANATION', 'PANEL_SIGNIN_LEAD', 'PANEL_ORIGINS_LEAD', 'PANEL_AFTER', 'PANEL_LINK_TEXT', 'PANEL_LINK_CHECKED', 'EXAMPLES_BUTTON', 'EXAMPLES_LIST_LABEL', 'EXAMPLES_NOTE'] as const)
      expect(R18_COPY[k]).not.toMatch(/approved|rejected/i);
  });
});

describe('TC-R18-PS-2-03: the panel promises nothing about where text goes; the status line carries the one sentence for each place', () => {
  it('the panel holds none of the three where-it-goes promises', () => {
    render(<MakeItSmarter />);
    const t = screen.getByRole('region', { name: /make it smarter/i }).textContent ?? '';
    expect(t).not.toMatch(/never leaves|will be sent|will be read|leaves your computer/i);
  });

  it.each([
    ['this-computer', LOCAL, 'qwen3:4b'],
    ['firm-server', FIRM, 'qwen3:4b'],
    ['ollama-cloud', LOCAL, 'gemma4:cloud'],
  ] as const)('%s: the status line holds the sentence from the one source, and no panel', (place, url, model) => {
    updateModelSetting({ place, url, model });
    render(<App />);
    expect(panel()).toBeNull();
    expect(document.querySelector('.model-status__line')!.textContent).toContain(placeSentence({ place, url, model }, false));
  });
});
