import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import StructuredForm from '../StructuredForm';
import { loadPolicy } from '../../store/policy';
import { WORKED_EXAMPLES } from '../../engine/worked-examples';
import { R18_COPY } from '../plain-copy';
import { loadFormDraft } from '../intake-draft';
import type { PolicyFile } from '../../engine/types';
import type { AnswerSource, FormAnswerState, ReadRecord } from '../../engine/prefill-types';

// R18-C2 deliverable 2 (specs/intake-flow.md §27.6): the form with pre-fills. Marks (the quote in its
// sentence, through visibleText), one tick per answer, no accept-all, change and change-back, record and
// not-carried answers, the sentence when a quote has left the description, the cascade, the Continue
// gate, and the rating notice. Every sentence also has a test in the state where it would be false
// (TC-R18-GI-13-01).

const READ: ReadRecord = { model: 'alpha:7b', place: 'this-computer', host: 'http://localhost:11434' };
const DESCRIPTION = 'It reads client names and account details. Our UK team will use it every morning.';

let policy: PolicyFile;
beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  policy = r.policy;
});
beforeEach(() => sessionStorage.clear());

const typed = (value: string | string[]) => ({ value, source: { kind: 'typed' } as AnswerSource });
const prefilled = (
  value: string | string[],
  quotes: { option: string; quote: string }[],
  confirmed = false,
) => ({ value, source: { kind: 'prefilled', quotes, read: READ, confirmed } as AnswerSource });

/** Example 1's answers as typed, with the given overrides. */
function fullState(overrides: FormAnswerState = {}): FormAnswerState {
  const out: FormAnswerState = {};
  for (const [k, v] of Object.entries(WORKED_EXAMPLES[0]!.answers)) {
    out[k as Exclude<keyof FormAnswerState, never>] = typed(v as string | string[]);
  }
  return { ...out, ...overrides };
}

const UK = prefilled(['UK'], [{ option: 'UK', quote: 'Our UK team' }]);
const PEOPLE = prefilled(['people'], [{ option: 'people', quote: 'client names' }]);

function Harness({
  initial,
  description = DESCRIPTION,
  onSubmit = () => undefined,
}: {
  initial?: FormAnswerState;
  description?: string;
  onSubmit?: (...args: unknown[]) => void;
}) {
  const [d, setD] = useState(description);
  return (
    <StructuredForm
      policy={policy}
      description={d}
      onDescriptionChange={setD}
      initialAnswerState={initial}
      onSubmit={onSubmit as never}
    />
  );
}

const continueButton = () => screen.getByRole('button', { name: /^continue$/i });
// The text of the answer marks only. The form intro may itself say "from your description" (newcomer round 2: "The AI
// helper only suggested answers from your description."), so a check that no MARK claims it reads the marks, not the page.
const markText = () => Array.from(document.querySelectorAll('.answer-mark')).map((m) => m.textContent ?? '').join(' | ');
const tickFor = (question: RegExp) => screen.getByRole('checkbox', { name: new RegExp(`^i've checked this answer.*${question.source}`, 'i') });

