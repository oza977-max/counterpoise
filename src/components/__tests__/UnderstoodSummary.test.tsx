import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UnderstoodSummary from '../UnderstoodSummary';
import type { DataFlowGraph, PolicyFile } from '../../engine/types';
import type { Assumption } from '../plain-copy';

// The collapsed "Show the details the rules use" grid legitimately repeats
// raw engine codes (zone letters, model-type codes) for the reviewer — that
// is its documented job (§3: "its grid stays under ... collapsed"). Several
// assertions below must therefore be scoped to the PLAIN summary section
// they are checking, not the whole page, or they would collide with that
// grid's own, deliberately-coded text.
function sectionFor(headingText: RegExp): HTMLElement {
  return screen.getByText(headingText).closest('section') as HTMLElement;
}

// R16-C (UC-9, UC-12; build/prompts/R16.md v2.1 §3). A presentation
// component (Rule 4, cross-cutting.md §7) — everything it renders is
// derived from the graph via graph-summary.ts's pure helpers, or passed in
// as props; no business logic here.

function graph(overrides: Partial<DataFlowGraph> = {}): DataFlowGraph {
  return {
    id: 'g1',
    version: 1,
    intake_method: 'structured_form',
    extracted_at: '2026-01-01T00:00:00.000Z',
    jurisdictions: [],
    input_nodes: [{ id: 'i1', label: 'Client notes', data_class: 'Client PII', data_zone: 'Zone B' }],
    processing_nodes: [
      {
        id: 'p1',
        label: 'Drafting model',
        model_type: 'llm',
        autonomy_level: 1,
        data_zone: 'Zone B',
        vendor: 'internal',
        replaces_prior_model: false,
      },
    ],
    output_nodes: [
      {
        id: 'o1',
        label: 'Draft email',
        action_type: 'draft',
        exposure: 'internal-only',
        decision_bindingness: 'non-binding',
        output_reversibility: 'reversible',
        scale: 'limited',
      },
    ],
    edges: [],
    ...overrides,
  };
}

describe('UnderstoodSummary — where the information goes (§3)', () => {
  it('TC-R16-C-05: Zone C reads as "your firm’s own systems", with no zone letter anywhere', () => {
    render(
      <UnderstoodSummary
        graph={graph({ processing_nodes: [{ ...graph().processing_nodes[0]!, data_zone: 'Zone C' }] })}
        onChangeAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText(/your firm’s own systems/i)).toBeInTheDocument();
    expect(sectionFor(/where your information will go/i).textContent).not.toMatch(/Zone [ABC]/);
  });

  it('names the supplier when the vendor resolves to a registered one', () => {
    const g = graph({
      processing_nodes: [{ ...graph().processing_nodes[0]!, vendor: 'VENDOR-X', data_zone: 'Zone B' }],
    });
    render(
      <UnderstoodSummary
        graph={g}
        policy={
          {
            vendors: [{ id: 'VENDOR-X', name: 'raw', approved_envelope: {}, satisfies_controls: [], plain_name: 'Acme Supplier' }],
          } as never
        }
        onChangeAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText(/Acme Supplier/)).toBeInTheDocument();
  });
});

describe('UnderstoodSummary — every kind of information, most sensitive first (D-03)', () => {
  it('TC-R16-C-06: lists every distinct data class, most sensitive first, with no bare code', () => {
    const g = graph({
      input_nodes: [
        { id: 'i1', label: 'a', data_class: 'Internal', data_zone: 'Zone B' },
        { id: 'i2', label: 'b', data_class: 'MNPI', data_zone: 'Zone B' },
      ],
    });
    render(<UnderstoodSummary graph={g} onChangeAnswer={vi.fn()} />);
    const section = sectionFor(/the information it will use/i);
    const items = within(section).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(items.some((t) => /price-sensitive/i.test(t))).toBe(true);
    const mnpiIndex = items.findIndex((t) => /price-sensitive/i.test(t));
    // R16-W §2 (D-71): the reviewer-card wording ("Everyday business
    // information — nothing sensitive") is replaced by the newcomer-tested
    // SUMMARY_DATA_CLASS text for Internal.
    const internalIndex = items.findIndex((t) => /everyday work information/i.test(t));
    expect(internalIndex).toBeGreaterThan(mnpiIndex);
    expect(section.textContent).not.toMatch(/\(MNPI\)/);
  });
});

