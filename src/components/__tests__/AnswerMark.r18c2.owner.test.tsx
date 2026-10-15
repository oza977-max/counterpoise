import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AnswerMark from '../AnswerMark';
import { R18_COPY } from '../plain-copy';
import type { AnswerSource, ReadRecord } from '../../engine/prefill-types';

// R18-C2 owner wording (2026-10-15, newcomer check): the pre-fill mark names the model that suggested
// the answer; the tick reads "I've checked this answer". Every new sentence has a false-state test.

const READ: ReadRecord = { model: 'alpha:7b', place: 'this-computer', host: 'http://localhost:11434' };
const NO_MODEL: ReadRecord = { model: '', place: 'this-computer', host: 'http://localhost:11434' };
const DESC = 'It summarises internal ticket volumes for the team.';
const QUOTE = [{ option: 'everyday', quote: 'internal ticket volumes' }];
const pre = (read: ReadRecord, confirmed = false): AnswerSource => ({ kind: 'prefilled', quotes: QUOTE, read, confirmed });
const words = (k: string) => k;

const mark = (source: AnswerSource, description = DESC) =>
  render(<AnswerMark questionLabel="What information" source={source} description={description} optionText={words} multi={false} onToggleConfirm={() => undefined} />);
const claim = () => document.querySelector('.answer-mark__claim')!.textContent!;

describe('AnswerMark owner wording', () => {
  it('TC-R18-GI-4-02o1: unconfirmed pre-fill names the model', () => {
    mark(pre(READ));
    expect(claim()).toBe('Suggested by alpha:7b from your description: “internal ticket volumes” — is this right?');
  });

  it('TC-R18-GI-4-02o2 (false state): no ReadRecord model name -> "a model", never an empty or undefined name', () => {
    mark(pre(NO_MODEL));
    expect(claim()).toBe('Suggested by a model from your description: “internal ticket volumes” — is this right?');
    expect(claim()).not.toMatch(/undefined|by\s+from/);
  });

  it('TC-R18-GI-4-02o3 (false state): once the quote is gone, "from your description" is absent and the model is named once', () => {
    mark(pre(READ), 'Rewritten entirely.');
    expect(claim()).toBe('the quote “internal ticket volumes” suggested by alpha:7b is no longer in your description — is this right?');
    expect(claim()).not.toMatch(/from your description/);
    expect(claim().match(/alpha:7b/g)).toHaveLength(1);
  });

  it('TC-R18-GI-13-01o4: confirmed mark keeps "confirmed by you" and names the model', () => {
    mark(pre(READ, true));
    expect(claim()).toBe('confirmed by you — suggested by alpha:7b from your description: “internal ticket volumes”');
  });

  it('TC-R18-GI-13-01o5 (false state): confirmed and quote gone -> no "from your description"', () => {
    mark(pre(READ, true), 'Rewritten entirely.');
    expect(claim()).toBe('confirmed by you — the quote “internal ticket volumes” suggested by alpha:7b is no longer in your description');
    expect(claim()).not.toMatch(/from your description/);
  });

  it('TC-R18-GI-13-01o6: a hidden direction-change character in the model name is shown as an escape', () => {
    mark(pre({ ...READ, model: 'evil‮model' }));
    expect(claim()).not.toContain('‮');
  });

  it('TC-R18-GI-4-02o7: the tick reads "I\'ve checked this answer" with the question in its accessible name', () => {
    mark(pre(READ));
    expect(screen.getByRole('checkbox', { name: "I've checked this answer: What information" })).toBeInTheDocument();
    expect(screen.queryByText(/Yes, this is right/)).not.toBeInTheDocument();
  });

  it('TC-R18-GI-4-02o8: new strings never contain the verdict words', () => {
    for (const s of [R18_COPY.CONFIRM_LABEL, R18_COPY.SKIP_LABEL, R18_COPY.MARK_SUGGESTED_BY, R18_COPY.MARK_MODEL_FALLBACK]) {
      expect(s).not.toMatch(/approved|rejected/i);
    }
    expect(R18_COPY.SKIP_LABEL).toBe("Skip — don't read it; I'll answer the questions myself");
  });
});
