import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { fillText, SLOW_FLOW_MS, DUP_CHECK_WAIT } from './fillText';

// FN-006 — user-reported after the v0.1.0 tag: "after describing, if I go to
// the next step it doesn't go back, there is no back option."
//
// These drive the real UI rather than the reducer, because the reducer tests
// already pin the transitions and the defect the user hit was the absence of
// a *control*. A reducer that can step back with no button to press is still
// a forward-only flow to the person using it.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));

const DRAFT_KEY = 'aigate:intake-draft';

describe('IntakeFlow — going back (FN-006)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('offers a back control on the duplicate check that returns the typed description', async () => {
    const typed = 'A model that scores retail credit applications';
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 'duplicate_check', description: typed }));

    render(<App />);
    const back = await screen.findByRole('button', { name: /back/i });
    await userEvent.click(back);

    // Back to the description step, with what was typed still in the box.
    // Losing it here would make the control useless for the case that
    // prompted it — fixing a typo.
    const box = await screen.findByRole('textbox', { name: /what ai tool do you want to use/i });
    expect(box).toHaveValue(typed);
  });

  it('does not offer a back control on the confirmation step — that is an attestation', async () => {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'confirmation',
        description: 'A model that scores retail credit applications',
        graph: {
          id: 'g1',
          version: 1,
          input_nodes: [],
          processing_nodes: [],
          output_nodes: [],
          edges: [],
          jurisdictions: ['UK'],
          // D-1 (Minor): the graph's own field is `intake_method`, and its
          // real values are 'llm' | 'structured_form' (engine/types.ts) —
          // 'form' is not one of them. This fixture used the invalid value
          // for a long time with no test catching it (TS doesn't check an
          // inline object literal handed to JSON.stringify against
          // DataFlowGraph); fixed so this case actually exercises the
          // structured-form branch its own name claims to.
          intake_method: 'structured_form',
          extracted_at: '2026-01-01T00:00:00.000Z',
        },
        graphVersion: 1,
        corrections: [],
        answers: [],
        useCaseId: 'uc-1',
      }),
    );

    render(<App />);
    await screen.findByRole('button', { name: /confirm and evaluate/i });
    expect(screen.queryByRole('button', { name: /^back$|← back/i })).toBeNull();
  });

  // D-1 (Minor). With the fixture above corrected to a real intake_method
  // value, this case now actually exercises the form branch its name
  // claims — "Change an answer" on a structured_form graph must return to
  // the guided FORM itself (graph_extraction/method:'form'), never the
  // retired field-card review screen the LLM path uses.
  it('TC-CR6-D1: "Change an answer" on a structured_form case returns to the guided form, not the review screen', async () => {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        step: 'confirmation',
        description: 'A model that scores retail credit applications',
        graph: {
          id: 'g1',
          version: 1,
          input_nodes: [],
          processing_nodes: [],
          output_nodes: [],
          edges: [],
          jurisdictions: ['UK'],
          intake_method: 'structured_form',
          extracted_at: '2026-01-01T00:00:00.000Z',
        },
        graphVersion: 1,
        corrections: [],
        answers: [],
        useCaseId: 'uc-1',
        plainAnswers: { '1': 'Retail credit scorer' },
        assumptions: [],
      }),
    );

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /change an answer/i }));

    // The guided form reopens, filled in — never the review screen (which
    // would show "Check what we read from your description" instead).
    expect(await screen.findByLabelText(/what do you want to call it/i)).toHaveValue('Retail credit scorer');
    expect(screen.queryByText(/check what we read from your description/i)).not.toBeInTheDocument();
  });

  it('the back control is reachable by its accessible name, not only by sight', async () => {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ step: 'duplicate_check', description: 'A tool that drafts client emails' }),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: /back/i })).toBeEnabled());
  });
});

// Traceability close-out (2026-08-15) — the UC-1 boundary cases had no UI
// tests carrying their ids; the reducer accepts any non-empty string, so the
// blocking behaviour lives in the disabled button and must be asserted there.
describe('IntakeFlow — description boundaries (UC-1)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('an empty description leaves Next disabled [TC-UC-1-03]', async () => {
    render(<App />);
    const btn = await screen.findByRole('button', { name: /^next/i });
    expect(btn).toBeDisabled();
  });

  it('a five-sentence description is accepted and advances', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const box = await screen.findByRole('textbox', { name: /what ai tool do you want to use/i });
    await fillText(user, 
      box,
      'We want an assistant that reads CRM notes. It summarises client activity. It recommends an action. It runs internally. The RM approves everything.',
    );
    const btn = screen.getByRole('button', { name: /^next/i });
    expect(btn).toBeEnabled();
    await user.click(btn);
    // Advanced to the duplicate check — the description was accepted.
    // R16-W §4 (D-74): tag renamed from "DUPLICATE CHECK".
    await screen.findAllByText(/has this been checked before/i);
  });

  it('HTML in a description is literal text, never markup [TC-UC-1-04]', async () => {
    const user = userEvent.setup({ delay: null });
    const hostile = 'Ein Tool für Kundendaten — parses <img src=x onerror="alert(1)"> fields.';
    render(<App />);
    const box = await screen.findByRole('textbox', { name: /what ai tool do you want to use/i });
    await user.click(box);
    await user.paste(hostile);
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await screen.findAllByText(/has this been checked before/i);
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
    // The guided form's own description field is prefilled from what was
    // typed; whatever renders it must render TEXT. No <img> may exist.
    expect(document.querySelector('img')).toBeNull();
  });
});