describe('marks: the quote in its sentence, only where a quote exists', () => {
  it('TC-R18-GI-3-01c: a pre-filled answer shows its quote; a typed answer and an empty question show none', () => {
    render(<Harness initial={fullState({ '5': PEOPLE, '11': UK })} />);
    const marks = screen.getAllByText(/^Suggested by the AI model alpha:7b from your description:/);
    expect(marks.map((m) => m.textContent)).toEqual([
      'Suggested by the AI model alpha:7b from your description: “client names” — is this right?',
      'Suggested by the AI model alpha:7b from your description: “Our UK team” — is this right?',
    ]);
    // every other question carries no pre-filled mark
    expect(document.querySelectorAll('.answer-mark')).toHaveLength(2);
  });

  it('TC-R18-GI-4-02: the mark says exactly “Suggested by the AI model alpha:7b from your description: “Our UK team” — is this right?” and not “confirmed by you” before the tick', () => {
    render(<Harness initial={fullState({ '11': UK })} />);
    expect(screen.getByText('Suggested by the AI model alpha:7b from your description: “Our UK team” — is this right?')).toBeInTheDocument();
    expect(screen.queryByText(/confirmed by you/i)).not.toBeInTheDocument();
  });

  it('TC-R18-GI-3-16: the mark shows the sentence around the quote with the quote highlighted', () => {
    render(<Harness initial={fullState({ '5': PEOPLE })} />);
    const mark = document.querySelector('.answer-mark')!;
    const context = mark.querySelector('.answer-mark__context')!;
    expect(context.textContent).toBe('It reads client names and account details.');
    const highlighted = context.querySelector('mark')!;
    expect(highlighted.textContent).toBe('client names');
    // the other sentence is not in this mark
    expect(mark.textContent).not.toMatch(/our uk team will use it/i);
  });

  it('TC-R18-GI-3-16b: a tick-all question shows each option\'s own quote and its own sentence', () => {
    const two = prefilled(
      ['people', 'confidential'],
      [
        { option: 'people', quote: 'client names' },
        { option: 'confidential', quote: 'account details' },
      ],
    );
    render(<Harness initial={fullState({ '5': two })} />);
    const quoteLines = screen
      .getAllByText(/^(.*: )?Suggested by the AI model alpha:7b from your description:/)
      .map((e) => e.textContent ?? '');
    expect(quoteLines.some((t) => t.includes('“client names”'))).toBe(true);
    expect(quoteLines.some((t) => t.includes('“account details”'))).toBe(true);
    // one confirm control for the one answer
    expect(screen.getAllByRole('checkbox', { name: /^i've checked this answer/i })).toHaveLength(1);
  });

  it('TC-R18-GI-3-18: a direction-changing character in the sentence is shown as an escape, not obeyed', () => {
    const desc = 'Our UK team reads client names\u202e and account details';
    render(<Harness initial={fullState({ '5': PEOPLE })} description={desc} />);
    const mark = document.querySelector('.answer-mark')!;
    expect(mark.textContent).toContain('⟦U+202E⟧');
    expect(document.querySelector('.answer-mark')!.textContent).not.toContain('\u202e');
  });

  it('TC-R18-GI-4-06: a quote with markup is shown as text and creates no element', () => {
    const markup = '<img src=x onerror=alert(1)> here';
    const quote = '<img src=x onerror=alert(1)>';
    render(
      <Harness
        initial={fullState({ '5': prefilled(['people'], [{ option: 'people', quote }]) })}
        description={`It reads ${markup} today.`}
      />,
    );
    const mark = document.querySelector('.answer-mark')!;
    expect(mark.textContent).toContain(quote);
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(mark.querySelector('img')).toBeNull();
  });

  it('TC-R18-GI-4-06b: hidden characters inside the quote itself are escaped too', () => {
    // A stored quote cannot hold one (the verifier refuses it), but a hostile draft could.
    const quote = 'client\u200bnames';
    render(
      <Harness
        initial={fullState({ '5': prefilled(['people'], [{ option: 'people', quote }]) })}
        description={`It reads client${'\u200b'}names today.`}
      />,
    );
    expect(document.querySelector('.answer-mark')!.textContent).toContain('⟦U+200B⟧');
    expect(document.querySelector('.answer-mark')!.textContent).not.toContain('\u200b');
  });
});

describe('confirm controls: one per answer, no accept-all', () => {
  it('TC-R18-GI-4-03: each pre-filled answer has its own control and nothing confirms several at once', () => {
    render(<Harness initial={fullState({ '5': PEOPLE, '11': UK, '10': prefilled('small', [{ option: 'small', quote: 'every morning' }]) })} />);
    expect(screen.getAllByRole('checkbox', { name: /^i've checked this answer/i })).toHaveLength(3);
    const everyControl = [...screen.getAllByRole('button'), ...screen.getAllByRole('checkbox')];
    for (const control of everyControl) {
      const name = control.getAttribute('aria-label') ?? control.textContent ?? '';
      expect(name).not.toMatch(/accept all|confirm all|looks good|select all|all of these|everything/i);
    }
  });

  it('TC-R18-GI-4-05: the control has an accessible name that includes its question, and Space ticks it', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={fullState({ '11': UK })} />);
    const tick = tickFor(/which countries does it involve/);
    expect(tick).not.toBeChecked();
    expect(screen.queryByText(/confirmed by you/i)).not.toBeInTheDocument();
    tick.focus();
    expect(tick).toHaveFocus();
    await user.keyboard(' ');
    expect(tick).toBeChecked();
    expect(screen.getByText(/confirmed by you/i)).toBeInTheDocument();
  });

  it('TC-R18-GI-4-05b: Tab reaches the control with the keyboard alone', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={fullState({ '11': UK })} />);
    const tick = tickFor(/which countries/);
    for (let i = 0; i < 80 && document.activeElement !== tick; i += 1) await user.tab();
    expect(tick).toHaveFocus();
  });

  it('TC-R18-GI-13-01: "confirmed by you" appears with a tick and goes with an un-tick', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={fullState({ '11': UK })} />);
    const tick = tickFor(/which countries/);
    expect(screen.queryByText(/confirmed by you/i)).not.toBeInTheDocument();
    await user.click(tick);
    expect(screen.getByText(/confirmed by you/i)).toBeInTheDocument();
    await user.click(tick);
    expect(screen.queryByText(/confirmed by you/i)).not.toBeInTheDocument();
    expect(screen.getByText('Suggested by the AI model alpha:7b from your description: “Our UK team” — is this right?')).toBeInTheDocument();
  });
});

