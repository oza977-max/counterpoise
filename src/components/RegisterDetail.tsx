import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getUseCase, updateLifecycleStage, findLatestVerdictEvent, getGraph } from '../store/register';
import { getAll as getAuditEvents, append as appendAuditEvent, verifyChain } from '../store/audit';
import type { ChainVerification } from '../store/audit';
import VerdictDisplay from './VerdictDisplay';
import type { AssumptionRecord, AuditEvent, RegisterEdge, UseCaseSummary } from '../store/types';
import { registerSaysNoModelNamed } from './verdict-view-model';
import type { PolicyFile } from '../engine/types';
import { getPackSources, loadPackSet } from '../store/pack-source';
import type { Verdict } from '../types/verdict';
import { RATING_INSTRUCTION_AUDIT_LINE } from './plain-copy';
import { TIER_MEANINGS, TRACK_MEANINGS, STAGE_LABELS, ACTION_LABEL, STATUS_LABEL } from './field-copy';
import { findRuleDescription } from '../engine/find-rule-description';
import { findPrecedents } from '../engine/precedent';
import type { PrecedentCandidate } from '../engine/precedent';
import SimilarCases from './SimilarCases';
import type { EnrichedPrecedent } from './SimilarCases';
import { getUseCases } from '../store/register';
import type { KnowledgeMatch } from '../engine/knowledge-lens';
import { loadKnowledgeLens } from '../store/knowledge-lens-loader';
import { getCurrentKnowledgeLensYaml } from '../store/knowledge-lens-source';
import KnowledgeLensPanel from './KnowledgeLensPanel';

// V1.2-A (design-gap-audit B3/B4/B5/B6). Rule 4 (cross-cutting.md §7):
// presentation-only — renders the REAL audit store via getAll()
// (BC-V12A-01), and wires the 2LoD actions to existing store functions
// (BC-V12A-02/-04: append + updateLifecycleStage, no hand-rolled writes).
interface RegisterDetailProps {
  useCaseId: string;
  role: string;
  // P8-C07 (§15.1a). Threaded App -> RegisterView -> RegisterDetail. Optional
  // because control evidence status degrades to "unknown" without it —
  // absence of a policy is not evidence of absent evidence.
  policy?: PolicyFile;
  onBack: () => void;
}

// Per-type detail lines derived from the real payload union — never a
// generic JSON dump (build/prompts/V1.2-A.md scope decision 6). Exported for
// the fallback test only (code-review-005 F13).
const CORRECTION_SOURCE_WORDS: Record<string, string> = {
  form: 'the form',
  review: 'the review screen',
  question: 'an answer to a question',
};

// CR7-30b: a value that was never stated (null — what the writers record now —
// or absent, which is how a JSON round-trip stores an old `undefined`) reads
// "not stated"; every real value, including 0 and false, shows as itself.
function valueWords(v: unknown): string {
  return v === null || v === undefined ? 'not stated' : String(v);
}

// `viewerRole`: another case's name (the matched label in the duplicate /
// adoption lines) is shown to 2LoD only (CR7-10c) — a 1LoD user is limited to
// their own cases elsewhere, so the trail must not reveal another one's name.
export function eventDetail(event: AuditEvent, viewerRole?: string): string {
  const p = event.payload as AuditEvent['payload'] | undefined | null;
  // code-review-005 F13: a damaged record can lack its payload entirely —
  // reading `.type` off it would crash the whole case page, not just one line.
  if (!p || typeof p !== 'object') return unrecognisedEventLine(event.event_type);
  switch (p.type) {
    case 'use_case_created':
      return `${p.description} (intake: ${p.intake_method})`;
    case 'graph_confirmed':
      // GT7 L-1: a fixed sentence for every role — the phrases themselves are not quoted here.
      return `Attested. Graph v${p.graph_version}, ${p.corrections_count} correction${p.corrections_count === 1 ? '' : 's'}.${assumptionsCountClause(p.assumptions)}${
        Array.isArray(p.rating_instructions) && p.rating_instructions.length > 0 ? ` ${RATING_INSTRUCTION_AUDIT_LINE}` : ''
      }${
        p.contradiction_resolutions && p.contradiction_resolutions.length > 0
          ? ` ${p.contradiction_resolutions.length} contradiction${p.contradiction_resolutions.length === 1 ? '' : 's'} resolved: ${p.contradiction_resolutions.map((n) => `“${n}”`).join(' · ')}`
          : ''
      }`;
    case 'graph_corrected':
      // CR6-10: where the correction was made, in plain words; nothing when
      // the record predates the field.
      return `${p.correction.field} corrected: ${valueWords(p.correction.original_value)} → ${valueWords(p.correction.corrected_value)}${
        p.correction.correction_source ? ` (from ${CORRECTION_SOURCE_WORDS[p.correction.correction_source] ?? 'an unrecorded place'})` : ''
      }`;
    case 'verdict_produced':
      return `${STATUS_LABEL[p.verdict.status] ?? p.verdict.status} · ${p.verdict.tier} · Track ${p.verdict.track}.${
        p.verdict.binding_constraint ? ` Binding: ${p.verdict.binding_constraint}.` : ''
      } Policy v${p.verdict.policy_version}.`;
    case 'verdict_corrected':
      // R16-D2 §8 (F2C-6): a zero-correction resubmission wrote no
      // graph_corrected events — say so, rather than let the status line
      // alone imply something had changed. `=== 0`, never `!p.corrections_count`:
      // a pre-D2 event lacking the field is honestly unknown, not zero.
      return `${p.corrections_count === 0 ? 'Re-checked — no answers changed. ' : ''}${
        STATUS_LABEL[p.new_verdict.status] ?? p.new_verdict.status
      } · ${p.new_verdict.tier} · Track ${p.new_verdict.track}. Supersedes verdict ${p.original_verdict_id.slice(0, 8)}…${assumptionsCountClause(p.assumptions)}`;
    case 'lifecycle_stage_changed':
      // design-review-003 (Panel B): this used to print the raw enum
      // ("pre_checked → approved") while the stage chip two sections above,
      // for the same field, correctly shows "Awaiting 2LoD sign-off" /
      // "Cleared" via STAGE_LABELS — a direct visible self-contradiction.
      return `${STAGE_LABELS[p.from_stage]} → ${STAGE_LABELS[p.to_stage]}`;
    case 're_evaluation_queued':
      return `Policy updated to v${p.policy_version} — re-evaluation queued. Stage unchanged.`;
    case 'twoloD_reviewed':
      // The name is what makes this attributable rather than anonymous, so it
      // leads. "(name not verified)" is not a hedge — this build has no
      // sign-in, and a trail that implied otherwise would claim more than it
      // can support.
      // design-review-003 (Panel B, verified against source): p.action's raw
      // value included the literal word "rejected" — a live violation of the
      // reserved-word gate (G1). ACTION_LABEL fixes it the same way
      // STAGE_LABELS already fixes the identical class of problem.
      return `${ACTION_LABEL[p.action]}${
        p.attested_by_name ? ` by ${p.attested_by_name} (name not verified)` : ' — no name recorded'
      }${p.notes ? ` — ${p.notes}` : ''}`;
    case 'reasoning_trace_generated':
      return 'Plain-English reasoning trace generated and stored with the verdict.';
    case 'duplicate_dismissed':
      return viewerRole === '2LoD'
        ? `Similar use case reviewed and dismissed: ${p.candidate_label} (${p.candidate_use_case_id.slice(0, 8)}…).`
        : `Similar use case reviewed and dismissed (${p.candidate_use_case_id.slice(0, 8)}…).`;
    case 'classification_adopted':
      return `Classification adopted from ${viewerRole === '2LoD' ? `${p.adopted_from_label} ` : 'a similar use case '}(${p.adopted_from_use_case_id.slice(0, 8)}…) — tier ${
        p.tier ?? '—'
      }, track ${p.track ?? '—'}. No evaluation was run for this record.`;
    case 'rule_dissent_filed':
      // "name not verified" for the same reason as twoloD_reviewed: no sign-in.
      return `Rule ${p.rule_id} challenged by ${p.filed_by_name} (name not verified): “${p.dissent}” Advisory — the verdict stands unchanged; the challenge goes to the rule-improvement queue.`;
    case 'sampling_reviewed':
      // R12-AB-1: the automation-bias countermeasure — a deterministically
      // sampled self-served verdict got its human spot review.
      return `Sampling review of verdict ${p.verdict_id.slice(0, 8)}… by ${p.reviewed_by_name} (name not verified)${p.outcome_note ? ` — ${p.outcome_note}` : ''}. Spot check of a self-served case; the verdict stands unchanged unless separately corrected.`;
    case 'control_ownership_assigned':
      return `Control ${p.control_id} assigned to ${p.owner_name} (name not verified) — target date ${p.target_date}.`;
    case 'control_evidence_attested':
      return `Control ${p.control_id} attested in place by ${p.attested_by_name} (name not verified) — evidence: “${p.evidence_note}”. A reviewer’s attestation on the record, not a machine check.`;
    default:
      // code-review-005 F13: the switch covers every type this version knows,
      // but stored events are data, not types — an event written by another
      // version of Counterpoise, or a damaged record, must still show as a line that
      // says what it is, never as a blank row in the evidence trail.
      return unrecognisedEventLine((p as { type?: unknown }).type ?? event.event_type);
  }
}

