import { describe, it, expect } from 'vitest';
import { triggerPhrase } from './trigger-copy';

// GT7 D-3 (P11, NF-11): plain words for "what set this regulation off".
describe('triggerPhrase', () => {
  it('TC-RA-9-01f: the fields the shipped packs test read as plain sentence fragments', () => {
    expect(triggerPhrase('decision_type', 'lending-decision')).toMatch(/lending/i);
    expect(triggerPhrase('decision_type', 'credit-decision')).toMatch(/credit/i);
    expect(triggerPhrase('exposure', 'client-facing')).toMatch(/client/i);
    expect(triggerPhrase('model_type', 'llm')).toMatch(/text|chat|writing/i);
    expect(triggerPhrase('data_zone', 'Zone B')).toMatch(/supplier/i);
    expect(triggerPhrase('decision_bindingness', 'material')).toMatch(/decision/i);
  });

  it('TC-RA-9-01g: never shows a raw field code or enum value — mapped or not (NF-11)', () => {
    const cases: Array<[string, string | number | boolean]> = [
      ['decision_type', 'credit-decision'],
      ['decision_type', 'lending-decision'],
      ['decision_type', 'hiring'],
      ['exposure', 'client-facing'],
      ['exposure', 'market-facing'],
      ['model_type', 'generative-ai'],
      ['model_type', 'agentic'],
      ['data_zone', 'Zone B'],
      ['decision_bindingness', 'binding'],
      // unmapped field, unmapped value of a mapped field, non-string value
      ['system_access_scope', 'live-credentials'],
      ['decision_type', 'some-new-kind'],
      ['autonomy_level', 3],
      ['some_future_field', true],
    ];
    for (const [field, value] of cases) {
      const phrase = triggerPhrase(field, value);
      expect(phrase.length).toBeGreaterThan(0);
      expect(phrase).not.toMatch(/[a-z]+_[a-z]+/);
      expect(phrase).not.toMatch(/[a-z]+-[a-z]+/); // no raw kebab enum such as client-facing
      expect(phrase).not.toMatch(/Zone [ABC]/);
    }
    expect(triggerPhrase('some_future_field', true)).toBe('one of your answers matches this rule');
    expect(triggerPhrase('decision_type', 'some-new-kind')).toBe('one of your answers matches this rule');
  });
});
