import { useEffect, useRef, useState } from 'react';
import { loadPolicy } from '../store/policy';
import { getCurrentPolicyYaml } from '../store/policy-source';
import { getPackSources, loadPackSet } from '../store/pack-source';
import { appendTestResult, MODEL_SETTING_CHANGED_EVENT, MODEL_SETTING_KEY } from '../llm/model-setting';
import { loadCorpus, runModelTest, CORPUS_CASE_COUNT } from '../llm/model-test';
import { buildCatalogue, QUESTION_STRUCTURE, structureFor } from '../engine/question-structure';
import type { ModelTestResult } from '../engine/prefill-types';
import { startCaseBudget } from './model-test-budget';
import {
  QUESTION_WORDS,
  R18_COPY,
  findQuestion,
  testDiscardedWords,
  testNoAnswerWords,
  testProgressWords,
  testQuestionWords,
  testResultWords,
  testAnswersWords,
  testStoppedWords,
} from './plain-copy';
import { useModelSetting } from './useModelSetting';
import { originOf } from '../llm/model-setting';

// R18-F (specs/intake-flow.md §27.11). "Test it" in Settings: the saved model reads the 31 public worked
// cases through the same reading call and verifier a real pre-check uses, and the screen says how often its
// fills would have reached the right verdict and the right answer per question. Presentation and timers only:
// the run is src/llm/model-test.ts, the scoring is src/engine/question-fields.ts. It shows progress, stops on
// request, and saves the result (newest first) where the model's label reads it.
//
// One run at a time, guarded by a synchronous ref (a state update lands too late to stop a double press).
// A run is abandoned, not saved, if the person leaves Settings; it is stopped (and saved as stopped) if the
// model setting changes under it.

export default function ModelTestSection() {
  const snapshot = useModelSetting();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [failedToStart, setFailedToStart] = useState(false);
  const inFlight = useRef(false);
  const stopController = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopController.current?.abort('leave');
    };
  }, []);

  const saved = snapshot.state.kind === 'valid' ? snapshot.state.setting : null;
  const savedHost = saved ? originOf(saved.url) : null;
  const latest: ModelTestResult | undefined =
    saved && savedHost !== null
      ? snapshot.results.find((r) => r.model === saved.model && r.place === saved.place && r.host === savedHost)
      : undefined;

  async function handleTest() {
    if (inFlight.current) return; // a second press while a run is going starts nothing
    if (!saved) return;
    inFlight.current = true;
    const policyResult = loadPolicy(getCurrentPolicyYaml());
    const corpus = loadCorpus();
    const packSet = loadPackSet(getPackSources());
    if (!policyResult.valid || !corpus || corpus.cases.length !== CORPUS_CASE_COUNT || packSet.messages.length > 0) {
      setFailedToStart(true);
      inFlight.current = false;
      return;
    }
    setFailedToStart(false);
    const policy = policyResult.policy;
    const stop = new AbortController();
    stopController.current = stop;
    // The saved setting is the one this run uses; a change to it stops the run.
    const onChanged = () => stop.abort('setting-changed');
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === MODEL_SETTING_KEY) stop.abort('setting-changed');
    };
    window.addEventListener(MODEL_SETTING_CHANGED_EVENT, onChanged);
    window.addEventListener('storage', onStorage);
    setRunning(true);
    setProgress(null);
    try {
      const result = await runModelTest({
        setting: { ...saved },
        corpus,
        catalogue: buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy),
        policy,
        packs: packSet.packs,
        stop: stop.signal,
        caseBudget: startCaseBudget,
        date: new Date().toISOString().slice(0, 10),
        onProgress: (n) => {
          if (mounted.current) setProgress(n);
        },
      });
      // Our own save announces a change; stop listening first so it cannot read as the setting changing.
      window.removeEventListener(MODEL_SETTING_CHANGED_EVENT, onChanged);
      window.removeEventListener('storage', onStorage);
      if (mounted.current) appendTestResult(result);
    } catch {
      if (mounted.current) setFailedToStart(true);
    } finally {
      window.removeEventListener(MODEL_SETTING_CHANGED_EVENT, onChanged);
      window.removeEventListener('storage', onStorage);
      stopController.current = null;
      inFlight.current = false;
      if (mounted.current) {
        setRunning(false);
        setProgress(null);
      }
    }
  }

  function handleStop() {
    stopController.current?.abort('skip');
  }

  const discardedTotal = latest ? Object.values(latest.discarded).reduce((a, b) => a + b, 0) : 0;
  const discardedWords = latest ? testDiscardedWords(discardedTotal) : null;
  const noAnswerWords = latest ? testNoAnswerWords(latest.noAnswer ?? 0) : null;

  return (
    <section aria-label={R18_COPY.TEST_BUTTON} className="model-test">
      {saved ? (
        <>
          <p>{R18_COPY.TEST_INTRO}</p>
          <button type="button" onClick={() => void handleTest()} disabled={running} aria-describedby="model-test-limit">
            {R18_COPY.TEST_BUTTON}
          </button>
          {running && (
            <button type="button" onClick={handleStop}>
              {R18_COPY.TEST_STOP}
            </button>
          )}
          <p className="field-help" id="model-test-limit">
            {R18_COPY.TEST_LIMIT}
          </p>
        </>
      ) : (
        <p>{R18_COPY.TEST_NEEDS_SETTING}</p>
      )}
      <div role="status">
        {running && progress !== null && <p>{testProgressWords(progress)}</p>}
        {failedToStart && <p>{R18_COPY.TEST_CANNOT_START}</p>}
      </div>
      {latest && !running && (
        <div className="model-test__result">
          <h4>{R18_COPY.TEST_RESULT_HEADING}</h4>
          {latest.stopped && <p>{testStoppedWords(latest.casesRun)}</p>}
          <p>{testAnswersWords(latest)}</p>
          <p>{testResultWords(latest)}</p>
          {noAnswerWords && <p>{noAnswerWords}</p>}
          {discardedWords && <p>{discardedWords}</p>}
          <h5>{R18_COPY.TEST_PER_QUESTION_HEADING}</h5>
          <ul aria-label={R18_COPY.TEST_PER_QUESTION_HEADING}>
            {QUESTION_STRUCTURE.filter((q) => latest.perQuestion[q.id] !== undefined && structureFor(q.id)).map((q) => (
              <li key={q.id}>{testQuestionWords(findQuestion(q.id)?.text ?? q.id, latest.perQuestion[q.id]!)}</li>
            ))}
          </ul>
          <p className="field-help">{R18_COPY.TEST_NOT_SCORED_NOTE}</p>
          <p>{R18_COPY.TEST_NOT_A_GUARANTEE}</p>
          <p>{R18_COPY.TEST_NOT_COMPARABLE}</p>
        </div>
      )}
    </section>
  );
}