function unrecognisedEventLine(type: unknown): string {
  return `Unrecognised event type “${String(type)}” — it is on the record, but this version of Counterpoise can’t display it.`;
}

// R16-D2 §4 (D-81). Shared by graph_confirmed and verdict_corrected's own
// eventDetail lines — a count of how many of this attestation's own
// answers were "Not sure", shown only when present and non-empty (an
// older event, or one with no assumptions at all, adds nothing).
function assumptionsCountClause(assumptions: AssumptionRecord[] | undefined): string {
  if (!assumptions || assumptions.length === 0) return '';
  const n = assumptions.length;
  return ` ${n} answer${n === 1 ? '' : 's'} ${n === 1 ? 'was' : 'were'} “Not sure”.`;
}

// F-4 (DR7-12, DR7-16). Before this, only the first attestation
// (graph_confirmed) ever wrote submitter_note/contradiction_resolutions/
// answer_contexts, and this page read them only from that same event — so
// a correction (verdict_corrected) silently dropped whatever the person
// typed, even once the payload could carry it. This is the one place that
// decides which event recorded whatever the CURRENT verdict is: the
// latest verdict_corrected when the current verdict came from a
// correction, else the case's graph_confirmed — mirroring
// register.ts's findLatestVerdictEvent's own
// verdict_produced-vs-verdict_corrected precedence. One helper, used for
// all three fields (a future "No" screen can add `assumptions` through
// the same helper).
export function currentVerdictAttestationFields(events: AuditEvent[]): {
  submitter_note?: string;
  contradiction_resolutions?: string[];
  answer_contexts?: string[];
  // R16-D2 §4 (D-81, DR7-16): added through this SAME helper, as the
  // comment above already anticipated — the case's "Not sure" answers,
  // read from whichever event recorded the CURRENT verdict.
  assumptions?: AssumptionRecord[];
} {
  const reversed = [...events].reverse();
  const latestCorrection = reversed.find((e) => e.payload.type === 'verdict_corrected');
  if (latestCorrection && latestCorrection.payload.type === 'verdict_corrected') {
    const p = latestCorrection.payload;
    return {
      submitter_note: p.submitter_note,
      contradiction_resolutions: p.contradiction_resolutions,
      answer_contexts: p.answer_contexts,
      assumptions: p.assumptions,
    };
  }
  const confirmed = reversed.find((e) => e.payload.type === 'graph_confirmed');
  if (confirmed && confirmed.payload.type === 'graph_confirmed') {
    const p = confirmed.payload;
    return {
      submitter_note: p.submitter_note,
      contradiction_resolutions: p.contradiction_resolutions,
      answer_contexts: p.answer_contexts,
      assumptions: p.assumptions,
    };
  }
  return {};
}

