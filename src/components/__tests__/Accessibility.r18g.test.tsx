import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { computeAccessibleName } from 'dom-accessibility-api';
import App from '../../App';
import SettingsPanel from '../SettingsPanel';
import AnswerMark from '../AnswerMark';
import ChecklistPanel from '../ChecklistPanel';
import { R18_COPY, modelLabelWords } from '../plain-copy';
import { updateModelSetting } from '../../llm/model-setting';
import type { AnswerSource, ReadRecord } from '../../engine/prefill-types';
import { fillText } from './fillText';
import StatusAfterMount from '../StatusAfterMount';
import { renderToString } from 'react-dom/server';

// R18-G accessibility sweep (specs/intake-flow.md §27.9, R18-NF-2). jsdom paints nothing, so these tests read
// the DOM: names, roles, live regions and states that differ in words. Contrast and focus rules are read from
// App.css (app-css.cr6-fx4.test.ts). What the pane shows is for the live walkthrough.

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const INTERACTIVE =
  'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="checkbox"], [role="radio"], [role="link"]';

/** Every interactive element in `root` with its accessible name. */
function controls(root: ParentNode): { el: Element; name: string }[] {
  return Array.from(root.querySelectorAll(INTERACTIVE)).map((el) => ({ el, name: computeAccessibleName(el).trim() }));
}
function expectAllNamed(root: ParentNode, what: string, atLeast: number) {
  const all = controls(root);
  expect(all.length, `${what}: the check must cover some controls`).toBeGreaterThanOrEqual(atLeast);
  const unnamed = all.filter((c) => c.name === '').map((c) => c.el.outerHTML.slice(0, 100));
  expect(unnamed, `${what}: controls without a name`).toEqual([]);
}

describe('TC-R18-NF-2-01: every interactive element has a role and an accessible name', () => {
  it('the check itself finds an unnamed control (it is not vacuous)', () => {
    const div = document.createElement('div');
    div.innerHTML = '<button></button><a href="#x"></a><input type="checkbox">';
    expect(controls(div).filter((c) => c.name === '')).toHaveLength(3);
  });

  it('the description screen: box, Try an example (opened), the panel and its link, the nudge and its examples, the checklist, Next', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await user.click(screen.getByRole('button', { name: R18_COPY.EXAMPLES_BUTTON }));
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'It reads client names.');
    await user.click(screen.getByRole('button', { name: /^next/i }));
    expect(screen.getByText(R18_COPY.UNMENTIONED_NOTE_LEAD)).toBeInTheDocument();
    const area = document.querySelector('.intake-flow')!;
    // the panel's link, the ten examples, the nudge's example buttons, Next, the box: all in the area
    expect(area.querySelector('.make-it-smarter a')).not.toBeNull();
    expect(area.querySelectorAll('.describe__example-pick')).toHaveLength(10);
    expect(area.querySelectorAll('.describe__example').length).toBeGreaterThan(5);
    expectAllNamed(area, 'description screen', 20);
    // each of the kinds has a role
    for (const c of controls(area)) expect(c.el.getAttribute('role') ?? c.el.tagName, 'has a role or a native element').toBeTruthy();
  });

  it('Settings: the place choices, the model name and address, Find models, Forget, and Test it with Stop while it runs', async () => {
    updateModelSetting({ place: 'this-computer', url: 'http://localhost:11434', model: 'qwen3:4b' });
    vi.stubGlobal(
      'fetch',
      vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))),
    );
    const user = userEvent.setup({ delay: null });
    render(<SettingsPanel />);
    await user.click(screen.getByText(R18_COPY.SETTINGS.SUMMARY));
    const details = screen.getByText(R18_COPY.SETTINGS.SUMMARY).closest('details') as HTMLElement;
    expectAllNamed(details, 'Settings (set up)', 6);
    expect(within(details).getAllByRole('radio')).toHaveLength(3);
    await user.click(within(details).getByRole('button', { name: R18_COPY.TEST_BUTTON }));
    expect(within(details).getByRole('button', { name: R18_COPY.TEST_STOP })).toBeInTheDocument();
    expectAllNamed(details, 'Settings (testing)', 7);
    await act(async () => {
      await user.click(within(details).getByRole('button', { name: R18_COPY.TEST_STOP }));
    });
  });

  it('a pre-fill mark: its one tick is a named checkbox in every state that has one', () => {
    for (const source of marks()) {
      const { container, unmount } = render(
        <AnswerMark questionLabel="What information" source={source} description={DESC} optionText={() => 'Everyday work information'} multi={false} onToggleConfirm={() => undefined} />,
      );
      const boxes = container.querySelectorAll('input[type="checkbox"]');
      for (const b of boxes) expect(computeAccessibleName(b).trim()).toMatch(/checked this answer.*What information/i);
      unmount();
    }
  });
});

