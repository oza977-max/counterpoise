import { useEffect, useMemo, useRef, useState } from 'react';
import { getUseCases, hasPendingPolicyUpdate, exportAll } from '../store/register';
import { R18_COPY } from './plain-copy';
import { exportBundle, importBundle, replaceWithBundle, finishRegisterReplace, type ImportOutcome, type AuditTip } from '../store/handoff';
import { AIGATE_USE_CASE_ID } from '../seeds/aigate-self-assessment';
import RegisterDetail from './RegisterDetail';
import type { UseCaseSummary } from '../store/types';
import type { PolicyFile } from '../engine/types';
import type { ProvisionalReason } from '../engine/provisional';
import { classifyProvisionalReason } from './VerdictDisplay';
import { STAGE_LABELS, STATUS_LABEL } from './field-copy';
import type { CorrectionOpening } from './correction-from-record';

// Rule 4 (cross-cutting.md §7): presentation-only, calls store functions,
// no direct IndexedDB/audit access. register-lifecycle.md §10.
interface RegisterViewProps {
  role: string;
  currentPolicyVersion: string;
  // P8-C07 (§15.1a): passed through to RegisterDetail, which reads control
  // evidence status from TODAY's policy while the verdict itself stays
  // historical. RegisterView does not use it.
  policy?: PolicyFile;
  // code-review-004 F1: list<->detail selection is App-owned now — App is
  // the single history/popstate authority, this component just renders the
  // coordinate it's given and asks App to change it. Its own pushState +
  // popstate listener (the second, shape-blind stack writer that broke Back
  // across view levels) are gone.
  selectedId: string | null;
  onSelectRow: (id: string) => void;
  onCloseDetail: () => void;
  // R18-D2 (§27.10): passed to the detail's "Correct this check". App opens the intake on the form.
  onCorrectFromRecord?: (opening: CorrectionOpening) => void;
}

// code-review-004 F15: this was a third, local copy of the exact map
// field-copy.ts consolidated (its comment claims the consolidation was
// complete — this file predated it and was missed). One source now.

