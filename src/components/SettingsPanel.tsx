import { useMemo, useState } from 'react';
import {
  DEFAULT_LOCAL_LLM_MODEL,
  DEFAULT_LOCAL_LLM_URL,
  disableLocalLlm,
  enableLocalLlm,
  getLocalLlmModel,
  getLocalLlmUrl,
  localLlmEnabled,
  probeLocalLlm,
} from '../llm/local-provider';
import { getPackSources, loadPackSet } from '../store/pack-source';
import { loadPolicy } from '../store/policy';
import { checkPolicyReferences } from '../store/policy-references';
import { getCurrentPolicyYaml } from '../store/policy-source';
import { clearAllLocalData } from '../store/reset';
import { clearDraft, clearFormDraft, probeLegacyFormDraft } from './intake-draft';
import { sampleCount, seedSampleRegister } from '../seeds/sample-register';
import { ibCaseCount, seedIbPortfolio } from '../seeds/ib-portfolio';

type Busy = 'none' | 'seeding' | 'seeding-ib' | 'clearing';

// CR9-14: a person reads "your audit trail", never a database id. reset.ts keeps its result shape
// (`<database id> (<outcome>)`); the mapping lives here, where the words are chosen. An id this map does
// not know prints as "some stored data" — a raw id can never reach the screen.
const PLAIN_STORE_NAMES: Record<string, string> = {
  'aigate-audit': 'your audit trail',
  'aigate-register': 'your register of use cases',
};
function plainStoreName(entry: string): string {
  const id = entry.split(' (')[0]!.trim();
  return PLAIN_STORE_NAMES[id] ?? 'some stored data';
}