describe('the Continue gate', () => {
  it('TC-R18-GI-4-01: shut while any pre-filled answer is unconfirmed or any blank is unanswered', async () => {
    const user = userEvent.setup({ delay: null });
    const state = fullState({ '5': PEOPLE, '11': UK, '10': prefilled('small', [{ option: 'small', quote: 'every morning' }]) });
    delete state['7'];
    render(<Harness initial={state} />);
    expect(continueButton()).toBeDisabled();
    await user.click(tickFor(/what information/));
    await user.click(tickFor(/which countries/));
    expect(continueButton()).toBeDisabled();
    await user.click(tickFor(/how widely|how many/i));
    // all three ticked, the blank (Question 7) is still unanswered
    expect(continueButton()).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
    expect(continueButton()).toBeEnabled();
  });

  it('TC-R18-GI-4-01b: the gate explains itself - the line names the answers still to check, and goes with the last tick', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={fullState({ '11': UK })} />);
    expect(screen.getByText(/^still to check:.*countries/i)).toBeInTheDocument();
    expect(continueButton()).toHaveAccessibleDescription(/still to check/i);
    await user.click(tickFor(/which countries/));
    expect(screen.queryByText(/still to check/i)).not.toBeInTheDocument();
    expect(continueButton()).toBeEnabled();
  });

  it('TC-R18-GI-4-01c: a fully typed form needs no tick and says nothing about checking', () => {
    render(<Harness initial={fullState()} />);
    expect(continueButton()).toBeEnabled();
    expect(screen.queryByText(/still to check/i)).not.toBeInTheDocument();
  });

  it('a blank description keeps Continue shut even when every answer is in (Question 2 is required)', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={fullState()} description="x" />);
    expect(continueButton()).toBeEnabled();
    const box = screen.getByLabelText(/what will it do|describe/i, { selector: 'textarea' });
    await user.clear(box);
    expect(continueButton()).toBeDisabled();
    await user.type(box, '   ');
    expect(continueButton()).toBeDisabled();
  });

  it('submitting hands up the answers with their sources and the description', async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = vi.fn();
    render(<Harness initial={fullState({ '11': UK })} onSubmit={onSubmit} />);
    await user.click(tickFor(/which countries/));
    await user.click(continueButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [, , answerState, description] = onSubmit.mock.calls[0]!;
    expect(description).toBe(DESCRIPTION);
    expect((answerState as FormAnswerState)['11']!.source).toMatchObject({ kind: 'prefilled', confirmed: true });
  });
});

