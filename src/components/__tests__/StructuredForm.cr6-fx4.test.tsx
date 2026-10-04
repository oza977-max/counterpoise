import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StructuredForm from '../StructuredForm';
import type { PolicyFile } from '../../engine/types';

// CR6-07 (code review 006): required questions must be announced as required
// to assistive technology, not only drawn with a visual asterisk.
beforeEach(() => {
  sessionStorage.clear();
});

function policy(): PolicyFile {
  return {
    version: '1.0',
    policy_id: 'TEST',
    firm_name: 'Test',
    translation_attestation: { attested_by: 'x', role: 'x', date: 'x', raf_version_checked: 'x' },
    hard_lines: [],
    tracks: [],
    tiers: [],
    invariants: [],
    controls: [],
    kri_thresholds: {},
    jurisdictions: [{ code: 'UK', name: 'United Kingdom', pack_files: [] }],
    roles: {},
    tier_workflow: { Critical: 'x', High: 'x', Medium: 'x', Low: 'x' },
    safety_margin: 0.1,
  };
}

describe('StructuredForm — CR6-07 required questions are announced', () => {
  it('TC-CR6-07a: the free-text controls and radio groups carry required/aria-required; tick-all legends say so; the asterisk has hidden text', () => {
    const { container } = render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);

    // Free text (Q1 name, Q2 description).
    for (const re of [/what do you want to call it/i, /in a sentence or two/i]) {
      const el = screen.getByLabelText(re);
      expect(el).toBeRequired();
      expect(el).toHaveAttribute('aria-required', 'true');
    }

    // Every required single-select is a real radiogroup with aria-required.
    const groups = screen.getAllByRole('radiogroup');
    expect(groups.length).toBeGreaterThanOrEqual(7);
    for (const g of groups) expect(g).toHaveAttribute('aria-required', 'true');

    // Tick-all groups say "(tick at least one)" in their legend.
    const legends = [...container.querySelectorAll('fieldset.plain-form__question > legend')].filter((l) =>
      /tick at least one/i.test(l.textContent ?? ''),
    );
    expect(legends.length).toBeGreaterThanOrEqual(2); // Q5 and Q11

    // The visual asterisk carries visually hidden text.
    const markers = container.querySelectorAll('.required-marker');
    expect(markers.length).toBeGreaterThanOrEqual(12);
    for (const m of markers) {
      // Radiogroups announce requiredness via aria-required (07e), so their
      // marker is the glyph only; every other marker carries the hidden text.
      if (m.closest('[role="radiogroup"]')) continue;
      expect(m.querySelector('.visually-hidden')?.textContent).toMatch(/\(required\)/i);
    }
  });

  it('TC-CR6-07b: a visible line by Continue says what is still missing and is tied to the button with aria-describedby; it goes when complete', async () => {
    const user = userEvent.setup();
    render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    const button = screen.getByRole('button', { name: /continue/i });
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const note = document.getElementById(describedBy!)!;
    expect(note).toBeVisible();
    expect(note.textContent).toMatch(/still to answer/i);
    expect(note.textContent).toMatch(/what do you want to call it/i);

    // Answering the first question removes it from the list.
    await user.type(screen.getByLabelText(/what do you want to call it/i), 'Test tool');
    expect(document.getElementById(describedBy!)!.textContent).not.toMatch(/what do you want to call it/i);
    expect(within(document.body).queryAllByText(/still to answer/i).length).toBe(1);
  });

  it('TC-CR6-07b: when the form is complete the line and the aria-describedby are both gone', async () => {
    const user = userEvent.setup();
    render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    const inGroup = (g: RegExp, o: RegExp) =>
      within(screen.getByRole('radiogroup', { name: g })).getByRole('radio', { name: o });
    await user.type(screen.getByLabelText(/what do you want to call it/i), 'Test tool');
    await user.type(screen.getByLabelText(/in a sentence or two/i), 'A test description.');
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    await user.click(screen.getByRole('radio', { name: /reads, summarises, translates, writes or answers questions in words/i }));
    await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
    await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
    await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
    await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
    await user.click(inGroup(/if it gets something wrong/i, /^yes$/i));
    await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
    await user.click(screen.getByRole('checkbox', { name: /somewhere else, or not sure/i }));
    await user.click(inGroup(/does it replace something/i, /^no$/i));
    const button = screen.getByRole('button', { name: /continue/i });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-describedby');
    expect(document.getElementById('pf-missing')).toBeNull();
  });

  it('TC-CR6-07d: the still-to-answer line reads plainly — no doubled stops, a noun on the count, one final stop', () => {
    render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    const text = document.getElementById('pf-missing')!.textContent!;
    expect(text).not.toMatch(/[.?!];/); // "…it?; In a sentence…"
    expect(text).not.toMatch(/\.\./);
    expect(text).toMatch(/and \d+ more questions?\.$/);
  });

  // Found in the live walkthrough: each item quoted the question's WHOLE
  // text, help sentences included ("What kind of AI is it? If more than one
  // fits — for example, …"). The line names each question by its first
  // sentence only.
  it('TC-CR6-07f: the still-to-answer line names each question by its first sentence, never its help text', () => {
    render(
      <StructuredForm
        policy={policy()}
        initialDescription="A chatbot that helps interns book meeting rooms."
        initialAnswers={{ '1': 'Room finder', '2': 'A chatbot that helps interns book meeting rooms.', '3': 'firm-built' }}
        onSubmit={vi.fn()}
      />,
    );
    const text = document.getElementById('pf-missing')!.textContent!;
    expect(text).toMatch(/What kind of AI is it;/);
    expect(text).not.toMatch(/If more than one fits/);
  });

  it('TC-CR6-07e: a required single-select is announced as required once — the fieldset is the radiogroup, its name does not repeat "required"', () => {
    const { container } = render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    const groups = screen.getAllByRole('radiogroup');
    for (const g of groups) {
      expect(g.tagName).toBe('FIELDSET');
      expect(g).toHaveAttribute('aria-required', 'true');
      expect(g.querySelector('[role="radiogroup"]')).toBeNull();
      expect(g).not.toHaveAccessibleName(/required/i);
      // Named by its legend: the accessible name is exactly the legend text.
      const legend = g.querySelector('legend');
      expect(legend).not.toBeNull();
      // The visual "*" mark is aria-hidden, so it is not part of the name.
      const clone = legend!.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      const legendText = clone.textContent!.trim();
      expect(legendText).not.toBe('');
      expect(g).toHaveAccessibleName(legendText);
    }
    expect(container.querySelectorAll('div[role="radiogroup"]')).toHaveLength(0);
  });
});
