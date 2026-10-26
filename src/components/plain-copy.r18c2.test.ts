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
      R18_COPY.FAILURE_SENTENCES['not-configured'].ollama,
    );
    expect(formReadNote('setting-changed', 'this-computer', '', { ...base, readAgainShown: false, settingKind: 'no-model' })).toBe(
      R18_COPY.FAILURE_SENTENCES['not-configured'].ollama,
    );
    expect(formReadNote('not-read', 'this-computer', '', { ...base, readAgainShown: false, settingKind: 'invalid' })).toBe(
      failureSentence('invalid-setting', 'this-computer', ''),
    );
    expect(formReadNote('not-read', 'this-computer', '', { ...base, readAgainShown: false })).toBe(R18_COPY.NOT_READ_NO_BUTTON);
    expect(formReadNote('setting-changed', 'this-computer', '', { ...base, readAgainShown: false })).toBe(R18_COPY.SETTING_CHANGED_NO_BUTTON);
  });

  it('TC-R18-GI-13-01r2a (R18-G false state): "Optional: connect an AI helper" and "No model is connected" are named only where no model is set', () => {
    const outcomes = [
      'not-configured', 'too-long', 'timed-out', 'skipped', 'not-read', 'setting-changed', 'invalid-setting', 'nothing-found',
      'retired', 'model-missing', 'not-included', 'allowance-used', 'signed-out', 'not-answering', 'blocked-or-unreachable', 'unusable', 'other',
    ] as const;
    let named = 0;
    for (const outcome of outcomes)
      for (const settingKind of ['none', 'invalid', 'no-model', 'valid', 'unknown'] as const)
        for (const readAgainShown of [true, false])
          for (const earlierKept of [true, false])
            for (const place of ['this-computer', 'firm-server', 'ollama-cloud'] as const) {
              const note = formReadNote(outcome, place, 'localhost', { earlierKept, readAgainShown, settingKind });
              const noModelSet = settingKind === 'none' || settingKind === 'no-model';
              if (/optional: connect an ai helper|no model is connected/i.test(note)) {
                named += 1;
                expect(noModelSet, `${outcome}/${settingKind}: ${note}`).toBe(true);
                expect(earlierKept).toBe(false);
                expect(note).toBe(R18_COPY.FAILURE_SENTENCES['not-configured'].ollama);
              }
            }
    expect(named).toBeGreaterThan(0);
    // not-configured with a model set (or unread) says only that nothing was filled in.
    for (const settingKind of ['valid', 'unknown'] as const)
      expect(formReadNote('not-configured', 'this-computer', '', { ...base, settingKind })).toBe(R18_COPY.NOT_READ_NO_BUTTON);
    expect(formReadNote('not-configured', 'this-computer', '', { ...base, settingKind: 'invalid' })).toBe(
      failureSentence('invalid-setting', 'this-computer', ''),
    );
    expect(formReadNote('not-configured', 'this-computer', '', { ...base, settingKind: 'none' })).toBe(
      R18_COPY.FAILURE_SENTENCES['not-configured'].ollama,
    );
  });

  it('TC-R18-GI-13-01r1c (I2): earlier answers kept -> the kept sentence; none -> the plain sentence, which never says "kept"', () => {
    expect(formReadNote('skipped', 'this-computer', '', { ...base, earlierKept: true })).toBe(R18_COPY.KEPT_EARLIER_NOTE);
    const plain = formReadNote('skipped', 'this-computer', '', base);
    expect(plain).toBe(failureSentence('skipped', 'this-computer', ''));
    expect(plain).not.toMatch(/earlier answers/i);
    expect(`${R18_COPY.KEPT_EARLIER_NOTE}${R18_COPY.NOT_READ_NO_BUTTON}${R18_COPY.SETTING_CHANGED_NO_BUTTON}`).not.toMatch(/approved|rejected/i);
  });
});
