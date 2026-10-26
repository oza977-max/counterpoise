import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuestionnaireStep from '../QuestionnaireStep';
import type { IntakeQuestion, PolicyFile } from '../../engine/types';

// R16-E §2/§3 (D-101, D-102, DR7-24/26/28/29/31). The targeted-questionnaire
// screen now speaks QUESTIONNAIRE_COPY throughout: multi-select tick-all,
// a generic "Not sure" control, the decision-type/vendor/model follow-ups,
// labelled "Recorded:" line, the triggering rule's own plain_reason as
// "why we ask", and per-question focus.

function minimalPolicy(overrides: Partial<PolicyFile> = {}): PolicyFile {
  return {
    version: '1',
    policy_id: 'P',
    firm_name: 'Test',
    translation_attestation: { attested_by: 'x', role: 'x', date: '2026-01-01', raf_version_checked: 'x' },
    hard_lines: [],
    tracks: [],
    tiers: [],
    invariants: [],
    controls: [],
    kri_thresholds: {},
    jurisdictions: [],
    roles: {},
    tier_workflow: { Critical: 'x', High: 'x', Medium: 'x', Low: 'x' },
    safety_margin: 0,
    ...overrides,
  };
}

function question(overrides: Partial<IntakeQuestion> = {}): IntakeQuestion {
  return { id: 'Q1', field: 'data_class', node_id: 'n1', triggered_by: [], answer_type: 'select', ...overrides };
}

describe('QuestionnaireStep — multi-select (R16-E §3, D-101)', () => {
  it('TC-R16-E-26: renders a fieldset with a legend, one label per option, and Done disabled until something is ticked', () => {
    render(
      <QuestionnaireStep
        questions={[question({ field: 'system_access_scope', answer_type: 'multi_select' })]}
        answeredCount={0}
        onAnswer={vi.fn()}
      />,
    );
    const group = screen.getByRole('group', { name: /what it can get into by itself/i });
    expect(within(group).getByRole('checkbox', { name: /nothing beyond what it.s given for the task/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^done$/i })).toBeDisabled();
  });

  it('TC-R16-E-27: ticking two kinds then Done submits both — canonical ORDERING is normaliseAccessScope\'s job downstream (coerceAnswerValue), proved end to end in IntakeFlow.r16e.test.tsx', async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(
      <QuestionnaireStep
        questions={[question({ field: 'system_access_scope', answer_type: 'multi_select' })]}
        answeredCount={0}
        onAnswer={onAnswer}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: /it can change software or settings, or deploy updates, without a person/i }));
    await user.click(screen.getByRole('checkbox', { name: /it has its own logins, passwords or access tokens for other systems/i }));
    await user.click(screen.getByRole('button', { name: /^done$/i }));
    const call = onAnswer.mock.calls[0]!;
    expect(call[0]).toBe('Q1');
    expect([...call[1]].sort()).toEqual(['credentialed_systems', 'deployment_authority']);
    expect(call[3]).toBe(false);
  });

  it('TC-R16-E-27b: ticking "Nothing beyond…" clears any other tick, same exclusivity as the form\'s Q13', async () => {
    const user = userEvent.setup();
    render(
      <QuestionnaireStep
        questions={[question({ field: 'system_access_scope', answer_type: 'multi_select' })]}
        answeredCount={0}
        onAnswer={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: /it runs on computers or servers shared with other automated tools/i }));
    await user.click(screen.getByRole('checkbox', { name: /nothing beyond what it.s given for the task/i }));
    expect(screen.getByRole('checkbox', { name: /it runs on computers or servers shared with other automated tools/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /nothing beyond what it.s given for the task/i })).toBeChecked();
  });

  // R18-G (forward note 2026-10-24): the guards of this control that were asserted only downstream, through the
  // retired card review, are asserted here on the control itself.
  describe('the control\'s own guards (R18-G)', () => {
    const renderScope = () => {
      const onAnswer = vi.fn();
      render(<QuestionnaireStep questions={[question({ field: 'system_access_scope', answer_type: 'multi_select' })]} answeredCount={0} onAnswer={onAnswer} />);
      return onAnswer;
    };
    const none = () => screen.getByRole('checkbox', { name: /nothing beyond what it.s given for the task/i });
    const shared = () => screen.getByRole('checkbox', { name: /it runs on computers or servers shared with other automated tools/i });

    it('"Nothing beyond..." is exclusive in BOTH directions: ticking another kind clears it', async () => {
      const user = userEvent.setup();
      renderScope();
      await user.click(none());
      expect(none()).toBeChecked();
      await user.click(shared());
      expect(shared()).toBeChecked();
      expect(none()).not.toBeChecked();
      // and ticking it again clears the other, so the two are never ticked together
      await user.click(none());
      expect(none()).toBeChecked();
      expect(shared()).not.toBeChecked();
      // unticking "Nothing beyond..." itself leaves nothing ticked
      await user.click(none());
      expect(none()).not.toBeChecked();
    });

    it('clicking an option\'s words ticks that option, and only that one', async () => {
      const user = userEvent.setup();
      renderScope();
      await user.click(screen.getByText(/it has its own logins, passwords or access tokens for other systems/i));
      expect(screen.getByRole('checkbox', { name: /it has its own logins, passwords or access tokens for other systems/i })).toBeChecked();
      expect(screen.getAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked)).toHaveLength(1);
    });

    it('unticking the last ticked option shuts Done again, so nothing empty can be submitted', async () => {
      const user = userEvent.setup();
      const onAnswer = renderScope();
      await user.click(shared());
      expect(screen.getByRole('button', { name: /^done$/i })).toBeEnabled();
      await user.click(shared());
      expect(screen.getByRole('button', { name: /^done$/i })).toBeDisabled();
      expect(onAnswer).not.toHaveBeenCalled();
    });
  });

  it('TC-R16-E-28: a multi-select question also offers "Not sure", submitting the strictest array directly (no ticking required)', async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(
      <QuestionnaireStep
        questions={[question({ field: 'system_access_scope', answer_type: 'multi_select' })]}
        answeredCount={0}
        onAnswer={onAnswer}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^not sure$/i }));
    expect(onAnswer).toHaveBeenCalledWith(
      'Q1',
      ['shared_infrastructure', 'credentialed_systems', 'deployment_authority'],
      undefined,
      true,
    );
  });
});

