import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VerdictDisplay from '../VerdictDisplay';
import type { Verdict } from '../../types/verdict';
import type { PolicyFile } from '../../engine/types';

// R16 chunk D1 (build/prompts/R16.md v2.1 §4.2, VD-9/VD-10). The first
// screen itself — see src/components/verdict-view-model.test.ts for the
// exhaustive per-branch coverage of what it renders; this file covers the
// component wiring the view-model cannot: the reviewer section's open/
// closed default, "Go to this safeguard" opening it and expanding the
// right control, and the house-wide no-bare-code / reserved-word guards
// applied specifically to the first screen.

const NO_RESERVED_WORDS = /\b(approved|rejected)\b/i;

function makeVerdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    status: 'approved_with_controls',
    tier: 'High',
    track: 'II',
    binding_constraint: 'INV-DATA-01',
    binding_path: 'client notes → drafting model → drafted email',
    controls: [],
    downstream_reviews: [],
    conditions: { hypotheses: [] },
    policy_version: '1.0',
    pack_versions: {},
    applied_overrides: [],
    confidence_caveats: [],
    provisional_reasons: [],
    boundary_proximity: false,
    margin_achieved: 0,
    margin_target: 0.1,
    single_covered_invariants: [],
    explanation: {
      tier_rationale: null,
      track_rationale: null,
      hard_lines_checked: 5,
      invariants_checked: 20,
      tripped_invariants: [],
      binding_reason: null,
      binding_regulatory_basis: null,
    },
    id: 'verdict-1',
    use_case_id: 'uc-1',
    living_status: 'approved',
    living_status_updated_at: '2026-01-01T00:00:00.000Z',
    attested_by: '1LoD',
    attested_at: '2026-01-01T00:00:00.000Z',
    graph_version: 1,
    corrections: [],
    ...overrides,
  } as Verdict;
}

function makePolicy(controls: Array<Record<string, unknown>>): PolicyFile {
  return { controls, hard_lines: [], invariants: [], downstream_reviews: [] } as unknown as PolicyFile;
}

describe('VerdictDisplay — R16-D1 first screen: headline and word guards', () => {
  it('TC-R16-D1-13: the headline, not the formal status chip, leads the screen — no bare code or reserved word on the first screen', () => {
    // CR8-02 (deliberate change): "you can start" needs a DETERMINED self-service case — a policy whose
    // tier_workflow is self-service plus an explicit stage.
    const selfService = { ...makePolicy([]), tier_workflow: { Critical: 'self-service', High: 'self-service', Medium: 'self-service', Low: 'self-service' } } as unknown as PolicyFile;
    render(<VerdictDisplay verdict={makeVerdict({ controls: [] })} auditEvents={[]} policy={selfService} registerStage="approved" onCorrect={vi.fn()} />);
    const firstScreen = document.querySelector<HTMLElement>('.verdict__first-screen')!;
    expect(within(firstScreen).getByText('Yes — you can start.')).toBeInTheDocument();
    // The formal status/tier/track chip is NOT inside the first screen.
    expect(within(firstScreen).queryByText(/approved with controls/i)).not.toBeInTheDocument();
    expect(firstScreen.textContent).not.toMatch(NO_RESERVED_WORDS);
    // Exactly one match on the whole page (the formal label, inside the
    // reviewer section) — the long-standing suite-wide guard (BC-V12B-03).
    expect(screen.getByText(/approved|rejected/i)).toBeInTheDocument();
  });

  it('TC-R16-D1-14: an unresolved control id never reaches the first screen as a bare code', () => {
    render(
      <VerdictDisplay
        verdict={makeVerdict({ controls: ['CTRL-SOME-UNRESOLVED-ID'] })}
        auditEvents={[]}
        onCorrect={vi.fn()}
      />,
    );
    const firstScreen = document.querySelector<HTMLElement>('.verdict__first-screen')!;
    expect(firstScreen.textContent).toContain('Safeguard 1');
    expect(firstScreen.textContent).not.toContain('CTRL-SOME-UNRESOLVED-ID');
  });
});

