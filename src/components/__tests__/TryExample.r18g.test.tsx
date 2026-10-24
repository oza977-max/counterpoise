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
  const region = screen.getAllByRole('status').find((el) => /not mentioned/i.test(el.textContent ?? ''))!;
  return within(region).queryAllByText(/^mentioned$/i).length;
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
      expect(box()).toHaveValue(WORKED_EXAMPLES[i]!.description);
    }
  });

  it('replaces whatever was typed (the person pressed a button that says so by name), and Next is then enabled', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, box(), 'My own words.');
    const list = await openList(user);
    await user.click(within(list).getAllByRole('button')[1]!);
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
      const unticked = screen.getAllByText(/^not mentioned$/i).length;
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
