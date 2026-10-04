import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PolicyEditor from '../PolicyEditor';

// Minimal valid policy YAML per policy-schema.md §3.1/§6 — every required
// section present and non-empty so loadPolicy() returns { valid: true }.
const MINIMAL_VALID_POLICY_YAML = `
version: "1.0"
policy_id: "RAF-001"
firm_name: "Test Bank"

translation_attestation:
  attested_by: "Test Bank — 2LoD Lead"
  role: "Head of AI Governance"
  date: "2026-05-01"
  raf_version_checked: "Board-approved AI RAF v1.0"

hard_lines: []

tracks:
  - id: "TRACK-I"
    name: "Track I"
    description: "Traditional MRM"
    conditions:
      - field: "model_type"
        value: { in: ["statistical"] }
    short_circuit: true
    regulatory_basis: "SS1/23 §3.4"

tiers:
  - id: "TIER-LOW"
    name: "Low"
    triggers:
      - field: "exposure"
        value: "internal-only"

invariants: []

controls:
  - id: "CTRL-ENC-01"
    name: "Encryption in transit"
    description: "TLS 1.3+"
    resolves: []
    burden: 1
    verification: "manual check"

  # CR7-27: the shipped EU pack's required_control ids must exist in the policy.
  - id: "CTRL-DISCLOSE-01"
    name: "d"
    description: "d"
    resolves: []
    burden: 1
    verification: "v"
  - id: "CTRL-SYNTHMARK-01"
    name: "s"
    description: "s"
    resolves: []
    burden: 1
    verification: "v"
kri_thresholds: {}

jurisdictions: []

roles:
  "1LoD": { access: "own" }
  "2LoD": { access: "all" }

tier_workflow:
  Critical: "2LoD-approve"
  High: "2LoD-approve"
  Medium: "2LoD-notify"
  Low: "self-service"

safety_margin: 0.10
`;

// design-review round 4 (Panel C/D): the YAML editor's closed-by-default
// disclosure now uses the shared Fold component (native <details>/
// <summary>) instead of a hand-rolled button+aria-expanded toggle — open
// it by clicking the summary text before touching the textarea.
async function openYamlEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText(/edit the rulebook as yaml/i));
}

// TC-R15-C4-03: pre-existing coverage in this describe block (pre-fill,
// validate, save success/failure) is unchanged in behaviour by the R15-C4
// disclosure change below — only renegotiated to open the YAML-editor
// disclosure before querying the textarea (see openYamlEditor() above).
describe('PolicyEditor', () => {
  it('TC-R15-C4-01: the YAML editor disclosure is closed by default and the textarea is not visible', () => {
    render(<PolicyEditor />);
    const details = screen.getByText(/edit the rulebook as yaml/i).closest('details');
    expect(details).not.toHaveAttribute('open');
    // design-review round 4: migrated to the shared Fold component (native
    // <details>), which — unlike the old hand-rolled conditional render —
    // keeps closed content in the DOM, just visually hidden. Every other
    // Fold usage in the app works this way; the guarantee that matters is
    // visibility, not DOM presence.
    expect(screen.getByLabelText(/policy yaml/i)).not.toBeVisible();
  });

  it('TC-R15-C4-02: opening the disclosure reveals the textarea and the no-sign-in honesty line', async () => {
    const user = userEvent.setup();
    render(<PolicyEditor />);
    await openYamlEditor(user);
    const details = screen.getByText(/edit the rulebook as yaml/i).closest('details');
    expect(details).toHaveAttribute('open');
    expect(
      screen.getByText(/this build has no sign-in — anyone can open this\. a real deployment restricts it to the rule authors\./i),
    ).toBeInTheDocument();
  });

  it('pre-fills the textarea with the currently active policy YAML (P7-C03)', async () => {
    const user = userEvent.setup();
    render(<PolicyEditor />);
    await openYamlEditor(user);
    const textarea = screen.getByLabelText(/policy yaml/i) as HTMLTextAreaElement;
    expect(textarea.value.length).toBeGreaterThan(0);
    expect(textarea.value).toContain('policy_id');
  });

  it('validates a valid policy and shows a success message, without saving', async () => {
    const user = userEvent.setup();
    render(<PolicyEditor />);
    await openYamlEditor(user);

    const textarea = screen.getByLabelText(/policy yaml/i);
    await user.clear(textarea);
    await user.paste(MINIMAL_VALID_POLICY_YAML);

    await user.click(screen.getByRole('button', { name: /validate/i }));

    expect(await screen.findByText(/is valid/i)).toBeInTheDocument();
  });

  it('BC-P7C03-02: invalid YAML shows field errors and does not save or call onSaved', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<PolicyEditor onSaved={onSaved} />);
    await openYamlEditor(user);

    const textarea = screen.getByLabelText(/policy yaml/i);
    await user.clear(textarea);
    await user.paste('not: valid: policy: yaml: at all');

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/policy is invalid/i)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('BC-P7C03-01: saving a valid policy reports a queued count and calls onSaved', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<PolicyEditor onSaved={onSaved} />);
    await openYamlEditor(user);

    const textarea = screen.getByLabelText(/policy yaml/i);
    await user.clear(textarea);
    await user.paste(MINIMAL_VALID_POLICY_YAML);

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/policy saved.*queued for re-evaluation/i)).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});