describe('UnderstoodSummary — R16-W §2: the form’s own words (D-71)', () => {
  it('TC-R16-W-28: "Through: {name}." renders the registry plain_name for a registered, non-internal vendor', () => {
    const g = graph({
      processing_nodes: [{ ...graph().processing_nodes[0]!, vendor: 'VENDOR-X' }],
    });
    render(
      <UnderstoodSummary
        graph={g}
        policy={{ vendors: [{ id: 'VENDOR-X', name: 'raw', approved_envelope: {}, satisfies_controls: [], plain_name: 'Acme Supplier' }] } as never}
        onChangeAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText('Through: Acme Supplier.')).toBeInTheDocument();
    expect(screen.queryByText(/your firm hasn.t assessed this supplier yet/i)).not.toBeInTheDocument();
  });

  it('TC-R16-W-29: an unregistered vendor renders the recorded string plus the "hasn’t assessed" second line', () => {
    const g = graph({
      processing_nodes: [{ ...graph().processing_nodes[0]!, vendor: 'a personal account (no contract with your firm)' }],
    });
    render(<UnderstoodSummary graph={g} onChangeAnswer={vi.fn()} />);
    expect(screen.getByText('Through: a personal account (no contract with your firm).')).toBeInTheDocument();
    expect(screen.getByText(/your firm hasn.t assessed this supplier yet/i)).toBeInTheDocument();
  });

  it('TC-R16-W-30: "Runs on: {platform plain_name}." renders when the processing node names a policy platform', () => {
    const g = graph({
      processing_nodes: [{ ...graph().processing_nodes[0]!, vendor: 'internal', platform: 'PLAT-X' }],
    });
    render(
      <UnderstoodSummary
        graph={g}
        policy={{ platforms: [{ id: 'PLAT-X', name: 'raw', approved_envelope: {}, satisfies_controls: [], plain_name: 'Firm Platform' }] } as never}
        onChangeAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText('Runs on: Firm Platform.')).toBeInTheDocument();
  });

  it('TC-R16-W-31: the kind of AI now renders, in plain words', () => {
    render(
      <UnderstoodSummary
        graph={graph({ processing_nodes: [{ ...graph().processing_nodes[0]!, model_type: 'agentic' }] })}
        onChangeAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText(/an ai agent that works through tasks on its own/i)).toBeInTheDocument();
  });

  it('TC-R16-W-32: autonomy_level >= 2 renders the acting-alone line plus its action-type clause', () => {
    render(
      <UnderstoodSummary
        graph={graph({
          processing_nodes: [{ ...graph().processing_nodes[0]!, autonomy_level: 4 }],
          output_nodes: [{ ...graph().output_nodes[0]!, action_type: 'trade', decision_bindingness: 'binding' }],
        })}
        onChangeAnswer={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/it acts entirely by itself, with no person involved at any point — it places or changes trades/i),
    ).toBeInTheDocument();
  });

  it('TC-R16-W-33: a supervised, hitl action appends the person-checks clause', () => {
    render(
      <UnderstoodSummary
        graph={graph({
          processing_nodes: [{ ...graph().processing_nodes[0]!, autonomy_level: 1 }],
          output_nodes: [{ ...graph().output_nodes[0]!, action_type: 'draft', hitl: true, decision_bindingness: 'material' }],
        })}
        onChangeAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText(/it creates a draft, and a person checks it before it.s used/i)).toBeInTheDocument();
  });

  it('TC-R16-W-34: the weight line shows only for inform/draft/recommend at autonomy_level <= 1', () => {
    const { rerender } = render(
      <UnderstoodSummary
        graph={graph({
          processing_nodes: [{ ...graph().processing_nodes[0]!, autonomy_level: 1 }],
          output_nodes: [{ ...graph().output_nodes[0]!, action_type: 'draft', decision_bindingness: 'material' }],
        })}
        onChangeAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText(/what it produces is usually what a decision is based on/i)).toBeInTheDocument();

    rerender(
      <UnderstoodSummary
        graph={graph({
          processing_nodes: [{ ...graph().processing_nodes[0]!, autonomy_level: 0 }],
          output_nodes: [{ ...graph().output_nodes[0]!, action_type: 'read', decision_bindingness: 'non-binding' }],
        })}
        onChangeAnswer={vi.fn()}
      />,
    );
    expect(screen.queryByText(/what it produces carries little weight/i)).not.toBeInTheDocument();
  });

  it('TC-R16-W-35: "If it gets something wrong" renders the reversibility line (new section)', () => {
    render(
      <UnderstoodSummary
        graph={graph({ output_nodes: [{ ...graph().output_nodes[0]!, output_reversibility: 'irreversible' }] })}
        onChangeAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText(/if it gets something wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/the mistake can.t be taken back once it happens/i)).toBeInTheDocument();
  });

  it('TC-R16-W-36: an unclassified decision_type_other adds the "ask your AI risk team" clause', () => {
    render(
      <UnderstoodSummary
        graph={graph({ output_nodes: [{ ...graph().output_nodes[0]!, decision_type_other: 'Collections triage' }] })}
        onChangeAnswer={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Collections triage — not one of the kinds we have rules for, so your AI risk team will look at it/i),
    ).toBeInTheDocument();
  });

  it('TC-R16-W-37: no jurisdictions renders the plain "none of the listed countries" fallback, not "No countries specified"', () => {
    render(<UnderstoodSummary graph={graph({ jurisdictions: [] })} onChangeAnswer={vi.fn()} />);
    expect(screen.getByText(/none of the listed countries — somewhere else, or not sure/i)).toBeInTheDocument();
    expect(screen.queryByText(/no countries specified/i)).not.toBeInTheDocument();
  });

  it('TC-R16-W-38: no rendered summary text contains "unregistered", "Zone", "(draft)" or a bare field code', () => {
    const g = graph({
      processing_nodes: [
        {
          ...graph().processing_nodes[0]!,
          model_type: 'agentic',
          autonomy_level: 4,
          system_access_scope: ['shared_infrastructure', 'credentialed_systems'],
          multi_instance_coordination: 'unknown',
          vendor: 'an AI service you weren’t sure about',
        },
      ],
      output_nodes: [{ ...graph().output_nodes[0]!, action_type: 'approve', decision_bindingness: 'binding', output_reversibility: 'unknown' }],
    });
    render(<UnderstoodSummary graph={g} assumptions={ASSUMPTIONS_FOR_RESERVED_TEST} onChangeAnswer={vi.fn()} />);
    // Scoped to the PLAIN sections only — the collapsed "Show the details
    // the rules use" grid is deliberately coded (§3) and must be excluded.
    const plainSections = screen.getAllByText(/^(where your information will go|the information it will use|what it does and who sees it|if it gets something wrong|what it helps decide|how widely it.s used, and where|what it can reach by itself|whether copies of it work together)$/i).map((h) => h.closest('section')!.textContent ?? '');
    const plainText = plainSections.join(' ');
    expect(plainText).not.toMatch(/unregistered/i);
    expect(plainText).not.toMatch(/Zone [ABC]/);
    expect(plainText).not.toMatch(/\(draft\)/);
    expect(plainText).not.toMatch(/\bllm\b/i);
    // No snake_case field code or enum name leaks. The fixture's underscore
    // codes are listed explicitly, then a generic sweep (letters joined by
    // underscores — legitimate prose never contains one).
    for (const code of ['system_access_scope', 'multi_instance_coordination', 'shared_infrastructure', 'credentialed_systems', 'model_type', 'autonomy_level', 'data_zone', 'decision_bindingness', 'output_reversibility', 'action_type', 'replaces_prior_model']) {
      expect(plainText).not.toContain(code);
    }
    expect(plainText).not.toMatch(/[a-z]+_[a-z_]+/);
  });
});