// Found by walking the product as a user (2026-08-15): describe "no client
// data at all, no autonomy", then declare Client PII and L3 in the guided
// form — and reach attestation with no contradiction shown. The engine's
// detector works (contradiction.test.ts); the UI only invoked it per
// questionnaire ANSWER, and the guided form marks nothing uncertain, so zero
// questions are generated and the check was skipped with the questionnaire.
// The honesty feature was unreachable on the primary, verified path.
describe('IntakeFlow — contradictions are caught on the zero-questions path (UC-5)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('a description denying what the form declares blocks the skip to confirmation [TC-R16-W-57: a contradiction on the form path stops at contradiction_review, never passing through graph_review]', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const box = await screen.findByRole('textbox', { name: /what ai tool do you want to use/i });
    await user.click(box);
    await user.paste('This tool processes no client data at all. A human approves every action, no autonomy.');
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));

    // Declare the opposite of the description. R16-B: adapted to the new
    // questions — Client PII (contradicts "no client data") and autonomy
    // level 3 via "acts by itself within limits someone set" (contradicts
    // "no autonomy"); same two contradiction triggers contradiction.ts
    // checks (autonomy_level >= 3, data_class Client PII), same assertions.
    await fillText(user, await screen.findByLabelText(/what do you want to call it/i), 'Contradictor');
    await fillText(user, screen.getByLabelText(/in a sentence or two/i), 'x');
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    await user.click(
      screen.getByRole('radio', { name: /reads, summarises, translates, writes or answers questions in words/i }),
    );
    await user.click(screen.getByRole('checkbox', { name: /information about people/i }));
    await user.click(screen.getByRole('radio', { name: /acts by itself within limits someone set/i }));
    await user.click(screen.getByRole('radio', { name: /something else — sends, books, updates records/i }));
    await user.click(screen.getByRole('radio', { name: /^other teams in the firm$/i }));
    await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
    await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
    await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
    await user.click(screen.getByRole('checkbox', { name: /united kingdom/i }));
    await user.click(screen.getByRole('radio', { name: /^no$/i }));
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    // R16-W W-3 (D-69): the form path computes contradictions itself when
    // it finds no questions, and goes straight to contradiction_review —
    // there is no graph_review/Proceed step on this path to click through.

    // The old behaviour sailed to "Confirm and evaluate". The fix surfaces
    // the contradiction review instead — both statements, resolution required.
    // design-review round 4 (Panel G): the screen's own copy no longer uses
    // the word "contradiction" (reframed as "don't agree" — a helpful catch,
    // not an accusation); the region's aria-label still says "Contradiction
    // review" for assistive tech, which is what this now asserts against.
    expect(await screen.findByRole('region', { name: /contradiction review/i })).toBeInTheDocument();
    // Both halves of the contradiction are stated, per UC-5.
    expect(screen.getAllByText(/no personal information is involved/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /confirm and evaluate/i })).toBeNull();
  }, SLOW_FLOW_MS);
});

// The second half of the same walk (2026-08-15): resolve the contradiction
// and the flow returned to a zero-question questionnaire reading "All
// questions answered." with NO forward control — a dead end. Pre-existing on
// the normal path too: any contradiction raised on the FINAL answer landed in
// the same trap once resolved.
describe('IntakeFlow — resolving a contradiction cannot dead-end (UC-5)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('after resolution with no questions left, the flow reaches confirmation', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const box = await screen.findByRole('textbox', { name: /what ai tool do you want to use/i });
    await user.click(box);
    await user.paste('This tool processes no client data at all.');
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));

    // R16-B: the field-by-field form this test drove is replaced by the
    // situational question set (build/prompts/R16.md §2.2) — adapted to the
    // new questions, same underlying scenario (Client PII, firm-built,
    // drafts for a person to check, UK), same assertion below.
    await fillText(user, await screen.findByLabelText(/what do you want to call it/i), 'Resolver');
    await fillText(user, screen.getByLabelText(/in a sentence or two/i), 'x');
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    await user.click(
      screen.getByRole('radio', { name: /reads, summarises, translates, writes or answers questions in words/i }),
    );
    await user.click(screen.getByRole('checkbox', { name: /information about people/i }));
    await user.click(screen.getByRole('radio', { name: /creates a draft/i }));
    await user.click(screen.getByRole('radio', { name: /one input among several/i }));
    await user.click(screen.getByRole('radio', { name: /^other teams in the firm$/i }));
    await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
    // Q9 and Q12 both offer a bare "Yes"/"No" option on this continuous-
    // scroll form; Q9 ("can the mistake be caught") renders first.
    await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
    await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
    await user.click(screen.getByRole('checkbox', { name: /united kingdom/i }));
    await user.click(screen.getByRole('radio', { name: /^no$/i }));
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    // R16-W W-3 (D-69): see the earlier test's comment — no Proceed step
    // on the form path any more.

    // Contradiction review appears; resolve it.
    const explain = await screen.findByRole('textbox', { name: /explain|resolution|why/i });
    await fillText(user, explain, 'The description was wrong; the form is right.');
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    // The old behaviour stranded the user at "All questions answered." with
    // no control. The flow must reach the attestation.
    expect(await screen.findByRole('button', { name: /confirm and evaluate/i })).toBeInTheDocument();
  }, SLOW_FLOW_MS);
});
