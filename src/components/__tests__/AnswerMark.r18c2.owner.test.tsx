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
    expect(claim()).toBe('Suggested by the AI model alpha:7b from your description: “internal ticket volumes” — is this right?');
  });

  it('TC-R18-GI-4-02o2 (false state): no ReadRecord model name -> "an AI model", never an empty or undefined name', () => {
    mark(pre(NO_MODEL));
    expect(claim()).toBe('Suggested by an AI model from your description: “internal ticket volumes” — is this right?');
    expect(claim()).not.toMatch(/undefined|by\s+from/);
  });

  it('TC-R18-GI-4-02o3 (false state): once the quote is gone, "from your description" is absent and the model is named once', () => {
    mark(pre(READ), 'Rewritten entirely.');
    expect(claim()).toBe('the quote “internal ticket volumes” suggested by the AI model alpha:7b is no longer in your description — is this right?');
    expect(claim()).not.toMatch(/from your description/);
    expect(claim().match(/alpha:7b/g)).toHaveLength(1);
  });

  it('TC-R18-GI-13-01o4: confirmed mark keeps "confirmed by you" and names the model', () => {
    mark(pre(READ, true));
    expect(claim()).toBe('confirmed by you — suggested by the AI model alpha:7b from your description: “internal ticket volumes”');
  });

  it('TC-R18-GI-13-01o5 (false state): confirmed and quote gone -> no "from your description"', () => {
    mark(pre(READ, true), 'Rewritten entirely.');
    expect(claim()).toBe('confirmed by you — the quote “internal ticket volumes” suggested by the AI model alpha:7b is no longer in your description');
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
    for (const s of [R18_COPY.CONFIRM_LABEL, R18_COPY.SKIP_LABEL, R18_COPY.MARK_SUGGESTED_BY, R18_COPY.MARK_MODEL_FALLBACK, R18_COPY.MARK_MODEL_NAMED]) {
      expect(s).not.toMatch(/approved|rejected/i);
    }
    expect(R18_COPY.SKIP_LABEL).toBe("Skip — don't read it; I'll answer the questions myself");
  });

  // Newcomer test round 1 (2026-10-26, owner-approved): a person must be able to see {model} is an AI model.
  it('TC-R18-GI-4-02o9: every variant says "the AI model {model}", or "an AI model" with no name, never both', () => {
    const variants: [AnswerSource, string][] = [
      [pre(READ), DESC],
      [pre(READ, true), DESC],
      [pre(READ), 'Rewritten entirely.'],
      [pre(READ, true), 'Rewritten entirely.'],
      [{ kind: 'changed', from: QUOTE, read: READ }, DESC],
    ];
    for (const [src, desc] of variants) {
      const { unmount } = mark(src, desc);
      expect(claim()).toMatch(/the AI model alpha:7b/);
      expect(claim()).not.toMatch(/an AI model/);
      unmount();
    }
    const unnamed: [AnswerSource, string][] = [
      [pre(NO_MODEL), DESC],
      [pre(NO_MODEL, true), DESC],
      [pre(NO_MODEL), 'Rewritten entirely.'],
      [pre(NO_MODEL, true), 'Rewritten entirely.'],
      [{ kind: 'changed', from: QUOTE, read: NO_MODEL }, DESC],
    ];
    for (const [src, desc] of unnamed) {
      const { unmount } = mark(src, desc);
      expect(claim()).toMatch(/an AI model/);
      expect(claim()).not.toMatch(/the AI model|a model\b|undefined/);
      unmount();
    }
    expect(R18_COPY.MARK_MODEL_FALLBACK).toBe('an AI model');
  });
});
