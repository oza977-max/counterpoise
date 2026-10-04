# Counterpoise — Evaluation Engine Specification

**Version:** 1.0  
**Date:** June 2026  
**Status:** Draft  
**Covers:** Evaluation pipeline, hard-line detection, track assignment, tier assignment, jurisdiction override, control solver (CS-1/CS-2), determinism guarantee, reasoning trace structure

---

## Expert Panel

| Expert | Work | Role in This Document |
|--------|------|-----------------------|
| Martin Kleppmann | *Designing Data-Intensive Applications* (O'Reilly 2017) | Data flow, determinism, share-nothing evaluation |
| George Fairbanks | *Just Enough Software Architecture* (Marshall & Brainerd 2010) | Risk-driven depth — control solver is the novel/risky part |
| Kent Beck | *Test-Driven Development: By Example* (Addison-Wesley 2002) | TDD discipline — deterministic engine = ideal TDD target |
| Stuart Russell | *Human Compatible* (Viking 2019) | Agentic AI control, corrigibility, minimal footprint — informs autonomy level treatment |
| SS1/23 | PRA *Model Risk Management Principles* (2023) | Track II ceiling, technology-agnostic MRM |
| SR 26-2 | Fed/OCC/FDIC *Model Risk Management* (2026) | Track III assignment, GenAI governance |
| EU AI Act | *Regulation (EU) 2024/1689* | Annex III forced-Critical tier |
| OSFI E-23 | *Enterprise-Wide Model Risk Management* (eff. 2027) | Broadest model definition — Canadian entity override |

---

## 1. Purpose

This spec defines the evaluation engine — the pure-function core of Counterpoise. It takes a confirmed data-flow graph and a loaded policy (main file + active packs) and returns a deterministic verdict. No LLM calls. No randomness. No external state.

**Files:**
- `src/engine/evaluate.ts` — main pipeline
- `src/engine/greedy-solver.ts` — minimal control set solver
- `src/engine/jurisdiction.ts` — pack application and most-demanding-standard merge
- `src/engine/contradiction.ts` — contradiction detection (UC-5, OB-2)
- `src/engine/types.ts` — shared types (defined in policy-schema spec)

---

## 2. Architecturally Significant Requirements

| ASR | Requirement | Architectural impact |
|---|---|---|
| Deterministic verdict | NF-1, PE-1 | Engine is a pure function: `evaluate(graph, policy) → Verdict`. No side effects, no randomness, no time-dependent logic |
| Hard lines evaluated first | PE-4 | Evaluation order is enforced — hard lines before control solving |
| Most demanding standard governs | PE-6, RA-2 | Jurisdiction merge step takes the maximum across all active packs |
| Minimal control set with safety margin | CS-1 | Solver minimises burden while maintaining configurable headroom from appetite boundary |
| Unsatisfiable invariant named on reject | CS-2 | Rejected verdict must name the invariant and explain why no control resolves it |
| Verdict within 30 seconds | NF-5 | Engine evaluation (excluding LLM) must complete in < 5 seconds; solver complexity must be bounded |

---

## 3. Evaluation Pipeline

### 3.1 Pipeline overview

```
evaluate(graph: DataFlowGraph, policy: PolicyFile): Result<Verdict, EngineError>

Step 1: Resolve active jurisdiction packs
Step 2: Evaluate hard lines → immediate Rejected if any trip
Step 3: Assign track (ordered rules, short-circuit at first match)
Step 4: Assign tier (impact-dominant rules, highest tier wins)
Step 5: Apply jurisdiction overrides → upgrade track/tier to jurisdictional minimum
Step 6: Evaluate invariants against the graph → collect tripped invariants
Step 7: Solve for minimal control set satisfying all tripped invariants + safety margin
Step 8: If no set satisfies → Rejected + name unsatisfiable invariant
Step 9: Assemble and return Verdict
```

This order is non-negotiable. Each step can only access data produced by prior steps — no backward references. This is the determinism guarantee (Kleppmann: data flows forward, no cycles).

### 3.2 Step 1 — Jurisdiction pack resolution

```
resolveActivePacks(
  jurisdictions: string[],          // from graph
  jurisdictionRegistry: JurisdictionEntry[],
  loadedPacks: Map<string, JurisdictionPack>
): JurisdictionPack[]
```

For each jurisdiction code in the graph, look up the corresponding pack file in the registry and return the loaded pack object. If a jurisdiction code has no registered pack, include a warning in the verdict (not an error — unknown jurisdiction = no override applied).

### 3.3 Step 2 — Hard line evaluation

```
evaluateHardLines(
  graph: DataFlowGraph,
  hardLines: HardLine[]
): HardLineResult

type HardLineResult =
  | { tripped: false }
  | { tripped: true; hardLineId: string; reason: string; regulatoryBasis: string }
```

Hard lines are evaluated in order. **First trip returns immediately** — no need to evaluate all hard lines. The reason and regulatory basis from the hard line definition are passed through to the verdict.

If a hard line trips, `evaluate()` returns immediately with:
```typescript
{
  status: 'rejected',
  reason: 'hard-line',
  hardLineId: 'HL-001',
  bindingConstraint: 'HL-001',
  bindingPath: <path from graph that triggered the condition>,
  ...
}
```

No control solving occurs. No jurisdiction overrides are applied (they cannot un-reject a hard line).

### 3.4 Step 3 — Track assignment

```
assignTrack(
  graph: DataFlowGraph,
  trackRules: TrackRule[]
): TrackAssignment

interface TrackAssignment {
  track: Track;
  ruleId: string;    // The rule that matched
  ruleName: string;
}
```

Track rules are evaluated in order. **First match returns** (short-circuit). If no rule matches, the function returns an `EngineError` of kind `'no-track-match'` — this is a policy configuration error, not a use case rejection.

**Track order is the policy file's own declared order — not sorted by id.** Every other policy collection `evaluate()` iterates (hard lines, tiers, invariants, controls) is sorted by `id` before use, so YAML authoring order can never matter (§7 point 2). Tracks are the deliberate exception: because assignment is first-match/short-circuit, the array order **is** the rule, not an accident of how the firm listed them in the file. `policy/appetite.yaml` places `TRACK-III-AGENTIC`, `TRACK-II-REPLACE` and `TRACK-II-AUTONOMY` before the general `TRACK-III`/`TRACK-I`/`TRACK-II` precisely so those special cases win first — sorting them alphabetically would put `TRACK-I` ahead of `TRACK-II-AUTONOMY` and silently defeat that ordering. `evaluate()` passes `policy.tracks` to `assignTrack()` unsorted, in file order (`src/engine/evaluate.ts`).

Fixed 2026-09-28: `evaluate()` previously called `sortedById(policy.tracks)` before `assignTrack()` — a copy of the id-sort every other collection legitimately gets, wrongly applied to the one collection where order is the mechanism. 90 of the 280 combinations of model type × autonomy (0-4) × decision bindingness × `replaces_prior_model` routed to the wrong track as a result (e.g. a statistical model at autonomy ≥ 3 landed on Track I instead of Track II). This does not weaken determinism (NF-1, §7): the policy file's array order is itself a fixed, deterministic input, byte-identical across runs without being re-sorted. See `src/engine/track.test.ts` (TC-R17-TO-01 through -05) for the regression tests and the property that pins the fix.

### 3.5 Step 4 — Tier assignment

```
assignTier(
  graph: DataFlowGraph,
  tierRules: TierRule[]
): TierAssignment

interface TierAssignment {
  tier: Tier;
  triggeringRuleId: string;
  triggeringField: string;
  triggeringValue: unknown;
}
```

All tier rules are evaluated. Each trigger in each rule is checked against the graph. **The highest tier whose trigger fires is returned** (impact-dominant, order-independent). Tier hierarchy: Critical > High > Medium > Low.

If no tier rule triggers, the default is Low (a use case with no high-impact signals is Low by default).

**Property test:** permuting the `tiers` array must never change any verdict. TC-PE-3-01 covers this invariant.

### 3.6 Step 5 — Jurisdiction overrides

```
applyJurisdictionOverrides(
  baseTrack: Track,
  baseTier: Tier,
  graph: DataFlowGraph,
  activePacks: JurisdictionPack[]
): JurisdictionOverrideResult

interface JurisdictionOverrideResult {
  finalTrack: Track;
  finalTier: Tier;
  appliedOverrides: AppliedOverride[];   // Which pack rules fired and what they changed
}
```

Packs are iterated in `pack_id` order and each pack's rules in `id` order, so
the result is byte-identical regardless of the order packs were loaded (NF-1).
For each rule whose condition matches the graph, apply its effect.

**Most demanding standard governs (PE-6, RA-2) — the supplement model:**

There are four pack effect types: `tier_floor`, `required_control`,
`required_review` and `hard_line`. There is **no `track_floor`**, and its
absence is a decision rather than a gap.

"Most demanding" is expressed by *adding obligations*, never by moving the
track:

- **Track is never changed by a pack.** A Track III use case under SS1/23
  stays Track III and inherits the SS1/23 obligation set on top.
- **Obligations are unioned across every active pack** — controls and reviews
  are collected from all of them, deduplicated and sorted. This is the
  stricter reading: nominating one pack as "governing" would mean discarding
  the obligations the others imposed.
- **A tier floor only ever raises the tier**, never lowers it (BC-V2A-01).

```typescript
const TIER_ORDER: Record<Tier, number> = { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1 };

// Tier: a floor applies only when it RAISES the tier.
if (TIER_ORDER[floor] > TIER_ORDER[finalTier]) finalTier = floor;

// Track: unchanged by packs, in either direction.
finalTrack = baseTrack;

// Obligations: union across all active packs, deduped and sorted.
addedControls = dedupeSorted(controlsFromEveryFiredRule);
addedReviews  = dedupeSorted(reviewsFromEveryFiredRule);
```

Verified against `src/engine/jurisdiction.ts:167-230` and pinned by
`TC-PE-6-01` / `TC-RA-2-01` in `src/engine/jurisdiction.test.ts`.

Applied overrides are recorded in the verdict for full traceability (VD-2, RA-9).

### 3.7 Step 6 — Invariant evaluation

```
evaluateInvariants(
  graph: DataFlowGraph,
  invariants: Invariant[]
): TrippedInvariant[]

interface TrippedInvariant {
  invariantId: string;
  description: string;
  graphPath: string;    // e.g. "client_email_data → external_model_zone_a"
}
```

All invariants are evaluated against the graph. All tripped invariants are collected (not short-circuit — we need the complete set for the solver). The graph path that triggered each invariant is recorded for the verdict's `bindingPath` (VD-2).

**Multi-node condition semantics:** a condition over a node attribute matches if ANY node on ANY input→output path satisfies it. The matching path is recorded as `binding_path`. Tests: TC-PE-1-03 (multi-node graph), TC-PE-2-06 (`no-track-match` error surfaced).

### 3.8 Step 7 + 8 — Control solver

See §4 below.

### 3.9 Step 9 — Verdict assembly

`evaluate()` returns a pure `EvaluationResult` — byte-identical across runs for the same inputs. The caller wraps it in a `Verdict` envelope adding `id`, timestamps, and attestation. TC-PE-1-01 / TC-NF-1-01 point at `EvaluationResult`.

```typescript
// Pure result — deterministic, no identity or time fields
interface EvaluationResult {
  status: 'approved' | 'approved_with_controls' | 'rejected';
  tier: Tier;
  track: Track;
  binding_constraint: string;          // ID of the rule/invariant that determined the outcome
  binding_path: string;                // Graph path that triggered the binding constraint
  controls: string[];                  // Control IDs required
  downstream_reviews: string[];        // Triggered downstream review types
  conditions: VerdictConditions;       // VD-7: hypothesis schema for V2 monitoring
  policy_version: string;
  pack_versions: Record<string, string>;
  applied_overrides: AppliedOverride[];
  confidence_caveats: ConfidenceCaveat[];  // Medium/Low confidence rules that fired (RA-11)
  boundary_proximity: boolean;         // True if any satisfied invariant has zero redundant coverage (CS-1)
  explanation: VerdictExplanation;     // V1.1-C01: the "why" — rationale + citations, deterministic
}

// V1.1-C01: wired from data the engine already computed (tier/track
// assignment rationale, hard-line reason + regulatory_basis, tripped
// invariant details) and previously discarded at verdict assembly.
interface RuleRationale {
  rule_id: string;
  rule_name?: string;
  matched_field?: string;
  regulatory_basis?: string;
}

interface TrippedInvariantDetail {
  id: string;
  description: string;
  severity: string;
  regulatory_basis?: string;
  required_controls: string[];
  graph_path: string;
}

interface VerdictExplanation {
  tier_rationale: RuleRationale | null;   // null on hard-line rejection (assignment skipped)
  track_rationale: RuleRationale | null;
  hard_lines_checked: number;
  invariants_checked: number;
  tripped_invariants: TrippedInvariantDetail[];  // the FULL set (closes the P5-C02 one-element approximation)
  binding_reason: string | null;
  binding_regulatory_basis: string | null;
}

// Envelope — added by caller, never by evaluate()
interface Verdict extends EvaluationResult {
  id: string;                          // UUID v4 — added by caller
  use_case_id: string;
  living_status: 'approved' | 'amber' | 'breached' | 'revoked';
  living_status_updated_at: string;    // ISO 8601
  attested_by: string;
  attested_at: string;
  graph_version: number;
  corrections: VerdictCorrection[];
}
```

**Regulatory chain entries (GT7, 2026-10-04).** `VerdictExplanation.regulatory_chain` (optional — verdicts stored before V2-A lack it) holds one `RegulatoryChainEntry` per fired pack rule: `rule_id`, `document`, `section`, `source_text`, `basis`, `derived`, `sign_off`, and an optional `triggered_by: Array<{ field; value; excluded? }>`. `triggered_by` is filled by `chainEntryFor(rule, derived, pack, graph)` (`jurisdiction.ts`) from `matchedConditionValues(condition, graph)` (`condition.ts`, pure): when the rule's whole condition matches, for each condition field (sorted) the distinct scalar graph values that satisfy it, sorted with a fixed non-locale comparison; `[]` when the condition does not match as a whole or the rule is unconditional; for a `not_in` condition one entry with the excluded values in `excluded`. Candidates are collected by the same function `matchesCondition` uses, so a trigger is never reported that the engine would not fire on (the `jurisdictions` array is one candidate, not a list of scalars). Pack hard-line rejections build their entry the same way. The field is optional so old stored verdicts and hand-off bundles stay valid. TC-RA-9-01b to -01r, TC-PE-1-01 (whole-result determinism covers it).

**Status determination:**
- `rejected` if any hard line tripped OR control solver returned no satisfying set
- `approved_with_controls` if tripped invariants exist AND a satisfying control set was found
- `approved` if no invariants tripped after jurisdiction overrides

---

## 4. Control Solver (CS-1, CS-2)

### 4.1 Problem statement

Given:
- A set of tripped invariants T = {t₁, t₂, ..., tₙ}
- A control library C = {c₁, c₂, ..., cₘ} where each cᵢ has `resolves: string[]` (invariant IDs it satisfies) and `burden: 1..5`
- A safety margin parameter `margin` (default 0.10, meaning the solver must satisfy all invariants with 10% headroom)
- Controls already inherited from approved platforms P ⊆ C

Find: the smallest subset S ⊆ (C \ P) such that:
1. For every invariant tᵢ ∈ T: (∃ cⱼ ∈ S ∪ P such that tᵢ ∈ cⱼ.resolves)
2. The total burden of S is minimised
3. If multiple sets of equal size exist, choose the one with the lowest total burden

If no such S exists: return the unsatisfiable invariant (the one no control in C covers).

### 4.2 Algorithm (greedy, bounded complexity)

The control library is small (O(100) controls at most). A greedy set-cover with burden tie-breaking is O(n × m) where n = invariants, m = controls. This is well within the 5-second budget for any realistic policy file.

```
FUNCTION solve(trippedInvariants, controlLibrary, inheritedControls, margin):
  
  unsatisfied = trippedInvariants
  selected = []
  
  // Remove invariants already satisfied by inherited controls
  FOR each invariant IN unsatisfied:
    IF any inherited control resolves it:
      REMOVE invariant from unsatisfied
  
  // Greedy: at each step, pick the control that resolves the most unsatisfied invariants
  // Tie-break: lower burden wins
  WHILE unsatisfied is not empty:
    candidates = controls that resolve at least one invariant in unsatisfied
    
    IF candidates is empty:
      RETURN { satisfiable: false, unsatisfiableInvariant: first(unsatisfied) }
    
    best = argmax(candidates, score=|resolved ∩ unsatisfied|, tiebreak=min(burden))
    selected.append(best)
    unsatisfied = unsatisfied MINUS best.resolves
  
  RETURN { satisfiable: true, controls: selected }
```

**Safety margin application:** The solver reports the margin the control library offers (`margin_achieved`, the share of tripped invariants the library can resolve in two or more ways — measured over the library, not the chosen set) and which tripped invariants only one control can resolve (`single_covered_invariants`). The engine, not the solver, compares that with the policy's `safety_margin`: when anything trips and the achieved margin is below the target, the verdict carries `boundary_proximity: true` (VD-6 / CS-4); nothing tripped, or a margin at or above the target, gives `false`. Full margin-aware solving is V1.5. *(Amended gvm-test 007, 2026-10-04: the earlier "no headroom above the minimum" wording predates oracle round 001 and HR-14; see `evaluate.ts` and MUT-1a..1d / `safety-margin.test.ts`.)*

### 4.3 Unsatisfiable invariant naming (CS-2)

When `candidates is empty` at any iteration, the unsatisfiable invariant is returned with:
- `invariantId`: the invariant ID
- `reason`: assembled from the invariant's description and the fact that no control in the library covers it
- `path`: the graph path that triggered it (from Step 6)

The verdict status is `rejected` with `reason: 'unsatisfiable-invariant'`.

### 4.4 Hard-line interaction

Hard lines (Step 2) are evaluated **before** the solver. Hard-line violations produce `reason: 'hard-line'`, not `reason: 'unsatisfiable-invariant'`. The distinction matters for the user-facing verdict message.

---

## 5. Contradiction Detection (UC-5, OB-2)

Contradiction detection runs **during intake** (not in the evaluation pipeline). It is invoked by the intake flow after each question answer, not by `evaluate()`. It is included in this spec because it shares graph and condition types.

```
detectContradictions(
  description: string,
  answers: QuestionAnswer[],
  graph: DataFlowGraph
): Contradiction[]

interface Contradiction {
  statement1: string;    // The original claim (from description or prior answer)
  statement2: string;    // The contradicting answer
  field: string;         // Which graph field is implicated
  resolveOptions: ContradictionResolution[];
}
```

Contradiction patterns detected:
1. **Description says X, answer says not-X** — e.g., "no client data" in description but "yes" to "does the tool process client relationship notes?"
2. **Two answers contradict each other** — e.g., "autonomy L1 (human approves each action)" combined with "tool can execute write operations without confirmation"
3. **Artifact vs self-attestation (OB-2)** — detected in intake-flow spec

---

## 6. Reasoning Trace Structure (VD-8)

The reasoning trace is assembled after `evaluate()` completes. It is not produced by the engine — it is produced by `src/llm/reasoning-trace.ts` which takes the `Verdict` object and calls the LLM to generate prose. The engine's job is to populate the verdict with enough structured data to make the trace generation deterministic and grounded.

**Verdict fields that ground the trace:**

```typescript
// These fields provide the structured facts the LLM uses for the trace
interface VerdictTraceData {
  track: Track;
  trackRuleId: string;           // e.g. "TRACK-II"
  trackRuleName: string;         // e.g. "Technology-agnostic MRM inclusion"
  tier: Tier;
  tierTriggeringRuleId: string;
  tierTriggeringField: string;
  appliedOverrides: AppliedOverride[];  // Each with source, section, verbatim text
  controls: string[];
  bindingConstraint: string;
  bindingPath: string;
  confidenceCaveats: ConfidenceCaveat[];  // For RA-11
}
```

The LLM prompt for reasoning trace construction includes all of these structured fields verbatim and asks the model to write prose that references them — not to interpret or infer. This keeps the trace grounded and auditable (NF-8).

**Amended (GT7, 2026-10-04).** The `VerdictTraceData` above is the original sketch. The shape built today (`buildTraceData`, `src/llm/reasoning-trace.ts`) also carries `track_rationale`, `tier_rationale` (the base tier, labelled so), the regulatory chain entries (`rule_id`, `document`, `section`, `source_text`, `derived`) and `binding_reason` / `binding_regulatory_basis`; see `verdict-audit.md` §7 (P10, TC-VD-8-01).

---

## 7. Determinism Guarantee (NF-1)

The engine guarantees determinism through:

1. **Pure function**: `evaluate(graph, policy)` has no side effects and no access to external state (no Date.now(), no Math.random(), no localStorage reads)
2. **Sorted inputs**: Before evaluation, all arrays (invariants, controls, hard lines, pack rules) are sorted by ID to eliminate ordering non-determinism from YAML load order. **Tracks are the one exception, by design, not by omission** (§3.4): track assignment is first-match/short-circuit, so the policy file's own declared order IS the rule, and sorting it would silently change which rule wins. Leaving it unsorted does not weaken determinism — the policy file's array order is a fixed input, not a source of run-to-run variance. Tiers are also unsorted, for the opposite structural reason: tier assignment evaluates every rule and takes the highest-ranked match (§3.5), so its result is order-independent by construction and sorting would add nothing.
3. **No LLM in the evaluation path**: The Anthropic SDK is never called within `evaluate()` or any function it calls
4. **Deterministic solver**: The greedy algorithm is deterministic when tie-breaking is deterministic (lowest burden, then alphabetical by control ID)

**Test strategy for NF-1 (TC-NF-1-01, TC-PE-1-01):** Run `evaluate()` 20 times on the same (graph, policy) pair and assert the result is identical. Include borderline cases (use cases where tier assignment depends on a single field).

---

## 8. ADR-004: Greedy Set-Cover vs SAT Solver for Control Solving

**Decision:** The control solver uses a greedy set-cover algorithm with burden tie-breaking. Not a SAT solver.

**Status:** Accepted

**Context:** The control solver is a set-cover problem (NP-complete in general). Options:
1. **SAT solver** (e.g., a Boolean satisfiability solver) — optimal for large instances; overkill for a control library bounded at O(100) items
2. **Greedy set-cover** — O(n×m); produces near-optimal results; simple to implement and audit; runs in milliseconds for any realistic policy file
3. **Exhaustive search** — O(2^m); infeasible for m > 20 controls

**Decision:** Greedy set-cover. The control library is small and human-curated — exact optimality is less important than auditability and speed. Greedy results are within a log-factor of optimal for set-cover, which is indistinguishable in practice for control libraries of this size.

**Consequences:** Very occasionally, the greedy solver may not return the globally minimal set (e.g., if two controls each resolve 2 invariants but a single control resolves 3). This is acceptable — the solver documentation notes this limitation. If needed, a branch-and-bound upgrade can be added as a V2 enhancement without changing the API.

---

## 9. ADR-005: Evaluation Order Enforcement

**Decision:** The evaluation pipeline is implemented as a sequential function with explicit typed results at each step. Not a rule engine, not a declarative policy language.

**Status:** Accepted

**Context:** Alternative approaches:
1. **Declarative rule engine** (Drools, CLIPS-style) — configurable evaluation order; complex dependency model; harder to reason about; not appropriate for a client-side browser application
2. **Sequential pipeline with typed intermediate results** — evaluation order is baked into code; each step can only access outputs from prior steps; easy to test and audit

**Decision:** Sequential pipeline. The evaluation order (PE-4 through PE-6, §3.1 above) is a hard requirement, not a configuration. Embedding it in code rather than a rule engine makes it auditable and testable with standard unit tests.

**Consequences:** Adding a new evaluation step requires a code change. This is a feature, not a limitation — it means the evaluation order is visible in code review and cannot be silently changed via policy file modification.

---

## 10. Integration Points

| Integrated with | What this spec provides |
|---|---|
| `policy-schema.md` | Consumes `PolicyFile`, `JurisdictionPack`, condition evaluation types |
| `intake-flow.md` | `detectContradictions()` called during intake; `evaluate()` called after graph confirmation |
| `verdict-audit.md` | `Verdict` type is the primary output; stored to IndexedDB by the audit store |
| `register-lifecycle.md` | Re-evaluation (LC-4) calls `evaluate()` with updated policy; result updates the register |

---

## 11. Requirement Traceability

| Requirement | Coverage |
|---|---|
| PE-1 | §3.1 pure function; §7 determinism guarantee |
| PE-2 | §3.4 track assignment |
| PE-3 | §3.5 tier assignment |
| PE-4 | §3.3 hard line evaluation; §4.4 hard-line/solver interaction |
| PE-5 | §3.6 jurisdiction override |
| PE-6 | §3.6 most-demanding-standard logic |
| CS-1 | §4 control solver; §4.2 algorithm |
| CS-2 | §4.3 unsatisfiable invariant naming |
| CS-3 | §3.9 downstream_reviews in verdict |
| NF-1 | §7 determinism guarantee |
| NF-5 | §2 ASR table; §4.2 O(n×m) complexity bound |
| UC-5 | §5 contradiction detection |
| VD-2 | §3.9 binding_constraint + binding_path in verdict |
| VD-7 | §3.9 conditions block in verdict |
| VD-8 | §6 reasoning trace structure |
| RA-2 | §3.6 most-demanding-standard implementation |
| RA-9 | §6 trace grounded in structured verdict data |
| RA-11 | §3.9 confidence_caveats field; verdict assembly |
| PE-9 | §15a list-valued attributes |
| CS-3 | §15a per-instance review sources (refines the existing §3.9 coverage) |

## 12. Test Case References

| Test cases | Spec section |
|---|---|
| TC-NF-1-01, TC-PE-1-01, TC-PE-1-02 | §7 determinism; §3.1 pipeline |
| TC-PE-2-01 through TC-PE-2-03 | §3.4 track assignment |
| TC-PE-3-01 through TC-PE-3-03 | §3.5 tier assignment |
| TC-PE-4-01 through TC-PE-4-03 | §3.3 hard line evaluation |
| TC-PE-5-01, TC-PE-5-02 | §3.6 jurisdiction override |
| TC-PE-6-01, TC-PE-6-02 | §3.6 most-demanding-standard |
| TC-CS-1-01, TC-CS-1-02 | §4 control solver |
| TC-CS-2-01 | §4.3 unsatisfiable |
| TC-CS-3-01, TC-CS-3-02 | §3.9 downstream_reviews |
| TC-UC-5-01 through TC-UC-5-03 | §5 contradiction detection |
| TC-VD-8-01 | §6 reasoning trace |
| TC-RA-2-01 | §3.6 jurisdiction override |
| TC-RA-11-01, TC-RA-11-02 | §3.9 confidence_caveats |
| TC-R16-A1-11..27, TC-R16-A1-42..49 | §15a list-valued attributes, review sources (`test-cases/test-cases-018.md`) |

---

*Developed using the Grounded Vibe Methodology*

---

## 13. Round 3 — Provisional Reasons (R3-JU-2, R3-JU-6)

### ADR-EE-R3-1 — The engine determines Provisional and names its reasons

**Status:** Accepted. Supersedes the implicit arrangement described below.

**Context.** Before round 3, "Provisional" was not a value the engine produced.
It was derived independently by two consumers from the same expression:

| Site | Expression |
|---|---|
| `VerdictDisplay.tsx:161` | `lowCaveats.length > 0` |
| `store/register.ts:55` | `verdict.confidence_caveats.some(c => c.confidence === 'low')` |

Two copies of one rule, in two layers, with no shared definition. This is a
single-source-contract violation (`cross-cutting.md` §13): the contract lived
in neither place and in both.

Round 3 adds a second, independent cause — no regulatory basis applied — and
R3-JU-6 requires the two to be distinguishable. Under the existing arrangement
that would mean editing the same rule in two files and hoping neither drifted.
A partial update would produce a use case whose verdict screen says Provisional
and whose register row does not, or the reverse, with no test asserting they
agree.

**Options considered.**

1. **Extend both derivations in place.** Cheapest edit, preserves the defect.
   Rejected: it doubles down on a duplication that round 3 is about to make
   twice as costly.
2. **Extract a shared helper in `src/store/`.** Removes the duplication but puts
   an appetite judgement in the persistence layer, which `cross-cutting.md` §7
   defines as persistence-only. Also leaves the engine unable to state its own
   confidence, so the verdict object remains incomplete on its own terms.
3. **The engine emits the determination.** `evaluate()` populates a
   `provisional_reasons` collection on the `Verdict`; consumers read it and
   never re-derive. **Chosen.**

**Decision.** The `Verdict` gains `provisional_reasons` — an ordered collection
of named reasons, empty when the verdict is not provisional. Two reasons are
defined in round 3:

| Reason | Meaning | Raised when |
|---|---|---|
| `unsigned_pack_rules` | Rules were applied, but they are proposed interpretations pending firm adoption (NF-7) | Any fired pack rule is unsigned |
| `no_regulatory_basis` | No regulatory rules were applied at all | No jurisdiction pack activated |

A verdict is Provisional if and only if `provisional_reasons` is non-empty.
Both consumers read that; neither re-derives it.

**Consequences.** The two conditions can co-occur and both are then listed, in
a fixed order, satisfying R3-JU-6's "where more than one applies, all shall be
stated". The register and the verdict screen cannot disagree, because there is
one determination. `VerdictDisplay.tsx:161` and `store/register.ts:55` are
replaced by reads, not edited in parallel.

### 13.1 Why the reasons are not interchangeable

The two reasons are different claims and the distinction is the point of
R3-JU-6. `unsigned_pack_rules` means a basis exists and has not yet been
adopted by the firm. `no_regulatory_basis` means there is no basis. Presenting
the second as the first would claim more than the engine can support — the
failure mode this product treats as functional, not cosmetic.

The engine states the condition; it does not rank them. Which is more serious
is a firm judgement, not an engine one.

### 13.1a What happens to the existing low-confidence caveat

**Design review round 1, I-3.** Before round 3, a verdict became Provisional
because a `ConfidenceCaveat` carried `confidence: 'low'`, and
`VerdictDisplay` rendered each such caveat's `reason` text. That mechanism is
not removed by round 3, and leaving both live would give the component two
independent provisional-detection paths that can disagree.

They are reconciled as producer and label, not as rivals. A fired unsigned pack
rule continues to emit its `ConfidenceCaveat` at low confidence — that is the
per-rule detail, and it keeps its existing RA-11 rendering. The engine reads
those caveats and, where any is low-confidence, adds `unsigned_pack_rules` to
`provisional_reasons`. The caveat says *which rule* is unadopted; the reason
says *why the verdict as a whole* is provisional.

`provisional_reasons` is the single determinant of Provisional status. No
consumer may re-derive it from `confidence_caveats`; the caveats remain the
detail rendered underneath.

### 13.2 Determinism (NF-1)

`provisional_reasons` is derived from the same inputs as the rest of the
verdict, in the same pass, with no clock and no randomness. Reasons are emitted
in a fixed declaration order, not in discovery order, so two runs over identical
inputs produce identical collections — the same rule that already governs policy
iteration (§7). TC-PE-1-01 compares the whole serialized result across ten runs,
so the new field is covered by the existing determinism test without
modification, which is what R3-NF-1 asserts.

### 13.3 What round 3 does not change

The verdict `status` enum is untouched. Provisional is not a fourth status: it
is a qualifier carried alongside the status, exactly as it was before round 3,
and a Provisional verdict still has an underlying in-appetite or out-of-appetite
determination. The engine's input contract is unchanged — `DataFlowGraph` gains
nothing (see `intake-flow.md` ADR-IF-R3-1).

### 13.4 Traceability

| Requirement | Section |
|---|---|
| R3-JU-2 | ADR-EE-R3-1, §13.1 |
| R3-JU-6 | ADR-EE-R3-1, §13.1 |
| R3-NF-1 | §13.2 |

| Test cases | Covers |
|---|---|
| TC-R3-JU-2-01, -02 | Reason emitted; a jurisdiction answer alone does not make a verdict Provisional |
| TC-R3-JU-6-01 … -04 | All four condition pairs of the two reasons |
| TC-R3-NF-1-01, -02 | Determinism and the engine island |

## 14. Round 11 — The Knowledge Lens (R11-KL)

Spec for `requirements/requirements-011.md`, grounded in
`grounding/ai-raf-template.html` §9 "Risk-knowledge awareness" and
`grounding/raf-extraction.md` §J.

**ADR-EE-R11-1 — the lens is a pure function outside `evaluate()`'s call
graph, reusing `matchesCondition` unchanged.** `src/engine/knowledge-lens.ts`
exports `matchKnowledgeLens(graph: DataFlowGraph, entries: KnowledgeLensEntry[], policyRuleIds: string[]): KnowledgeMatch[]`
— pure (Rule 1), calling the existing `condition.ts#matchesCondition(entry.condition, graph)`
per entry (the same evaluator hard lines/invariants already use against the
graph — no second condition language, per policy-schema.md §10b). A match's
`covered` flag is computed by checking whether `policyRuleIds` (the rule ids
that actually fired for THIS verdict — supplied by the caller, not
recomputed) intersects the entry's own curated `risk_domain` mapping; this
is a static, curated mapping declared alongside the entry, honest about
being hand-maintained rather than derived.

**Critical boundary: `matchKnowledgeLens` is never called from inside
`evaluate()`.** It is called by the SAME orchestration layer that already
supplies precedent candidates to `SimilarCases` (IntakeFlow at graph_review,
RegisterDetail per case) — a second, independent call alongside
`evaluate()`, not a step inside it. This is what makes R11-NF-1
("`evaluate()`'s decision output is byte-identical with and without the
knowledge lens loaded") true by construction rather than by discipline: the
lens literally cannot reach the verdict's inputs, because it never receives
them. The determinism test (§7) is extended with a case that runs
`evaluate()` twice — once with a knowledge lens file loaded in the test
harness, once without — asserting the serialized `Verdict` is identical
either way.

**ADR-EE-R11-2 — the coverage-gap filing reuses R4's dissent write path
exactly.** Per requirements-011.md R11-KL-3, an uncovered match's "file as
coverage gap" action calls the same `fileDissent`-family function
`RegisterDetail.tsx` already uses for rule challenges (verdict-audit.md §4.3
`rule_dissent_filed`), naming the risk class in place of a rule id. No new
audit event type, no new write path — R4's "advisory by construction"
guarantee (writes exactly one event and nothing else) is inherited, not
re-proven.

## 15. Round 12 — Time as an Explicit Input (R12-ST-1, R12-MG-1)

Spec for `requirements/requirements-012.md`.

**ADR-EE-R12-1 — staleness and re-attestation are pure pre/post
transforms; `evaluate()`'s signature does not change.** Two new pure
engine functions, both taking the date as a parameter:

- `applyReattestExpiry(policy, todayIso)` → `PolicyFile` — returns a
  policy where family entries past `reattest_by` are treated as
  `is_approved: false`. The orchestrator calls this BEFORE `evaluate()`;
  the engine core stays untouched and clock-free.
- `computeStaleSources(packs, todayIso)` → `StaleSource[]` — pack code,
  `retrieved_date`, `max_staleness_days`, days overdue, for every loaded
  pack past its window. The orchestrator calls this alongside
  `evaluate()` and attaches the result to the Verdict WRAPPER (the same
  layer that already adds `attested_at`) — never inside
  `EvaluationResult`, so TC-PE-1-01's byte-identity guarantee is
  untouched by construction.

Both are deterministic given their inputs; tests pass fixed dates. The
only clock reads remain at the component layer, where `attested_at` is
already produced.

## 15a. Round 16 — list-valued attributes and per-instance review sources
(PE-9, §1.1/§1.3, chunk A1)

Spec for `requirements/requirements.md` round 16.

**PE-9 — a node attribute may hold several values at once.**
`collectFieldValues` (condition.ts §3.7) now treats an array value on a
node exactly as it already treats several nodes carrying the same field:
each element of the array contributes its own candidate, so `{ in: [...] }`
still matches when any one of several ticked values satisfies it — no
change to `matchesCondition`'s operator semantics, only to how candidates
are collected. `describeGraphPath` names **every** input node, joined with
" + ", not just the first, so a tripped invariant's `graph_path` (and the
hard-line/pack-hard-line `binding_path` that reuses the same function)
never silently drops a node. Both changes are pure and have no effect on
any single-input, single-value graph — which is every graph before this
round, hence TC-PE-1-01's determinism guarantee holds unchanged (no
existing pinned graph_path/binding_path string is asserted anywhere; this
was verified, not assumed, before the change).