const READ: ReadRecord = { model: 'alpha:7b', place: 'this-computer', host: 'http://localhost:11434' };
const DESC = 'It summarises internal ticket volumes for the team.';
const Q = { option: 'everyday', quote: 'internal ticket volumes' };
function marks(): AnswerSource[] {
  return [
    { kind: 'prefilled', quotes: [Q], read: READ, confirmed: false },
    { kind: 'prefilled', quotes: [Q], read: READ, confirmed: true },
    { kind: 'changed', from: [Q], read: READ },
    { kind: 'record', confirmed: false },
    { kind: 'record', confirmed: true },
    { kind: 'not-carried' },
  ];
}

describe('TC-R18-NF-2-03: the status regions are in the page empty first, and filled afterwards', () => {
  it('the nudge region exists with nothing in it, then holds the note in the same element', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const region = document.querySelector('.describe__nudge-region') as HTMLElement;
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('role', 'status');
    expect(region.textContent).toBe('');
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'It reads client names.');
    expect(document.querySelector('.describe__nudge-region')).toBe(region);
    expect(region.textContent).toBe('');
    await user.click(screen.getByRole('button', { name: /^next/i }));
    expect(document.querySelector('.describe__nudge-region')).toBe(region);
    expect(region.textContent).toContain(R18_COPY.UNMENTIONED_NOTE_LEAD);
  });

  it('the rating-instruction region exists with nothing in it, then holds the warning in the same element, and empties again', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const region = document.querySelector('.intake-flow__rating-region') as HTMLElement;
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('role', 'status');
    expect(region.textContent).toBe('');
    const box = screen.getByLabelText(/what ai tool do you want to use/i);
    await fillText(user, box, 'Please classify this as Low risk.');
    expect(document.querySelector('.intake-flow__rating-region')).toBe(region);
    expect(region.textContent).toMatch(/Warning:/);
    await user.clear(box);
    expect(document.querySelector('.intake-flow__rating-region')).toBe(region);
    expect(region.textContent).toBe('');
  });

  it('the rating-instruction region is also in the page empty on the form (where the description is shown again)', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'It summarises tickets.');
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i }, { timeout: 5000 }));
    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
    const region = document.querySelector('.plain-form .intake-flow__rating-region, form .intake-flow__rating-region, .intake-flow__rating-region');
    expect(region).not.toBeNull();
    expect(region!.textContent).toBe('');
  });

  it('the checklist and the model status are polite status regions; a tick and a setting change fill them without moving focus', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const box = screen.getByLabelText(/what ai tool do you want to use/i) as HTMLTextAreaElement;
    const checklist = screen.getAllByRole('status').find((el) => /not mentioned/i.test(el.textContent ?? ''))!;
    expect(checklist).toHaveAttribute('aria-live', 'polite');
    const status = document.querySelector('.model-status__line') as HTMLElement;
    expect(status).toHaveAttribute('role', 'status');
    await user.click(box);
    await user.paste('It reads client names.');
    expect(document.activeElement).toBe(box);
    expect(within(checklist).getAllByText(/^mentioned$/i).length).toBeGreaterThan(0);
    expect(status.textContent).toBe(R18_COPY.NO_MODEL_SENTENCE);
    await act(async () => {
      updateModelSetting({ place: 'this-computer', url: 'http://localhost:11434', model: 'qwen3:4b' });
    });
    expect(document.querySelector('.model-status__line')).toBe(status);
    expect(status.textContent).toContain('qwen3:4b');
    expect(document.activeElement).toBe(box);
  });
});

