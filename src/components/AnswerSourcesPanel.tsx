import { useMemo } from 'react';
import { R18_COPY, QUESTION_WORDS, findQuestion, modelFilledLine, readLineWords, originLineWords } from './plain-copy';
import { buildCatalogue, QUESTION_STRUCTURE } from '../engine/question-structure';
import { readAnswerSources } from '../engine/answer-sources';
import { visibleText } from '../engine/visible-text';
import type { PrefillCatalogue } from '../engine/prefill-types';
import type { PolicyFile } from '../engine/types';

// R18-D1 (specs/intake-flow.md §27.13 "Register detail"). Presentation only: the engine's reader turns the
// record into facts, plain-copy.ts words them, this puts them on screen as text. Nothing here is computed from
// the case; it is read from the saved `answer_sources`, and a case without them renders nothing at all.
//
// What each line claims, and only then (TC-R18-GI-13-01):
//   "read by {model} ..."       one per distinct read in the record; none for a typed-only case;
//   "N of M answers ..."        only when N or K is above zero, with the confirmation step's own rule;
//   "typed by you" ...          the origin the row records; an unknown origin says "source not recognised";
//   "the quote is no longer ..." only when the row's quote_in_final_description is false.
// The register never repeats the present-tense "never leaves your computer" promise: the record says what was
// configured, in the past tense, and says plainly that Counterpoise did not check it.

interface Props {
  /** The record's answer_sources, exactly as stored or imported (untrusted; the reader checks it). */
  sources: unknown;
  /** The latest corrected description, if a correction edited it (§27.13 "The corrected description"). */
  correctedDescription?: string;
  policy: PolicyFile | null | undefined;
}

export default function AnswerSourcesPanel({ sources, correctedDescription, policy }: Props) {
  const view = useMemo(() => {
    let catalogue: PrefillCatalogue;
    try {
      catalogue = policy ? buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy) : new Map();
    } catch {
      catalogue = new Map(); // a policy the catalogue cannot read: raw option keys are shown, as text
    }
    return readAnswerSources(sources, {
      catalogue,
      questionLabel: (id) => {
        const known = QUESTION_STRUCTURE.some((q) => q.id === id);
        return known ? findQuestion(id as never)?.text : undefined;
      },
    });
  }, [sources, policy]);

  if (!view && correctedDescription === undefined) return null;
  const share = view ? modelFilledLine(view.counts) : null;

  return (
    <section className="register-detail__sources" aria-label={R18_COPY.SOURCES_HEADING}>
      {correctedDescription !== undefined && (
        <div className="register-detail__corrected-description">
          <h3>{R18_COPY.CORRECTED_DESCRIPTION_HEADING}</h3>
          <p>{visibleText(correctedDescription)}</p>
        </div>
      )}
      {view && (
        <>
          <h3>{R18_COPY.SOURCES_HEADING}</h3>
          {view.reads.map((r, i) => (
            <p key={i} className="register-detail__read-line">
              {readLineWords(r)}
            </p>
          ))}
          {view.reads.length > 0 && <p className="register-detail__read-note">{R18_COPY.READ_NOTE}</p>}
          {share && <p className="register-detail__share-line">{share}</p>}
          <ul aria-label={R18_COPY.SOURCES_HEADING}>
            {view.answers.map((a, i) => (
              <li key={i}>
                <div className="register-detail__source-question">{a.question}</div>
                {a.value !== '' && <div className="register-detail__source-value">{a.value}</div>}
                <div className="register-detail__source-origin">{originLineWords(a)}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
