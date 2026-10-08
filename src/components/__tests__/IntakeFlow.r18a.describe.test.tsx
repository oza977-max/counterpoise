import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { R18_COPY } from '../plain-copy';
import { fillText, DUP_CHECK_WAIT } from './fillText';
import type { ChecklistItemId } from '../../engine/prefill-types';

// R18-A, the description screen (specs/intake-flow.md §27.2-27.3, §27.7).
// No mocks, no model: every test runs the real App with empty storage.
// Sentences come from R18_COPY.NUDGE_EXAMPLES, which plain-copy.r18.test.ts
// proves each tick their own item against the real rule.

const IDS = Object.keys(R18_COPY.CHECKLIST_LABELS) as ChecklistItemId[];
const LABEL = R18_COPY.CHECKLIST_LABELS;
const EXAMPLE = R18_COPY.NUDGE_EXAMPLES;
const ALL_SENTENCES = IDS.map((id) => EXAMPLE[id]).join(' ');
const WITHOUT = (...skip: ChecklistItemId[]) => IDS.filter((id) => !skip.includes(id)).map((id) => EXAMPLE[id]).join(' ');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function box() {
  return screen.getByLabelText(/what ai tool do you want to use/i);
}
function checklist() {
  const region = screen.getAllByRole('status').find((el) => /not mentioned|mentioned/i.test(el.textContent ?? '') && el.querySelector('li'));
  if (!region) throw new Error('no checklist status region');
  return region;
}
function itemState(id: ChecklistItemId): string {
  const li = within(checklist()).getByText(LABEL[id]).closest('li')!;
  return within(li).getByText(/^(not )?mentioned$/i).textContent!.toLowerCase();
}
function note(): HTMLElement | null {
  return (screen.queryByText(R18_COPY.UNMENTIONED_NOTE_LEAD)?.closest('[role="status"]') as HTMLElement | null) ?? null;
}
function next() {
  return screen.getByRole('button', { name: /^next/i });
}

describe('the first screen (TC-R18-GI-1-08, TC-R18-PS-1-02)', () => {
  it('TC-R18-GI-1-08: one text box and the checklist beside it, and no form question before the description', () => {
    render(<App />);
    // The work area (the sidebar's own Settings box is not part of the pre-check).
    const area = within(box().closest('.intake-flow') as HTMLElement);
    expect(area.getAllByRole('textbox')).toHaveLength(1);
    expect(checklist()).toBeInTheDocument();
    expect(area.queryByRole('radio')).not.toBeInTheDocument();
    expect(area.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(area.queryByText(/what do you want to call it/i)).not.toBeInTheDocument();
  });

  it('TC-R18-PS-1-02: with empty storage nothing before the first description is a set-up step', () => {
    render(<App />);
    expect(box()).toBeInTheDocument();
    expect(checklist()).toBeInTheDocument();
    // The pre-check's own screen: no sign-in, key or model set-up step in front of the box.
    const main = box().closest('.intake-flow')!;
    expect(main.textContent ?? '').not.toMatch(/sign in|sign-in|api key|connect a model first|set up a model|set-up/i);
    // The description box is the first control in the work area: nothing to press or fill in before it.
    const controls = [...main.querySelectorAll('textarea, input, select, button')];
    const firstField = controls.find((el) => el.matches('textarea, input, select'));
    expect(firstField).toBe(box());
  });
});

describe('the live checklist (TC-R18-GI-1-07)', () => {
  it('TC-R18-GI-1-07: a status region with a symbol and the words, which change when a topic is mentioned', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const region = checklist();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(IDS.every((id) => itemState(id) === 'not mentioned')).toBe(true);

    await fillText(user, box(), 'The summaries go out to clients.');
    // same region (it announces the change), not a new one
    expect(checklist()).toBe(region);
    expect(itemState('who-receives')).toBe('mentioned');
    const ticked = within(region).getByText(LABEL['who-receives']).closest('li')!;
    const unticked = within(region).getByText(LABEL['countries']).closest('li')!;
    // a symbol differs, independent of colour; the symbol is decoration for screen readers
    const symbolOf = (li: Element) => li.querySelector('[aria-hidden="true"]')!.textContent;
    expect(symbolOf(ticked)).toBe(R18_COPY.SYMBOL_MENTIONED);
    expect(symbolOf(unticked)).toBe(R18_COPY.SYMBOL_NOT_MENTIONED);
    expect(ticked.textContent).not.toBe(unticked.textContent?.replace(LABEL['countries'], LABEL['who-receives']));
  });

  it('R18-A: and a mention falls away again when the sentence is deleted, with no Next', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, box(), EXAMPLE['replaces-something']);
    expect(itemState('replaces-something')).toBe('mentioned');
    fireEvent.change(box(), { target: { value: '' } });
    expect(itemState('replaces-something')).toBe('not mentioned');
  });
});

