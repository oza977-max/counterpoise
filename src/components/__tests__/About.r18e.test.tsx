import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { R18_COPY } from '../plain-copy';
import { describeToForm } from './r18aFlow';

// R18-E: the About page's paragraph on the optional model is rewritten (it named a model, called it free, and
// promised the description "never leaves" the computer). Each claim of the new paragraph is tested where it is
// true and where it would be false (BC-005, TC-R18-GI-13-01).

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const P = R18_COPY.ABOUT_MODEL_PARAGRAPH;

describe('About - the model paragraph (R18-E)', () => {
  it('GI-13-01: the page shows the paragraph as written, once', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText('? About'));
    expect(screen.getAllByText(P)).toHaveLength(1);
  });

  it('GI-13-01: it names no model (Ollama is the program that runs one, not a model) - none of the models the app has ever named or defaulted to, and no size in billions', () => {
    expect(P).not.toMatch(/qwen|gemma|\bllama|mistral|gpt|claude|anthropic|phi\b|\b\d+\s?b\b|billion/i);
  });

  it('GI-13-01: it names the three places a description can go - the same three the Settings choice and the where-it-goes sentences have - and promises none of them as private', () => {
    expect(Object.keys(R18_COPY.PLACE_SENTENCES).filter((k) => k !== 'this-computer-with-key').sort()).toEqual(['firm-server', 'ollama-cloud', 'this-computer']);
    expect(P).toMatch(/a model on this computer/);
    expect(P).toMatch(/a model on your firm's own server/);
    expect(P).toMatch(/Ollama's cloud/);
    expect(P).not.toMatch(/never leaves|stays on|private|nothing is sent|free\b/i);
  });

  it('GI-13-01: it says every answer a model fills in must be checked and ticked - true on the form (Continue is refused until it is) - and that with no model you answer yourself (true: no answer arrives pre-filled)', async () => {
    expect(P).toMatch(/check and tick every answer it fills in before you can continue/);
    expect(P).toMatch(/With no model connected, you answer the questions yourself/);
    // No model connected: the form arrives with nothing filled in and nothing to tick.
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await describeToForm(user, 'It reads client names. Our UK team will use it every morning.');
    expect(screen.queryAllByRole('checkbox', { name: /^i've checked this answer/i })).toHaveLength(0);
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled();
  });

  it('GI-13-01: it uses neither reserved verdict word', () => {
    expect(P).not.toMatch(/approved|rejected/i);
  });
});
