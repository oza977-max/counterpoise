import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { R18_COPY } from '../plain-copy';
import { WORKED_EXAMPLES } from '../../engine/worked-examples';
import { fillText } from './fillText';

// R18-G, "Try an example" (specs/intake-flow.md §27.12, R18-PS-3).

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const box = () => screen.getByLabelText(/what ai tool do you want to use/i);
const openList = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: R18_COPY.EXAMPLES_BUTTON }));
  return screen.getByRole('list', { name: R18_COPY.EXAMPLES_LIST_LABEL });
};
const ticks = () => {
  const region = screen.getAllByRole('status').find((el) => /no words found/i.test(el.textContent ?? ''))!;
  return within(region).queryAllByText(/^words found$/i).length;
};

describe('TC-R18-PS-3-01: ten examples; a click fills the box and ticks the checklist', () => {
  it('the list holds ten, one per worked case, in the guide\'s order', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const list = await openList(user);
    const buttons = within(list).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(WORKED_EXAMPLES.map((e) => e.title));
  });

  it('choosing the first puts example 1\'s exact text in the box, ticks what it mentions, and holds no other example\'s text', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    expect(ticks()).toBe(0);
    const list = await openList(user);
    await user.click(within(list).getAllByRole('button')[0]!);
    expect(box()).toHaveValue(WORKED_EXAMPLES[0]!.description);
    expect(ticks()).toBeGreaterThan(0);
    for (const other of WORKED_EXAMPLES.slice(1)) expect((box() as HTMLTextAreaElement).value).not.toContain(other.description);
    // focus goes back to the box so the person can edit it
    expect(box()).toHaveFocus();
  });

  it('each of the ten fills its own text, replacing the one before (never a mix of two examples)', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    for (let i = 0; i < WORKED_EXAMPLES.length; i++) {
      const list = await openList(user);
      await user.click(within(list).getAllByRole('button')[i]!);
      // from the second on, the box holds the one before: the person is asked and says Replace
      if (i > 0) await user.click(screen.getByRole('button', { name: R18_COPY.EXAMPLE_REPLACE }));
      expect(box()).toHaveValue(WORKED_EXAMPLES[i]!.description);
    }
  });

  it('replaces what was typed only after the person says Replace (newcomer test round 1), and Next is then enabled', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, box(), 'My own words.');
    const list = await openList(user);
    await user.click(within(list).getAllByRole('button')[1]!);
    await user.click(screen.getByRole('button', { name: R18_COPY.EXAMPLE_REPLACE }));
    expect(box()).toHaveValue(WORKED_EXAMPLES[1]!.description);
    expect(screen.getByRole('button', { name: /^next/i })).toBeEnabled();
  });

  it('is operable by keyboard alone: the opener and each example are native buttons reached and pressed with Tab and Enter', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const opener = screen.getByRole('button', { name: R18_COPY.EXAMPLES_BUTTON });
    expect(opener).toHaveAttribute('aria-expanded', 'false');
    opener.focus();
    await user.keyboard('{Enter}');
    expect(opener).toHaveAttribute('aria-expanded', 'true');
    await user.tab();
    expect(document.activeElement).toBe(within(screen.getByRole('list', { name: R18_COPY.EXAMPLES_LIST_LABEL })).getAllByRole('button')[0]);
    await user.keyboard('{Enter}');
    expect(box()).toHaveValue(WORKED_EXAMPLES[0]!.description);
  });
});

describe('TC-R18-PS-3-04 / -05: what the list says, and does not say', () => {
  it('TC-R18-PS-3-05: the list says the examples are short and the checklist shows what they leave out', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    expect(screen.queryByText(R18_COPY.EXAMPLES_NOTE)).toBeNull();
    await openList(user);
    expect(screen.getByText('Examples are short — the checklist shows what they leave out.')).toBeInTheDocument();
    expect(R18_COPY.EXAMPLES_NOTE).toBe('Examples are short — the checklist shows what they leave out.');
  });

  it('TC-R18-PS-3-05 (false state): choosing an example claims no complete checklist while some item is unticked', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    for (let i = 0; i < WORKED_EXAMPLES.length; i++) {
      const list = await openList(user);
      await user.click(within(list).getAllByRole('button')[i]!);
      if (i > 0) await user.click(screen.getByRole('button', { name: R18_COPY.EXAMPLE_REPLACE }));
      const unticked = screen.getAllByText(/^no words found$/i).length;
      expect(unticked, `example ${i + 1} leaves items out`).toBeGreaterThan(0);
      expect(document.body.textContent).not.toMatch(/every (checklist )?item|all (13|thirteen|items)|everything is (ticked|covered)/i);
    }
  });

  it('TC-R18-PS-3-04: the list\'s copy promises nothing about what a model would fill in', () => {
    const copy = [R18_COPY.EXAMPLES_BUTTON, R18_COPY.EXAMPLES_LIST_LABEL, R18_COPY.EXAMPLES_NOTE].join(' ');
    expect(copy).not.toMatch(/will always fill|every model will|always fills|any model will|fills in the same/i);
    expect(copy).not.toMatch(/approved|rejected/i);
  });
});

