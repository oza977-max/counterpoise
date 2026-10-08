import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// CR6-09 / CR6-20 / CR6-21 / CR6-22 (code review 006). Styles are real
// requirements here: contrast is measured from the CSS tokens themselves, and
// the rules a render depends on must exist.
const css = readFileSync(resolve(__dirname, '../../App.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

function rulesFor(selector: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const sels = m[1]!.split(',').map((s) => s.replace(/\/\*[\s\S]*?\*\//g, '').trim());
    if (sels.includes(selector)) out.push(m[2]!);
  }
  return out;
}

function declared(selector: string, prop: string): string | undefined {
  // The last matching declaration wins, as in the cascade for equal specificity.
  let value: string | undefined;
  for (const body of rulesFor(selector)) {
    const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`).exec(body);
    if (m) value = m[1]!.trim();
  }
  return value;
}

function token(name: string): string {
  const m = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`token ${name} not found`);
  return m[1]!;
}

function resolveColour(value: string): string {
  const v = /^var\((--[a-z-]+)\)$/.exec(value);
  return v ? token(v[1]!) : value;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function ratio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('App.css — CR6-09: small text meets 4.5:1', () => {
  const cases: Array<[string, string]> = [
    ['.verdict__first-also-covers', '--card-bg'],
    ['.graph-node__access-scope-editor > legend', '--card-bg'],
    ['.verdict__chain-source', '--paper'],
    // R18-A: the describe screen's checklist and nudge
    ['.checklist__item', '--card-bg'],
    ['.checklist__state', '--card-bg'],
    ['.describe__nudge-lead', '--paper'],
  ];
  for (const [selector, bgToken] of cases) {
    it(`TC-CR6-09: ${selector} on ${bgToken} is at least 4.5:1`, () => {
      const colour = declared(selector, 'color');
      expect(colour, `${selector} has a colour`).toBeTruthy();
      const r = ratio(resolveColour(colour!), token(bgToken));
      expect(r).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('App.css — CR6-20: the evidence-scope caveat is visibly not verified evidence', () => {
  it('TC-CR6-20: --scope has its own contrast-safe rule that differs from plain evidence text', () => {
    const sel = '.verdict__control-evidence--scope';
    expect(rulesFor(sel).length).toBeGreaterThan(0);
    const colour = declared(sel, 'color');
    expect(colour).toBeTruthy();
    expect(ratio(resolveColour(colour!), token('--card-bg'))).toBeGreaterThanOrEqual(4.5);
    // Distinct treatment: a rule line or an italic, not colour alone.
    const body = rulesFor(sel).join(' ');
    expect(body).toMatch(/border-left|font-style\s*:\s*italic/);
  });
});

describe('App.css — CR6-21 / CR6-22: rules the markup relies on exist', () => {
  it('TC-CR6-21: the questions\' tick-all list resets the fieldset and styles each option like the form\'s', () => {
    expect(declared('.questionnaire__multi-select', 'border')).toMatch(/none|0/);
    expect(declared('.questionnaire__multi-select', 'min-width')).toBe('0');
    expect(rulesFor('.questionnaire__multi-select-option').join(' ')).toMatch(/display\s*:\s*flex/);
  });

  it('TC-CR6-22: the "No" screen\'s paragraphs have spacing and size rules like .verdict__first-why', () => {
    for (const sel of ['.verdict__no-contributing', '.verdict__no-change', '.verdict__no-who-to-talk-to']) {
      expect(declared(sel, 'margin'), sel).toBeTruthy();
      expect(declared(sel, 'font-size'), sel).toBeTruthy();
    }
  });

  it('TC-CR6-07c: a visually-hidden helper class exists for the required-field text', () => {
    const body = rulesFor('.visually-hidden').join(' ');
    expect(body).toMatch(/position\s*:\s*absolute/);
    expect(body).toMatch(/clip/);
  });
});
