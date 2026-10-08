import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StructuredForm from '../StructuredForm';
import type { PolicyFile } from '../../engine/types';
import type { PlainAnswers } from '../plain-copy';
import { loadFormDraft, updateFormDraft } from '../intake-draft';
import { R18_COPY } from '../plain-copy';

// Several questions share a short option word ("Yes"/"No"/"Not sure") on
// this continuous-scroll form, where every question is in the DOM at once
// (§2.2: "one continuous scroll"). Ambiguous role queries are scoped to the
// right fieldset via its legend; the fieldset gets an accessible "group"
// name from the legend for free. A draft left in sessionStorage by one test
// must never leak into the next (StructuredForm restores from it on mount).
beforeEach(() => {
  sessionStorage.clear();
});

function radioIn(groupName: RegExp, optionName: RegExp) {
  return within(screen.getByRole('radiogroup', { name: groupName })).getByRole('radio', { name: optionName });
}

// R16-B (build/prompts/R16.md v2.1 §2.2). Replaces the field-by-field form
// entirely — UC-3a's requirements/requirements.md amendment (2026-10-02)
// retires that shape. What survives, named explicitly there, is tested
// below under the ORIGINAL ids (TC-UC-3a-01/02/03): the form works with no
// API key, produces the same DataFlowGraph shape, and records
// structured_form intake. Everything the old suite tested that depended on
// the retired field-by-field shape (canonical-vocabulary dropdown values,
// the five-fieldset legend text, the old field-specific help copy, the
// three-state jurisdiction/draft migration mechanics) is moved to a
// `## Superseded` section in test-cases.md / test-cases-003.md /
// test-cases-015.md with its reason — never silently dropped.

function policy(overrides: Partial<PolicyFile> = {}): PolicyFile {
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
    ...overrides,
  };
}

/** The minimal path through every BASE required question (1-12) with no
 *  conditional follow-up triggered — Q3 "firm-built" skips 3a/3supplier/
 *  3model's visibility, Q4 "language" skips 4a/13/14, Q6 "read" skips
 *  6a/6b, Q8 "operational" skips 8other. Conditional-follow-up
 *  requiredness is covered by its own dedicated tests below rather than
 *  folded into this probe. */
async function fillBase(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/what do you want to call it/i), 'Test tool');
  await user.type(screen.getByLabelText(/in a sentence or two/i), 'A test description.');
  await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
  await user.click(
    screen.getByRole('radio', { name: /reads, summarises, translates, writes or answers questions in words/i }),
  );
  await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
  await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
  await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
  await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
  await user.click(radioIn(/if it gets something wrong/i, /^yes$/i));
  await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
  await user.click(screen.getByRole('checkbox', { name: /somewhere else, or not sure/i }));
  await user.click(radioIn(/does it replace something/i, /^no$/i));
}

describe('StructuredForm — the replacement form (UC-3a survives: no API key, same graph shape, structured_form intake)', () => {
  it('TC-UC-3a-01: produces a valid DataFlowGraph with one node per category', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<StructuredForm policy={policy()} onSubmit={onSubmit} />);
    await fillBase(user);
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [graph, assumptions] = onSubmit.mock.calls[0]!;
    expect(graph.input_nodes).toHaveLength(1);
    expect(graph.processing_nodes).toHaveLength(1);
    expect(graph.output_nodes).toHaveLength(1);
    expect(graph.input_nodes[0].data_class).toBe('Internal');
    expect(graph.processing_nodes[0].model_type).toBe('llm');
    expect(Array.isArray(assumptions)).toBe(true);
  });

  it('TC-UC-3a-02: sets intake_method to structured_form', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<StructuredForm policy={policy()} onSubmit={onSubmit} />);
    await fillBase(user);
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(onSubmit.mock.calls[0]![0].intake_method).toBe('structured_form');
  });

  it('TC-UC-3a-03: Continue is disabled until every required question is answered', async () => {
    const user = userEvent.setup();
    render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    await fillBase(user);
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('no API key is needed anywhere on this path — the form never imports or calls the LLM boundary', async () => {
    // Structural guarantee: StructuredForm's only engine imports are
    // plain-intake and build-graph-from-form, both pure and API-free; this
    // is asserted at the module level by cross-cutting.md §7 Rule 1/2, and
    // behaviourally by the WalkingSkeleton no-api-key suite.
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<StructuredForm policy={policy()} onSubmit={onSubmit} />);
    await fillBase(user);
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(onSubmit).toHaveBeenCalled();
  });
});

