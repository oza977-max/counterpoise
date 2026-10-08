# Counterpoise — Test Cases, Round R16-F

*Written 2026-10-03. `build/prompts/R16-F.md` — fixes to built code from
design review 007 (`design-review/design-review-007.html` Group 1,
DR7-01 to DR7-14), plus the two requirement amendments the owner approved
alongside it: WCAG 2.1 AA for new and changed screens (DR7-10), and NF-12's
persona coverage (DR7-23, approved for this round though raised against
the not-yet-built D2 plan). Owner triage 2026-10-02: fix all, each with a
test.*

Test files: `src/engine/engine-boundary.test.ts`,
`src/components/plain-copy.test.ts`, `src/engine/plain-intake.test.ts`,
`src/engine/plausibility.test.ts`, `src/store/db.test.ts`,
`src/store/register.test.ts`,
`src/components/__tests__/IntakeFlow.r16f.test.tsx`,
`src/components/intake-state.test.ts`,
`src/components/__tests__/RegisterDetail.test.tsx`,
`src/store/handoff.test.ts`,
`src/components/__tests__/GraphView.r16f.test.tsx`,
`src/components/__tests__/StructuredForm.test.tsx`,
`src/components/__tests__/UnderstoodSummary.test.tsx`,
`src/components/__tests__/App.r16f.test.tsx`,
`src/components/__tests__/VerdictDisplay.r16d1.test.tsx`,
`src/store/policy-references.test.ts`.

## §5 — Engine/screen boundary (DR7-06)

`src/engine/plain-intake.ts` imported question-text helpers and types
straight from `src/components/plain-copy.ts`. Fixed by moving the ids/keys
the mapping needs into a new `src/engine/plain-questions.ts`; the engine
now returns assumption *references* (`{questionId, optionKey}`, plus a
`3platformZone` case) instead of worded text, and `plain-copy.ts`'s
`describeAssumptions()` is the one place a reference becomes the worded
`Assumption`.

| ID | Asserts |
|---|---|
| TC-R16-F-01 | No production file under `src/engine/` imports from `src/components/` — `engine-boundary.test.ts` |
| TC-R16-F-02 | The scan itself would flag a `components/` import if one existed (proves the guard can fail) — `engine-boundary.test.ts` |
| TC-R16-F-66 | An import written across several lines, or loaded on demand (`import()`), is caught too — the guard reads imports with TypeScript's own pre-processor, not line by line (found by review pass 1) — `engine-boundary.test.ts` |
| TC-R16-F-03 | `describeAssumptions([])` returns `[]` — `plain-copy.test.ts` |
| TC-R16-F-04 | A generic reference resolves to the exact worded assumption and question text (moved from `plain-intake.test.ts`) — `plain-copy.test.ts` |
| TC-R16-F-05 | A reference with no `ASSUMPTION_TEXT` entry is dropped silently, same as `makeAssumption()` — `plain-copy.test.ts` |
| TC-R16-F-06 | The `3platformZone` case with `earliestZone` Zone B resolves to the "outside supplier" sentence — `plain-copy.test.ts` |
| TC-R16-F-07 | The `3platformZone` case with `earliestZone` Zone A resolves to the "outside website or service" sentence — `plain-copy.test.ts` |

`plain-intake.test.ts`'s own mapping tests (TC-R16-B-01, -03, -06,
TC-R16-W-04/05/06 and others) are **updated, not superseded**: they now
assert the reference shape (`{questionId, optionKey}`) instead of worded
text — the worded assertions moved to `plain-copy.test.ts` above, which is
where the words now live.

## F-1 (DR7-02, DR7-03) — one confirmation per case, across tabs

`withCaseLock` (`src/store/db.ts`) orders a whole confirm-or-correct
sequence per case; `confirmationPrecondition` (`src/store/register.ts`) is
the read-only check, run first inside the lock, that turns that ordering
into an actual refusal of a repeat.