describe('QuestionnaireStep — generic "Not sure" (R16-E §3)', () => {
  it('TC-R16-E-29: a select-type field offers "Not sure", submitting QUESTIONNAIRE_COPY\'s stricter value with notSure=true', async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(<QuestionnaireStep questions={[question({ field: 'data_class' })]} answeredCount={0} onAnswer={onAnswer} />);
    await user.click(screen.getByRole('button', { name: /^not sure$/i }));
    expect(onAnswer).toHaveBeenCalledWith('Q1', 'Confidential', undefined, true);
  });

  it('TC-R16-E-29b: a boolean-type field also offers "Not sure"', async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(
      <QuestionnaireStep questions={[question({ field: 'hitl', answer_type: 'boolean' })]} answeredCount={0} onAnswer={onAnswer} />,
    );
    await user.click(screen.getByRole('button', { name: /^not sure$/i }));
    expect(onAnswer).toHaveBeenCalledWith('Q1', false, undefined, true);
  });

  it('TC-R16-E-29c: decision_type and scale offer no "Not sure" button at all — the form has none either', () => {
    render(<QuestionnaireStep questions={[question({ field: 'decision_type' })]} answeredCount={0} onAnswer={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^not sure$/i })).not.toBeInTheDocument();
  });
});

describe('QuestionnaireStep — decision_type "Something else" (R16-E §2, DR7-29)', () => {
  it('TC-R16-E-30: offers "Something else — describe it" alongside the real options, excluding lending-decision', () => {
    render(<QuestionnaireStep questions={[question({ field: 'decision_type' })]} answeredCount={0} onAnswer={vi.fn()} />);
    expect(screen.getByRole('button', { name: /something else — describe it/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^lending-decision$/i })).not.toBeInTheDocument();
  });
});

