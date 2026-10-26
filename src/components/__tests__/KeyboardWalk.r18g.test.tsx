import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { computeAccessibleName } from 'dom-accessibility-api';
import App from '../../App';
import { installModel, reply } from './r18c2Flow';

// R18-G, TC-R18-NF-2-04: the whole route walked with Tab, Space and Enter only (and the characters of the
// description and of the case name): description screen -> Next (the nudge, then on) -> similar checks ->
// the reading -> the form with one pre-filled answer to tick -> Continue -> Confirm and evaluate -> the result.
// No pointer is used at any step. At every step the focused thing is a real, named, native control (so the
// browser draws its focus ring, and App.css removes none: app-css.cr6-fx4.test.ts). jsdom paints nothing,
// so "a visible indicator" is proved by those two facts; the live walkthrough looks at the pane.

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

type User = ReturnType<typeof userEvent.setup>;

const DESCRIPTION = 'It reads client names. Our UK team will use it every morning.';
const FOCUSABLE = 'button, a[href], input, select, textarea, summary';

let steps = 0;
/** One Tab; checks that focus is on a named native control. Returns it. */
async function tab(user: User): Promise<HTMLElement> {
  await user.tab();
  const el = document.activeElement as HTMLElement;
  expect(el, 'focus is somewhere').not.toBe(document.body);
  expect(el.matches(FOCUSABLE), `a native control has focus: ${el.outerHTML.slice(0, 80)}`).toBe(true);
  expect(computeAccessibleName(el).trim(), `the focused control has a name: ${el.outerHTML.slice(0, 80)}`).not.toBe('');
  steps += 1;
  return el;
}
const nameOf = (el: Element) => computeAccessibleName(el).trim();

/** Tab until `match` is true of the focused element (at most `max` presses). */
async function tabTo(user: User, match: (el: HTMLElement) => boolean, max = 80): Promise<HTMLElement> {
  for (let i = 0; i < max; i++) {
    const el = await tab(user);
    if (match(el)) return el;
  }
  throw new Error('Tab never reached the control');
}

const inGroupWithAnswer = (el: HTMLInputElement): boolean => {
  if (el.type === 'radio') return document.querySelectorAll(`input[type="radio"][name="${el.name}"]:checked`).length > 0;
  const group = el.closest('fieldset, [role="group"], [role="radiogroup"]');
  return group ? group.querySelectorAll('input:checked').length > 0 : el.checked;
};

describe('TC-R18-NF-2-04: the whole route by keyboard', () => {
  it(
    'Tab, Space and Enter take a first-time visitor from the description to a result, with one pre-filled answer to confirm',
    async () => {
      installModel({ kind: 'honours-format', reply: reply([{ question: '5', values: [{ option: 'people', quote: 'client names' }] }]) });
      const user = userEvent.setup({ delay: null });
      render(<App />);
      steps = 0;

      // Describe: reach the box by Tab, type, then Next by Enter. The first press lists what is unmentioned.
      const box = await tabTo(user, (el) => el.id === 'description-input');
      await user.keyboard(DESCRIPTION);
      expect(box).toHaveValue(DESCRIPTION);
      await tabTo(user, (el) => /^next/i.test(nameOf(el)));
      await user.keyboard('{Enter}');
      expect(screen.getByText(/we found no words about:/i)).toBeInTheDocument();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /^next/i }));
      await user.keyboard('{Enter}');

      // Similar checks.
      await screen.findByRole('button', { name: /continue →|mine is different/i }, { timeout: 5000 });
      await tabTo(user, (el) => /continue →|mine is different/i.test(nameOf(el)));
      await user.keyboard('{Enter}');

      // The reading (fake model) and then the form, with Question 5 filled in and unticked.
      await screen.findByText(/new pre-check — tell us about the ai you want to use/i, undefined, { timeout: 5000 });
      expect(screen.getByRole('checkbox', { name: /information about people/i })).toBeChecked();
      const continueBtn = () => screen.getByRole('button', { name: /^continue$/i });
      expect(continueBtn()).toBeDisabled();

      // Walk the form: Space on the first option of every group with no answer, on the one tick, and the case
      // name typed where the cursor is. Continue is tabbed to only once the form lets it be reached.
      let ticked = false;
      let named = false;
      let reached: HTMLElement | null = null;
      for (let i = 0; i < 400 && reached === null; i++) {
        const el = await tab(user);
        const input = el as HTMLInputElement;
        if (el.tagName === 'INPUT' && input.type === 'text' && /call it/i.test(nameOf(el)) && !named) {
          await user.keyboard('Keyboard walk');
          named = true;
        } else if (el.tagName === 'INPUT' && (input.type === 'radio' || input.type === 'checkbox')) {
          if (/^i've checked this answer/i.test(nameOf(el))) {
            if (!input.checked) {
              await user.keyboard(' ');
              ticked = true;
            }
          } else if (!inGroupWithAnswer(input)) {
            await user.keyboard(' ');
          }
        } else if (/^continue$/i.test(nameOf(el)) && !(el as HTMLButtonElement).disabled) {
          reached = el;
        }
      }
      expect(named, 'the name was typed by keyboard').toBe(true);
      expect(ticked, 'the pre-filled answer was ticked by keyboard').toBe(true);
      expect(reached, 'Continue was reached by Tab once enabled').not.toBeNull();
      await user.keyboard('{Enter}');

      // Confirmation, then the result.
      await screen.findByText(/here.s what we understood/i);
      await tabTo(user, (el) => /confirm and evaluate/i.test(nameOf(el)), 120);
      await user.keyboard('{Enter}');
      await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 8000 });
      expect(document.querySelector('.verdict__cards')).not.toBeNull();
      expect(steps).toBeGreaterThan(20);
    },
    60000,
  );
});