| ID | Asserts |
|---|---|
| TC-R16-F-12 | `withCaseLock` serialises two concurrent calls for the SAME case — the second never starts until the first resolves — `db.test.ts` |
| TC-R16-F-13 | Two DIFFERENT cases never wait on each other — `db.test.ts` |
| TC-R16-F-14 | The result and a thrown error both propagate to the caller, and a failure does not jam the per-case queue — `db.test.ts` |
| TC-R16-F-15 | A fresh confirm on a case with no trail at all is `'ok'` — `register.test.ts` |
| TC-R16-F-16 | A fresh confirm is `'already-decided'` when the trail already holds a `verdict_produced`, even with no register node written yet — `register.test.ts` |
| TC-R16-F-17 | A fresh confirm is `'already-decided'` when a register node already exists, even with no `verdict_produced` event — `register.test.ts` |
| TC-R16-F-18 | A fresh confirm is `'ok'` when the case has a `graph_confirmed` but no verdict yet (a genuine evaluation retry, not a repeat) — `register.test.ts` |
| TC-R16-F-19 | A correction is `'ok'` when the trail's current verdict still matches the one being corrected — `register.test.ts` |
| TC-R16-F-20 | A correction is `'corrected-elsewhere'` when another correction already moved the trail's current verdict on — `register.test.ts` |
| TC-R16-F-21 | A correction against a case with no register node at all is `'ok'` — nothing to conflict with — `register.test.ts` |
| TC-R16-F-22 | A confirm refused because another tab already confirmed the same case writes nothing, shows the "already decided" alert, and disables Confirm — `IntakeFlow.r16f.test.tsx` |
| TC-R16-F-23 | A correction refused because another tab's correction already landed writes nothing and shows the "corrected elsewhere" alert — `IntakeFlow.r16f.test.tsx` |

## F-2 (DR7-04) — an evaluation error never orphans the case

| ID | Asserts |
|---|---|
| TC-R16-F-24 | A form-path evaluation failure returns to the FORM, filled in, not `graph_review`, and orphans nothing on the trail — `IntakeFlow.r16f.test.tsx` |
| TC-R16-F-52 | `STEP_BACK` is a no-op on `graph_review` when `afterFailedEvaluation` is set — `intake-state.test.ts` |
| TC-R16-F-53 | A form-path graph (`intake_method: 'structured_form'`) returns to `graph_extraction`, filled in, with the case id reused — `intake-state.test.ts` |
| TC-R16-F-54 | A description-path graph (`intake_method: 'llm'`) still returns to `graph_review`, now with `afterFailedEvaluation: true` — `intake-state.test.ts` |

## F-3 (DR7-05) — the creation record is written at Confirm, once

| ID | Asserts |
|---|---|
| TC-R16-F-25 | "Start over" after Continue but before Confirm leaves no event on the trail for that case id — `IntakeFlow.r16f.test.tsx` |