// Demo-space model configuration (user decision 2026-08-17): ONE generic
// model slot, no vendor-specific key field. The cloud-SDK code path still
// exists behind getApiKey() but has no UI — it never ran live, the local
// open model has, and a demo should show the thing that works. A firm
// deployment points the same slot at a stronger model inside its own
// boundary (design-vision: models are swappable, the corpus is the moat).
export default function SettingsPanel({ onRoleReset }: { onRoleReset?: () => void } = {}) {
  const [busy, setBusy] = useState<Busy>('none');
  // Local open-model provider (2026-08-16). URL presence IS the enabled flag.
  const [localUrl, setLocalUrl] = useState(getLocalLlmUrl() ?? DEFAULT_LOCAL_LLM_URL);
  const [localModel, setLocalModel] = useState(getLocalLlmModel());
  const [localSaved, setLocalSaved] = useState(localLlmEnabled());
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const [localDigest, setLocalDigest] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const policyResult = useMemo(() => loadPolicy(getCurrentPolicyYaml()), []);
  const packSet = useMemo(() => loadPackSet(getPackSources()), []);
  const packs = packSet.packs;
  // R16-A1 (§1.4): computed once, reused by both seed actions below — an
  // honest, specific message beats letting the seed function silently
  // refuse and report "nothing added" for the wrong reason (NF-2).
  const policyReferenceErrors = useMemo(
    () => (policyResult.valid ? checkPolicyReferences(policyResult.policy, packs).errors : []),
    [policyResult, packs],
  );

  async function handleSeed() {
    if (!policyResult.valid) {
      setMessage('Cannot load samples — the current policy is invalid.');
      return;
    }
    if (packSet.messages.length > 0) {
      setMessage('Cannot load samples — a regulatory rules file failed to load. See the Appetite framework screen.');
      return;
    }
    if (policyReferenceErrors.length > 0) {
      setMessage(`Cannot load samples — the policy has an unresolved reference error: ${policyReferenceErrors[0]}`);
      return;
    }
    setBusy('seeding');
    setMessage(null);
    try {
      const seeded = await seedSampleRegister(policyResult.policy, packs);
      setMessage(
        seeded === 0
          ? 'Samples are already loaded — nothing added.'
          : `Added ${seeded} sample use ${seeded === 1 ? 'case' : 'cases'}. Open the register to see them.`
      );
    } catch {
      setMessage('Loading samples failed. See the browser console for details.');
    } finally {
      setBusy('none');
    }
  }

  async function handleSeedIb() {
    if (!policyResult.valid) {
      setMessage('Cannot load the portfolio — the current policy is invalid.');
      return;
    }
    if (packSet.messages.length > 0) {
      setMessage('Cannot load the portfolio — a regulatory rules file failed to load. See the Appetite framework screen.');
      return;
    }
    if (policyReferenceErrors.length > 0) {
      setMessage(`Cannot load the portfolio — the policy has an unresolved reference error: ${policyReferenceErrors[0]}`);
      return;
    }
    setBusy('seeding-ib');
    setMessage(null);
    try {
      const seeded = await seedIbPortfolio(policyResult.policy, packs);
      setMessage(
        seeded === 0
          ? 'The investment-bank portfolio is already loaded — nothing added.'
          : `Added ${seeded} investment-bank use cases across departments, including the 2LoD reviews. Open the register to see them.`
      );
    } catch {
      setMessage('Loading the portfolio failed. See the browser console for details.');
    } finally {
      setBusy('none');
    }
  }

  async function handleClearAll() {
    setBusy('clearing');
    try {
      const result = await clearAllLocalData();
      // CR7-15: drafts are cleared whatever the outcome — the role, hand-off
      // marker and welcome flag already are, and the message below says so.
      // (The unsaved drafts live in sessionStorage, owned by intake-draft;
      // the store must not import components.)
      clearDraft();
      clearFormDraft();
      probeLegacyFormDraft(); // removes the pre-R16 form key if present (its return value is not needed)
      if (!result.complete) {
        // Code review 001, I-3: a blocked delete used to resolve as success
        // and the UI reported a clean reset over surviving data. Say so.
        setBusy('none');
        // CR9-13: the message says the role was cleared, so the header must stop showing the old one.
        onRoleReset?.();
        setMessage(
          `Not everything could be deleted: ${[...new Set(result.incomplete.map(plainStoreName))].join(', ')}. ` +
            'Your unsaved intake drafts, selected role, hand-off sync record and welcome-panel dismissal were cleared; the data listed was not. ' +
            'This usually means Counterpoise is open in another tab. Close the others and the delete may still finish on its own; if the data is still there afterwards, try again.'
        );
        return;
      }
      // Reload rather than reset React state: src/store/db.ts caches its
      // open-database handles at module scope, so only a fresh page load
      // guarantees the app is really looking at empty databases.
      window.location.reload();
    } catch {
      setBusy('none');
      setMessage('Clearing data failed. See the browser console for details.');
    }
  }

  return (
    <>
      <details>
        <summary>Demo data</summary>
        <div>
          <p>
            Loads {sampleCount()} example use cases — spanning in-appetite, in-appetite-with-controls
            and out-of-appetite outcomes — so the register, duplicate check and verdict screens have
            something realistic in them. Each is scored by the real engine against the policy
            currently loaded, so the outcomes are genuine, not canned. All are prefixed [SAMPLE].
          </p>
          <button type="button" onClick={handleSeed} disabled={busy !== 'none'}>
            {busy === 'seeding' ? 'Loading…' : 'Load sample use cases'}
          </button>

          <p>
            A fuller picture loads automatically on first visit: {ibCaseCount()} investment-bank
            use cases across Markets, Advisory, Operations, Finance, HR, Technology, Risk,
            Compliance and Legal — each scored by the real engine, most carrying a full
            1LoD→2LoD chain on the audit trail (several are left awaiting sign-off so the reviewer
            queue has real work, and one carries a rule challenge). This button is here if you
            cleared your data and want it back. Reviewer names are seeded samples, marked as such.
          </p>
          <button type="button" onClick={handleSeedIb} disabled={busy !== 'none'}>
            {busy === 'seeding-ib' ? 'Loading…' : 'Reload investment-bank portfolio'}
          </button>

          {!confirmingClear && (
            <button type="button" onClick={() => setConfirmingClear(true)} disabled={busy !== 'none'}>
              Clear all data and start over
            </button>
          )}
          {confirmingClear && (
            <div role="alert">
              <p>
                This permanently deletes every use case, verdict and audit event in this browser, any
                unsaved intake draft, your selected role (it goes back to 1LoD) and the record of past
                hand-off syncs. The welcome panel will show again. Counterpoise has no server,
                so there is no copy to restore from. Export anything you want to keep first. Your model
                settings and the appetite framework you saved here are not affected. If Counterpoise is
                open in another tab, the delete can be held up until you close it, and may still finish
                afterwards.
              </p>
              <button type="button" onClick={handleClearAll} disabled={busy !== 'none'}>
                {busy === 'clearing' ? 'Clearing…' : 'Yes, delete everything'}
              </button>
              <button type="button" onClick={() => setConfirmingClear(false)} disabled={busy !== 'none'}>
                Cancel
              </button>
            </div>
          )}

          {message && <p role="status">{message}</p>}
        </div>
      </details>

      <details>
        <summary>Settings — plain-language model (demo)</summary>
        <div>
          <label htmlFor="local-llm-url">Model for plain-language intake (demo)</label>
          <p>
            One model slot, optional. Counterpoise scores use cases without it — the model only enables
            plain-language intake; the guided questions are the deterministic path either way.
            Point it at a model server on this machine (Ollama): your description goes to a local
            process, never to the internet, the model proposes, and you confirm every field before
            anything is scored. Expect a 10&ndash;20 second wait on the first request while the
            model loads.
          </p>
          <p className="field-help">
            Tested with the open-source Qwen&nbsp;3&nbsp;4B. Frontier models produce noticeably
            better first drafts than a small open model — this demo ships the free local option so
            nothing leaves this machine; a firm deployment would point the same slot at a stronger
            model inside its own boundary.
          </p>
          <input
            id="local-llm-url"
            type="text"
            value={localUrl}
            onChange={(e) => setLocalUrl(e.target.value)}
            placeholder={DEFAULT_LOCAL_LLM_URL}
          />
          <label htmlFor="local-llm-model">Model name</label>
          <input
            id="local-llm-model"
            type="text"
            value={localModel}
            onChange={(e) => setLocalModel(e.target.value)}
            placeholder={DEFAULT_LOCAL_LLM_MODEL}
          />
          <button
            type="button"
            disabled={probing || !localUrl.trim() || !localModel.trim()}
            onClick={() => {
              void (async () => {
                setProbing(true);
                setLocalStatus(null);
                const probe = await probeLocalLlm(localUrl, localModel);
                if (probe.ok) {
                  enableLocalLlm(localUrl, localModel);
                  setLocalSaved(true);
                  setLocalStatus(`Saved. ${probe.detail}`);
                  setLocalDigest(probe.digest ?? null);
                } else {
                  // Refuse-rather-than-record: a URL that does not answer is
                  // not saved, so the intake path never silently degrades.
                  setLocalStatus(probe.detail);
                  setLocalDigest(null);
                }
                setProbing(false);
              })();
            }}
          >
            {probing ? 'Testing…' : 'Test & save'}
          </button>
          {localSaved && (
            <button
              type="button"
              onClick={() => {
                disableLocalLlm();
                setLocalSaved(false);
                setLocalStatus('Local model disabled — the guided form is the intake path again.');
              }}
            >
              Disable local model
            </button>
          )}
          {localStatus && <p role="status">{localStatus}</p>}
          {localDigest && (
            <p className="field-help">
              digest: sha256:{localDigest.replace(/^sha256:/, '').slice(0, 12)}&hellip; — compare against the
              digest of the build you benchmarked
            </p>
          )}
        </div>
      </details>
    </>
  );
}