describe('UnderstoodSummary — behaviour, decisions, scale', () => {
  it('describes what it does without naming the model type', () => {
    render(<UnderstoodSummary graph={graph()} onChangeAnswer={vi.fn()} />);
    expect(document.body.textContent).not.toMatch(/\bLLM\b/);
    expect(document.body.textContent).not.toMatch(/\bagentic\b/i);
  });

  it('shows the countries involved when the graph names jurisdictions', () => {
    // CR6-23: this used to pin the BARE code "UK" with no policy supplied;
    // a code is now shown as the policy's own country name.
    const policy = {
      jurisdictions: [{ code: 'UK', name: 'United Kingdom', pack_files: [] }],
    } as unknown as PolicyFile;
    render(<UnderstoodSummary graph={graph({ jurisdictions: ['UK'] })} policy={policy} onChangeAnswer={vi.fn()} />);
    expect(sectionFor(/how widely it.s used, and where/i).textContent).toMatch(/United Kingdom/);
  });

  it('TC-CR6-23: a country code the policy does not list is never shown bare', () => {
    render(<UnderstoodSummary graph={graph({ jurisdictions: ['XX'] })} onChangeAnswer={vi.fn()} />);
    const text = sectionFor(/how widely it.s used, and where/i).textContent ?? '';
    expect(text).not.toMatch(/\bXX\b/);
    expect(text).toMatch(/another country/i);
  });

  it('TC-CR6-23b: two unlisted codes read as "2 other countries", not "another country, another country"', () => {
    const policy = { jurisdictions: [{ code: 'UK', name: 'United Kingdom', pack_files: [] }] } as unknown as PolicyFile;
    render(<UnderstoodSummary graph={graph({ jurisdictions: ['UK', 'XX', 'YY'] })} policy={policy} onChangeAnswer={vi.fn()} />);
    const text = sectionFor(/how widely it.s used, and where/i).textContent ?? '';
    expect(text).not.toMatch(/another country, another country/i);
    expect(text).toMatch(/United Kingdom, 2 other countries/);
    expect(text).not.toMatch(/\b(XX|YY)\b/);
  });

  it('states plainly whether it replaces something', () => {
    const { rerender } = render(
      <UnderstoodSummary
        graph={graph({ processing_nodes: [{ ...graph().processing_nodes[0]!, replaces_prior_model: true }] })}
        onChangeAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText(/replaces something you already use/i)).toBeInTheDocument();
    rerender(<UnderstoodSummary graph={graph()} onChangeAnswer={vi.fn()} />);
    expect(screen.getByText(/doesn’t replace/i)).toBeInTheDocument();
  });
});

