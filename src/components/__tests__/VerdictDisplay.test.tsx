import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VerdictDisplay from '../VerdictDisplay';
import type { Verdict } from '../../types/verdict';

function makeVerdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    status: 'approved_with_controls',
    tier: 'High',
    track: 'II',
    binding_constraint: 'INV-DATA-01',
    binding_path: 'client notes → drafting model → drafted email',
    controls: ['CTRL-ENC-01'],
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
      hard_lines_checked: 0,
      invariants_checked: 0,
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
  };
}

describe('VerdictDisplay', () => {
  // TC-VD-1-01 superseded (test-cases.md's Superseded section) by R16 chunk
  // D1 (VD-9): the formal status no longer leads the screen above any fold
  // — it is still an <h2>, still present, now inside the reviewer section.
  // See VerdictDisplay.r16d1.test.tsx (TC-R16-D1-13) for the first screen's
  // own headline and the single-match reserved-word guard this still holds.
  it('the formal status is still an h2, now inside the reviewer section rather than leading the screen', () => {
    render(<VerdictDisplay verdict={makeVerdict()} auditEvents={[]} onCorrect={vi.fn()} />);
    const heading = screen.getByRole('heading', { name: /approved with controls/i });
    expect(heading).toBeInTheDocument();
    expect(heading.closest('#verdict-reviewer-section')).not.toBeNull();
  });

  it('TC-VD-2-01: binding constraint renders as <code> with the graph path shown', () => {
    render(<VerdictDisplay verdict={makeVerdict()} auditEvents={[]} onCorrect={vi.fn()} />);
    expect(screen.getByText('INV-DATA-01').tagName).toBe('CODE');
    expect(screen.getByText(/client notes → drafting model → drafted email/)).toBeInTheDocument();
  });

  it('TC-RA-11-01: a Medium confidence caveat renders inline, verdict stays non-provisional', () => {
    const verdict = makeVerdict({
      confidence_caveats: [
        { ruleId: 'PE-JUR-EU-2', field: 'jurisdiction', reason: 'Interpretive judgment required.', confidence: 'medium' },
      ],
    });
    render(<VerdictDisplay verdict={verdict} auditEvents={[]} onCorrect={vi.fn()} />);
    expect(screen.getByText(/interpretive judgment required/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /approved with controls/i })).toBeInTheDocument();
    expect(screen.queryByText(/provisional/i)).not.toBeInTheDocument();
  });

  it('TC-RA-11-02: a Low confidence caveat renders the Provisional warning without presuming WHO reviews', () => {
    const verdict = makeVerdict({
      confidence_caveats: [
        { ruleId: 'HL-003', field: 'decision_type', reason: 'Ambiguous regulatory text.', confidence: 'low' },
      ],
      provisional_reasons: ['unsigned_pack_rules'],
    });
    render(<VerdictDisplay verdict={verdict} auditEvents={[]} onCorrect={vi.fn()} />);
    // User report (2026-08-15): "why do we always say legal review required —
    // is it always legal?" It is not: packs are signed by Legal/Compliance,
    // Model Risk and Technology Risk, and an unlisted decision type is an
    // appetite question for the AI governance owner. The heading now says
    // review is outstanding without naming a function it cannot know.
    expect(screen.getByText(/provisional — review required before this is final/i)).toBeInTheDocument();
    expect(screen.queryByText(/legal review required/i)).toBeNull();
    // P8-C04: the heading carries BOTH — what was decided, and that it is
    // provisional. It used to show only the word "Provisional", which hid
    // whether the case was in or out of appetite (§13.3).
    const heading = screen.getByRole('heading', { name: /provisional/i });
    expect(heading).toBeInTheDocument();
    expect(heading.textContent).toMatch(/with controls/i);
    // The verdict body is still visible, not hidden, just clearly marked.
    expect(screen.getByText('INV-DATA-01')).toBeInTheDocument();
  });

  it('High confidence caveats are not shown (no caveat needed)', () => {
    const verdict = makeVerdict({
      confidence_caveats: [{ ruleId: 'HL-001', field: 'autonomy_level', reason: 'n/a', confidence: 'high' }],
    });
    render(<VerdictDisplay verdict={verdict} auditEvents={[]} onCorrect={vi.fn()} />);
    expect(screen.queryByText(/n\/a/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/provisional/i)).not.toBeInTheDocument();
  });

  it('clicking "Correct this classification?" calls onCorrect', async () => {
    const onCorrect = vi.fn();
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<VerdictDisplay verdict={makeVerdict()} auditEvents={[]} onCorrect={onCorrect} />);
    await user.click(screen.getByRole('button', { name: /correct this classification/i }));
    expect(onCorrect).toHaveBeenCalledTimes(1);
  });

  it('shows the exact §7 fallback message when no LLM trace and no policy-based structured summary is available', () => {
    render(<VerdictDisplay verdict={makeVerdict()} auditEvents={[]} onCorrect={vi.fn()} />);
    expect(
      screen.getByText(/narrative summary not generated — this optional plain-english retelling needs a configured model/i),
    ).toBeInTheDocument();
  });

  it('renders the LLM-generated reasoning trace from the matching audit event when present', () => {
    const verdict = makeVerdict();
    const auditEvents = [
      {
        event_id: 'e1',
        use_case_id: 'uc-1',
        event_type: 'verdict_produced' as const,
        occurred_at: '2026-01-01T00:00:00.000Z',
        actor: 'system',
        payload: { type: 'verdict_produced' as const, verdict, reasoning_trace: 'Track II per SS1/23 §3.4.' },
        prev_hash: null,
        hash: 'test-hash',
      },
    ];
    render(<VerdictDisplay verdict={verdict} auditEvents={auditEvents} onCorrect={vi.fn()} />);
    expect(screen.getByText(/track ii per ss1\/23 §3\.4/i)).toBeInTheDocument();
  });
});

