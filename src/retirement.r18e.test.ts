import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import * as vocabulary from './engine/canonical-vocabulary';

// R18-E: one grep test per row of the retirement table (specs/intake-flow.md §27.10). The build removes a symbol
// only when the table says its last caller is gone, and these tests are the proof it is gone (or moved, or kept).
// This file is the only place in src that may name the retired symbols: it names them so it can look for them.
// The scan reads every source and test file as raw text, comments included, so a retired name left in a comment
// fails too (the history of what a thing used to be lives in the handovers, not in the code).

const SRC = resolve(__dirname);
const SELF = relative(SRC, __filename).split(sep).join('/');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const FILES = walk(SRC)
  .map((p) => relative(SRC, p).split(sep).join('/'))
  .filter((r) => /\.(ts|tsx|css)$/.test(r) && r !== SELF);
const text = (rel: string) => readFileSync(resolve(SRC, rel), 'utf-8');
/** The files (other than this one) whose raw text matches. */
const naming = (re: RegExp, among: readonly string[] = FILES) => among.filter((r) => re.test(text(r)));

describe('R18-E retirement table (specs/intake-flow.md §27.10), one grep test per row', () => {
  it('row 1: GraphView.tsx and the graph_review step are deleted, and nothing names them', () => {
    expect(existsSync(resolve(SRC, 'components/GraphView.tsx'))).toBe(false);
    expect(naming(/GraphView|graph_review|GraphReview/)).toEqual([]);
  });

  it('row 3: the five reducer actions and the two handlers are deleted', () => {
    expect(naming(/GRAPH_EXTRACTED|CORRECTION_APPLIED|JURISDICTIONS_CONFIRMED|JURISDICTIONS_SET|NODE_CONFIRMED/)).toEqual([]);
    expect(naming(/handleCorrectNode|handleProceedFromGraphReview/)).toEqual([]);
  });

  it('row 3 (dead with it): the actions only the retired step could take are deleted too', () => {
    // QUESTIONS_GENERATED was valid only from graph_review; SWITCH_TO_FORM only from the model route's failure screen.
    expect(naming(/QUESTIONS_GENERATED|SWITCH_TO_FORM/)).toEqual([]);
    // ... and the model route is not a method of the form step: no production intake file says so.
    expect(naming(/'llm'/, ['components/intake-state.ts', 'components/intake-draft.ts', 'components/IntakeFlow.tsx'])).toEqual([]);
  });

  it('row 4: the five state fields are gone from the intake state, its draft and its screen', () => {
    const own = ['components/intake-state.ts', 'components/intake-draft.ts', 'components/IntakeFlow.tsx', 'components/StepTracker.tsx', 'components/ConfirmationStep.tsx'];
    expect(naming(/\bprovenance\b|guessedFields|unconfirmedNodeIds|jurisdictionsConfirmed|backGraph/, own)).toEqual([]);
  });

  it('row 5: the CORRECT_VERDICT fallback to the card review and the STEP_BACK to it are deleted', () => {
    expect(naming(/'CORRECT_VERDICT'(?!_)/)).toEqual([]);
    expect(naming(/case 'graph_review'/)).toEqual([]);
  });

  it('row 6: StepTracker, ConfirmationStep and the draft loader are updated to the form landing', () => {
    expect(naming(/graph_review/, ['components/StepTracker.tsx', 'components/ConfirmationStep.tsx', 'components/intake-draft.ts'])).toEqual([]);
    expect(naming(/migrateOldQuestionnaire|migratedFromOldBuild/)).toEqual([]);
  });

  it('row 7: the About paragraph names no model, does not promise "never leaves", and no longer describes the review screen', () => {
    const about = text('components/AboutPanel.tsx');
    expect(about).not.toMatch(/Qwen|open model|never leaves|provenance quotes|guessed-field|review screen/i);
    expect(about).toMatch(/R18_COPY\.ABOUT_/);
  });

  it('row 8: QUOTE_FIELDS and AGENT_REACH_FIELDS live in engine/canonical-vocabulary.ts and both importing tests read them there', () => {
    expect(vocabulary.QUOTE_FIELDS.input).toContain('data_class');
    expect(vocabulary.QUOTE_FIELDS.processing).toContain('vendor');
    expect(vocabulary.QUOTE_FIELDS.output).toContain('hitl');
    expect([...vocabulary.AGENT_REACH_FIELDS]).toEqual(['system_access_scope', 'multi_instance_coordination']);
    expect(naming(/export const (QUOTE_FIELDS|AGENT_REACH_FIELDS)/)).toEqual(['engine/canonical-vocabulary.ts']);
    for (const t of ['components/plain-copy.test.ts', 'store/assumption-fields.test.ts']) {
      expect(text(t)).toMatch(/import \{[^}]*QUOTE_FIELDS[^}]*\} from '[./]+\/engine\/canonical-vocabulary'/);
    }
  });

  it('row 9: the self-assessment seed no longer reads a local-model setting', () => {
    expect(naming(/localLlmEnabled|DEFAULT_LOCAL_LLM_MODEL/)).toEqual([]);
    expect(text('seeds/aigate-self-assessment.ts')).toContain("'none declared'");
  });

  it('row 10: graph-extractor.ts and local-provider.ts are deleted, nothing imports them, and the egress allow-list does not list them', () => {
    for (const f of ['llm/graph-extractor.ts', 'llm/local-provider.ts', 'llm/graph-extractor.test.ts', 'llm/local-provider.test.ts']) {
      expect(existsSync(resolve(SRC, f)), f).toBe(false);
    }
    expect(naming(/graph-extractor|local-provider|extractGraph|localChatJson/)).toEqual([]);
    expect(text('llm/egress.test.ts')).not.toMatch(/local-provider|graph-extractor/);
  });

  it('row 11: the files the table keeps are still there', () => {
    for (const f of [
      'engine/plausibility.ts',
      'components/graph-summary.ts',
      'components/field-copy.ts',
      'engine/question-generator.ts',
      'components/QuestionnaireStep.tsx',
    ]) {
      expect(existsSync(resolve(SRC, f)), f).toBe(true);
    }
  });
});
