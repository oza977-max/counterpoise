import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { seedCase, DESCRIPTION } from '../../test-support/answer-sources-fixtures';
import { getAllForExport } from '../../store/audit';
import { R18_COPY, olderDroppedSentence, findQuestion, makeAssumption } from '../plain-copy';
import { SLOW_FLOW_MS } from './fillText';
import { answerTheRest, NOT_SURE_4_AND_9, openOlderCase, RETIRED_TITLE } from './olderCaseFlow';
import { confirmAndReachVerdict, ofType, tickAll, trailOf } from './r18d2Flow';
import { describeToForm } from './r18aFlow';

// R18-E (specs/intake-flow.md §27.10, "An older case"): correcting a case saved before Round 18 through the form.
// Each new sentence is tested in the state where it is true AND in the state where it would be false (BC-005,
// TC-R18-GI-13-01). No test here calls a model.

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const MARK_RECORD = new RegExp(`^${R18_COPY.MARK_RECORD}$`, 'i');
const MARK_NOT_CARRIED = new RegExp(`^${R18_COPY.MARK_NOT_CARRIED}$`, 'i');
const own = (tag: string) => `${DESCRIPTION} [${tag}]`;

describe('an older case opens on the form (TC-R18-GI-10-04)', () => {
  it('TC-R18-GI-10-04: the description is kept, each recorded Not sure comes back marked and unticked, every other answer is blank and marked, and there is no card review', async () => {
    const D = own('open');
    await seedCase('uc-r18e-open', { label: 'Older open E', description: D, assumptions: NOT_SURE_4_AND_9() });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await openOlderCase(user, 'Older open E');
    expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue(D);
    // the two Not sure answers and the case name (restored from the register, review pass 1): three ticks owed
    expect(screen.getAllByText(MARK_RECORD)).toHaveLength(3);
    expect(screen.getAllByRole('checkbox', { name: /^i've checked this answer/i })).toHaveLength(3);
    expect(screen.getByRole('textbox', { name: /what do you want to call it/i })).toHaveValue('Older open E');
    // blank: no radio is chosen except the two restored, no checkbox other than the two ticks is checked
    const chosen = screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked);
    expect(chosen).toHaveLength(2);
    expect(screen.getAllByText(MARK_NOT_CARRIED).length).toBeGreaterThan(5);
    expect(screen.queryByText(RETIRED_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
  });

  it('a case that recorded no assumptions opens with every answer but its name blank and marked, and only the name to tick', async () => {
    await seedCase('uc-r18e-blank', { label: 'Older blank E', description: own('blank') });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await openOlderCase(user, 'Older blank E');
    // only the name comes from the record (it needs its tick); no Not sure answer is restored
    expect(screen.getAllByText(MARK_RECORD)).toHaveLength(1);
    expect(screen.getAllByRole('checkbox', { name: /^i've checked this answer/i })).toHaveLength(1);
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(screen.getAllByText(MARK_NOT_CARRIED).length).toBeGreaterThan(5);
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled();
  });
});

describe('a record answer needs its tick and becomes typed when changed (TC-R18-GI-10-07)', () => {
  it('TC-R18-GI-10-07: Continue stays disabled until the record answers are ticked and the blanks answered; an answered blank and a changed record answer read as typed (no earlier-record mark, no not-carried mark)', async () => {
    await seedCase('uc-r18e-tick', { label: 'Older tick E', description: own('tick'), assumptions: NOT_SURE_4_AND_9() });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await openOlderCase(user, 'Older tick E');
    await answerTheRest(user, 'Older tick E tool');
    // everything answered, the two record answers still unticked: blocked
    expect(screen.getAllByText(MARK_RECORD)).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled();
    expect(screen.queryByText(MARK_NOT_CARRIED)).not.toBeInTheDocument(); // every blank was answered
    // change one record answer: it is typed now, so only one mark and one tick are left
    await user.click(within(screen.getByRole('radiogroup', { name: /can the mistake be caught/i })).getByRole('radio', { name: /^yes$/i }));
    expect(screen.getAllByText(MARK_RECORD)).toHaveLength(1);
    expect(screen.getAllByRole('checkbox', { name: /^i've checked this answer/i })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled();
    // tick the last one: Continue opens
    await tickAll(user);
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeEnabled();
    expect(screen.queryByText(RETIRED_TITLE)).not.toBeInTheDocument();
  }, SLOW_FLOW_MS);
});

describe('R18-E sentences are claimed only where true (TC-R18-GI-13-01)', () => {
  it('GI-13-01: neither mark appears on a new case, and the not-carried mark is gone from an answer once it is given', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await describeToForm(user, 'It reads client names. Our UK team will use it every morning.');
    expect(screen.queryByText(MARK_RECORD)).not.toBeInTheDocument();
    expect(screen.queryByText(MARK_NOT_CARRIED)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/what do you want to call it/i), 'A new case');
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    expect(screen.queryByText(MARK_RECORD)).not.toBeInTheDocument();
    expect(screen.queryByText(MARK_NOT_CARRIED)).not.toBeInTheDocument();
  });

  it('GI-13-01: on an older case the not-carried mark is gone from each answer as it is given, and stays on the ones still blank', async () => {
    await seedCase('uc-r18e-marks', { label: 'Older marks E', description: own('marks'), assumptions: NOT_SURE_4_AND_9() });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await openOlderCase(user, 'Older marks E');
    const before = screen.getAllByText(MARK_NOT_CARRIED).length;
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    expect(screen.getAllByText(MARK_NOT_CARRIED)).toHaveLength(before - 1);
    expect(screen.getAllByText(MARK_NOT_CARRIED).length).toBeGreaterThan(0);
  });

  it('GI-13-01: the form note about Not sure answers that could not be put back appears only when one could not, and names it', async () => {
    // Question 3a is asked only after "an outside assistant"; Question 3 is not carried, so 3a is not shown.
    const dropped = describeAssumptionsFor(['3a', '4']);
    await seedCase('uc-r18e-drop', { label: 'Older drop E', description: own('drop'), assumptions: dropped });
    await seedCase('uc-r18e-nodrop', { label: 'Older nodrop E', description: own('nodrop'), assumptions: NOT_SURE_4_AND_9() });
    const user = userEvent.setup({ delay: null });
    const first = render(<App />);
    await openOlderCase(user, 'Older nodrop E');
    expect(screen.queryByText(new RegExp(R18_COPY.OLDER_DROPPED_PREFIX.slice(0, 30)))).not.toBeInTheDocument();
    first.unmount();
    sessionStorage.clear();
    render(<App />);
    await openOlderCase(user, 'Older drop E');
    expect(screen.getByText(olderDroppedSentence([findQuestion('3a')!.text]))).toBeInTheDocument();
  });
});

// Assumptions as an earlier build recorded them, for the given questions.
function describeAssumptionsFor(ids: ('3a' | '4')[]) {
  return ids.map((id) => makeAssumption(id, 'not-sure', ['f'])!).filter(Boolean);
}

describe('an older case is corrected without inventing an original (TC-R18-GI-10-04 write side)', () => {
  it('writes one verdict_corrected carrying answer_sources, no graph_corrected, and no corrections_count; the register does not say "no answers changed"', async () => {
    const D = own('write');
    await seedCase('uc-r18e-write', { label: 'Older write E', description: D, assumptions: NOT_SURE_4_AND_9() });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await openOlderCase(user, 'Older write E');
    await answerTheRest(user, 'Older write E tool');
    await tickAll(user);
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await confirmAndReachVerdict(user);
    const trail = await trailOf(D);
    expect(ofType(trail, 'verdict_corrected')).toHaveLength(1);
    expect(ofType(trail, 'graph_corrected')).toHaveLength(0);
    expect(ofType(trail, 'graph_confirmed')).toHaveLength(1);
    const payload = ofType(trail, 'verdict_corrected')[0]!.payload as { corrections_count?: number; answer_sources?: unknown };
    expect(payload.answer_sources).toBeDefined();
    expect('corrections_count' in payload).toBe(false);
    expect((await getAllForExport()).filter((e) => e.use_case_id === 'uc-r18e-write' && e.payload.type === 'use_case_created')).toHaveLength(1);
    // the register's account of the correction
    await user.click(screen.getByText('▤ Register'));
    await user.click(await screen.findByText('Older write E'));
    await screen.findByRole('region', { name: /where each answer came from/i });
    expect(document.body.textContent).not.toMatch(/no answers changed/i);
  }, SLOW_FLOW_MS * 2);
});

describe('an older multi-node case still opens and its verdict renders (TC-R18-GI-10-03)', () => {
  it('TC-R18-GI-10-03: a case saved by the model route (intake method llm, an arrow path through several nodes) opens on the register with its verdict, and no error', async () => {
    await seedCase('uc-r18e-multi', { label: 'Older multi-node E', intakeMethod: 'llm', description: own('multi') });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await user.click(screen.getByText('▤ Register'));
    await user.click(await screen.findByText('Older multi-node E'));
    await screen.findByRole('heading', { name: 'Older multi-node E' });
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
    expect(document.body.textContent).toMatch(/client notes → drafting model → drafted email/);
    expect(screen.queryByText(RETIRED_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