**Per-instance review sources (D-04, D-57, D-58).** `EvaluationResult`'s
existing optional `downstream_review_sources?: DownstreamReviewSource[]`
field (added when regulatory citations were restored to the verdict) is
now populated at **every** return site, from **all** producers that apply
at that point in the pipeline:

| Producer | `rule_id` shape | Available at |
|---|---|---|
| Firm `downstream_reviews` rule | the rule's own id (e.g. `DR-VENDOR-01`) | every return site |
| Pack `required_review` effect | the pack rule's own id (e.g. `SS1-UK-REV-01`) | only after jurisdiction overrides resolve (§3.6) — the two FORWARD return sites (unsatisfiable-invariant rejection, final assembly), never a hard-line rejection |
| Unregistered platform/vendor (PV-5) | `PV-UNREGISTERED:<component name>` | every return site |
| Unregistered/unapproved model (R11-MG-2) | `MODEL-REGISTRY:<model id>` | every return site |

The **base id** — the part of `rule_id` before the first `:`, or the whole
string where there is none — is what a control's `covers_reviews` entry
(policy-schema.md §10d) matches against: a firm author writes the bare
sentinel `PV-UNREGISTERED` once, not a specific component name they cannot
know in advance.

`downstream_reviews` is **derived** from `downstream_review_sources` — the
sources' `review` strings, de-duplicated and sorted — so there is one
source of truth instead of two independent derivations that could drift.
Sources collapse only when two entries are identical in BOTH `rule_id`
and `review` text (CR6, C-5, 2026-10-03; TC-CR6-C5c): a pack rule id is
unique within one pack, never guaranteed across the packs a firm loads
together, and a second pack's DIFFERENT review under a shared id is a real
obligation that a keep-first rule on the id alone would have under-reported
(TC-CR6-C5a). Two producers naming the same review text under different
ids still appear as separate, independently-traceable sources. Sources are
sorted by `rule_id`, then `review`, for determinism (NF-1), the same discipline every other policy collection
in this pipeline already follows.

