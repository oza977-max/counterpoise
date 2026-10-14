import { describe, it, expect } from 'vitest';
import { R18_COPY, formReadNote, failureSentence } from './plain-copy';

// R18-C2 review pass 1 (I1, I2): the form note's sentence for each state of the button and of earlier answers.
const base = { earlierKept: false, readAgainShown: true, settingKind: 'valid' as const };

describe('formReadNote', () => {
  it('TC-R18-GI-13-01r1a (I1): with the button on screen, not-read and setting-changed name it', () => {
    expect(formReadNote('not-read', 'this-computer', '', base)).toMatch(/read my description again/i);
    expect(formReadNote('setting-changed', 'this-computer', '', base)).toMatch(/read my description again/i);
  });

  it('TC-R18-GI-13-01r1b (I1): with the button absent, no sentence names it, whatever the setting', () => {
    for (const settingKind of ['none', 'invalid', 'no-model', 'valid', 'unknown'] as const) {
      for (const outcome of ['not-read', 'setting-changed'] as const) {
        const s = formReadNote(outcome, 'this-computer', '', { ...base, readAgainShown: false, settingKind });
        expect(s).not.toMatch(/read my description again/i);
      }
    }
    expect(formReadNote('not-read', 'this-computer', '', { ...base, readAgainShown: false, settingKind: 'none' })).toBe(
      failureSentence('not-configured', 'this-computer', ''),
    );
    expect(formReadNote('not-read', 'this-computer', '', { ...base, readAgainShown: false, settingKind: 'invalid' })).toBe(
      failureSentence('invalid-setting', 'this-computer', ''),
    );
    expect(formReadNote('not-read', 'this-computer', '', { ...base, readAgainShown: false })).toBe(R18_COPY.NOT_READ_NO_BUTTON);
    expect(formReadNote('setting-changed', 'this-computer', '', { ...base, readAgainShown: false })).toBe(R18_COPY.SETTING_CHANGED_NO_BUTTON);
  });

  it('TC-R18-GI-13-01r1c (I2): earlier answers kept -> the kept sentence; none -> the plain sentence, which never says "kept"', () => {
    expect(formReadNote('skipped', 'this-computer', '', { ...base, earlierKept: true })).toBe(R18_COPY.KEPT_EARLIER_NOTE);
    const plain = formReadNote('skipped', 'this-computer', '', base);
    expect(plain).toBe(failureSentence('skipped', 'this-computer', ''));
    expect(plain).not.toMatch(/earlier answers/i);
    expect(`${R18_COPY.KEPT_EARLIER_NOTE}${R18_COPY.NOT_READ_NO_BUTTON}${R18_COPY.SETTING_CHANGED_NO_BUTTON}`).not.toMatch(/approved|rejected/i);
  });
});