describe('VerdictDisplay — why this verdict (V1.1-C01)', () => {
  it('a hard-line rejection shows the rule reason and its regulatory citation', () => {
    const verdict = makeVerdict({
      status: 'rejected',
      binding_constraint: 'HL-002',
      explanation: {
        tier_rationale: null,
        track_rationale: null,
        hard_lines_checked: 5,
        invariants_checked: 0,
        tripped_invariants: [],
        binding_reason: 'MNPI outside Zone C violates market abuse prevention requirements.',
        binding_regulatory_basis: 'MAR Article 8; MiFID II',
      },
    });
    render(<VerdictDisplay verdict={verdict} auditEvents={[]} onCorrect={vi.fn()} />);

    expect(screen.getByText(/market abuse prevention requirements/i)).toBeInTheDocument();
    expect(screen.getByText('MAR Article 8; MiFID II')).toBeInTheDocument();
    expect(screen.getByText(/ceiling values/i)).toBeInTheDocument();
    expect(screen.getByText(/evaluation stopped there/i)).toBeInTheDocument();
  });

  it('a clean Approved verdict explains tier/track assignment with citations and reports what was checked', () => {
    const verdict = makeVerdict({
      status: 'approved',
      binding_constraint: '',
      controls: [],
      explanation: {
        tier_rationale: { rule_id: 'TIER-MEDIUM', matched_field: 'exposure' },
        track_rationale: { rule_id: 'TRACK-II', rule_name: 'Track II — AI on MRM', regulatory_basis: 'SS1/23 §3.4' },
        hard_lines_checked: 5,
        invariants_checked: 2,
        tripped_invariants: [],
        binding_reason: null,
        binding_regulatory_basis: null,
      },
    });
    render(<VerdictDisplay verdict={verdict} auditEvents={[]} onCorrect={vi.fn()} />);

    expect(screen.getByText('TIER-MEDIUM')).toBeInTheDocument();
    expect(screen.getByText('exposure')).toBeInTheDocument();
    expect(screen.getByText('SS1/23 §3.4')).toBeInTheDocument();
    // R15-C2 (proposal §3.1, IxD ID-8 / Clarity F7): "invariants" → "firm
    // rules (invariants)" in the stat line.
    expect(screen.getByText(/evaluated against 5 hard lines and 2 firm rules \(invariants\)/i)).toBeInTheDocument();
    expect(screen.getByText(/none triggered/i)).toBeInTheDocument();
  });

  it('tripped invariants render with description, severity, citation, and required controls', () => {
    const verdict = makeVerdict({
      explanation: {
        tier_rationale: { rule_id: 'TIER-HIGH', matched_field: 'data_class' },
        track_rationale: { rule_id: 'TRACK-I', rule_name: 'Track I' },
        hard_lines_checked: 5,
        invariants_checked: 2,
        tripped_invariants: [
          {
            id: 'INV-DATA-01',
            description: 'Client PII must not flow to an external model endpoint without encryption in transit',
            severity: 'High',
            regulatory_basis: 'GDPR Art. 32(1)(a)',
            required_controls: ['CTRL-ENC-01'],
            graph_path: 'a → b',
          },
        ],
        binding_reason: null,
        binding_regulatory_basis: 'GDPR Art. 32(1)(a)',
      },
    });
    render(<VerdictDisplay verdict={verdict} auditEvents={[]} onCorrect={vi.fn()} />);

    // Since the to-do rewrite (2026-08-18) the rule description also appears as
    // "why this case needs it" under the control — two legitimate sites.
    expect(screen.getAllByText(/without encryption in transit/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('High', { selector: '.verdict__severity' })).toBeInTheDocument();
    expect(screen.getAllByText('GDPR Art. 32(1)(a)').length).toBeGreaterThan(0);
    // Copy changed 2026-08-15: "Requires: CTRL-ENC-01" became "Closed by:
    // <name>" with the id kept quiet beside it. The guarantee is unchanged —
    // the control that satisfies this invariant is shown against it.
    expect(screen.getByText(/closed by/i)).toBeInTheDocument();
    expect(screen.getAllByText(/CTRL-ENC-01/).length).toBeGreaterThan(0);
    // design-review-003: the Fold summary gist for "Why this verdict" now
    // previews the same trigger count shown in the body — two legitimate sites.
    expect(screen.getAllByText(/1 triggered/i).length).toBeGreaterThan(0);
  });

  it('BC-V11C01-04: a pre-V1.1 verdict without explanation renders without crashing (no why section)', () => {
    const legacy = { ...makeVerdict(), explanation: undefined } as unknown as Parameters<typeof VerdictDisplay>[0]['verdict'];
    render(<VerdictDisplay verdict={legacy} auditEvents={[]} onCorrect={vi.fn()} />);
    expect(screen.getByText('Verdict', { selector: '.verdict__eyebrow' })).toBeInTheDocument();
    expect(screen.queryByText(/why this verdict/i)).not.toBeInTheDocument();
  });
});

describe('VerdictDisplay — verdict completeness (V1.2-B)', () => {
  it('renders the expiry conditions when the verdict carries hypotheses, saying nothing monitors them [TC-VD-7-01]', () => {
    const verdict = makeVerdict({
      conditions: { hypotheses: ['Model drift since validation: green ≤3% · amber ≤7% · red >7%', 'Data zone pinned: Zone B'] },
    });
    render(<VerdictDisplay verdict={verdict} auditEvents={[]} onCorrect={vi.fn()} />);

    // Heading and subtitle rewritten for a business reader (user report
    // 2026-08-15). The guarantee is the honesty one and it is unchanged: the
    // panel must say that NOTHING watches these automatically, so nobody reads
    // a threshold list as an alarm that will go off.
    // design-review round 3 (Panel G): retitled and promoted out of a Fold —
    // this is now beat 4, "What could go wrong", rendered open by default
    // for every reader rather than folded away.
    expect(screen.getByText(/what could go wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/nobody automatically/i)).toBeInTheDocument();
    expect(screen.getAllByText(/later release/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Data zone pinned: Zone B')).toBeInTheDocument();
  });

  it('renders no conditions panel for a verdict with empty hypotheses (legacy/rejected)', () => {
    render(<VerdictDisplay verdict={makeVerdict()} auditEvents={[]} onCorrect={vi.fn()} />);
    expect(screen.queryByText(/standing conditions/i)).not.toBeInTheDocument();
  });

  it('TC-R15-C3-01, TC-R15-C3-02: renders the record & provenance panel from the graph prop, and the appetite summary line with counts', () => {
    const graph = {
      id: 'g1',
      version: 1,
      input_nodes: [{ id: 'i1', label: 'Client notes', data_class: 'Client PII' as const, data_zone: 'Zone B' as const }],
      processing_nodes: [
        { id: 'p1', label: 'Drafting model', model_type: 'llm' as const, autonomy_level: 1 as const, data_zone: 'Zone B' as const, vendor: 'Anthropic', replaces_prior_model: false },
      ],
      output_nodes: [
        { id: 'o1', label: 'Draft email', action_type: 'draft' as const, exposure: 'internal-only' as const, decision_bindingness: 'advisory' as const, output_reversibility: 'reversible' as const, scale: 'limited' as const },
      ],
      edges: [],
      jurisdictions: ['UK'],
      intake_method: 'llm' as const,
      extracted_at: '2026-01-01T00:00:00.000Z',
    };
    render(
      <VerdictDisplay verdict={makeVerdict()} auditEvents={[]} graph={graph} registerStage="pre_checked" onCorrect={vi.fn()} />,
    );

    // Heading renamed "Record & provenance" -> "What you told us". The panel
    // and its rows are the guarantee, not the title.
    expect(screen.getByText(/what you told us/i)).toBeInTheDocument();
    // R15-C3 (proposal §3.5, S1b): graphSummaryRows() now routes every value
    // through field-copy.ts's plainWithCode() — the raw enum alone
    // ("Client PII", "llm") is no longer what this attestation-adjacent
    // panel renders; a short plain phrase leads, the code stays quiet
    // beside it.
    expect(screen.getByText('Client notes · Personal details of clients · Client PII')).toBeInTheDocument();
    expect(screen.getByText('Drafting model · A chatbot or writing assistant · LLM')).toBeInTheDocument();
    expect(screen.getByText(/inside appetite once 1 control is in place/i)).toBeInTheDocument();
    // design-review-003 (Panel A): the "(LC-2)" internal-ID parenthetical
    // was removed from this stage note — the same fact is stated plainly.
    expect(screen.getByText(/awaiting active 2LoD sign-off/i)).toBeInTheDocument();
  });
});

describe('VerdictDisplay — proof-carrying controls (V1.3)', () => {
  const policyStub = {
    controls: [
      {
        id: 'CTRL-ENC-01',
        name: 'Encryption in transit (TLS 1.3+)',
        description: 'TLS 1.3+',
        resolves: ['INV-DATA-01'],
        burden: 1,
        verification: 'manifest check',
        verification_evidence: {
          status: 'verified' as const,
          detail: 'Platform pins TLS 1.3',
          attested_by: 'Platform Engineering',
          attested_at: '2026-06-01',
        },
      },
      {
        id: 'CTRL-HITL-02',
        name: 'Human review before action execution',
        description: 'HITL',
        resolves: [],
        burden: 3,
        verification: 'UI shows approval step',
        // no verification_evidence -> UNVERIFIED (BC-V13-02)
      },
    ],
    hard_lines: [],
    invariants: [],
  } as unknown as Parameters<typeof VerdictDisplay>[0]['policy'];

  it('renders the CS-1 panel with a VERIFIED chip + attestation for evidenced controls and UNVERIFIED for bare ones', () => {
    const verdict = makeVerdict({ controls: ['CTRL-ENC-01', 'CTRL-HITL-02'] });
    render(<VerdictDisplay verdict={verdict} auditEvents={[]} policy={policyStub} onCorrect={vi.fn()} />);

    expect(screen.getByText(/the control set, with evidence status/i)).toBeInTheDocument();
    expect(screen.getByText(/statuses are attested in the policy file/i)).toBeInTheDocument();
    expect(screen.getByText('VERIFIED')).toBeInTheDocument();
    expect(screen.getByText('UNVERIFIED')).toBeInTheDocument();
    expect(screen.getByText(/platform pins TLS 1\.3 — attested by Platform Engineering \(2026-06-01\)/i)).toBeInTheDocument();
    expect(screen.getByText(/patches: INV-DATA-01/i)).toBeInTheDocument();
  });

  // R16-W W-7 (D-77): firm-level evidence scoped away from this graph's
  // platform/vendor must not read VERIFIED, and the panel must say why.
  it('TC-R16-W-51: evidence scoped by applies_to, with the graph outside that scope, reads UNVERIFIED and shows the "not for this tool" note instead of the detail line', () => {
    const scopedPolicy = {
      controls: [
        {
          id: 'CTRL-ENC-01',
          name: 'Encryption in transit (TLS 1.3+)',
          description: 'TLS 1.3+',
          resolves: ['INV-DATA-01'],
          burden: 1,
          verification: 'manifest check',
          verification_evidence: {
            status: 'verified' as const,
            detail: 'Platform pins TLS 1.3',
            applies_to: { platforms: ['PLAT-X'] },
          },
        },
      ],
      platforms: [{ id: 'PLAT-X', name: 'raw', approved_envelope: {}, satisfies_controls: [], plain_name: 'Firm Platform' }],
      hard_lines: [],
      invariants: [],
    } as unknown as Parameters<typeof VerdictDisplay>[0]['policy'];
    const graph = {
      id: 'g1', version: 1, intake_method: 'structured_form' as const, extracted_at: '2026-01-01T00:00:00.000Z',
      jurisdictions: [], input_nodes: [], output_nodes: [], edges: [],
      processing_nodes: [{ id: 'p1', label: 'p', model_type: 'llm' as const, autonomy_level: 1 as const, data_zone: 'Zone A' as const, vendor: 'an AI service you weren’t sure about', replaces_prior_model: false }],
    };
    const verdict = makeVerdict({ controls: ['CTRL-ENC-01'] });
    render(<VerdictDisplay verdict={verdict} auditEvents={[]} policy={scopedPolicy} graph={graph} onCorrect={vi.fn()} />);

    expect(screen.getByText('UNVERIFIED')).toBeInTheDocument();
    expect(screen.queryByText('VERIFIED')).not.toBeInTheDocument();
    expect(screen.queryByText(/platform pins TLS 1\.3/i)).not.toBeInTheDocument();
    expect(screen.getByText("Your firm's records show this for Firm Platform — not for this tool.")).toBeInTheDocument();
  });

  // P8-C07 upstream fix. This asserted the plain id list, which said nothing
  // at all about evidence — and a reader cannot distinguish "we could not
  // check" from "there is nothing to show". §15.1a is explicit: where policy
  // is unavailable the status renders as UNKNOWN, not UNVERIFIED, because
  // absence of a policy is not evidence of absent evidence. The original
  // intent (no FABRICATED chips) is preserved and still asserted.
  it('BC-V13-03: without a policy prop, evidence reads UNKNOWN — never a fabricated verified/unverified chip', () => {
    const verdict = makeVerdict({ controls: ['CTRL-ENC-01'] });
    render(<VerdictDisplay verdict={verdict} auditEvents={[]} onCorrect={vi.fn()} />);
    // The control now appears twice on the page — once in "What you need to
    // do" and once here — so this is scoped to the control-set panel rather
    // than made a loose single match. The guarantee is unchanged: no chip may
    // claim verified or unverified when no policy was loaded to read it from.
    expect(screen.getAllByText('CTRL-ENC-01').length).toBeGreaterThan(0);
    expect(screen.getByText('EVIDENCE UNKNOWN')).toBeInTheDocument();
    expect(screen.getByText(/could not be checked/i)).toBeInTheDocument();
    expect(screen.getByText(/not the same as having no evidence/i)).toBeInTheDocument();
    expect(screen.queryByText('VERIFIED')).not.toBeInTheDocument();
    expect(screen.queryByText('UNVERIFIED')).not.toBeInTheDocument();
  });
});

// Code review 001, I-1 (Panel B). The CS-1 margin fields were computed by
// evaluate(), persisted onto every verdict, present in fixtures — and read
// by zero components. HR-14 was fixed at the data layer and the identical
// defect reproduced at the UI layer in the same session.
describe('VerdictDisplay — CS-1 governance margin (code review 001, I-1)', () => {
  it('shows the margin achieved against its target', () => {
    const verdict = makeVerdict({
      margin_achieved: 0,
      margin_target: 0.1,
      boundary_proximity: true,
      single_covered_invariants: ['INV-DATA-01', 'INV-TRACK2-01'],
      explanation: {
        tier_rationale: null,
        track_rationale: null,
        hard_lines_checked: 5,
        invariants_checked: 14,
        tripped_invariants: [
          { id: 'INV-DATA-01', description: 'x', severity: 'High', required_controls: [], graph_path: 'p' },
        ],
        binding_reason: null,
        binding_regulatory_basis: null,
      },
    });
    render(<VerdictDisplay verdict={verdict} auditEvents={[]} onCorrect={vi.fn()} />);

    // Copy changed 2026-08-15: "MARGIN 0% achieved against a 10% target" said
    // nothing to a business reader, and the fragile invariants were a bare
    // comma-separated list of ids. Both now read in words, and the ids are
    // kept quiet beside their descriptions.
    expect(screen.getByText(/0% of the triggered rules have more than one control/i)).toBeInTheDocument();
    expect(screen.getByText(/resting on a single control/i)).toBeInTheDocument();
    expect(screen.getAllByText(/INV-DATA-01/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/INV-TRACK2-01/).length).toBeGreaterThan(0);
    // Honesty (NF-2): zero margin is a limit of the rulebook, and the UI
    // must say so rather than implying the use case was at fault.
    expect(screen.getByText(/limit of the rulebook, not of this use case/i)).toBeInTheDocument();
  });
});

// P8-C04, review pass 2. The engine computed the cause and nothing rendered
// it: a verdict provisional for the no-regulatory-basis reason showed
// "legal review required" and no reason at all, because the banner only ever
// listed low-confidence caveats — which exist solely for the OTHER cause.
// This is the project's own computed-but-never-consumed defect class.
describe('VerdictDisplay — the provisional cause is stated, not just the status', () => {
  // P8-C05 applies the trace ids. P8-C04 wrote these tests but deliberately
  // did not borrow the ids: TC-R3-JU-6-* all read "When the verdict is
  // rendered", and nothing rendered the cause until C04's own review pass 2
  // forced it. The ids land here, with the rendering chunk that owns them.
  it('TC-R3-JU-6-01: states the no-regulatory-basis cause when there are no caveats to fall back on', () => {
    const verdict = makeVerdict({
      confidence_caveats: [],
      provisional_reasons: ['no_regulatory_basis'],
    });
    render(<VerdictDisplay verdict={verdict} auditEvents={[]} onCorrect={vi.fn()} />);

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent(/no jurisdiction pack applied/i);
    // The honesty clause — that the firm's own policy still applied — lives on
    // the body panel (TC-R3-JU-3-01 asserts it there). The banner carries the
    // labelled cause only, deliberately terse: stating the same sentence in
    // both places read as duplication rather than as two things.
    expect(banner).toHaveTextContent(/no country rulebook was used/i);
    // Not the wider claim: the firm's own rules cite regulators, and those
    // citations render on this same screen.
    expect(banner).not.toHaveTextContent(/no regulatory rules/i);
  });

  it('TC-R3-JU-6-02: states the unsigned-rules cause distinctly — the two do not collapse into one badge', () => {
    const verdict = makeVerdict({
      confidence_caveats: [],
      provisional_reasons: ['unsigned_pack_rules'],
    });
    render(<VerdictDisplay verdict={verdict} auditEvents={[]} onCorrect={vi.fn()} />);

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent(/not yet adopted/i);
    expect(banner).not.toHaveTextContent(/no jurisdiction pack applied/i);
  });

  it('TC-R3-JU-6-04: states no cause when the verdict is not provisional', () => {
    render(
      <VerdictDisplay verdict={makeVerdict({ provisional_reasons: [] })} auditEvents={[]} onCorrect={vi.fn()} />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// P8-C05 — verdict-audit.md §13. Two things, two readers. The prose statement
// tells the submitter what the consequence is; the labelled reason puts the
// cause on the record for whoever reads it later. An implementation with only
// one of them has met one requirement, not both.
describe('VerdictDisplay — no regulatory basis is stated, not just implied (R3-JU-3)', () => {
  const noBasisVerdict = () =>
    makeVerdict({
      confidence_caveats: [],
      provisional_reasons: ['no_regulatory_basis'],
      pack_versions: {},
      explanation: {
        tier_rationale: null,
        track_rationale: null,
        hard_lines_checked: 4,
        invariants_checked: 6,
        tripped_invariants: [],
        binding_reason: null,
        binding_regulatory_basis: null,
        regulatory_chain: [],
      },
    });

  it('TC-R3-JU-3-01: the verdict says in words that no regulatory basis was applied', () => {
    const { container } = render(
      <VerdictDisplay verdict={noBasisVerdict()} auditEvents={[]} onCorrect={vi.fn()} />,
    );

    const statement = container.querySelector('[data-no-regulatory-basis]');
    // Leveson: the assertion is on the PRESENCE of the explanation, not on the
    // absence of the reasoning-chain panel. Before this chunk the panel simply
    // did not render, and "no regulation applies", "we did not check" and "the
    // panel broke" were indistinguishable — all three look like nothing.
    expect(statement, 'no statement rendered where the reasoning chain would be').not.toBeNull();
    expect(statement).toHaveTextContent(/no jurisdiction pack applied/i);
    expect(statement).toHaveTextContent(/citations/i);
    // The firm's own policy DID run, and it carries 31 regulator citations of
    // its own (verified: policy/appetite.yaml, `regulatory_basis` fields).
    // Review pass 3: two earlier drafts of this sentence claimed no regulator
    // rules were involved at all, which was false while a real citation was
    // rendered a few centimetres above it.
    expect(statement).toHaveTextContent(/firm/i);
    expect(statement).toHaveTextContent(/still applied in full/i);
  });

  it('TC-R3-JU-3-02: the prose statement and the labelled reason are separately assertable', () => {
    const { container } = render(
      <VerdictDisplay verdict={noBasisVerdict()} auditEvents={[]} onCorrect={vi.fn()} />,
    );

    const statement = container.querySelector('[data-no-regulatory-basis]');
    const labelled = container.querySelector('[data-provisional-reason="no_regulatory_basis"]');

    expect(statement).not.toBeNull();
    expect(labelled).not.toBeNull();
    // Neither satisfies the assertion for the other: they are different
    // elements, in different regions of the page, and one is not nested in the
    // other. An implementation that rendered a single string in one place
    // would pass a sloppy version of this test and fail the requirement.
    expect(statement).not.toBe(labelled);
    expect(labelled?.contains(statement!)).toBe(false);
    expect(statement?.contains(labelled!)).toBe(false);
    // The labelled reason belongs to the banner; the statement does not.
    expect(screen.getByRole('alert').contains(labelled!)).toBe(true);
    expect(screen.getByRole('alert').contains(statement!)).toBe(false);
  });

  it('TC-R3-JU-3-03: a verdict with an active pack carries no no-basis statement', () => {
    const withChain = makeVerdict({
      confidence_caveats: [],
      provisional_reasons: [],
      pack_versions: { 'EU-AIACT': '0.1' },
      explanation: {
        tier_rationale: null,
        track_rationale: null,
        hard_lines_checked: 4,
        invariants_checked: 6,
        tripped_invariants: [],
        binding_reason: null,
        binding_regulatory_basis: null,
        regulatory_chain: [
          {
            rule_id: 'EU-AIACT-TIER-02',
            document: 'EU AI Act',
            section: 'Annex III §4(a)',
            source_text: 'recruitment or selection of natural persons…',
            basis: 'derived' as const,
            derived: 'tier floor Critical',
            sign_off: 'pending firm adoption',
          },
        ],
      },
    });

    const { container } = render(
      <VerdictDisplay verdict={withChain} auditEvents={[]} onCorrect={vi.fn()} />,
    );

    expect(container.querySelector('[data-no-regulatory-basis]')).toBeNull();
  });

  // REALISTIC-FIXTURE VARIANT (TDD-3). A verdict persisted before V1.1-C01
  // carries no `explanation` at all, so the chain is missing for a completely
  // different reason. Saying "no regulatory rules were applied" about that
  // record would be a claim about history that nobody checked — the honest
  // answer is that the record predates the capture.
  it('a verdict predating explanation capture is not described as having no regulatory basis', () => {
    const legacy = makeVerdict({ confidence_caveats: [], provisional_reasons: [] }) as unknown as Record<
      string,
      unknown
    >;
    delete legacy.explanation;

    const { container } = render(
      <VerdictDisplay verdict={legacy as never} auditEvents={[]} onCorrect={vi.fn()} />,
    );

    expect(container.querySelector('[data-no-regulatory-basis]')).toBeNull();
  });
});

// P8-C05, review pass 2. The no-basis panel first read "…the tier, the
// controls and the constraint above all come from that". On a hard-line
// rejection that is false: evaluate() skips tier/track assignment entirely and
// reports Critical/I as CEILING values, not assignments (verified:
// src/engine/evaluate.ts:69-92, whose own comment says "not assignments").
// Claiming the tier came from the firm's policy would have been the UI
// asserting something the engine never determined — on a rejection, which is
// the verdict people argue with.
describe('VerdictDisplay — the no-basis statement holds on a hard-line rejection too', () => {
  it('does not claim the tier was derived when tier assignment was skipped', () => {
    const rejected = makeVerdict({
      status: 'rejected',
      tier: 'Critical',
      track: 'I',
      confidence_caveats: [],
      provisional_reasons: ['no_regulatory_basis'],
      pack_versions: {},
      explanation: {
        tier_rationale: null,
        track_rationale: null,
        hard_lines_checked: 4,
        invariants_checked: 0,
        tripped_invariants: [],
        binding_reason: 'MNPI may not leave Zone A.',
        // Review pass 3: this was null, which is exactly the field that would
        // have exposed the sentence's overclaim. A firm hard line normally
        // DOES carry a regulator citation — 31 of them exist in
        // policy/appetite.yaml — so the realistic fixture is a populated one.
        binding_regulatory_basis: 'MAR Article 8; MiFID II',
        regulatory_chain: [],
      },
    });

    const { container } = render(
      <VerdictDisplay verdict={rejected} auditEvents={[]} onCorrect={vi.fn()} />,
    );

    const statement = container.querySelector('[data-no-regulatory-basis]');
    expect(statement).not.toBeNull();
    // Still says the honest part…
    expect(statement).toHaveTextContent(/firm/i);
    // …without attributing the tier to a determination that never happened.
    expect(statement).not.toHaveTextContent(/the tier/i);
    // And the page still says elsewhere that these are ceiling values.
    expect(screen.getByText(/ceiling values/i)).toBeInTheDocument();

    // The decisive assertion: a real regulator citation from the FIRM's own
    // policy is rendered above the panel, so the panel must not claim no
    // regulator rules were involved. Two drafts of this sentence did exactly
    // that, and the first version of this test could not catch it because the
    // fixture left the citation null.
    expect(screen.getByText(/MAR Article 8/)).toBeInTheDocument();
    expect(statement).not.toHaveTextContent(/nothing above/i);
    expect(statement).toHaveTextContent(/still applied in full/i);
  });
});

// P8-C05 → P8-C06. register-lifecycle.md §15.1b (design review I-1). The
// sign-off page reuses this component, and correction is a SUBMITTER action
// (verdict-audit.md §6.1), not a reviewer one. `onCorrect` was required and
// its button rendered unconditionally (verified: VerdictDisplay.tsx:20 and
// :418 before this chunk), so "the affordance is not carried over" was
// unbuildable by reuse alone — reuse would either put the button on the
// reviewer's page or hang a no-op behind a control that still invites a click.
describe('VerdictDisplay — reusable on a reviewer page (P8-C06)', () => {
  // No trace id: TC-R3-RD-8-01 reads "opened from the register", so it belongs
  // to RegisterDetail.test.tsx where the sign-off page is actually rendered.
  // This is the unit-level guard on the same behaviour (spec-parity R7 — one
  // id, one test).
  it('omitting onCorrect removes the correction control and the reasoning-trace disclosure', () => {
    render(<VerdictDisplay verdict={makeVerdict()} auditEvents={[]} />);

    expect(screen.queryByRole('button', { name: /correct this classification/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/reasoning trace/i)).not.toBeInTheDocument();
  });

  it('supplying onCorrect keeps both, so the submitter flow is unchanged', async () => {
    const onCorrect = vi.fn();
    const user = userEvent.setup();
    render(<VerdictDisplay verdict={makeVerdict()} auditEvents={[]} onCorrect={onCorrect} />);

    const button = screen.getByRole('button', { name: /correct this classification/i });
    expect(screen.getByText(/reasoning trace/i)).toBeInTheDocument();

    // Not merely present — still wired. A gate that rendered the button and
    // dropped the handler would pass a presence-only assertion.
    await user.click(button);
    expect(onCorrect).toHaveBeenCalledTimes(1);
  });

  it('the verdict itself still renders without onCorrect — only the affordances go', () => {
    render(<VerdictDisplay verdict={makeVerdict()} auditEvents={[]} />);

    // The reviewer must still see what they are signing off. Gating the whole
    // component on the prop would be a far worse defect than the one being
    // fixed.
    expect(screen.getByRole('heading', { name: /with controls/i })).toBeInTheDocument();
    expect(screen.getByText('INV-DATA-01')).toBeInTheDocument();
  });
});

// Round 4, user decision (2026-08-05). A rejected verdict lists the reason and
// then the forward path: what this shape of use case would still require if it
// were re-scoped. The data is the same as an approved verdict's downstream
// reviews; the CLAIM is different, and stating the second as the first would
// put someone under an instruction they are not under.
describe('VerdictDisplay — downstream reviews read differently on a rejection (CS-3)', () => {
  const withReviews = (status: 'approved_with_controls' | 'rejected') =>
    makeVerdict({ status, downstream_reviews: ['Information security review', 'Vendor risk assessment'] });

  it('an approved verdict states them as obligations', () => {
    render(<VerdictDisplay verdict={withReviews('approved_with_controls')} auditEvents={[]} onCorrect={vi.fn()} />);

    expect(screen.getByText(/downstream reviews:/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing here is required of you now/i)).not.toBeInTheDocument();
  });

  it('a rejected verdict states them as a forward path, owed by nobody today', () => {
    render(<VerdictDisplay verdict={withReviews('rejected')} auditEvents={[]} onCorrect={vi.fn()} />);

    expect(screen.getByText(/if this use case is re-scoped/i)).toBeInTheDocument();
    // The disclaimer is the whole point — without it this is a to-do list
    // attached to a verdict that told the user to stop.
    expect(screen.getByText(/nothing here is required of you now/i)).toBeInTheDocument();
    expect(screen.getByText(/Information security review/)).toBeInTheDocument();
    // And it must not read as the obligations line.
    expect(screen.queryByText(/^Downstream reviews:/)).not.toBeInTheDocument();
  });
});

// User-reported after the v0.1.0 tag: the "Why this verdict" panel lists rule
// IDs — INV-AUTONOMY-01, TIER-CRITICAL — and never says what kind of thing
// they are or where they came from. "How will someone know what this is?"
//
// The panel is the product's core claim made visible: a verdict traceable to
// a rule. It fails that claim if the reader cannot tell an appetite invariant
// (the firm's own rule, satisfiable by controls) from a hard line (absolute,
// no control set can fix it) from a jurisdiction-pack rule (external
// regulation, shown separately and provisional until adopted).
describe('VerdictDisplay — Why this verdict says what the rules ARE', () => {
  const tripped = {
    id: 'INV-AUTONOMY-01',
    description: 'A system acting independently on a material decision must have a human decision gate',
    severity: 'Critical',
    regulatory_basis: 'RAF §7 — autonomy ceiling',
    required_controls: ['CTRL-HITL-02'],
    graph_path: 'input → output',
  };

  it('names the invariant list as the firm\'s own appetite rules, not just IDs', async () => {
    render(
      <VerdictDisplay
        verdict={makeVerdict({
          explanation: {
            tier_rationale: { rule_id: 'TIER-CRITICAL', regulatory_basis: 'EU AI Act Annex III §5(b)' },
            track_rationale: null,
            hard_lines_checked: 5,
            invariants_checked: 18,
            tripped_invariants: [tripped],
            binding_reason: null,
            binding_regulatory_basis: null,
          },
        })}
        auditEvents={[]}
      />,
    );
    // The reader must be told these come from the firm's risk appetite.
    expect(screen.getAllByText(/risk appetite/i).length).toBeGreaterThan(0);
    // And that an invariant is a rule a control set can satisfy — which is
    // precisely what distinguishes it from a hard line.
    expect(screen.getAllByText(/invariant/i).length).toBeGreaterThan(0);
  });

  it('explains that hard lines are checked first and cannot be fixed by controls', () => {
    render(
      <VerdictDisplay
        verdict={makeVerdict({
          explanation: {
            tier_rationale: { rule_id: 'TIER-CRITICAL' },
            track_rationale: null,
            hard_lines_checked: 5,
            invariants_checked: 18,
            tripped_invariants: [tripped],
            binding_reason: null,
            binding_regulatory_basis: null,
          },
        })}
        auditEvents={[]}
      />,
    );
    expect(screen.getAllByText(/hard line/i).length).toBeGreaterThan(0);
    // The defining property, stated rather than assumed.
    expect(screen.getAllByText(/no control/i).length).toBeGreaterThan(0);
  });
});

// The engine computes `unclassified_decision_types` and the first cut of the
// banner never rendered it — computed, stored, and invisible. That is the
// defect class CLAUDE.md names ("a field that is computed but never consumed
// is a bug in waiting"), and it was caught by reading the rendered page, not
// by a test. This is the test that would have caught it.
describe('VerdictDisplay — an unrecognised decision type is NAMED, not just counted', () => {
  it('renders the decision type the submitter typed', () => {
    render(
      <VerdictDisplay
        verdict={makeVerdict({
          provisional_reasons: ['unclassified_decision_type'],
          unclassified_decision_types: ['collections prioritisation'],
        })}
        auditEvents={[]}
      />,
    );
    const banner = document.querySelector('[data-provisional-reason="unclassified_decision_type"]');
    expect(banner).not.toBeNull();
    // A cause with no subject is not actionable — the firm needs to know WHICH
    // decision type its policy has no position on.
    expect(banner?.textContent).toContain('collections prioritisation');
  });

  it('names every one of them when a graph carries more than one', () => {
    render(
      <VerdictDisplay
        verdict={makeVerdict({
          provisional_reasons: ['unclassified_decision_type'],
          unclassified_decision_types: ['AML alert triage', 'collections prioritisation'],
        })}
        auditEvents={[]}
      />,
    );
    const banner = document.querySelector('[data-provisional-reason="unclassified_decision_type"]');
    expect(banner?.textContent).toContain('AML alert triage');
    expect(banner?.textContent).toContain('collections prioritisation');
  });

  it('does not render an empty "Entered:" when there is nothing to name', () => {
    // A legacy verdict has no such field at all. The banner must degrade to
    // the plain cause rather than trailing a dangling label.
    render(
      <VerdictDisplay
        verdict={makeVerdict({ provisional_reasons: ['unclassified_decision_type'] })}
        auditEvents={[]}
      />,
    );
    const banner = document.querySelector('[data-provisional-reason="unclassified_decision_type"]');
    expect(banner?.textContent).not.toContain('Entered:');
  });
});

// The "What you need to do" panel (user report 2026-08-15: "the verdict should
// be something a business user understands — how it's derived and what they
// need to do"). Its first draft had two evidence states and asserted "no
// evidence recorded yet" whenever a policy was absent — a claim about a control
// nobody had looked at, which is exactly what BC-V13-03 pins for the chip. The
// third state exists because of that, and these tests hold it there.
describe('VerdictDisplay — What you need to do', () => {
  it('lists each required control by NAME, with the id kept but quiet', () => {
    render(
      <VerdictDisplay
        verdict={makeVerdict({ controls: ['CTRL-ENC-01'] })}
        auditEvents={[]}
        policy={
          {
            controls: [{ id: 'CTRL-ENC-01', name: 'Encryption at rest', resolves: [], verification_evidence: { status: 'verified' } }],
            hard_lines: [],
            invariants: [],
          } as unknown as Parameters<typeof VerdictDisplay>[0]['policy']
        }
      />,
    );
    const todo = document.querySelector('.verdict__todo');
    expect(todo?.textContent).toContain('Encryption at rest');
    // The id must survive — it is what makes the item quotable in a committee
    // paper and greppable in the policy file.
    expect(todo?.textContent).toContain('CTRL-ENC-01');
  });

  it('says the evidence status is UNKNOWN when no policy is loaded — never "outstanding"', () => {
    render(<VerdictDisplay verdict={makeVerdict({ controls: ['CTRL-ENC-01'] })} auditEvents={[]} />);
    // Scoped to the LIST, not the panel: the panel's closing footnote explains
    // what "no evidence recorded yet" means, so asserting against the whole
    // panel would match the explanation rather than the item's status.
    const item = document.querySelector('.verdict__todo-list li');
    expect(item?.textContent).toMatch(/unknown/i);
    // Asserting it is outstanding would be inventing a finding about a control
    // nobody inspected.
    expect(item?.textContent).not.toMatch(/no evidence recorded yet/i);
  });

  it('tells a rejected use case there is nothing to implement', () => {
    render(
      <VerdictDisplay
        verdict={makeVerdict({ status: 'rejected', controls: [], binding_constraint: 'HL-002' })}
        auditEvents={[]}
      />,
    );
    const todo = document.querySelector('.verdict__todo');
    expect(todo?.textContent).toMatch(/nothing to implement/i);
    expect(todo?.textContent).toMatch(/hard line/i);
  });

  it('says plainly when there is nothing to do at all', () => {
    render(
      <VerdictDisplay
        verdict={makeVerdict({ status: 'approved', controls: [], downstream_reviews: [] })}
        auditEvents={[]}
      />,
    );
    expect(document.querySelector('.verdict__todo')?.textContent).toMatch(/^What you need to do\s*Nothing to put in place/);
  });

  it('names the 2LoD sign-off as an outstanding item when the case is awaiting one', () => {
    render(
      <VerdictDisplay
        verdict={makeVerdict({ controls: ['CTRL-ENC-01'] })}
        auditEvents={[]}
        registerStage="pre_checked"
      />,
    );
    expect(document.querySelector('.verdict__todo')?.textContent).toMatch(/second-line sign-off/i);
  });
});

// The banner used to say "legal review required" for every provisional cause.
// The packs themselves disagree: DORA is signed by Technology Risk, SS1/23 by
// Model Risk — and an unlisted decision type needs the appetite owner, not a
// lawyer. Where the verdict KNOWS who is pending (from the reasoning chain's
// sign-off lines), the banner now names them; where it does not, it stays
// silent rather than guessing.
describe('VerdictDisplay — the provisional banner names who, when it knows', () => {
  it('lists the distinct pending functions from the chain sign-offs', () => {
    render(
      <VerdictDisplay
        verdict={makeVerdict({
          provisional_reasons: ['unsigned_pack_rules'],
          confidence_caveats: [{ ruleId: 'R1', field: 'f', reason: 'r', confidence: 'low' }],
          explanation: {
            tier_rationale: null, track_rationale: null, hard_lines_checked: 0, invariants_checked: 0,
            tripped_invariants: [], binding_reason: null, binding_regulatory_basis: null,
            regulatory_chain: [
              { rule_id: 'R1', document: 'DORA', section: 'Art. 28', source_text: 't', basis: 'derived',
                derived: 'd', sign_off: '[FIRM] — Technology Risk · pending firm adoption' },
              { rule_id: 'R2', document: 'SS1/23', section: '§3.4', source_text: 't', basis: 'derived',
                derived: 'd', sign_off: '[FIRM] — Model Risk · pending firm adoption' },
              { rule_id: 'R3', document: 'X', section: '§1', source_text: 't', basis: 'derived',
                derived: 'd', sign_off: '[FIRM] — Legal/Compliance · 2026-01-01 (adopted at pack level)' },
            ],
          },
        })}
        auditEvents={[]}
      />,
    );
    const banner = document.querySelector('.verdict__provisional-banner');
    // The two PENDING functions are named; the already-adopted one is not.
    expect(banner?.textContent).toContain('Technology Risk');
    expect(banner?.textContent).toContain('Model Risk');
    expect(banner?.textContent).not.toMatch(/adopt.*Legal\/Compliance|Legal\/Compliance.*needs/);
  });

  it('points an unlisted decision type at the appetite owner, not at legal', () => {
    render(
      <VerdictDisplay
        verdict={makeVerdict({
          provisional_reasons: ['unclassified_decision_type'],
          unclassified_decision_types: ['collections prioritisation'],
        })}
        auditEvents={[]}
      />,
    );
    const banner = document.querySelector('.verdict__provisional-banner');
    expect(banner?.textContent).toMatch(/risk appetite|appetite policy/i);
    expect(banner?.textContent).not.toMatch(/legal review/i);
  });
});

// VD-6 and VD-8 traceability close-out (2026-08-15).
describe('VerdictDisplay — living status and trace safety', () => {
  it('renders the living status the engine has always written [TC-VD-6-01]', () => {
    render(<VerdictDisplay verdict={makeVerdict()} auditEvents={[]} />);
    const el = document.querySelector('.verdict__living-status');
    // The field was computed on every verdict since V1 and rendered nowhere —
    // found by the traceability close-out. This holds it on screen.
    expect(el?.textContent).toMatch(/living status/i);
    // 'in good standing', not the raw 'approved' — the word is reserved by
    // the suite-wide single-match guard (BC-V12B-03).
    expect(el?.textContent).toMatch(/in good standing/i);
  });

  it('renders an LLM reasoning trace as text, never as markup [TC-VD-8-02]', async () => {
    const verdict = makeVerdict();
    const hostile = 'Because of <img src=x onerror="alert(1)"> the tier is High.';
    render(
      <VerdictDisplay
        verdict={verdict}
        auditEvents={[
          {
            event_id: 'e1',
            use_case_id: verdict.use_case_id,
            occurred_at: '2026-01-01T00:00:00.000Z',
            actor: 'system',
            payload: { type: 'verdict_produced', verdict, reasoning_trace: hostile },
          } as unknown as Parameters<typeof VerdictDisplay>[0]['auditEvents'][number],
        ]}
        onCorrect={vi.fn()}
      />,
    );
    // The trace is LLM output — untrusted by definition. Open the disclosure
    // and prove the payload stayed literal.
    const user = userEvent.setup();
    await user.click(screen.getByText(/reasoning trace/i));
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(/onerror=/)).toBeInTheDocument();
  });
});

// Adversarial review against arXiv:2501.18837 and the llama3 assistant-priming
// jailbreak (2026-08-15). The LLM surfaces are schema-forced and
// human-confirmed, so injection cannot reach the decision — but the reasoning
// trace rendered with NO provenance label, so a reader could take AI prose as
// the verdict's official reasoning. If a jailbroken trace ever says something
// the rules did not, the screen must already have disclaimed it.
it('the reasoning trace names its own provenance and non-authority [TC-VD-8-02]', () => {
  const verdict = makeVerdict();
  render(
    <VerdictDisplay
      verdict={verdict}
      auditEvents={[
        {
          event_id: 'e1',
          use_case_id: verdict.use_case_id,
          occurred_at: '2026-01-01T00:00:00.000Z',
          actor: 'system',
          payload: { type: 'verdict_produced', verdict, reasoning_trace: 'Because reasons, the tier is High.' },
        } as unknown as Parameters<typeof VerdictDisplay>[0]['auditEvents'][number],
      ]}
      onCorrect={vi.fn()}
    />,
  );
  const trace = document.querySelector('.verdict__trace');
  expect(trace?.textContent).toMatch(/not part of the verdict/i);
  expect(trace?.textContent).toMatch(/panels win/i);
});
