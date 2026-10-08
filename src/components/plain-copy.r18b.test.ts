import { describe, it, expect } from 'vitest';
import { R18_COPY, placeSentence, modelLabelWords, placeRecordWords } from './plain-copy';
import type { ValidationReason } from '../llm/model-setting';

// R18-B deliverable 3: the model-setting strings (specs/intake-flow.md §27.8, §27.13).
function allStrings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (v && typeof v === 'object') return Object.values(v).flatMap(allStrings);
  return [];
}

const REASONS: ValidationReason[] = [
  'no-place', 'address-missing', 'address-invalid', 'address-credentials', 'address-too-long',
  'address-characters', 'not-this-computer', 'cloud-needs-app', 'model-missing', 'model-too-long',
  'model-characters', 'cloud-model-elsewhere', 'cloud-needs-tag', 'storage-unavailable',
];

describe('TC-R18-MS-2-02: "never leaves your computer" is in exactly one string', () => {
  it('appears in one R18_COPY string and only the this-computer sentence carries it', () => {
    const hits = allStrings(R18_COPY).filter((s) => /never leaves your computer/i.test(s));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBe(R18_COPY.PLACE_SENTENCES['this-computer']);
  });
  it('the filled sentences: only this computer without a stored key says it', () => {
    const say = (s: string) => /never leaves your computer/i.test(s);
    expect(say(placeSentence({ place: 'this-computer', model: 'm:1', url: 'http://localhost:11434' }, false))).toBe(true);
    expect(say(placeSentence({ place: 'this-computer', model: 'm:1', url: 'http://localhost:11434' }, true))).toBe(false);
    expect(say(placeSentence({ place: 'firm-server', model: 'm:1', url: 'https://f.test' }, false))).toBe(false);
    expect(say(placeSentence({ place: 'ollama-cloud', model: 'm:cloud', url: 'http://localhost:11434' }, false))).toBe(false);
    expect(say(R18_COPY.NO_MODEL_SENTENCE)).toBe(false);
    expect(say(R18_COPY.INVALID_SETTING_SENTENCE)).toBe(false);
  });
});

describe('TC-R18-MS-2-01 / MS-2-07: the where-it-goes sentences', () => {
  it('uses the requirement wording for each place', () => {
    expect(placeSentence({ place: 'this-computer', model: 'qwen3:4b', url: 'http://localhost:11434' }, false)).toBe(
      'Your description will be read on this computer by qwen3:4b. It never leaves your computer.',
    );
    expect(placeSentence({ place: 'firm-server', model: 'qwen3:4b', url: 'https://ai.example-firm.test:8443' }, false)).toBe(
      "Your description will be sent to your firm's server at https://ai.example-firm.test:8443 and read by qwen3:4b.",
    );
    expect(placeSentence({ place: 'ollama-cloud', model: 'gemma4:cloud', url: 'http://localhost:11434' }, false)).toBe(
      "Your description will be sent to Ollama's cloud and read by gemma4:cloud.",
    );
  });
  it('the key-stored variant says the check and the explanation send text to Anthropic', () => {
    expect(placeSentence({ place: 'this-computer', model: 'qwen3:4b', url: 'http://localhost:11434' }, true)).toBe(
      'Your description will be read on this computer by qwen3:4b. A saved Anthropic key is also set, so the similar-case check and the explanation send text to Anthropic.',
    );
  });
  it('a stored key changes nothing under the other two places', () => {
    const f = { place: 'firm-server' as const, model: 'm:1', url: 'https://f.test' };
    expect(placeSentence(f, true)).toBe(placeSentence(f, false));
  });
  it('shows a model name through visibleText, so a hidden character cannot disguise it', () => {
    expect(placeSentence({ place: 'ollama-cloud', model: 'a‮:cloud', url: 'http://localhost:11434' }, false)).toContain('a⟦U+202E⟧:cloud');
  });
});

describe('the fixed lines', () => {
  it('say exactly what the requirements quote', () => {
    expect(R18_COPY.NO_MODEL_SENTENCE).toBe('No model is connected.');
    expect(R18_COPY.INVALID_SETTING_SENTENCE).toBe("The model setting isn't valid. Open Settings and check it.");
    expect(R18_COPY.UNENCRYPTED_LINE).toBe("This address isn't encrypted, so your description travels unprotected inside your firm's network.");
    expect(R18_COPY.DEMO_NOTICE).toBe(
      'This is a demonstration. Use made-up or public descriptions, not confidential details. A firm should use its own model on its own network.',
    );
    expect(R18_COPY.SHARED_ORIGIN_NOTE).toBe('On this public demo, other pages on the same site address can read data stored in this browser.');
    expect(R18_COPY.FIRM_SMALL_PRINT).toMatch(/^We can't check that this is your firm's server/);
    expect(R18_COPY.TEST_ASSUMPTION_SUFFIX).toBe('(measured as if you check every filled answer)');
    expect(R18_COPY.CLEAR_KEEPS_SETTING).toBe("Your model setting (including its address) is kept. Use 'Forget the model setting' to remove it.");
    expect(R18_COPY.FORGET_SETTING_LABEL).toBe('Forget the model setting');
    expect(R18_COPY.FALLBACK_RESEND_NOTE).toBe(
      'If the server ignores the strict format, your description is sent a second time to the same address.',
    );
  });
  it('the this-computer small print says the claim assumes the program at that address runs on this computer', () => {
    expect(R18_COPY.TUNNEL_SMALL_PRINT).toMatch(/assumes the program at that address runs on this computer/i);
  });
  it('the three place choices are named as the test cases quote them', () => {
    expect(R18_COPY.PLACE_CHOICE_LABELS).toEqual({
      'this-computer': 'On this computer',
      'firm-server': "On my firm's server",
      'ollama-cloud': "Ollama's cloud, through the Ollama app on this computer",
    });
  });
});