describe('change counts as confirmation; change back returns to confirmed', () => {
  it('TC-R18-GI-4-04: changing a pre-filled answer makes it "changed by you" with no tick; changing it back makes it confirmed', async () => {
    const user = userEvent.setup({ delay: null });
    const uk = prefilled(['UK'], [{ option: 'UK', quote: 'Our UK team' }]);
    render(<Harness initial={fullState({ '11': uk })} />);
    const uk_ = screen.getByRole('checkbox', { name: /united kingdom/i });
    const germany = screen.getByRole('checkbox', { name: /germany|european union/i });
    await user.click(germany);
    await user.click(uk_); // untick UK: the answer is now different from what was read
    expect(screen.getByText(/changed by you/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /^i've checked this answer/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/is this right\?/i)).not.toBeInTheDocument();
    expect(loadFormDraft()!.answerState['11']!.source.kind).toBe('changed');
    expect(continueButton()).toBeEnabled();
    // back to what was read
    await user.click(uk_);
    await user.click(germany);
    expect(screen.queryByText(/changed by you/i)).not.toBeInTheDocument();
    expect(screen.getByText(/confirmed by you/i)).toBeInTheDocument();
    expect(screen.getByText(/“Our UK team”/)).toBeInTheDocument();
    const source = loadFormDraft()!.answerState['11']!.source;
    expect(source).toMatchObject({ kind: 'prefilled', confirmed: true });
  });

  it('TC-R18-GI-4-04b: a single-choice answer changes and changes back the same way', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={fullState({ '10': prefilled('small', [{ option: 'small', quote: 'every morning' }]) })} />);
    await user.click(screen.getByRole('radio', { name: /whole business|wide|across/i }));
    expect(screen.getByText(/changed by you/i)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
    expect(screen.queryByText(/changed by you/i)).not.toBeInTheDocument();
    expect(loadFormDraft()!.answerState['10']!.source).toMatchObject({ kind: 'prefilled', confirmed: true });
  });

  it('TC-R18-GI-9-02b: a changed answer keeps its quote and the model name on the screen and in the draft', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={fullState({ '10': prefilled('small', [{ option: 'small', quote: 'every morning' }]) })} />);
    await user.click(screen.getByRole('radio', { name: /whole business|wide|across/i }));
    const mark = document.querySelector('.answer-mark')!;
    expect(mark.textContent).toMatch(/changed by you/i);
    expect(mark.textContent).toContain('“every morning”');
    expect(mark.textContent).toContain('alpha:7b');
    // "from your description" is a claim about a pre-filled answer, not a changed one
    expect(mark.textContent).not.toMatch(/from your description/i);
  });

  it('TC-R18-GI-13-01c: a typed answer shows no source mark at all, and changing it creates none', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={fullState()} />);
    await user.click(screen.getByRole('radio', { name: /whole business|wide|across/i }));
    expect(document.querySelectorAll('.answer-mark')).toHaveLength(0);
    expect(screen.queryByText(/from your description|changed by you|confirmed by you/i)).not.toBeInTheDocument();
  });
});

