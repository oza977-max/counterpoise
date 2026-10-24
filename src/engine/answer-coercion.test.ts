import { describe, it, expect } from 'vitest';
import { coerceAnswerValue, questionForField } from './question-generator';

// v0.7.1 (user bug report, live-reproduced): "What level of human
// oversight...?" rendered a free-text box and the typed string was written
// into the numeric autonomy_level field. Two fixes, both asserted here:
// closed-set fields always get options, and the write-back gate refuses
// anything outside a field's legal set.

describe('v0.7.1 — closed-set fields never ask for free text', () => {
  it('TC-R71-01: autonomy_level, output_reversibility and scale questions are selects with options', () => {
    // R18-G: asked of the question builder directly; the function that listed guessed fields for it was removed
    // (nothing reads a graph out of a description any more). The question it builds is unchanged.
    const qs = [questionForField('autonomy_level', 'p1', [])];
    expect(qs[0]!.answer_type).toBe('select');
    expect(qs[0]!.options).toEqual(['0', '1', '2', '3', '4']);
  });
});

describe('v0.7.1 — coerceAnswerValue (write-back validation gate)', () => {
  it('TC-R71-02: coerces a stringified autonomy level to a number, refuses text', () => {
    expect(coerceAnswerValue('autonomy_level', '3')).toEqual({ ok: true, value: 3 });
    const bad = coerceAnswerValue('autonomy_level', 'internal team');
    expect(bad.ok).toBe(false);
  });

  it('TC-R71-03: refuses off-vocabulary values for closed fields, passes legal ones', () => {
    expect(coerceAnswerValue('data_zone', 'Zone C').ok).toBe(true);
    expect(coerceAnswerValue('data_zone', 'the cloud').ok).toBe(false);
    expect(coerceAnswerValue('output_reversibility', 'reversible').ok).toBe(true);
  });

  it('TC-R71-04: booleans coerce from strings; open text must be non-empty', () => {
    expect(coerceAnswerValue('hitl', 'true')).toEqual({ ok: true, value: true });
    expect(coerceAnswerValue('vendor', '  internal-platform ')).toEqual({ ok: true, value: 'internal-platform' });
    expect(coerceAnswerValue('vendor', '   ').ok).toBe(false);
  });
});