export default function RegisterView({ role, currentPolicyVersion, policy, selectedId, onSelectRow, onCloseDetail, onCorrectFromRecord }: RegisterViewProps) {
  const [rows, setRows] = useState<UseCaseSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [policyUpdatePending, setPolicyUpdatePending] = useState(false);
  const [tierFilter, setTierFilter] = useState<string | null>(null);
  const [trackFilter, setTrackFilter] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // R15-C1 (proposal §3.3): 2LoD default view is "awaiting your sign-off",
  // with "Show all" one click away. This is a VIEW FILTER on top of the
  // existing 1LoD/2LoD data scoping (getUseCases already returns 'all' for
  // 2LoD, own-submissions for 1LoD) — no new role-conditional rendering
  // (G6). Default false = the narrowed view; true = everything this role
  // can already see.
  const [showAll, setShowAll] = useState(false);
  // V1.2-A: row click -> detail view (App-owned since code-review-004 F1);
  // refreshKey bumps on return so a 2LoD approval's stage change is
  // immediately visible in the list.
  const [refreshKey, setRefreshKey] = useState(0);

  // RG-8 hand-off bundle: export the register + audit trail to move it to
  // another machine (a real reviewer on a real second laptop), and import a
  // bundle sent back. Available to BOTH roles — a submitter hands off to a
  // reviewer and the reviewer hands the signed case back.
  const [handoffMsg, setHandoffMsg] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingReplace, setPendingReplace] = useState<unknown>(null);
  // code-review-005 F1: replace is now two explicit steps — a backup must
  // succeed and be acknowledged before the destructive step is even offered.
  // backupReady holds the filename shown to the user in step 2's message,
  // AND (round 2, N2) the audit tip that backup file actually exported —
  // recorded here so replaceWithBundle can refuse, atomically, if the local
  // trail changed after this backup was taken (reachable in one tab: the
  // case page renders inside this same component, so a user can open a case
  // and sign it off while this replace is still pending). Reset whenever
  // pendingReplace changes or is cleared, so a stale "I already backed up"
  // state from a DIFFERENT bundle's decision can never carry over into a new
  // one.
  const [backupReady, setBackupReady] = useState<{ filename: string; auditTip: AuditTip } | null>(null);
  // round 2, N1: set when a replace got as far as 'partially_replaced' — the
  // audit trail was replaced but the register step failed. Offers "Finish
  // updating the register" instead of the normal confirm-replace button;
  // cleared on success, on a hard refusal to finish (finish_out_of_date), or
  // when the user abandons this pending bundle entirely.
  // round 3, R3-1: also set (with no backup step) when a re-import reports
  // 'register_needs_finishing' — the same "only Finish is honest" state,
  // reached after that in-memory record was lost rather than within one
  // session. Reset wherever pendingReplace is replaced (R3-2), so a stale
  // true from an earlier bundle's decision can never leak into a new one.
  const [awaitingFinish, setAwaitingFinish] = useState(false);
  const replaceInFlight = useRef(false);
  const backupInFlight = useRef(false); // N8: synchronous guard — a double-click on "Save a backup of mine first" must not download the file twice
  const importInFlight = useRef(false); // F5: synchronous guard — a state update lands too late to stop a second concurrent import

  type ExportResult = { ok: true; bundle: Awaited<ReturnType<typeof exportBundle>>; filename: string } | { ok: false; error: string };

  // The reusable core: builds the bundle, triggers the download, and reports
  // success/failure to its caller — it never swallows an error itself (F1).
  // Two callers use it: the plain "Export hand-off bundle" button, and step 1
  // of the replace flow ("Save a backup of mine first").
  async function performExportBundle(): Promise<ExportResult> {
    try {
      const bundle = await exportBundle(__APP_VERSION__);
      const filename = `counterpoise-handoff-${bundle.exported_at.replace(/[:.]/g, '-')}.json`;
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      return { ok: true, bundle, filename };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function handleExportBundle() {
    const result = await performExportBundle();
    if (result.ok) {
      // code-review-005 round 2, N7: the old wording ("Exported N events...
      // to a hand-off file") stated the file was saved as fact — a browser
      // can silently block or redirect a download. This says what the app
      // actually knows (it asked the browser to save a file with this name
      // and this content) and asks the user to confirm the rest themselves.
      setHandoffMsg({
        tone: 'ok',
        text: `Created a hand-off file named ${result.filename} with ${result.bundle.audit_events.length} audit events and ${result.bundle.register.nodes.length} register entries. Check it's in your downloads folder, then send it to the other reviewer directly. ${R18_COPY.HANDOFF_EXPORT_STATEMENT}`,
      });
    } else {
      setHandoffMsg({ tone: 'error', text: `Export failed: ${result.error}` });
    }
  }

  async function handleImportBundleFile(file: File) {
    if (importInFlight.current) return;
    // round 3, R3-2: the "Import hand-off bundle" control is already
    // disabled (below) whenever a replace or finish is pending — this is
    // defence in depth for a call that reaches this handler some other way.
    // A second bundle landing here while one is pending must never silently
    // supersede or race the first; the only honest way out is to finish or
    // cancel the one already in progress.
    if (pendingReplace !== null) return;
    importInFlight.current = true;
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        setHandoffMsg({ tone: 'error', text: 'That file is not valid JSON — it is not a Counterpoise hand-off bundle.' });
        return;
      }
      try {
        const result = await importBundle(parsed);
        const errorOutcomes: ImportOutcome[] = ['invalid_format', 'tampered'];
        const neutralOutcomes: ImportOutcome[] = ['up_to_date', 'local_ahead', 'diverged', 'register_needs_finishing'];
        const tone = errorOutcomes.includes(result.outcome) ? 'error' : neutralOutcomes.includes(result.outcome) ? 'info' : 'ok';
        setHandoffMsg({ tone, text: result.message });
        if (result.outcome === 'diverged') {
          // The normal first receipt (each browser seeds its own demo cases)
          // — hold the verified bundle so the user can choose to replace. A
          // NEW diverged bundle is the one case that should supersede an
          // earlier pending one; restart the two-step confirmation for it.
          // round 3, R3-2: awaitingFinish must be reset here too — without
          // this, a diverging import that arrived while an earlier
          // partially_replaced finish was still pending left BOTH "Keep my
          // register" (for this new bundle) and "Finish updating the
          // register" (for the old one) on screen together, and "Keep"
          // silently abandoned the finish. The Import control below is now
          // also disabled while any replace/finish is pending, which closes
          // the race at its source; this reset is defence in depth for
          // whatever still calls setPendingReplace directly.
          setPendingReplace(parsed);
          setBackupReady(null);
          setAwaitingFinish(false);
        }
        if (result.outcome === 'register_needs_finishing') {
          // round 3, R3-1: the audit trail already matches this bundle —
          // nothing to import there — but the register never caught up,
          // almost always because an earlier partially_replaced finish was
          // lost (a view switch, a reload) before it completed. No backup
          // step: nothing is being discarded here, so "Finish updating the
          // register" is offered directly, re-using the exact same action
          // (and its tip re-check) a still-pending finish would.
          setPendingReplace(parsed);
          setBackupReady(null);
          setAwaitingFinish(true);
        }
        // code-review-005 F28: every OTHER outcome — including
        // invalid_format/tampered for an unrelated file — leaves an existing
        // pendingReplace untouched. It belongs to a different bundle and is
        // still awaiting the user's own decision; only a fresh diverged
        // bundle (above) or the user's own replace/keep choice may clear it.
        if (result.outcome === 'imported_into_empty' || result.outcome === 'merged') {
          setRefreshKey((k) => k + 1); // reflect the newly imported cases in the list
        }
      } catch (err) {
        // F6: a partial failure (e.g. the audit trail updated but the
        // register view could not be refreshed) must be shown, not silent —
        // and must not disturb an unrelated pending replace (F28).
        setHandoffMsg({ tone: 'error', text: `Import failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    } finally {
      importInFlight.current = false;
    }
  }

  // Step 1: "Save a backup of mine first". Only on success does step 2
  // become available — a browser can block or cancel a download silently,
  // so the user is asked to confirm they actually have the file before
  // anything is replaced (F1). code-review-005 round 2, N8: a synchronous
  // ref guard, same pattern as replaceInFlight/importInFlight — a
  // double-click fires this async handler twice before React re-renders any
  // disabled state, which would otherwise download the backup file twice.
  async function handleBackupBeforeReplace() {
    if (backupInFlight.current) return;
    backupInFlight.current = true;
    try {
      const result = await performExportBundle();
      if (!result.ok) {
        setHandoffMsg({ tone: 'error', text: "Couldn't create a backup, so nothing was replaced." });
        return;
      }
      // round 2, N2: record exactly what this backup exported (hash + count
      // of its last audit event) — this is the tip replaceWithBundle will
      // re-check against the live trail before it discards anything.
      setBackupReady({
        filename: result.filename,
        auditTip: { hash: result.bundle.audit_events.at(-1)?.hash ?? null, count: result.bundle.audit_events.length },
      });
      setHandoffMsg({
        tone: 'info',
        text: `A backup file named ${result.filename} was created. Check it's in your downloads folder before you replace anything.`,
      });
    } finally {
      backupInFlight.current = false;
    }
  }

  // Step 2: "I have my backup — replace my register". Only this button
  // performs the replace.
  async function handleConfirmReplace() {
    if (!pendingReplace || !backupReady || replaceInFlight.current) return;
    replaceInFlight.current = true;
    try {
      const result = await replaceWithBundle(pendingReplace, backupReady.auditTip);
      setHandoffMsg({ tone: result.outcome === 'replaced' ? 'ok' : 'error', text: result.message });
      if (result.outcome === 'replaced') {
        setPendingReplace(null);
        setBackupReady(null);
        setAwaitingFinish(false);
        setRefreshKey((k) => k + 1);
      } else if (result.outcome === 'partially_replaced') {
        // round 2, N1: the audit trail was already replaced — there is no
        // "keep my register" any more (that ship sailed the moment the
        // audit side succeeded). Offer to finish the register step instead,
        // keeping the same pending bundle and backup record.
        setAwaitingFinish(true);
      } else if (result.outcome === 'backup_out_of_date') {
        // round 2, N2: something local changed since this backup was taken.
        // Back to step 1 — the SAME pending bundle, a fresh backup required.
        setBackupReady(null);
        setAwaitingFinish(false);
      }
      // F6: on any other outcome, keep the pending replace (and the backup
      // already taken) available so the user can retry rather than losing
      // their place.
    } catch (err) {
      // Only a genuine audit-step failure reaches here now (round 2, N1) —
      // backupAndReplaceAllRawEventsWithinQueue's transaction aborts
      // atomically, so nothing was written and this sentence is honest. A
      // register-step failure after a successful audit replace is the
      // distinct 'partially_replaced' outcome handled above, never this
      // catch block — appending this sentence to THAT case was the N1 bug.
      setHandoffMsg({
        tone: 'error',
        text: `Replace failed: ${err instanceof Error ? err.message : String(err)}. Your register was not changed — your pending replace is still available.`,
      });
    } finally {
      replaceInFlight.current = false;
    }
  }

  // round 2, N1: the way out of 'partially_replaced'. Re-applies the same
  // pending bundle's register only, after finishRegisterReplace re-confirms
  // the local audit tip has not moved on since the replace that got this far.
  async function handleFinishRegisterReplace() {
    if (!pendingReplace || replaceInFlight.current) return;
    replaceInFlight.current = true;
    try {
      const result = await finishRegisterReplace(pendingReplace);
      setHandoffMsg({ tone: result.outcome === 'replaced' ? 'ok' : 'error', text: result.message });
      if (result.outcome === 'replaced' || result.outcome === 'finish_out_of_date') {
        // 'replaced': done. 'finish_out_of_date': the audit trail moved on —
        // finishing from here can no longer be trusted, and the message
        // above already tells the user to reload, so there is nothing left
        // for this pending bundle to offer.
        setPendingReplace(null);
        setBackupReady(null);
        setAwaitingFinish(false);
        if (result.outcome === 'replaced') setRefreshKey((k) => k + 1);
      }
      // otherwise ('partially_replaced' again — the retry ALSO failed to
      // update the register): keep offering Finish, same as F6's precedent.
    } catch (err) {
      setHandoffMsg({
        tone: 'error',
        text: `Finishing the register update failed: ${err instanceof Error ? err.message : String(err)}. Your audit trail is unaffected by this — try again, or reload.`,
      });
    } finally {
      replaceInFlight.current = false;
    }
  }

  function handleKeepRegister() {
    setPendingReplace(null);
    setBackupReady(null);
    setAwaitingFinish(false);
    setHandoffMsg(null);
  }

  // F1: the list refresh the old popstate handler did on detail->list is
  // now keyed on the PROP transition — same trigger, one authority.
  const prevSelectedId = useRef(selectedId);
  useEffect(() => {
    if (prevSelectedId.current !== null && selectedId === null) {
      setRefreshKey((k) => k + 1);
    }
    prevSelectedId.current = selectedId;
  }, [selectedId]);

  const is2LoD = role === '2LoD';

  // code-review-005 F3/F20: getUseCases() is now per-row resilient (it skips
  // and logs an unreadable node rather than throwing), but the CALL itself
  // can still fail outright (e.g. IndexedDB unavailable) — that must show an
  // error instead of leaving the screen on "Loading…" forever.
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const summaries = await getUseCases(is2LoD ? 'all' : role, currentPolicyVersion, policy?.sampling_rate);
        if (cancelled) return;
        setRows(summaries);
        setLoaded(true);
        setLoadError(null);
        if (is2LoD) {
          const pending = await hasPendingPolicyUpdate(summaries.map((s) => s.use_case_id));
          if (!cancelled) setPolicyUpdatePending(pending);
        }
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoaded(true); // stop showing "Loading…" — the error replaces it
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [role, is2LoD, currentPolicyVersion, refreshKey, policy?.sampling_rate]);

  const tiers = useMemo(() => Array.from(new Set(rows.map((r) => r.tier).filter((v): v is string => v !== null))), [rows]);
  const tracks = useMemo(() => Array.from(new Set(rows.map((r) => r.track).filter((v): v is string => v !== null))), [rows]);
  const stages = useMemo(() => Array.from(new Set(rows.map((r) => r.lifecycle_stage))), [rows]);
  const statuses = useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.current_verdict_status).filter((v): v is NonNullable<typeof v> => v !== null)),
      ),
    [rows],
  );

  // "Awaiting your sign-off" = rows still at the pre_checked stage — the
  // stage whose label is "Awaiting 2LoD sign-off" (STAGE_LABELS). Applied
  // before the filter chips, same as any other filter — Show all just
  // widens the pool the chips then narrow.
  const awaitingSignoffRows = useMemo(() => rows.filter((r) => r.lifecycle_stage === 'pre_checked'), [rows]);

  const visibleRows = useMemo(() => {
    if (!is2LoD) return rows;
    const scoped = showAll ? rows : awaitingSignoffRows;
    return scoped.filter((r) => {
      if (tierFilter && r.tier !== tierFilter) return false;
      if (trackFilter && r.track !== trackFilter) return false;
      if (stageFilter && r.lifecycle_stage !== stageFilter) return false;
      if (statusFilter && r.current_verdict_status !== statusFilter) return false;
      if (search.trim() && !r.label.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [rows, is2LoD, showAll, awaitingSignoffRows, tierFilter, trackFilter, stageFilter, statusFilter, search]);

  // register-lifecycle.md §10.3 (RG-5) — 2LoD-only export, deferred from
  // P6-C01. Browser download via Blob + a temporary anchor; no business
  // logic beyond calling the existing exportAll() store function.
  async function handleExport() {
    const { nodes, edges } = await exportAll();
    const payload = { exported_at: new Date().toISOString(), nodes, edges };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `counterpoise-register-export-${payload.exported_at}.json`;
    // Some browsers only fire a download reliably when the anchor is
    // attached to the DOM at click time (review finding, pass 1).
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  if (selectedId) {
    return (
      <RegisterDetail
        useCaseId={selectedId}
        role={role}
        policy={policy}
        onBack={onCloseDetail}
        onCorrectFromRecord={onCorrectFromRecord}
      />
    );
  }

  if (!loaded) {
    return (
      <section className="card register-view">
        <h2>Register</h2>
        <p>Loading…</p>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="card register-view">
        <h2>Register</h2>
        <p role="alert" className="register-view__load-error">
          The register couldn&apos;t be loaded: {loadError}
        </p>
      </section>
    );
  }

  const aigateRow = rows.find((r) => r.use_case_id === AIGATE_USE_CASE_ID);

  // R12-BD-3 (ADR-VA-R12-2): "N of M verdicts here would be final once
  // outstanding sign-offs land" — counts decided, provisional verdicts
  // whose causes are ALL sign-off gaps (never a mix with a substantive
  // caveat), over the total decided verdicts in this view.
  const decidedRows = rows.filter((r) => r.current_verdict_status !== null);
  const signoffGapOnlyCount = decidedRows.filter(
    (r) =>
      r.provisional &&
      r.provisional_reasons.length > 0 &&
      r.provisional_reasons.every(
        (reason) => classifyProvisionalReason(reason as ProvisionalReason) === 'signoff_gap',
      ),
  ).length;

  if (rows.length === 0) {
    return (
      <section className="card register-view">
        <h2>Register</h2>
        <p>{is2LoD ? 'No use cases found.' : 'No use cases submitted yet.'}</p>
      </section>
    );
  }

  return (
    <section className="card register-view">
      <h2>Register</h2>

      {!is2LoD && (
        <p className="register-view__scope-note">
          You&apos;re viewing as 1LoD — a view preference, not a permission; this build has no sign-in.
        </p>
      )}

      {/* RG-8: the submitter/reviewer hand-off. Both roles see it. */}
      <div className="register-view__handoff">
        <div className="register-view__handoff-actions">
          <button type="button" onClick={() => void handleExportBundle()}>
            Export hand-off bundle
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={pendingReplace !== null}>
            Import hand-off bundle
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            aria-label="Import hand-off bundle file"
            disabled={pendingReplace !== null}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportBundleFile(file);
              e.target.value = ''; // allow re-importing the same file
            }}
          />
        </div>
        {/* round 3, R3-2: a second import while a replace or finish is still
            pending used to be able to land mid-decision and leave two
            unrelated pending actions on screen together (e.g. a NEW
            diverging bundle's "Keep my register" alongside an OLDER
            bundle's "Finish updating the register" — "Keep" then silently
            abandoned the finish). Disabling the control while
            pendingReplace !== null closes the race at the one place a
            second bundle could ever enter. */}
        {pendingReplace !== null && (
          <p className="register-view__handoff-import-disabled-reason" role="status">
            Finish or cancel the pending replace first.
          </p>
        )}
        {/* code-review-005 F2: says exactly what the seal/chain catch (damage,
            or an edit not followed by recomputing the chain) and what they
            cannot prove (who made the file) — never "any change is detected". */}
        <p className="register-view__handoff-hint">
          Move this register and its audit trail to another reviewer&apos;s machine as a file. On import the
          app re-checks every entry: accidental damage or a simple edit is caught and the import refuses.
          What this can&apos;t prove is who made the file — anyone holding it could rebuild it to pass these
          checks — so only import a bundle from someone you trust, sent by a route you trust. Two copies
          merge only when one continues the other&apos;s history; otherwise you can choose to replace yours,
          after saving a backup.
        </p>
        {/* R18-D1 (GI-5-08, §27.13): the sources in a file are self-asserted, and the chain is not authentication. */}
        <p className="register-view__handoff-provenance">{R18_COPY.HANDOFF_IMPORT_PROVENANCE}</p>
        {handoffMsg && (
          <p
            className={`register-view__handoff-msg register-view__handoff-msg--${handoffMsg.tone}`}
            role={handoffMsg.tone === 'error' ? 'alert' : 'status'}
          >
            {handoffMsg.text}
          </p>
        )}
        {/* code-review-005 F1: two explicit steps. Step 1 must succeed (and
            the user must confirm they have the file) before step 2 — the
            actual destructive replace — is even offered. Round 2 (N1) adds a
            third state: once the audit side of a replace has actually
            succeeded, "Keep my register" is no longer an honest option (that
            part cannot be undone from here) — only "Finish updating the
            register" is offered. */}
        {/* round 3, R3-1/R3-2: guarded with !awaitingFinish too — a pending
            bundle whose audit side already landed (awaitingFinish true, no
            backup needed: register_needs_finishing, or a still-pending
            partially_replaced finish) must offer ONLY "Finish updating the
            register" below, never this step-1 pair as well. */}
        {pendingReplace !== null && !backupReady && !awaitingFinish && (
          <div className="register-view__handoff-actions">
            <button type="button" onClick={() => void handleBackupBeforeReplace()}>
              Save a backup of mine first
            </button>
            <button type="button" onClick={handleKeepRegister}>
              Keep my register
            </button>
          </div>
        )}
        {pendingReplace !== null && backupReady && !awaitingFinish && (
          <div className="register-view__handoff-actions">
            <button type="button" onClick={() => void handleConfirmReplace()}>
              I have my backup — replace my register
            </button>
            <button type="button" onClick={handleKeepRegister}>
              Keep my register
            </button>
          </div>
        )}
        {pendingReplace !== null && awaitingFinish && (
          <div className="register-view__handoff-actions">
            <button type="button" onClick={() => void handleFinishRegisterReplace()}>
              Finish updating the register
            </button>
          </div>
        )}
      </div>

      {/* register-lifecycle.md §9 (LC-6) — firm-wide governance concerns,
          shown regardless of 1LoD/2LoD role (only render-able when the
          Counterpoise row is present in this role's fetched scope at all). */}
      {aigateRow?.current_verdict_status === 'rejected' && (
        <div className="register-view__banner register-view__banner--alert" role="alert">
          Counterpoise does not satisfy its own controls — policy review required
        </div>
      )}
      {aigateRow?.current_verdict_status !== 'rejected' && aigateRow?.lifecycle_stage === 'pre_checked' && (
        <div className="register-view__banner" role="status">
          Counterpoise self-assessment pending 2LoD approval — verdicts are provisional until cleared.
        </div>
      )}

      {decidedRows.length > 0 && (
        <div className="register-view__banner register-view__provisional-banner" role="note">
          {signoffGapOnlyCount} of {decidedRows.length} verdicts here would be final once outstanding
          sign-offs land.
        </div>
      )}

      {is2LoD && policyUpdatePending && (
        <div className="register-view__banner" role="status">
          Policy updated — some assessments may need re-evaluation.
        </div>
      )}

      {/* design-review round 4 (Panel G — Register list, Critical): 1LoD got
          no "what needs my attention" signal at all — the legend and the
          Flags column (the one place stale/attention-needed rows are
          surfaced) were both is2LoD-gated, leaving a first-time submitter a
          flat, unexplained table. 2LoD has a queue concept (awaiting
          sign-off); 1LoD doesn't, so this is a count, not a toggle. */}
      {!is2LoD &&
        (() => {
          const attention = rows.filter((r) => r.current_verdict_status === 'rejected' || r.stale_assessment);
          return attention.length > 0 ? (
            <p className="register-view__showing-line" role="status">
              {/* code-review-004 F2: "rejected" reworded to "declined" — the
                  reserved-word gate (/approved|rejected/i, CLAUDE.md) applies
                  to every rendered string, and this line was the one new
                  violation today's diff introduced. Same vocabulary as
                  field-copy.ts's ACTION_LABEL ("Sign-off declined"). */}
              {attention.length} of {rows.length} need your attention — declined or stale.
            </p>
          ) : null;
        })()}

      {is2LoD && (
        <p className="register-view__showing-line" role="status">
          {showAll ? (
            <>
              Showing: all {rows.length}{' '}
              <button type="button" className="register-view__show-all-toggle" onClick={() => setShowAll(false)}>
                Show only awaiting sign-off ({awaitingSignoffRows.length})
              </button>
            </>
          ) : (
            <>
              Showing: awaiting your sign-off ({awaitingSignoffRows.length}){' '}
              <button type="button" className="register-view__show-all-toggle" onClick={() => setShowAll(true)}>
                Show all ({rows.length})
              </button>
            </>
          )}
        </p>
      )}

      {is2LoD && (
        <div className="register-view__controls">
          <div className="register-view__controls-row">
            <input
              type="text"
              placeholder="Search use cases…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search use cases"
            />
            <button type="button" className="register-view__export-button" onClick={() => void handleExport()}>
              Export JSON
            </button>
          </div>
          <div className="register-view__chips">
            <span className="register-view__chip-group-label">Tier:</span>
            {tiers.map((tier) => (
              <button
                key={tier}
                type="button"
                className={tierFilter === tier ? 'chip chip--active' : 'chip'}
                onClick={() => setTierFilter(tierFilter === tier ? null : tier)}
              >
                {tier}
              </button>
            ))}
            <span className="register-view__chip-group-label">Track:</span>
            {tracks.map((track) => (
              <button
                key={track}
                type="button"
                className={trackFilter === track ? 'chip chip--active' : 'chip'}
                onClick={() => setTrackFilter(trackFilter === track ? null : track)}
              >
                Track {track}
              </button>
            ))}
            <span className="register-view__chip-group-label">Stage:</span>
            {stages.map((stage) => (
              <button
                key={stage}
                type="button"
                className={stageFilter === stage ? 'chip chip--active' : 'chip'}
                onClick={() => setStageFilter(stageFilter === stage ? null : stage)}
              >
                {STAGE_LABELS[stage]}
              </button>
            ))}
            <span className="register-view__chip-group-label">Verdict:</span>
            {statuses.map((status) => (
              <button
                key={status}
                type="button"
                className={statusFilter === status ? 'chip chip--active' : 'chip'}
                onClick={() => setStatusFilter(statusFilter === status ? null : status)}
              >
                {STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* design-review round 4 (Panel G, Important): the legend explaining
          Tier/Track/Stage/Verdict was gated behind is2LoD along with the
          filter controls — but the column headers it explains render for
          every role. Moved out of the is2LoD block so both roles see it. */}
      <dl className="register-view__legend">
        <dt>Legend</dt>
        <dd>
          Tier = how much could go wrong — Critical, High and Medium wait for second-line sign-off; Low is
          self-service.
        </dd>
        <dd>
          Track = which oversight regime applies — I classic model risk · II extra scrutiny · III AI governance.
        </dd>
        <dd>
          Stage = where the case is in its life. Verdict = what the rules decided; &quot;Provisional&quot; means
          the rulebook behind it is not yet signed off by your firm.
        </dd>
      </dl>

      <table>
        <thead>
          <tr>
            <th>Use Case Name</th>
            {is2LoD && <th>Submitter</th>}
            <th>Tier</th>
            <th>Track</th>
            <th>Status</th>
            <th>Stage</th>
            <th>Last Evaluated</th>
            <th>Policy Version</th>
            {/* design-review round 4 (Panel G, Critical): Flags was the one
                column engineered to say "look here" and it was invisible to
                1LoD entirely — a 1LoD user whose own case went stale had no
                way to see that from this list. */}
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => {
            const isSelfAssessment = row.use_case_id === AIGATE_USE_CASE_ID;
            return (
            <tr
              key={row.use_case_id}
              className={
                isSelfAssessment ? 'register-view__row register-view__row--self-assessment' : 'register-view__row'
              }
              onClick={() => onSelectRow(row.use_case_id)}
            >
              <td>
                {/* CR7-07: the row click needs a mouse; the case name is a real
                    button so keyboard and screen-reader users can open a case. */}
                <button
                  type="button"
                  className="register-view__case-link"
                  // M-4: a name that stays unique when labels repeat (tier and
                  // stage are what tell two same-named cases apart).
                  aria-label={`${row.label} — ${row.tier ?? 'no'} tier, ${STAGE_LABELS[row.lifecycle_stage]}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectRow(row.use_case_id);
                  }}
                >
                  {row.label}
                </button>
                {isSelfAssessment && (
                  <span className="register-view__self-assessment-tag">self-assessment</span>
                )}
              </td>
              {is2LoD && <td>{row.submitted_by}</td>}
              <td>{row.tier ?? '—'}</td>
              <td>{row.track ?? '—'}</td>
              <td>
                {row.current_verdict_status ? STATUS_LABEL[row.current_verdict_status] : '—'}
                {/* §13.3: the qualifier sits ALONGSIDE the outcome. Replacing
                    the outcome with it hid what was actually decided. */}
                {row.provisional && <span className="register-provisional"> · Provisional</span>}
              </td>
              <td>
                <span
                  className={`register-stage register-stage--${row.lifecycle_stage}`}
                  data-stage={row.lifecycle_stage}
                >
                  {STAGE_LABELS[row.lifecycle_stage]}
                </span>
              </td>
              <td>{row.last_evaluated_at ? new Date(row.last_evaluated_at).toLocaleDateString() : '—'}</td>
              <td>{row.policy_version_at_evaluation ?? '—'}</td>
              <td>
                {row.stale_assessment || row.sampling_review_due ? (
                  <>
                    {row.stale_assessment && <span className="register-view__stale-badge">Stale</span>}
                    {row.sampling_review_due && (
                      <span className="register-view__sampling-badge">sampling review due</span>
                    )}
                  </>
                ) : (
                  <span className="register-view__flags-empty" aria-label="not flagged" />
                )}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
