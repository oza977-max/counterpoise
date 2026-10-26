import { R18_COPY } from './plain-copy';
import type { ChecklistItemId } from '../engine/prefill-types';

// R18-GI-2 (specs/intake-flow.md §27.3). The note the first Next press shows
// when the description leaves items unmentioned: exactly those items, each with a
// one-click example sentence. Wording is a nudge, never a requirement — the
// questions that follow ask about every item either way.

/** The example, added after the text with one space or line break between. */
export function appendExample(text: string, sentence: string): string {
  if (text === '' || /\s$/.test(text)) return text + sentence;
  return `${text} ${sentence}`;
}

export default function NudgeNote({
  items,
  onAddExample,
}: {
  items: readonly ChecklistItemId[];
  onAddExample: (sentence: string) => void;
}) {
  // R18-G (NF-2): the status region is always in the page and starts empty; the note is put into it. A region
  // inserted already filled is not reliably announced by screen readers.
  return (
    <div role="status" className="describe__nudge-region">
      {items.length > 0 && (
        <div className="describe__nudge">
          <p className="describe__nudge-lead">{R18_COPY.UNMENTIONED_NOTE_LEAD}</p>
          <ul className="describe__nudge-items">
            {items.map((id) => {
              const sentence = R18_COPY.NUDGE_EXAMPLES[id];
              return (
                <li key={id}>
                  <span className="describe__nudge-label">{R18_COPY.CHECKLIST_LABELS[id]}</span>{' '}
                  <span className="describe__nudge-example-lead">{R18_COPY.NUDGE_EXAMPLE_LEAD}</span>{' '}
                  <button
                    type="button"
                    className="describe__example"
                    aria-label={`${R18_COPY.ADD_EXAMPLE_LABEL}: ${sentence}`}
                    onClick={() => onAddExample(sentence)}
                  >
                    {sentence}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="field-help">{R18_COPY.UNMENTIONED_NOTE_HELP}</p>
        </div>
      )}
    </div>
  );
}