// CR6-06 (Critical, StructuredForm.tsx half): isAnswered used to count a
// single-select answer the moment it held any non-empty string, regardless
// of whether that string was still one of the question's CURRENT options.
// A stale stored answer (a saved draft from before a registry entry was
// renamed, or an option an older build offered) could reach Continue as if
// it had been read and confirmed, when the submitter never saw or picked
// the value now sitting there.
describe('StructuredForm — CR6-06 (a stale single-select answer reads as unanswered)', () => {
  const INITIAL_ANSWERS: PlainAnswers = {
    '1': 'Test tool',
    '2': 'A test description.',
    '3': 'firm-built',
    '4': 'language',
    '5': ['everyday'],
    '6': 'read',
    '7': 'me-or-team',
    '8': 'operational',
    '9': 'some-removed-option', // stale — not one of yes/no/not-sure
    '10': 'small',
    '11': ['elsewhere-not-sure'],
    '12': 'no',
  };

  it('TC-CR6-06d: a stale stored answer leaves Continue disabled until the question is re-picked', async () => {
    const user = userEvent.setup();
    render(<StructuredForm policy={policy()} initialDescription="A test description." initialAnswers={INITIAL_ANSWERS} onSubmit={vi.fn()} />);

    // Every OTHER required question is answered validly — only Q9 carries a
    // value outside its current option set — so this isolates the bug: the
    // old isAnswered counted ANY non-empty string, enabling Continue despite
    // the stale Q9 value never having been picked from the rendered options.
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();

    await user.click(radioIn(/if it gets something wrong/i, /can.t be taken back/i));
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('TC-CR6-06e: a stale stored multi-select tick (Q5) leaves Continue disabled until re-picked', async () => {
    const user = userEvent.setup();
    render(
      <StructuredForm
        policy={policy()}
        initialDescription="A test description."
        initialAnswers={{ ...INITIAL_ANSWERS, '9': 'yes', '5': ['old-key'] }}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    const group = screen.getByRole('group', { name: /information/i });
    await user.click(within(group).getAllByRole('checkbox')[0]!);
    // Re-picking from what is on screen drops the stale key and answers it.
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('a stale stored answer is not pre-selected on any of the question\'s rendered options', () => {
    render(<StructuredForm policy={policy()} initialAnswers={INITIAL_ANSWERS} onSubmit={vi.fn()} />);
    const group = screen.getByRole('radiogroup', { name: /if it gets something wrong/i });
    for (const radio of within(group).getAllByRole('radio')) {
      expect(radio).not.toBeChecked();
    }
  });
});

describe('StructuredForm — no engine vocabulary on the first screen (principle 1, UC-8 fit criterion 1)', () => {
  it('TC-R16-B-08: no question or option renders a bare engine term or code', () => {
    render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    const text = document.body.textContent ?? '';
    for (const banned of ['Zone A', 'Zone B', 'Zone C', 'MNPI', 'autonomy', 'bindingness', 'Track I', 'Track II', 'Track III']) {
      expect(text).not.toContain(banned);
    }
    // "LLM", "agentic" etc. as bare category names must not appear either —
    // the kind-of-AI question describes situations, not model-type labels.
    expect(screen.queryByText(/^LLM$/)).not.toBeInTheDocument();
  });

  it('never renders the bare [FIRM] placeholder', () => {
    render(
      <StructuredForm
        policy={policy({
          platforms: [{ id: 'PLAT-X', name: '[FIRM] internal platform', approved_envelope: {}, satisfies_controls: [] }],
        })}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByText(/\[FIRM\]/)).not.toBeInTheDocument();
  });
});

describe('StructuredForm — never-render-[FIRM] fallback labels (D-23)', () => {
  it('TC-R16-B-12: a platform with no plain_name shows "Your firm’s AI service {n}", not its raw registry name', () => {
    render(
      <StructuredForm
        policy={policy({
          platforms: [{ id: 'PLAT-X', name: '[FIRM] internal platform', approved_envelope: {}, satisfies_controls: [] }],
        })}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: /your firm.s ai service 1/i })).toBeInTheDocument();
  });

  it('a supplier with no plain_name shows "Supplier {n}"', async () => {
    const user = userEvent.setup();
    render(
      <StructuredForm
        policy={policy({
          vendors: [{ id: 'VEND-X', name: '[FIRM] vendor', approved_envelope: {}, satisfies_controls: [], kind: 'supplier' }],
        })}
        onSubmit={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole('radio', {
        name: /a product your firm is buying from a specialist supplier/i,
      }),
    );
    expect(screen.getByRole('radio', { name: /^supplier 1$/i })).toBeInTheDocument();
  });
});

describe('StructuredForm — conditional follow-ups (§2.2 Details)', () => {
  it('TC-R16-B-09: Q3a appears only for "outside-assistant", and its answer is cleared when Q3 changes away', async () => {
    const user = userEvent.setup();
    render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('radio', { name: /a free or personal account/i })).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('radio', { name: /an ai assistant or website run by an outside company/i }),
    );
    expect(screen.getByRole('radio', { name: /a free or personal account/i })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /a free or personal account/i }));

    // Switching Q3 away removes Q3a from the DOM entirely.
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    expect(screen.queryByRole('radio', { name: /a free or personal account/i })).not.toBeInTheDocument();
  });

  it('TC-R16-B-10: Q13/Q14 appear for the agentic option and for Q4 "Not sure", and nowhere else', async () => {
    const user = userEvent.setup();
    render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    expect(screen.queryByText(/what can it get into by itself/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /an ai agent that works through tasks on its own/i }));
    expect(screen.getByText(/what can it get into by itself/i)).toBeInTheDocument();
    expect(screen.getByText(/can copies of it, or other ai agents, pass work/i)).toBeInTheDocument();

    await user.click(
      screen.getByRole('radio', { name: /reads, summarises, translates, writes or answers questions in words/i }),
    );
    expect(screen.queryByText(/what can it get into by itself/i)).not.toBeInTheDocument();

    const q4NotSure = screen.getAllByRole('radio', { name: /^not sure$/i })[0]!;
    await user.click(q4NotSure);
    expect(screen.getByText(/what can it get into by itself/i)).toBeInTheDocument();
  });

  it('TC-R16-B-11: Q13 "Nothing beyond..." is exclusive with the other ticks, and vice versa', async () => {
    const user = userEvent.setup();
    render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: /an ai agent that works through tasks on its own/i }));

    const none = screen.getByRole('checkbox', { name: /nothing beyond what it’s given for the task/i });
    const credentialed = screen.getByRole('checkbox', { name: /its own logins, passwords or access tokens/i });

    await user.click(credentialed);
    expect(credentialed).toBeChecked();
    await user.click(none);
    expect(none).toBeChecked();
    expect(credentialed).not.toBeChecked();

    await user.click(credentialed);
    expect(credentialed).toBeChecked();
    expect(none).not.toBeChecked();
  });

  // F-8 (DR7-08). The real UI's own exclusivity (above) never lets a
  // submitter construct "none" + another kind — this is the "mismatched
  // SAVED answer" DR7-08 describes: a draft restored from a point before
  // this exclusivity existed, or otherwise hand-edited. Before this fix,
  // the required check counted raw ticks and this would have silently
  // read as "answered"; now it is routed through the same single checker
  // (resolveAccessScopeAnswer / normaliseAccessScope) the mapping itself
  // uses, and refused.
  it('TC-R16-F-39: a mismatched saved Q13 answer ("none" + another kind) is refused as a validation message, never silently read as answered', () => {
    const BASE_ANSWERS: PlainAnswers = {
      '1': 'Test tool', '2': 'A test description.', '3': 'firm-built', '4': 'agentic',
      '5': ['everyday'], '6': 'read', '7': 'me-or-team', '8': 'operational', '9': 'yes',
      '10': 'small', '11': ['elsewhere-not-sure'], '12': 'no', '14': 'no',
    };
    render(
      <StructuredForm
        policy={policy()}
        initialAnswers={{ ...BASE_ANSWERS, '13': ['none', 'shared'] }}
        onSubmit={vi.fn()}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/goes on its own/i);
    // Plain words — never the engine's reason, which names the internal field.
    expect(alert).not.toHaveTextContent(/system_access_scope/);
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  // Found verifying R16-F: ticking then unticking every Q13 box showed the
  // engine's "system_access_scope must have at least one value" as an alert.
  // Nothing ticked is just "not answered yet" — the required marker says so.
  it('TC-R16-F-62: unticking every Q13 box shows no alert — it is simply not answered yet', async () => {
    const BASE_ANSWERS: PlainAnswers = {
      '1': 'Test tool', '2': 'A test description.', '3': 'firm-built', '4': 'agentic',
      '5': ['everyday'], '6': 'read', '7': 'me-or-team', '8': 'operational', '9': 'yes',
      '10': 'small', '11': ['elsewhere-not-sure'], '12': 'no', '14': 'no',
    };
    const user = userEvent.setup();
    render(<StructuredForm policy={policy()} initialDescription="A test description." initialAnswers={{ ...BASE_ANSWERS, '13': ['credentialed'] }} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();

    await user.click(screen.getByRole('checkbox', { name: /its own logins, passwords or access tokens/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('TC-R16-B-15: Q8 "Something else" requires the free-text description before Continue enables', async () => {
    const user = userEvent.setup();
    render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    await fillBase(user);
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();

    await user.click(screen.getByRole('radio', { name: /something else — describe it/i }));
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();

    await user.type(screen.getByLabelText(/what kind of decision is it/i), 'Collections prioritisation');
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });
});

describe('StructuredForm — jurisdictions (tick-all), adapted from R3-JU-1', () => {
  async function fillExceptJurisdiction(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/what do you want to call it/i), 'Test tool');
    await user.type(screen.getByLabelText(/in a sentence or two/i), 'A test description.');
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    await user.click(
      screen.getByRole('radio', { name: /reads, summarises, translates, writes or answers questions in words/i }),
    );
    await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
    await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
    await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
    await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
    await user.click(radioIn(/if it gets something wrong/i, /^yes$/i));
    await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
    await user.click(radioIn(/does it replace something/i, /^no$/i));
  }

  it('TC-R3-JU-1-01: an untouched jurisdiction question blocks progress; ticking one unblocks it', async () => {
    const user = userEvent.setup();
    render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    await fillExceptJurisdiction(user);
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /united kingdom/i }));
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('TC-R3-JU-1-02: "Somewhere else, or not sure" submits an empty jurisdictions array', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<StructuredForm policy={policy()} onSubmit={onSubmit} />);
    await fillExceptJurisdiction(user);
    await user.click(screen.getByRole('checkbox', { name: /somewhere else, or not sure/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(onSubmit.mock.calls[0]![0].jurisdictions).toEqual([]);
  });

  it('TC-R3-JU-1-03: ticking a real jurisdiction unblocks progress', async () => {
    const user = userEvent.setup();
    render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    await fillExceptJurisdiction(user);
    await user.click(screen.getByRole('checkbox', { name: /united kingdom/i }));
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });
});

describe('StructuredForm — required-field markers (adapted from R3-JU-5)', () => {
  it('TC-R3-JU-5-01: every BASE question that blocks progress carries both a visible marker and aria-required (narrowed to the 12 unconditional base questions — each conditional follow-up’s own requiredness is covered by its dedicated test above)', async () => {
    const user = userEvent.setup();
    const { container } = render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    await fillBase(user);
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
    const markers = container.querySelectorAll('.required-marker');
    expect(markers.length).toBeGreaterThanOrEqual(12);
    // CR6-07: aria-required now sits where the role supports it — on each
    // radiogroup (7 base single-selects), with the two base tick-all groups
    // (Q5, Q11) saying so in their legend, and on the 2 free-text controls.
    const requiredRadiogroups = container.querySelectorAll('[role="radiogroup"][aria-required="true"]');
    expect(requiredRadiogroups.length).toBeGreaterThanOrEqual(7);
    const tickLegends = [...container.querySelectorAll('legend')].filter((l) => /tick at least one/i.test(l.textContent ?? ''));
    expect(tickLegends.length).toBeGreaterThanOrEqual(2);
    const requiredFreeText = container.querySelectorAll('input[aria-required="true"][required], textarea[aria-required="true"][required]');
    expect(requiredFreeText.length).toBeGreaterThanOrEqual(2);
  });

  it('TC-R3-JU-5-02: optional fields (3supplierName, 3model) carry neither signal', async () => {
    const user = userEvent.setup();
    const { container } = render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    await user.click(
      screen.getByRole('radio', { name: /a product your firm is buying from a specialist supplier/i }),
    );
    const modelInput = screen.getByLabelText(/model name, if you know it/i);
    expect(modelInput).not.toHaveAttribute('aria-required');
    expect(container.querySelector('[data-required-marker-for="pf-3model"]')).toBeNull();
  });
});

describe('StructuredForm — W-1: question 2 pre-fill (R16-W §1, D-67)', () => {
  it('TC-R16-W-09: initialDescription pre-fills question 2 when it has no draft/initialAnswers value yet', () => {
    render(<StructuredForm policy={policy()} initialDescription="Drafts client emails." onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue('Drafts client emails.');
  });

  it('TC-R16-W-10: editing question 2 is what is carried forward — a later edit is not overwritten by initialDescription on re-render', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <StructuredForm policy={policy()} initialDescription="Original description." onSubmit={vi.fn()} />,
    );
    const q2 = screen.getByLabelText(/in a sentence or two/i);
    await user.clear(q2);
    await user.type(q2, 'Edited description.');
    rerender(<StructuredForm policy={policy()} initialDescription="Original description." onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue('Edited description.');
  });

  // R18-A (specs/intake-flow.md §27.6): TC-R16-W-11 pinned the precedence of a stored
  // question-2 answer over the first screen's text. Question 2 is no longer a stored
  // answer - it is the editor of THE description - so there is nothing to take
  // precedence (superseded; the rules below replace it).
  it('R18-A: with a description prop, question 2 shows it, every edit is reported, and the form keeps no copy of its own', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    const { rerender } = render(
      <StructuredForm policy={policy()} description="From the describe screen." onDescriptionChange={(d) => seen.push(d)} onSubmit={vi.fn()} />,
    );
    const q2 = screen.getByLabelText(/in a sentence or two/i);
    expect(q2).toHaveValue('From the describe screen.');
    await user.type(q2, '!');
    // controlled: the text changes only when the owner passes a new description
    expect(seen).toEqual(['From the describe screen.!']);
    expect(q2).toHaveValue('From the describe screen.');
    rerender(<StructuredForm policy={policy()} description="Changed by the owner." onDescriptionChange={(d) => seen.push(d)} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue('Changed by the owner.');
  });

  it('R18-A: question 2 is never written to the form draft (the description lives in one place)', async () => {
    const user = userEvent.setup();
    render(<StructuredForm policy={policy()} initialDescription="x" onSubmit={vi.fn()} />);
    await user.type(screen.getByLabelText(/in a sentence or two/i), ' zzmarker');
    await user.type(screen.getByLabelText(/what do you want to call it/i), 'Tool');
    const draft = loadFormDraft()!;
    expect(Object.keys(draft.answerState)).toEqual(['1']);
    expect(JSON.stringify(draft)).not.toContain('zzmarker');
  });
});

describe('StructuredForm — W-2: one introduction (R16-W §1, D-68)', () => {
  it('TC-R16-W-12: the retired "Guided intake — answer the fields below…" paragraph is gone; the approved intro is followed by the new sentence', () => {
    render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    expect(screen.queryByText(/guided intake — answer the fields below/i)).not.toBeInTheDocument();
    expect(screen.getByText(/new pre-check — tell us about the ai you want to use/i)).toBeInTheDocument();
    expect(
      screen.getByText(/no ai reads your answers or makes the decision, so the same answers always get the same result/i),
    ).toBeInTheDocument();
  });
});

describe('StructuredForm — W-4: initialAnswers reopens the form filled in (R16-W §1, D-70)', () => {
  it('TC-R16-W-13: initialAnswers pre-fills the form when there is no in-progress draft', () => {
    render(
      <StructuredForm
        policy={policy()}
        initialAnswers={{ '1': 'Carried-over name', '3': 'firm-built' }}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/what do you want to call it/i)).toHaveValue('Carried-over name');
    expect(screen.getByRole('radio', { name: /something a team in your firm built for this job/i })).toBeChecked();
  });

  it('TC-R16-W-14: an in-progress draft wins over initialAnswers (strictly newer information)', () => {
    updateFormDraft({ answerState: { '1': { value: 'Draft name', source: { kind: 'typed' } } } });
    render(
      <StructuredForm policy={policy()} initialAnswers={{ '1': 'Stale carried-over name' }} onSubmit={vi.fn()} />,
    );
    expect(screen.getByLabelText(/what do you want to call it/i)).toHaveValue('Draft name');
    sessionStorage.clear();
  });
});

describe('StructuredForm — W-9: the platform-zone follow-up (R16-W §1, D-79)', () => {
  it('TC-R16-W-15: shown only for a platform allowed in more than one zone, with the required marker', async () => {
    const user = userEvent.setup();
    render(
      <StructuredForm
        policy={policy({
          platforms: [
            {
              id: 'PLAT-MULTI',
              name: 'Multi',
              approved_envelope: { data_zones: ['Zone B', 'Zone C'] },
              satisfies_controls: [],
              plain_name: 'Multi-zone platform',
            },
            {
              id: 'PLAT-SINGLE',
              name: 'Single',
              approved_envelope: { data_zones: ['Zone B'] },
              satisfies_controls: [],
              plain_name: 'Single-zone platform',
            },
          ],
        })}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByText(/does your information stay on your firm.s own systems/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /single-zone platform/i }));
    expect(screen.queryByText(/does your information stay on your firm.s own systems/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /multi-zone platform/i }));
    expect(screen.getByText(/does your information stay on your firm.s own systems/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('TC-R16-W-16: only the zones the platform allows are offered, plus "Not sure"', async () => {
    const user = userEvent.setup();
    render(
      <StructuredForm
        policy={policy({
          platforms: [
            {
              id: 'PLAT-MULTI',
              name: 'Multi',
              approved_envelope: { data_zones: ['Zone B', 'Zone C'] },
              satisfies_controls: [],
              plain_name: 'Multi-zone platform',
            },
          ],
        })}
        onSubmit={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('radio', { name: /multi-zone platform/i }));
    const group = screen.getByRole('radiogroup', { name: /does your information stay on your firm.s own systems/i });
    expect(within(group).getByRole('radio', { name: /the platform runs the AI on the firm.s own systems/i })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: /the platform passes it to an outside supplier/i })).toBeInTheDocument();
    expect(within(group).queryByRole('radio', { name: /it goes out to a public website or service/i })).not.toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: /^not sure$/i })).toBeInTheDocument();
  });

  it('TC-R16-W-17: switching Q3 away clears the follow-up answer and removes it from the DOM', async () => {
    const user = userEvent.setup();
    render(
      <StructuredForm
        policy={policy({
          platforms: [
            {
              id: 'PLAT-MULTI',
              name: 'Multi',
              approved_envelope: { data_zones: ['Zone B', 'Zone C'] },
              satisfies_controls: [],
              plain_name: 'Multi-zone platform',
            },
          ],
        })}
        onSubmit={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('radio', { name: /multi-zone platform/i }));
    await user.click(screen.getByRole('radio', { name: /the platform runs the AI on the firm.s own systems/i }));
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    expect(screen.queryByText(/does your information stay on your firm.s own systems/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /multi-zone platform/i }));
    expect(
      screen.getAllByRole('radio', { name: /the platform runs the AI on the firm.s own systems|the platform passes it to an outside supplier|^not sure$/i }).every((r) => !(r as HTMLInputElement).checked),
    ).toBe(true);
  });
});

describe('StructuredForm — draft persistence under the new versioned key (R16-B, D-41)', () => {
  it('TC-R16-B-14: round-trips answers across a remount', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    await user.type(screen.getByLabelText(/what do you want to call it/i), 'Persisted name');
    unmount();

    render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/what do you want to call it/i)).toHaveValue('Persisted name');
    sessionStorage.clear();
  });

  it('TC-R16-B-13: a draft under the pre-R16 key is reported once and cannot block the fresh form', () => {
    sessionStorage.setItem('aigate:intake-form-draft', JSON.stringify({ useCaseName: 'Old shape' }));
    render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    expect(
      screen.getByText(/your saved draft was from an older version of this form and couldn’t be reused/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/what do you want to call it/i)).toHaveValue('');
    sessionStorage.clear();
  });
});

