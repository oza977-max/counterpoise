import { useEffect, useMemo, useRef, useState } from 'react';
import IntakeFlow from './components/IntakeFlow';
import ErrorBoundary from './components/ErrorBoundary';
import RegisterView from './components/RegisterView';
import PolicyEditor from './components/PolicyEditor';
import SettingsPanel from './components/SettingsPanel';
import AboutPanel from './components/AboutPanel';
import RuleImprovementQueue from './components/RuleImprovementQueue';
import { getRole, setRole } from './store/role';
import { getUseCases } from './store/register';
import { loadPolicy } from './store/policy';
import { checkPolicyReferences } from './store/policy-references';
import { getCurrentPolicyYaml } from './store/policy-source';
import { translationAttestationStatus } from './engine/attestation';
import { getPackSources, loadPackSet } from './store/pack-source';
import { seedAigateSelfAssessment } from './seeds/aigate-self-assessment';
import BrandMark from './components/BrandMark';
import { seedIbPortfolio } from './seeds/ib-portfolio';
import './fonts.css';
import './App.css';

// App shell visual language taken from a Claude Design export
// ("Counterpoise Demo.dc.html") — dark header, warm-paper workspace, IBM Plex
// Sans/Mono. Sidebar "Register" nav item switches the main view to
// RegisterView.tsx (P6-C01). "Appetite framework" now routes to
// PolicyEditor.tsx (P7-C03) — a real Save flow, no longer a disabled
// placeholder.
export default function App() {
  const [view, setView] = useState<'intake' | 'register' | 'policyEditor' | 'about' | 'ruleQueue'>('intake');
  // First-visit pointer (2026-08-15). A card, not a takeover: replacing the
  // intake screen on first visit would surprise users and break every test
  // that renders App expecting intake — the card adds, never redirects.
  const [welcomeDismissed, setWelcomeDismissed] = useState(
    () => localStorage.getItem('aigate:welcome-dismissed') === '1',
  );
  const [role, setRoleState] = useState(getRole());
  // Bumped by PolicyEditor's onSaved callback so a saved policy change is
  // immediately reflected in the header badge and RegisterView's
  // currentPolicyVersion prop, without a full page reload (P7-C03).
  const [policyRevision, setPolicyRevision] = useState(0);
  // V1.2-B (design-gap E2): register count badge — refreshed on
  // navigation, an accepted staleness window.
  const [registerCount, setRegisterCount] = useState<number | null>(null);
  // Known-issue close (recorded since v0.3.2): "+ New pre-check" on a
  // COMPLETED flow should start a new one. The nonce tells IntakeFlow the
  // item was clicked; IntakeFlow decides whether that means reset (only a
  // finished flow resets — an in-progress draft keeps its own Start-over).
  const [newPrecheckNonce, setNewPrecheckNonce] = useState(0);
  // R15-C4 (proposal §3.8): the fidelity chip's explanation used to live in
  // a title= tooltip — hover-only meaning, a G3 violation. Now an
  // aria-expanded disclosure carries the same attestation.reason text,
  // visible to keyboard and screen-reader users, not just a mouse hover.
  const [fidelityDetailOpen, setFidelityDetailOpen] = useState(false);

  const policyResult = useMemo(() => loadPolicy(getCurrentPolicyYaml()), [policyRevision]);
  const currentPolicyVersion = policyResult.valid ? policyResult.policy.version : '0.1-starter';

  // NF-10. Recomputed when the policy changes; the date is taken once per
  // render of the shell, which is the only place a clock belongs.
  const attestation = useMemo(
    () =>
      policyResult.valid
        ? translationAttestationStatus(
            policyResult.policy.translation_attestation,
            new Date().toISOString().slice(0, 10),
          )
        : { status: 'unattested' as const, reason: 'No valid policy is loaded, so nothing can be attested.' },
    [policyResult],
  );

  // code-review-004 F1 (five panels converged on this independently): the
  // first D-001 fix had App pushing {view} and RegisterView pushing its own
  // {registerDetailId} shape onto the SAME browser stack, each popstate
  // consumer blind to the other's entries and RegisterView's listener dying
  // on unmount — so "open a detail, click a sidebar item, press Back" was a
  // dead click and a second Back skipped the detail entirely. One authority
  // now: App owns BOTH coordinates (view + registerDetailId) in every
  // history entry, App's is the only popstate listener, and RegisterView is
  // a controlled component that asks App to navigate.
  const [detailId, setDetailId] = useState<string | null>(null);

  function handleRoleChange(next: string) {
    setRole(next);
    applyRole(next);
  }

  // CR9-13: the state half of a role change, without writing the stored role. Clear all data
  // (incomplete path) has already removed the stored role, so the header just has to follow it
  // back to the default — and a reviewer-only screen must not be left open under 1LoD.
  function applyRole(next: string) {
    setRoleState(next);
    // R12-AD-2: the reviewer-only surface disappears for 1LoD — if it was
    // open when the role switches, fall back to intake rather than leaving
    // a 1LoD user stranded on a view whose nav item just vanished.
    if (next !== '2LoD' && view === 'ruleQueue') {
      // replaceState, not navigate(): this is a forced fallback from a role
      // change, not a click the user made — it must not leave a back-stack
      // entry pointing at a queue that's no longer reachable in this role.
      window.history.replaceState({ view: 'intake', registerDetailId: null }, '');
      setView('intake');
      setDetailId(null);
    }
  }

  // explore-010 D-001: every "screen" in this app was a React state flip
  // with zero History API involvement — no pushState, no popstate listener.
  // The browser's own Back button had nothing of this app's to act on, so
  // it left the app entirely instead of returning to the previous screen.
  // Each user-initiated view change now pushes a history entry; Back/Forward
  // replays them via popstate. The base entry is REPLACED (not pushed) on
  // mount so a Back from the very first screen still leaves the app for
  // wherever the user was before arriving — that's correct, not a bug.
  useEffect(() => {
    window.history.replaceState({ view: 'intake', registerDetailId: null }, '');
    const onPopState = (e: PopStateEvent) => {
      const state = e.state as { view?: typeof view; registerDetailId?: string | null } | null;
      if (state?.view) {
        // F1: a popped ruleQueue entry is only honoured for the role that
        // can see it — a 1LoD Back onto a 2LoD-only surface falls back the
        // same way handleRoleChange does.
        const popped = state.view === 'ruleQueue' && getRole() !== '2LoD' ? 'intake' : state.view;
        setView(popped);
        setDetailId(state.registerDetailId ?? null);
      }
      // A null/foreign state means the entry predates this app or belongs
      // to something else — the boundary of what Back can restore. No-op.
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // Mount-only: this wires the browser's back-stack to React state, not a
    // dependency-driven effect. `view` is intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function navigate(next: typeof view) {
    // code-review-004 F14: the old guard was `next !== view`, which made the
    // sidebar "Register" item a dead click while a DETAIL was open (top-level
    // view already 'register'). A navigation is new if either coordinate
    // changes.
    if (next !== view || detailId !== null) {
      window.history.pushState({ view: next, registerDetailId: null }, '');
    }
    setView(next);
    setDetailId(null);
  }

  // F1: RegisterView's row-click and back-link route through these — the
  // component no longer touches window.history itself.
  function openRegisterDetail(id: string) {
    window.history.pushState({ view: 'register', registerDetailId: id }, '');
    setDetailId(id);
  }

  function closeRegisterDetail() {
    // Unwind through history so the in-app "← register" link and the
    // browser Back button land in the same place (D-001's original rule).
    window.history.back();
  }

  useEffect(() => {
    let cancelled = false;
    getUseCases('all')
      .then((rows) => {
        if (!cancelled) setRegisterCount(rows.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [view, policyRevision]);

  // register-lifecycle.md §9 (LC-6): Counterpoise evaluates itself through its
  // own engine on first launch. Best-effort — a failure here (e.g.
  // invalid policy) must not block the app from rendering (same pattern
  // as VD-8's reasoning-trace generation). Runs once per app lifetime —
  // seedAigateSelfAssessment() is idempotent and race-safe (P7-C01).
  // P8-C04: seeded WITHOUT packs until now, so Counterpoise's own self-assessment
  // was scored ignoring the UK pack its graph declares.
  // GT7 D-1b (CF-5): a pack that fails to load is a start-up error exactly like
  // a broken policy — it joins startupPolicyErrors below, and the seeding guard
  // refuses to write anything while one is outstanding.
  const packSet = useMemo(() => loadPackSet(getPackSources()), []);
  const loadedPacks = packSet.packs;
  const packLoadErrors = packSet.messages;

  // R16-A1 (§1.4, CF-5-style). The app start-up gate: checkPolicyReferences
  // catches what loadPolicy()/loadPacks() structurally cannot — a
  // covers_reviews id that doesn't resolve against the firm's OWN reviews
  // plus whatever packs are loaded alongside it. Errors here are shown on
  // the main screen and disable evaluation, the same CF-5 contract as a
  // malformed policy file; a base-invalid policy (!policyResult.valid)
  // reaches the same banner via its own error list.
  const policyReferenceErrors = useMemo(
    () => (policyResult.valid ? checkPolicyReferences(policyResult.policy, loadedPacks).errors : []),
    [policyResult, loadedPacks],
  );
  // Pack reasons are shown verbatim (the loader already names the pack and the rule).
  // The banner heading and the plain sentence for submitters are unchanged.
  const startupPolicyErrors: string[] = [
    ...(policyResult.valid ? policyReferenceErrors : policyResult.errors.map((e) => `${e.field}: ${e.reason}`)),
    ...packLoadErrors,
  ];

  // O-002 (charter 005). Started during the FIRST RENDER, not in an effect.
  // React runs a child's effect before its parent's, so IntakeFlow's register
  // read always beat this — the duplicate check could report "checked 0
  // entries" moments before the self-assessment appeared. Starting here means
  // the in-flight promise exists before any child effect runs, so a consumer
  // can await it.
  //
  // A side effect during render is normally wrong. It is safe here for the
  // specific reason P7-C01 built for: seedAigateSelfAssessment collapses
  // concurrent callers onto one execution via an in-flight promise cache, and
  // StrictMode's double render was the case it was written to survive.
  const seedStarted = useRef(false);
  // GT7 D-1b: no seeded verdicts on the append-only trail while a rulebook is broken
  // (they would be evaluated without that pack and could not be taken back).
  if (!seedStarted.current && policyResult.valid && packLoadErrors.length === 0) {
    seedStarted.current = true;
    seedAigateSelfAssessment(policyResult.policy, loadedPacks).catch((err) => {
      console.warn('Counterpoise self-assessment seeding failed:', err);
    });
    // A first-time visitor's register was otherwise empty but for Counterpoise's
    // own self-assessment — nothing to show the risk-knowledge lens, the
    // 2LoD sign-off queue or a filed rule challenge actually doing
    // something. seedIbPortfolio() is idempotent and race-safe the same
    // way (in-flight promise cache, per-id skip in store/register) — same
    // best-effort, non-blocking pattern as the self-assessment above.
    seedIbPortfolio(policyResult.policy, loadedPacks).catch((err) => {
      console.warn('Investment-bank portfolio seeding failed:', err);
    });
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <BrandMark className="app-header__logo" tone="on-dark" />
          <span className="app-header__name">Counterpoise</span>
          <span className="app-header__badge">AI USE-CASE PRE-APPROVAL FOR BANKS</span>
        </div>
        <div className="app-header__status">
          <span className="app-header__dot" aria-hidden="true" />
          <span>policy v{currentPolicyVersion}</span>
          <span className="app-header__sep">·</span>
          {/* NF-10: computed, not asserted. This was a hardcoded string — true
              of the shipped starter policy, and it would have kept saying so
              after somebody attested. The engine is pure, so today's date is
              supplied here rather than read inside it. */}
          <span className="app-header__fidelity">
            <span className={attestation.status === 'attested' ? 'app-header__ok' : 'app-header__warn'}>
              {attestation.status === 'attested' ? '' : '⚠ '}translation fidelity: {attestation.status}
            </span>
            <button
              type="button"
              className="app-header__fidelity-toggle"
              aria-expanded={fidelityDetailOpen}
              onClick={() => setFidelityDetailOpen((v) => !v)}
            >
              {fidelityDetailOpen ? 'hide' : 'details ▸'}
            </button>
          </span>
          {fidelityDetailOpen && <p className="app-header__fidelity-detail">{attestation.reason}</p>}
          <span className="app-header__sep">·</span>
          {/* R15-C1 (proposal §3.8): relabelled "Viewing as" with a visible
              (not title=) honesty note, and first-mention glosses on the
              options — makes the existing 1LoD/2LoD gating honest about
              being a view preference, not access control (P1). No new
              role-conditional rendering added (G6). */}
          <label htmlFor="role-switcher" className="app-header__role-label">
            Viewing as
          </label>
          <select
            id="role-switcher"
            className="app-header__role-select"
            value={role}
            onChange={(e) => handleRoleChange(e.target.value)}
          >
            <option value="1LoD">1LoD — James · Dev (first line — submitter)</option>
            <option value="2LoD">2LoD — Priya · AI Risk (second line — reviewer)</option>
          </select>
          <span className="app-header__role-note">a view preference — this build has no sign-in</span>
        </div>
      </header>

      <div className="app-body">
        <nav className="app-sidebar" aria-label="Workspace navigation">
          <div className="app-sidebar__label">Workspace</div>
          {/* §3 (DR7-10). Real buttons — a keyboard or screen-reader user
              could not reach any of these five items when they were plain
              <div>s with an onClick (no native keyboard handling, no
              accessible role). Same classes, same look (App.css resets the
              browser's own button chrome); aria-current="page" names the
              active one, the same thing the --active class already shows
              visually. */}
          <button
            type="button"
            className={view === 'intake' ? 'app-sidebar__item app-sidebar__item--active' : 'app-sidebar__item'}
            aria-current={view === 'intake' ? 'page' : undefined}
            onClick={() => {
              navigate('intake');
              setNewPrecheckNonce((n) => n + 1);
            }}
          >
            + New pre-check
          </button>
          <button
            type="button"
            className={view === 'register' ? 'app-sidebar__item app-sidebar__item--active' : 'app-sidebar__item'}
            aria-current={view === 'register' ? 'page' : undefined}
            onClick={() => navigate('register')}
          >
            <span>▤ Register</span>
            {registerCount !== null && registerCount > 0 && (
              <span className="app-sidebar__count">{registerCount}</span>
            )}
          </button>
          <button
            type="button"
            className={view === 'policyEditor' ? 'app-sidebar__item app-sidebar__item--active' : 'app-sidebar__item'}
            aria-current={view === 'policyEditor' ? 'page' : undefined}
            onClick={() => navigate('policyEditor')}
          >
            § Appetite framework
          </button>
          {/* R12-AD-2: the entry surface stays narrow for 1LoD — the
              reviewer-only queue is hidden, never merely disabled. 2LoD
              keeps seeing everything unchanged. */}
          {role === '2LoD' && (
            <button
              type="button"
              className={view === 'ruleQueue' ? 'app-sidebar__item app-sidebar__item--active' : 'app-sidebar__item'}
              aria-current={view === 'ruleQueue' ? 'page' : undefined}
              onClick={() => navigate('ruleQueue')}
            >
              ⚑ Rule challenges
            </button>
          )}
          <button
            type="button"
            className={view === 'about' ? 'app-sidebar__item app-sidebar__item--active' : 'app-sidebar__item'}
            aria-current={view === 'about' ? 'page' : undefined}
            onClick={() => navigate('about')}
          >
            ? About
          </button>
          <div className="app-sidebar__settings">
            <SettingsPanel onRoleReset={() => applyRole('1LoD')} />
          </div>
        </nav>

        <main className="app-main">
          {/* R16-A1 (§1.4, CF-5): the app start-up gate. Shown on every
              screen — additive, not a replacement for the view underneath
              — because the fix for most of these errors is in the Appetite
              framework screen, which must stay reachable. */}
          {startupPolicyErrors.length > 0 && (
            <div className="app-policy-invalid" role="alert">
              <strong>Policy file invalid</strong> — evaluation is disabled until this is resolved.
              {/* CR8-13: the raw field paths are for whoever edits the file — the 2LoD role and the
                  Appetite framework screen. Everyone else gets the one plain sentence (its own wording, so it
                  never repeats the intake alert's sentence). The heading stays for every role. */}
              <ul>
                {role === '2LoD' || view === 'policyEditor' ? (
                  startupPolicyErrors.map((e, i) => <li key={i}>{e}</li>)
                ) : (
                  <li>Your AI risk team needs to fix the firm&apos;s rules file before checks can run.</li>
                )}
              </ul>
            </div>
          )}
          {view === 'intake' && !welcomeDismissed && (
            <div className="app-welcome" role="note">
              {/* R16-W §4 (D-74): replaces "This is a pre-check gate:
                  describe an AI use case and a deterministic rule engine —
                  no AI in the decision — tells you whether it sits inside
                  your firm's risk appetite, and what would bring it
                  inside." — "pre-check gate", "deterministic rule engine"
                  and "risk appetite" are all engine vocabulary on the very
                  first card a newcomer sees. Both buttons unchanged. */}
              <strong>First time here?</strong> Describe an AI tool you want to use and answer a few
              questions. You&rsquo;ll find out whether you can go ahead and what needs doing first. The
              decision comes from your firm&rsquo;s written rules, not from AI, so the same answers
              always get the same result.{' '}
              <button type="button" className="about-panel__link" onClick={() => navigate('about')}>
                Two-minute overview →
              </button>{' '}
              <button
                type="button"
                className="app-welcome__dismiss"
                onClick={() => {
                  localStorage.setItem('aigate:welcome-dismissed', '1');
                  setWelcomeDismissed(true);
                }}
              >
                Got it
              </button>
            </div>
          )}
          {/* CR6-04 (Critical, BC-002): a render-time crash anywhere in the
              intake flow — including one caused by a draft shape this
              build can no longer read — used to blank the whole screen
              with no way back except a reload that would just restore the
              identical bad draft and crash again. */}
          {view === 'intake' && (
            <ErrorBoundary>
              <IntakeFlow newPrecheckNonce={newPrecheckNonce} />
            </ErrorBoundary>
          )}
          {view === 'about' && <AboutPanel onNavigate={navigate} />}
          {view === 'register' && (
            <RegisterView
              role={role}
              currentPolicyVersion={currentPolicyVersion}
              policy={policyResult.valid ? policyResult.policy : undefined}
              selectedId={detailId}
              onSelectRow={openRegisterDetail}
              onCloseDetail={closeRegisterDetail}
            />
          )}
          {view === 'policyEditor' && <PolicyEditor onSaved={() => setPolicyRevision((r) => r + 1)} />}
          {view === 'ruleQueue' && <RuleImprovementQueue />}
        </main>
      </div>
    </div>
  );
}
