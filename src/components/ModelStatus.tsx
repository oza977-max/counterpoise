import { R18_COPY, modelLabelWords, placeSentence } from './plain-copy';
import { modelLabel } from '../llm/model-setting';
import { visibleText } from '../engine/visible-text';
import { useModelSetting } from './useModelSetting';

// R18-B, deliverable 5 (specs/intake-flow.md §27.8). The status line above the Next button
// on the description screen: where the description will go, which model reads it and how
// well that model has been tested. Presentation only: it shows a sentence only when the
// STORED setting passes every rule (a rewritten address can never sit under "It never
// leaves your computer"), and otherwise says the setting isn't valid or that no model is
// connected. The status region is always in the page and filled after the first read.

/** True when an address is plain http (the unencrypted line applies to a firm server only). */
function isPlainHttp(url: string): boolean {
  try {
    return new URL(url).protocol === 'http:';
  } catch {
    return false;
  }
}

export default function ModelStatus() {
  const { ready, state, keyStored, results } = useModelSetting();
  const setting = state.kind === 'valid' ? state.setting : null;
  const onSharedSite = typeof window !== 'undefined' && window.location.hostname.endsWith('.github.io');
  const demonstration = setting !== null && setting.place !== 'this-computer';

  return (
    <div className="model-status">
      <div role="status" className="model-status__line">
        {ready && state.kind === 'invalid' && <p>{R18_COPY.INVALID_SETTING_SENTENCE}</p>}
        {ready && (state.kind === 'none' || state.kind === 'no-model') && <p>{R18_COPY.NO_MODEL_SENTENCE}</p>}
        {ready && setting && (
          <>
            <p>{placeSentence(setting, keyStored)}</p>
            <p className="field-help">
              {visibleText(setting.model)}: {modelLabelWords(modelLabel(setting, results))}
            </p>
            {setting.place === 'firm-server' && isPlainHttp(setting.url) && <p>{R18_COPY.UNENCRYPTED_LINE}</p>}
          </>
        )}
      </div>
      {ready && demonstration && (
        <p className="model-status__notice">
          {R18_COPY.DEMO_NOTICE}
          {onSharedSite && <> {R18_COPY.SHARED_ORIGIN_NOTE}</>}
        </p>
      )}
    </div>
  );
}