export default function RegisterDetail({ useCaseId, role, policy, onBack }: RegisterDetailProps) {
  const [summary, setSummary] = useState<UseCaseSummary | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  // code-review-005 round 2, N4: load() had no error path at all — a
  // malformed stored verdict (e.g. one a hand-off bundle let through before
  // this round's schema hardening, or any other corrupt row) makes
  // getUseCase() reject, and with nothing catching that, `summary` just
  // never leaves its initial `null` — the page sits on "Loading…" forever,
  // indistinguishable from a slow read. A visible error, with the way back,
  // replaces the endless spinner.
  const [loadError, setLoadError] = useState<string | null>(null);
  // explore-007 D-001 fix (round 8): a live, provable check — not just an
  // assertion in copy — that the hash chain over the WHOLE audit trail
  // (every use case, not just this one) is intact.
  const [modelLinks, setModelLinks] = useState<{ createdAt: string | undefined; edges: RegisterEdge[]; unrecorded: boolean } | null>(null);
  const [chainCheck, setChainCheck] = useState<ChainVerification | null>(null);
  const [notes, setNotes] = useState('');
  const [attestedByName, setAttestedByName] = useState('');
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Review finding, pass 1: a double-click fires the async handler twice
  // before React re-renders the disabled state, writing DUPLICATE events
  // into the append-only audit trail — which cannot be cleaned up by
  // design (VD-4/NF-2). A ref is synchronous where state is not (same
  // lesson as P7-C01's in-flight seed guard).
  const inFlight = useRef(false);

  // Rule dissent (FN-009). Separate state and a separate in-flight ref from
  // the sign-off actions: a dissent is not a sign-off, and sharing the guard
  // would let a slow dissent write block an Approve (or vice versa) for no
  // data-integrity reason. The same double-click hazard applies, though —
  // a duplicate dissent in an append-only trail cannot be cleaned up.
  const [dissentOpen, setDissentOpen] = useState(false);
  const [dissentRuleId, setDissentRuleId] = useState('');
  const [dissentOtherRef, setDissentOtherRef] = useState('');
  const [dissentText, setDissentText] = useState('');
  const [dissentByName, setDissentByName] = useState('');
  const [dissentResult, setDissentResult] = useState<string | null>(null);
  const [dissentError, setDissentError] = useState<string | null>(null);
  const [dissentBusy, setDissentBusy] = useState(false);
  const dissentInFlight = useRef(false);

  // ADR-RL-R3-1: READ the verdict from the audit trail the page already
  // loads. Never recompute — the verdict a reviewer signs must be the one
  // that was produced and attested, not a fresh one against today's policy,
  // which would silently show something different after any policy change.
  // The scan is the exported helper (P8-C06), not a third copy of it.
  const latestVerdict = useMemo(() => {
    const payload = findLatestVerdictEvent(events);
    if (!payload) return null;
    return payload.type === 'verdict_produced' ? payload.verdict : payload.new_verdict;
  }, [events]);

  // R16-D2 §4b (D-97, W-7). Read from the SAME event findLatestVerdictEvent
  // already resolves above — the register's own substitute for `graph`
  // (not persisted on the register entry), so a scoped "already verified"
  // safeguard can still be told from an outstanding one here, agreeing
  // with what the intake result screen showed. Absent on a legacy event,
  // which renders the honest "we couldn't check" note, same as today.
  const evidenceScope = useMemo(() => {
    const payload = findLatestVerdictEvent(events);
    return payload?.evidence_scope;
  }, [events]);

  // R16-D2 §2/§8. Loaded independently of `policy` (a prop, owned by
  // App.tsx) the same way IntakeFlow.tsx loads its own copy — packs are
  // needed only to resolve a pack hard line's plain_reason/plain_change
  // and jurisdiction name on a "No" screen, never to re-decide anything
  // evaluate() already settled.
  const loadedPacks = useMemo(() => loadPackSet(getPackSources()).packs, []);

  // R16-D2 §6 (DR7-09, D2 part). How many times this case has been
  // corrected — every version stays in the record below; this just makes
  // repeated re-answering visible to the person who signs off.
  const correctionCount = useMemo(
    () => events.filter((e) => e.payload.type === 'verdict_corrected').length,
    [events],
  );

  // The rules a challenge can point at: the ones THIS verdict relied on,
  // read from its own explanation — never recomputed against today's policy
  // (same reasoning as ADR-RL-R3-1 for the verdict itself). A challenger who
  // wants a rule outside this list types its reference explicitly, so a
  // free-typed id is a visible choice rather than a silent fallback.
  const challengeableRules = useMemo(() => {
    if (!latestVerdict) return [];
    const seen = new Map<string, string>();
    const add = (id?: string | null, label?: string) => {
      if (id && !seen.has(id)) seen.set(id, label ?? id);
    };
    const ex = latestVerdict.explanation;
    if (ex) {
      add(ex.tier_rationale?.rule_id, ex.tier_rationale?.rule_name);
      add(ex.track_rationale?.rule_id, ex.track_rationale?.rule_name);
      for (const t of ex.tripped_invariants) add(t.id, t.description);
      for (const r of ex.regulatory_chain ?? []) add(r.rule_id);
    }
    // design-review-003 (Panel B): this used to add binding_constraint with
    // no label, falling back to the bare id in the challenge dropdown —
    // same fix as the sign-off checklist, applied here too.
    add(latestVerdict.binding_constraint || null, findRuleDescription(policy, latestVerdict.binding_constraint) ?? undefined);
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [latestVerdict, policy]);

  // R11-KL-2/-3 (requirements-011.md; evaluation-engine.md §14
  // ADR-EE-R11-1/-2). Advisory-only, read-only until the reviewer taps
  // "file as coverage gap" — never fed into evaluate() and never derived
  // from it. The full graph is not persisted on the register entry
  // (ADR-RL-R3-1 consequences, same reason `graph` is not passed to
  // VerdictDisplay above), so condition-matching against the graph cannot
  // be redone here; instead this reads the entry ids the lens matched AT
  // EVALUATION TIME (IntakeFlow, which does have the graph), carried
  // beside the verdict on the verdict_produced/verdict_corrected event, and
  // resolves them against the currently-loaded lens entries. `covered` is
  // recomputed fresh here (not persisted) against THIS verdict's own rule
  // ids, exactly like `challengeableRules` above.
  const knowledgeLensResult = useMemo(() => loadKnowledgeLens(getCurrentKnowledgeLensYaml()), []);
  const knowledgeLensEntries = useMemo(
    () => (knowledgeLensResult.valid ? knowledgeLensResult.entries : []),
    [knowledgeLensResult],
  );
  const knowledgeLensMeta = knowledgeLensResult.valid ? knowledgeLensResult.meta : undefined;
  const knowledgeLensMatches = useMemo<KnowledgeMatch[]>(() => {
    if (!latestVerdict) return [];
    const payload = findLatestVerdictEvent(events);
    const matchedIds = payload
      ? payload.type === 'verdict_produced'
        ? payload.knowledge_lens_matched_entry_ids
        : payload.knowledge_lens_matched_entry_ids
      : undefined;
    if (!matchedIds || matchedIds.length === 0) return [];
    const ruleIds = new Set(challengeableRules.map((r) => r.id));
    return knowledgeLensEntries
      .filter((entry) => matchedIds.includes(entry.id))
      .map((entry) => ({
        entry,
        covered: entry.covering_rule_ids.some((id) => ruleIds.has(id)),
      }))
      .sort((a, b) => a.entry.id.localeCompare(b.entry.id));
  }, [latestVerdict, events, knowledgeLensEntries, challengeableRules]);

  const [gapBusyEntryId, setGapBusyEntryId] = useState<string | null>(null);
  const [gapError, setGapError] = useState<string | null>(null);
  const gapInFlight = useRef(false);

  // design-vision.md L-6 / explore-007 D-003 follow-up: same busy/error/
  // in-flight-guard shape as the gap-filing state above.
  const [controlOwnerBusyId, setControlOwnerBusyId] = useState<string | null>(null);
  const [controlOwnerErrorId, setControlOwnerErrorId] = useState<string | null>(null);
  const [controlOwnerError, setControlOwnerError] = useState<string | null>(null);
  const controlOwnerInFlight = useRef(false);

  // Latest control_ownership_assigned event per control_id for the current
  // verdict — re-assigning is a later event, so "latest" (by occurred_at
  // order, which is append order) is the one the UI shows.
  const controlOwnership = useMemo(() => {
    const result: Record<string, { owner_name: string; target_date: string }> = {};
    for (const e of events) {
      if (e.payload.type === 'control_ownership_assigned' && e.payload.verdict_id === latestVerdict?.id) {
        result[e.payload.control_id] = {
          owner_name: e.payload.owner_name,
          target_date: e.payload.target_date,
        };
      }
    }
    return result;
  }, [events, latestVerdict?.id]);

  // code-review-004 F10: assignments are keyed to the verdict they were made
  // against, so a re-evaluation (new verdict id) makes prior assignments
  // vanish from the panel with no explanation — user-entered compliance data
  // silently disappearing. Carrying them forward automatically would claim
  // an assignment against a verdict nobody made it on, so instead the reset
  // is SAID out loud: if any earlier verdict of this case carries an
  // assignment for a control the current verdict still names but has no
  // current assignment for, a notice renders. The trail keeps everything;
  // this just points at it.
  const priorVerdictAssignments = useMemo(() => {
    if (!latestVerdict) return [];
    const currentControls = new Set(latestVerdict.controls ?? []);
    const orphaned = new Map<string, string>();
    for (const e of events) {
      if (
        e.payload.type === 'control_ownership_assigned' &&
        e.payload.verdict_id !== latestVerdict.id &&
        currentControls.has(e.payload.control_id) &&
        !(e.payload.control_id in controlOwnership)
      ) {
        orphaned.set(e.payload.control_id, e.payload.owner_name);
      }
    }
    return [...orphaned.entries()];
  }, [events, latestVerdict, controlOwnership]);

  // RG-9 control-evidence attestation state — tracked PER CONTROL, not as one
  // shared value. code-review-005 F19: a single shared ref/state meant
  // attesting control B while control A's write was still in flight was
  // either silently dropped (the ref guard) or clobbered A's busy/error
  // display (the state) — both are now keyed by control id, so two controls
  // can be mid-save (or mid-error) at once without stepping on each other.
  const [controlEvidenceBusyIds, setControlEvidenceBusyIds] = useState<Set<string>>(new Set());
  const [controlEvidenceErrors, setControlEvidenceErrors] = useState<Map<string, string>>(new Map());
  const controlEvidenceInFlight = useRef<Set<string>>(new Set());

  // Latest control_evidence_attested event per control_id for the current
  // verdict. Re-attesting is a later event; the UI reads the latest.
  const controlAttestations = useMemo(() => {
    const result: Record<string, { attested_by_name: string; evidence_note: string }> = {};
    for (const e of events) {
      if (e.payload.type === 'control_evidence_attested' && e.payload.verdict_id === latestVerdict?.id) {
        result[e.payload.control_id] = {
          attested_by_name: e.payload.attested_by_name,
          evidence_note: e.payload.evidence_note,
        };
      }
    }
    return result;
  }, [events, latestVerdict?.id]);

  // code-review-005 F19. Returns whether the attestation was actually
  // recorded, so the caller (ControlEvidenceAttest, via VerdictDisplay) knows
  // whether to close its form or keep it open with the error visible — it
  // must not close on a dropped or failed write as if the write had
  // succeeded. Guarded and tracked per controlId (a Set/Map, not one shared
  // ref/state): attesting control B while control A is still saving must
  // proceed and be recorded, not be silently refused because the file-wide
  // guard was still held by A.
  async function handleAttestControlEvidence(controlId: string, attestedByName: string, evidenceNote: string): Promise<boolean> {
    if (controlEvidenceInFlight.current.has(controlId)) return false;
    controlEvidenceInFlight.current.add(controlId);
    setControlEvidenceBusyIds((prev) => new Set(prev).add(controlId));
    setControlEvidenceErrors((prev) => {
      if (!prev.has(controlId)) return prev;
      const next = new Map(prev);
      next.delete(controlId);
      return next;
    });
    try {
      if (!latestVerdict) {
        setControlEvidenceErrors((prev) => new Map(prev).set(controlId, 'No verdict is loaded for this case, so the attestation was not recorded. Reload and try again.'));
        return false;
      }
      await appendAuditEvent({
        event_id: crypto.randomUUID(),
        use_case_id: useCaseId,
        event_type: 'control_evidence_attested',
        occurred_at: new Date().toISOString(),
        actor: role,
        payload: {
          type: 'control_evidence_attested',
          verdict_id: latestVerdict.id,
          control_id: controlId,
          attested_by_name: attestedByName,
          evidence_note: evidenceNote,
        },
      });
      await load();
      return true;
    } catch (err) {
      setControlEvidenceErrors((prev) => new Map(prev).set(controlId, `Recording the attestation failed: ${err instanceof Error ? err.message : String(err)}.`));
      return false;
    } finally {
      controlEvidenceInFlight.current.delete(controlId);
      setControlEvidenceBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(controlId);
        return next;
      });
    }
  }

  async function handleAssignControlOwner(controlId: string, ownerName: string, targetDate: string) {
    if (controlOwnerInFlight.current) return;
    controlOwnerInFlight.current = true;
    setControlOwnerBusyId(controlId);
    setControlOwnerErrorId(null);
    setControlOwnerError(null);
    try {
      if (!latestVerdict) {
        // code-review-004 F13: this was a bare `return` — busy cleared via
        // finally, nothing recorded, no message: a swallowed failure. The
        // branch should be unreachable (the assign form only renders under
        // a verdict), which is exactly why it must SAY something if reached.
        setControlOwnerErrorId(controlId);
        setControlOwnerError('No verdict is loaded for this case, so the assignment was not recorded. Reload and try again.');
        return;
      }
      await appendAuditEvent({
        event_id: crypto.randomUUID(),
        use_case_id: useCaseId,
        event_type: 'control_ownership_assigned',
        occurred_at: new Date().toISOString(),
        actor: role,
        payload: {
          type: 'control_ownership_assigned',
          verdict_id: latestVerdict.id,
          control_id: controlId,
          owner_name: ownerName,
          target_date: targetDate,
        },
      });
      await load();
    } catch (err) {
      setControlOwnerErrorId(controlId);
      setControlOwnerError(`Assigning an owner failed: ${err instanceof Error ? err.message : String(err)}.`);
    } finally {
      controlOwnerInFlight.current = false;
      setControlOwnerBusyId(null);
    }
  }

  // R13-UI-3: gap filings already on this case's trail — the persistent
  // "Filed" state the panel renders. Derived from events (re-read after
  // each write), never local-only state a reload would forget.
  const filedRiskDomains = useMemo(
    () =>
      events
        .filter((e) => e.payload.type === 'rule_dissent_filed')
        .map((e) => (e.payload.type === 'rule_dissent_filed' ? e.payload.rule_id : ''))
        .filter(Boolean),
    [events],
  );

  // explore-007 D-003 fix (round 8): filing a coverage gap used to be the
  // whole control — a queue entry nobody was prompted to read, no
  // notification, no age, no visibility on this screen. The date a domain
  // was filed, so the top-of-page notice can say how long it's been open,
  // not just that it exists.
  const filedRiskDomainDates = useMemo(() => {
    const dates = new Map<string, string>();
    for (const e of events) {
      if (e.payload.type === 'rule_dissent_filed' && e.payload.rule_id) {
        const existing = dates.get(e.payload.rule_id);
        if (!existing || e.occurred_at < existing) dates.set(e.payload.rule_id, e.occurred_at);
      }
    }
    return dates;
  }, [events]);

  function daysOpen(entryId: string): number | null {
    const filedAt = filedRiskDomainDates.get(entryId);
    if (!filedAt) return null;
    return Math.floor((Date.now() - new Date(filedAt).getTime()) / (24 * 60 * 60 * 1000));
  }

  // R13-UI-4: a verdict stored BEFORE the lens existed carries no
  // knowledge_lens_matched_entry_ids field at all — a different claim from
  // "matched nothing", and the reader must be able to tell them apart.
  const lensNotEvaluated = useMemo(() => {
    const payload = findLatestVerdictEvent(events);
    return !!payload && payload.knowledge_lens_matched_entry_ids === undefined;
  }, [events]);

  // R12-AB-1 (ADR-VA-R12-1): the sampling spot-review panel. Same
  // double-click hazard as every other append-only write here — a
  // synchronous ref guard, copying handleFileDissent's exact pattern.
  const [samplingReviewerName, setSamplingReviewerName] = useState('');
  const [samplingNote, setSamplingNote] = useState('');
  const [samplingBusy, setSamplingBusy] = useState(false);
  const [samplingError, setSamplingError] = useState<string | null>(null);
  const [samplingResult, setSamplingResult] = useState<string | null>(null);
  const samplingInFlight = useRef(false);

  async function handleSamplingReview() {
    if (samplingInFlight.current) return;
    samplingInFlight.current = true;
    setSamplingBusy(true);
    setSamplingError(null);
    try {
      if (!latestVerdict) {
        setSamplingError('There is no verdict here, so there is nothing to spot-review.');
        return;
      }
      if (!samplingReviewerName.trim()) {
        setSamplingError('Enter your name. The spot review is recorded permanently, so the record says who did it.');
        return;
      }
      await appendAuditEvent({
        event_id: crypto.randomUUID(),
        use_case_id: useCaseId,
        event_type: 'sampling_reviewed',
        occurred_at: new Date().toISOString(),
        actor: role,
        payload: {
          type: 'sampling_reviewed',
          verdict_id: latestVerdict.id,
          reviewed_by_name: samplingReviewerName.trim(),
          ...(samplingNote.trim() ? { outcome_note: samplingNote.trim() } : {}),
        },
      });
      setSamplingResult('Sampling review recorded in the audit trail.');
      setSamplingReviewerName('');
      setSamplingNote('');
      await load();
    } catch (err) {
      setSamplingError(`Recording the review failed: ${err instanceof Error ? err.message : String(err)}.`);
      await load();
    } finally {
      samplingInFlight.current = false;
      setSamplingBusy(false);
    }
  }

  // ADR-EE-R11-2: reuses handleFileDissent's exact write path — the same
  // event type (`rule_dissent_filed`), the same appendAuditEvent call
  // shape, no new event type. `rule_id` carries the risk_domain (not a
  // rule id) so the record is honest about what is being filed. One click
  // writes exactly one event (R4's advisory-by-construction guarantee).
  async function handleFileKnowledgeGap(match: KnowledgeMatch) {
    if (gapInFlight.current) return;
    gapInFlight.current = true;
    setGapBusyEntryId(match.entry.id);
    setGapError(null);
    try {
      if (!latestVerdict) return;
      await appendAuditEvent({
        event_id: crypto.randomUUID(),
        use_case_id: useCaseId,
        event_type: 'rule_dissent_filed',
        occurred_at: new Date().toISOString(),
        actor: role,
        payload: {
          type: 'rule_dissent_filed',
          verdict_id: latestVerdict.id,
          rule_id: match.entry.risk_domain,
          dissent: `Coverage gap: no firm or pack rule currently addresses ${match.entry.risk_domain} (${match.entry.risk_subdomain}).`,
          filed_by_name: `${role} (risk-knowledge lens, ${match.entry.source_attribution})`,
        },
      });
      await load();
    } catch (err) {
      setGapError(`Filing the coverage gap failed: ${err instanceof Error ? err.message : String(err)}.`);
    } finally {
      gapInFlight.current = false;
      setGapBusyEntryId(null);
    }
  }

  // R8-SC-4: the reviewer sees precedent where they sign. Same derivation
  // as the intake panel; presentation-only, never engine input.
  const [precedents, setPrecedents] = useState<EnrichedPrecedent[]>([]);
  useEffect(() => {
    if (!summary) return;
    let cancelled = false;
    void (async () => {
      const rows = await getUseCases('all');
      const candidates: PrecedentCandidate[] = rows
        .filter((r) => r.current_verdict_status !== null)
        .map((r) => ({
          id: r.use_case_id,
          label: r.label,
          description: r.description,
          status: r.current_verdict_status!,
          tier: r.tier,
          track: r.track,
          decided_at: r.last_evaluated_at,
          policy_version: r.policy_version_at_evaluation,
        }));
      const matches = findPrecedents(
        { label: summary.label, description: summary.description },
        candidates,
        summary.use_case_id,
      );
      const enriched: EnrichedPrecedent[] = [];
      for (const m of matches) {
        const evs = await getAuditEvents(m.id);
        const payload = findLatestVerdictEvent(evs);
        const verdict = payload ? (payload.type === 'verdict_produced' ? payload.verdict : payload.new_verdict) : null;
        enriched.push({ ...m, controls: verdict?.controls ?? [] });
      }
      if (!cancelled) setPrecedents(enriched);
    })();
    return () => {
      cancelled = true;
    };
    // Delta review 005 finding 2: keyed on the fields the search READS, not
    // object identity — load() rebuilds `summary` after every 2LoD action,
    // and re-reading the whole register to redraw an unchanged list is
    // waste. eslint disabled deliberately for the same reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.use_case_id, summary?.label, summary?.description]);

  const load = useCallback(async () => {
    try {
      const [s, evs] = await Promise.all([
        getUseCase(useCaseId, undefined, policy?.sampling_rate),
        getAuditEvents(useCaseId),
      ]);
      setSummary(s ?? null);
      setEvents(evs);
      // UC-11: the case's own links. A failed read leaves it undefined — which
      // registerSaysNoModelNamed treats as "cannot tell" (so no "No AI model is recorded" line), never as "none".
      try {
        const { nodes, edges } = await getGraph(useCaseId);
        const own = nodes.find((n) => n.node_id === useCaseId);
        setModelLinks({
          createdAt: own?.created_at,
          edges,
          unrecorded: own?.metadata.node_type === 'use_case' && own.metadata.model_link_unrecorded === true,
        });
      } catch {
        setModelLinks(null);
      }
      setLoadError(null);
    } catch (err) {
      // N4: getUseCase() (unlike getUseCases()'s per-row Promise.allSettled)
      // has no way to skip just this one bad row — there is only this one
      // row to show. Surface the failure rather than hanging on "Loading…".
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [useCaseId, policy?.sampling_rate]);

  useEffect(() => {
    void load();
  }, [load]);

  // explore-007 D-001 fix (round 8): verifyChain() walks and re-hashes the
  // WHOLE audit trail — every use case, not just this one — so it grows
  // slower as the trail grows. Kept OFF the critical path that decides
  // when the page stops showing "Loading…": summary/events render first,
  // the chain-integrity line fills in a moment later. A slower trail
  // should not make every sign-off page feel slower to open.
  useEffect(() => {
    let cancelled = false;
    void verifyChain().then((result) => {
      if (!cancelled) setChainCheck(result);
    });
    return () => {
      cancelled = true;
    };
    // Re-check whenever this record's own events change (a new event was
    // just appended) — not on every render, and not keyed to unrelated
    // prop changes that don't affect the trail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  // LC-2/LC-3: decision event first, then the stage change it causes
  // (updateLifecycleStage itself appends lifecycle_stage_changed).
  /** §13.4. Read the trail at write time to DETECT a change, and compare it
   *  against what was rendered. That is not the same as deriving the id to
   *  write: a second "latest event" lookup used as the value would record an
   *  attestation against a verdict the reviewer never saw, which is precisely
   *  the race this closes. Returns true when it is safe to proceed. */
  async function verdictToAttest(): Promise<Verdict | null> {

    // Code review round 3, Panel B. Both writers fell back to
    // `verdict_id: ''` when there was no verdict — an attestation that
    // satisfies the type and points at nothing, which is the hole P8-C08's
    // verdict_id was added to close. Refusing is the honest answer: there is
    // nothing to attest to, so nothing is recorded.
    if (!latestVerdict) {
      setActionError(
        'There is no verdict to attest to for this use case, so nothing was recorded. Run a pre-check first, then sign off against the verdict it produces.',
      );
      return null;
    }

    // An attestation nobody is named on is the defect this closes. Refusing is
    // the honest answer; recording an anonymous one is not.
    if (!attestedByName.trim()) {
      setActionError('Enter your name before signing off. The attestation records who accepted this verdict.');
      return null;
    }

    const fresh = await getAuditEvents(useCaseId);
    const payload = findLatestVerdictEvent(fresh);
    const currentId = payload
      ? payload.type === 'verdict_produced'
        ? payload.verdict.id
        : payload.new_verdict.id
      : null;
    if (currentId === latestVerdict.id) return latestVerdict;

    setActionError(
      'The verdict changed while you were reading it, so nothing was recorded. Someone corrected and re-evaluated this use case after you opened the page. Reload to see the current verdict, then sign off against that.',
    );
    await load();
    return null;
  }

  async function handleApprove() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setActionError(null);
    try {
      const attesting = await verdictToAttest();
      if (!attesting) return;
      await appendAuditEvent({
        event_id: crypto.randomUUID(),
        use_case_id: useCaseId,
        event_type: 'twoloD_reviewed',
        occurred_at: new Date().toISOString(),
        actor: role,
        payload: {
          type: 'twoloD_reviewed',
          action: 'approved',
          verdict_id: attesting.id,
          attested_by_name: attestedByName.trim(),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      });
      await updateLifecycleStage(useCaseId, 'approved', role);
      // CR6-29: never the reserved word — ACTION_LABEL / STAGE_LABELS say "Cleared".
      setActionResult(`${ACTION_LABEL.approved} by 2LoD — lifecycle advanced to ${STAGE_LABELS.approved}. Recorded in the audit trail.`);
      setNotes('');
      setAttestedByName('');
      await load();
    } catch (err) {
      setActionError(`Action failed: ${err instanceof Error ? err.message : String(err)}. Check the timeline below for what was recorded.`);
      await load();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function handleRequestCorrection() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setActionError(null);
    try {
      const attesting = await verdictToAttest();
      if (!attesting) return;
      await appendAuditEvent({
        event_id: crypto.randomUUID(),
        use_case_id: useCaseId,
        event_type: 'twoloD_reviewed',
        occurred_at: new Date().toISOString(),
        actor: role,
        payload: {
          type: 'twoloD_reviewed',
          action: 'correction_requested',
          verdict_id: attesting.id,
          attested_by_name: attestedByName.trim(),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      });
      setActionResult('Correction requested — recorded in the audit trail. The submitter re-runs intake to correct and re-evaluate.');
      setNotes('');
      setAttestedByName('');
      await load();
    } catch (err) {
      setActionError(`Action failed: ${err instanceof Error ? err.message : String(err)}. Check the timeline below for what was recorded.`);
      await load();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function handleFileDissent() {
    if (dissentInFlight.current) return;
    dissentInFlight.current = true;
    setDissentBusy(true);
    setDissentError(null);
    try {
      // Same refuse-rather-than-record posture as the sign-off actions: a
      // dissent that names nobody, no rule, or no reason is noise on an
      // append-only record that cannot be cleaned up.
      if (!latestVerdict) {
        setDissentError('There is no verdict here, so there is no rule application to challenge. Run a pre-check first.');
        return;
      }
      const fromList = dissentRuleId && dissentRuleId !== '__other__';
      const ruleRef = fromList ? dissentRuleId : dissentOtherRef.trim();
      if (!ruleRef) {
        setDissentError('Name the rule you are challenging — pick one the verdict relied on, or type its reference.');
        return;
      }
      if (!dissentText.trim()) {
        setDissentError('Say why the rule is wrong, too broad, or missing a distinction. A challenge with no reasoning gives the rule authors nothing to act on.');
        return;
      }
      if (!dissentByName.trim()) {
        setDissentError('Enter your name. The challenge is recorded permanently, so the record says who filed it.');
        return;
      }
      const label = fromList ? challengeableRules.find((r) => r.id === dissentRuleId)?.label : undefined;
      await appendAuditEvent({
        event_id: crypto.randomUUID(),
        use_case_id: useCaseId,
        event_type: 'rule_dissent_filed',
        occurred_at: new Date().toISOString(),
        actor: role,
        payload: {
          type: 'rule_dissent_filed',
          // The verdict the challenger was shown — threaded from the render,
          // like the attestation's verdict_id (§13.4).
          verdict_id: latestVerdict.id,
          rule_id: ruleRef,
          ...(label && label !== ruleRef ? { rule_label: label } : {}),
          dissent: dissentText.trim(),
          filed_by_name: dissentByName.trim(),
        },
      });
      setDissentResult(
        'Challenge recorded in the audit trail and queued for the rule authors. The verdict on this page is unchanged — a dissent never overrides it.',
      );
      setDissentRuleId('');
      setDissentOtherRef('');
      setDissentText('');
      setDissentByName('');
      setDissentOpen(false);
      await load();
    } catch (err) {
      setDissentError(`Filing failed: ${err instanceof Error ? err.message : String(err)}. Check the timeline below for what was recorded.`);
      await load();
    } finally {
      dissentInFlight.current = false;
      setDissentBusy(false);
    }
  }

  if (loadError) {
    return (
      <section className="card register-detail">
        <button type="button" className="register-detail__back" onClick={onBack}>
          ← register
        </button>
        <p role="alert" className="register-detail__load-error">
          This case couldn&apos;t be loaded: {loadError}
        </p>
      </section>
    );
  }

  if (!summary) {
    return (
      <section className="card register-detail">
        <button type="button" className="register-detail__back" onClick={onBack}>
          ← register
        </button>
        <p>Loading…</p>
      </section>
    );
  }

  // BC-V12A-03: gated on role AND stage in JSX, not CSS.
  const showActionBar = role === '2LoD' && summary.lifecycle_stage === 'pre_checked' && !actionResult;

  return (
    <section className="card register-detail">
      <button type="button" className="register-detail__back" onClick={onBack}>
        ← register
      </button>

      <h2>{summary.label}</h2>
      <p className="register-detail__meta">
        <code>{summary.use_case_id.slice(0, 8)}</code> · submitted by {summary.submitted_by} ·{' '}
        {new Date(summary.submitted_at).toLocaleDateString()}
      </p>
      <div className="register-detail__chips">
        <span className="graph-node__chip">Tier: {summary.tier ?? '—'}</span>
        <span className="graph-node__chip">Track: {summary.track ?? '—'}</span>
        <span className="graph-node__chip">
          {summary.current_verdict_status ? STATUS_LABEL[summary.current_verdict_status] : 'No verdict'}
        </span>
        {/* §13.3: a qualifier, not a fourth status. */}
        {summary.provisional && <span className="graph-node__chip">Provisional</span>}
        <span
          className={`register-stage register-stage--${summary.lifecycle_stage}`}
          data-stage={summary.lifecycle_stage}
        >
          {STAGE_LABELS[summary.lifecycle_stage]}
        </span>
      </div>
      {/* R5 follow-up: tier and track in plain words, from the same shared
          copy file as the form and the graph review. Rendered only when the
          value has a meaning — an unknown value gets no invented sentence.
          design-review-003 (Panel G): moved to sit immediately after the
          chips, ahead of the risk-knowledge notice, so a reader glancing at
          the top of the page sees the chip and its gloss together rather
          than separated by an unrelated paragraph. */}
      {(summary.tier && TIER_MEANINGS[summary.tier]) || (summary.track && TRACK_MEANINGS[summary.track]) ? (
        <p className="register-detail__chip-legend">
          {summary.tier && TIER_MEANINGS[summary.tier] && (
            <>
              <strong>{summary.tier} tier</strong> means {TIER_MEANINGS[summary.tier]}{' '}
            </>
          )}
          {summary.track && TRACK_MEANINGS[summary.track] && (
            <>
              <strong>Track {summary.track}</strong> means it is {TRACK_MEANINGS[summary.track]}
            </>
          )}
        </p>
      ) : null}
      {/* explore-007 D-002 fix (round 8): Track is Counterpoise's own invented
          oversight-regime category — a bank with its own committee
          structure (e.g. NPPA + Model Risk) has no way to see how it maps
          without this. Renders only when the firm has actually set a
          mapping (policy.governance_mapping); says nothing invented when
          it hasn't, same discipline as the TIER_MEANINGS/TRACK_MEANINGS
          block just above. */}
      {summary.track && policy?.governance_mapping?.[summary.track as 'I' | 'II' | 'III'] && (
        <p className="register-detail__governance-mapping">
          At your firm, Track {summary.track} routes to{' '}
          <strong>{policy.governance_mapping[summary.track as 'I' | 'II' | 'III']!.committee}</strong>
          {policy.governance_mapping[summary.track as 'I' | 'II' | 'III']!.note &&
            ` — ${policy.governance_mapping[summary.track as 'I' | 'II' | 'III']!.note}`}
          .
        </p>
      )}

      {/* R13-UI-5: a gap must not hide below the fold. Renders ONLY when an
          uncovered risk class exists for this case; no gaps, no notice.
          explore-007 D-003 fix (round 8): filing a gap used to make it
          LESS visible, not more — the filed marker only lived in a sidebar
          queue nobody was prompted to check. This notice now says whether
          each uncovered domain has been filed yet, and if so, how long
          it's been open — the same "the paper trail is not the mitigant"
          point the bank persona raised. */}
      {knowledgeLensMatches.some((m) => !m.covered) && (
        <p className="knowledge-lens__top-notice" role="note">
          {knowledgeLensMatches
            .filter((m) => !m.covered)
            .map((m) => {
              const open = daysOpen(m.entry.id);
              return open === null
                ? `${m.entry.id} has no covering rule and no gap filed yet`
                : `${m.entry.id} has no covering rule — gap filed, open ${open} day${open === 1 ? '' : 's'}`;
            })
            .join('; ')}{' '}
          — see the risk-knowledge panel below. Filing a gap does not close it or change this verdict;
          someone still has to act on it.
        </p>
      )}

      {/* ADR-RL-R3-1 / §15.1. The verdict a reviewer is being asked to attest
          to, rendered from the persisted record rather than recomputed.
          `graph` is deliberately not passed: it is not persisted on the
          register entry, so the provenance panel would render empty here
          (ADR-RL-R3-1 consequences). `onCorrect` is not passed either —
          correction is a submitter action (§15.1b, P8-C06). */}
      {latestVerdict ? (
        <>
          {!latestVerdict.explanation && (
            <p className="register-detail__legacy-note" role="status">
              This verdict predates explanation capture, so the binding reason and the triggered
              invariants were not recorded for it. What was recorded is shown below. An empty list
              here would say &ldquo;nothing was triggered&rdquo;, which is a stronger claim than the
              record supports.
            </p>
          )}
          {/* The submitter's optional attestation note (2026-08-15). Placed
              ABOVE the verdict, because the reviewer should read the human
              context before the machine's answer — and framed so it cannot be
              mistaken for something the engine weighed. Most recent
              graph_confirmed wins: a re-attestation supersedes. */}
          {/* R6-CX-1: contexts the submitter typed on question answers —
              rendered with the note, same rules: human-read, never engine
              input, most recent attestation wins.
              F-4 (DR7-12, DR7-16): now read via currentVerdictAttestationFields,
              which checks the latest verdict_corrected FIRST — a correction's
              own answer_contexts, when there is one, rather than only ever
              reading the original graph_confirmed. */}
          {(() => {
            const contexts = currentVerdictAttestationFields(events).answer_contexts;
            return contexts && contexts.length > 0 ? (
              <div className="register-detail__submitter-note">
                <h3>Context from the submitter&rsquo;s answers</h3>
                <ul className="register-detail__submitter-note-body">
                  {contexts.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <p className="register-detail__submitter-note-caveat">
                  Typed alongside individual answers, for you. The rules did not read it.
                </p>
              </div>
            ) : null;
          })()}
          {(() => {
            const resolutions = currentVerdictAttestationFields(events).contradiction_resolutions;
            return resolutions && resolutions.length > 0 ? (
              <div className="register-detail__submitter-note">
                <h3>Explanations the submitter gave</h3>
                <ul className="register-detail__submitter-note-body">
                  {resolutions.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <p className="register-detail__submitter-note-caveat">
                  Typed when an answer seemed to disagree with the description, for you. The rules did
                  not read it.
                </p>
              </div>
            ) : null;
          })()}
          {(() => {
            const note = currentVerdictAttestationFields(events).submitter_note;
            return note ? (
              <div className="register-detail__submitter-note">
                <h3>Note from the submitter</h3>
                <p className="register-detail__submitter-note-body">{note}</p>
                <p className="register-detail__submitter-note-caveat">
                  Written at attestation, for you. The rules did not read it — the verdict below is
                  computed only from the structured answers.
                </p>
              </div>
            ) : null;
          })()}
          {/* code-review-004 F10: name the reset instead of letting it look
              like data loss. The prior assignments are still on the audit
              trail below — this panel just reads per-verdict. */}
          {priorVerdictAssignments.length > 0 && (
            <p className="register-detail__owner-reset-note" role="note">
              Owner assignments from an earlier verdict of this case (
              {priorVerdictAssignments.map(([cid, name]) => `${cid}: ${name}`).join(', ')}) are not
              shown here — a re-evaluation resets the panel to the current verdict. The audit trail
              below keeps every prior assignment; reassign if still current.
            </p>
          )}
          {/* R16-D2 §6 (DR7-09, D2 part). */}
          {correctionCount > 0 && (
            <p className="register-detail__correction-count" role="note">
              Corrected {correctionCount} time{correctionCount === 1 ? '' : 's'} by the submitter — each
              version is in the record below.
            </p>
          )}
          <VerdictDisplay
            verdict={latestVerdict}
            auditEvents={events}
            policy={policy}
            registerStage={summary.lifecycle_stage}
            noModelNamed={registerSaysNoModelNamed({ useCaseCreatedAt: modelLinks?.createdAt, edges: modelLinks?.edges, events, modelLinkUnrecorded: modelLinks?.unrecorded })}
            memoLabel={summary.label}
            memoDescription={summary.description}
            knowledgeLensMatches={knowledgeLensMatches}
            // R16-D2 §2/§3/§4b: this case's own assumptions (read through
            // currentVerdictAttestationFields, the same correction-aware
            // precedence F-4 already established), the loaded packs, and
            // the persisted evidence_scope — RegisterDetail never passes
            // `graph` (ADR-RL-R3-1), so these are its substitutes.
            assumptions={currentVerdictAttestationFields(events).assumptions}
            packs={loadedPacks}
            evidenceScope={evidenceScope}
            // R15-C2 (proposal §3.1, S2): same condition the action bar
            // below already renders on — 2LoD role, stage awaiting sign-off.
            showSignOffChecklist={showActionBar}
            hasRiskKnowledgeSection={knowledgeLensMatches.length > 0 || lensNotEvaluated}
            // design-review-003: the caller owns role, so it decides the
            // reasoning panel's default state — open for the 2LoD reviewer
            // who is actually deciding this case, collapsed with a plain
            // gist for anyone else viewing the same page.
            reasoningDefaultOpen={role === '2LoD'}
            controlOwnership={controlOwnership}
            onAssignControlOwner={(controlId, ownerName, targetDate) =>
              void handleAssignControlOwner(controlId, ownerName, targetDate)
            }
            controlOwnerBusyId={controlOwnerBusyId}
            controlOwnerErrorId={controlOwnerErrorId}
            controlOwnerError={controlOwnerError}
            controlAttestations={controlAttestations}
            onAttestControlEvidence={(controlId, name, note) =>
              handleAttestControlEvidence(controlId, name, note)
            }
            controlEvidenceBusyIds={controlEvidenceBusyIds}
            controlEvidenceErrors={controlEvidenceErrors}
          />
          {/* R15-C2: id target for VerdictDisplay's section nav / sign-off
              checklist "Risk knowledge" jump link — this panel lives outside
              VerdictDisplay, so the anchor has to sit here. */}
          <div id="risk-knowledge-section">
            {knowledgeLensMatches.length > 0 && (
              <KnowledgeLensPanel
                matches={knowledgeLensMatches}
                onFileCoverageGap={(m) => void handleFileKnowledgeGap(m)}
                gapBusyEntryId={gapBusyEntryId}
                filedRiskDomains={filedRiskDomains}
                meta={knowledgeLensMeta}
              />
            )}
            {/* R13-UI-4: silent absence was indistinguishable from "no
                matches". Say which one it is. */}
            {lensNotEvaluated && (
              <p className="knowledge-lens__not-evaluated">
                Not evaluated against the risk-knowledge taxonomy — this case was decided before that check
                existed. A re-evaluation would include it.
              </p>
            )}
          </div>
          {gapError && (
            <p role="alert" className="register-detail__gap-error">
              {gapError}
            </p>
          )}
        </>
      ) : (
        <p className="register-detail__no-verdict" role="status">
          No verdict is recorded for this use case. Nothing has been evaluated against the appetite
          rules, so there is no decision, no control set and no citation to review. Sign-off remains
          available, but it attests to the record as it stands — which is empty.
        </p>
      )}

      <SimilarCases matches={precedents} />

      {showActionBar && (
        <div className="register-detail__actionbar">
          <p className="register-detail__actionbar-title">
            {summary.tier ?? 'This'} tier — awaiting 2LoD action. This use case cannot move to Cleared
            until you sign off.
          </p>
          {/* R15-C2, skeptic amendment S3 (Must): the role indicator carries
              the same no-sign-in honesty at the point of approval, not only
              in the header (App.tsx's "Viewing as" note, R15-C1). This is a
              new string, distinct from the "Your name" field's own
              G5-protected caveat below, which is left untouched. */}
          <p className="register-detail__actionbar-role-note">
            Signing off as 2LoD — a view preference, not a permission; this build has no sign-in.
          </p>
          <label htmlFor="twolod-name">Your name</label>
          <input
            id="twolod-name"
            type="text"
            value={attestedByName}
            onChange={(e) => setAttestedByName(e.target.value)}
          />
          {/* The product has no backend to authenticate against. Saying so is
              the same choice it makes about the audit trail being client-side
              and about pack rules being unadopted — state the limit, do not
              let the record imply more than it can support. */}
          <p className="field-help">
            Recorded on the attestation so the trail says who accepted this verdict. It is
            self-asserted — this build has no sign-in, so the name is not verified.
          </p>
          <label htmlFor="twolod-notes">Notes (optional)</label>
          <input
            id="twolod-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="register-detail__actions">
            <button type="button" className="register-detail__approve" disabled={busy} onClick={() => void handleApprove()}>
              Approve
            </button>
            <button type="button" disabled={busy} onClick={() => void handleRequestCorrection()}>
              Request correction
            </button>
          </div>
        </div>
      )}

      {/* R12-AB-1 (ADR-VA-R12-1): the automation-bias countermeasure — a
          deterministically selected self-served Low-tier verdict gets a
          human spot review. 2LoD-only; renders only until the review is
          recorded (summary.sampling_review_due goes false once the
          sampling_reviewed event lands and the row is reloaded). */}
      {role === '2LoD' && summary.sampling_review_due && !samplingResult && (
        <div className="register-detail__sampling">
          <h3>Sampling spot review due</h3>
          <p className="field-help">
            This self-served case was deterministically selected (1 in {policy?.sampling_rate ?? '?'}).
          </p>
          <label htmlFor="sampling-reviewer-name">Your name</label>
          <input
            id="sampling-reviewer-name"
            type="text"
            value={samplingReviewerName}
            onChange={(e) => setSamplingReviewerName(e.target.value)}
          />
          <label htmlFor="sampling-note">Note (optional)</label>
          <input
            id="sampling-note"
            type="text"
            value={samplingNote}
            onChange={(e) => setSamplingNote(e.target.value)}
          />
          <button type="button" disabled={samplingBusy} onClick={() => void handleSamplingReview()}>
            Record spot review
          </button>
          {samplingError && (
            <p role="alert" className="register-detail__error">
              {samplingError}
            </p>
          )}
        </div>
      )}
      {samplingResult && (
        <p className="register-detail__result" role="status">
          {samplingResult}
        </p>
      )}

      {actionResult && (
        <p className="register-detail__result" role="status">
          {actionResult}
        </p>
      )}

      {actionError && (
        <p role="alert" className="register-detail__error">
          {actionError}
        </p>
      )}

      {/* Rule dissent (FN-009). Deliberately NOT gated on lifecycle stage:
          a rule can be wrong on a case that already advanced, and the point
          of the queue is to catch that. Gated on role + a verdict existing —
          without a verdict no rule was applied, so there is nothing to
          challenge. */}
      {role === '2LoD' && latestVerdict && (
        <div className="register-detail__dissent">
          {!dissentOpen && !dissentResult && (
            <button type="button" className="register-detail__dissent-toggle" onClick={() => setDissentOpen(true)}>
              Challenge a rule…
            </button>
          )}
          {dissentOpen && (
            <div className="register-detail__dissent-form">
              <h3>Challenge a rule</h3>
              <p className="field-help">
                This disputes a <strong>rule</strong>, not this use case. The verdict stands unchanged
                — the challenge is recorded permanently and goes to the rule-improvement queue for the
                people who author the rulebook.
              </p>
              <label htmlFor="dissent-rule">Rule being challenged</label>
              <select id="dissent-rule" value={dissentRuleId} onChange={(e) => setDissentRuleId(e.target.value)}>
                <option value="">— pick a rule this verdict relied on —</option>
                {challengeableRules.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id === r.label ? r.id : `${r.id} — ${r.label}`}
                  </option>
                ))}
                <option value="__other__">A rule not listed here…</option>
              </select>
              {dissentRuleId === '__other__' && (
                <>
                  <label htmlFor="dissent-rule-ref">Rule reference</label>
                  <input
                    id="dissent-rule-ref"
                    type="text"
                    value={dissentOtherRef}
                    onChange={(e) => setDissentOtherRef(e.target.value)}
                  />
                  <p className="field-help">
                    Typed by you, so it is recorded as a reference — the queue will not resolve it
                    against the rulebook.
                  </p>
                </>
              )}
              <label htmlFor="dissent-text">Why the rule is wrong here</label>
              <textarea
                id="dissent-text"
                rows={3}
                value={dissentText}
                onChange={(e) => setDissentText(e.target.value)}
              />
              {/* "Filed by", not "Your name": the sign-off bar above already
                  has a "Your name" input, and two identical labels on one
                  page are ambiguous for screen readers and label queries. */}
              <label htmlFor="dissent-name">Filed by</label>
              <input
                id="dissent-name"
                type="text"
                value={dissentByName}
                onChange={(e) => setDissentByName(e.target.value)}
              />
              <p className="field-help">
                Self-asserted — this build has no sign-in, so the name is not verified.
              </p>
              <div className="register-detail__actions">
                <button type="button" disabled={dissentBusy} onClick={() => void handleFileDissent()}>
                  File the challenge
                </button>
                <button
                  type="button"
                  disabled={dissentBusy}
                  onClick={() => {
                    setDissentOpen(false);
                    setDissentError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {dissentResult && (
            <p className="register-detail__result" role="status">
              {dissentResult}
            </p>
          )}
          {dissentError && (
            <p role="alert" className="register-detail__error">
              {dissentError}
            </p>
          )}
        </div>
      )}

      <div className="register-detail__timeline">
        <h3>Audit trail · append-only</h3>
        {/* explore-002 observation: the heading previously read "Immutable
            audit trail" with this caveat placed BELOW the event list, so the
            strong word was read first and the qualifier last — if at all, on
            a long trail. "Immutable" also overstates what a browser-held
            store can support. The caveat now sits directly under the heading,
            before any event. */}
        {/* CR8-04 (P5): derived from verifyChain, which proves linkage and hashes of the events PRESENT only.
            Deleting the newest events leaves a chain that still verifies (TC-CR8-04b), so nothing here may
            say the whole trail is intact or that every deletion is detectable. */}
        <p className="register-detail__caveat">
          Append-only by construction: nothing here can be edited or deleted through the application.
          Every event is hash-chained to the one before it, across the whole trail — an edited event,
          or a deleted event with later events after it, breaks the chain, and the check below runs
          that test live. Removing the newest events can&apos;t be detected from inside this browser.
          This is still a client-side, browser-held store with no external anchor, so it cannot rule
          out someone with full local access rewriting the entire chain consistently — that would need
          an external, write-once store, which V1 does not have.
        </p>
        {chainCheck && (
          <p
            className={chainCheck.ok ? 'register-detail__chain-ok' : 'register-detail__chain-broken'}
            role={chainCheck.ok ? 'status' : 'alert'}
          >
            {chainCheck.ok
              ? `No break found in the ${chainCheck.checked} event${chainCheck.checked === 1 ? '' : 's'} present.`
              : `Chain integrity check FAILED — the trail no longer matches its own hash chain, starting at event ${chainCheck.brokenAtEventId} (${chainCheck.reason}). Treat this record as compromised until investigated.`}
          </p>
        )}
        <ul className="timeline">
          {events.map((event) => (
            <li key={event.event_id} className="timeline__row">
              <span className={`timeline__dot timeline__dot--${event.event_type}`} aria-hidden="true" />
              <div className="timeline__body">
                <div className="timeline__head">
                  <code className="timeline__type">{event.event_type}</code>
                  <span className="timeline__actor">{event.actor}</span>
                  <span className="timeline__time">{new Date(event.occurred_at).toLocaleString()}</span>
                </div>
                <p className="timeline__detail">{eventDetail(event, role)}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
