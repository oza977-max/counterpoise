import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import App from '../../App';
import { loadPolicy } from '../../store/policy';
import { buildGraphFromForm } from '../../engine/build-graph-from-form';
import { plainAnswersToFormValues } from '../../engine/plain-intake';
import { WORKED_EXAMPLES } from '../../engine/worked-examples';
import { R18_COPY } from '../plain-copy';
import type { DataFlowGraph } from '../../engine/types';

// TC-R18-NF-5-01/-02/-03/-04 at screen level: whatever is stored, the app opens
// on the form with the description kept, says why once, and never throws.

const D = 'It reads client names and account details.';
let graph: DataFlowGraph;
beforeAll(() => {
  const res = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
  if (!res.valid) throw new Error('policy invalid');
  const answers = { ...WORKED_EXAMPLES[0]!.answers, '2': D };
  graph = buildGraphFromForm(plainAnswersToFormValues(answers, res.policy).values, '2026-10-01T00:00:00.000Z', () => 'n');
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const put = (raw: unknown) => sessionStorage.setItem('aigate:intake-draft', typeof raw === 'string' ? raw : JSON.stringify(raw));
const noticeEl = () => screen.queryByText(R18_COPY.EARLIER_VERSION_NOTICE);

describe('earlier drafts open on the form (TC-R18-NF-5-01)', () => {
  const answers = { ...WORKED_EXAMPLES[0]!.answers, '2': D };
  it.each([
    ['version 1 questionnaire', () => ({ step: 'questionnaire', description: D, graph: { ...graph, intake_method: 'llm' }, questions: [], answers: [], resolutionNotes: [], corrections: [], useCaseId: 'u' })],
    ['version 2 card review', () => ({ version: 2, state: { step: 'graph_review', description: D, graph: { ...graph, intake_method: 'llm' }, graphVersion: 1, corrections: [], useCaseId: 'u' } })],
    ['version 3 confirmation with form answers', () => ({ version: 3, state: { step: 'confirmation', description: D, graph, graphVersion: 1, corrections: [], answers: [], resolutionNotes: [], useCaseId: 'u', plainAnswers: answers, assumptions: [], afterFailedEvaluation: false } })],
    ['version 3 model-path extraction', () => ({ version: 3, state: { step: 'graph_extraction', description: D, method: 'llm' } })],
    ['version 3 form step with answers', () => ({ version: 3, state: { step: 'graph_extraction', description: D, method: 'form', useCaseId: 'u', plainAnswers: answers } })],
  ])('TC-R18-NF-5-01: %s shows the form, the description and one earlier-version sentence, with no answers', (_n, make) => {
    put(make());
    render(<App />);
    expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue(D);
    expect(noticeEl()).toHaveAttribute('role', 'status');
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByLabelText(/what do you want to call it/i)).toHaveValue('');
    expect(screen.queryByText(/check what we read from your description/i)).not.toBeInTheDocument();
  });

  it('TC-R18-NF-5-01: the sentence is shown once - after a reload it is gone', () => {
    put({ version: 3, state: { step: 'confirmation', description: D, graph, graphVersion: 1, corrections: [], answers: [], resolutionNotes: [], useCaseId: 'u', afterFailedEvaluation: false } });
    const first = render(<App />);
    expect(noticeEl()).toBeInTheDocument();
    first.unmount();
    render(<App />);
    expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue(D);
    expect(noticeEl()).not.toBeInTheDocument();
  });
});

describe('damaged drafts still open (TC-R18-NF-5-02, TC-R18-NF-5-04)', () => {
  it.each([
    ['a description that is a number', { version: 3, state: { step: 'graph_extraction', description: 7, method: 'form' } }, ''],
    ['no description', { version: 3, state: { step: 'confirmation' } }, ''],
    ['version 99', { version: 99, state: { step: 'confirmation', description: D } }, D],
    ['truncated JSON', '{"version":3,"sta', ''],
    ['an array', '[1,2]', ''],
  ])('TC-R18-NF-5-02: %s opens the form, blank where unusable, with the sentence and no raw error', (_n, raw, want) => {
    put(raw);
    render(<App />);
    expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue(want);
    expect(noticeEl()).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/undefined|SyntaxError|TypeError/);
  });

  it('TC-R18-NF-5-04: a hostile form draft (wrong types, __proto__) is ignored and the form is blank', () => {
    put({ version: 3, state: { step: 'confirmation', description: D } });
    sessionStorage.setItem('aigate:intake-form-draft:v4', '{"version":4,"answerState":{"__proto__":{"value":"x"},"4":{"value":"Gigantic","source":{"kind":"typed"}}},"lastRead":{"fingerprint":"","outcome":"not-read"}}');
    render(<App />);
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(({} as Record<string, unknown>).value).toBeUndefined();
  });
});
