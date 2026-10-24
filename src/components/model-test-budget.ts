import type { CaseBudget } from '../llm/model-test';

// R18-F (specs/intake-flow.md §27.5/§27.11, cross-cutting §13c). The 60 seconds each test case gets is a
// setTimeout plus an AbortController, owned here in the component layer - never AbortSignal.timeout, which a
// fake clock cannot drive - and the run's Stop signal aborts it too. The reasons match prefill.ts's
// failureForAbort: 'timeout' reads as timed out, 'skip' as stopped by the person.

export const CASE_BUDGET_MS = 60_000;

export function startCaseBudget(stop: AbortSignal, ms: number = CASE_BUDGET_MS): CaseBudget {
  const controller = new AbortController();
  const onStop = () => controller.abort('skip');
  if (stop.aborted) controller.abort('skip');
  else stop.addEventListener('abort', onStop, { once: true });
  const timer = setTimeout(() => controller.abort('timeout'), ms);
  return {
    signal: controller.signal,
    release: () => {
      clearTimeout(timer);
      stop.removeEventListener('abort', onStop);
    },
  };
}
