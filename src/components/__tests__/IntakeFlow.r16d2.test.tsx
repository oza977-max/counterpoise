import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { getUseCases } from '../../store/register';
import { getAll } from '../../store/audit';
import type { GraphCorrection } from '../../engine/types';
import { fillText, DUP_CHECK_WAIT, SLOW_FLOW_MS, pressNext } from './fillText';

// R16-D2 §5 (D-82, DR7-17/DR7-22). Integration-level coverage for
// correcting a form-built verdict THROUGH THE FORM: the correction stays
// a correction across the form resubmission, formCorrections() writes are
// wired into the real audit trail, a zero-change resubmission is honestly
// recorded as such, and a double-click still writes once. Unit-level
// coverage for the pieces lives in form-corrections.test.ts (the pure
// diff), intake-state.test.ts (CORRECT_VERDICT_WITH_FORM and the
// originalGraph/originalVerdictId threading through CHANGE_ANSWER,
// EVALUATION_FAILED and the questionnaire's STEP_BACK), and
// verdict-view-model.test.ts / VerdictDisplay.r16d2.test.tsx (the "No"
// screen's own text).
//
// No API key is configured, so every test here drives the form path —
// no Anthropic SDK mock needed (unlike the description-path suites).

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

async function fillMinimalForm(user: ReturnType<typeof userEvent.setup>, name: string, description: string) {
  await user.clear(screen.getByLabelText(/what do you want to call it/i));
  await fillText(user, screen.getByLabelText(/what do you want to call it/i), name);
  await user.clear(screen.getByLabelText(/in a sentence or two/i));
  await fillText(user, screen.getByLabelText(/in a sentence or two/i), description);
  await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
  await user.click(
    screen.getByRole('radio', { name: /reads, summarises, translates, writes or answers questions in words/i }),
  );
  await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
  await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
  await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
  await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
  await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
  await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
  await user.click(screen.getByRole('checkbox', { name: /somewhere else, or not sure/i }));
  await user.click(screen.getByRole('radio', { name: /^no$/i }));
}

async function reachFormScreen(user: ReturnType<typeof userEvent.setup>, description: string) {
  render(<App />);
  await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), description);
  await pressNext(user);
  await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
  await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
}

// Defensive against a budget-driven question the real policy might
// generate for a particular answer combination (generateQuestions is tier/
// budget-driven, not only "uncertain fields" — the form path is not
// guaranteed zero questions for every possible answer set, only for the
// one fillMinimalForm happens to produce). Answers whatever appears until
// "Confirm and evaluate" shows up.
async function clickThroughToConfirm(user: ReturnType<typeof userEvent.setup>) {
  for (let i = 0; i < 20; i++) {
    if (screen.queryByRole('button', { name: /confirm and evaluate/i })) return;
    const option = document.querySelector<HTMLButtonElement>('.questionnaire__options button');
    if (option) {
      await user.click(option);
      continue;
    }
    const explain = screen.queryByRole('textbox', { name: /explain|resolution/i });
    const resolveButton = screen.queryByRole('button', { name: /resolve|continue/i });
    if (explain && resolveButton) {
      await fillText(user, explain, 'Explained for the test.');
      await user.click(resolveButton);
      continue;
    }
    break;
  }
  await screen.findByRole('button', { name: /confirm and evaluate/i });
}

// The wait for the result gets 5s, not the 1s default (the precedent is
// GraphReview.r6's verdict wait). Confirm runs the case lock, several
// hash-chained appends and the register writes; alone that is well under a
// second, but on a machine running the whole suite in parallel it
// occasionally ran past 1s and this test failed about 1 run in 13
// (2026-10-03, verifying R16-E) — the assertions themselves never changed.
async function confirmAndReachVerdict(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^continue$/i }));
  await screen.findByText(/here.s what we understood/i);
  await clickThroughToConfirm(user);
  await user.click(screen.getByRole('button', { name: /confirm and evaluate/i }));
  await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
}

