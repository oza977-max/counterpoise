import { describe, it, expect } from 'vitest';
import { findPossibleDuplicates, matchCorpus } from './duplicate';

describe('findPossibleDuplicates', () => {
  it('flags a high word-overlap description as a possible duplicate [TC-UC-2-01]', () => {
    const result = findPossibleDuplicates('Internal chatbot for answering HR policy questions', [
      { id: 'u1', label: 'Internal chatbot for answering HR policy questions from staff' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('u1');
  });

  it('does not flag an unrelated description', () => {
    const result = findPossibleDuplicates('Fraud detection model for card transactions', [
      { id: 'u1', label: 'Internal chatbot for HR policy questions' },
    ]);
    expect(result).toEqual([]);
  });

  it('returns [] when there are no existing use cases [TC-UC-2-05]', () => {
    expect(findPossibleDuplicates('anything', [])).toEqual([]);
  });

  it('sorts multiple candidates by descending score', () => {
    const result = findPossibleDuplicates('client relationship notes summarization model', [
      { id: 'low', label: 'model for things' },
      { id: 'high', label: 'client relationship notes summarization model for staff' },
    ]);
    expect(result[0]?.id).toBe('high');
  });
});

// Found live (2026-08-15): a WORD-FOR-WORD identical description sailed past
// the duplicate check, because the wiring compared descriptions against
// register LABELS — three-word names — while these tests passed on fixtures
// whose labels were conveniently sentence-length. The corpus an entry is
// matched on must include its stored description. [TC-UC-2-01]
describe('matchCorpus — what a register entry is matched against', () => {
  it('includes the stored description alongside the label', () => {
    expect(
      matchCorpus({ label: 'Deals drafting assistant', description: 'Drafts deal summaries using price-sensitive info.' }),
    ).toBe('Deals drafting assistant Drafts deal summaries using price-sensitive info.');
  });

  it('degrades to the label alone for a legacy entry with no stored description', () => {
    expect(matchCorpus({ label: 'Old case' })).toBe('Old case');
  });

  it('an identical re-typed description now clears the threshold against a short-named entry', () => {
    const typed = 'A drafting assistant for the deals team using price-sensitive information on a cloud service.';
    const entry = { id: 'u1', label: matchCorpus({ label: 'Deals drafting assistant', description: typed }) };
    const hits = findPossibleDuplicates(typed, [entry]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe('u1');
  });
});
