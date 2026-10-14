import { describe, it, expect } from 'vitest';
import { failureSentence } from './plain-copy';
import type { PrefillFailure } from '../engine/prefill-types';

// R18-C1 deliverable 6: failureSentence(reason, place, host) — the sentence C2 renders for each
// failure (§27.5 table). C2 adds the on-screen assertions; these pin the sentence chosen.

const HOST = 'https://ai.example-firm.test:8443';
const ALL: PrefillFailure[] = [
  'not-configured', 'too-long', 'timed-out', 'skipped', 'not-read', 'setting-changed', 'invalid-setting',
  'nothing-found', 'retired', 'model-missing', 'not-included', 'allowance-used', 'signed-out',
  'not-answering', 'blocked-or-unreachable', 'unusable', 'other',
];

describe('TC-R18-MS-7-01: each failure becomes one plain sentence that says what to do (Ollama places)', () => {
  const cases: [PrefillFailure, RegExp][] = [
    ['retired', /Pick another one in Settings/],
    ['model-missing', /Pick another in Settings, or pull it with Ollama/],
    ['not-included', /Pick another one in Settings/],
    ['allowance-used', /Wait a while, or pick another model/],
    ['signed-out', /ollama signin/],
    ['not-answering', /answered with an error/],
    ['blocked-or-unreachable', /Start the Ollama app and check that its allowed-origins setting/],
  ];
  for (const place of ['this-computer', 'ollama-cloud'] as const) {
    it(`under ${place}`, () => {
      for (const [reason, re] of cases) {
        // Ollama's cloud has its own model-missing wording (review pass 1, M4): it is not "on this computer".
        const expected = reason === 'model-missing' && place === 'ollama-cloud' ? /Pick another in Settings\./ : re;
        expect(failureSentence(reason, place, 'http://localhost:11434')).toMatch(expected);
      }
    });
  }
});

describe('R18-C1 review pass 1 (M4): the sentence is true of the place and of the status', () => {
  it('a missing model under Ollama\'s cloud does not claim it is missing from this computer or tell the person to pull it', () => {
    const cloud = failureSentence('model-missing', 'ollama-cloud', 'http://localhost:11434');
    expect(cloud).not.toMatch(/this computer|pull/i);
    expect(cloud).toMatch(/Ollama's cloud/);
    expect(cloud).toMatch(/Pick another in Settings/);
    expect(failureSentence('model-missing', 'this-computer', 'http://localhost:11434')).toMatch(/isn't on this computer.*pull it with Ollama/);
    expect(failureSentence('model-missing', 'firm-server', HOST)).toBe("That model isn't on the server. Pick another in Settings.");
  });
  it('a 5xx says the server answered with an error and never tells the person to start the app (it did answer)', () => {
    for (const place of ['this-computer', 'ollama-cloud', 'firm-server'] as const) {
      const s = failureSentence('not-answering', place, HOST);
      expect(s).toMatch(/answered with an error/);
      expect(s).not.toMatch(/\bstart\b/i);
      expect(s).not.toMatch(/isn't answering/);
    }
  });
});

describe('TC-R18-MS-7-03: a firm server gets neutral sentences', () => {
  it('names the host for the no-response case and says to ask whoever runs it for the others', () => {
    const blocked = failureSentence('blocked-or-unreachable', 'firm-server', HOST);
    expect(blocked).toContain(`We couldn't reach the server at ${HOST}.`);
    expect(failureSentence('signed-out', 'firm-server', HOST)).toMatch(/Ask whoever runs it/);
    expect(failureSentence('not-answering', 'firm-server', HOST)).toMatch(/ask whoever runs it/);
    for (const r of ['signed-out', 'not-answering', 'blocked-or-unreachable'] as const) {
      const s = failureSentence(r, 'firm-server', HOST);
      expect(s).not.toMatch(/ollama signin/i);
      expect(s).not.toMatch(/Ollama app/);
    }
  });
});

describe('TC-R18-PS-6-01: the refused-connection sentence is the one that names both causes', () => {
  it('reads exactly as the test case says', () => {
    expect(failureSentence('blocked-or-unreachable', 'this-computer', 'http://localhost:11434')).toBe(
      "We couldn't reach Ollama on this computer. Start the Ollama app and check that its allowed-origins setting includes this page.",
    );
  });
});

describe('TC-R18-PS-6-03: the cause sentence is not shown for other failures', () => {
  it('HTTP 500 (not-answering) is the "isn\'t answering" sentence, never the PS-6-01 one', () => {
    const s = failureSentence('not-answering', 'this-computer', 'http://localhost:11434');
    expect(s).toMatch(/answered with an error/);
    expect(s).not.toBe(failureSentence('blocked-or-unreachable', 'this-computer', 'http://localhost:11434'));
  });
});

describe('failureSentence: every failure maps to exactly one sentence', () => {
  it('is defined, non-empty, free of braces and of the forbidden words, for every reason and place', () => {
    for (const reason of ALL) {
      for (const place of ['this-computer', 'ollama-cloud', 'firm-server'] as const) {
        const s = failureSentence(reason, place, HOST);
        expect(s.length).toBeGreaterThan(10);
        expect(s).not.toMatch(/[{}]/);
        expect(s).not.toMatch(/approved|rejected/i);
        expect(s).not.toMatch(/undefined|null/);
      }
    }
  });
  it('fills {host} through visibleText so a hostile host cannot hide characters, and $-patterns stay literal', () => {
    const s = failureSentence('blocked-or-unreachable', 'firm-server', 'https://a‮b.test$&');
    expect(s).toContain('⟦U+202E⟧');
    expect(s).toContain('$&');
    expect(s).not.toContain('‮');
  });
});
