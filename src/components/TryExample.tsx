import { useState } from 'react';
import { WORKED_EXAMPLES } from '../engine/worked-examples';
import { R18_COPY } from './plain-copy';

// R18-G (specs/intake-flow.md §27.12, R18-PS-3). "Try an example": the ten worked cases of
// docs/try-these.md, offered as one-click descriptions. The list is read from the single
// source (src/engine/worked-examples.ts), which the guide's own test also reads, so the
// list and the guide cannot drift. Presentation only: a click hands the exact description
// text to the screen, which puts it in the box (the checklist then shows the real ticks).
// It promises nothing about what any model would fill in.

export default function TryExample({ onPick }: { onPick: (description: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="describe__examples">
      <button type="button" aria-expanded={open} aria-controls="describe-examples-list" onClick={() => setOpen((o) => !o)}>
        {R18_COPY.EXAMPLES_BUTTON}
      </button>
      {open && (
        <div id="describe-examples-list">
          <p className="field-help describe__examples-note">{R18_COPY.EXAMPLES_NOTE}</p>
          <ul className="describe__examples-list" aria-label={R18_COPY.EXAMPLES_LIST_LABEL}>
            {WORKED_EXAMPLES.map((ex) => (
              <li key={ex.id}>
                <button
                  type="button"
                  className="describe__example-pick"
                  onClick={() => {
                    onPick(ex.description);
                    setOpen(false);
                  }}
                >
                  {ex.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
