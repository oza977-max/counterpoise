import { useMemo } from 'react';
import { findRatingInstructions } from '../engine/rating-instructions';
import { ratingInstructionDescriptionWarning } from './plain-copy';

// R18-GI-3-19 (specs/intake-flow.md §27.4). GT7 L-1 (P12): a description that
// dictates its own rating is flagged, never obeyed. On the description screen the
// check runs on the typed text itself — findRatingInstructions(description), no
// graph and no model — so the person is told before anything is decided.
// A status region (nothing is blocked), always rendered, empty until there is something to say, with a visible "Warning:" lead-in, so it is
// not colour alone. Display only: nothing downstream reads this list.

export default function RatingInstructionNotice({ description }: { description: string }) {
  const found = useMemo(() => findRatingInstructions(description), [description]);
  // R18-G (NF-2): the status region is always in the page and starts empty; the warning is put into it.
  return (
    <div role="status" className="intake-flow__rating-region">
      {found.length > 0 && (
        <p className="intake-flow__rating-warning">
          <strong>Warning:</strong> {ratingInstructionDescriptionWarning(found)}
        </p>
      )}
    </div>
  );
}
