import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { setCurrentPolicyYaml } from '../../store/policy-source';
import { seedFormRoute, workedAnswers } from './formRoute';

// R16-A1 (§1.4, CF-5). IntakeFlow's first evaluation gate (graph_review's
// "Proceed", handleProceedFromGraphReview) must refuse evaluation the same
// way App's start-up gate does, when checkPolicyReferences finds a
// reference error — through the existing reviewGateError message slot,
// not a thrown exception (unlike a structurally-invalid policy file).
//
// R18-A: the pre-check has one route, so the first evaluation gate is the guided
// form's "Continue" (handleFormSubmitted). Reached with a seeded form draft (a
// version-4 intake draft plus the form's own answers, from the scripted worked
// example 1) rather than clicking every question, since the gate under test does
// not depend on how the graph was built — only on what the policy says.
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: vi.fn() };
    },
  };
});

const MINIMAL_VALID_YAML_WITH_BAD_COVERS_REVIEWS = `
version: "1.0"
policy_id: "RAF-001"
firm_name: "Test Bank"
translation_attestation:
  attested_by: "x"
  role: "x"
  date: "2026-01-01"
  raf_version_checked: "x"
hard_lines: []
tracks:
  - id: "TRACK-I"
    name: "Track I"
    description: "d"
    conditions: []
    short_circuit: true
    regulatory_basis: "x"
tiers:
  - id: "TIER-LOW"
    name: "Low"
    triggers: []
invariants: []
controls:
  - id: "CTRL-TPRM-01"
    name: "n"
    description: "d"
    resolves: []
    burden: 1
    verification: "v"
    covers_reviews: ["DR-VENDR-01"]
kri_thresholds: {}
jurisdictions: []
roles: {}
tier_workflow:
  Critical: "x"
  High: "x"
  Medium: "x"
  Low: "x"
safety_margin: 0.1
`;

describe('IntakeFlow — first evaluation gate refuses on a policy reference error (R16-A1 §1.4)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("TC-R16-A1-63: clicking Continue on the form with a covers_reviews reference error shows the message and does not proceed to the confirmation step", async () => {
    setCurrentPolicyYaml(MINIMAL_VALID_YAML_WITH_BAD_COVERS_REVIEWS);
    seedFormRoute('A tool that summarises internal notes', workedAnswers(1));
    render(<App />);

    const user = userEvent.setup({ delay: null });
    const proceed = await screen.findByRole('button', { name: /^continue$/i });
    await user.click(proceed);

    // Two banners legitimately match "Policy file invalid" here: App's own
    // start-up gate (always on screen) AND IntakeFlow's reviewGateError
    // slot this test targets — the specific message below disambiguates.
    console.log('DBG', (screen.getByRole('button',{name:/^continue$/i}) as HTMLButtonElement).disabled + ' ' + [...document.querySelectorAll('input[type=checkbox]')].map(e=>(e as HTMLInputElement).value+(e as HTMLInputElement).checked).join(','));
    expect(await screen.findAllByText(/Policy file invalid/i)).not.toHaveLength(0);
    // IntakeFlow renders reviewGateError at more than one place in the
    // form screen (e.g. inline + a summary slot) — any match
    // confirms the specific message reached the user.
    // CR8-13 (code review 008): a submitter (the default 1LoD view) sees the
    // plain policy sentence, never the raw field path — that detail is for
    // 2LoD and the Appetite framework screen (TC-R16-A1-62 / TC-CR8-13).
    expect(screen.getAllByText(/rules file has a problem/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/CTRL-TPRM-01 covers_reviews: no review with id 'DR-VENDR-01'/)).not.toBeInTheDocument();
    // Still on the form — the Continue button is still there, the
    // confirmation screen never mounted.
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeInTheDocument();
  });
});
