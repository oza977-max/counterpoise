import { clearHandoffSyncMarker } from './handoff';

// V2-D: "start over" for testers. Everything Counterpoise stores lives in this
// browser (NF-3, no backend), so a reset is genuinely local and total —
// there is no server copy to fall back on, which is exactly why the UI
// wraps this in a confirmation.
//
// The saved API key is deliberately NOT cleared here: it is a machine
// setting, not test data, and re-entering it is the one step a tester
// cannot redo for themselves.
const DATABASES = ['aigate-audit', 'aigate-register'];

type DeleteOutcome = 'deleted' | 'blocked' | 'error';

// Code review 001, I-3: this previously resolved identically on success,
// error and blocked, so the UI could report a clean reset while the audit
// trail survived (another tab holding a connection blocks the delete). It
// still never rejects — a reset that hangs is worse than one that reports —
// but the caller now learns what actually happened.
// CR7-20: `onblocked` fires whenever ANY connection is open when the delete
// is requested — including this tab's own, which db.ts closes a moment later
// (its `blocking` handler). Resolving on the first event reported "blocked" for
// a delete that then succeeded. On `blocked` we now keep waiting for
// `onsuccess` (the delete proceeds the moment the last handle closes) and
// report 'blocked' only if nothing happens within BLOCKED_GRACE_MS — i.e.
// another tab really is holding the database open and not closing it.
const BLOCKED_GRACE_MS = 3000;

function deleteDatabase(name: string): Promise<DeleteOutcome> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (outcome: DeleteOutcome) => {
      if (timer !== undefined) clearTimeout(timer);
      resolve(outcome);
    };
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => settle('deleted');
    request.onerror = () => settle('error');
    request.onblocked = () => {
      if (timer === undefined) timer = setTimeout(() => settle('blocked'), BLOCKED_GRACE_MS);
    };
  });
}

// Callers must reload the page afterwards — src/store/db.ts caches its
// open-database promises at module scope, so in-memory handles survive
// the delete until the module is re-evaluated.
// CR8-16: what this clears (role, hand-off marker, welcome flag, both databases;
// the panel adds the intake drafts) is named in SettingsPanel's confirmation and
// incomplete messages, and TC-CR8-16c pins the localStorage keys. Change one,
// change the other.
export async function clearAllLocalData(): Promise<{ complete: boolean; incomplete: string[] }> {
  localStorage.removeItem('aigate:role');
  // CR7-15: "start over" also forgets that a hand-off ever synced (that marker
  // changes which divergence message a later import shows) and that the
  // welcome panel was dismissed. Deliberately KEPT: the saved appetite
  // framework (aigate:policy-yaml) and the model settings (R18-B: the one
  // setting `aigate:model-setting`, whose remembered mode lives inside it, and
  // the saved test results `aigate:model-test-results`) — they are the
  // firm's configuration, not test data, and re-entering them is work the
  // tester cannot cheaply redo. The Settings message says so, only when a
  // setting exists, and offers "Forget the model setting" (TC-R18-NF-3-08);
  // nothing here may remove either key — only forgetModelSetting() does. The sessionStorage intake drafts live in
  // components/intake-draft.ts and are cleared by the caller (SettingsPanel):
  // the store must not import components.
  clearHandoffSyncMarker();
  try {
    localStorage.removeItem('aigate:welcome-dismissed');
  } catch {
    /* storage unavailable — nothing to clear */
  }
  const incomplete: string[] = [];
  for (const name of DATABASES) {
    const outcome = await deleteDatabase(name);
    if (outcome !== 'deleted') incomplete.push(`${name} (${outcome})`);
  }
  return { complete: incomplete.length === 0, incomplete };
}