describe('UnderstoodSummary — agent-specific sections, only when applicable', () => {
  it('shows what it can reach and whether copies coordinate only when those fields are present', () => {
    const { rerender } = render(<UnderstoodSummary graph={graph()} onChangeAnswer={vi.fn()} />);
    expect(screen.queryByText(/what it can reach by itself/i)).not.toBeInTheDocument();

    const agentGraph = graph({
      processing_nodes: [
        {
          ...graph().processing_nodes[0]!,
          model_type: 'agentic',
          system_access_scope: ['shared_infrastructure'],
          multi_instance_coordination: 'yes',
        },
      ],
    });
    rerender(<UnderstoodSummary graph={agentGraph} onChangeAnswer={vi.fn()} />);
    expect(screen.getByText(/what it can reach by itself/i)).toBeInTheDocument();
    expect(screen.getByText(/whether copies of it work together/i)).toBeInTheDocument();
  });
});

describe('UnderstoodSummary — assumptions (form path) vs uncertain nodes (description path), UC-9', () => {
  const ASSUMPTIONS: Assumption[] = [
    {
      questionId: '9',
      question: 'Can the mistake be caught?',
      shortLabel: 'whether a mistake can be put right',
      assumption: 'it can’t be undone — the strictest case',
      fields: ['output_reversibility'],
    },
  ];

  it('TC-R16-C-07: form path — every assumption appears under "Things we assumed because you weren’t sure"', () => {
    render(<UnderstoodSummary graph={graph()} assumptions={ASSUMPTIONS} onChangeAnswer={vi.fn()} />);
    expect(screen.getByText(/things we assumed because you weren’t sure/i)).toBeInTheDocument();
    expect(screen.getByText(/it can’t be undone — the strictest case/)).toBeInTheDocument();
    expect(screen.queryByText(/things we couldn’t tell from your description/i)).not.toBeInTheDocument();
  });

  it('TC-R16-C-08: description path — uncertain nodes appear under "Things we couldn’t tell from your description"', () => {
    render(
      <UnderstoodSummary
        graph={graph({ intake_method: 'llm' })}
        uncertainNodeIds={['p1']}
        onChangeAnswer={vi.fn()}
      />,
    );
    const section = sectionFor(/things we couldn’t tell from your description/i);
    expect(within(section).getByText(/Drafting model/)).toBeInTheDocument();
    expect(screen.queryByText(/things we assumed because you weren’t sure/i)).not.toBeInTheDocument();
  });

  it('neither heading renders when nothing was assumed or uncertain', () => {
    render(<UnderstoodSummary graph={graph()} onChangeAnswer={vi.fn()} />);
    expect(screen.queryByText(/things we assumed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/things we couldn’t tell/i)).not.toBeInTheDocument();
  });

  // R16-E §7 (D-106, DR7-24/BB-1). On the description path, the extractor's
  // own uncertain nodes and the targeted questionnaire's "Not sure"
  // assumptions are genuinely two different sources of the same fact
  // ("things we couldn't tell") — merged into ONE list, chosen by
  // `graph.intake_method`, never by which source happens to be empty.
  it('TC-R16-E-71: the description path merges BOTH the uncertain nodes and the questionnaire\'s "Not sure" assumptions into one list', () => {
    render(
      <UnderstoodSummary
        graph={graph({ intake_method: 'llm' })}
        uncertainNodeIds={['p1']}
        assumptions={ASSUMPTIONS}
        onChangeAnswer={vi.fn()}
      />,
    );
    const section = sectionFor(/things we couldn’t tell from your description/i);
    expect(within(section).getByText(/Drafting model/)).toBeInTheDocument();
    expect(within(section).getByText(/it can’t be undone — the strictest case/)).toBeInTheDocument();
    // The form-path heading never appears on this path.
    expect(screen.queryByText(/things we assumed because you weren’t sure/i)).not.toBeInTheDocument();
  });
});