TC-R16-W-62 and TC-R16-W-66 (`IntakeFlow.r16w.test.tsx`) are **updated, not
superseded**: both already drove the flow through to Confirm before
reading the trail, so their assertions (exactly one `use_case_created`,
carrying question 2's final text) hold unchanged under the new write
timing — only their comments were refreshed to say so. The WalkingSkeleton
tests that asserted the audit-trail event sequence for a fresh confirm
(`P4-C04`, `explore-001 D-001`, `P5-C01`, and the no-track-match test) are
also **updated, not superseded**: each now expects a leading
`use_case_created` the description path never had before this fix, and
the no-track-match test's routing assertion was updated to match F-2
(`WalkingSkeleton.test.tsx`). `GraphReview.r9.test.tsx`'s "the trail
records the birth event" test is **updated, not superseded**: it now
drives through Confirm (where the write happens) before checking, instead
of checking right after Continue.

## F-4 (DR7-12, DR7-16) — a correction keeps what the person typed

`verdict_corrected` gains optional `submitter_note` /
`contradiction_resolutions` / `answer_contexts` (same shapes as
`graph_confirmed`); `RegisterDetail.tsx`'s `currentVerdictAttestationFields`
is the one helper that reads whichever event recorded the CURRENT verdict.

| ID | Asserts |
|---|---|
| TC-R16-F-26 | Reads the note, contradiction explanations and answer contexts from the CORRECTION, not the original confirmation — `RegisterDetail.test.tsx` |
| TC-R16-F-27 | A correction with none of its own shows none at all — supersedes, never merges with the original confirmation — `RegisterDetail.test.tsx` |
| TC-R16-F-28 | With no correction at all, still falls back to the case's `graph_confirmed` — unaffected by F-4 — `RegisterDetail.test.tsx` |

## F-5 (DR7-01) — a hand-off file is never wrongly called tampered

`.passthrough()` added to every hashed/sealed object schema in
`src/store/handoff.ts` (the event, every payload variant, the register
node schema, every metadata variant, the edge schema) — and, added while
verifying the build, to the nested ones inside a payload (graph
correction, verdict caveat, rule rationale, tripped invariant, verdict
conditions), which strip an unknown key the same way.

| ID | Asserts |
|---|---|
| TC-R16-F-29 | A bundle whose `graph_confirmed` event carries an unknown field imports successfully, and the field is still present on the imported event — `handoff.test.ts` |
| TC-R16-F-30 | A bundle whose `verdict_corrected` event carries an unknown field (and F-4's own new fields) imports successfully, verified — `handoff.test.ts` |
| TC-R16-F-31 | A bundle whose KNOWN field is malformed is still rejected — passthrough never loosens validation of a field the schema knows — `handoff.test.ts` |
| TC-R16-F-32 | A value tampered without recomputing the downstream chain is still reported as tampered — passthrough only protects an honestly-exported unknown field — `handoff.test.ts` |
| TC-R16-F-60 | A bundle whose NESTED record parts (a graph correction, a verdict caveat) carry an unknown field imports, verifies, and keeps the field — `handoff.test.ts` |

## F-6 (DR7-13) — one routing rule, one gate check

`nextReviewStep(questions, contradictions)` (pure, `intake-state.ts`) and
`checkPolicyGate()` (`IntakeFlow.tsx`) each replace a rule that was
written out twice.

| ID | Asserts |
|---|---|
| TC-R16-F-55 | `nextReviewStep`: questions present wins regardless of contradictions — `intake-state.test.ts` |
| TC-R16-F-56 | `nextReviewStep`: no questions, a contradiction present → `'contradiction_review'` — `intake-state.test.ts` |
| TC-R16-F-57 | `nextReviewStep`: neither present → `'confirmation'` — `intake-state.test.ts` |
| TC-R16-F-59 | A `covers_reviews` reference error on the FORM path's own Continue shows the message and never dispatches `FORM_SUBMITTED` (mirrors TC-R16-A1-63's `graph_review` coverage) — `IntakeFlow.r16f.test.tsx` |
| TC-R16-F-67 | A draft reopened at Confirm under a broken policy writes nothing and shows why, instead of hanging on "Evaluating…" — the confirm step checks the policy before any write (found by review pass 1; shown failing without the fix) — `IntakeFlow.r16f.test.tsx` |
| TC-R16-F-68 | The record check before Confirm failing (a browser-storage read error) writes nothing, says so in plain words, leaves Confirm usable, and a second press goes through — it used to leave Confirm dead with no message (found by review pass 2; shown failing without the fix) — `IntakeFlow.r16f.test.tsx` |
| TC-R16-F-69 | After a failed record check, "Change an answer" and back to Confirm shows no stale "couldn't check" message — the transient message is cleared when the confirm step is left; the two permanent refusals stay (review pass 3; shown failing without the fix) — `IntakeFlow.r16f.test.tsx` |
| TC-R16-F-70 | While the case lock and record check are pending, Confirm, "Change an answer" and "Start over instead" are disabled and "Confirming…" shows; then the result arrives with the answers that were confirmed — closes the window where a superseded attempt could record the old answers (review pass 4; shown failing without the fix) — `IntakeFlow.r16f.test.tsx` |
| TC-R16-F-71 | While the result is being worked out (after Confirm has been recorded), "Start over instead" stays disabled, and it re-enables once the result is shown — the pending state used to end the moment the step moved on, re-opening the window for a second attempt mid-evaluation (review pass 5; shown failing without the fix) — `IntakeFlow.r16f.test.tsx` |

## F-7 (DR7-07) — the "couldn't tell" list survives a refresh

`uncertainNodeIds?: string[]` now lives on `questionnaire`,
`contradiction_review` and `confirmation` (`intake-state.ts`), captured
once at `QUESTIONS_GENERATED` from `graph_review`'s own `guessedFields`
and threaded forward unchanged.

| ID | Asserts |
|---|---|
| TC-R16-F-58 | Survives `QUESTIONS_GENERATED` → `CONTRADICTIONS_DETECTED` → `CONTRADICTION_RESOLVED` → `PROCEED_TO_CONFIRMATION`, with real (non-empty) node ids — `intake-state.test.ts` |

The existing `QUESTIONS_GENERATED` reducer test and the `EVALUATION_FAILED`
reducer test (`intake-state.test.ts`) are **updated, not superseded**:
both now expect the new fields (`uncertainNodeIds: []`,
`afterFailedEvaluation: true`) in their result objects — the transitions
under test are otherwise unchanged.

## F-8 (DR7-08) — the form's agent-access answer goes through the single checker

`plain-intake.ts`'s `resolveAccessScopeAnswer()` is the one place Q13's
ticks become engine values AND are validated, through
`normaliseAccessScope`; `StructuredForm.tsx`'s own required check calls
the same function.

| ID | Asserts |
|---|---|
| TC-R16-F-39 | A mismatched saved Q13 answer (`"none"` + another kind) is refused with a plain-words validation message (never the engine's reason, which names the internal field), never silently read as answered — `StructuredForm.test.tsx` |
| TC-R16-F-62 | Unticking every Q13 box shows no alert — nothing ticked is simply "not answered yet", which the required marker already says — `StructuredForm.test.tsx` |

`plain-intake.test.ts`'s Q13 exclusivity test is **updated, not
superseded**: "none" ticked alone is unchanged (`["none"]`); "none" ticked
together with another kind is now a documented REFUSAL
(`systemAccessScope` stays unstated) rather than a silent resolution to
`["none"]` — the real form's own exclusivity never lets this combination
arise, so the behaviour change only affects a hand-built/stale answer.

## F-9 (DR7-09) — the zone answer is cross-checked and attributed

Every message in `src/engine/plausibility.ts` is rewritten in plain
words — no zone letters, field names or "graph" — each naming the guided
form's own question. `UnderstoodSummary.tsx` renders them under "Please
double-check", computed purely at render, for both paths; an explicit
`3platformZone` answer attributes the destination line.

| ID | Asserts |
|---|---|
| TC-R16-F-08 | `summaryDestinationLine` with no `plainAnswers` renders the base destination sentence unchanged — `plain-copy.test.ts` |
| TC-R16-F-09 | An explicit `3platformZone` `"firm-systems"` answer attributes the Zone C line — `plain-copy.test.ts` |
| TC-R16-F-10 | An explicit `3platformZone` `"outside-supplier"` answer attributes the Zone B line — `plain-copy.test.ts` |
| TC-R16-F-11 | An explicit `3platformZone` `"outside-service"` answer attributes the Zone A line — `plain-copy.test.ts` |
| TC-R16-F-48 | A description that contradicts the graph renders "Please double-check" with the plain-worded message — `UnderstoodSummary.test.tsx` |
| TC-R16-F-49 | A description with no plausibility signal renders no "Please double-check" section — `UnderstoodSummary.test.tsx` |
| TC-R16-F-65 | A warning that applies to several parts of the case is shown once, not once per part (found in the walkthrough) — `UnderstoodSummary.test.tsx` |
| TC-R16-F-50 | An explicit `3platformZone` answer attributes the destination line to what the submitter told it — `UnderstoodSummary.test.tsx` |
| TC-R16-F-51 | No `plainAnswers` (the description path) never attributes the destination line — `UnderstoodSummary.test.tsx` |

`plausibility.test.ts`'s existing TC-R5-GR-4-01a/02a/03a/04a tests are
**updated, not superseded**: the formal criterion ("fires when description
X but graph says Y") is unchanged; only the expected MESSAGE TEXT changed
(plain words instead of zone letters/field names), with new assertions
added that the rewritten text contains none of those.

## §3 — Accessibility (DR7-10, owner decision: WCAG 2.1 AA for new and changed screens)

`App.tsx`'s five sidebar items are now `<button type="button">` with
`aria-current="page"` on the active one; `IntakeFlow.tsx` has one
focus/announce mechanism for every step change; `VerdictDisplay.tsx`'s
"Go to this safeguard" moves focus to the target after scrolling.

| ID | Asserts |
|---|---|
| TC-R16-F-42 | Every sidebar item has an accessible button role, reachable by name — `App.r16f.test.tsx` |
| TC-R16-F-43 | The active item carries `aria-current="page"`; the others do not — `App.r16f.test.tsx` |
| TC-R16-F-44 | Pressing Enter on a focused sidebar button activates it — real keyboard activation, not a mouse-only `onClick` — `App.r16f.test.tsx` |
| TC-R16-F-45 | Pressing Space on a focused sidebar button activates it — `App.r16f.test.tsx` |
| TC-R16-F-46 | A step change (not the first load) moves focus to the step container and announces the new step via `StepTracker`'s own `describeStep()` — `IntakeFlow.r16f.test.tsx` |
| TC-R16-F-47 | Clicking "Go to this safeguard" moves focus to the safeguard's own container, not only scrolling to it — `VerdictDisplay.r16d1.test.tsx` |

`App.r15c1.test.tsx`'s `TC-R15-C1-10` is **updated, not superseded**: it
located the sidebar item via `.closest('div')`, which no longer finds the
clickable element now that it is a `<button>`; the formal criterion (the
1LoD register-scope note's wording) is unchanged, only the element lookup
was fixed to use its accessible role.

## §4 — The correction screen's agent-access editor (DR7-11)

`GraphView.tsx` gains a tick-all checkbox editor for `system_access_scope`
only, with the form's own Q13 exclusivity and option wording, validated
through `normaliseAccessScope` before every write.

| ID | Asserts |
|---|---|
| TC-R16-F-33 | Renders a checkbox per kind, using the form's own Q13 option text, each initially unticked when no value is set — `GraphView.r16f.test.tsx` |
| TC-R16-F-34 | Ticking one kind calls `onCorrect` with a canonically-ordered array through `normaliseAccessScope` — `GraphView.r16f.test.tsx` |
| TC-R16-F-35 | A second kind ticked alongside the first calls `onCorrect` with both, in canonical order — `GraphView.r16f.test.tsx` |
| TC-R16-F-36 | Ticking "Nothing beyond…" clears every other tick (same exclusivity as the form's Q13) — `GraphView.r16f.test.tsx` |
| TC-R16-F-37 | Ticking another kind while "Nothing beyond…" is set clears it (vice versa) — `GraphView.r16f.test.tsx` |
| TC-R16-F-38 | Unticking the only remaining kind is refused — a plain-words reason shows (never the internal field name), and `onCorrect` is not called — `GraphView.r16f.test.tsx` |
| TC-R16-F-61 | Clicking an option's words ticks THAT option, not the first one (each option is its own label inside a named group) — `GraphView.r16f.test.tsx` |
| TC-R16-F-63 | The correction handler's same-set check (`sameAccessScopeSet`, `src/engine/access-scope.ts`) treats order and a bare stored value as the same set, and different kinds as different — `access-scope.test.ts` |
| TC-R16-F-64 | On the review screen, through App and the REAL correction handler, ticking a second kind applies both kinds to the case — `IntakeFlow.r16f.test.tsx` |

`handleCorrectNode` (`IntakeFlow.tsx`) is driven for real by TC-R16-F-64.
Its same-set comparison is unit-tested through `sameAccessScopeSet`
(TC-R16-F-63); the editor itself can never re-save an identical set (every
click changes it), so that check is defence in depth for other callers of
`onCorrect`. An earlier draft of this note said `GraphView.r16f.test.tsx`
exercised the handler "indirectly" — it does not: those tests pass a
stand-in `onCorrect`. Corrected while verifying the build.

## §6 — Minors (DR7-14)

`OutputReversibility`/`MultiInstanceCoordination` named types
(`src/engine/types.ts`); `checkPolicyReferences`'s best-effort clause-name
warning (`src/store/policy-references.ts`).

| ID | Asserts |
|---|---|
| TC-R16-F-40 | A downstream review `plain_name` that reads as a clause ("the X is/are/was/were/has/have…") warns — `policy-references.test.ts` |
| TC-R16-F-41 | A downstream review `plain_name` that is a genuine noun phrase does not warn — `policy-references.test.ts` |

A pack `required_review` effect's `plain_name` is checked for the same
mistake (own test, un-ided, `policy-references.test.ts`), and a regression
guard confirms the shipped policy's own review `plain_name` values never
trigger the new warning (un-ided, `policy-references.test.ts`) — both
exercise the same `clauseLikePlainNameWarning` code path as TC-R16-F-40/41
without needing their own traced ids.

The named-type export
(`OutputReversibility`/`MultiInstanceCoordination`) and the
`build/prompts/R16-W.md` "backtest case UC-6b" wording fix, the
`plain-copy.ts` header vocabulary-rule comment, and the
`grounding/PACK-AUTHORING.md` `applies_to` checklist line are documentation/
type-only changes with no behaviour of their own to test; they are
verified by `npx tsc --noEmit` (the type re-export compiles and is used
correctly by `plain-copy.ts`) and by reading the amended files.

## §7 — Requirement change (NF-12 persona coverage; WCAG 2.1 AA)

Both are requirements-document amendments
(`requirements/requirements.md` + `.html`, mirrored in
`build/prompts/R16.md` §6) describing a HUMAN release-gate process (the
newcomer test's own persona mix) and a standard (WCAG 2.1 AA) that this
round's §3 items implement. Neither has automated test coverage of its
own — §3's items above are exactly what demonstrates WCAG 2.1 AA
compliance for this round's changed screens; the NF-12 persona-mix
requirement is verified when the newcomer test itself is next run, not by
this codebase's automated suite.

## Untested behaviours

None by omission. Two items are documentation/type-only (see §6 above) and
are recorded as such rather than silently skipped.

## Verification

`npm test` ×3 (never bare `vitest`), `npx tsc --noEmit`, `npm run build`,
`python3 scripts/spec-parity-check.py`, `python3 scripts/trace-check.py`,
and a live browser walkthrough of the guided form's Q13 question, the
correction screen's agent-access editor, the confirmation summary's
"Please double-check" section, the sidebar's keyboard navigation, and a
forced evaluation failure on the form path.

| Date | Change |
|---|---|
| 2026-10-03 | Written for R16-F (design review 007, Group 1: DR7-01 to DR7-14). |
| 2026-10-03 | Verification pass: TC-R16-F-60 to -65 added (nested hand-off passthrough, plain refusal wording, tick-all editor labels, the real correction handler, one double-check sentence per message); the "exercised indirectly" note corrected. |
| 2026-10-03 | Review pass 1 (GVM build convergence loop): TC-R16-F-66 added — the boundary guard missed multi-line imports; TC-R16-F-67 added — the confirm step checked the policy only after writing. |
| 2026-10-03 | Review pass 2: both pass-1 fixes verified; TC-R16-F-68 added — a failed record check before Confirm left the button dead with no message. |
| 2026-10-03 | Review pass 3: the pass-2 fix verified; TC-R16-F-69 added — the failed-check message outlived the attempt it described; the failure is now also logged. |
| 2026-10-03 | Review pass 4: the pass-3 fix verified; TC-R16-F-70 added — nothing can change the answers while a confirm is under way. |
| 2026-10-03 | Review pass 5: the pass-4 fix verified; TC-R16-F-71 added — the pending state now lasts until the result is shown, not just until Confirm is recorded. Loop closed by owner decision at pass 5 (counts 1,1,1,1,1 — each pass a new, smaller window, every one fixed). |

---

*Developed using the Grounded Vibe Methodology*

## Superseded

| ID | Reason |
|---|---|
| TC-R16-F-64 | Superseded by R18-GI-10 (R18-A): the review screen's editor that applied a second kind of access is unreachable. The form's own two-kind tick reaching the evaluated graph is TC-R16-E-72 in IntakeFlow.r16e.test.tsx. |
