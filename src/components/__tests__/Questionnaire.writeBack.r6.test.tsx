import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import * as questionGeneratorModule from '../../engine/question-generator';
import { getAllForExport } from '../../store/audit';
import { fillText } from './fillText';
import { answerExampleOne, describeToForm } from './r18aFlow';
import { questionsForGuessedFields } from '../../engine/question-generator';
import { intakeReducer } from '../intake-state';
import type { IntakeState } from '../intake-state';
import type { DataFlowGraph } from '../../engine/types';

// Round 6 — answers write back (requirements-006, intake-flow.md §16, ADR-IF-R6-3).
// R18-E: the quote-verification and card-review halves of this file went with the retired
// description-reading route; what stays is the question generator's guessed-field questions,
// the reducer's write-back of an answer, and the form-route end-to-end test.

const DESCRIPTION = 'Trains an open source model on internal credit risk data for risk analysts, replacing no prior model.';

describe('R6-QN-1 — guessed fields become questions, and answers write back', () => {
  function makeGraph(): DataFlowGraph {
    return {
      id: 'g1',
      version: 1,
      intake_method: 'llm',
      extracted_at: '2026-01-01T00:00:00.000Z',
      input_nodes: [{ id: 'i1', label: 'credit risk data', data_class: 'Client PII', data_zone: 'Zone A' }],
      processing_nodes: [],
      output_nodes: [],
      edges: [],
      jurisdictions: [],
    };
  }

  it('TC-R6-QN-1-01: a guessed data_zone produces a data_zone question with canonical options; quoted fields produce none', () => {
    const qs = questionsForGuessedFields({ i1: ['data_zone'] }, makeGraph());
    expect(qs).toHaveLength(1);
    expect(qs[0]!.field).toBe('data_zone');
    expect(qs[0]!.node_id).toBe('i1');
    expect(qs[0]!.options).toContain('Zone C');
    expect(qs[0]!.triggered_by).toContain('R6-PV-2:guessed');
  });

  it('TC-R6-QN-1-02 (ADR-IF-R6-3): an answer differing from the graph applies as a correction on the questionnaire state', () => {
    const graph = makeGraph();
    const state: IntakeState = {
      step: 'questionnaire',
      description: 'd',
      graph,
      questions: [],
      answers: [],
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
    };
    const updated = { ...graph, version: 2, input_nodes: [{ ...graph.input_nodes[0]!, data_zone: 'Zone C' as const }] };
    const next = intakeReducer(state, {
      type: 'ANSWER_SUBMITTED',
      answer: { questionId: 'Q-data_zone-i1', value: 'Zone C' },
      correction: {
        correction_id: 'c1',
        graph_version_before: 1,
        graph_version_after: 2,
        node_id: 'i1',
        field: 'data_zone',
        original_value: 'Zone A',
        corrected_value: 'Zone C',
        corrected_at: '2026-01-01T00:00:00.000Z',
        corrected_by: '1LoD',
      },
      updatedGraph: updated,
    });
    expect(next.step).toBe('questionnaire');
    if (next.step !== 'questionnaire') return;
    // The engine will now see what the user answered — the defect this
    // round discovered and closed.
    expect(next.graph.input_nodes[0]!.data_zone).toBe('Zone C');
    expect(next.corrections).toHaveLength(1);
  });
});

describe('R6 — flow level: a question asked on the form route reaches the record', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // R18-A review I-7: restored from main on the form route. A form-built graph asks
  // nothing for the answers a person can give today, so the question generator is
  // made to ask the two fields the old test asked about (call-through spy; EBT
  // exception: scenario injection on one pure function). The reducer, the
  // questionnaire, the confirmation and the audit store are the real ones.
  it('TC-R6-QN-1-03: end to end — a question is asked; answering with context writes the context to graph_confirmed.answer_contexts', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await describeToForm(user, DESCRIPTION);
    await fillText(user, screen.getByLabelText(/what do you want to call it/i), 'R6 flow probe');
    await answerExampleOne(user);

    const real = questionGeneratorModule.generateQuestions;
    const spy = vi.spyOn(questionGeneratorModule, 'generateQuestions').mockImplementation((graph, policy, packs) => [
      ...real(graph, policy, packs),
      {
        id: 'Q-model_type-p',
        field: 'model_type',
        node_id: graph.processing_nodes[0]!.id,
        triggered_by: ['R6-PV-2:guessed'],
        answer_type: 'select' as const,
        options: ['llm', 'traditional-ml', 'rules-based'],
      },
      {
        id: 'Q-vendor-p',
        field: 'vendor',
        node_id: graph.processing_nodes[0]!.id,
        triggered_by: ['R6-PV-2:guessed'],
        answer_type: 'text' as const,
      },
    ]);
    try {
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
      await screen.findByText(/what kind of ai is it/i);
      await user.type(
        screen.getByLabelText(/anything your ai risk team should know about this answer/i),
        'Confirmed with the platform team.',
      );
      await user.click(screen.getByRole('button', { name: /the people who built it can show which factors drove each result/i }));
      await screen.findByText(/which supplier is it/i);
      await user.click(screen.getByRole('button', { name: /^i.*don.t know$/i }));
    } finally {
      spy.mockRestore();
    }
    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });

    const all = await getAllForExport();
    const confirmedEvent = all.find(
      (e) => e.payload.type === 'graph_confirmed' && (e.payload.answer_contexts?.length ?? 0) > 0,
    );
    expect(confirmedEvent).toBeDefined();
    if (confirmedEvent?.payload.type !== 'graph_confirmed') return;
    expect(confirmedEvent.payload.answer_contexts).toEqual(['Confirmed with the platform team.']);
    // An answer that differs from the form-built value is applied as a correction (ADR-IF-R6-3).
    expect(confirmedEvent.payload.corrections_count).toBeGreaterThanOrEqual(1);
    expect(all.find((e) => e.payload.type === 'verdict_produced')).toBeDefined();
  }, 30000);
});
