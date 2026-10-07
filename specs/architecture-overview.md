# Counterpoise — Architecture Overview

**Version:** 1.0  
**Date:** June 2026  
**Status:** Draft  
**Purpose:** Synthesises all six domain specs into a coherent system view. Does not duplicate domain spec content — references it.

---

## Expert Panel

| Expert | Work | Role in This Document |
|--------|------|-----------------------|
| Paul Clements | *Documenting Software Architectures* (2nd ed., Addison-Wesley 2010) | View decomposition; context/container framing |
| Simon Brown | *Software Architecture for Developers*, C4 Model (c4model.com) | C4 Level 1 (context) and Level 2 (container) diagrams |
| Frederick Brooks | *The Mythical Man-Month* (Addison-Wesley 1995) | Conceptual integrity review — coherence across all six specs |
| Bass, Clements, Kazman | *Software Architecture in Practice* (4th ed., Addison-Wesley 2021) | Quality attribute summary; architectural tactics |
| Michael Keeling | *Design It!* (Pragmatic Bookshelf 2017) | ADR summary; cross-cutting decision coherence |

---

## 1. System Context (C4 Level 1)

Counterpoise is a browser-only single-page application. There is no server, no database server, and no backend API. All state lives in IndexedDB inside the user's browser. The Anthropic API is the only external system.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Counterpoise System                            │
│                                                                 │
│  [1LoD Developer / AI Submitter]                                │
│    → Describes AI use case in plain language                    │
│    → Reviews extracted graph                                    │
│    → Confirms and receives verdict                              │
│                                                                 │
│  [2LoD Risk Manager]                                            │
│    → Reviews register across all teams                          │
│    → Approves High/Critical tier verdicts                       │
│    → Runs blast-radius queries on shared components             │
│                                                                 │
│  [Anthropic API]                           (external)           │
│    ← LLM graph extraction (UC-3)                                │
│    ← Plain-English reasoning trace (VD-8)                       │
│                                                                 │
│  [Bank's RAF policy YAML]                  (local file / paste) │
│    ← Loaded by user; governs all evaluations                    │
└─────────────────────────────────────────────────────────────────┘
```

**User roles:**
- **1LoD (James)** — AI project developer. Submits use cases. Sees own use cases only. Cannot approve his own high-tier verdict.
- **2LoD (Priya)** — Risk manager. Sees full register. Approves Medium/High/Critical tier verdicts. Edits policy file and runs impact diffs.

**External dependencies:**
- **Anthropic API** — called only at two points: graph extraction (`src/llm/graph-extractor.ts`) and reasoning trace generation (`src/llm/reasoning-trace.ts`). The evaluation engine never calls the LLM. Both calls require an API key configured by the user; the system degrades gracefully (structured form fallback, template reasoning trace) when no key is present.
- **Bank's policy YAML** — the source of truth for all risk appetite rules. Not served by Counterpoise; the bank loads it as a file upload or paste. Version-stamped in every verdict record.

---

## 2. Container Diagram (C4 Level 2)

Five logical containers inside the browser:

```
Browser (localhost / served from dist/)
│
├── React SPA (Vite + TypeScript strict)
│   ├── IntakeFlow.tsx        — 9-state intake wizard
│   ├── VerdictDisplay.tsx    — Verdict + correction flow
│   ├── RegisterView.tsx      — Register + filtering + export
│   └── PolicyEditor.tsx      — Policy file load + version display
│
├── Evaluation Engine (pure TypeScript, no UI)
│   ├── src/engine/evaluate.ts          — 8-step deterministic pipeline
│   ├── src/engine/question-generator.ts — Risk-proportionate questions
│   ├── src/engine/contradiction.ts      — Contradiction detection
│   └── src/engine/workflow-router.ts    — Tier-to-workflow routing
│
├── IndexedDB (via idb library)
│   ├── aigate-audit / audit_events      — Append-only audit trail
│   └── aigate-register / register_nodes — Graph inventory
│               / register_edges
│
├── LLM Bridge (Anthropic SDK, dangerouslyAllowBrowser)
│   ├── src/llm/graph-extractor.ts       — UC-3 graph extraction
│   └── src/llm/reasoning-trace.ts       — VD-8 plain-English trace
│
└── Policy Loader (js-yaml + Zod)
    └── src/store/policy.ts              — Parse, validate, version YAML
```

**Data flows:**

1. **Intake → Engine:** `IntakeFlow.tsx` calls `evaluate(graph, policy)` after attestation. The engine is a pure function — no async, no LLM, no I/O.
2. **Engine → Audit:** The verdict is written to `audit_events` via `audit.append()` immediately after evaluation.
3. **Engine → Register:** The use case node and edge graph are written to `register_nodes` / `register_edges` on first confirmation.
4. **LLM Bridge → Audit:** The reasoning trace is written into the `verdict_produced` audit event after the separate LLM call.
5. **Policy Loader → Engine:** The loaded `PolicyFile` object is passed into every `evaluate()` call. The engine reads it on each call; there is no caching that could produce stale evaluations.

---

## 3. Key Architectural Decisions

| ADR | Decision | Rationale | Spec |
|---|---|---|---|
| ADR-001 | React 18 + Vite 5 + TypeScript 5 strict | Proven SPA stack; strict TypeScript prevents the class of runtime errors common in policy-logic code | cross-cutting |
| ADR-002 | Minimal condition language (gte/lte/in/not_in/exact) — not OPA/Rego | Full policy language is over-engineered for a bank-controlled YAML config; a bank risk manager must be able to edit it without developer assistance | policy-schema |
| ADR-003 | OQ-PV-1 envelope semantics: ordinal ceiling, not set subset | Risk appetite envelopes express maximum exposure; "≤ Zone C" is the correct read, not "one of {Zone C}" | policy-schema |
| ADR-004 | Greedy set-cover control solver — not SAT | Control libraries are small and human-curated; greedy is within log-factor of optimal, auditable, and runs in milliseconds | evaluation-engine |
| ADR-005 | Sequential pipeline — not rule engine | Evaluation order (hard lines before tier before controls) is a hard regulatory requirement, not configuration | evaluation-engine |
| ADR-006 | IndexedDB append-only audit store — not localStorage | Structured data, no 5MB limit, `add()` semantics prevent overwrites; V1 provisional immutability documented honestly | verdict-audit |
| ADR-007 | LLM reasoning trace post-evaluation — not engine-native prose | Engine must be deterministic (NF-1); LLM prose is grounded by passing all structured verdict data verbatim | verdict-audit |
| ADR-008 | Adjacency list graph register in IndexedDB | RG-1 non-retrofittable; blast-radius queries require O(edges) traversal, not O(use_cases × components) | register-lifecycle |
| ADR-009 | localStorage role toggle — not real auth | OQ-3 resolution; V1 is proof-of-concept grade; clearly provisional; V1.5 adds server-side session | register-lifecycle |

---

## 4. Quality Attributes

| Quality Attribute | ASR | Tactic (Bass/Clements/Kazman) | Where enforced |
|---|---|---|---|
| **Determinism** | NF-1 | Pure function with no randomness; no LLM in the engine | `evaluation-engine.md §3` |
| **Auditability** | NF-2, NF-8 | Append-only event log; full provenance in every verdict event | `verdict-audit.md §4` |
| **Transparency** | VD-1, VD-2, VD-8 | Plain-English reasoning trace; binding constraint display; policy rule citations | `verdict-audit.md §5, §7` |
| **Graceful degradation** | NF-3, UC-3a | Structured form fallback when no API key; template reasoning trace fallback | `intake-flow.md §5`; `verdict-audit.md §7` |
| **Offline first** | NF-3 | No server dependency; policy loaded locally; LLM is optional | cross-cutting |
| **Schema evolution safety** | RG-1, VD-7 | Non-retrofittable graph model and conditions block specified in V1 data model | `register-lifecycle.md §4`; `verdict-audit.md §4.1` |
| **Role-based access** | RG-2, LC-2 | Query-layer filtering; 2LoD approval gate on High/Critical verdicts | `register-lifecycle.md §5, §7` |
| **Performance** | NF-5 | Greedy solver O(n×m); pure synchronous engine; < 200ms for realistic policy files | `evaluation-engine.md §4` |

---

## 5. Domain Spec Index

| Spec | File | Summary |
|---|---|---|
| Cross-cutting | `cross-cutting.md` | Tech stack (React 18 + Vite + TypeScript strict), project structure, error handling conventions, module boundary rules, development conventions. Every domain spec references this. |
| Policy Schema | `policy-schema.md` | YAML structure for the bank's RAF: invariants, dimension conditions, jurisdiction packs, control library, platform/vendor registry. Defines the minimal condition language (ADR-002) and envelope semantics (ADR-003). |
| Evaluation Engine | `evaluation-engine.md` | 8-step deterministic pipeline from `DataFlowGraph` to `Verdict`. Greedy set-cover control solver (ADR-004). Sequential pipeline architecture (ADR-005). The engine is a pure function — no LLM, no I/O. |
| Intake Flow | `intake-flow.md` | 9-state intake wizard from free-text description to confirmed graph. LLM graph extraction (UC-3) with structured form fallback (UC-3a). Question generation, contradiction detection, attestation. |
| Verdict & Audit | `verdict-audit.md` | Verdict display (VD-1–8), append-only audit store (NF-2), correction flow (VD-3), confidence caveats (RA-11), LLM reasoning trace (VD-8). ADR-006 (append-only store) and ADR-007 (post-evaluation trace). |
| Register & Lifecycle | `register-lifecycle.md` | Graph-based AI inventory (RG-1, non-retrofittable), role-based access (RG-2), lifecycle stage machine (LC-1), tier-to-workflow routing (LC-2), policy update re-evaluation trigger (LC-4), Counterpoise self-assessment (LC-6). |

---

**Round 18 (2026-10-07).** Intake becomes one route: describe → (optional) model pre-fill → confirm each answer on the guided form → the same engine. Architecturally this adds three pure modules to the engine island (the "mentioned" rule, the pre-fill verifier, the question → graph-field table), three model-facing modules to `src/llm` (pre-fill call with two server modes and a 30-second budget, the model setting by place, the in-app test), one optional audit field (`answer_sources`) and one setting key that "Clear all data" keeps. The engine, the policy and the boundaries are unchanged; the model proposes, a pure verifier disposes, and the person decides. Design: `intake-flow.md` §27, `cross-cutting.md` §13c, build plan `implementation-guide.md` §12 (chunks R18-A to R18-G).

## 6. Conceptual Integrity Review (Brooks)

Brooks' criterion: "I will contend that conceptual integrity is the most important consideration in system design. It is better to have a system omit certain anomalous features and improvements, but to reflect one set of design ideas, than to have one that contains many good but independent and uncoordinated ideas."

**The central design idea in Counterpoise:** A use case is a data-flow graph. The bank's appetite is a set of typed conditions on that graph. The engine is a deterministic function that maps (graph, policy) → verdict. Everything else — the intake wizard, the audit trail, the register, the reasoning trace — is scaffolding for this core function.

**Coherence assessment across specs:**

1. **The `DataFlowGraph` type flows cleanly through all specs.** Defined in `intake-flow.md`, consumed by `evaluation-engine.md`, referenced by `verdict-audit.md`, stored by `register-lifecycle.md`. One type, four consumers, no divergence.

2. **The LLM boundary is consistent.** The engine never calls the LLM (NF-1). The two LLM call sites (`graph-extractor.ts`, `reasoning-trace.ts`) are in `src/llm/` and are explicitly bounded. No other spec introduces an LLM call. The fallback pattern (no API key → graceful degradation) is the same in both sites.

3. **The audit trail is the single source of truth for everything that happened.** Every domain spec that generates events writes to `audit.ts` using the `AuditEvent` discriminated union. There is no secondary state store that could diverge from the audit trail. The register derives its `UseCaseSummary` view from audit events — it does not maintain independent state.

4. **Provisional limitations are consistently documented.** NF-2 (immutable audit trail) is V1 proof-of-concept grade and documented as such in both `verdict-audit.md` and `register-lifecycle.md`. The role access control (ADR-009) is consistently labelled provisional. These are honest V1 constraints, not deferred decisions.

5. **One design inconsistency identified and resolved:** The `lifecycle_stage_changed` event is written by `register.ts` and also audited in `audit.ts`. The spec resolves this by having `register.updateLifecycleStage()` call `audit.append()` internally — there is one write path, not two. Callers never call audit directly for lifecycle events.

**Verdict:** The system coheres as a single design. The core abstraction (graph → verdict) is consistent across all six specs. The scaffolding (intake, audit, register) does not deviate from or contradict the core. The V1 limitations are consistently positioned.

---

## 7. V1 Scope and Honest Limitations

| Item | V1 State | V2 Plan |
|---|---|---|
| Audit immutability | Application-layer only (IndexedDB `add()`); editable at OS level | Append-only server-backed event store (even a minimal SQLite) |
| Role-based access | localStorage toggle; no real auth | Server-side session; password or SSO gate |
| 2LoD notification | Badge in register view | Email / Slack notification on High/Critical verdict |
| Re-evaluation triage (LC-5) | All active use cases queued on policy update | Automated determination of affected vs unaffected use cases |
| Living status (VD-6) | Field exists in data model; not updated automatically | Live KRI feed integration |
| Blast-radius query | IndexedDB index-based traversal in-browser | Queryable graph export to external risk reporting tools |

V1 is honestly positioned as a **proof-of-concept grade** deployment. A bank that needs a regulator-defensible system of record requires V1.5 (server-backed audit store). The value proposition of V1 is: deterministic, transparent, auditable governance *logic*, running as a self-contained tool that can be evaluated before any infrastructure commitment.

---

*Developed using the Grounded Vibe Methodology*