describe('QuestionnaireStep — vendor/declared_model_id (R16-E §2, DR7-28)', () => {
  const policy = minimalPolicy({
    vendors: [
      { id: 'VENDOR-A', name: 'raw', approved_envelope: {}, satisfies_controls: [], plain_name: 'Acme Supplier', kind: 'supplier' },
    ],
    approved_models: [
      { model_id: 'gpt-4o', vendor: 'VENDOR-A', provenance_class: 'vendor_hosted', is_approved: true },
    ],
  });

  it('TC-R16-E-31: vendor renders the firm\'s registered supplier plus "Not on this list" and "I don\'t know"', () => {
    render(
      <QuestionnaireStep questions={[question({ field: 'vendor', answer_type: 'text' })]} answeredCount={0} onAnswer={vi.fn()} policy={policy} />,
    );
    expect(screen.getByRole('button', { name: /^acme supplier$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^not on this list$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^i don.t know$/i })).toBeInTheDocument();
    // Never a free-text box for the primary vendor question (D-06: never
    // matched from typed text).
    expect(screen.queryByRole('textbox', { name: /your answer/i })).not.toBeInTheDocument();
  });

  it('TC-R16-E-31b: declared_model_id renders the firm\'s approved model plus its own two fixed choices', () => {
    render(
      <QuestionnaireStep
        questions={[question({ field: 'declared_model_id', answer_type: 'text' })]}
        answeredCount={0}
        onAnswer={vi.fn()}
        policy={policy}
      />,
    );
    // CR7-35: an unnamed listed model shows a neutral label, never its id.
    expect(screen.getByRole('button', { name: /^Model 1$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^not on the list$/i })).toBeInTheDocument();
  });

  it('TC-R16-E-31c: vendor_name (the "Not on this list" follow-up) is optional free text — Submit is enabled even blank', () => {
    render(
      <QuestionnaireStep questions={[question({ field: 'vendor_name', answer_type: 'text' })]} answeredCount={0} onAnswer={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /submit answer/i })).toBeEnabled();
  });
});

describe('QuestionnaireStep — "Recorded:" shows labels, never the raw value (BC-4)', () => {
  it('TC-R16-E-32: a scalar answer\'s recorded line shows the option LABEL', () => {
    render(
      <QuestionnaireStep
        questions={[question({ id: 'Q1', field: 'data_class' }), question({ id: 'Q2', field: 'data_zone' })]}
        answeredCount={1}
        lastAnswer={{ questionId: 'Q1', value: 'Client PII' }}
        onAnswer={vi.fn()}
      />,
    );
    const recorded = screen.getByText(/^recorded:/i).closest('p')!;
    expect(recorded).toHaveTextContent('Information about people');
    expect(recorded).not.toHaveTextContent('Client PII');
  });

  it('TC-R16-E-33: a multi-select answer\'s recorded line joins labels "a, b and c"', () => {
    render(
      <QuestionnaireStep
        questions={[
          question({ id: 'Q1', field: 'system_access_scope', answer_type: 'multi_select' }),
          question({ id: 'Q2', field: 'data_zone' }),
        ]}
        answeredCount={1}
        lastAnswer={{ questionId: 'Q1', value: ['shared_infrastructure', 'credentialed_systems'] }}
        onAnswer={vi.fn()}
      />,
    );
    const recorded = screen.getByText(/^recorded:/i).closest('p')!;
    expect(recorded).toHaveTextContent(
      'It runs on computers or servers shared with other automated tools and It has its own logins, passwords or access tokens for other systems',
    );
  });
});

