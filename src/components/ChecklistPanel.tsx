import { useMemo } from 'react';
import { CHECKLIST_ITEM_IDS, mentionedItems } from '../engine/mentioned';
import type { MentionJurisdiction } from '../engine/mentioned';
import { R18_COPY } from './plain-copy';

// R18-GI-1 (specs/intake-flow.md §27.2). The live "mentioned / not mentioned"
// checklist beside the description box. Presentation only: the rule is
// mentionedItems() in the engine, which depends on the text and the policy's
// jurisdiction list and nothing else, and runs on the whole text however long.
//
// Honest by construction (NF-2, CLAUDE.md "honesty is a functional requirement"):
// it says only that a topic is or is not mentioned — never "answered" or
// "understood" — and each state is a symbol AND words, so colour is never the
// only cue. The list is a polite status region so a change is announced.

export default function ChecklistPanel({
  description,
  jurisdictions,
}: {
  description: string;
  jurisdictions: readonly MentionJurisdiction[];
}) {
  const mentioned = useMemo(() => mentionedItems(description, jurisdictions), [description, jurisdictions]);
  return (
    <section className="checklist" aria-labelledby="checklist-heading">
      <h2 id="checklist-heading" className="checklist__heading">
        {R18_COPY.CHECKLIST_HEADING}
      </h2>
      <p className="field-help">{R18_COPY.CHECKLIST_HELP}</p>
      <div role="status" aria-live="polite">
        <ul className="checklist__items">
          {CHECKLIST_ITEM_IDS.map((id) => {
            const on = mentioned.has(id);
            return (
              <li key={id} className={on ? 'checklist__item checklist__item--on' : 'checklist__item'}>
                <span className="checklist__symbol" aria-hidden="true">
                  {on ? R18_COPY.SYMBOL_MENTIONED : R18_COPY.SYMBOL_NOT_MENTIONED}
                </span>
                <span className="checklist__label">{R18_COPY.CHECKLIST_LABELS[id]}</span>{' '}
                <span className="checklist__state">{on ? R18_COPY.STATE_MENTIONED : R18_COPY.STATE_NOT_MENTIONED}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
