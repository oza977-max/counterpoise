import { useEffect, useRef, useState } from 'react';
import { R18_COPY, modelLabelWords, placeSentence } from './plain-copy';
import {
  forgetModelSetting,
  listModels,
  modelLabel,
  readModelSetting,
  updateModelSetting,
  validateAddress,
  validateModelSetting,
} from '../llm/model-setting';
import { visibleText } from '../engine/visible-text';
import type { ModelPlace } from '../engine/prefill-types';
import { useModelSetting } from './useModelSetting';

// R18-B, deliverable 4 (specs/intake-flow.md §27.8). The Settings section for the one model
// setting. Presentation only: validation, storage and the model list are in
// src/llm/model-setting.ts. Three places, an address, a model (typed, or picked from what the
// server reports on an explicit "Find models" press), Save, and "Forget the model setting".
// There is NO field for a key or token. No model is named in this copy, none is chosen for
// the person, and none is "recommended".

const S = R18_COPY.SETTINGS;
const PLACES: ModelPlace[] = ['this-computer', 'firm-server', 'ollama-cloud'];

type Outcome = { kind: 'saved' } | { kind: 'refused'; text: string } | { kind: 'forgotten' } | null;
type Listing =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ok'; names: string[] };

function isPlainHttp(url: string): boolean {
  try {
    return new URL(url).protocol === 'http:';
  } catch {
    return false;
  }
}

export default function ModelSettingSection() {
  const snapshot = useModelSetting();
  const [initial] = useState(() => readModelSetting());
  const [place, setPlace] = useState<ModelPlace | ''>(initial?.place ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [listing, setListing] = useState<Listing>({ kind: 'idle' });
  const listController = useRef<AbortController | null>(null);

  useEffect(() => () => listController.current?.abort(), []);

  const edited = () => {
    setOutcome(null);
  };

  function handleSave() {
    const result = updateModelSetting({ place, url, model });
    if (result.ok) {
      setUrl(result.setting.url);
      setModel(result.setting.model);
      setOutcome({ kind: 'saved' });
    } else {
      setOutcome({ kind: 'refused', text: R18_COPY.REFUSAL_SENTENCES[result.reason] });
    }
  }

  async function handleFindModels() {
    setOutcome(null);
    const address = validateAddress(place, url);
    if (!address.ok) {
      setListing({ kind: 'idle' });
      setOutcome({ kind: 'refused', text: R18_COPY.REFUSAL_SENTENCES[address.reason] });
      return;
    }
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setListing({ kind: 'loading' });
    const names = await listModels({ place: place as ModelPlace, url: address.url }, controller.signal);
    if (controller.signal.aborted) return;
    setListing(names.length > 0 ? { kind: 'ok', names } : { kind: 'failed' });
  }

  function handleForget() {
    listController.current?.abort();
    forgetModelSetting();
    setPlace('');
    setUrl('');
    setModel('');
    setListing({ kind: 'idle' });
    setOutcome({ kind: 'forgotten' });
  }

  // What the sentence describes: the form as filled in, if it passes every rule; otherwise the
  // saved setting, if that does. Never a promise over something that does not validate.
  const formCheck = validateModelSetting({ place, url, model });
  const saved = snapshot.state.kind === 'valid' ? snapshot.state.setting : null;
  const shown = formCheck.ok ? formCheck.setting : saved;
  const unsaved =
    formCheck.ok &&
    !(saved && saved.place === formCheck.setting.place && saved.url === formCheck.setting.url && saved.model === formCheck.setting.model);
  const hasStored = snapshot.state.kind !== 'none';

  return (
    <details>
      <summary>{S.SUMMARY}</summary>
      <div>
        <p>{S.INTRO}</p>

        <fieldset>
          <legend>{S.PLACE_LEGEND}</legend>
          {PLACES.map((p) => (
            <label key={p} className="model-setting__place">
              <input
                type="radio"
                name="model-place"
                checked={place === p}
                onChange={() => {
                  setPlace(p);
                  edited();
                }}
              />{' '}
              {R18_COPY.PLACE_CHOICE_LABELS[p]}
            </label>
          ))}
        </fieldset>

        <label htmlFor="model-address">{S.ADDRESS_LABEL}</label>
        <input
          id="model-address"
          type="text"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            edited();
          }}
          placeholder="http://localhost:11434"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="field-help">{S.ADDRESS_HELP}</p>

        <button type="button" onClick={() => void handleFindModels()} disabled={listing.kind === 'loading'}>
          {S.FIND_MODELS}
        </button>
        <p className="field-help">{S.FIND_MODELS_HELP}</p>
        <div role="status">
          {listing.kind === 'loading' && <p>{S.LOADING_MODELS}</p>}
          {listing.kind === 'failed' && <p>{R18_COPY.FIND_MODELS_FAILED}</p>}
        </div>
        {listing.kind === 'ok' && (
          <ul aria-label={S.MODEL_LIST_LABEL} className="model-setting__list">
            {listing.names.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => {
                    setModel(name);
                    edited();
                  }}
                >
                  {visibleText(name)}
                </button>
              </li>
            ))}
          </ul>
        )}

        <label htmlFor="model-name">{S.MODEL_LABEL}</label>
        <input
          id="model-name"
          type="text"
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            edited();
          }}
          autoComplete="off"
          spellCheck={false}
        />

        {place === 'this-computer' && <p className="field-help">{R18_COPY.TUNNEL_SMALL_PRINT}</p>}
        {place === 'firm-server' && <p className="field-help">{R18_COPY.FIRM_SMALL_PRINT}</p>}
        {place !== '' && <p className="field-help">{R18_COPY.FALLBACK_RESEND_NOTE}</p>}

        <div>
          {shown && <p>{placeSentence(shown, snapshot.keyStored)}</p>}
          {shown && (
            <p className="field-help">
              {visibleText(shown.model)}: {modelLabelWords(modelLabel(shown, snapshot.results))}
            </p>
          )}
          {shown && shown.place === 'firm-server' && isPlainHttp(shown.url) && <p>{R18_COPY.UNENCRYPTED_LINE}</p>}
          {!shown && snapshot.state.kind === 'invalid' && <p>{R18_COPY.INVALID_SETTING_SENTENCE}</p>}
          {unsaved && <p className="field-help">{S.NOT_SAVED_YET}</p>}
        </div>

        <button type="button" onClick={handleSave}>
          {S.SAVE}
        </button>
        {hasStored && (
          <button type="button" onClick={handleForget}>
            {R18_COPY.FORGET_SETTING_LABEL}
          </button>
        )}
        <div role="status">
          {outcome?.kind === 'saved' && <p>{S.SAVED}</p>}
          {outcome?.kind === 'refused' && <p>{outcome.text}</p>}
          {outcome?.kind === 'forgotten' && <p>{R18_COPY.FORGOTTEN_SENTENCE}</p>}
        </div>
      </div>
    </details>
  );
}
