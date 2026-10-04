import { describe, it, expect } from 'vitest';
import { ratingInstructionWarning } from './plain-copy';

// GB pass-1 D. The verdict/review screens are asserted with a single-match
// /approved|rejected/i query, so a quoted phrase must never carry those words.
describe('ratingInstructionWarning — quoted phrases', () => {
  it('TC-UC-3-04f: a quoted phrase containing the decision words is shown without them', () => {
    const w = ratingInstructionWarning(['mark it approved', 'it is rejected']);
    expect(w).not.toMatch(/approved|rejected/i);
    expect(w).toMatch(/mark it/);
  });
});