describe('TC-R18-MS-1-*: one plain refusal sentence per reason', () => {
  it('has a sentence for every reason, none blank, none with placeholders left in', () => {
    for (const r of REASONS) {
      const s = R18_COPY.REFUSAL_SENTENCES[r];
      expect(s, r).toBeTruthy();
      expect(s).not.toMatch(/undefined|\[object|[{}]/);
    }
    expect(Object.keys(R18_COPY.REFUSAL_SENTENCES).sort()).toEqual([...REASONS].sort());
  });
  it('the cloud refusals say what the cases require', () => {
    expect(R18_COPY.REFUSAL_SENTENCES['no-place']).toMatch(/choose where the model runs/i);
    expect(R18_COPY.REFUSAL_SENTENCES['cloud-model-elsewhere']).toMatch(/a cloud-tagged model can only be saved under Ollama's cloud/i);
    expect(R18_COPY.REFUSAL_SENTENCES['cloud-needs-app']).toMatch(/through the Ollama app on this computer/i);
    expect(R18_COPY.REFUSAL_SENTENCES['cloud-needs-tag']).toMatch(/Ollama's cloud tag/i);
  });
});

describe('TC-R18-MS-3-02: no model name, no recommendation, in the Settings copy', () => {
  it('scans every Settings string', () => {
    const strings = allStrings(R18_COPY.SETTINGS);
    expect(strings.length).toBeGreaterThan(8);
    const banned = /qwen|gemma|gpt-oss|\bllama|mistral|recommended|\bbest\b|we suggest/i;
    expect(strings.filter((s) => banned.test(s))).toEqual([]);
  });
  it('the scan can fail: it flags a string that does name a model', () => {
    expect(['Try qwen3:4b'].filter((s) => /qwen/i.test(s))).toHaveLength(1);
  });
});

describe('TC-R18-PS-5-02: the Settings copy asks for no key, token or password', () => {
  it('no Settings label or help asks for a key, token, secret or password', () => {
    const strings = allStrings(R18_COPY.SETTINGS);
    expect(strings.filter((s) => /\b(key|token|secret|password)\b/i.test(s))).toEqual([]);
  });
});

describe('TC-R18-GI-13-02: the new strings and the functions that fill them never say approved or rejected', () => {
  it('the filled sentences are clean', () => {
    const s = [
      placeSentence({ place: 'this-computer', model: 'm:1', url: 'http://localhost:11434' }, false),
      placeSentence({ place: 'this-computer', model: 'm:1', url: 'http://localhost:11434' }, true),
      placeSentence({ place: 'firm-server', model: 'm:1', url: 'https://f.test' }, false),
      placeSentence({ place: 'ollama-cloud', model: 'm:cloud', url: 'http://localhost:11434' }, false),
      modelLabelWords({ kind: 'untested' }),
      modelLabelWords({ kind: 'partial', casesRun: 5 }),
      modelLabelWords({ kind: 'tested', matches: 21, date: '2026-10-07' }),
      placeRecordWords('this-computer', 'http://localhost:11434'),
      placeRecordWords('firm-server', 'https://f.test'),
      placeRecordWords('ollama-cloud', 'http://localhost:11434'),
    ];
    expect(s.filter((x) => /approved|rejected/i.test(x))).toEqual([]);
  });
});

describe('TC-R18-GI-12-01 / -02 / -06: the label words and their caveat', () => {
  it('untested has no suffix and no count', () => {
    expect(modelLabelWords({ kind: 'untested' })).toBe('untested');
    expect(modelLabelWords({ kind: 'untested' })).not.toMatch(/\d+\/31|measured/);
  });
  it('tested reads "tested N/31 on DATE" followed by the suffix', () => {
    expect(modelLabelWords({ kind: 'tested', matches: 21, date: '2026-10-07' })).toBe(
      'tested 21/31 on 2026-10-07 (measured as if you check every filled answer)',
    );
  });
  it('a stopped run reads as untested with the partial note, and carries no suffix', () => {
    const w = modelLabelWords({ kind: 'partial', casesRun: 12 });
    expect(w).toBe('untested (a partial test stopped after 12 of 31 cases)');
    expect(w).not.toMatch(/measured/);
  });
});

describe('PLACE_RECORD_WORDS (§27.13)', () => {
  it('uses the past-tense phrases and never the present-tense promise', () => {
    expect(placeRecordWords('this-computer', 'http://localhost:11434')).toBe('by the program at http://localhost:11434 on the computer in use');
    expect(placeRecordWords('firm-server', 'https://f.test')).toBe("by the server at https://f.test, which the person declared as the firm's");
    expect(placeRecordWords('ollama-cloud', 'http://localhost:11434')).toBe("by Ollama's cloud, through the Ollama app on the computer in use");
    for (const p of ['this-computer', 'firm-server', 'ollama-cloud'] as const) {
      expect(placeRecordWords(p, 'http://h.test')).not.toMatch(/never leaves/i);
    }
  });
});
