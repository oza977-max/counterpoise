import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Review pass 2 (Minor): the base .policy-view__pack-state rule came after the
// --loaded/--invalid modifiers at equal specificity and overrode their
// background and border, so a broken rulebook did not look like an error.
const css = readFileSync(resolve(__dirname, '../../App.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
const root = /:root\s*\{([^}]*)\}/.exec(css)![1]!;
const token = (n: string) => new RegExp(`${n}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(root)![1]!;
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

/** Rules (in file order) whose selector list contains exactly this selector. */
function rulesFor(selector: string): Array<{ index: number; spec: number; body: string }> {
  const out: Array<{ index: number; spec: number; body: string }> = [];
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    if (m[1]!.split(',').map((x) => x.trim()).includes(selector)) {
      out.push({ index: m.index, spec: (selector.match(/\./g) ?? []).length, body: m[2]! });
    }
  }
  return out;
}
const wins = (prop: string, modifier: string, base: string) => {
  const baseProp = prop === 'border-color' ? 'border' : prop; // base uses the border shorthand
  const mod = rulesFor(modifier).find((r) => new RegExp(`${prop}\\s*:`).test(r.body));
  const b = rulesFor(base).find((r) => new RegExp(`(?:^|[;\\s])${baseProp}\\s*:`).test(r.body));
  expect(mod, `${modifier} sets ${prop}`).toBeTruthy();
  expect(b, `${base} sets ${prop}`).toBeTruthy();
  return mod!.spec > b!.spec || (mod!.spec === b!.spec && mod!.index > b!.index);
};

describe('App.css — pack-state error styling (review pass 2)', () => {
  it('GT7-MN: the invalid and loaded modifiers win over the base on background and border', () => {
    for (const m of ['--invalid', '--loaded']) {
      for (const prop of ['background', 'border-color']) {
        expect(wins(prop, `.policy-view__pack-state.policy-view__pack-state${m}`, '.policy-view__pack-state'), `${m} ${prop}`).toBe(true);
      }
    }
  });

  it('GT7-MN: the error detail is at least 0.72rem, --ink-soft, and 4.5:1 on the error background', () => {
    const r = rulesFor('.policy-view__pack-state--invalid .policy-view__pack-state-detail')[0]!;
    expect(r.body).toMatch(/color:\s*var\(--ink-soft\)/);
    expect(parseFloat(/font-size:\s*([\d.]+)rem/.exec(r.body)![1]!)).toBeGreaterThanOrEqual(0.72);
    const bg = /background:\s*(#[0-9a-fA-F]{6})/.exec(rulesFor('.policy-view__pack-state.policy-view__pack-state--invalid')[0]!.body)![1]!;
    expect(ratio(token('--ink-soft'), bg)).toBeGreaterThanOrEqual(4.5);
  });
});