describe('QuestionnaireStep — the guessed-field intro and the context label (R16-E §3)', () => {
  it('TC-R16-E-34: a guessed-field question introduces itself with the exact sentence', () => {
    render(
      <QuestionnaireStep
        questions={[question({ triggered_by: ['R6-PV-2:guessed'] })]}
        answeredCount={0}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText('We couldn’t tell this from your description:')).toBeInTheDocument();
  });

  it('TC-R16-E-36: the per-answer context label names "your AI risk team", not "the reviewer" (F1B-6)', () => {
    render(<QuestionnaireStep questions={[question()]} answeredCount={0} onAnswer={vi.fn()} />);
    expect(screen.getByLabelText(/anything your ai risk team should know about this answer\? \(optional\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/anything the reviewer should know/i)).not.toBeInTheDocument();
  });

  it('TC-R16-E-37: the progress line never mentions a budget or a tier', () => {
    render(<QuestionnaireStep questions={[question()]} answeredCount={0} onAnswer={vi.fn()} />);
    expect(screen.getByText(/question 1 of 1/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/budget|provisional tier/i);
  });
});

describe('QuestionnaireStep — "why we ask" names the triggering rule\'s own plain_reason (R16-E §3)', () => {
  it('TC-R16-E-35: a rule with a plain_reason renders "Why we ask:", placeholders resolved', () => {
    const policy = minimalPolicy({
      invariants: [
        { id: 'INV-1', description: 'd', condition: {}, required_controls: [], severity: 'High', plain_reason: 'it sends personal details about people to {destination}' },
      ],
    });
    render(
      <QuestionnaireStep
        questions={[question({ triggered_by: ['INV-1'] })]}
        answeredCount={0}
        onAnswer={vi.fn()}
        policy={policy}
      />,
    );
    expect(screen.getByText(/why we ask:/i)).toBeInTheDocument();
    expect(screen.getByText(/it sends personal details about people to/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\{destination\}/);
  });

  it('TC-R16-E-35b: a rule with no plain_reason, or no triggering rule at all, renders no "why we ask" line', () => {
    const policy = minimalPolicy({ invariants: [{ id: 'INV-1', description: 'd', condition: {}, required_controls: [], severity: 'High' }] });
    render(
      <QuestionnaireStep questions={[question({ triggered_by: ['INV-1'] })]} answeredCount={0} onAnswer={vi.fn()} policy={policy} />,
    );
    expect(screen.queryByText(/why we ask:/i)).not.toBeInTheDocument();
  });

  it('TC-R16-E-35c: a purely guessed question (no real rule) renders no "why we ask" line either', () => {
    render(
      <QuestionnaireStep questions={[question({ triggered_by: ['R6-PV-2:guessed'] })]} answeredCount={0} onAnswer={vi.fn()} />,
    );
    expect(screen.queryByText(/why we ask:/i)).not.toBeInTheDocument();
  });
});

describe('QuestionnaireStep — per-question focus (R16-E §3)', () => {
  it('TC-R16-E-38: answering a question moves focus to the next question\'s own heading', async () => {
    const user = userEvent.setup();
    const questions = [question({ id: 'Q1', field: 'data_class', answer_type: 'boolean' }), question({ id: 'Q2', field: 'data_zone', answer_type: 'boolean' })];
    const { rerender } = render(
      <QuestionnaireStep questions={questions} answeredCount={0} onAnswer={vi.fn()} />,
    );
    expect(document.activeElement).not.toBe(screen.getByText(/what.s the most sensitive information it will see or use/i));
    rerender(<QuestionnaireStep questions={questions} answeredCount={1} onAnswer={vi.fn()} />);
    expect(screen.getByText(/where will your information go/i)).toHaveFocus();
    void user;
  });

  // R16-E review pass 1: the "We couldn't tell this…" intro sat in its own
  // paragraph outside the focused one, so a screen reader landing on the new
  // question could miss why it was being asked.
  it('TC-R16-E-77: when focus moves to a question the description did not answer, the focused element includes "We couldn’t tell this from your description"', () => {
    const questions = [
      question({ id: 'Q1', field: 'data_class', answer_type: 'boolean' }),
      question({ id: 'Q2', field: 'data_zone', answer_type: 'boolean', triggered_by: ['R6-PV-2:guessed'] }),
    ];
    const { rerender } = render(<QuestionnaireStep questions={questions} answeredCount={0} onAnswer={vi.fn()} />);
    rerender(<QuestionnaireStep questions={questions} answeredCount={1} onAnswer={vi.fn()} />);
    const focused = document.activeElement as HTMLElement;
    expect(focused.textContent).toMatch(/we couldn.t tell this from your description/i);
    expect(focused.textContent).toMatch(/where will your information go/i);
  });
});

// §8's guard test (the machine version of principle 1 for this screen):
// render QuestionnaireStep with one question per field and assert none of
// the banned words appear.
describe('QuestionnaireStep — guard: no engine vocabulary reaches this screen (§8)', () => {
  const BANNED = /\bZone A\b|\bZone B\b|\bZone C\b|\bdata_class\b|\bDATA_ZONE\b|\bautonomy\b|\bLLM\b|\bHITL\b|\bbinding\b|\bgraph\b|\bextract\w*|model proposed|\bguess(?:ed|ing)\b|local model|\bunregistered\b|parse-error|no-key/i;

  it('TC-R16-E-39: every closed-vocabulary field\'s question renders with no banned word', () => {
    const fields = [
      'data_class',
      'data_zone',
      'model_type',
      'action_type',
      'autonomy_level',
      'hitl',
      'decision_bindingness',
      'exposure',
      'decision_type',
      'output_reversibility',
      'scale',
      'replaces_prior_model',
      'multi_instance_coordination',
      'vendor',
      'declared_model_id',
    ];
    for (const field of fields) {
      const { unmount, container } = render(
        <QuestionnaireStep questions={[question({ field })]} answeredCount={0} onAnswer={vi.fn()} />,
      );
      expect(container.textContent, `field "${field}" rendered banned vocabulary`).not.toMatch(BANNED);
      unmount();
    }
  });

  it('TC-R16-E-39b: the multi-select screen (system_access_scope) renders with no banned word', () => {
    const { container } = render(
      <QuestionnaireStep
        questions={[question({ field: 'system_access_scope', answer_type: 'multi_select' })]}
        answeredCount={0}
        onAnswer={vi.fn()}
      />,
    );
    expect(container.textContent).not.toMatch(BANNED);
  });
});

// Found in the R16-E walkthrough: the note above the questions still read
// "All 1 are asked because your description did not state them — the model
// would otherwise be guessing. A short description rarely states every field
// a local model this size can verify…" — broken for one question, and machine
// talk the guard's whole-word list did not catch.
describe('QuestionnaireStep — the question-count note speaks plainly', () => {
  it('TC-R16-E-75: one question asked because the description did not say reads "This is asked because your description didn’t say." — no "All 1", no model talk', () => {
    const { container } = render(
      <QuestionnaireStep questions={[question({ triggered_by: ['R6-PV-2:guessed'] })]} answeredCount={0} onAnswer={vi.fn()} />,
    );
    const note = container.querySelector('.questionnaire__count-note')!;
    expect(note.textContent).toContain('This is asked because your description didn’t say.');
    expect(note.textContent).not.toMatch(/All 1\b|\bmodel\b|guessing|verify/i);
  });

  it('TC-R16-E-75b: a mix of rule questions and "didn’t say" questions counts each, in plain words', () => {
    const { container } = render(
      <QuestionnaireStep
        questions={[
          question({ id: 'a', triggered_by: ['INV-X'] }),
          question({ id: 'b', triggered_by: ['R6-PV-2:guessed'] }),
          question({ id: 'c', triggered_by: ['R6-PV-2:guessed'] }),
        ]}
        answeredCount={0}
        onAnswer={vi.fn()}
      />,
    );
    expect(container.querySelector('.questionnaire__count-note')!.textContent).toContain(
      '1 of these is because of your firm’s rules, and 2 because your description didn’t say.',
    );
  });
});

// R16-E review pass 3: the "Recorded:" line fell back to a supplier's
// registry id when the firm had given it no plain name — while the button the
// person clicked showed a safe numbered label.
describe('QuestionnaireStep — the Recorded line names a supplier the way its button did', () => {
  it('TC-R16-E-82: a registered supplier with no plain name is recorded as its button label ("Supplier 1"), never its id', () => {
    const policy = minimalPolicy({
      vendors: [{ id: 'VENDOR-NO-PLAIN-NAME', name: '[FIRM] supplier', approved_envelope: {}, satisfies_controls: [], kind: 'supplier' }],
    } as unknown as Partial<PolicyFile>);
    const questions = [
      question({ id: 'qv', field: 'vendor', answer_type: 'text' }),
      question({ id: 'q2', field: 'data_zone', answer_type: 'select' }),
    ];
    const { container } = render(
      <QuestionnaireStep
        questions={questions}
        answeredCount={1}
        onAnswer={vi.fn()}
        lastAnswer={{ questionId: 'qv', value: 'VENDOR-NO-PLAIN-NAME' } as never}
        policy={policy}
      />,
    );
    const recorded = container.querySelector('.questionnaire__recorded')!;
    expect(recorded.textContent).toContain('Supplier 1');
    expect(recorded.textContent).not.toContain('VENDOR-NO-PLAIN-NAME');
  });
});
