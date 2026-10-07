# Counterpoise — Implementation Guide

**Version:** 1.0  
**Date:** June 2026  
**Status:** Draft  
**Phase numbering base:** P1 (no prior build phases — `build/handovers/` is empty)

---

## Expert Panel

| Expert | Work | Role in This Document |
|--------|------|-----------------------|
| Mike Cohn | *Agile Estimating and Planning* (Prentice Hall 2005); *User Stories Applied* (Addison-Wesley 2004) | INVEST chunk sizing; vertical slicing; dependency-aware sequencing |
| Martin Kleppmann | *Designing Data-Intensive Applications* (O'Reilly 2017) | Share-nothing parallel execution; interface contracts at chunk boundaries |
| Andrew Hunt & David Thomas | *The Pragmatic Programmer* (20th anniversary ed., Addison-Wesley 2019) | Walking skeleton; tracer bullets; DRY |
| Kent Beck | *Test-Driven Development: By Example* (Addison-Wesley 2002) | TDD at every chunk; test co-location rule |
| Frederick Brooks | *The Mythical Man-Month* (Addison-Wesley 1995) | Conceptual integrity across all slices |

---

## 1. Dependency Matrix

Each chunk is tagged: **depends on** / **enables** / **parallel with**.

| Chunk | Title | Depends on | Enables | Parallel with |
|---|---|---|---|---|
| P1-C01 | Project scaffold + walking skeleton | — | Everything | — |
| P2-C01 | Policy loader + Zod validation | P1-C01 | P3-C01, P4-C01, P5-C01 | P2-C02 |
| P2-C02 | IndexedDB stores (audit + register) | P1-C01 | P3-C01, P4-C01, P5-C01 | P2-C01 |
| P3-C01 | Evaluation engine — 8-step pipeline | P2-C01 | P3-C02, P4-C01 | P3-C02 (after C01) |
| P3-C02 | Greedy set-cover control solver | P3-C01 | P4-C01 | — |
| P4-C01 | Intake flow — LLM graph extraction + state machine | P2-C01, P2-C02, P3-C01, P3-C02 | P4-C02 | P5-C01 |
| P4-C02 | Intake flow — structured form fallback (UC-3a) | P4-C01 | P4-C03 | P5-C01 |
| P4-C03 | Question generation + contradiction detection | P4-C01 | P4-C04 | P5-C01 |
| P4-C04 | Attestation + confirmation → evaluation | P4-C03, P3-C01, P3-C02 | P5-C01, P5-C02 | — |
| P5-C01 | Verdict display + correction flow | P4-C04, P2-C02 | P5-C02 | P5-C02 (after P5-C01 API) |
| P5-C02 | Plain-English reasoning trace (VD-8) | P5-C01 | P6-C01 | — |
| P6-C01 | Register view — 1LoD + 2LoD + role access | P2-C02, P4-C04 | P6-C02 | P6-C02 (after API) |
| P6-C02 | Lifecycle stage + tier routing + policy re-eval trigger | P6-C01, P3-C01 | P7-C01 | — |
| P7-C01 | Counterpoise self-assessment seed | P6-C01, P3-C01, P3-C02, P2-C02 | P7-C02 | — |
| P7-C02 | Export (RG-5) + parity check script | P6-C01, P7-C01 | P7-C03 | — |
| P7-C03 | Integration closure + product startup verification | All chunks | — | — |

---

## 2. ASCII Dependency Network

Two tracks: **Engine track** (top) and **UI track** (bottom). Cross-links show where they join.

```
ENGINE TRACK
───────────────────────────────────────────────────────────
P1-C01  →  P2-C01  →  P3-C01  →  P3-C02  ──────────────────────────┐
           |                                                          |
           └──→  P2-C02  ──────────────────────────────────────┐     |
                                                                |     |
UI TRACK                                                        ↓     ↓
───────────────────────────────────────────────────────────────
           P4-C01  →  P4-C02  →  P4-C03  →  P4-C04  →  P5-C01  →  P5-C02
           ↑                                    ↑
           └── requires P2-C01, P2-C02 ─────────┘
           └── requires P3-C01, P3-C02 ─────────┘

REGISTER TRACK
───────────────────────────────────────────────────────────────
                                             P6-C01  →  P6-C02  →  P7-C01  →  P7-C02  →  P7-C03
                                             ↑
                                             └── requires P2-C02, P4-C04
```

**Parallel opportunities:**
- P2-C01 ∥ P2-C02 (policy loader and IndexedDB stores share no files)
- After P4-C04: P5-C01 can begin; P6-C01 can begin in parallel (share no source files until integration)

---

## 3. Critical Path

The longest sequential chain determines minimum build time:

```
P1-C01 → P2-C01 → P3-C01 → P3-C02 → P4-C01 → P4-C03 → P4-C04 → P5-C01 → P5-C02 → P6-C01 → P6-C02 → P7-C01 → P7-C02 → P7-C03
```

14 chunks on the critical path. P2-C02 and P4-C02 are off the critical path — they can be built in parallel without blocking the main sequence.

---

## 4. Wiring Matrix

Every entry point, its consumed modules, the chunk that owns the call site, and the chunk whose failing test demanded the producer.

| Entry point | Consumed modules | Wiring chunk | Demanded by |
|---|---|---|---|
| `IntakeFlow.tsx` (UC-3 path) | `src/llm/graph-extractor.ts`, `src/engine/question-generator.ts`, `src/engine/contradiction.ts`, `src/store/audit.ts` | P4-C01 | P4-C04 (intake acceptance test: confirmed graph → verdict) |
| `IntakeFlow.tsx` (UC-3a path) | `src/components/StructuredForm.tsx`, `buildGraphFromForm()`, `src/engine/question-generator.ts` | P4-C02 | P4-C04 (intake acceptance test: form path → verdict) |
| `evaluate.ts` (engine entry) | `evaluateHardLines()`, `assignJurisdiction()`, `assignTier()`, `assignTrack()`, `solvControls()`, `assembleVerdict()` | P3-C01 | P4-C04 (verdict acceptance test: evaluate(graph, policy) → Verdict) |
| `solvControls()` | `greedy-solver.ts` | P3-C02 | P3-C01 (engine pipeline test: approved-with-controls verdict requires solver) |
| `reasoning-trace.ts` | Anthropic SDK, `VerdictTraceData` | P5-C02 | P5-C01 (verdict display test: reasoning trace section renders prose) |
| `AuditStore.append()` | `idb` library, `aigate-audit` database | P2-C02 | P4-C04 (audit acceptance test: verdict_produced event written after evaluation) |
| `RegisterStore.addNode()` / `addEdge()` | `idb` library, `aigate-register` database | P2-C02 | P6-C01 (register acceptance test: use case appears in register after intake) |
| `RegisterView.tsx` (2LoD) | `RegisterStore.getUseCases('all')`, `getBlastRadius()` | P6-C01 | P6-C02 (lifecycle test: stage badge visible in register) |
| `RegisterView.tsx` (export) | `RegisterStore.exportAll()` | P7-C02 | P7-C01 (Counterpoise self-assessment test: Counterpoise entry present in export) |
| `onPolicyUpdated()` | `RegisterStore.getUseCases('all')`, `AuditStore.append()`, `RegisterStore.updateLifecycleStage()` | P6-C02 | P6-C02 (re-evaluation test: all active cases queued on policy update) |
| `workflow-router.ts` | Policy `tier_workflows` config | P6-C02 | P6-C01 (register test: Low-tier verdict shows self-service final) |
| `aigate-self-assessment.ts` (seed) | `AIGATE_USE_CASE_GRAPH`, `evaluate()`, `AuditStore.append()`, `RegisterStore.addNode()` | P7-C01 | P7-C01 (self-assessment test: Counterpoise appears in register with valid verdict) |
| `PolicyEditor.tsx` | `src/store/policy.ts`, js-yaml, Zod schema | P2-C01 | P3-C01 (engine test: evaluate() receives a loaded PolicyFile) |
| `src/engine/question-generator.ts` | `DataFlowGraph`, `PolicyFile`, `JurisdictionPack[]` — internal engine module | P4-C03 | P4-C03 (question generation test: uncertain nodes generate targeted questions) |
| `src/engine/contradiction.ts` | `DataFlowGraph`, `QuestionAnswer[]` — internal engine module | P4-C03 | P4-C03 (contradiction test: conflicting answers transition to contradiction_review) |
| `scripts/spec-parity-check.py` | Reads `specs/*.md` — no runtime consumer | P7-C02 | Demanded by: internal helper, no consumer demanded — rationale: cross-spec parity tool used by CI and /gvm-design-review; not a runtime entry point |
| `StructuredForm.tsx` (round 3) | jurisdiction answered-state, `loadFormDraft()` migration | P8-C01 | P8-C01 (form gate test: untouched jurisdiction question disables Continue) |
| `evaluate.ts` (round 3) | `provisionalReasons()` — internal engine module | P8-C04 | P8-C04 (engine test: no active pack yields `no_regulatory_basis`) |
| `VerdictDisplay.tsx` (round 3) | `verdict.provisional_reasons` — read, no longer derived locally | P8-C05 | P8-C05 (verdict test: statement and labelled cause both render) |
| `RegisterDetail.tsx` (round 3) | `VerdictDisplay`, latest verdict-bearing `AuditEvent` payload | P8-C07 | P8-C07 (sign-off test: six decision-bearing elements present) |
| `twoloD_reviewed` payload (round 3) | `verdict_id` — the id of the verdict the page rendered | P8-C08 | P8-C08 (audit test: the sign-off event names the rendered verdict) |
| `store/register.ts` (round 3) | `verdict.provisional_reasons` — read, no longer derived locally | P8-C04 | P8-C04 (register test: row status agrees with verdict status) |

---

## 5. Build Phases

### Phase 1 — Walking Skeleton

**Goal:** End-to-end wired boundary. No real business logic — but every external boundary is exercised by a **real interaction with an observable outcome** (GVM walking-skeleton rule, Ch. 12). Proves the wiring works before any domain chunk fills it in.

**MVP-1 note:** Phase 1 delivers a runnable product: the user can type a description, click through the intake wizard, see a hardcoded verdict, and view it in the register. The skeleton is interactive and end-to-end — not a page template.

**Boundary registry (2 external boundaries — both wired for real in this chunk, no stubs):**
- **persistence** — IndexedDB via the `idb` library: the skeleton writes one real row and reads it back (observable outcome), not an in-memory/console substitute.
- **network / third-party** — Anthropic API (`claude-sonnet-4-6`, `dangerouslyAllowBrowser: true`): the skeleton makes one real `tool_use` call and inspects the structured JSON response. This is our single riskiest integration (browser-side key handling, CORS, structured-output parsing) — proven at chunk 1, not deferred to P4.

---

#### P1-C01 — Project scaffold + walking skeleton

**Spec reference:** `cross-cutting.md` — project structure, toolchain, module boundaries  
**Estimated time:** 2–3 hours  
**Parallel with:** nothing (everything depends on this)

**Deliverables:**
- Vite 5 + React 18 + TypeScript 5 strict project created with `npm create vite@latest`
- `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess: true`
- Directory structure: `src/engine/`, `src/llm/`, `src/store/`, `src/components/`, `src/types/`, `src/seeds/`
- Boundaries wired REAL (no stubs — walking-skeleton rule):
  - `src/store/audit.ts` — real `idb` call: open `aigate-audit`, write one row, read it back. Minimal schema, but a real persisted row with an observable outcome.
  - `src/llm/graph-extractor.ts` — real Anthropic `messages.create` with a `tool_use` call; parse and inspect the structured JSON response. Trivial extraction is fine; the point is the boundary is exercised. Test gated on API key presence; skips cleanly without one.
- Business logic still stubbed (deepened in later phases):
  - `src/engine/evaluate.ts` — accepts graph + policy, returns a hardcoded `Verdict` stub
  - `src/store/register.ts` — in-memory stub
  - `src/store/policy.ts` — returns a hardcoded stub `PolicyFile`
  - `IntakeFlow.tsx` — minimal 3-step wizard (description → real extraction → verdict)
  - `VerdictDisplay.tsx` — renders the hardcoded verdict stub
  - `RegisterView.tsx` — shows a single hardcoded use case row
- Walking skeleton smoke test: `describe('Walking Skeleton') → it('completes full flow end-to-end with real boundaries')`
- `npm run dev` starts without errors
- `npm run build` completes without TypeScript errors

**Tests:** Boundary test (real IndexedDB write→read round-trips a row; real Anthropic call returns parseable structured output — LLM test skips cleanly without an API key) + full-flow smoke test. Tests must pass before moving to Phase 2.

---

### Phase 2 — Infrastructure

**Goal:** Real persistence and real policy loading. Engine and UI stubs still in place.

**Parallel work:** P2-C01 and P2-C02 can run in parallel — they modify different `src/store/` files.

---

#### P2-C01 — Policy loader + Zod validation

**Spec reference:** `policy-schema.md §3, §4, §5` — YAML schema, condition language, validation rules  
**Estimated time:** 3–4 hours  
**Parallel with:** P2-C02

**Deliverables:**
- `src/store/policy.ts` — real implementation replacing stub:
  - `loadPolicy(yaml: string): Result<LoadedPolicy, PolicyValidationError[]>` using `js-yaml` + Zod
  - Validates required top-level sections per `policy-schema.md §6`: `version`, `translation_attestation`,
    `hard_lines` (may be empty array), `controls` (non-empty), `tracks` (≥1 rule), `tiers` (≥1 rule),
    `tier_workflow` (all four tiers mapped), `safety_margin` (0.0–1.0)
  - Validates condition language: `gte`, `lte`, `in`, `not_in`, bare-equality operators only (per §8 ADR-002)
  - Validates all condition values against the §3.0 canonical vocabulary (`DataClass`, `DataZone`,
    `ModelType`, `Exposure`, `DecisionBindingness`, `ActionType`, `DecisionType`)
  - `PolicyFile` and `PolicyValidationResult` TypeScript types (per `policy-schema.md §5–6` — NOT
    `LoadedPolicy`/`PolicyError`, which do not exist in the canonical spec)
- Regenerate `policy/appetite.yaml` to the real `policy-schema.md §3.1` structure — the existing file
  predates tech-spec and uses a stale, non-matching schema (`meta:` wrapper, `track_classification_rules`,
  `control_library`, `platform_registry`, etc.). Replace with the canonical starter file per
  `policy-schema.md §10` (Starter Config Pre-Population): flat top-level `version`/`policy_id`/`firm_name`,
  the 3 starter hard lines, 3 track rules, 4 tier rules, minimal invariants/controls, `kri_thresholds`
  as green/amber/red bands, `jurisdictions` array (`pack_files` as array per policy-schema.md §3.8 DORA
  fix), `tier_workflow`, `translation_attestation` with `[FIRM]` markers. Full 3-pack wave-1 authoring is
  P2-C03 (human-led) — this chunk's regenerated file may reference empty/placeholder jurisdiction packs.
- `PolicyEditor.tsx` — file upload or paste textarea; shows validation errors inline
- All `PolicyValidationError` variants typed and surfaced in the UI
- `src/types/policy.ts` — all shared policy types (re-exported from `src/engine/types.ts` where the
  canonical vocabulary lives per §3.0 — do not redefine the enums here)

**Tests:**
- `TC-CF-1-01` — policy file editable in plain text without developer tooling
- `TC-CF-5-01` — policy file with missing required field prevents evaluation
- `TC-CF-5-03` — valid policy file and packs load without error
- `TC-PE-8-01` (cross-traced, CF-2) — regenerated starter config loads and evaluates a use case with no
  hand-authoring required
- Invalid condition operator produces validation error (condition-language regression, no dedicated TC ID)
- Condition value outside §3.0 canonical vocabulary produces validation error

---

#### P2-C02 — IndexedDB stores (audit + register)

**Spec reference:** `verdict-audit.md §4.4`, `register-lifecycle.md §4.3`  
**Estimated time:** 3–4 hours  
**Parallel with:** P2-C01

**Deliverables:**
- `src/store/audit.ts` — real IndexedDB implementation:
  - `aigate-audit` DB, `audit_events` object store, `by_use_case` index
  - `append(event: AuditEvent): Promise<void>` using `db.add()` (not `put()`)
  - `getAll(useCaseId: string): Promise<AuditEvent[]>`
  - `getAllForExport(): Promise<AuditEvent[]>`
- `src/store/register.ts` — real IndexedDB implementation:
  - `aigate-register` DB, `register_nodes` and `register_edges` stores
  - All indexes: `by_type`, `by_submitted_by`, `by_from_node`, `by_to_node`
  - All `RegisterStore` interface methods
- Both stores open cleanly on first launch (schema migration)
- `idb` library imported and used

**Tests:**
- `TC-VD-4-01` — append() twice with same event_id throws ConstraintError
- `getAll()` returns events in insertion order
- `getBlastRadius()` returns correct nodes for a known component
- Schema migration runs without error on empty IndexedDB

---

### Phase 3 — Evaluation Engine

**Goal:** The core pure function. No UI changes — the stub in `IntakeFlow.tsx` still calls `evaluate()`. By end of Phase 3, `evaluate()` is real and deterministic.

---

#### P3-C01 — Evaluation engine — 8-step pipeline

**Spec reference:** `evaluation-engine.md §3.1–3.8`  
**Estimated time:** 4–5 hours  
**Parallel with:** P3-C02 can begin as a spike after P3-C01 is half complete

**Deliverables:**
- `src/engine/evaluate.ts` — real 8-step pipeline replacing stub:
  1. Validate graph + policy schema
  2. Load jurisdiction overrides (most-demanding-standard)
  3. Evaluate hard lines → immediate Rejected if any trip
  4. Assign tier (impact-dominant)
  5. Assign track (first-matching rule)
  6. Evaluate invariants → collect tripped invariants
  7. Solve controls (calls `solvControls()` — stubbed as `return []` until P3-C02)
  8. Assemble Verdict
- `src/types/verdict.ts` — full `Verdict`, `VerdictConditions`, `ConfidenceCaveat` interfaces
- `src/engine/jurisdiction.ts` — jurisdiction override: most-demanding-standard
- `src/engine/tier.ts` — tier assignment
- `src/engine/track.ts` — track assignment
- Engine accepts the stub policy from P2-C01 (or the stub if P2-C01 is not yet complete in parallel builds)

**Tests:**
- `TC-PE-1-01` — determinism property: same graph + policy → identical verdict × 10 runs
- `TC-PE-2-01` — track assignment: signal-based track selection
- `TC-PE-3-01` — tier assignment: tier-triggering rule named in verdict
- `TC-PE-4-01` — hard line trip → immediate Rejected, no control solving
- `TC-PE-5-01` — jurisdiction override: most-demanding-standard applies

---

#### P3-C02 — Greedy set-cover control solver

**Spec reference:** `evaluation-engine.md §4`  
**Estimated time:** 2–3 hours  
**Parallel with:** none (replaces the stub used by P3-C01)

**Deliverables:**
- `src/engine/greedy-solver.ts`:
  - `solvControls(trippedInvariants, controlLibrary, inheritedControls, margin): SolverResult`
  - Greedy set-cover: at each step, add the control that resolves the most remaining invariants
  - Safety margin: solver must satisfy all invariants with `margin`% headroom
  - Returns `{ ok: true, controls: string[] }` or `{ ok: false, unsatisfiable: string[] }`
- `P3-C01` updated to call real solver instead of stub

**Tests:**
- `TC-CS-1-01` — greedy solver picks minimum set for a known invariant/control combination
- `TC-CS-1-02` — inherited platform controls reduce required controls
- `TC-CS-2-01` — unsatisfiable invariant set → Rejected with named invariants
- `TC-CS-3-01` — triggered downstream reviews appear in verdict

---

### Phase 4 — Intake Flow

**Goal:** Real intake wizard. LLM extraction, structured form, questions, contradiction detection, attestation. By end of Phase 4, a user can complete the full intake flow and receive a real verdict.

---

#### P4-C01 — Intake flow — LLM graph extraction + state machine

**Spec reference:** `intake-flow.md §3, §4`  
**Estimated time:** 4–5 hours  
**Parallel with:** P6-C01 can begin after P4-C04 (separate files)

**Deliverables:**
- `src/components/IntakeFlow.tsx` — real 9-state machine with `useReducer`; `IntakeState` discriminated union
- `src/llm/graph-extractor.ts` — Anthropic SDK call; tool_choice forced; Zod parse of response
- `DataFlowGraph` type with all node types from `intake-flow.md §4.2`
- `graph_review` state — renders graph nodes; `uncertain: true` nodes highlighted; Edit button per node
- Duplicate detection: semantic comparison (LLM) when API key present; keyword match fallback
- `GraphCorrection` interface and correction recording

**Tests:**
- `TC-UC-3-01` — LLM-extracted graph has correct structure
- `TC-UC-3-02` — uncertain nodes highlighted in graph review
- `TC-UC-7-01` — correction recorded with before/after values + identity

---

#### P4-C02 — Structured form fallback (UC-3a)

**Spec reference:** `intake-flow.md §5`  
**Estimated time:** 2–3 hours  
**Parallel with:** P6-C01 (after P4-C04 API boundary is stable)

**Deliverables:**
- `src/components/StructuredForm.tsx` — all 12 fields from `intake-flow.md §5.2`; all select options from loaded policy (no hardcoded enums)
- `buildGraphFromForm(formValues, extractedAt, newId): DataFlowGraph` — `intake_method: 'structured_form'`; the caller mints `extractedAt` (CR6 B-15, 2026-10-03: no clock inside the engine) and passes `newId`, the id source the engine draws every id from (ENG-ID, 2026-10-03: no id minting inside the engine)
- `usePolicy()` hook — `hasApiKey: boolean` drives path selection in `IntakeFlow.tsx`
- "Guided intake" banner shown when no API key

**Tests:**
- `TC-UC-3a-01` — structured form produces a valid `DataFlowGraph`
- `TC-UC-3a-02` — `intake_method: 'structured_form'` in audit trail
- `TC-UC-3a-03` — select options come from policy, not hardcoded
- `TC-UC-3a-04` — no error when no API key configured

---

#### P4-C03 — Question generation + contradiction detection

**Spec reference:** `intake-flow.md §6, §7`  
**Estimated time:** 3–4 hours  
**Parallel with:** nothing on this phase's critical path

**Deliverables:**
- `src/engine/question-generator.ts` — generates `IntakeQuestion[]` from graph + policy + active packs; count limits (max 5 low-tier, max 15 critical-tier)
- `src/engine/contradiction.ts` — `detectContradictions(description, answers, graph): Contradiction[]`
- `src/components/QuestionnaireStep.tsx` — renders questions; each answer dispatches to `IntakeFlow` reducer
- `src/components/ContradictionReview.tsx` — shows conflicting statements; forces resolution before advancing

**Tests:**
- `TC-UC-4-01` — uncertain nodes generate targeted questions
- `TC-UC-4-02` — question count does not exceed the tier-proportionate limit
- `TC-UC-5-01` — conflicting answers surface contradiction
- `TC-UC-5-02` — contradiction blocks advance to confirmation

---

#### P4-C04 — Attestation + confirmation → evaluation

**Spec reference:** `intake-flow.md §9`, `verdict-audit.md §4.3`  
**Estimated time:** 2–3 hours  
**Parallel with:** nothing — gating chunk for Phase 5+

**Deliverables:**
- `src/components/ConfirmationStep.tsx` — "Confirm and evaluate" button; shows final graph summary
- On confirm: `audit.append({ event_type: 'graph_confirmed', ... })` → `evaluate(graph, policy)` → `audit.append({ event_type: 'verdict_produced', ... })` → transition to `verdict` state
- `IntakeFlow.tsx` `evaluation_pending` state with loading indicator (< 200ms expected)
- Both audit events written before UI transitions

**Tests:**
- `TC-UC-6-01` — confirmation event written to audit trail before verdict
- `TC-UC-6-02` — verdict_produced event contains full Verdict object
- `TC-UC-6-03` — attested_by field matches current role

---

### Phase 5 — Verdict Display

**Goal:** Complete verdict UI. Correction flow. Plain-English trace.

---

#### P5-C01 — Verdict display + correction flow

**Spec reference:** `verdict-audit.md §5, §6`  
**Estimated time:** 3–4 hours  
**Parallel with:** P6-C01 (separate components after P4-C04 API is stable)

**Deliverables:**
- `src/components/VerdictDisplay.tsx` — status above the fold, binding constraint, controls list, downstream reviews
- Confidence caveat rendering (RA-11): Medium caveat inline; Low caveat as full-page warning with "Provisional" status
- Correction flow: "Correct a classification" → transition back to `graph_review` with `originalVerdictId` carried
- On re-evaluation: `audit.append({ event_type: 'graph_corrected' })` + `audit.append({ event_type: 'verdict_corrected' })`
- Original verdict event is never modified

**Tests:**
- `TC-VD-1-01` — verdict status visible above the fold
- `TC-VD-2-01` — binding constraint with graph path shown
- `TC-VD-3-01` — both original and corrected verdict in audit trail
- `TC-VD-3-02` — correction record includes identity and timestamp
- `TC-RA-11-01` — Medium confidence caveat displayed
- `TC-RA-11-02` — Low confidence verdict shows "Provisional" status

---

#### P5-C02 — Plain-English reasoning trace (VD-8)

**Spec reference:** `verdict-audit.md §7`  
**Estimated time:** 2–3 hours  
**Parallel with:** P6-C01 (separate module)

**Deliverables:**
- `src/llm/reasoning-trace.ts` — Anthropic SDK call; `VerdictTraceData` → prose
- Prompt: passes all structured verdict fields verbatim; instructs "reference only data provided"
- Trace stored in `verdict_produced` audit event `payload.reasoning_trace` field
- Fallback: `reasoning_trace: null` → UI shows template-based summary
- `<details>` element in `VerdictDisplay.tsx` for the reasoning trace

**Tests:**
- `TC-VD-8-01` — reasoning trace contains at least one regulatory citation (e.g. "SS1/23 §3.4")
- Trace unavailable renders fallback without error
- No API key: trace section shows "configure API key" message

---

### Phase 6 — Register

**Goal:** Full register view. Role access. Lifecycle stages. Tier routing. Policy re-eval trigger.

---

#### P6-C01 — Register view — 1LoD + 2LoD + role access

**Spec reference:** `register-lifecycle.md §5, §10`  
**Estimated time:** 3–4 hours  
**Parallel with:** P5-C01, P5-C02 (different components)

**Deliverables:**
- `src/components/RegisterView.tsx` — two views: 1LoD (own use cases), 2LoD (all use cases)
- Role driven by `localStorage['aigate:role']`; filter applied at `RegisterStore.getUseCases(role)` level
- 2LoD view: tier/track/stage filter chips; full-text search over use case names
- Use case row: name, submitter (2LoD only), tier, track, lifecycle stage, stale badge
- `stale_assessment` computed from comparing current pack versions vs verdict's `pack_versions`

**Tests:**
- `TC-RG-2-01` — 1LoD sees only own use cases
- `TC-RG-2-02` — 2LoD sees all use cases
- `TC-RG-3-01` — filter by Critical tier returns only Critical

---

#### P6-C02 — Lifecycle stage + tier routing + policy re-eval trigger

**Spec reference:** `register-lifecycle.md §6, §7, §8`  
**Estimated time:** 3–4 hours  
**Parallel with:** nothing — depends on P6-C01

**Deliverables:**
- `src/engine/workflow-router.ts` — reads `policy.tier_workflows`; returns `WorkflowAction`
- `register.updateLifecycleStage()` used throughout intake and verdict flows to advance stage
- `src/store/policy.ts` `onPolicyUpdated()` — queues re-evaluation for all active use cases
- "Policy updated" banner in 2LoD register view
- `register-lifecycle.md §6` lifecycle stage constants and transition guards

**Tests:**
- `TC-LC-1-01` — stage advances Exploring → Pre-checked after verdict
- `TC-LC-2-01` — Low-tier verdict: lifecycle advances to Approved automatically
- `TC-LC-2-02` — High-tier verdict: lifecycle stays Pre-checked pending 2LoD action
- `TC-LC-4-01` — policy update queues all active use cases for re-evaluation

---

### Phase 7 — Integration & Closure

**Goal:** Counterpoise self-assessment. Export. Spec parity script. Full product startup verification.

---

#### P7-C01 — Counterpoise self-assessment seed (LC-6)

**Spec reference:** `register-lifecycle.md §9`  
**Estimated time:** 2–3 hours  
**Parallel with:** nothing — depends on P6-C01

**Deliverables:**
- `src/seeds/aigate-self-assessment.ts` — `AIGATE_USE_CASE_GRAPH` constant
- Called once on first launch (empty register check)
- Runs real `evaluate()` against loaded policy
- Inserts use case node, Anthropic vendor node, edges, and verdict event into IndexedDB
- If Counterpoise's own verdict is Rejected: UI shows "Counterpoise does not satisfy its own controls — policy review required" governance alert

**Tests:**
- `TC-LC-4-02` — Counterpoise appears in register with a real verdict
- Counterpoise verdict contains policy_version from the current loaded policy
- Re-evaluation is triggered when policy updates (LC-4 applies to Counterpoise's use case record)

---

#### P7-C02 — Export + spec parity check script

**Spec reference:** `register-lifecycle.md §10.3`  
**Estimated time:** 2 hours  
**Parallel with:** nothing

**Deliverables:**
- `RegisterStore.exportAll()` → JSON download in `RegisterView.tsx` (2LoD only)
- `scripts/spec-parity-check.py` — checks cross-spec invariants:
  - R1: `Verdict` interface fields consistent between `evaluation-engine.md` and `verdict-audit.md`
  - R2: All TypeScript types referenced in specs are defined in at least one spec
  - R3: `LifecycleStage` values consistent across `register-lifecycle.md` and `verdict-audit.md`
  - R4: All module paths referenced in specs exist in `src/` directory (when project is built)
  - R5: All `AuditEventType` variants referenced in specs match the discriminated union definition
- Exit code 0 = clean, 1 = findings, 2 = script error

**Tests:**
- `TC-RG-5-01` — exported JSON contains all nodes and edges
- Parity script: `python3 scripts/spec-parity-check.py` exits 0 on the current spec suite

---

#### P7-C03 — Integration closure + product startup verification

**Spec reference:** All specs — closes all deferred wiring seams  
**Estimated time:** 3–4 hours  
**Parallel with:** nothing — final chunk

**Deliverables (wiring seams closed):**
- Verify `reasoning-trace.ts` output is written to `verdict_produced` audit event (P5-C02 deferred to P7)
- Verify `workflow-router.ts` output drives lifecycle stage update in `IntakeFlow.tsx` after verdict (P6-C02 deferred to P7)
- Verify `stale_assessment` badge in `RegisterView.tsx` correctly computes from audit events (P6-C01 deferred to P7)
- Verify `PolicyEditor.tsx` triggers `onPolicyUpdated()` on save (P6-C02 deferred to P7)
- Verify Counterpoise self-assessment runs on every first launch (P7-C01 integration check)

**Product startup verification:**
1. `npm run build` — TypeScript compilation passes with zero errors
2. `npm run dev` — Vite dev server starts on localhost:5173
3. Load default policy (starter config from CF-2)
4. Submit the example use case from the requirements walkthrough scenario
5. Verify: verdict produced, reasoning trace generated, use case appears in register, Counterpoise self-assessment entry present, export produces valid JSON
6. `python3 scripts/spec-parity-check.py` — exits 0

All smoke tests in this chunk are manual verification steps — they supplement (not replace) the automated test suite.

---

## 6. Claude-Specific Chunking Rules

**Context loading per chunk:** Each chunk's Claude prompt must include:
1. This implementation guide (or the relevant Phase section)
2. `cross-cutting.md` (conventions section only — §5 and §6)
3. The one domain spec most relevant to the chunk (e.g., `intake-flow.md` for P4 chunks)
4. The prior chunk's handover file (`build/handovers/P{N}-C{N}.md`) if available

**Do NOT re-load all 6 domain specs per chunk.** The domain spec for the current chunk is sufficient. If a type definition is needed from another spec, quote the relevant interface only.

**Chunk size guidance:** Each chunk fits comfortably in one context window (this guide + one domain spec + one handover = ~15K tokens). If a chunk's deliverable list feels too large, split by data variation (Cohn): e.g., if P4-C01 proves too large, split into "LLM path" and "state machine" as separate chunks.

**Large spec sections:** `evaluation-engine.md §3` is long. For P3-C01, load `evaluation-engine.md §1–3` only. Load `§4` (solver) only for P3-C02.

---

## 7. Test Co-location Rule

Every non-spike chunk includes its tests in the same delivery. The convention:
- `src/engine/evaluate.ts` → `src/engine/evaluate.test.ts` (engine/store colocate tests as siblings, not a `__tests__/` subfolder — only `src/components/*` uses `__tests__/`, per the actual convention adopted in P1-C01)
- `src/store/audit.ts` → `src/store/audit.test.ts`
- `src/components/VerdictDisplay.tsx` → `src/components/__tests__/VerdictDisplay.test.tsx`

**Never create a separate "write tests" chunk.** If tests are separate from the implementation in a chunk's deliverable list, the chunk is not complete.

Test framework: Vitest + Testing Library (per `cross-cutting.md`).

---

## 8. Parallel Work Identification

The following pairs can run as parallel Claude subagents dispatched in the same session:

| Pair | Why safe |
|---|---|
| P2-C01 ∥ P2-C02 | Different files: `policy.ts` vs `audit.ts` / `register.ts` |
| P5-C01 ∥ P6-C01 | Different components: `VerdictDisplay.tsx` vs `RegisterView.tsx`. Both require P4-C04 to be complete. |
| P5-C02 ∥ P6-C01 | `reasoning-trace.ts` and `RegisterView.tsx` share no source files |

**Merge strategy for parallel pairs:** Sequential merge. Each parallel chunk targets a different file set (share-nothing). Review both PRs for type compatibility (the `AuditEvent` and `Verdict` types are shared) before merging the second.

---

## 9. Integration Closure Verification

Before marking any phase complete, verify:
- [ ] All TypeScript: `npm run build` exits 0
- [ ] All tests: `npm run test` — no failures
- [ ] Handover file written to `build/handovers/P{N}-C{XX}.md`
- [ ] Spec parity: `python3 scripts/spec-parity-check.py` exits 0 (after P7-C02 exists)

Phase 7-C03 additionally verifies the product starts and the primary user flow completes end-to-end (manual verification steps above).

---

## 10. Changelog

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-06-04 | Initial creation. Starts at P1 — no prior build phases in `build/handovers/`. |
| 1.2 | 2026-10-07 | Design review 008 fixes — §12 revised: `round-18` branch and merge after R18-G; R18-C split into C0 (fixture spike), C1, C2; R18-D split into D1/D2 and sequenced before E; test-case ownership table; planned-modules list updated; R18-A forces the form route. |
| 1.1 | 2026-10-07 | Round 18 — §12 added: chunks R18-A to R18-G (project round convention, no collision with P1–P8 or earlier round chunks), dependency matrix and network, wiring matrix with demanded-by column, the planned-modules list read by `spec-parity-check.py`, integration closure. MVP-1 met: R18-A is a runnable no-model slice. |

---

*Developed using the Grounded Vibe Methodology*

---

## 11. Phase 8 — Round 3: Reachable Reasoning

Round 3 is an increment to a running product. It implements
`requirements-003.md` (13 requirements) against `test-cases-003.md` (33 test
cases), and touches four specs: `intake-flow.md` §13, `evaluation-engine.md`
§13, `verdict-audit.md` §13, `register-lifecycle.md` §15.

**Base phase number.** P8 — P1–P7 are in use by the V1 build (collision scan
over `build/handovers/` and this guide, 2026-07-29). The intervening
V1.1/V1.2/V2 handovers are ad-hoc chunk IDs from a period when the build
departed from the P{N}-C{XX} scheme; round 3 returns to it.

**MVP-1.** The first user-facing chunk is P8-C01, which delivers a complete
user-visible behaviour end to end: the user is asked a question, cannot proceed
without answering it, and the answer reaches the graph the engine evaluates.
No MVP-1 exemption is claimed.

### 11.1 The verdict-query constraint (HR3-08) — corrected

An earlier draft of this guide made query-tightening a standalone first chunk,
on the belief that rendering the verdict on the register detail page would break
existing tests. **That was not verified and is not true.**

The `/approved|rejected/i` assertions live at `WalkingSkeleton.test.tsx:79` and
`:135`. Both fire on the **verdict screen**, before the test navigates to the
register at line 85, and that navigation reaches `RegisterView` (the list), not
`RegisterDetail`. There is no `RegisterDetail.test.tsx` at all. No existing
query can break.

The real risk is forward-looking, and it belongs to P8-C07: that chunk writes
the first tests against a `RegisterDetail` that now renders "Approved with
controls". Its queries must be scoped — to a container, a role, or a test id —
never a bare single-match on verdict text. That is recorded as a constraint on
P8-C07 rather than as a chunk of its own.

The correction is kept in the record rather than quietly removed: the original
claim was inherited from a standing warning in `CLAUDE.md` and applied without
checking whether it fit this change.

### 11.2 Chunks

| Chunk | Delivers | Specs | Test cases | Depends on |
|---|---|---|---|---|
| **P8-C01** | Jurisdiction answered-state: three states, "none / not sure" control, help text naming the consequence | intake-flow §13.1, §13.2 | TC-R3-JU-1-01…-05, TC-R3-JU-4-01 | — |
| **P8-C02** | Required-field markers — visible marker + `aria-required`, set-equal in both directions | intake-flow §13.3 | TC-R3-JU-5-01, -02 | P8-C01 |
| **P8-C03** | Draft migration — pre-round-3 drafts load as unanswered | intake-flow §13.4 | TC-R3-JU-7-01, -02 | P8-C01 |
| **P8-C04** | `Verdict.provisional_reasons`; both existing derivations replaced by reads | evaluation-engine §13 | TC-R3-JU-2-01…-03, TC-R3-JU-6-01…-04, TC-R3-NF-1-01, -02 | — |
| **P8-C05** | Verdict renders the prose statement and the labelled causes | verdict-audit §13 | TC-R3-JU-3-01…-03 | P8-C04 |
| **P8-C06** | `VerdictDisplay` becomes reusable on a reviewer's page: `onCorrect` optional, correction affordance and reasoning-trace disclosure gated on it; `findLatestVerdictEvent` exported | register-lifecycle §15.1b | TC-R3-RD-8-01 | — |
| **P8-C07** | Register detail renders the verdict: policy prop path, the six decision-bearing elements plus provisional reasons, the no-verdict and pre-explanation states, no write on render. **Constraint:** its new `RegisterDetail` tests must scope queries to a container or role — never a bare single-match on verdict text (§11.1). | register-lifecycle §15.1, §15.1a, §15.2, §15.3 | TC-R3-RD-1-01…-03, -2-01, -02, -03, -3-01, -4-01, -5-01, -6-01, -7-01, TC-R3-NF-2-01, -02 | P8-C04, P8-C06 |
| **P8-C08** | Sign-off names the verdict it attests to: `twoloD_reviewed.verdict_id`, threaded from the render, and the refusal when the verdict changed under the reviewer | verdict-audit §13.4, register-lifecycle §15.5 | TC-R3-RD-3-02, -03 | P8-C07 |

### 11.2a Why P8-C06 was split (design review 002)

Design review 002's verdict recorded P8-C06 as having grown: it carried the
`verdict_id` schema change, the policy prop path, the `onCorrect` contract
change, the exported helper **and** the six-element rendering, while already
being the closing chunk. The review advised splitting it at build time.

The cut is by seam, not by size:

- **P8-C06 is a contract change with no page work.** It touches
  `VerdictDisplay` and the one export in `store/register.ts`, and it carries no
  logical dependency on P8-C04 — but it shares both files with the verdict
  track, so §11.4 sequences it after that track rather than beside it.
  `onCorrect` is required today
  (`src/components/VerdictDisplay.tsx:18` (as of `e830602`, before P8-C06)) and its button renders
  unconditionally (`src/components/VerdictDisplay.tsx:335`);
  `findLatestVerdictEvent` exists but is not exported
  (`src/store/register.ts:23`).
- **P8-C07 is the page work.** The policy prop is threaded here, in the chunk
  that consumes it, not one chunk early — neither `RegisterViewProps`
  (`src/components/RegisterView.tsx:9`) nor `RegisterDetailProps`
  (`src/components/RegisterDetail.tsx:10`) carries it today, and a prop
  threaded ahead of its reader is the "computed but never consumed" pattern
  `CLAUDE.md` warns about.
- **P8-C08 is the attestation change.** It is a store-schema edit
  (`twoloD_reviewed`, `src/store/types.ts:29` (as of `e830602`, before P8-C08)) plus a write-path guard, and it
  needs the rendered verdict's id — so it must follow the rendering, not
  precede it. Separating it also keeps the schema edit out of a chunk whose
  review is already reading a large component.

**Test-case correction.** The pre-split P8-C06 row listed TC-R3-RD-3-01 and
-02 but omitted **TC-R3-RD-3-03** (`test-cases/test-cases-003.md:420`), which
covers the refusal path. It is picked up by P8-C08. TC-R3-RD-3-01 is a
rendering assertion (the latest verdict is the one shown) and stays with
P8-C07.

**Second test-case correction (P8-C03, 2026-07-29).** Four more cases were
unallocated — every one of them added by design review round 1 and never
written back into this table when the review's findings were folded into the
specs. Found by cross-reading every `TC-R3-*` id in `test-cases-003.md`
against the ids named in this guide and present in the suite, which is now the
routine at each chunk close:

| Case | Added by | Now owned by |
|---|---|---|
| TC-R3-RD-8-01 — reclassification affordance absent | I-1 | P8-C06 (it is that chunk's whole point) |
| TC-R3-RD-6-01 — Provisional states its cause on the sign-off page | I-2 | P8-C07 |
| TC-R3-RD-7-01 — evidence status current, verdict historical | C-2 | P8-C07 |
| TC-R3-RD-2-03 — verdict predating explanation capture | I-10 | P8-C07 |

TC-R3-RD-4-01 (the verdict is readable without leaving the page) is a
whole-page assertion and moves to P8-C07 with the rendering; P8-C06 now carries
TC-R3-RD-8-01, which is the case that actually tests its deliverable.

### 11.3 Dependency network

```
P8-C01 ──┬── P8-C02
         └── P8-C03

P8-C04 ──── P8-C05
   └──────────────┬── P8-C07 ──── P8-C08
P8-C06 ───────────┘
```

**Critical path:** P8-C04 → P8-C07 → P8-C08 (engine field, then the page that
reads it, then the attestation that names what the page showed).

### 11.4 Parallelism (share-nothing)

Two tracks touch disjoint files and may run in parallel:

| Track | Chunks | Files |
|---|---|---|
| Intake | P8-C01 → P8-C02, P8-C03 | `StructuredForm.tsx`, `intake-draft.ts`, `build-graph-from-form.ts` |
| Verdict | P8-C04 → P8-C05 | `src/engine/*`, `VerdictDisplay.tsx`, `store/register.ts` |

P8-C07 → P8-C08 is the closing track — it modifies `RegisterDetail.tsx`, which
no other round-3 chunk touches, and depends on the verdict track's output.

**Two files are shared and both are sequenced, not parallel.**
`store/register.ts` is edited by P8-C04 (replacing the local Provisional
derivation with a read) and by P8-C06 (exporting `findLatestVerdictEvent`) —
these must not run concurrently. `VerdictDisplay.tsx` is edited by P8-C05
(rendering) and P8-C06 (the `onCorrect` contract); likewise sequential. P8-C06
is therefore best run **after** the verdict track rather than beside it, even
though it carries no logical dependency on it.

### 11.5 Integration closure

P8-C08 is the closing chunk: after it, every round-3 seam is wired — the form
produces an answered-state, the engine emits reasons, the verdict renders them,
the register page reads the verdict, and the sign-off names the verdict it
attests to. The verification is a live walkthrough
of both changed screens, plus `npm test` ×3 (per the ordering-sensitivity rule
in `CLAUDE.md`), `npx tsc --noEmit`, `npm run build`, and
`python3 scripts/spec-parity-check.py`.

An exploratory re-walk (`/gvm-explore-test` charter 005) should follow, to
confirm charter 004's D-001, D-002 and D-005 no longer reproduce. Charter 004's
remaining defects — D-001 (intake description discarded), D-004 (register shows
the input-node name), D-006 (vendor silently defaulted) — are **not** in Phase 8.
They are defects against existing behaviour with no round-3 requirement, and
need their own routing.

### 11.6 Changelog

| Date | Change |
|---|---|
| 2026-07-29 | Phase 8 added — round 3. Base phase P8 chosen after collision scan over `build/handovers/` (P1–P7 in use). Wiring matrix extended with five round-3 rows. The standalone query-tightening chunk from the first draft was dropped after verification showed no existing test breaks (§11.1); the constraint moved onto P8-C06. |
| 2026-07-29 | P8-C06 split into three (§11.2a), per design review 002's recorded caveat that it had grown to carry the `verdict_id` schema change, the policy prop path, the `onCorrect` contract change, the exported helper and the rendering. New: P8-C06 (`VerdictDisplay` reuse contract), P8-C07 (register-detail rendering), P8-C08 (sign-off attestation). TC-R3-RD-3-03 was missing from the pre-split row and is now allocated. Phase 8 is eight chunks. |

---

## 12. Round 18 — Describe, pre-fill, confirm (chunks R18-A to R18-G)

*Written 2026-10-07; **revised the same day after design review 008** (owner: fix all). Implements `requirements/requirements-018.md` (33 requirements) against `test-cases/test-cases-033.md`, designed in `intake-flow.md` §27, `cross-cutting.md` §13c, `verdict-audit.md` §16b and `register-lifecycle.md` §16b. Chunk ids follow the project's round convention (`R16-A1`, `R16-D2`): `R18-<letter>`; no collision with `P1`–`P8` or earlier round chunks. **Branching:** every push to `main` is published, so chunks R18-A to R18-G land on a `round-18` branch (CI runs there) and merge to `main` only when R18-G is green; no half-built route is ever live. **MVP-1:** R18-A is a complete, runnable slice (describe, checklist, nudge, the form, a verdict, with no model), so a product runs after chunk 1; later chunks add slices, not layers. Each chunk's build contract is generated by `/gvm-build` into `build/prompts/R18-<letter>.md`; every chunk is test-first, carries its own tests, and names the `TC-R18-*` ids it proves in the test titles. Remove `Status: PENDING BUILD` from `test-cases-033.md` in the last chunk, and keep `scripts/trace-check.py` clean at the end of every chunk.*

### 12.1 Dependency matrix

| Chunk | Delivers (vertical slice) | Depends on | Enables | Parallel with |
|---|---|---|---|---|
| R18-A | Describe-first screen with live checklist and nudge, length rule, route forced to the form (old LLM path unreachable), draft v4 and earlier-draft landings, runnable no-model pre-check; shared types stubbed in `prefill-types.ts` | — | B, C0, C1, C2 | — |
| R18-B | Model setting by place (store, validation, list, sentences, unencrypted line, demo notice, label), Settings rewrite, docs sentence constants, old-key migration and reader moves | A | C1, F, G | C0 |
| R18-C0 | Time-boxed spike: capture real Ollama replies (signed in / signed out / retired / not included / allowance / not answering) as fixtures; output is fixtures and a tightened classifier table, not production code | A (needs a live Ollama and the owner's account) | C1 (tightens it) | B |
| R18-C1 | The pre-fill call end to end up to a `Prefill`: `form-visibility.ts` extraction, catalogue, verifier, two call modes, 30 s budget and skip, safe request options, failure sentences; ends in a tracer: fake model → verifier → pre-filled unconfirmed form | A, B | C2 | — |
| R18-C2 | The form with pre-fills: `FormAnswerState`, marks, confirm gate, edit-and-return, `lastRead`, reload landing, threading of `answerState` through every later step, contradiction and rating-instruction wiring, one-engine proof | C1 | D1, E | — |
| R18-D1 | Record read side: `answer_sources` type, hand-off schema with bounds and tolerant vocabulary, `RegisterDetail` lines and model line, export statement | C2 | D2 | F |
| R18-D2 | Record write side: `toAnswerSources` called once in `runConfirmAndEvaluate`; correction of new cases from the record | D1 | E | F |
| R18-E | One route: retirement table executed, old multi-node cases open and are corrected through `answersFromGraph` | D2 | G | F |
| R18-F | In-app test: bundled corpus, runner, derived `QUESTION_FIELDS`, scorer, results store, label, Settings Test-it UI | B, C1 | G | D1, D2, E (touches only `SettingsPanel.tsx` Test-it section after B, and engine/llm files) |
| R18-G | Public site: "Make it smarter" panel, "Try an example" from one source, four-copy docs tests, dist scan in CI, CSP `file://` check, newcomer test, accessibility sweep, merge to `main` | B, E, F | — | — |

### 12.2 Dependency network

```
Engine / llm / store track                    UI track
--------------------------                    --------
R18-A: mentioned.ts, prefill-types stubs ---> R18-A: describe screen, checklist, nudge, no-model route
        |                                              |
R18-B: model-setting.ts ------------------->  R18-B: Settings by place, sentences, notices
   R18-C0 (spike) ...                                  |
R18-C1: form-visibility, verify, prefill.ts -> R18-C1: reading step, tracer form
        |                                              |
R18-C2: answer-sources (read), types -------> R18-C2: marks, gate, answerState threading
        |         \
        |          R18-F: model-test.ts, question-fields.ts ---> R18-F: Test-it UI
R18-D1: handoff schema ------------------->   R18-D1: RegisterDetail lines
R18-D2: toAnswerSources writer ----------->   R18-D2: correction from the record
R18-E: answers-from-graph.ts -------------->  R18-E: retire card review, correct old cases
                                                       |
                                              R18-G: panel, examples, docs tests, scans, sweeps, merge
```

### 12.3 Critical path

R18-A → R18-B → R18-C1 → R18-C2 → R18-D1 → R18-D2 → R18-E → R18-G. R18-C0 runs beside B. R18-F follows B and C1 and runs beside D1/D2/E; it shares no file with them (F: `src/llm/model-test.ts`, `src/engine/question-fields.ts`, the Test-it part of `SettingsPanel.tsx` — **B owns `SettingsPanel.tsx` first**, so F starts only after B is merged). D1, D2 and E are **sequential**: D2 and E both touch `IntakeFlow.tsx` and `intake-state.ts`, and D1/D2 both touch `RegisterDetail.tsx`/`store/types.ts`. Merge sequentially into `round-18` and rerun the full ritual after each merge.

### 12.4 Wiring matrix

| Entry point | Consumed modules | Wiring chunk | Demanded by |
|---|---|---|---|
| `IntakeFlow.tsx` description step | `src/engine/mentioned.ts` (`mentionedItems(text, jurisdictions)`), `ChecklistPanel.tsx`, `NUDGE_EXAMPLES`/`CHECKLIST_LABELS`, the 8,000-code-point rule | R18-A | R18-A (TC-R18-GI-1-01, -02; GI-2-02, -03) |
| `IntakeFlow.tsx` route and reducer (no model) | `intake-state.ts` (route forced to `'form'`, `nudgeFor`), `StructuredForm` | R18-A | R18-A (TC-R18-PS-1-01 full no-model pre-check to a verdict) |
| `intake-draft.ts` v4 and landings | `loadDraftInfo`, `FORM_KEY :v4`, `DraftInfo.earlierVersionNotice`, extended `probeLegacyFormDraft` | R18-A | R18-A (TC-R18-NF-5-01..04) |
| `SettingsPanel.tsx` model section | `src/llm/model-setting.ts` (`validateModelSetting`, `updateModelSetting`, `listModels`, `modelLabel`), `PLACE_SENTENCES`, demo notice, unencrypted line, "Forget the model setting" | R18-B | R18-B (TC-R18-MS-1-*, MS-2-01..03, MS-3-*, MS-6-*, PS-4-01..03, PS-5-02) |
| `src/store/reset.ts` (Clear all data) | keeps `aigate:model-setting` and `aigate:model-test-results`; both drafts cleared; says so | R18-B | R18-B (TC-R18-NF-3-02, MS-5-04; TC-CR8-16c updated) |
| `seeds/aigate-self-assessment.ts` | own default-model constant (no longer reads the setting) | R18-B | R18-B (existing self-assessment test stays green) |
| `IntakeFlow.tsx` reading step | `src/llm/prefill.ts` (`requestPrefill`), `src/engine/prefill-verify.ts`, `buildCatalogue`, `form-visibility.ts`, `startReading()` with `readingInFlight` ref, fresh `AbortController`, skip, failure sentences | R18-C1 | R18-C1 (TC-R18-GI-3-01..13, GI-7-*, MS-5-*, MS-7-*, PS-6-*, NF-1-01..03) |
| `StructuredForm.tsx` | `form-visibility.ts` (shared rules), `FormAnswerState`, marks and confirm controls | R18-C2 | R18-C2 (TC-R18-GI-4-*, GI-8-*, GI-9-02..05, GI-13-01) |
| `IntakeFlow.tsx` threading | `answerState` on `FORM_SUBMITTED`, questionnaire, contradiction_review, confirmation, `lastConfirmed`, `CORRECT_VERDICT_WITH_FORM`; `ratingInstructionsFor` guard removed; `detectContradictions` | R18-C2 | R18-C2 (TC-R18-GI-6-*, NF-4-01..04) |
| `store/audit.ts`, `store/types.ts` | `answer_sources` on `graph_confirmed` / `verdict_corrected` | R18-D1 | R18-D1 (TC-R18-GI-5-01, -04) |
| `store/handoff.ts` | zod `answer_sources` (optional, bounded, tolerant vocabulary), export statement | R18-D1 | R18-D1 (TC-R18-GI-5-02, -03, -05) |
| `RegisterDetail.tsx` | `currentVerdictAttestationFields`, per-answer lines, read lines, model-filled share | R18-D1 | R18-D1 (TC-R18-GI-5-01, -06, -07, MS-2-04) |
| `IntakeFlow.tsx` `runConfirmAndEvaluate` | `src/engine/answer-sources.ts` (`toAnswerSources`, `quoteStillInText`), called once under the confirm lock | R18-D2 | R18-D2 (TC-R18-GI-5-07, GI-10-05, -06) |
| `IntakeFlow.tsx` correction | `src/engine/answers-from-graph.ts`, `handleCorrectVerdict` (old and new cases) | R18-E | R18-E (TC-R18-GI-10-03, -04) |
| `GraphView.tsx` and the `graph_review` block | (removed per the §27.10 table) | R18-E | Demanded by: removal, no consumer remains — rationale: TC-R18-GI-10-01 asserts no screen renders the retired card review |
| `SettingsPanel.tsx` Test-it | `src/llm/model-test.ts`, `src/engine/question-fields.ts` (`deriveQuestionFields`, `applyPrefillToGraph`), bundled `backtest/cases.json` (`?raw`), `aigate:model-test-results` | R18-F | R18-F (TC-R18-MS-4-*, GI-12-*, MS-8-01, -03) |
| Description screen panel | `MakeItSmarter.tsx`, `PLACE_SENTENCES`, `OLLAMA_DOCS_CHECKED`, example list | R18-G | R18-G (TC-R18-PS-2-01..04, PS-3-01..04, PS-4-04) |
| `src/engine/worked-examples.ts` | read by `try-these.test.ts`, the example list and the docs test | R18-G | R18-G (TC-R18-PS-3-02: one source) |
| CI and `scripts/scan-dist.mjs` | `dist/` after `vite build`, `scripts/dist-scan-allow.txt` | R18-G | R18-G (TC-R18-PS-5-01, NF-3-03; MS-8-02 local release gate) |
| `src/llm/test-utils.ts` (fake model fetch) | — (test helper) | R18-C1 | Demanded by: internal helper, no consumer demanded — rationale: test-only helper used by the tests of R18-C1, R18-F and R18-G |

### 12.5 Test-case ownership (every case has a building chunk)

| Family | Chunk | Family | Chunk |
|---|---|---|---|
| GI-1-*, GI-2-* | A | MS-1-*, MS-3-*, MS-6-* | B |
| GI-3-* | C1 | MS-2-01..03 | B |
| GI-4-*, GI-6-*, GI-8-* | C2 | MS-2-04 | D1 |
| GI-5-01..06 | D1 | MS-2-05 | G |
| GI-5-07 | D2 | MS-4-*, MS-8-01, -03 | F |
| GI-7-01 (no model) | A | MS-5-*, MS-7-* | C1 |
| GI-7-02..09 | C1 | PS-1-* | A |
| GI-9-01 | A | PS-2-*, PS-3-*, PS-4-04 | G |
| GI-9-02..05 | C2 | PS-4-01..03, PS-5-02 | B |
| GI-10-01..04 | E | PS-5-01, MS-8-02 | G (local gate for MS-8-02) |
| GI-10-05, -06 | D2 | PS-6-* | C1 |
| GI-11-* | G (record `test/newcomer-r18.md`; a first run after A and after C2) | NF-1-01..03 | C1 |
| GI-12-* | F | NF-1-04, -05 | F |
| GI-13-01 | each chunk owns its rows; C2 holds the table | NF-2-* | each chunk for its elements; G sweep |
| GI-13-02 (reserved words) | A (repo-wide scan, run in every chunk) | NF-3-01, -05, -06, -07 | C1 |
| GI-13-03 | D1 | NF-3-02 | B |
| GI-14-01, -02, -05, -06, -07 | A | NF-3-03, -04 | G |
| GI-14-03, -04 | C1 (need a model) | NF-4-* | C2 |
| NF-5-* | A | | |

### 12.6 Chunks

**R18-A — Describe first, no model (GI-1, GI-2, GI-14 in part, GI-9-01, PS-1, NF-5, GI-7-01, GI-13-02).** Tests first: the sentence pairs of TC-R18-GI-1-02/-03/-09 against `mentioned.ts`; first/second-press nudge with `nudgeFor`; blank, one-character, and `not-configured`/`too-long` precedence; reload restoration; the earlier-draft fixtures of `intake-flow.md` §27.7; the repo-wide reserved-words scan. Build: `src/engine/mentioned.ts` (13 items, Unicode-bounded phrase and stem table authored in full, inflection rule), `src/engine/prefill-types.ts` (types only, so draft v4 can name `ModelPlace`/`FormAnswerState`), `ChecklistPanel` (status region, symbol plus words), the nudge and its examples, the 8,000-code-point rule and `TOO_LONG_SENTENCE`, the `not-configured` sentence, draft v4 with `FORM_KEY :v4`, `earlierVersionNotice`, the **forced `'form'` route** (delete `hasLlm`; old path unreachable until E deletes it), the extended legacy-key probe. Done when a first-time visitor with empty storage completes a pre-check to a verdict (TC-R18-PS-1-01) and `npm test` ×3, `tsc`, `build`, spec parity and trace-check are clean on the `round-18` branch. **Gate:** run the newcomer comprehension test on the new description screen (3 personas) and record it in `test/newcomer-r18.md` before B starts.

**R18-B — The model setting (MS-1, MS-2-01..03, MS-3, MS-6, PS-4-01..03, PS-5-02, NF-3-02).** Tests first: the cloud-tag table (case-insensitive), the three place rules, look-alike and credentialed addresses, validation on every send (a tampered stored setting is refused), the sentence-per-choice table, the Find-models press, the unencrypted line, the demo notice and the github.io sentence, no key field, migration (a URL with no old model key gives no model; mode reset on change), Clear-all-data keeps and says so, "Forget the model setting". Build `src/llm/model-setting.ts` (`ModelSetting`, `validateModelSetting`, `isCloudTagged`, `isLoopback`, `updateModelSetting`, `listModels`, `modelLabel`, migration), `PLACE_SENTENCES`, `PLACE_RECORD_WORDS`, `TEST_ASSUMPTION_SUFFIX` and the failure sentences in `plain-copy.ts`, the Settings model section, the description screen's model status above the Next button, `reset.ts` and the cr7-reset key list; move the self-assessment seed onto its own constant. `local-provider.ts` stays until E (its only caller is the retired graph route).

**R18-C0 — Capture real server replies (spike, time-boxed to one session).** With a live Ollama signed in and signed out: capture the reply for a retired model, a model not in the free allowance, an exhausted allowance, no sign-in, a model not pulled, the server not running, and a format-ignoring model. Save as fixtures under `src/llm/__fixtures__/` and tighten the classification table of `intake-flow.md` §27.5. If the owner cannot run it, C1 ships with the provisional matchers and the handover says so; the sentences are the contract either way. Output is knowledge and fixtures, not production code.

**R18-C1 — The pre-fill pipeline up to a `Prefill` (GI-3, GI-7-02..09, MS-5, MS-7, PS-6, NF-1-01..03, NF-3-01/-05/-06/-07, GI-14-03/-04).** Tests first: TC-R18-GI-3-01..17 against `verifyPrefill` and a fake model (including `Map`-based key safety, two-word/300-character quotes, control and bidi characters, `nothing-found`); the mode table with format-honouring, format-ignoring (both requests to the same address) and failing servers; redirect refused; 29/31-second budget with the fake clock; skip by keyboard and skip-beats-timeout; `startReading()` double press and StrictMode (one call); reload lands on the form with `not-read`; setting changed mid-read; egress harness over fetch/XHR/sendBeacon/WebSocket/EventSource/Image/window.open. Build: extract `src/engine/form-visibility.ts` from `StructuredForm` (no behaviour change; the existing form tests are the pin), `buildCatalogue`, `src/engine/prefill-verify.ts`, `src/llm/prefill.ts`, `src/llm/test-utils.ts`, the reading screen and skip control. Done when a fake model's reply shows as pre-filled, unconfirmed answers in the form (the tracer) and no reply can reach `evaluate()` (TC-R18-GI-3-09).

**R18-C2 — The form with pre-fills (GI-4, GI-6, GI-8, GI-9-02..05, GI-13-01, NF-4).** Tests first: marks, no accept-all, change counts as confirmation and change-back returns to confirmed, cascade clears hidden state, Continue gate, edit-and-return (re-ask only unconfirmed), `lastRead` fingerprint (no re-call when unchanged; "Read my description again"), derived `quoteStillInText` after edit and after restore, `answerState` carried through every later step and through `lastConfirmed`/`CORRECT_VERDICT_WITH_FORM`, the byte-identical typed-vs-pre-filled verdict with injected ids and timestamp (TC-R18-NF-4-01), the contradiction check on a changed pre-fill. Build `FormAnswerState`, `toPlainAnswers` use, the mark and confirm components, the guard removal in `ratingInstructionsFor`. Run the newcomer test on the pre-filled form (3 personas) before D1 starts. Done when the engine-boundary test (extended) still passes.

**R18-D1 — The record, read side (GI-5 in part, MS-2-04).** Tests first: register lines per origin and per distinct read, the model-filled share, "quote no longer in description", an old bundle and old records unchanged, tampered and oversized values, unknown origin/place word shown inert, prototype keys refused. Build the types in `prefill-types.ts` (`ReadRecord`, `AnswerSourceRecord`), the store type and zod additions (optional, bounded), the `RegisterDetail` reader and lines, the export-screen statement. `HANDOFF_FORMAT_VERSION` stays 1.

**R18-D2 — The record, write side (GI-5-07, GI-10-05, -06).** Tests first: a confirmed pre-filled case writes `answer_sources` once (double-click and StrictMode cannot write twice — the existing confirm lock), a typed-only case writes typed rows, `quote_in_final_description` after an edit, a correction in the same session and after a reload restores every answer. Build `src/engine/answer-sources.ts` and the single call in `runConfirmAndEvaluate`; correction from the recorded values.

**R18-E — One route (GI-10-01..04).** Tests first: no screen renders the retired title; the 11 worked examples and the 9 corpus cases with blind answers keep their pinned verdicts through the form (the other 22 keep their graph-level pins); an old multi-node case opens and its verdict renders; "Correct" on it opens the pre-filled form with only the uniquely invertible answers carried (marked "from the earlier record") and the rest blank and marked; a drift test round-trips `answersFromGraph ∘ plainAnswersToFormValues`. Build `src/engine/answers-from-graph.ts` (derived by enumeration, with the recorded assumptions as evidence) and execute the retirement table of `intake-flow.md` §27.10 row by row, each row with a grep test; delete `local-provider.ts` and `graph-extractor.ts`; rewrite the AboutPanel sentence. Each deleted case moves to a `## Superseded` row naming R18-GI-10 so trace-check reports it in the open.

**R18-F — Test it before you trust it (MS-4, MS-8-01/-03, GI-12).** Tests first: derived `QUESTION_FIELDS` snapshot, the scorer table for canned replies, the property tests of TC-R18-GI-12-05, the 59/61-second cases (fake clock), stop-early, one run at a time, saved result and label with its suffix, only-corpus requests, byte-identical bundled corpus (eval of the `?raw` string against the file on disk), a drift test that `applyPrefillToGraph` agrees with `buildGraphFromForm` on the `QUESTION_FIELDS` of the 11 examples and 9 worked cases. Build `src/engine/question-fields.ts`, `src/llm/model-test.ts` (budget and stop supplied by the component), the results store, the Settings Test-it UI with `TEST_PROGRESS`, `TEST_STOPPED`, `TEST_LIMIT`, `TEST_NOT_A_GUARANTEE` and the statement that the numbers are not comparable with the 2026-10-04 comparison.

**R18-G — The public site, release gates, merge (PS-1..PS-5, GI-11, NF-2, NF-3-03/-04, MS-2-05).** Tests first: panel states, the exact two commands and dated link, the single-source examples and the byte-identical-to-guide test, the notice states, the four-copy docs tests, `scripts/scan-dist.mjs` with anchored patterns and allow-list, the pattern scan over `docs/`, `README.md` and `backtest/cases.json`, the egress harness end to end, the keyboard walk, contrast classes added to `app-css.cr6-fx4.test.ts`. Build `MakeItSmarter.tsx`, `src/engine/worked-examples.ts` (and move `try-these.test.ts` onto it), the example list, the user guide, tester guide, README and `docs/try-these.md` updates (including the optional-key exception and the `file://` null-origin note), the CI step, and the CSP `<meta>` after a `file://` check (dropped and recorded if it fails). Owner-visible steps: the final newcomer test record, the number of checklist items each of the 11 examples ticks (OQ-4), the local confidentiality word-list scan, ratification of the deviations listed in `intake-flow.md` §27 (GI-10 narrowing, optional-key exception, PS-6 sentence). Done when every case in `test-cases-033.md` is named by a test, `Status: PENDING BUILD` is gone, and the branch merges to `main`.

### 12.7 Claude-specific chunking, parallelism, test co-location

Each chunk's context is this section, `intake-flow.md` §27 and its slice of `test-cases-033.md`; none needs the whole of `IntakeFlow.tsx` (2,655 lines) in context — read the named functions only. R18-C is pre-split (C1/C2) and its spike is separate (C0). Parallel chunks share no files (12.3); merge sequentially. Tests are co-located; there is no "write tests" chunk.

### 12.7a Planned modules (not yet built)

These paths are named by this round's specs before they exist. `scripts/spec-parity-check.py` (rule R4) reads this list and does not fail on them; it reports them as planned and fails if a listed path already exists, so the list is emptied by the chunk that builds each module.

- `src/engine/mentioned.ts` (R18-A)
- `src/engine/prefill-types.ts` (R18-A)
- `src/llm/model-setting.ts` (R18-B)
- `src/engine/form-visibility.ts` (R18-C1)
- `src/engine/prefill-verify.ts` (R18-C1)
- `src/llm/prefill.ts` (R18-C1)
- `src/llm/test-utils.ts` (R18-C1)
- `src/engine/answer-sources.ts` (R18-D2)
- `src/engine/answers-from-graph.ts` (R18-E)
- `src/llm/model-test.ts` (R18-F)
- `src/engine/question-fields.ts` (R18-F)
- `src/engine/worked-examples.ts` (R18-G)

### 12.8 Integration closure

R18-G is the closing slice: it wires the panel, the examples and the docs to the sentences and sources made earlier, removes the pending marker, runs the dist scan in CI, starts the built app from `dist/` (served over http and opened as `file://`, NF-4) to run the no-model route and, where a local Ollama is available, one pre-fill, and then merges `round-18` to `main`. Every module in 12.4 has a wiring chunk and a demanding chunk; the two exemptions carry their rationale in the cell. Required next step: the strict second design-review pass on these fixes, then `/gvm-build` R18-A.

---

*Developed using the Grounded Vibe Methodology*
