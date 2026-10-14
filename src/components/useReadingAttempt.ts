import { useCallback, useEffect, useRef, useState } from 'react';
import { requestPrefill, failureForAbort, rememberMode } from '../llm/prefill';
import { MODEL_SETTING_CHANGED_EVENT, MODEL_SETTING_KEY, originOf } from '../llm/model-setting';
import type { ModelSetting } from '../llm/model-setting';
import type { PrefillCatalogue, PrefillOutcome, ReadRecord, VerifyResult } from '../engine/prefill-types';

// R18-C1 (specs/intake-flow.md §27.5 "Time and abort", ADR-IF-R18-3). Owns ONE reading attempt at a time:
// the synchronous in-flight guard, a fresh AbortController per attempt, the 30-second budget, skip, the
// first-reason latch, the setting-change signals, and the attempt token that makes a late reply a no-op.
// Built and tested here; NOT wired into IntakeFlow until R18-C2, which calls startReading() from a handler
// only (never an effect - StrictMode-safe) and release() from Back / Start over.
//
// Presentation-only: it holds no business rule. The sentence for a failure is chosen by failureSentence()
// from the outcome's reason; the verified pre-fill is merged by the caller.

export const READING_BUDGET_MS = 30_000;

export interface ReadingInput {
  description: string;
  /** Read once from storage by the caller at the moment the person pressed the button. */
  setting: ModelSetting;
  catalogue: PrefillCatalogue;
  verify: (raw: unknown) => VerifyResult;
}

export interface ReadingAttempt {
  /** True from startReading until the attempt settles (the working indicator and skip control show). */
  reading: boolean;
  /** The settled outcome, or null while reading, before any read, and after release(). */
  outcome: PrefillOutcome | null;
  startReading: (input: ReadingInput) => void;
  /** The "Skip - I'll answer the questions myself" control. */
  skip: () => void;
  /** Back, Start over: stop everything, show nothing. */
  release: () => void;
}

interface Live {
  token: number;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  detach: () => void;
  snapshot: ReadRecord | undefined;
}

function snapshotOf(setting: ModelSetting): ReadRecord | undefined {
  const host = originOf(setting.url);
  return host === null ? undefined : { model: setting.model, place: setting.place, host };
}

export function useReadingAttempt(): ReadingAttempt {
  const [reading, setReading] = useState(false);
  const [outcome, setOutcome] = useState<PrefillOutcome | null>(null);
  // Synchronous: a state update lands too late to stop a second press or a StrictMode second call.
  const readingInFlight = useRef(false);
  const tokenRef = useRef(0);
  const live = useRef<Live | null>(null);

  /** Stops the timer, the listeners and the controller. Idempotent. */
  const clearLive = useCallback(() => {
    const l = live.current;
    if (!l) return;
    clearTimeout(l.timer);
    l.detach();
    live.current = null;
  }, []);

  const settle = useCallback(
    (token: number, result: PrefillOutcome) => {
      if (token !== tokenRef.current || live.current?.token !== token) return; // a late reply is a no-op
      clearLive();
      readingInFlight.current = false;
      setOutcome(result);
      setReading(false);
    },
    [clearLive],
  );

  const teardown = useCallback(() => {
    const l = live.current;
    if (l && !l.controller.signal.aborted) l.controller.abort('leave');
    clearLive();
    tokenRef.current += 1; // anything still in flight is now a no-op
    readingInFlight.current = false;
  }, [clearLive]);

  const release = useCallback(() => {
    teardown();
    setReading(false);
    setOutcome(null);
  }, [teardown]);

  // Unmount (and a reload) abort with 'leave' and clear the timer. No state is set here.
  useEffect(() => teardown, [teardown]);

  const startReading = useCallback(
    (input: ReadingInput) => {
      if (readingInFlight.current) return; // double press / double mount: one request
      readingInFlight.current = true;
      const token = ++tokenRef.current;
      const controller = new AbortController();
      const snapshot = snapshotOf(input.setting);

      // The first reason wins: AbortController keeps the first reason and ignores later aborts.
      const abortWith = (reason: string) => {
        if (controller.signal.aborted) return;
        controller.abort(reason);
        // Settle at once with the caller's reason; whatever the request does later is a no-op.
        settle(token, { kind: 'none', reason: failureForAbort(reason), ...(snapshot ? { snapshot } : {}) });
      };
      const onInPage = () => abortWith('setting-changed');
      const onStorage = (e: StorageEvent) => {
        if (e.key === null || e.key === MODEL_SETTING_KEY) abortWith('setting-changed');
      };
      window.addEventListener(MODEL_SETTING_CHANGED_EVENT, onInPage);
      window.addEventListener('storage', onStorage);
      const timer = setTimeout(() => abortWith('timeout'), READING_BUDGET_MS);
      live.current = {
        token,
        controller,
        timer,
        snapshot,
        detach: () => {
          window.removeEventListener(MODEL_SETTING_CHANGED_EVENT, onInPage);
          window.removeEventListener('storage', onStorage);
        },
      };
      setOutcome(null);
      setReading(true);

      void requestPrefill({
        description: input.description,
        catalogue: input.catalogue,
        setting: input.setting,
        signal: controller.signal,
        verify: input.verify,
      })
        .then((result) => {
          if (token !== tokenRef.current) return;
          // Listeners are gone before the mode is written, so our own write cannot read as a change.
          if (live.current?.token !== token) return;
          live.current.detach();
          if (result.kind === 'ok') rememberMode(input.setting, result.modeUsed);
          settle(token, result);
        })
        .catch(() => settle(token, { kind: 'none', reason: 'other', ...(snapshot ? { snapshot } : {}) }));
    },
    [clearLive, settle],
  );

  const skip = useCallback(() => {
    const l = live.current;
    if (!l || l.controller.signal.aborted) return;
    l.controller.abort('skip');
    settle(l.token, { kind: 'none', reason: failureForAbort('skip'), ...(l.snapshot ? { snapshot: l.snapshot } : {}) });
  }, [settle]);

  return { reading, outcome, startReading, skip, release };
}