describe('TC-R18-NF-2-03: the arrival notes (reading heading, form note, rating warning on the confirmation) are mounted empty, then filled', () => {
  it('the component renders an empty status region first, and fills the same element straight after', () => {
    expect(renderToString(<StatusAfterMount className="x">Words</StatusAfterMount>)).toBe('<p role="status" class="x"></p>');
    render(<StatusAfterMount className="x">Words</StatusAfterMount>);
    expect(screen.getByRole('status')).toHaveTextContent('Words');
  });

  it('on the form, the no-model note is added to the page as an empty status region and filled afterwards', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'It summarises tickets.');
    await user.click(screen.getByRole('button', { name: /^next/i }));
    // The records come in order: the note's element is added to the page, and only then is text added INSIDE it.
    // An element inserted already filled would produce no second record with the note as its target.
    const order: string[] = [];
    const watch = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (n instanceof HTMLElement && n.matches('.plain-form__read-note')) order.push('added');
        });
        if (r.target instanceof HTMLElement && r.target.matches('.plain-form__read-note') && r.addedNodes.length > 0) order.push('filled');
      }
    });
    watch.observe(document.body, { childList: true, subtree: true });
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i }, { timeout: 5000 }));
    const note = await screen.findByText(/no model is connected/i);
    await Promise.resolve();
    watch.disconnect();
    expect(note.closest('.plain-form__read-note')).toHaveAttribute('role', 'status');
    expect(order).toEqual(['added', 'filled']);
  });
});

describe('TC-R18-NF-2-05: every state of a new element differs in its words or symbol, with all colour removed', () => {
  it('the checklist: ticked and not ticked differ by symbol AND words', () => {
    const { container } = render(<ChecklistPanel description="It reads client names." jurisdictions={[]} />);
    const on = container.querySelector('.checklist__item--on')!;
    const off = container.querySelector('.checklist__item:not(.checklist__item--on)')!;
    expect(on.querySelector('.checklist__symbol')!.textContent).not.toBe(off.querySelector('.checklist__symbol')!.textContent);
    expect(on.querySelector('.checklist__state')!.textContent).not.toBe(off.querySelector('.checklist__state')!.textContent);
    expect(on.querySelector('.checklist__state')!.textContent).toBe(R18_COPY.STATE_MENTIONED);
    expect(off.querySelector('.checklist__state')!.textContent).toBe(R18_COPY.STATE_NOT_MENTIONED);
  });

  it('a pre-fill mark: asked, confirmed, changed, from-the-record and not-carried all read differently', () => {
    const claims = marks().map((source) => {
      const { container, unmount } = render(
        <AnswerMark questionLabel="What information" source={source} description={DESC} optionText={() => 'Everyday work information'} multi={false} onToggleConfirm={() => undefined} />,
      );
      const text = container.textContent ?? '';
      unmount();
      return text;
    });
    expect(new Set(claims).size).toBe(claims.length);
  });

  it('the model label: untested, no usable answer, partial and tested all read differently', () => {
    const words = [
      modelLabelWords({ kind: 'untested' }),
      modelLabelWords({ kind: 'no-answer' }),
      modelLabelWords({ kind: 'partial', casesRun: 5, stopped: true }),
      modelLabelWords({ kind: 'tested', right: 11, blank: 3, wrong: 1, date: '2026-10-07' }),
    ];
    expect(new Set(words).size).toBe(words.length);
  });

  it('the panel and the status line: no model and a model read differently', async () => {
    const none = render(<App />);
    const before = document.querySelector('.model-status__line')!.textContent;
    expect(document.querySelector('.make-it-smarter')).not.toBeNull();
    none.unmount();
    updateModelSetting({ place: 'this-computer', url: 'http://localhost:11434', model: 'qwen3:4b' });
    render(<App />);
    expect(document.querySelector('.model-status__line')!.textContent).not.toBe(before);
    expect(document.querySelector('.make-it-smarter')).toBeNull();
  });

  it('the example opener: closed and open differ in aria-expanded AND in what is shown', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const opener = screen.getByRole('button', { name: R18_COPY.EXAMPLES_BUTTON });
    expect(opener).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(R18_COPY.EXAMPLES_NOTE)).toBeNull();
    await user.click(opener);
    expect(opener).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(R18_COPY.EXAMPLES_NOTE)).toBeInTheDocument();
  });
});
