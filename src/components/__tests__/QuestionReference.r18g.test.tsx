import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import StructuredForm from '../StructuredForm';
import { PLAIN_QUESTIONS, QUESTIONNAIRE_COPY, findQuestion } from '../plain-copy';
import { loadPolicy } from '../../store/policy';
import { shownQuestionIds } from '../../engine/form-visibility';
import { structureFor } from '../../engine/question-structure';
import type { PolicyFile } from '../../engine/types';

// Newcomer test round 2 (2026-10-26, owner-approved). The help under "What kind of AI is it?" pointed to "question 6",
// and the questions carry no numbers on screen, so five of six testers could not find it. It now names the question by
// its own words. The sentence is true only if that question is on the same form, in every state (TC-R18-GI-13-01n11).

const SENTENCE =
  "Different kinds of AI go wrong in different ways. (Whether it acts by itself is asked separately, under 'What happens with what it produces'.)";
const TITLE = 'What happens with what it produces';

let policy: PolicyFile;
beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  policy = r.policy;
});
beforeEach(() => sessionStorage.clear());

describe('TC-R18-GI-13-01n11: the "what kind of AI" help names the question it points to, by its words', () => {
  it('the help of the form question reads as written, in both copies of the question', () => {
    expect(findQuestion('4')!.help).toBe(SENTENCE);
    expect(QUESTIONNAIRE_COPY['model_type']!.help).toBe(SENTENCE);
  });

  it('the words it points to are the real beginning of the question about what it does with its output (form and questionnaire)', () => {
    expect(findQuestion('6')!.text.startsWith(`${TITLE}?`)).toBe(true);
    expect(QUESTIONNAIRE_COPY['action_type']!.question).toBe(`${TITLE}?`);
  });

  it('(false state) no question or help in either copy points to a question by its number', () => {
    const strings: string[] = [];
    for (const q of PLAIN_QUESTIONS) strings.push(q.text, q.help ?? '', ...q.options.map((o) => o.text));
    for (const c of Object.values(QUESTIONNAIRE_COPY)) strings.push(c.question, c.help ?? '', c.shortLabel);
    expect(strings.filter((s) => /\bquestions? \d+\b/i.test(s))).toEqual([]);
    expect(strings.filter((s) => /question 6/i.test(s))).toEqual([]);
  });

  it('the question it points to is on the form whatever has been answered: it has no condition, so it is never hidden', () => {
    expect(structureFor('6')!.shownWhen).toBeUndefined();
    expect(structureFor('4')!.shownWhen).toBeUndefined();
    for (const answers of [{}, { '4': 'score' }, { '4': 'agent' }, { '6': 'acts-alone' }, { '3': 'outside-assistant' }] as never[]) {
      const shown = shownQuestionIds(answers, policy);
      expect(shown).toContain('4');
      expect(shown).toContain('6');
    }
  });

  it('on the rendered form the help and the question it names are both on screen', () => {
    render(<StructuredForm policy={policy} onSubmit={() => undefined} />);
    expect(screen.getByText(SENTENCE)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`^${TITLE}\\?`))).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bquestion \d/i);
  });

  it('the sentence carries no verdict word', () => {
    expect(SENTENCE).not.toMatch(/approved|rejected/i);
  });
});
