import { describe, it, expect } from 'vitest';
import { visibleText } from './visible-text';

describe('visibleText (specs/intake-flow.md §27.4)', () => {
  it('TC-R18-MS-1-12 (rule 6): a zero-width space shows as ⟦U+200B⟧', () => {
    expect(visibleText('alpha​:1b')).toBe('alpha⟦U+200B⟧:1b');
  });

  it('TC-R18-MS-1-12 (rule 7): a bidirectional override shows as ⟦U+202E⟧', () => {
    expect(visibleText('a‮b')).toBe('a⟦U+202E⟧b');
  });

  it('ordinary text, accents, emoji and CJK pass through unchanged', () => {
    const s = 'Modèle 日本語 😀 qwen3:4b';
    expect(visibleText(s)).toBe(s);
  });

  it('keeps line feed, carriage return and tab', () => {
    expect(visibleText('a\nb\r\nc\td')).toBe('a\nb\r\nc\td');
  });

  it('escapes other controls (NUL, ESC, DEL, C1)', () => {
    expect(visibleText('\u0000\u001b\u007f\u0085')).toBe('⟦U+0000⟧⟦U+001B⟧⟦U+007F⟧⟦U+0085⟧');
  });

  it('escapes private-use, unassigned and lone-surrogate code points', () => {
    expect(visibleText('')).toBe('⟦U+E000⟧');
    expect(visibleText('͸')).toBe('⟦U+0378⟧'); // unassigned
    expect(visibleText('\ud800')).toBe('⟦U+D800⟧');
    expect(visibleText('\u{F0000}')).toBe('⟦U+F0000⟧'); // plane-15 private use, five digits
  });

  it('escapes the byte-order mark and the soft hyphen (Cf)', () => {
    expect(visibleText('﻿x­y')).toBe('⟦U+FEFF⟧x⟦U+00AD⟧y');
  });

  it('is pure: the same input gives the same output', () => {
    const s = 'a​‮\u0000';
    expect(visibleText(s)).toBe(visibleText(s));
  });
});