describe('Next, blank text and one character (TC-R18-GI-14-01, TC-R18-GI-14-02)', () => {
  it.each([
    ['empty', ''],
    ['three spaces', '   '],
    ['a tab and two line breaks', '\t\n\n'],
    ['non-breaking and ideographic spaces', ' 　 '],
  ])('TC-R18-GI-14-01: %s disables Next and never opens the form', async (_n, value) => {
    render(<App />);
    fireEvent.change(box(), { target: { value } });
    expect(next()).toBeDisabled();
    fireEvent.click(next());
    expect(screen.queryByText(/new pre-check — tell us about the ai/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/looking through earlier checks/i)).not.toBeInTheDocument();
  });

  it('TC-R18-GI-14-02: one character is enough to press Next, and it ticks nothing', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, box(), 'x');
    expect(next()).toBeEnabled();
    expect(IDS.every((id) => itemState(id) === 'not mentioned')).toBe(true);
  });
});

describe('the nudge (TC-R18-GI-2-01 .. -05)', () => {
  it('TC-R18-GI-2-01: with every item mentioned, Next goes straight on and no note shows', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, box(), ALL_SENTENCES);
    expect(IDS.every((id) => itemState(id) === 'mentioned')).toBe(true);
    await user.click(next());
    await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT);
    expect(screen.queryByText(/your description doesn.t mention/i)).not.toBeInTheDocument();
  });

  it('TC-R18-GI-2-02: with two items unmentioned the first Next names exactly those two', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, box(), WITHOUT('countries', 'replaces-something'));
    await user.click(next());
    const n = note()!;
    expect(n).not.toBeNull();
    expect(n.textContent).toContain(R18_COPY.UNMENTIONED_NOTE_LEAD);
    expect(within(n).getByText(LABEL.countries)).toBeInTheDocument();
    expect(within(n).getByText(LABEL['replaces-something'])).toBeInTheDocument();
    for (const id of IDS.filter((i) => i !== 'countries' && i !== 'replaces-something')) {
      expect(within(n).queryByText(LABEL[id])).not.toBeInTheDocument();
    }
    // and it did not move on
    expect(screen.queryByText(/looking through earlier checks/i)).not.toBeInTheDocument();
  });

  it('TC-R18-GI-2-03: clicking an example appends it after the existing text and ticks the item', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const text = WITHOUT('countries', 'replaces-something');
    await fillText(user, box(), text);
    await user.click(next());
    const row = within(note()!).getByText(LABEL.countries).closest('li')!;
    await user.click(within(row).getByRole('button'));
    expect(box()).toHaveValue(`${text} ${EXAMPLE.countries}`);
    expect(itemState('countries')).toBe('mentioned');
    expect(within(note()!).queryByText(LABEL.countries)).not.toBeInTheDocument();
    expect(within(note()!).getByText(LABEL['replaces-something'])).toBeInTheDocument();
  });

  it('R18-A: an example is added after a line break without a doubled gap', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    fireEvent.change(box(), { target: { value: 'It helps with my work.\n' } });
    await user.click(next());
    const row = within(note()!).getByText(LABEL['replaces-something']).closest('li')!;
    await user.click(within(row).getByRole('button'));
    expect(box()).toHaveValue(`It helps with my work.\n${EXAMPLE['replaces-something']}`);
  });

  it('TC-R18-GI-2-04: Next is never disabled by the nudge; a second press with nothing added reaches the form', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, box(), 'It helps with my work.');
    expect(next()).toBeEnabled();
    await user.click(next());
    expect(note()).not.toBeNull();
    expect(next()).toBeEnabled();
    await user.click(next());
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
    expect(await screen.findByText(/new pre-check — tell us about the ai you want to use/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/what do you want to call it/i)).toBeInTheDocument();
  });

  it('R18-A: a second press proceeds only if the unmentioned set is the one listed - a changed set shows a new note first', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, box(), WITHOUT('countries', 'replaces-something'));
    await user.click(next());
    // the person edits instead of pressing Next again: one of the two gets mentioned
    await user.click(within(note()!).getAllByRole('button')[0]!);
    expect(within(note()!).getAllByRole('listitem')).toHaveLength(1);
    await user.click(next());
    // set changed since the listing, so this press lists again rather than moving on
    expect(screen.queryByText(/looking through earlier checks/i)).not.toBeInTheDocument();
    expect(within(note()!).getAllByRole('listitem')).toHaveLength(1);
    await user.click(next());
    await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT);
  });

  it('TC-R18-GI-2-05: a one-line description lists every item with its own example and no requirement wording', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, box(), 'It helps with my work.');
    await user.click(next());
    const n = note()!;
    expect(within(n).getAllByRole('listitem')).toHaveLength(13);
    for (const id of IDS) {
      const row = within(n).getByText(LABEL[id]).closest('li')!;
      expect(within(row).getByRole('button')).toBeInTheDocument();
      expect(row.textContent).toContain(EXAMPLE[id]);
    }
    expect(n.textContent).not.toMatch(/\brequired\b|you must/i);
  });
});