// R16-F F-9 (DR7-09). The description-vs-answers plausibility check used to
// run only on the field-card screen (graph_review) — a screen the form
// path never visits. UnderstoodSummary is the one screen BOTH paths reach
// before attestation, so this is where the check now runs, under "Please
// double-check", computed purely at render from the description and the
// graph already in hand.
describe('UnderstoodSummary — plausibility cross-check, "Please double-check" (F-9, DR7-09)', () => {
  it('TC-R16-F-48: a description that contradicts the graph renders "Please double-check" with the plain-worded message', () => {
    const g = graph({
      // The default fixture's own input node is already Zone B (matches
      // the same signal) — pin it to Zone C so only the processing node
      // below fires, keeping this a single, unambiguous assertion.
      input_nodes: [{ ...graph().input_nodes[0]!, data_zone: 'Zone C' }],
      processing_nodes: [{ ...graph().processing_nodes[0]!, data_zone: 'Zone A' }],
    });
    render(
      <UnderstoodSummary
        graph={g}
        description="This runs on our firm's own internal platform."
        onChangeAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText(/please double-check/i)).toBeInTheDocument();
    expect(screen.getByText(/Check “Where does the AI come from\?”/)).toBeInTheDocument();
    // Plain words only — no zone letter, no field name, no "graph".
    const section = sectionFor(/please double-check/i);
    expect(section.textContent).not.toMatch(/Zone [ABC]|\bdata_zone\b|\bgraph\b/);
  });

  // Found in the R16-F walkthrough: the check flags each part of the case
  // separately, so a description at odds with BOTH the information and the
  // AI's location showed the identical sentence twice.
  it('TC-R16-F-65: a warning that applies to several parts of the case is shown once, not once per part', () => {
    const g = graph({
      input_nodes: [{ ...graph().input_nodes[0]!, data_zone: 'Zone A' }],
      processing_nodes: [{ ...graph().processing_nodes[0]!, data_zone: 'Zone A' }],
    });
    render(
      <UnderstoodSummary graph={g} description="This runs on our firm's own internal platform." onChangeAnswer={vi.fn()} />,
    );
    const section = sectionFor(/please double-check/i);
    expect(within(section).getAllByRole('listitem')).toHaveLength(1);
  });

  it('TC-R16-F-49: a description with no plausibility signal renders no "Please double-check" section', () => {
    render(<UnderstoodSummary graph={graph()} description="Drafts client emails for review." onChangeAnswer={vi.fn()} />);
    expect(screen.queryByText(/please double-check/i)).not.toBeInTheDocument();
  });

  it('a missing description (the default) never fires a warning — not a crash, not a false positive', () => {
    expect(() => render(<UnderstoodSummary graph={graph()} onChangeAnswer={vi.fn()} />)).not.toThrow();
    expect(screen.queryByText(/please double-check/i)).not.toBeInTheDocument();
  });
});