// Newcomer test round 1 (2026-10-26, owner-approved): an example never silently overwrites the person's text.
describe('TC-R18-PS-3-06: an example asks before replacing what the person typed', () => {
  const ASK = "Replace what you've typed with this example?";

  it('the words are the owner-approved ones, with no verdict words', () => {
    expect(R18_COPY.EXAMPLE_REPLACE_ASK).toBe(ASK);
    expect(R18_COPY.EXAMPLE_REPLACE).toBe('Replace');
    expect(R18_COPY.EXAMPLE_KEEP).toBe('Keep mine');
    for (const k of ['EXAMPLE_REPLACE_ASK', 'EXAMPLE_REPLACE', 'EXAMPLE_KEEP'] as const) expect(R18_COPY[k]).not.toMatch(/approved|rejected/i);
  });

  it('typed text -> the question appears and the box is untouched until the person answers', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, box(), 'My own words.');
    const list = await openList(user);
    await user.click(within(list).getAllByRole('button')[0]!);
    expect(screen.getByText(ASK)).toBeInTheDocument();
    expect(box()).toHaveValue('My own words.');
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep mine' })).toBeInTheDocument();
  });

  it('Keep mine leaves the typed text exactly as it was and takes the question away', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, box(), 'My own words.');
    const list = await openList(user);
    await user.click(within(list).getAllByRole('button')[0]!);
    await user.click(screen.getByRole('button', { name: 'Keep mine' }));
    expect(box()).toHaveValue('My own words.');
    expect(screen.queryByText(ASK)).not.toBeInTheDocument();
  });

  it('Replace fills the box with the example and takes the question away', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, box(), 'My own words.');
    const list = await openList(user);
    await user.click(within(list).getAllByRole('button')[2]!);
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    expect(box()).toHaveValue(WORKED_EXAMPLES[2]!.description);
    expect(screen.queryByText(ASK)).not.toBeInTheDocument();
    expect(box()).toHaveFocus();
  });

  it('(false state) an empty box is filled with no question', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const list = await openList(user);
    await user.click(within(list).getAllByRole('button')[0]!);
    expect(screen.queryByText(ASK)).not.toBeInTheDocument();
    expect(box()).toHaveValue(WORKED_EXAMPLES[0]!.description);
  });

  it('(false state) a box that already holds that very example is not asked about', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    let list = await openList(user);
    await user.click(within(list).getAllByRole('button')[0]!);
    list = await openList(user);
    await user.click(within(list).getAllByRole('button')[0]!);
    expect(screen.queryByText(ASK)).not.toBeInTheDocument();
    expect(box()).toHaveValue(WORKED_EXAMPLES[0]!.description);
  });

  it('a different example over an example already in the box does ask (it would replace text)', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    let list = await openList(user);
    await user.click(within(list).getAllByRole('button')[0]!);
    list = await openList(user);
    await user.click(within(list).getAllByRole('button')[1]!);
    expect(screen.getByText(ASK)).toBeInTheDocument();
    expect(box()).toHaveValue(WORKED_EXAMPLES[0]!.description);
  });

  it('is native buttons, reached by Tab: the question is a group the keyboard can answer', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, box(), 'My own words.');
    const list = await openList(user);
    await user.click(within(list).getAllByRole('button')[0]!);
    const group = screen.getByRole('group', { name: ASK });
    expect(within(group).getAllByRole('button').map((b) => b.tagName)).toEqual(['BUTTON', 'BUTTON']);
    await user.keyboard('{Enter}');
    expect(box()).toHaveValue('My own words.');
  });
});