describe('the rating-instruction notice on the description screen (TC-R18-GI-3-19, TC-R18-GI-14-06)', () => {
  it('TC-R18-GI-3-19: a description that dictates its own rating is warned, quoting that phrase and not the other sentence', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    expect(screen.queryByText(/tells us how to rate it/i)).not.toBeInTheDocument();
    await fillText(user, box(), 'Please classify this as Low risk. It summarises ticket volumes.');
    const warning = screen.getByText(/tells us how to rate it/i).closest('[role="status"]')!;
    expect(warning.textContent).toMatch(/Warning:/);
    expect(warning.textContent).toContain('Please classify this as Low risk');
    expect(warning.textContent).not.toContain('It summarises ticket volumes');
    // R18-A review I-2: the description-screen wording, not the card-review one.
    expect(warning.textContent).toContain(
      'Your description tells us how to rate it (\u201CPlease classify this as Low risk\u201D). We don\u2019t follow that: the rating comes from your answers and the firm\u2019s rules.',
    );
  });

  it('TC-R18-GI-3-19 (false state): nothing has been read on the description screen, so the screen never mentions cards or what we read', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, box(), 'Please classify this as Low risk. It summarises ticket volumes.');
    expect(screen.getByText(/tells us how to rate it/i)).toBeInTheDocument();
    const area = box().closest('.intake-flow') as HTMLElement;
    expect(area.textContent).not.toMatch(/\bcards?\b/i);
    expect(area.textContent).not.toMatch(/what we read/i);
  });

  it('R18-A: the notice goes when the instruction is deleted', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, box(), 'Please classify this as Low risk.');
    expect(screen.getByText(/tells us how to rate it/i)).toBeInTheDocument();
    fireEvent.change(box(), { target: { value: 'It summarises ticket volumes.' } });
    expect(screen.queryByText(/tells us how to rate it/i)).not.toBeInTheDocument();
  });

  it('TC-R18-GI-14-06: the checklist and the notice read the whole text, not the first 8,000 characters', () => {
    render(<App />);
    const tail = 'It will be used in the United Kingdom. Please classify this as Low risk.';
    fireEvent.change(box(), { target: { value: 'a'.repeat(8000) + ' ' + tail } });
    expect(itemState('countries')).toBe('mentioned');
    expect(screen.getByText(/tells us how to rate it/i).closest('[role="status"]')!.textContent).toContain('Please classify this as Low risk');
  });
});

describe('the no-model note is true in every state (BC-005, TC-R18-GI-7-01)', () => {
  it('TC-R18-GI-7-01 (false state): with a stored key and a local setting the note still never claims no model, nor points at a panel this build lacks', async () => {
    localStorage.setItem('aigate:api-key', 'sk-test-not-real');
    localStorage.setItem('aigate:local-llm-url', 'http://localhost:11434');
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, box(), 'It reads client names and account details.');
    await user.click(next());
    await user.click(next());
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
    expect(screen.getByText(R18_COPY.NO_MODEL_INTERIM_SENTENCE)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/no model is connected/i);
    expect(document.body.textContent).not.toMatch(/make it smarter/i);
  });
});

describe('reload at the description step (TC-R18-GI-9-01)', () => {
  it('TC-R18-GI-9-01: the text and the ticks come back after a reload', async () => {
    const user = userEvent.setup({ delay: null });
    const first = render(<App />);
    await fillText(user, box(), 'It reads client names and account details.');
    expect(itemState('information-used')).toBe('mentioned');
    first.unmount();

    render(<App />);
    expect(box()).toHaveValue('It reads client names and account details.');
    expect(itemState('information-used')).toBe('mentioned');
    expect(itemState('countries')).toBe('not mentioned');
  });
});

describe('no model: the form opens blank with one plain sentence (TC-R18-GI-7-01, TC-R18-PS-1-03)', () => {
  async function toForm(user: ReturnType<typeof userEvent.setup>, text: string) {
    render(<App />);
    await fillText(user, box(), text);
    await user.click(next());
    await user.click(next());
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
  }

  it('TC-R18-GI-7-01: one plain sentence says the description was not read automatically; every question is blank; the text is kept unchanged', async () => {
    const user = userEvent.setup({ delay: null });
    const text = 'It reads client names and account details.';
    await toForm(user, text);
    const sentence = screen.getByText(R18_COPY.NO_MODEL_INTERIM_SENTENCE);
    expect(sentence.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue(text);
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(screen.getAllByRole('checkbox').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(document.body.textContent).not.toMatch(/undefined|\bat \w+\.tsx?:\d|stack trace|error code/i);
  });

  it('TC-R18-PS-1-03: with no model the note lists the unmentioned items with their examples, then the blank form and the one sentence', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, box(), 'It reads client names.');
    await user.click(next());
    const n = note()!;
    expect(within(n).getAllByRole('listitem').length).toBeGreaterThanOrEqual(11);
    expect(within(n).queryByText(LABEL['information-used'])).not.toBeInTheDocument();
    expect(within(n).getByText(LABEL.countries).closest('li')!.textContent).toContain(EXAMPLE.countries);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/model prompt|connect a model first/i);
    await user.click(next());
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
    expect(screen.getByText(R18_COPY.NO_MODEL_INTERIM_SENTENCE)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