describe('R16-D2 §5: correcting a form-built verdict through the form (D-82, DR7-17/DR7-22)', () => {
  // FX7-6: each test here is two complete form-to-verdict flows (the original
  // and its correction) — the point of the file — so each gets SLOW_FLOW_MS (15 s) instead
  // of the 5 s default; a loaded machine ran them past 5 s even after the
  // cheaper fill. The same reason applies to the next three tests.
  it('TC-R16-D2-48: "Correct" re-opens the FORM filled in, with the correction note, writes form-sourced graph_corrected events against the original case, then verdict_corrected — never a second use_case_created', async () => {
    const user = userEvent.setup({ delay: null });
    const label = 'Zephyrquill correction probe one';
    await reachFormScreen(user, label);
    await fillMinimalForm(user, label, 'Sorts internal documents for the correction test.');
    await confirmAndReachVerdict(user);

    const useCases = await getUseCases('all');
    const useCase = useCases.find((u) => u.label === label);
    expect(useCase).toBeDefined();
    const beforeEvents = await getAll(useCase!.use_case_id);
    expect(beforeEvents.map((e) => e.event_type)).toEqual(['use_case_created', 'graph_confirmed', 'verdict_produced']);
    // R16-D2 §4 (D-81): fillMinimalForm never answers "Not sure" to
    // anything, so `assumptions` is written ONLY when non-empty — it must
    // be absent here entirely, not present as an empty array.
    expect('assumptions' in beforeEvents.find((e) => e.event_type === 'graph_confirmed')!.payload).toBe(false);

    // "Correct" — the first screen's own control, whatever its current
    // wording (approved or rejected get different text; the class name
    // is the stable seam).
    await user.click(document.querySelector<HTMLButtonElement>('.verdict__first-correct')!);

    // Re-opens the FORM, not graph_review — filled in, with the
    // correction-mode note.
    expect(await screen.findByText(/you.re correcting your earlier answers/i)).toBeInTheDocument();
    const nameInput = screen.getByLabelText(/what do you want to call it/i) as HTMLInputElement;
    expect(nameInput.value).toBe(label);
    // The form path never shows a Back control (canStepBack excludes
    // graph_extraction unconditionally) — correction mode is no exception.
    expect(screen.queryByRole('button', { name: /^← back$/i })).not.toBeInTheDocument();

    // Change the name only — a clean, deterministic, tier/budget-neutral
    // correction (label is diffable; nothing else on the graph moves).
    const correctedLabel = `${label} (corrected)`;
    await user.clear(nameInput);
    await fillText(user, nameInput, correctedLabel);
    await confirmAndReachVerdict(user);

    const afterEvents = await getAll(useCase!.use_case_id);
    expect(afterEvents.map((e) => e.event_type)).toEqual([
      'use_case_created',
      'graph_confirmed',
      'verdict_produced',
      'graph_corrected',
      'graph_corrected',
      'verdict_corrected',
    ]);
    const corrections = afterEvents
      .filter((e) => e.payload.type === 'graph_corrected')
      .map((e) => (e.payload as { type: 'graph_corrected'; correction: GraphCorrection }).correction);
    expect(corrections).toHaveLength(2);
    expect(corrections.every((c) => c.field === 'label')).toBe(true);
    expect(corrections.every((c) => c.correction_source === 'form')).toBe(true);
    // The processing node's label IS the use case name; the output node's
    // is "{name} — output" (build-graph-from-form.ts) — both still carry
    // the corrected name.
    expect(corrections.every((c) => String(c.corrected_value).startsWith(correctedLabel))).toBe(true);
    expect(corrections.every((c) => String(c.original_value).startsWith(label))).toBe(true);
    // Against the ORIGINAL node ids — two DISTINCT ids (processing, output).
    expect(new Set(corrections.map((c) => c.node_id)).size).toBe(2);
    // Added verifying R16-D2: the rebuilt graph is numbered one above the
    // original, so the record reads v1 → v2, never v1 → v1.
    expect(corrections.every((c) => c.graph_version_after === c.graph_version_before + 1)).toBe(true);

    const verdictCorrected = afterEvents.find((e) => e.payload.type === 'verdict_corrected');
    expect(verdictCorrected).toBeDefined();
    if (verdictCorrected!.payload.type === 'verdict_corrected') {
      expect(verdictCorrected!.payload.original_verdict_id).toBe(
        (beforeEvents.find((e) => e.payload.type === 'verdict_produced')!.payload as { type: 'verdict_produced'; verdict: { id: string } }).verdict.id,
      );
      expect(verdictCorrected!.payload.corrections_count).toBe(2);
      expect(verdictCorrected!.payload.new_verdict.graph_version).toBe(corrections[0]!.graph_version_after);
    }
  }, SLOW_FLOW_MS);

  it('TC-R16-D2-49 (F2C-6): resubmitting the form with NOTHING changed writes verdict_corrected with zero graph_corrected events', async () => {
    const user = userEvent.setup({ delay: null });
    const label = 'Zephyrquill correction probe two';
    await reachFormScreen(user, label);
    await fillMinimalForm(user, label, 'Zero-change resubmission test.');
    await confirmAndReachVerdict(user);

    const useCase = (await getUseCases('all')).find((u) => u.label === label)!;

    await user.click(document.querySelector<HTMLButtonElement>('.verdict__first-correct')!);
    await screen.findByText(/you.re correcting your earlier answers/i);
    // No change at all — straight back through.
    await confirmAndReachVerdict(user);

    const events = await getAll(useCase.use_case_id);
    expect(events.filter((e) => e.event_type === 'graph_corrected')).toHaveLength(0);
    const verdictCorrected = events.find((e) => e.payload.type === 'verdict_corrected');
    expect(verdictCorrected).toBeDefined();
    if (verdictCorrected!.payload.type === 'verdict_corrected') {
      expect(verdictCorrected!.payload.corrections_count).toBe(0);
    }
  }, SLOW_FLOW_MS);

  it('TC-R16-D2-50: "Change an answer" during a form correction keeps the correction — the eventual re-confirm still writes verdict_corrected, never refused as "already has a result"', async () => {
    const user = userEvent.setup({ delay: null });
    const label = 'Zephyrquill correction probe three';
    await reachFormScreen(user, label);
    await fillMinimalForm(user, label, 'Change-an-answer-mid-correction test.');
    await confirmAndReachVerdict(user);
    const useCase = (await getUseCases('all')).find((u) => u.label === label)!;

    await user.click(document.querySelector<HTMLButtonElement>('.verdict__first-correct')!);
    await screen.findByText(/you.re correcting your earlier answers/i);
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByText(/here.s what we understood/i);
    await clickThroughToConfirm(user);

    // Back to the form via "Change an answer" — still correcting the SAME
    // case: the note must still be there, proving originalVerdictId
    // survived the round trip.
    await user.click(screen.getByRole('button', { name: /change an answer/i }));
    expect(await screen.findByText(/you.re correcting your earlier answers/i)).toBeInTheDocument();

    await confirmAndReachVerdict(user);
    const events = await getAll(useCase.use_case_id);
    expect(events.filter((e) => e.payload.type === 'verdict_corrected')).toHaveLength(1);
    // Never refused: the F-1 alert never appears.
    expect(screen.queryByText(/already has a result/i)).not.toBeInTheDocument();
  }, SLOW_FLOW_MS);

  it('TC-R16-D2-51: a double-click on "Confirm and evaluate" during a form correction writes exactly one verdict_corrected', async () => {
    const user = userEvent.setup({ delay: null });
    const label = 'Zephyrquill correction probe four';
    await reachFormScreen(user, label);
    await fillMinimalForm(user, label, 'Double-click guard during correction test.');
    await confirmAndReachVerdict(user);
    const useCase = (await getUseCases('all')).find((u) => u.label === label)!;

    await user.click(document.querySelector<HTMLButtonElement>('.verdict__first-correct')!);
    await screen.findByText(/you.re correcting your earlier answers/i);
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByText(/here.s what we understood/i);
    await clickThroughToConfirm(user);

    const confirmButton = screen.getByRole('button', { name: /confirm and evaluate/i });
    // Two synchronous clicks, no await between them — the explore-001
    // D-001 race this guard exists for.
    await Promise.all([user.click(confirmButton), user.click(confirmButton)]);
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });

    const events = await getAll(useCase.use_case_id);
    expect(events.filter((e) => e.payload.type === 'verdict_corrected')).toHaveLength(1);
  }, SLOW_FLOW_MS);
});