**The pack hard-line fix (D-58).** Before this round, a pack-level hard
line (§3.3's pack variant) returned neither `downstream_reviews` nor
`downstream_review_sources` at all — the one return site in `evaluate()`
that set neither field. It now mirrors the BASE hard-line branch exactly:
both hard-line sites expose sources from the firm, unregistered-component
and model-governance producers (pack obligations are honestly unavailable
at either, since tier/track assignment — and therefore jurisdiction
overrides — is skipped entirely on a hard-line trip, §3.1 step order,
unchanged by this round).

**Export (D-03).** `envelope.ts` exports its data-class ranking
(`DATA_CLASS_RANK`) and the generic `maxBy` helper it is used with, so the
plain-language summary and the verdict view-model (later chunks) rank the
most-sensitive data class the same way the engine's own envelope-fit
calculation does, rather than each re-deriving a ranking that could
silently disagree.

## 16. Changelog

| Date | Change |
|---|---|
| 2026-10-04 | GT7 — §3.9 gains the regulatory chain entry shape with the optional `triggered_by` and `matchedConditionValues` (P11, TC-RA-9-01b to -01r); §6 notes the explanation's input as now built (P10, TC-VD-8-01). `test-cases-032.md`. |
| 2026-10-03 | CR6 — §15a amended (C-5): `downstream_review_sources` collapse only entries identical in both `rule_id` and `review`, sorted by `rule_id` then `review`; a shared id with different text keeps both (TC-CR6-C5a, C5c). The unused `emptyExplanation()` helper was inlined at its one call site (no behaviour change; TC-PE-1-01 unchanged). |
| 2026-10-02 | §15a added — round 16 chunk A1. PE-9: `collectFieldValues` expands an array value into per-element candidates; `describeGraphPath` names every input. Per-instance `downstream_review_sources` populated from all applicable producers at every `evaluate()` return site, with `downstream_reviews` derived from it; the pack hard-line branch (previously set neither field) now mirrors the base hard-line branch. `envelope.ts` exports `DATA_CLASS_RANK`/`maxBy`. |
| 2026-09-28 | §3.4 amended and §7 point 2 clarified — track assignment uses the policy file's own declared order, not sorted by id (the one deliberate exception among policy collections). Fixes a defect where `evaluate()` sorted `policy.tracks` by id before calling `assignTrack()`, silently defeating the ordering `policy/appetite.yaml` already declares deliberately (oracle rounds 001/002). See `src/engine/track.test.ts` TC-R17-TO-01..05. |
| 2026-08-18 | §15 added — round 12. ADR-EE-R12-1: staleness and family re-attestation as pure date-parameterised transforms outside evaluate(); NF-1 untouched by construction. |
| 2026-07-29 | §13 added — round 3 provisional reasons. ADR-EE-R3-1 moves the Provisional determination into the engine, replacing two independent derivations in `VerdictDisplay.tsx` and `store/register.ts` that round 3 would otherwise have required editing in parallel. |
| 2026-08-17 | §14 added — round 11 knowledge lens (ADR-EE-R11-1: pure function outside evaluate()'s call graph, reusing matchesCondition unchanged — determinism true by construction; ADR-EE-R11-2: coverage-gap filing reuses R4's dissent write path exactly). |