describe('the quote has left the description', () => {
  it('TC-R18-GI-3-20: an unconfirmed pre-fill says so, still needs its tick, and no longer claims "from your description"', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={fullState({ '11': UK })} />);
    const box = screen.getByLabelText(/what will it do|describe/i, { selector: 'textarea' });
    await user.clear(box);
    await user.type(box, 'It reads client names.');
    expect(
      screen.getByText('the quote “Our UK team” suggested by the AI model alpha:7b is no longer in your description — is this right?'),
    ).toBeInTheDocument();
    expect(markText()).not.toMatch(/from your description/i);
    expect(continueButton()).toBeDisabled();
    await user.click(tickFor(/which countries/));
    expect(continueButton()).toBeEnabled();
  });

  it('TC-R18-GI-13-01d: while the quote is still in the text the "no longer" sentence is absent', () => {
    render(<Harness initial={fullState({ '11': UK })} />);
    expect(screen.queryByText(/no longer in your description/i)).not.toBeInTheDocument();
  });

  it('TC-R18-GI-8-04b: a confirmed answer keeps its value and reads “confirmed by you — the quote … is no longer in your description”', () => {
    const confirmed = prefilled(['UK'], [{ option: 'UK', quote: 'Our UK team' }], true);
    render(<Harness initial={fullState({ '11': confirmed })} description="We use it in London." />);
    expect(
      screen.getByText('confirmed by you — the quote “Our UK team” suggested by the AI model alpha:7b is no longer in your description'),
    ).toBeInTheDocument();
    expect(markText()).not.toMatch(/from your description/i);
    expect(screen.getByRole('checkbox', { name: /united kingdom/i })).toBeChecked();
    expect(continueButton()).toBeEnabled();
  });

  it('TC-R18-GI-9-05: a restored draft re-checks its quotes against the current description', () => {
    sessionStorage.setItem(
      'aigate:intake-form-draft:v4',
      JSON.stringify({
        version: 4,
        answerState: fullState({ '11': prefilled(['UK'], [{ option: 'UK', quote: 'Our UK team' }], true) }),
        lastRead: { fingerprint: '', outcome: 'not-read' },
      }),
    );
    render(<Harness description="Edited elsewhere: nothing about teams." />);
    expect(screen.getByText(/confirmed by you — the quote “Our UK team” suggested by the AI model alpha:7b is no longer in your description/)).toBeInTheDocument();
    expect(markText()).not.toMatch(/from your description/i);
  });

  it('TC-R18-GI-8-09: editing Question 2 changes the description the marks read, and the form draft holds no entry for Question 2', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={fullState({ '11': prefilled(['UK'], [{ option: 'UK', quote: 'Our UK team' }], true) })} />);
    expect(markText()).toMatch(/from your description/i);
    const box = screen.getByLabelText(/what will it do|describe/i, { selector: 'textarea' });
    await user.clear(box);
    await user.type(box, 'Only the London office.');
    expect(screen.getByText(/the quote “Our UK team” suggested by the AI model alpha:7b is no longer in your description/)).toBeInTheDocument();
    expect(loadFormDraft()!.answerState).not.toHaveProperty('2');
  });
});

describe('the cascade clears hidden state, sources included', () => {
  it('TC-R18-GI-8-05: changing the question a follow-up depends on removes the follow-up\'s answer and source', async () => {
    const user = userEvent.setup({ delay: null });
    const state = fullState({
      '3': typed('outside-assistant'),
      '3a': prefilled('firm-account', [{ option: 'firm-account', quote: 'our firm account' }]),
    });
    render(<Harness initial={state} description="It reads client names. We use our firm account." />);
    expect(screen.getByText(/“our firm account”/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    expect(screen.queryByText(/“our firm account”/)).not.toBeInTheDocument();
    const stored = loadFormDraft()!.answerState;
    expect(stored).not.toHaveProperty('3a');
  });

  it('TC-R18-GI-8-05b: a pre-filled question that is hidden from the start is dropped, not kept with a source', () => {
    // 4a is shown only for "a score": with Question 4 = language it is hidden whatever the state holds.
    const state = fullState({ '4': typed('language'), '4a': prefilled('rules', [{ option: 'rules', quote: 'fixed rules' }]) });
    render(<Harness initial={state} description="It follows fixed rules." />);
    expect(screen.queryByText(/“fixed rules”/)).not.toBeInTheDocument();
  });
});

describe('an answer from the earlier record', () => {
  const record = (value: string | string[], confirmed = false) => ({ value, source: { kind: 'record', confirmed } as AnswerSource });

  it('shows "from the earlier record" and needs its own tick', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={fullState({ '10': record('small') })} />);
    expect(screen.getByText(/from the earlier record/i)).toBeInTheDocument();
    expect(continueButton()).toBeDisabled();
    await user.click(tickFor(/how widely|how many/i));
    expect(continueButton()).toBeEnabled();
    expect(loadFormDraft()!.answerState['10']!.source).toEqual({ kind: 'record', confirmed: true });
  });

  it('TC-R18-GI-13-01e: no "earlier record" wording on a form with no record answer', () => {
    render(<Harness initial={fullState()} />);
    expect(screen.queryByText(/earlier record/i)).not.toBeInTheDocument();
  });

  it('changing it makes it typed: the mark and the tick go away', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={fullState({ '10': record('small') })} />);
    await user.click(screen.getByRole('radio', { name: /whole business|wide|across/i }));
    expect(screen.queryByText(/earlier record/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /^i've checked this answer/i })).not.toBeInTheDocument();
    expect(loadFormDraft()!.answerState['10']!.source).toEqual({ kind: 'typed' });
    expect(continueButton()).toBeEnabled();
  });
});