describe('VerdictDisplay — R16-W W-6: one "also completes" note per safeguard, in grammatical English (D-76)', () => {
  it('TC-R16-W-49: a safeguard covering two reviews renders ONE note, not two — and it is grammatical even when a covered review’s name used to be a clause', () => {
    const policy = {
      controls: [
        {
          id: 'CTRL-TPRM-01',
          name: 'Vendor assessment',
          description: 'd',
          resolves: [],
          burden: 1,
          verification: 'v',
          covers_reviews: ['DR-VENDOR-01', 'PV-UNREGISTERED'],
        },
      ],
      hard_lines: [],
      invariants: [],
      downstream_reviews: [
        { id: 'DR-VENDOR-01', review: 'Vendor risk assessment', condition: {}, plain_name: 'a supplier assessment', plain_owner: 'your vendor-risk team' },
      ],
    } as unknown as PolicyFile;
    const verdict = makeVerdict({
      controls: ['CTRL-TPRM-01'],
      downstream_reviews: ['Vendor risk assessment', 'Unapproved component: Zapier'],
      downstream_review_sources: [
        { review: 'Vendor risk assessment', rule_id: 'DR-VENDOR-01' },
        { review: 'Unapproved component: Zapier', rule_id: 'PV-UNREGISTERED:Zapier' },
      ],
    });
    render(<VerdictDisplay verdict={verdict} auditEvents={[]} policy={policy} registerStage="pre_checked" onCorrect={vi.fn()} />);
    const firstScreen = document.querySelector<HTMLElement>('.verdict__first-screen')!;
    const notes = within(firstScreen).getAllByText(/Doing this also completes/i);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.textContent).toBe(
      "(Doing this also completes a supplier assessment and adding the supplier to your firm's list — one piece of work.)",
    );
    // Never the old, grammatically-broken per-review template.
    expect(firstScreen.textContent).not.toMatch(/This also covers/i);
  });
});

describe('VerdictDisplay — R16-W W-8: a real space before the "yours" chip (D-78)', () => {
  it('TC-R16-W-50: the owner text and the "yours" chip never concatenate into one run-together word', () => {
    const policy = makePolicy([
      {
        id: 'CTRL-CONDUCT-01',
        name: 'Conduct testing',
        description: 'd',
        resolves: [],
        burden: 1,
        verification: 'v',
        plain_action: 'Test conduct.',
        plain_owner: '@submitter',
        plain_owner_with: 'your compliance team',
      },
    ]);
    render(<VerdictDisplay verdict={makeVerdict({ controls: ['CTRL-CONDUCT-01'] })} auditEvents={[]} policy={policy} onCorrect={vi.fn()} />);
    const ownerLine = document.querySelector('.verdict__first-safeguard-owner')!;
    expect(ownerLine.textContent).not.toMatch(/compliance teamyours/i);
    expect(ownerLine.textContent).toContain('your compliance team');
    expect(ownerLine.textContent).toMatch(/your compliance team\s+yours/);
  });
});

describe('VerdictDisplay — R16-D1: the reviewer section defaults closed for the submitter, open for 2LoD', () => {
  it('TC-R16-D1-15: with reasoningDefaultOpen omitted (the submitter path, e.g. IntakeFlow), the reviewer section starts closed', () => {
    render(<VerdictDisplay verdict={makeVerdict()} auditEvents={[]} onCorrect={vi.fn()} />);
    const reviewer = document.getElementById('verdict-reviewer-section');
    expect(reviewer).not.toHaveAttribute('open');
    // Its content is still in the DOM (never removed, just collapsed) —
    // the formal status heading is findable regardless.
    expect(within(reviewer as HTMLElement).getByText(/approved with controls/i)).toBeInTheDocument();
  });

  it('TC-R16-D1-16: with reasoningDefaultOpen={true} (RegisterDetail\'s 2LoD path), the reviewer section starts open', () => {
    render(<VerdictDisplay verdict={makeVerdict()} auditEvents={[]} reasoningDefaultOpen />);
    const reviewer = document.getElementById('verdict-reviewer-section');
    expect(reviewer).toHaveAttribute('open');
  });

  it('TC-R16-D1-17: with reasoningDefaultOpen={false} explicitly (RegisterDetail\'s 1LoD-viewing path), the reviewer section starts closed', () => {
    render(<VerdictDisplay verdict={makeVerdict()} auditEvents={[]} reasoningDefaultOpen={false} />);
    const reviewer = document.getElementById('verdict-reviewer-section');
    expect(reviewer).not.toHaveAttribute('open');
  });
});