// CR7-04 (main loop, at the FX7-1/FX7-3 merge). The form and the engine must
// agree on when "Model name, if you know it" is on screen: the engine reads a
// 3model answer only when q3ShowsModelQuestion says the question was asked, so
// a form that showed it under a different rule would either lose a typed name
// or keep a hidden one. One rule, pinned for every static Q3 option.
describe('StructuredForm — CR7-04: one rule for the model question', () => {
  it('TC-CR7-04e: for every Q3 option, the model question is on screen exactly when the engine would read it', async () => {
    const { PLAIN_QUESTIONS } = await import('../plain-copy');
    const { q3ShowsModelQuestion } = await import('../../engine/plain-intake');
    const q3 = PLAIN_QUESTIONS.find((q) => q.id === '3')!;
    expect(q3.options.length).toBeGreaterThan(0);
    for (const option of q3.options) {
      const user = userEvent.setup();
      const { unmount } = render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
      await user.click(screen.getByRole('radio', { name: option.text }));
      const shown = screen.queryByLabelText(/model name, if you know it/i) !== null;
      expect({ key: option.key, shown }).toEqual({ key: option.key, shown: q3ShowsModelQuestion({ '3': option.key }) });
      unmount();
    }
  });
});

describe('StructuredForm - R18-A: one answer state with a typed source on every answer (specs/intake-flow.md 27.6, 27.7)', () => {
  it('every answer the person gives is written to the form draft as a typed answer, through updateFormDraft', async () => {
    const user = userEvent.setup();
    render(<StructuredForm policy={policy()} onSubmit={vi.fn()} />);
    await user.type(screen.getByLabelText(/what do you want to call it/i), 'Ticket tool');
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
    await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
    const draft = loadFormDraft()!;
    expect(draft.version).toBe(4);
    expect(draft.answerState['1']).toEqual({ value: 'Ticket tool', source: { kind: 'typed' } });
    expect(draft.answerState['3']).toEqual({ value: 'firm-built', source: { kind: 'typed' } });
    expect(draft.answerState['5']).toEqual({ value: ['everyday'], source: { kind: 'typed' } });
    expect(draft.lastRead).toEqual({ fingerprint: '', outcome: 'not-read' });
  });

  it('Continue hands the answer state (typed sources) and the description to the owner', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<StructuredForm policy={policy()} initialDescription="A test description." onSubmit={onSubmit} />);
    await fillBaseWithoutDescription(user);
    await user.click(screen.getByRole('button', { name: /continue/i }));
    const [, , answerState, description] = onSubmit.mock.calls[0]!;
    expect(description).toBe('A test description.');
    expect(answerState['3']).toEqual({ value: 'firm-built', source: { kind: 'typed' } });
    expect(Object.values(answerState as Record<string, { source: { kind: string } }>).every((a) => a.source.kind === 'typed')).toBe(true);
    expect('2' in answerState).toBe(false);
  });

  it('TC-R18-NF-5-03: a draft answer that is not one of the question\'s options ("Gigantic") shows as a blank question needing an answer', () => {
    updateFormDraft({
      answerState: {
        '4': { value: 'Gigantic', source: { kind: 'typed' } },
        '9': { value: 'Gigantic', source: { kind: 'typed' } },
        '5': { value: ['Gigantic'], source: { kind: 'typed' } },
      },
    });
    render(<StructuredForm policy={policy()} initialDescription="d" onSubmit={vi.fn()} />);
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    for (const box of screen.getAllByRole('checkbox')) expect(box).not.toBeChecked();
    expect(screen.queryByDisplayValue('Gigantic')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
    expect(screen.getByText(/still to answer/i)).toBeInTheDocument();
  });

  it('TC-R18-NF-5-01: an earlier-version landing shows the one sentence, role=status, and an earlier form-draft key does not add a second', () => {
    sessionStorage.setItem('aigate:intake-form-draft:v2', '{"1":"old"}');
    sessionStorage.setItem('aigate:intake-form-draft', '{"values":{}}');
    render(<StructuredForm policy={policy()} initialDescription="d" earlierVersionNotice onSubmit={vi.fn()} />);
    const notice = screen.getByText(R18_COPY.EARLIER_VERSION_NOTICE);
    expect(notice).toHaveAttribute('role', 'status');
    expect(screen.queryByText(/older version of this form/i)).not.toBeInTheDocument();
    expect(sessionStorage.getItem('aigate:intake-form-draft:v2')).toBeNull();
    expect(sessionStorage.getItem('aigate:intake-form-draft')).toBeNull();
  });

  it('no notice at all on an ordinary form', () => {
    render(<StructuredForm policy={policy()} initialDescription="d" onSubmit={vi.fn()} />);
    expect(screen.queryByText(R18_COPY.EARLIER_VERSION_NOTICE)).not.toBeInTheDocument();
  });

  it('an earlier form-draft key found alone still gets its own sentence (R16-B), and it is removed', () => {
    sessionStorage.setItem('aigate:intake-form-draft:v2', '{"1":"old"}');
    render(<StructuredForm policy={policy()} initialDescription="d" onSubmit={vi.fn()} />);
    expect(screen.getByText(/older version of this form/i)).toHaveAttribute('role', 'status');
    expect(screen.queryByText(R18_COPY.EARLIER_VERSION_NOTICE)).not.toBeInTheDocument();
    expect(sessionStorage.getItem('aigate:intake-form-draft:v2')).toBeNull();
  });
});

/** fillBase minus the description: the description is the owner's here. */
async function fillBaseWithoutDescription(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/what do you want to call it/i), 'Test tool');
  await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
  await user.click(screen.getByRole('radio', { name: /reads, summarises, translates, writes or answers questions in words/i }));
  await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
  await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
  await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
  await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
  await user.click(radioIn(/if it gets something wrong/i, /^yes$/i));
  await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
  await user.click(screen.getByRole('checkbox', { name: /somewhere else, or not sure/i }));
  await user.click(radioIn(/does it replace something/i, /^no$/i));
}
