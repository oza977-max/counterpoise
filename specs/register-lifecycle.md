# Counterpoise — Register & Lifecycle Specification

**Version:** 1.0  
**Date:** June 2026  
**Status:** Draft  
**Covers:** RG-1 through RG-5, LC-1 through LC-4, LC-6 — graph-based inventory register, role-based access, tier-to-workflow routing, re-evaluation triggers, Counterpoise self-assessment

---

## Expert Panel

| Expert | Work | Role in This Document |
|--------|------|-----------------------|
| Martin Kleppmann | *Designing Data-Intensive Applications* (O'Reilly 2017) | Graph data model design; adjacency list representation; derived views |
| Martin Fowler | *Patterns of Enterprise Application Architecture* (Addison-Wesley 2002) | Repository pattern for register store; derived read views |
| Michael Keeling | *Design It!* (Pragmatic Bookshelf 2017) | ADR-008 and ADR-009; ASR identification |
| George Fairbanks | *Just Enough Software Architecture* (Marshall & Brainerd 2010) | Graph model non-retrofittability risk |
| Dan Vanderkam | *Effective TypeScript* (2nd ed., O'Reilly 2024) | Graph node discriminated unions; type-safe adjacency list |
| Alan Cooper | *About Face* (4th ed., Wiley 2014) | Register view design for Priya (2LoD) — filtering, blast-radius queries |

---

## 1. Purpose

This spec defines:
- The graph data model for the AI inventory register — graph stored in IndexedDB, not a flat list (RG-1 — non-retrofittable)
- Adjacency list representation for shared nodes: models, platforms, vendors (RG-1)
- Role-based access: 1LoD sees own records, 2LoD sees all (RG-2)
- Register views: filtering, search, export (RG-3, RG-5)
- Policy-update re-evaluation trigger: queues all active use cases (LC-4, RG-4)
- Lifecycle stage machine: Idea → Retired (LC-1)
- Tier-to-workflow routing: Low=self-service, Medium=2LoD-notify, High/Critical=2LoD-approve (LC-2)
- Counterpoise self-assessment: Counterpoise appears in its own register (LC-6)

Verdict storage is handled by `src/store/audit.ts` (see `verdict-audit.md`). This spec covers the register store (`src/store/register.ts`) — the live state of use cases and their derived summaries.

---

## 2. Architecturally Significant Requirements

| ASR | Requirement | Architectural Impact |
|---|---|---|
| Graph data model is non-retrofittable | RG-1 | Must be an adjacency list in IndexedDB from V1; cannot be added to a flat model later |
| Role access must filter at query layer | RG-2 | `getAll()` accepts `role` parameter; never loads all records then filters in-memory |
| Re-evaluation trigger queues all active cases | LC-4 | Policy version change writes a `re_evaluation_queued` event to every active use case |
| Lifecycle stage is the governance source of truth | LC-1 | Stage transitions are the primary audit events that drive 2LoD queues |
| Counterpoise self-assessment must be a real evaluation | LC-6 | Not a stub — Counterpoise must run its own engine on its own graph and store the result |
| Tier-to-workflow routing is policy-configurable | LC-2 | The routing table lives in the policy file, not hardcoded in the UI |

---

## 3. Design Decisions

### ADR-008 — Graph register: adjacency list in IndexedDB

**Context:** RG-1 requires a graph data model (non-negotiable, cannot be retrofitted). Use cases share nodes: multiple use cases may share the same vendor model, platform, or data zone. Blast-radius queries ("which use cases share this vendor?") must be answerable without full-table scans. V1 is browser-only.

**Options considered:**
1. **Flat list of use case records** — each use case is a self-contained JSON record. Simple, but RG-1 explicitly rejects this. Blast-radius queries require full scan and client-side joins. Rejected by requirements.
2. **Adjacency list in IndexedDB** — two object stores: `use_cases` (node records) and `graph_edges` (directed edges between nodes). Shared components (models, platforms) appear as their own node records referenced by edges. Graph traversal is O(edges) not O(use_cases × components). Queryable with IndexedDB indexes.
3. **In-memory graph only (no persistence)** — trivially lost on page reload. Rejected.
4. **External graph database (e.g., Dexie Addon)** — no established browser-based graph query layer that is stable and dependency-light. Adjacency list with application-layer traversal is standard for this scale.

**Decision:** Adjacency list in IndexedDB via `idb`. Two object stores: `register_nodes` and `register_edges`. Indexes on `node_type`, `use_case_id`, and `to_node_id` enable the queries RG-1 through RG-6 require.

**Consequences:** Application-layer graph traversal for blast-radius queries. For V1's expected inventory size (tens to low hundreds of use cases), O(edges) traversal is negligible. V2 could add a materialised adjacency cache if performance degrades.

---

### ADR-009 — Role access: localStorage toggle with query-layer filtering

**Context:** RG-2 requires 1LoD to see only their own records and 2LoD to see all. There is no real authentication in V1 (cross-cutting spec, OQ-3 resolution). The role mechanism must be simple, auditable, and clearly provisional.

**Options considered:**
1. **No role separation** — single view. Rejected: RG-2 is a Must requirement.
2. **localStorage toggle `aigate:role` = '1LoD' | '2LoD'** — user sets role on first use; register queries filter by role. Simple, zero-config, clearly provisional. Used in cross-cutting spec.
3. **Password-gated 2LoD view** — adds friction without real security; still insecure. Not meaningfully better than option 2 for a V1 proof-of-concept.

**Decision:** localStorage toggle with query-layer filtering. The `RegisterStore.getAll(role, actorId)` function applies the role filter at the query level — it does not load all records and filter in-memory. For 1LoD, the IndexedDB index on `submitted_by` is used; for 2LoD, no filter is applied.

**Consequences:** Not a real access control mechanism. A 1LoD user who knows the code could set `localStorage['aigate:role'] = '2LoD'` and see all records. V1 is honest proof-of-concept grade. V1.5 adds proper auth (even a simple server-side session).

---

## 4. Graph Data Model

### 4.1 Node types

```typescript
// src/store/register.ts

export type RegisterNodeType =
  | 'use_case'
  | 'ai_model'          // A specific model (e.g. GPT-4, claude-sonnet-4-6)
  | 'platform'          // Approved platform (e.g. Azure OpenAI)
  | 'vendor'            // Vendor (e.g. OpenAI, Anthropic)
  | 'data_source'       // Named data source (e.g. "Client CRM")
  | 'control';          // An applied control from the control library

export interface RegisterNode {
  node_id: string;                // UUID v4
  node_type: RegisterNodeType;
  label: string;                  // Human-readable name
  created_at: string;             // ISO 8601
  metadata: RegisterNodeMetadata; // Discriminated by node_type
}

export type RegisterNodeMetadata =
  | { node_type: 'use_case'; submitted_by: string; lifecycle_stage: LifecycleStage; current_verdict_id: string | null; tier: Tier | null; track: Track | null; model_link_unrecorded?: boolean /* CR7-11 */ }
  | { node_type: 'ai_model'; model_id: string; vendor: string; is_approved: boolean }
  | { node_type: 'platform'; platform_id: string; approved_envelope_summary: string }
  | { node_type: 'vendor'; vendor_name: string; approval_status: 'approved' | 'unapproved' | 'pending' }
  | { node_type: 'data_source'; data_class: DataClass; data_zone: DataZone }
  | { node_type: 'control'; control_id: string; burden: 1 | 2 | 3 | 4 | 5 };
```

### 4.2 Edge types

```typescript
export type RegisterEdgeType =
  | 'uses_model'          // use_case → ai_model
  | 'runs_on_platform'    // use_case → platform
  | 'provided_by_vendor'  // ai_model → vendor
  | 'consumes_data_from'  // use_case → data_source
  | 'requires_control';   // use_case → control (controls assigned by verdict)

export interface RegisterEdge {
  edge_id: string;        // UUID v4
  from_node_id: string;
  to_node_id: string;
  edge_type: RegisterEdgeType;
  created_at: string;
}
```

### 4.3 IndexedDB schema

Two object stores in the `aigate-register` database (version 1):

**`register_nodes`** — keyPath: `node_id`  
Indexes:
- `by_type` on `node_type` (multi-entry: false) — for `getAll('use_case')` queries
- `by_submitted_by` on `metadata.submitted_by` (multi-entry: false) — for 1LoD role filter

**`register_edges`** — keyPath: `edge_id`  
Indexes:
- `by_from_node` on `from_node_id` — for "which components does use case X use?"
- `by_to_node` on `to_node_id` — for blast-radius queries: "which use cases use component Y?"

### 4.4 Graph traversal — blast-radius query

```typescript
// src/store/register.ts
export async function getBlastRadius(componentNodeId: string): Promise<RegisterNode[]> {
  // Index on to_node_id — O(use cases that reference this component)
  const edges = await db.getAllFromIndex('register_edges', 'by_to_node', componentNodeId);
  const useCaseNodeIds = edges.map(e => e.from_node_id);
  return Promise.all(useCaseNodeIds.map(id => db.get('register_nodes', id)));
}
```

This query is O(edges from this node) — not a full table scan. For a shared model used by 50 use cases, it reads 50 edge records, not all register records.

---

## 5. RegisterStore Interface (`src/store/register.ts`)

```typescript
export interface RegisterStore {
  // Write
  addNode(node: RegisterNode): Promise<void>;
  addEdge(edge: RegisterEdge): Promise<void>;
  updateUseCaseVerdictSummary(
    useCaseId: string,
    summary: Partial<UseCaseSummary> & { currentVerdictId?: string },
  ): Promise<void>;
  // Writes the register node AND appends the lifecycle_stage_changed audit
  // event. Since code-review-005 round 2 (§15.6, N3) this holds the audit
  // queue for its whole body and nests the register write inside it — the
  // one lock order this codebase uses everywhere both queues are touched.
  updateLifecycleStage(useCaseId: string, stage: LifecycleStage, actor: string): Promise<void>;

  // Read — role-filtered
  getUseCases(role: 'all' | string, currentPolicyVersion?: string, samplingRate?: number): Promise<UseCaseSummary[]>;
  // role='all' → 2LoD; role=actorId → 1LoD, filtered by submitted_by.
  // Per-row resilient (code-review-005 F3): a row whose metadata cannot be
  // read is skipped and logged, not thrown — one corrupt entry no longer
  // freezes the whole list behind "Loading…".

  getUseCase(useCaseId: string, currentPolicyVersion?: string, samplingRate?: number): Promise<UseCaseSummary | undefined>;
  getGraph(useCaseId: string): Promise<{ nodes: RegisterNode[]; edges: RegisterEdge[] }>;
  getBlastRadius(componentNodeId: string): Promise<RegisterNode[]>;

  // Export (RG-5). Queued against every writer below (code-review-005 F18),
  // so a concurrent write cannot be observed half-applied.
  exportAll(): Promise<{ nodes: RegisterNode[]; edges: RegisterEdge[] }>;

  // Hand-off (RG-8 — see verdict-audit.md §16 for the full bundle spec).
  // Upsert: for a use case present in the incoming bundle, the bundle's
  // node/edge state wins. Safe because the register is a derived view; the
  // tamper-evident source of truth is the audit trail, whose prefix-safety
  // is already established before this runs.
  importRegister(nodes: readonly RegisterNode[], edges: readonly RegisterEdge[]): Promise<void>;

  // Hand-off replace ONLY (RG-8, verdict-audit.md §16.8). Reads the current
  // register — the backup a caller must hand the user before calling this
  // — then clears and installs `nodes`/`edges`, in one queued step. Returns
  // what was discarded.
  backupAndReplaceRegister(
    nodes: readonly RegisterNode[],
    edges: readonly RegisterEdge[],
  ): Promise<{ nodes: RegisterNode[]; edges: RegisterEdge[] }>;
}

export interface UseCaseSummary {
  use_case_id: string;
  label: string;
  submitted_by: string;
  submitted_at: string;
  lifecycle_stage: LifecycleStage;
  tier: Tier | null;
  track: Track | null;
  current_verdict_status: 'approved' | 'approved_with_controls' | 'rejected' | 'provisional' | null;
  last_evaluated_at: string | null;
  policy_version_at_evaluation: string | null;
  stale_assessment: boolean;  // True if active pack versions differ from evaluation-time versions
}
```

**Amended 2026-09-28 (code review 005, F10).** `importRegister` and
`backupAndReplaceRegister` were added for the RG-8 hand-off feature
(previously undocumented here); `getUseCases`/`getUseCase` gained the
optional `currentPolicyVersion`/`samplingRate` parameters they already took
in code; `updateUseCaseVerdictSummary`'s signature is corrected to match
`register.ts` (`Partial<UseCaseSummary> & { currentVerdictId?: string }`,
not a full `UseCaseSummary`). See `verdict-audit.md` §16 for the full
hand-off bundle spec — bundle format, the seal, import validation, the
outcome vocabulary, and the merge rule.

---

## 6. Lifecycle Stage Machine (LC-1)

```
STAGES:
  Idea           ← Use case created but not yet submitted for evaluation
  Exploring      ← Intake flow started but not confirmed
  Pre-checked    ← Verdict produced; awaiting 2LoD action (if Medium/High/Critical)
  Approved       ← Low: self-service final. Medium/High/Critical: 2LoD approved.
  In_Production  ← Use case is live
  Monitored      ← Live with active KRI monitoring (V2)
  Retired        ← Use case decommissioned

TRANSITIONS (all recorded in audit trail via verdict-audit.md AuditEvent):
  Idea           → Exploring         (intake flow started)
  Exploring      → Idea              (intake abandoned — timeout or user exits)
  Exploring      → Pre-checked       (verdict produced)
  Pre-checked    → Pre-checked       (correction + re-evaluation)
  Pre-checked    → Approved          (Low tier: automatic; Medium/High/Critical: 2LoD approved)
  Pre-checked    → Rejected          (terminal for this version — submitter must re-submit with changes)
  Approved       → In_Production     (submitter marks as deployed)
  In_Production  → Monitored         (V2 — KRI feeds connected)
  In_Production  → Pre-checked       (re-evaluation triggered: LC-4)
  Monitored      → Pre-checked       (re-evaluation triggered)
  Any            → Retired           (2LoD retires use case)
```

```typescript
export type LifecycleStage =
  | 'idea'
  | 'exploring'
  | 'pre_checked'
  | 'approved'
  | 'in_production'
  | 'monitored'
  | 'retired';
```

Stage transitions are written to the audit trail (via `audit.ts` `lifecycle_stage_changed` event — see `verdict-audit.md §4.3`). The register store's `updateLifecycleStage()` updates `register_nodes` AND calls `audit.append()` to record the transition event. Both writes happen in the same `async` call; they are not wrapped in a transaction (IndexedDB transactions span one object store at a time in `idb`; partial write risk is acknowledged as a V1 limitation).

---

## 7. Tier-to-Workflow Routing (LC-2)

The routing logic is defined in the policy file, not hardcoded. The `tier_workflows` section of the policy file specifies:

```yaml
tier_workflows:
  low:
    governance_path: self_service
    verdict_is_final: true
    twoLoD_notification: false
    twoLoD_approval_required: false
  medium:
    governance_path: notify
    verdict_is_final: false
    twoLoD_notification: true
    twoLoD_approval_required: false
    twoLoD_review_window_days: 5   # 2LoD has 5 days to object; auto-approves if no action
  high:
    governance_path: approve
    verdict_is_final: false
    twoLoD_notification: true
    twoLoD_approval_required: true
  critical:
    governance_path: approve
    verdict_is_final: false
    twoLoD_notification: true
    twoLoD_approval_required: true
```

The `src/engine/workflow-router.ts` function reads this section after a verdict is produced and determines the next lifecycle action:

```typescript
export function routeToWorkflow(
  tier: Tier,
  policy: PolicyFile
): WorkflowAction

export interface WorkflowAction {
  lifecycle_stage: LifecycleStage;  // What stage the use case moves to
  requires_twoLoD_action: boolean;
  auto_approves_after_days: number | null;
  notification_message: string;     // For 2LoD notification display
}
```

For V1, "2LoD notification" means the register view shows a badge on the use case in the 2LoD view. A full workflow notification system (email, Slack) is V2.

---

## 8. Re-evaluation Trigger (LC-4)

When the policy file is updated (`src/store/policy.ts` saves a new version), a `re_evaluation_queued` audit event is appended for every active use case (any use case in `approved`, `in_production`, or `pre_checked` stage) that is not already waiting for one (CR7, 2026-10-04: a case with a `re_evaluation_queued` event newer than its latest verdict is skipped and counted as already waiting; the function returns `{ queuedCount, alreadyPendingCount }`; see §16). **The lifecycle stage does NOT change on policy save** — it moves to `pre_checked` only when a human triggers re-run or the re-evaluation produces a changed verdict. The register view shows a "Policy updated — re-evaluation required" badge on affected records.

```typescript
// src/store/policy.ts — called when policy file is saved
export async function onPolicyUpdated(
  newVersion: string,
  register: RegisterStore,
  audit: AuditStore
): Promise<void> {
  const activeCases = await register.getUseCases('all');
  const active = activeCases.filter(uc =>
    ['approved', 'in_production', 'pre_checked'].includes(uc.lifecycle_stage)
  );

  for (const uc of active) {
    // Append re_evaluation_queued — does NOT change lifecycle stage
    await audit.append({
      event_id: uuidv4(),
      use_case_id: uc.use_case_id,
      event_type: 're_evaluation_queued',
      occurred_at: new Date().toISOString(),
      actor: 'system',
      payload: {
        type: 're_evaluation_queued',
        policy_version: newVersion
      }
    });
    // Stage moves to pre_checked only on human-triggered re-run or changed verdict
  }
}
```

This follows the policy: re-evaluation is triggered for all active cases; triage (LC-5 — determining which are affected vs unaffected by the specific changed provisions) is a V2 feature. In V1, all active cases are queued, once each until their next verdict (CR7, 2026-10-04).

---

## 9. Counterpoise Self-Assessment (LC-6)

Counterpoise must appear in its own register as a submitted use case with a verdict produced by its own evaluation engine. This is not a stub or a fixture — it is a real evaluation.

**Seeded use case record (canonical vocabulary — honest values):**

```typescript
// src/seeds/aigate-self-assessment.ts
export const AIGATE_USE_CASE_GRAPH: DataFlowGraph = {
  id: 'aigate-self-assessment',
  version: 1,
  intake_method: 'structured_form',
  extracted_at: '2026-06-01T00:00:00Z',
  jurisdictions: ['UK'],        // Adjust to deployment jurisdiction
  input_nodes: [{
    id: 'in-1',
    label: 'User-described AI use case (text)',
    data_class: 'Internal',     // Canonical: intake content is internal data; not assumed lower
    data_zone: 'Zone B'         // Canonical: cloud-hosted LLM processing
  }],
  processing_nodes: [{
    id: 'proc-1',
    label: 'Counterpoise evaluation engine + LLM graph extraction (Anthropic claude-sonnet-4-6)',
    model_type: 'llm',          // Canonical: LLM for graph extraction
    autonomy_level: 1,          // Human confirms graph before evaluation fires
    data_zone: 'Zone B',
    vendor: 'Anthropic',
    replaces_prior_model: false
  }],
  output_nodes: [{
    id: 'out-1',
    label: 'Structured governance verdict (approved / approved_with_controls / rejected)',
    action_type: 'recommend',   // Canonical: verdict drives governance decisions
    exposure: 'internal-only',
    decision_bindingness: 'material',  // Honest: the verdict drives governance decisions
    reversibility: 'reversible',
    scale: 'limited'            // Internal pilot — limited scale
  }],
  edges: [
    { from: 'in-1', to: 'proc-1' },
    { from: 'proc-1', to: 'out-1' }
  ]
};
```

On first launch (when the register is empty), `src/seeds/aigate-self-assessment.ts` is called to:
1. Insert the Counterpoise use case as a `RegisterNode` with `node_type: 'use_case'` (CR8-10: written LAST, after the vendor, the edge and the model link, so its existence marks a finished seed)
2. Insert the Anthropic vendor node and `provided_by_vendor` edge
3. Run `evaluate(AIGATE_USE_CASE_GRAPH, policy)` against the loaded policy
4. Store the resulting `Verdict` in the audit trail via `audit.append()`
5. Route the result through `workflow-router.ts` like any other use case — **no auto-approve**. If the engine assigns High or Critical, the use case sits at `pre_checked` until the 2LoD role approves. The register view shows a prominent warning: **"Counterpoise self-assessment pending 2LoD approval — verdicts are provisional until cleared."**

If the policy changes after this initial seeding, the Counterpoise use case is queued for re-evaluation along with all other active use cases (LC-4 trigger applies).

---

## 10. Register View (`src/components/RegisterView.tsx`)

### 10.1 1LoD view

Shows only the current user's use cases. Columns: Use Case Name, Tier, Track, Status, Last Evaluated, Policy Version. No filtering controls — list is short enough to be readable as-is for a single submitter.

### 10.2 2LoD view

Shows all use cases across all teams. Columns: Use Case Name, Submitter, Tier, Track, Status, Stage, Last Evaluated, Policy Version, Flags. Filter chips: Tier, Track, Stage, Verdict Status. Search bar: full-text over use case name.

**Opening a case (CR7-07, 2026-10-04).** In both views each case name is a `<button type="button">`, so the keyboard and a screen reader can open the case; its accessible name is "{label} — {tier} tier, {stage}" (for example "Repeated name — High tier, Awaiting 2LoD sign-off"), so two cases with the same name are told apart. Clicking anywhere on the row still opens the case (TC-CR7-07, TC-CR7-07-1).

**R15-C1/S4 amendment (2026-08-25):** the Stale and Sampling columns are merged
into a single "Flags" column, carrying a badge for each condition that is
true (`stale_assessment: true` and/or `sampling_review_due: true`). A row
with neither flag still renders a stable, accessible cell name (e.g. "not
flagged") rather than an empty cell, so screen readers do not hear nothing.
This supersedes the two-column set below, which is kept only as history.

~~A "Stale" badge appears on use cases where `stale_assessment: true` (the
policy or pack versions have changed since the verdict was issued).~~

The "Policy updated" banner appears at the top of the 2LoD view when any active use case has a `re_evaluation_queued` audit event more recent than its last `verdict_produced` event.

### 10.3 Export (RG-5)

The "Export JSON" button in the 2LoD view calls `register.exportAll()` and triggers a browser file download. The exported JSON is:
```json
{
  "exported_at": "ISO 8601",
  "nodes": [ ...RegisterNode[] ],
  "edges": [ ...RegisterEdge[] ]
}
```

---

## 11. Integration Points

| Integrates with | Direction | Contract |
|---|---|---|
| `src/store/audit.ts` | Bidirectional | Lifecycle events written to audit trail; register reads audit events for `VerdictSummary` |
| `src/engine/evaluate.ts` | Consumes | `evaluate(graph, policy)` → `Verdict` |
| `src/engine/workflow-router.ts` | Consumes | Verdict + policy → `WorkflowAction` |
| `src/store/policy.ts` | Consumes events from | Policy version change triggers `onPolicyUpdated()` |
| `IntakeFlow.tsx` | Writes to register | New use case node added on first graph confirmation |
| `VerdictDisplay.tsx` | Reads from register | `UseCaseSummary` for stage badge in verdict header |
| `src/seeds/aigate-self-assessment.ts` | Writes to register + audit | Called once on first launch (empty register) |

---

## 12. Error Handling & Edge Cases

| Case | Handling |
|---|---|
| `addNode()` with duplicate `node_id` | IndexedDB `add()` throws; caller catches and logs — idempotent seed calls must check before inserting |
| `onPolicyUpdated()` fails mid-loop (e.g. quota exceeded) | Partial re-evaluation queue written. CR7, 2026-10-04: saving the policy again is safe, because it queues only the cases not already waiting; the policy screen says so (`policy-schema.md` §10d) |
| Graph traversal on empty register | `getBlastRadius()` returns `[]`; UI shows "No use cases found using this component" |
| Counterpoise self-assessment graph violates own gates | `evaluate()` returns `rejected`; the seed stores this result; the UI flags it as a governance alert: "Counterpoise does not satisfy its own controls — policy review required" |
| 1LoD user has no submitted use cases | `getUseCases(actorId)` returns `[]`; RegisterView shows "No use cases submitted yet" with a link to start intake |
| IndexedDB `register` database missing (first launch) | `openDB()` creates it with the schema migration; seeding runs immediately after |

---

## 13. Requirement Traceability

| Requirement | Coverage |
|---|---|
| RG-1 | §4 — adjacency list graph model; §4.3 IndexedDB schema; ADR-008 |
| RG-2 | §5 `getUseCases(role)` — query-layer filtering; ADR-009 |
| RG-3 | §10.2 filter chips and search bar |
| RG-4 | §8 — `onPolicyUpdated()` queues re-evaluation for all active cases |
| RG-5 | §10.3 — `exportAll()` → JSON download |
| RG-8 | §5 — `importRegister`/`backupAndReplaceRegister`; full bundle spec in `verdict-audit.md` §16 |
| LC-1 | §6 — lifecycle stage machine and transitions |
| LC-2 | §7 — `workflow-router.ts`; policy-configurable `tier_workflows` |
| LC-4 | §8 — policy update re-evaluation trigger |
| LC-6 | §9 — Counterpoise self-assessment seeding |

---

## 14. Test Case References

| Test cases | Spec section |
|---|---|
| TC-RG-1-01, TC-RG-1-02 | §4 graph model; §4.4 blast-radius traversal |
| TC-RG-2-01, TC-RG-2-02 | §5 `getUseCases(role)` role filtering |
| TC-RG-3-01 | §10.2 filter chips |
| TC-RG-5-01 | §10.3 export |
| TC-LC-1-01, TC-LC-1-02 | §6 lifecycle stage machine |
| TC-LC-2-01, TC-LC-2-02, TC-LC-2-03 | §7 tier-to-workflow routing |
| TC-LC-4-01 | §8 policy update trigger |
| TC-LC-6-01 | §9 Counterpoise self-assessment — normal evaluation path (renamed from TC-LC-4-02) |
| TC-LC-6-02 | §9 Counterpoise self-assessment — forced-Reject test policy produces prominent 2LoD warning |

---

*Developed using the Grounded Vibe Methodology*

---

## 15. Round 3 — The Sign-Off Page Shows the Verdict (R3-RD)

Exploratory charter 004 found that the register detail page — where a 2LoD
reviewer approves a High-tier use case or requests correction — shows the tier,
the status, the sign-off actions and the audit trail, and does not show the
verdict. The whole page measured 779 characters. The reviewer is asked to attest
to a decision whose basis the page does not present.

### ADR-RL-R3-1 — Read the verdict from the audit trail; do not recompute

**Status:** Accepted

**Context.** The register entry (`UseCaseSummary`) stores only a summary: tier,
track, status, last-evaluated timestamp, policy version. The full `Verdict`
object is already persisted, in the `verdict_produced` audit event payload
(`store/types.ts`). `RegisterDetail` already loads all audit events for the use
case.

**Options considered.**

1. **Re-run `evaluate()` on open.** Rejected outright. The verdict a reviewer
   signs must be the verdict that was produced and attested, not a fresh one
   computed against today's policy. Re-running would silently show a different
   verdict after any policy change — the opposite of an audit record. It would
   also put an engine call behind a page render.
2. **Widen `UseCaseSummary` to carry the full verdict.** Duplicates data already
   persisted, and the copy could drift from the audit trail after a correction.
3. **Read the latest `verdict_produced` (or `verdict_corrected`) payload from
   the audit trail the page already loads.** **Chosen.**

**Decision.** The page renders the verdict from the latest verdict-bearing audit
event. No recomputation, no new persistence.

**Consequences.** R3-RD-3 follows directly: the latest event is by construction
the verdict the sign-off attaches to. Entries with no such event render the
R3-RD-2 statement instead. `VerdictDisplay` already accepts `verdict` and
`auditEvents`; `graph` is *not* persisted on the register entry, so any
provenance panel that depends on it degrades and must be omitted here rather
than rendered empty.

### 15.1 The six decision-bearing elements

Per R3-RD-1, exactly these must appear:

1. verdict status and tier
2. binding constraint id
3. every triggered invariant id, with its citation
4. every control id in the minimal set, with evidence status (VERIFIED / UNVERIFIED)
5. governance margin figure, and any ids flagged as having no headroom
6. standing conditions

Content outside this list may differ from the intake rendering without failing
(TC-R3-RD-1-02 compares id **sets**, not rendered text). The intake verdict's
reclassification affordance and reasoning trace are deliberately not carried
over: they belong to the submitter's flow, not the reviewer's.

Control evidence status is called out separately (TC-R3-RD-1-03) because an
UNVERIFIED control rendered without its status would let a reviewer sign off
believing evidence exists.

### 15.1a Control evidence status comes from current policy (C-2)

**Design review round 1, C-2.** Element 4 asks for each control's evidence
status. That status is not carried on the `Verdict` — it lives on
`PolicyFile.controls[].verification_evidence`, which `VerdictDisplay` reads
live. So element 4 requires **today's** policy, while ADR-RL-R3-1 requires the
verdict itself to be historical. As first written the two contradicted each
other.

They are reconciled by scope, and the split is deliberate:

| Shown | Sourced from | Why |
|---|---|---|
| The verdict — status, tier, binding constraint, invariants, citations, margin, standing conditions | The persisted `verdict_produced` / `verdict_corrected` payload | It is the record of what was decided and attested. Recomputing it would change history. |
| Control evidence status (VERIFIED / UNVERIFIED) | The current `PolicyFile` | It is a statement about the world *now* — whether evidence exists today, not whether it existed at evaluation time. A reviewer signing off today needs today's answer. |

Presenting stale evidence status would be the dishonest option: it would tell a
reviewer that evidence exists when it may since have lapsed. The two are
labelled distinctly on the page so a reader can tell which is historical record
and which is current state.

**Prop path.** `PolicyFile` is loaded in `App.tsx` and must be threaded
`App → RegisterView → RegisterDetail`. Neither `RegisterViewProps` nor
`RegisterDetailProps` carries it today; both gain it in P8-C06. Where policy is
unavailable, evidence status renders as unknown rather than as UNVERIFIED —
absence of a policy is not evidence of absent evidence.

### 15.1b Reusing VerdictDisplay on a reviewer's page (I-1, I-2)

**Design review round 1, I-1.** `VerdictDisplay`'s `onCorrect` prop is
required, and its "Correct this classification?" button renders
unconditionally. §15.1's statement that the reclassification affordance is "not
carried over" is therefore unbuildable by reuse alone — reuse would either put
the affordance on the sign-off page or force a no-op handler behind a button
that still invites the click.

`onCorrect` becomes optional. The button, and the reasoning-trace disclosure,
render only when it is supplied. `RegisterDetail` supplies neither, so neither
appears — correction is a submitter action (`verdict-audit.md` §6.1), not a
reviewer one.

**Design review round 1, I-2.** R3-JU-6 requires a Provisional verdict to state
which condition caused it, and it is not scoped to one screen. The sign-off
page is now a place a verdict is rendered, so the requirement reaches it. The
six-element list is extended: where the verdict is Provisional, its
`provisional_reasons` are stated here too. A Provisional badge with no cause is
the defect TC-R3-JU-6-01 rejects, and it would be worse on the page where
someone signs their name.

**Design review round 1, I-4.** `findLatestVerdictEvent` already exists in
`store/register.ts` but is not exported. P8-C06 exports and reuses it rather
than writing a third copy of the same scan — the duplication ADR-EE-R3-1 was
written to close.

**CR6 amendments to the reviewer's page (2026-10-03).** `RegisterDetail` passes no graph to `VerdictDisplay`, so when a verdict declares both a platform and a supplier the inheritance panel shows one combined entry built from the verdict's own `inheritance`, with a note that this record does not keep the two apart, instead of "N controls inherited" over an empty list (CR6-11, TC-CR6-11; `verdict-audit.md` §5.7). The page also names the source of each correction in plain words, and nothing for an older record without one (CR6-10, TC-CR6-10). The lifecycle banner after a sign-off reads "cleared by 2LoD", never the reserved verdict words (CR6-29, TC-CR6-29).

### 15.2 No verdict recorded, and verdicts without explanation (R3-RD-2)

Where no verdict-bearing event exists — the seeded Counterpoise self-assessment is the
real case on every install — the page states plainly that no verdict is
recorded and leaves sign-off available.

**Design review round 1, I-10.** A second legacy state exists and is
distinct: a verdict persisted before V1.1-C01 has no `explanation`, so elements
2 and 3 (binding constraint, triggered invariants with citations) have no
source. The page states that the recorded verdict predates explanation capture
and shows the elements it does have, rather than rendering an empty invariant
list. An empty list would read as "nothing was triggered", which is a stronger
and false claim. It does not render an empty panel, and
it does not hide the section. An empty panel presented as a verdict is the same
class of defect as the missing panel it replaces.

### 15.3 Rendering must not write (R3-NF-2)

The audit trail is append-only evidence, so a write triggered by a render is a
data-integrity defect, not a performance one. Opening the page any number of
times leaves the event count unchanged (TC-R3-NF-2-01, stated over two opens
because React StrictMode double-invokes mount effects — a single open would not
catch it). The existing synchronous in-flight guard on the sign-off actions is
unchanged and still required (TC-R3-NF-2-02).

### 15.4 Constraint — the verdict-query collision (HR3-08)

Rendering the verdict here puts its status — commonly "Approved with controls" —
onto the register detail page for the first time. Existing tests query verdict
text with a single-match `/approved|rejected/i` pattern. Those queries must be
tightened **before** this section lands, not after the suite goes red. The
implementation guide sequences this as its own chunk ahead of the rendering
work.

### 15.5 Traceability

| Requirement | Section | Test cases |
|---|---|---|
| R3-RD-1 | §15.1, ADR-RL-R3-1 | TC-R3-RD-1-01, -02, -03, TC-R3-RD-5-01 |
| R3-RD-2 | §15.2 | TC-R3-RD-2-01, -02 |
| R3-RD-3 | ADR-RL-R3-1 | TC-R3-RD-3-01, -02 |
| R3-RD-4 | §15.1 | TC-R3-RD-4-01 |
| R3-NF-2 | §15.3 | TC-R3-NF-2-01, -02 |

### 15.6 Lock order with the audit queue (code-review-005 round 2, N3)

`updateLifecycleStage` writes to both stores it touches: the register node
(this file's own queue, `enqueueRegister`) and, since the change records a
`lifecycle_stage_changed` audit event, the audit trail (`audit.ts`'s queue).
Before this round it held the register queue for its whole body and awaited
the audit queue from inside that callback — register outer, audit inner.
`verdict-audit.md`'s hand-off replace (§16.8) does the opposite: it holds the
audit queue and, when it must, reaches into this store's queue.

Two operations nesting the SAME two queues in OPPOSITE directions can
deadlock outright if they run concurrently (each holds the queue the other is
waiting for — reproduced directly: reverting only this function while
`replaceWithBundle` keeps its round-2 fix makes `TC-RG-8-32` in
`handoff.test.ts` time out, not merely fail an assertion). Short of a
deadlock, leaving the two queues genuinely un-nested (two separate top-level
calls with a gap between them) lets a third write land in that gap and leave
the audit trail recording a change the register does not show — the register
half of the same defect class `verdict-audit.md` §16.8 describes for replace.

**The fixed rule, with no exception anywhere in this codebase: audit outer,
register inner.** `updateLifecycleStage` now holds `audit.ts`'s
`withAuditQueue()` for its whole body, nests this file's `enqueueRegister()`
inside it for the node write, and appends the audit event with
`audit.ts`'s `appendWithinQueue()` (not the plain, self-queuing `append()` —
calling that from inside a callback the SAME audit queue is already running
would enqueue a second turn behind the first, which is the one awaiting it: a
deadlock, not a race). See `verdict-audit.md` §16.6 for the full write-queue
picture across both stores, and §16.8 for the replace-side half of this same
lock order.

## 16. Round 11 — The Dormant Schema, Consumed (R11-MG-3)

Spec for `requirements/requirements-011.md`. §4.1's `ai_model` node type
and §4.2's `uses_model` edge type have existed since the register's first
schema and were never once instantiated — CLAUDE.md's standing gotcha ("a
field that is computed but never consumed is a bug in waiting"), caught
before it caused one.

**ADR-RL-R11-1 — an `ai_model` node is written once per distinct declared
model, keyed by `model_id`, and reused across use cases.** At graph
confirmation (the same write already producing the `use_case` node),
`addUseCaseModelLink(processingNode)` checks the register for an existing
`ai_model` node with that `model_id`; if absent, it writes one (`vendor`,
`is_approved` read from the policy registry at write time — a snapshot,
not a live join, consistent with the append-only discipline elsewhere)
before writing the `uses_model` edge. A regression test
(`register.model-nodes.test.ts`) asserts that submitting two use cases on
the same model produces exactly one `ai_model` node and two edges — the
dormancy-repeat guard named in the fit criteria.

**ADR-RL-R11-2 — the self-assessment declares its own model through the
same path.** Counterpoise's self-assessment use case (LC-6, §9) names its
runtime model (`qwen3:4b` when the local provider is active, else "none
declared") on its processing node exactly as any other use case would —
no special-cased write path, per the existing "the gate gates its
gatekeeper" framing.

**CR7 amendments (CR7, 2026-10-04): the policy-update queue, the model snapshot and the seeds.**

**Policy update (LC-4, `onPolicyUpdated`).** It queues a re-evaluation for an active case only if that case has no `re_evaluation_queued` event newer than its latest verdict (the same rule the "Policy updated" banner uses). A retry after a part-way failure therefore queues each case once; a re-save after a newer verdict queues it again. It is not keyed on the version string, so a re-save of the same version with edited rules still queues. It returns how many cases it queued and how many were already waiting; a skipped case keeps its earlier queued event, which records the version it was queued under, since the case is still waiting and will be re-evaluated against the current policy whichever save queued it (TC-CR7-06c, 06d).

**The `ai_model` register node.** Its `vendor` and `is_approved` snapshot resolves the model by exact id, else by listed family — the engine's own `resolveApprovedModel` — against the same expiry-applied policy the engine evaluated, so a family past its `reattest_by` is filed as not accepted, exactly as the verdict judged it. An id no entry covers stays vendor `unknown` and not accepted (TC-CR7-41a, 41b, 41d). This amends ADR-RL-R11-1, which read the registry by exact id only.

**Seeds run per case under the case lock.** Each seed (the sample register, the investment-bank portfolio and the Counterpoise self-assessment) takes `withCaseLock` for the case it writes and re-checks inside the lock whether the case already exists, so two module instances seeding at once write one set of events (TC-CR7-18).

**Policy save queues each case once, even when saves overlap (CR8-09, CR8, 2026-10-04).** In `onPolicyUpdated` each case's pending check (`hasPendingPolicyUpdate`) and its `re_evaluation_queued` append now both run under that case's `withCaseLock`, so two saves in flight together queue a case once: the first takes the lock and appends, the second then sees it pending and counts it as already waiting. A save waits behind a Confirm that holds the same case's lock, which is acceptable (TC-CR8-09). This amends the CR7 paragraph above, whose check ran outside the lock.

**Seeds complete a half-written case instead of repeating it (CR8-10, CR8, 2026-10-04).** Every seed writes its audit events first and its register rows last, so a reload between the two used to leave events with no node, and the next run, seeing no node, wrote a second full set of events, which cannot be cleaned up on an append-only trail. One rule (`planSeed`, `src/seeds/seed-recovery.ts`) now runs for all three seeds inside the per-case lock: the node exists, skip; no audit events for the case, seed fully; a verdict exists but no node, write only the missing register rows from the case's latest `verdict_produced` or `verdict_corrected` (the stage is the case's last `lifecycle_stage_changed`, else the router's stage for the verdict's tier) and append no events (TC-CR8-10a, 10b, 10f); events but no verdict, skip and log (TC-CR8-10c). The Counterpoise self-assessment writes its use-case node last, after the vendor, the edge and the model link, each row written only if absent, so an interrupted run is completed by the next with no duplicate rows (TC-CR8-10d, 10e). Known limit: recovery appends nothing, so a reload before an investment-bank portfolio case's scripted 2LoD events leaves it at the router's stage with no review. This amends the step order in §9 (the use-case node is no longer the first write).

**CR7 wave 2 amendments (CR7, 2026-10-04): the model link and the "No AI model is recorded" line (sentence reworded in CR9, 2026-10-04: CR9-04, neutral wording, `registerSaysNoModelNamed` keeps its name).**

**Order of writes (CR7-11).** At the first confirmation the `use_case` node is written first, then the `uses_model` link (`addUseCaseModelLink`). The verdict is already on the audit trail by then, so a failure writing the link must not strand the case: if the link write fails, the case is still saved and flagged `model_link_unrecorded: true` (an optional field on the `use_case` metadata; the hand-off schema is passthrough on `use_case` metadata, so it travels in a bundle). The register then makes no "No AI model is recorded" claim for that case (`verdict-audit.md` §5.5). If the flag write also fails, both failures are logged and the confirm still completes; the residual is that the register may then say "No AI model is recorded" for a case whose model was named (TC-CR7-11h, 11h-1, 11i, 11j).

**Audit lines (CR7-10, CR7-30).** The case page's trail shows another case's name (the matched label in `classification_adopted` and `duplicate_dismissed`) to a 2LoD view only, and a correction value that is null or absent reads "not stated" (`verdict-audit.md` §5.5; TC-CR7-10c, 30b).

## 16b. Round 18 — who supplied each answer, on the register detail (R18-GI-5, R18-MS-2, 2026-10-07; revised after design review 008)

`RegisterDetail` reads the optional `answer_sources` through `currentVerdictAttestationFields` (the one correction-aware reader) and shows, under the description: one line per distinct read ("read by {model}" with the past-tense place words of `intake-flow.md` §27.13 — never the "never leaves your computer" promise, which the app cannot prove), "N of M answers were filled in by a model and confirmed by you" (M counts shown select questions with a value; N counts confirmed pre-fills; ", and K were changed by you" when K > 0 — the same line as the confirmation step), and then per answer its value in words and “typed by you”, “filled from your description and confirmed by you — “quote””, “…and changed by you (from …)”, or “from the earlier record”; when the quote has left the final description the line says so. A case with no `answer_sources` (older, or from an older hand-off) reads exactly as it did before this round. Old multi-node cases keep their record and verdict screens unchanged; "Correct" on one opens the pre-filled form (`intake-flow.md` §27.10), and "Correct" on a new case — in the same session or after a reload — restores every answer from the recorded values. Tests: TC-R18-GI-5-01, -04, -06, -07, TC-R18-GI-10-03..06, TC-R18-MS-2-04.

## 17. Changelog

| Date | Change |
|---|---|
| 2026-10-07 | Design review 008 — §16b revised: values and reads, past-tense place words, model-filled share, correction of new cases from the record (see `intake-flow.md` §27.13). |
| 2026-10-07 | Round 18 — §16b added: the register detail shows per-answer sources and the model line (see `intake-flow.md` §27.13). |
| 2026-10-04 | CR9 — code review 009 fixes (TC-CR9-*, `test-cases-031.md`). The "No model was named" line quoted in the CR7 model-link amendments and §16 is now "No AI model is recorded" (CR9-04; neutral wording, `registerSaysNoModelNamed` and `noModelNamed` keep their names; TC-CR7-11d..11h re-pointed). |
| 2026-10-04 | CR8 — code review 008 fixes (TC-CR8-*, `test-cases-030.md`). §8 amended: the policy-save pending check and queueing run under the per-case lock (CR8-09). §9 amended: seeds complete a half-written case from its own latest verdict and write the use-case node last (CR8-10). |
| 2026-10-04 | CR7 — wave 2 (TC-CR7-*, `test-cases-029.md`). §10.2 gains the case name as a button with an accessible name (CR7-07); §4.1 gains the optional `model_link_unrecorded` flag; §16 gains the write order (node first, then the model link; a failed link saves and flags the case) and the register audit-line rules (CR7-11, CR7-10, CR7-30). |
| 2026-10-04 | CR7 — code review 007 fixes, wave 1 (TC-CR7-*, `test-cases-029.md`). §8 and §12 amended and §16 extended: a policy update queues each active case once until its next verdict and reports how many were already waiting; the `ai_model` register snapshot resolves by exact id, else by family, on the expiry-applied policy; seeds run per case under the case lock and re-check inside it. |
| 2026-10-03 | CR6 — §15.1b amended: the reviewer's page shows a combined inheritance entry when no graph is available, names each correction's source, and words the lifecycle banner without the reserved verdict words (CR6-11, 10, 29). |
| 2026-09-28 | §5 amended — code review 005 (F10). `RegisterStore` gains `importRegister` and `backupAndReplaceRegister` (RG-8 hand-off); `getUseCases`/`getUseCase` gain their real optional parameters; `updateUseCaseVerdictSummary`'s signature corrected to `Partial<UseCaseSummary>`; noted that `getUseCases` skips an unreadable row rather than failing the whole list. §13 gains an RG-8 traceability row. Full hand-off bundle spec added at `verdict-audit.md` §16. |
| 2026-07-29 | §15 added — round 3. ADR-RL-R3-1 reads the verdict from the audit trail rather than recomputing it, so the reviewer sees the verdict that was attested rather than one computed against today's policy. |
| 2026-08-17 | §17 added — round 11. ADR-RL-R11-1 consumes the dormant `ai_model`/`uses_model` schema (deduped by `model_id`); ADR-RL-R11-2 has the self-assessment declare its own runtime model through the same path. |
| 2026-08-25 | R15-C1/S4 — §10.2's Must-level column set amended: Stale and Sampling merge into one "Flags" column (badge per true condition; accessible empty-state name when neither applies), and Stage joins the visible columns. TC-RG-2-02 updated to assert the amended set. |
| 2026-09-28 | §15.6 added — code review 005 round 2 (N3). `updateLifecycleStage` flipped from register-outer/audit-inner to audit-outer/register-inner nesting, the one lock order this codebase now uses everywhere both queues are touched (`verdict-audit.md` §16.6/§16.8) — the previous ordering could deadlock against the round-2 hand-off replace fix, not just race it. |