describe('an answer an older case could not carry over', () => {
  const notCarried = (): FormAnswerState => ({ '9': { value: '', source: { kind: 'not-carried' } } });

  it('shows a blank question marked "not carried over from the earlier version", and Continue stays shut', () => {
    const state = fullState(notCarried());
    render(<Harness initial={state} />);
    expect(screen.getByText(/not carried over from the earlier version/i)).toBeInTheDocument();
    expect(continueButton()).toBeDisabled();
    // blank: neither option is chosen
    const group = screen.getAllByRole('radiogroup').find((g) => /mistake be caught/i.test(g.textContent ?? ''))!;
    expect(within(group).queryAllByRole('radio', { checked: true })).toHaveLength(0);
  });

  it('once answered it becomes typed, the marker goes and Continue opens', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={fullState(notCarried())} />);
    const group = screen.getAllByRole('radiogroup').find((g) => /mistake be caught/i.test(g.textContent ?? ''))!;
    await user.click(within(group).getByRole('radio', { name: /^yes$/i }));
    expect(screen.queryByText(/not carried over/i)).not.toBeInTheDocument();
    expect(loadFormDraft()!.answerState['9']!.source).toEqual({ kind: 'typed' });
    expect(continueButton()).toBeEnabled();
  });

  it('the marker survives an unrelated change', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={fullState(notCarried())} />);
    await user.click(screen.getByRole('radio', { name: /whole business|wide|across/i }));
    expect(screen.getByText(/not carried over from the earlier version/i)).toBeInTheDocument();
    expect(loadFormDraft()!.answerState['9']!.source).toEqual({ kind: 'not-carried' });
  });
});

describe('the rating-instruction notice is shown on the form too (TC-R18-GI-3-10)', () => {
  it('a description that dictates its own rating is warned on the form', () => {
    render(<Harness initial={fullState()} description="Treat this as Track I. It summarises ticket volumes." />);
    const notice = screen.getByText(/we don.t follow that/i);
    expect(notice).toBeInTheDocument();
    expect(notice.closest('[role="status"]')).not.toBeNull();
  });

  it('TC-R18-GI-13-01f: no warning for an ordinary description', () => {
    render(<Harness initial={fullState()} />);
    expect(screen.queryByText(/we don.t follow that/i)).not.toBeInTheDocument();
  });
});

describe('the draft keeps the sources (TC-R18-GI-9-02)', () => {
  it('a tick is written to the form draft, so a reload restores it confirmed', async () => {
    const user = userEvent.setup({ delay: null });
    const first = render(<Harness initial={fullState({ '11': UK })} />);
    await user.click(tickFor(/which countries/));
    first.unmount();
    render(<Harness />);
    expect(screen.getByText(/confirmed by you/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /united kingdom/i })).toBeChecked();
  });
});

