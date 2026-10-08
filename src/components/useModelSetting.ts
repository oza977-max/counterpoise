import { useEffect, useState } from 'react';
import { getApiKey } from '../llm/client';
import {
  MODEL_SETTING_CHANGED_EVENT,
  modelSettingState,
  readTestResults,
} from '../llm/model-setting';
import type { ModelSettingState } from '../llm/model-setting';
import type { ModelTestResult } from '../engine/prefill-types';

// R18-B. The model setting as a screen sees it: the stored state, whether an Anthropic key
// is stored, and the saved test results. Read from storage after mount (so a screen can render
// its status region empty first and fill it, which screen readers announce), and read again
// on the in-page change event (browsers fire no `storage` event inside the writing document,
// §27.5) and on the `storage` event (another tab). Presentation glue only: every rule lives in
// src/llm/model-setting.ts.

export interface ModelSnapshot {
  /** False until the first read after mount. */
  ready: boolean;
  state: ModelSettingState;
  keyStored: boolean;
  results: ModelTestResult[];
}

const EMPTY: ModelSnapshot = { ready: false, state: { kind: 'none' }, keyStored: false, results: [] };

export function useModelSetting(): ModelSnapshot {
  const [snapshot, setSnapshot] = useState<ModelSnapshot>(EMPTY);
  useEffect(() => {
    const refresh = () =>
      setSnapshot({ ready: true, state: modelSettingState(), keyStored: getApiKey() !== null, results: readTestResults() });
    refresh();
    window.addEventListener(MODEL_SETTING_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(MODEL_SETTING_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return snapshot;
}
