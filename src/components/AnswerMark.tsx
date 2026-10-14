import { R18_COPY } from './plain-copy';
import { visibleText } from '../engine/visible-text';
import { quoteContext, quoteInText } from '../engine/answer-sources';
import type { AnswerSource, QuoteRef } from '../engine/prefill-types';

// R18-C2 (specs/intake-flow.md §27.6 "Marks"). Presentation only: where an answer on the form came from,
// said in words, with the one tick that confirms it. Every sentence is claimed only in the state where it
// is true (TC-R18-GI-13-01):
//   "from your description"            only while the quote is still in the description (derived each render);
//   "confirmed by you"                 only after a tick, or on a kept answer;
//   "changed by you"                   only for a pre-filled answer the person changed;
//   "the quote ... is no longer ..."   only once the quote has left the text.
// Everything that came from the description or a quote goes through visibleText(), so a hidden or
// direction-changing character is shown as an escape and never obeyed. Text is rendered as React text,
// never as markup. There is one tick per answer and no control anywhere that confirms several.

interface AnswerMarkProps {
  /** The question in a few words, for the tick's accessible name. */
  questionLabel: string;
  source: AnswerSource;
  /** THE description (one string): quotes are checked against it on every render. */
  description: string;
  /** The plain text of an option key, shown beside a quote of a tick-all question. */
  optionText: (key: string) => string;
  /** True for a tick-all question: each option's quote is labelled with the option. */
  multi: boolean;
  onToggleConfirm: () => void;
}

const q = (quote: string) => `“${visibleText(quote)}”`;

function QuoteLines({
  quotes,
  description,
  optionText,
  multi,
  line,
  askOnLast,
}: {
  quotes: QuoteRef[];
  description: string;
  optionText: (key: string) => string;
  multi: boolean;
  line: (quote: string, present: boolean, ask: boolean) => string;
  askOnLast: boolean;
}) {
  return (
    <>
      {quotes.map((ref, i) => {
        const present = quoteInText(ref.quote, description);
        const ctx = present ? quoteContext(description, ref.quote) : null;
        // Several quotes on one question (a tick-all with more than one option): say which option each is for.
        const prefix = multi && quotes.length > 1 ? `${visibleText(optionText(ref.option))}: ` : '';
        const ask = askOnLast && i === quotes.length - 1;
        return (
          <div key={`${ref.option}:${ref.quote}`} className="answer-mark__quote">
            <p className="answer-mark__claim">{prefix + line(ref.quote, present, ask)}</p>
            {ctx && (
              <p className="answer-mark__context">
                {visibleText(ctx.before)}
                <mark>{visibleText(ctx.match)}</mark>
                {visibleText(ctx.after)}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}

export default function AnswerMark({ questionLabel, source, description, optionText, multi, onToggleConfirm }: AnswerMarkProps) {
  if (source.kind === 'typed') return null;

  if (source.kind === 'not-carried') {
    return (
      <div className="answer-mark answer-mark--not-carried">
        <p className="answer-mark__claim">{R18_COPY.MARK_NOT_CARRIED}</p>
      </div>
    );
  }

  const tick = (confirmed: boolean) => (
    <label className="answer-mark__confirm">
      <input
        type="checkbox"
        checked={confirmed}
        aria-label={`${R18_COPY.CONFIRM_LABEL}: ${questionLabel}`}
        onChange={onToggleConfirm}
      />{' '}
      {R18_COPY.CONFIRM_LABEL}
    </label>
  );

  if (source.kind === 'record') {
    return (
      <div className="answer-mark answer-mark--record">
        <p className="answer-mark__claim">
          {source.confirmed ? `${R18_COPY.MARK_CONFIRMED} — ${R18_COPY.MARK_RECORD}` : R18_COPY.MARK_RECORD}
        </p>
        {tick(source.confirmed)}
      </div>
    );
  }

  if (source.kind === 'changed') {
    const model = visibleText(source.read.model);
    return (
      <div className="answer-mark answer-mark--changed">
        <QuoteLines
          quotes={source.from}
          description={description}
          optionText={optionText}
          multi={multi}
          askOnLast={false}
          line={(quote, present) =>
            `${R18_COPY.MARK_CHANGED} — ${model} had read ${q(quote)}${present ? '' : ` (${R18_COPY.MARK_QUOTE_LEFT_CONFIRMED})`}`
          }
        />
      </div>
    );
  }

  // prefilled
  const confirmed = source.confirmed;
  return (
    <div className="answer-mark answer-mark--prefilled">
      <QuoteLines
        quotes={source.quotes}
        description={description}
        optionText={optionText}
        multi={multi}
        askOnLast
        line={(quote, present, ask) => {
          if (present) {
            const base = `${R18_COPY.MARK_FROM} ${q(quote)}`;
            return confirmed ? `${R18_COPY.MARK_CONFIRMED} — ${base}` : ask ? `${base} ${R18_COPY.MARK_ASK}` : base;
          }
          const gone = `${R18_COPY.MARK_QUOTE_LEFT_PREFIX} ${q(quote)}`;
          return confirmed
            ? `${R18_COPY.MARK_CONFIRMED} — ${gone} ${R18_COPY.MARK_QUOTE_LEFT_CONFIRMED}`
            : ask
              ? `${gone} ${R18_COPY.MARK_QUOTE_LEFT_ASK}`
              : `${gone} ${R18_COPY.MARK_QUOTE_LEFT_CONFIRMED}`;
        }}
      />
      {tick(confirmed)}
    </div>
  );
}