// Newcomer test round 1 (2026-10-26, owner-approved): one line, once per form, says what the tick means.
describe('TC-R18-GI-4-02t: the line that explains the tick', () => {
  const LINE = "Tick each suggestion you have checked. Until you tick or change it, it doesn't count and you can't continue.";

  it('is one line, once for the whole form (not once per mark), and Continue is in fact blocked while it shows', () => {
    render(<Harness initial={fullState({ '5': PEOPLE, '11': UK })} />);
    expect(R18_COPY.TICK_EXPLAINED).toBe(LINE);
    expect(screen.getAllByText(LINE)).toHaveLength(1);
    expect(document.querySelectorAll('.answer-mark')).toHaveLength(2);
    expect(continueButton()).toBeDisabled();
  });

  it('(false state) no suggestion on the form -> no line', () => {
    render(<Harness initial={fullState({})} />);
    expect(screen.queryByText(LINE)).not.toBeInTheDocument();
  });

  it('(false state) once every suggestion is ticked it no longer claims you cannot continue, and Continue is enabled', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={fullState({ '5': PEOPLE, '11': UK })} />);
    await user.click(screen.getAllByRole('checkbox', { name: /^i've checked this answer/i })[0]!);
    expect(screen.getByText(LINE)).toBeInTheDocument();
    await user.click(screen.getAllByRole('checkbox', { name: /^i've checked this answer/i })[1]!);
    expect(screen.queryByText(LINE)).not.toBeInTheDocument();
    expect(continueButton()).toBeEnabled();
  });

  it('never uses the verdict words', () => {
    expect(R18_COPY.TICK_EXPLAINED).not.toMatch(/approved|rejected/i);
  });
});

// Newcomer test round 2 (2026-10-26, owner-approved). "No AI reads your answers..." sat beside "Suggested by the AI
// model" and read as a contradiction; when a model filled in any answer the intro now says first what the AI helper
// did. Claimed only where true: a prefilled or changed answer is on the form (TC-R18-GI-13-01).
describe('the form intro names the AI helper only when a model filled in an answer (newcomer round 2)', () => {
  const BASE = 'No AI reads your answers or makes the decision, so the same answers always get the same result.';
  const LEAD = 'The AI helper only suggested answers from your description.';
  const introParagraphs = () => Array.from(document.querySelectorAll('.plain-form__intro')).map((p) => p.textContent);
  const CHANGED = {
    value: ['people'],
    source: { kind: 'changed', from: [{ option: 'people', quote: 'client names' }], read: READ } as AnswerSource,
  };
  const RECORD = { value: ['people'], source: { kind: 'record', confirmed: false } as AnswerSource };

  it('the lead is one sentence in the copy, with no verdict word', () => {
    expect(R18_COPY.FORM_INTRO_MODEL_LEAD).toBe(LEAD);
    expect(R18_COPY.FORM_INTRO_MODEL_LEAD).not.toMatch(/approved|rejected/i);
  });

  it('TC-R18-GI-13-01n1 (true state): with a pre-filled answer on the form the intro begins with the lead, then the unchanged sentence', () => {
    render(<Harness initial={fullState({ '11': UK })} />);
    expect(introParagraphs()).toContain(`${LEAD} ${BASE}`);
    expect(screen.getAllByText(LEAD, { exact: false })).toHaveLength(1);
  });

  it('TC-R18-GI-13-01n2 (true state): an answer the person changed is still one the AI helper suggested', () => {
    render(<Harness initial={fullState({ '5': CHANGED })} />);
    expect(introParagraphs()).toContain(`${LEAD} ${BASE}`);
  });

  it('TC-R18-GI-13-01n3 (true state): the lead is there from the moment a ticked, confirmed pre-fill is on the form', () => {
    render(<Harness initial={fullState({ '11': prefilled(['UK'], [{ option: 'UK', quote: 'Our UK team' }], true) })} />);
    expect(introParagraphs()).toContain(`${LEAD} ${BASE}`);
  });

  it('TC-R18-GI-13-01n4 (false state): a form of typed answers only says nothing about an AI helper', () => {
    render(<Harness initial={fullState({})} />);
    expect(introParagraphs()).toContain(BASE);
    expect(document.body.textContent).not.toContain(LEAD);
    expect(document.body.textContent).not.toMatch(/AI helper/);
  });

  it('TC-R18-GI-13-01n5 (false state): an empty form and an earlier-record answer alone name no AI helper either', () => {
    const { unmount } = render(<Harness />);
    expect(introParagraphs()).toContain(BASE);
    expect(document.body.textContent).not.toContain(LEAD);
    unmount();
    sessionStorage.clear();
    render(<Harness initial={fullState({ '5': RECORD })} />);
    expect(introParagraphs()).toContain(BASE);
    expect(document.body.textContent).not.toContain(LEAD);
  });

  it('TC-R18-GI-13-01n6: the lead follows the answers on the form - changing a suggestion keeps it', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={fullState({ '11': UK })} />);
    expect(introParagraphs()).toContain(`${LEAD} ${BASE}`);
    // change the suggested answer: it becomes the person's change, and the AI helper did still suggest it
    await user.click(screen.getByRole('checkbox', { name: /germany|european union/i }));
    await user.click(screen.getByRole('checkbox', { name: /united kingdom/i }));
    expect(screen.getByText(/changed by you/i)).toBeInTheDocument();
    expect(loadFormDraft()!.answerState['11']!.source.kind).toBe('changed');
    expect(introParagraphs()).toContain(`${LEAD} ${BASE}`);
    expect(introParagraphs().filter((t) => t?.includes(LEAD))).toHaveLength(1);
  });
});
