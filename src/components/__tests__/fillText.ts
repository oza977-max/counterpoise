import { screen } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { R18_COPY } from '../plain-copy';

// FX7-6: put text into a field in ONE input event instead of one per
// character. Every keystroke re-renders the whole <App />, so typing a long
// description made the long intake flows slow enough to run past vitest's 5 s
// per-test limit on a loaded machine. Use this wherever the typing itself is
// not what the test is about (the field still gets a real click/focus and a
// real input event, so React sees the same onChange).
export async function fillText(
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
  text: string,
): Promise<void> {
  await user.click(field);
  await user.paste(text);
}

// FX7-6: per-test timeout for the long, multi-screen intake flows (a full
// form of ~12 clicks, several confirmations, a verdict, often a second pass).
// Each wait inside them is correct and the flow is ~1 s on an idle machine,
// but on a heavily loaded one it can pass vitest's 5 s default. The global
// testTimeout is untouched; only the flows measured above ~3 s under load
// carry this.
export const SLOW_FLOW_MS = 15000;

// FX7-6: wait budget for the "Continue →" that appears once the duplicate
// check has finished. The check reads the whole register (the 16-case
// portfolio auto-seeds on first visit), real IndexedDB work; DOM at failure
// was still "Looking through earlier checks…". The wait is on the right
// thing; the 1 s default was too short on a loaded machine (TC-CR6-02a,
// TC-CR6-02k). Same precedent as confirmAndReachVerdict (IntakeFlow.r16d2).
export const DUP_CHECK_WAIT = { timeout: 5000 };

// R18-A: the describe screen's one-press nudge. The first Next with unmentioned
// items lists them and stays on the screen; the second, with the set unchanged,
// goes on (specs/intake-flow.md §27.3). A test that is not about the nudge but
// needs to get past the description screen presses Next through it with this.
export async function pressNext(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /^next/i }));
  if (screen.queryByText(R18_COPY.UNMENTIONED_NOTE_LEAD)) {
    await user.click(screen.getByRole('button', { name: /^next/i }));
  }
}