// TC-R15-C4-03: pre-existing coverage in this describe block (ACTION
// REQUIRED banner, jurisdiction pack list, hard lines, invalid-YAML panel
// suppression) is unchanged in behaviour by the R15-C4 disclosure change —
// renegotiated only where a test touches the textarea (D4, invalid-YAML),
// via openYamlEditor().
describe('PolicyEditor — appetite framework view (V1.2-C)', () => {
  beforeEach(() => {
    // Earlier tests in this file SAVE a minimal policy into localStorage;
    // these tests need the bundled starter YAML (with [FIRM] markers and
    // the full pack list) as the active policy.
    localStorage.clear();
  });

  it('D4: shows the NF-10 ACTION REQUIRED banner while [FIRM] markers are present, and hides it once replaced', async () => {
    const user = userEvent.setup();
    render(<PolicyEditor />);
    // The bundled starter policy carries [FIRM] markers.
    expect(screen.getByText(/action required/i)).toBeInTheDocument();
    expect(screen.getByText(/verdicts are provisional until your CRO adopts/i)).toBeInTheDocument();

    await openYamlEditor(user);
    const textarea = screen.getByLabelText(/policy yaml/i);
    await user.clear(textarea);
    await user.paste(MINIMAL_VALID_POLICY_YAML); // no [FIRM] markers
    expect(screen.queryByText(/action required/i)).not.toBeInTheDocument();
  });

  it('review finding, pass 1: [FIRM] mentions in comment lines alone do NOT trigger the NF-10 banner (an adopted framework keeping the template header is not provisional)', async () => {
    const user = userEvent.setup();
    render(<PolicyEditor />);
    await openYamlEditor(user);
    const textarea = screen.getByLabelText(/policy yaml/i);
    await user.clear(textarea);
    // Valid policy, real markers filled in, but the instructional comment
    // still mentions [FIRM] — exactly the post-adoption state.
    await user.paste(`# Search for [FIRM] markers below — each one requires review.\n${MINIMAL_VALID_POLICY_YAML}`);
    expect(screen.queryByText(/action required/i)).not.toBeInTheDocument();
  });

  it('D2 (V2-A): lists the jurisdiction packs with the REAL loader state — loaded rule counts, honestly marked not signed off, never "fired"', () => {
    render(<PolicyEditor />);
    expect(screen.getByText('Jurisdiction packs', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByText('UK')).toBeInTheDocument();
    expect(screen.getByText('EU')).toBeInTheDocument();
    // User report (2026-08-17): the prior copy packed jargon (loaded/
    // declared, pack ids, version suffixes) into one unglossed chip per
    // row. Now a plain-English sentence carries the state; the real
    // pack id/version detail survives as a secondary, quieter line —
    // still real data, not hidden, just no longer the primary sentence.
    // CR7-38: the wording is now computed per rule (none / N of M / all) —
    // every bundled pack is still unsigned, so this screen reads "none signed off".
    const plainLines = screen.getAllByText(/\d+ rules? applying — none signed off/);
    expect(plainLines.length).toBeGreaterThanOrEqual(3);
    // Review fix, pass 1: EU declares TWO packs — both must be visible in
    // the secondary detail line.
    expect(
      // DORA's pack went to v0.3-draft in R16-A2 (plain names on its review; presentation only).
      screen.getByText(/EU-AIACT v0\.2-draft \+ DORA v0\.3-draft|DORA v0\.3-draft \+ EU-AIACT v0\.2-draft/),
    ).toBeInTheDocument();
    // "fired" remains a per-verdict concept (the RA-9 chain), never a
    // static pack state.
    expect(screen.queryByText(/fired/i)).not.toBeInTheDocument();
  });

  it('D3: lists the hard lines with the checked-first framing', () => {
    render(<PolicyEditor />);
    expect(screen.getByText(/hard lines — no control set can fix/i)).toBeInTheDocument();
    // design-review round 4 (Panel A, NF-11): the bare "(PE-4)" citation was
    // dropped — the sentence already says the same thing in plain words.
    // TC-CR6-29: this pinned "rejected immediately" — a reserved word on a
    // rendered screen. The panel now says "ruled out straight away".
    // Scoped to the framing element, not page-wide: the YAML editor textarea
    // on this screen shows policy comments that contain the word "rejected";
    // this assertion covers rendered UI text only.
    const framing = screen.getByText(/ruled out straight away/i);
    expect(framing.textContent).not.toMatch(/approved|rejected/i);
    expect(screen.getByText('HL-001')).toBeInTheDocument();
    expect(screen.getByText('HL-006')).toBeInTheDocument();
  });

  it('invalid YAML shows the panels-unavailable note instead of stale panels', async () => {
    const user = userEvent.setup();
    render(<PolicyEditor />);
    await openYamlEditor(user);
    const textarea = screen.getByLabelText(/policy yaml/i);
    await user.clear(textarea);
    await user.paste('definitely: not: valid: yaml');
    expect(screen.getByText(/panels unavailable — YAML invalid/i)).toBeInTheDocument();
    expect(screen.queryByText(/jurisdiction packs/i)).not.toBeInTheDocument();
  });
});
