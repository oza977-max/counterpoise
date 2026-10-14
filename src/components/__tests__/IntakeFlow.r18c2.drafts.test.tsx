import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../../App';
import { FORM_HEADING } from './r18c2Flow';

// R18-C2 (specs/intake-flow.md §27.7; TC-R18-NF-5-03): a form-route draft from the previous build lands on the
// form with the answers the form still offers kept (as typed) and an invalid value left as a blank question.

const D = 'It reads client names and account details.';

function graph() {
  return {
    id: 'g', version: 1, intake_method: 'structured_form', extracted_at: '2026-01-01T00:00:00.000Z', jurisdictions: [],
    input_nodes: [{ id: 'i1', label: 'notes', data_class: 'Internal', data_zone: 'Zone C' }],
    processing_nodes: [{ id: 'p1', label: 's', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false }],
    output_nodes: [{ id: 'o1', label: 'o', action_type: 'draft', exposure: 'internal-only', decision_bindingness: 'non-binding', output_reversibility: 'reversible', scale: 'limited' }],
    edges: [],
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('the landing from an earlier incompatible draft keeps the valid typed answers (TC-R18-NF-5-03)', () => {
  it('TC-R18-NF-5-03: valid answers are selected, "Gigantic" is not, and the earlier-version sentence is shown', async () => {
    sessionStorage.setItem(
      'aigate:intake-draft',
      JSON.stringify({
        version: 3,
        state: {
          step: 'confirmation', description: D, graph: graph(), graphVersion: 1, corrections: [], answers: [], resolutionNotes: [], useCaseId: 'uc-old',
          plainAnswers: { '1': 'Old tool', '2': D, '3': 'firm-built', '4': 'Gigantic', '5': ['everyday'], '10': 'wide' },
          assumptions: [],
        },
      }),
    );
    render(<App />);
    await screen.findByText(FORM_HEADING);
    expect(screen.getByLabelText(/what do you want to call it/i)).toHaveValue('Old tool');
    expect(screen.getByRole('radio', { name: /something a team in your firm built for this job/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /everyday work information/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^several teams, the whole business/i })).toBeChecked();
    // nothing came back confirmed or pre-filled: no mark, no tick
    expect(screen.queryByText(/from your description/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /yes, this is right/i })).not.toBeInTheDocument();
    // the invalid value is a blank question: nothing selected there, and the word is nowhere
    expect(document.body.textContent).not.toMatch(/Gigantic/);
    expect(screen.getByText(/saved by an earlier version of counterpoise/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled();
  });
});
