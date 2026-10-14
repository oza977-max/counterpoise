import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AnswerMark from '../AnswerMark';
import type { AnswerSource, ReadRecord } from '../../engine/prefill-types';

// R18-C2 review pass 1 (M4, M8): the "changed" mark says what the model had chosen, in the option's own words
// (through visibleText), and every "is the quote still in the text" decision comes from answer-sources.

const READ: ReadRecord = { model: 'alpha:7b', place: 'this-computer', host: 'http://localhost:11434' };
const DESC = 'It summarises internal ticket volumes for the team.';
const changed = (option: string): AnswerSource => ({ kind: 'changed', from: [{ option, quote: 'internal ticket volumes' }], read: READ });
const words = (key: string) => (key === 'everyday' ? 'Everyday work information' : key === 'odd' ? 'Bad‮option' : '');

const mark = (source: AnswerSource, description = DESC) =>
  render(<AnswerMark questionLabel="What information" source={source} description={description} optionText={words} multi={false} onToggleConfirm={() => undefined} />);

describe('AnswerMark, changed (M8)', () => {
  it('TC-R18-GI-13-01: says which option the model had chosen, in the option\'s words', () => {
    mark(changed('everyday'));
    expect(screen.getByText(/changed by you — alpha:7b had read “internal ticket volumes” as “Everyday work information”/)).toBeInTheDocument();
  });

  it('TC-R18-GI-13-01: a hidden direction-change character in the option text is shown as an escape, never obeyed', () => {
    mark(changed('odd'));
    const text = document.querySelector('.answer-mark__claim')!.textContent!;
    expect(text).not.toContain('‮');
    expect(text).toMatch(/as “Bad/);
  });

  it('TC-R18-GI-13-01 (false state): an option with no words is not named, and the sentence has no dangling "as"', () => {
    mark(changed('unknown-key'));
    const text = document.querySelector('.answer-mark__claim')!.textContent!;
    expect(text).toBe('changed by you — alpha:7b had read “internal ticket volumes”');
  });

  it('TC-R18-GI-13-01: the "no longer in your description" note appears only once the quote has left the text', () => {
    mark(changed('everyday'), 'The description was rewritten.');
    expect(document.querySelector('.answer-mark__claim')!.textContent).toMatch(/no longer in your description/);
  });
});