describe('VerdictDisplay — R16-D1: "Go to this safeguard" (D-26/D-63)', () => {
  const policy = makePolicy([
    { id: 'CTRL-X', name: 'Some control', description: 'desc', resolves: [], burden: 1, verification: 'v', plain_action: 'Do the thing.', plain_owner: '@submitter' },
  ]);

  it('TC-R16-D1-18: clicking it opens the reviewer section AND expands that control\'s own disclosure', async () => {
    const user = userEvent.setup();
    render(
      <VerdictDisplay verdict={makeVerdict({ controls: ['CTRL-X'] })} auditEvents={[]} policy={policy} onCorrect={vi.fn()} />,
    );
    const reviewer = document.getElementById('verdict-reviewer-section');
    expect(reviewer).not.toHaveAttribute('open');
    const controlDetails = document.getElementById('verdict-todo-control-CTRL-X')?.querySelector('details');
    expect(controlDetails).not.toHaveAttribute('open');

    await user.click(screen.getByRole('button', { name: /go to this safeguard/i }));

    expect(document.getElementById('verdict-reviewer-section')).toHaveAttribute('open');
    expect(document.getElementById('verdict-todo-control-CTRL-X')?.querySelector('details')).toHaveAttribute('open');
  });

  // R16-F §3 (DR7-10). scrollIntoView alone never moved focus — a keyboard
  // or screen-reader user following this link landed nowhere, only a
  // sighted mouse user following the visual scroll found the target. jsdom
  // (this project's test environment) does not implement scrollIntoView at
  // all, so this asserts
  // the part jsdom CAN prove: the target itself receives focus.
  it('TC-R16-F-47: clicking it moves focus to the safeguard\'s own container, not only scrolling to it', async () => {
    const user = userEvent.setup();
    render(
      <VerdictDisplay verdict={makeVerdict({ controls: ['CTRL-X'] })} auditEvents={[]} policy={policy} onCorrect={vi.fn()} />,
    );
    const target = document.getElementById('verdict-todo-control-CTRL-X')!;
    expect(target).toHaveAttribute('tabindex', '-1');
    expect(target).not.toHaveFocus();

    await user.click(screen.getByRole('button', { name: /go to this safeguard/i }));

    expect(target).toHaveFocus();
  });

  it('TC-R16-D1-19: the link only appears for a safeguard marked "yours"', () => {
    const notYoursPolicy = makePolicy([
      { id: 'CTRL-Y', name: 'Another control', description: 'd', resolves: [], burden: 1, verification: 'v', plain_owner: 'your IT team' },
    ]);
    render(<VerdictDisplay verdict={makeVerdict({ controls: ['CTRL-Y'] })} auditEvents={[]} policy={notYoursPolicy} onCorrect={vi.fn()} />);
    const firstScreen = document.querySelector<HTMLElement>('.verdict__first-screen')!;
    expect(within(firstScreen).queryByRole('button', { name: /go to this safeguard/i })).not.toBeInTheDocument();
  });
});

describe('VerdictDisplay — R16-D1: the correction affordance is wired on every verdict (item 8)', () => {
  it('TC-R16-D1-20: the first screen\'s own correct-your-answers button calls onCorrect', async () => {
    const onCorrect = vi.fn();
    const user = userEvent.setup();
    render(<VerdictDisplay verdict={makeVerdict()} auditEvents={[]} onCorrect={onCorrect} />);
    await user.click(screen.getByRole('button', { name: /think we got something wrong/i }));
    expect(onCorrect).toHaveBeenCalledTimes(1);
    // The existing reviewer-section correction button is unaffected and
    // still present (unchanged and additive — §4.2 item 3).
    expect(screen.getByRole('button', { name: /^correct this classification\?$/i })).toBeInTheDocument();
  });

  // R16-D2 §2 item 5 (DR7-21): on a rejected verdict this control's own
  // TEXT changes — "think we got something wrong?" presumes there might
  // be nothing wrong, which is not the question on a "No"; the control
  // still renders and still calls onCorrect either way (item 8's own
  // guarantee, unchanged).
  it('TC-R16-D1-21: on a rejected verdict, the first screen still offers it, worded for a "No"', async () => {
    const onCorrect = vi.fn();
    const user = userEvent.setup();
    render(<VerdictDisplay verdict={makeVerdict({ status: 'rejected', controls: [], binding_constraint: 'HL-002' })} auditEvents={[]} onCorrect={onCorrect} />);
    expect(
      screen.getByRole('button', { name: /if we.ve misunderstood how you.d use it, correct your answers/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /think we got something wrong/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /if we.ve misunderstood/i }));
    expect(onCorrect).toHaveBeenCalledTimes(1);
  });

  it('TC-R16-D1-22: with no onCorrect (a reviewer page), neither correction affordance renders', () => {
    render(<VerdictDisplay verdict={makeVerdict()} auditEvents={[]} />);
    expect(screen.queryByText(/think we got something wrong/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /correct this classification/i })).not.toBeInTheDocument();
  });
});

describe('VerdictDisplay — R16-D1: a rejected verdict renders a minimal first screen (the "No" screen is chunk D2)', () => {
  it('TC-R16-D1-23: headline only, plus the correct-answers affordance — no safeguards/next-steps fabricated in D2\'s place', () => {
    render(
      <VerdictDisplay
        verdict={makeVerdict({ status: 'rejected', controls: [], binding_constraint: 'HL-002' })}
        auditEvents={[]}
        onCorrect={vi.fn()}
      />,
    );
    const firstScreen = document.querySelector<HTMLElement>('.verdict__first-screen')!;
    expect(within(firstScreen).getByText('No — not as described.')).toBeInTheDocument();
    expect(firstScreen.querySelector('.verdict__first-safeguards')).not.toBeInTheDocument();
    expect(firstScreen.querySelector('.verdict__first-next-steps')).not.toBeInTheDocument();
  });
});