describe('UnderstoodSummary — destination zone attribution (F-9, DR7-09)', () => {
  it('TC-R16-F-50: an explicit 3platformZone answer attributes the destination line to what the submitter told it', () => {
    const g = graph({ processing_nodes: [{ ...graph().processing_nodes[0]!, data_zone: 'Zone C' }] });
    render(
      <UnderstoodSummary graph={g} plainAnswers={{ '3platformZone': 'firm-systems' }} onChangeAnswer={vi.fn()} />,
    );
    expect(
      screen.getByText(/Your firm’s own systems \(you told us your information stays on them\)\./),
    ).toBeInTheDocument();
  });

  it('TC-R16-F-51: no plainAnswers (the description path) never attributes the destination line', () => {
    const g = graph({ processing_nodes: [{ ...graph().processing_nodes[0]!, data_zone: 'Zone C' }] });
    render(<UnderstoodSummary graph={g} onChangeAnswer={vi.fn()} />);
    expect(screen.getByText(/your firm’s own systems/i)).toBeInTheDocument();
    expect(screen.queryByText(/you told us/i)).not.toBeInTheDocument();
  });

  it('a "Not sure" 3platformZone answer does not attribute — it is an assumption, not a stated fact', () => {
    const g = graph({ processing_nodes: [{ ...graph().processing_nodes[0]!, data_zone: 'Zone B' }] });
    render(<UnderstoodSummary graph={g} plainAnswers={{ '3platformZone': 'not-sure' }} onChangeAnswer={vi.fn()} />);
    expect(screen.queryByText(/you told us/i)).not.toBeInTheDocument();
  });
});

describe('UnderstoodSummary — "Change an answer" navigates only, no write (§3)', () => {
  it('TC-R16-C-09: calls onChangeAnswer and performs no write of its own', async () => {
    const user = userEvent.setup();
    const onChangeAnswer = vi.fn();
    render(<UnderstoodSummary graph={graph()} onChangeAnswer={onChangeAnswer} />);
    await user.click(screen.getByRole('button', { name: /change an answer/i }));
    expect(onChangeAnswer).toHaveBeenCalledTimes(1);
  });
});

describe('UnderstoodSummary — the details grid stays collapsed (§3)', () => {
  it('TC-R16-C-10: "Show the details the rules use" holds the existing graphSummaryRows grid', () => {
    render(<UnderstoodSummary graph={graph()} onChangeAnswer={vi.fn()} />);
    expect(screen.getByText(/show the details the rules use/i)).toBeInTheDocument();
    // graphSummaryRows() content is present in the DOM (collapsed <details>
    // still renders its children — same pattern VerdictDisplay's Fold uses).
    expect(screen.getByText(/Client notes/)).toBeInTheDocument();
  });
});

describe('UnderstoodSummary — reserved words (CLAUDE.md)', () => {
  it('renders neither "approved" nor "rejected" anywhere', () => {
    render(
      <UnderstoodSummary
        graph={graph()}
        assumptions={ASSUMPTIONS_FOR_RESERVED_TEST}
        uncertainNodeIds={['p1']}
        onChangeAnswer={vi.fn()}
      />,
    );
    expect(document.body.textContent).not.toMatch(/approved|rejected/i);
  });
});

const ASSUMPTIONS_FOR_RESERVED_TEST: Assumption[] = [
  {
    questionId: '6',
    question: 'What happens with the output?',
    shortLabel: 'what it does with what it produces',
    assumption: 'it acts entirely by itself — the strictest case',
    fields: ['action_type', 'autonomy_level', 'decision_bindingness', 'hitl'],
  },
];

describe('UnderstoodSummary — handles a sparse/hand-built graph without crashing', () => {
  it('a graph with no processing or output node renders without throwing', () => {
    expect(() =>
      render(
        <UnderstoodSummary
          graph={{ ...graph(), processing_nodes: [], output_nodes: [], input_nodes: [] }}
          onChangeAnswer={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });
});

// R16-E review pass 2 / verification: on the description path the summary's
// "Please double-check" names the card from the ONE shared table (it used to
// re-type the three titles) and says why, not only where to look.
describe('UnderstoodSummary — the description path\'s double-check says why and names the shared card', () => {
  it('TC-R16-E-80: a description at odds with what we read gives the reason and the card from GRAPH_REVIEW_CARD_TITLES', async () => {
    const { GRAPH_REVIEW_CARD_TITLES } = await import('../plain-copy');
    const g = graph({
      intake_method: 'llm',
      input_nodes: [{ ...graph().input_nodes[0]!, data_zone: 'Zone C' }],
      processing_nodes: [{ ...graph().processing_nodes[0]!, data_zone: 'Zone A' }],
    });
    render(<UnderstoodSummary graph={g} description="This runs on our firm's own internal platform." onChangeAnswer={vi.fn()} />);
    const section = sectionFor(/please double-check/i);
    expect(section.textContent).toContain('we read that your information goes outside the firm');
    expect(section.textContent).toContain(`on the card “${GRAPH_REVIEW_CARD_TITLES.processing}”`);
  });
});
