# Counterpoise — Test Cases, Round 21

*Written 2026-10-02. R16-W (`build/prompts/R16-W.md`) — walkthrough fixes
found on a live, owner-side run of the committed B+C + D1 build (commit
`059d89a`): the form path still routed through the retired field-card
review screen (W-3), reopened blank after "Change an answer" or Back
(W-4), duplicated the plain-language intro (W-2) and never pre-filled
question 2 (W-1); the UC-6b worked case failed parity because a multi-zone
platform always resolved to its earliest letter (W-9); the "Here's what we
understood" summary still read the reviewer cards' own vocabulary instead
of the newcomer-tested question wording (§2); the opening screens, the
confirmation step, and the knowledge-lens panel's position on the intake
verdict screen (W-5), a grammatically-broken "also completes" note (W-6),
an over-claimed "already in place" line (W-7) and an owner-wording/
rendering bug (W-8) were all found the same way. Every item below was
observed on the running app, not inferred.*

Test files: `src/engine/plain-intake.test.ts`, `src/engine/backtest-parity.test.ts`,
`src/components/__tests__/StructuredForm.test.tsx`,
`src/components/intake-state.test.ts`,
`src/components/__tests__/UnderstoodSummary.test.tsx`,
`src/components/verdict-view-model.test.ts`,
`src/components/__tests__/VerdictDisplay.r16d1.test.tsx`,
`src/components/__tests__/VerdictDisplay.test.tsx`,
`src/store/policy.test.ts`, `src/store/policy-references.test.ts`,
`src/components/__tests__/IntakeFlow.back.test.tsx`,
`src/components/__tests__/IntakeFlow.r16w.test.tsx`.

## §1 — W-9: the platform-zone follow-up (the UC-6b parity fix, D-79)

| ID | Asserts |
|---|---|
| TC-R16-W-01 | "Yes — the platform runs the AI on the firm's own systems" resolves the destination zone to Zone C — `plain-intake.test.ts` |
| TC-R16-W-02 | "No — the platform passes it to an outside supplier's AI" resolves to Zone B — `plain-intake.test.ts` |
| TC-R16-W-03 | "No — it goes out to a public website or service" resolves to Zone A, for a platform that allows it — `plain-intake.test.ts` |
| TC-R16-W-04 | "Not sure" on a platform whose earliest allowed zone is B resolves to Zone B, with the "may pass your information to an outside supplier" assumption text — `plain-intake.test.ts` |
| TC-R16-W-05 | Leaving the follow-up unanswered behaves exactly like "Not sure" (the mapping's default branch) — `plain-intake.test.ts` |
| TC-R16-W-06 | "Not sure" when the earliest allowed zone is A uses the "an outside website or service — the strictest case" wording instead — `plain-intake.test.ts` |
| TC-R16-W-07 | A platform allowed in only one zone keeps the pre-W-9 mapping, with no follow-up consulted even if a stray answer is present — `plain-intake.test.ts` |
| TC-R16-W-08 | `platformZoneOptionKeys` orders Zone C, Zone B, Zone A (filtered to what the platform allows), "Not sure" always last — `plain-intake.test.ts` |

`TC-R16-B-22` (`backtest-parity.test.ts`) is **updated, not superseded**: UC-6b's zone-driven difference (the rejected-vs-approved flip R16.md §2.3 documented) is asserted gone; a separate, pre-existing decision_type-driven tier difference (shared with UC-3/UC-5/UC-7/UC-8's own documented "the new answers capture more than the old fixture did" class) is asserted explicitly instead of silently matched away, per the contract's "report why rather than adjusting expectations" instruction.

## §2 — W-1/W-2/W-4: the form's own draft behaviour

| ID | Asserts |
|---|---|
| TC-R16-W-09 | `initialDescription` pre-fills question 2 when it has no draft/`initialAnswers` value yet — `StructuredForm.test.tsx` |
| TC-R16-W-10 | Editing question 2 is what is carried forward — a later edit is not overwritten by `initialDescription` on re-render — `StructuredForm.test.tsx` |
| TC-R16-W-11 | `initialAnswers` already holding a question-2 value takes precedence over `initialDescription` — `StructuredForm.test.tsx` |
| TC-R16-W-12 | The retired "Guided intake — answer the fields below…" paragraph is gone; the approved intro is followed by the new sentence — `StructuredForm.test.tsx` |
| TC-R16-W-13 | `initialAnswers` pre-fills the form when there is no in-progress draft — `StructuredForm.test.tsx` |
| TC-R16-W-14 | An in-progress draft wins over `initialAnswers` (strictly newer information) — `StructuredForm.test.tsx` |

## §3 — W-9 (UI): the platform-zone follow-up's rendering

| ID | Asserts |
|---|---|
| TC-R16-W-15 | Shown only for a platform allowed in more than one zone, with the required marker; a single-zone platform shows no follow-up — `StructuredForm.test.tsx` |
| TC-R16-W-16 | Only the zones the platform allows are offered, plus "Not sure" — `StructuredForm.test.tsx` |
| TC-R16-W-17 | Switching Q3 away clears the follow-up answer and removes it from the DOM — `StructuredForm.test.tsx` |

## §4 — W-3/W-4: the reducer (`FORM_SUBMITTED`, carry-forward)

| ID | Asserts |
|---|---|
| TC-R16-W-18 | `FORM_SUBMITTED` is refused from any step other than `graph_extraction` with `method: 'form'` — `intake-state.test.ts` |
| TC-R16-W-19 | With questions present, goes to `questionnaire` — never `graph_review` — `intake-state.test.ts` |
| TC-R16-W-20 | With no questions but a contradiction, goes straight to `contradiction_review` (never through `questionnaire`) — `intake-state.test.ts` |
| TC-R16-W-21 | With neither questions nor contradictions, goes straight to `confirmation` — `intake-state.test.ts` |
| TC-R16-W-22 | `STEP_BACK` from `questionnaire` on a form-path graph returns to the form, filled in — not `graph_review` — `intake-state.test.ts` |
| TC-R16-W-23 | `STEP_BACK` from `questionnaire` on a description-path graph still returns to `graph_review` (unaffected) — `intake-state.test.ts` |
| TC-R16-W-24 | `CONTRADICTIONS_DETECTED` carries `plainAnswers`/`assumptions` into `contradiction_review` — `intake-state.test.ts` |
| TC-R16-W-25 | `CONTRADICTION_RESOLVED` carries `plainAnswers`/`assumptions` back into `questionnaire` — `intake-state.test.ts` |
| TC-R16-W-26 | `PROCEED_TO_CONFIRMATION` carries `plainAnswers`/`assumptions` into `confirmation` — `intake-state.test.ts` |
| TC-R16-W-27 | `CHANGE_ANSWER` from `confirmation` on a form-path graph carries `plainAnswers`/`assumptions`/`useCaseId` back to the form — `intake-state.test.ts` |

## §5 — §2 ("Here's what we understood"): the summary's own words (D-71)

| ID | Asserts |
|---|---|
| TC-R16-W-28 | "Through: {name}." renders the registry `plain_name` for a registered, non-internal vendor — `UnderstoodSummary.test.tsx` |
| TC-R16-W-29 | An unregistered vendor renders the recorded string plus the "hasn't assessed" second line — `UnderstoodSummary.test.tsx` |
| TC-R16-W-30 | "Runs on: {platform plain_name}." renders when the processing node names a policy platform — `UnderstoodSummary.test.tsx` |
| TC-R16-W-31 | The kind of AI (`model_type`) now renders, in plain words — `UnderstoodSummary.test.tsx` |
| TC-R16-W-32 | `autonomy_level >= 2` renders the acting-alone line plus its action-type clause — `UnderstoodSummary.test.tsx` |
| TC-R16-W-33 | A supervised, `hitl` action appends the person-checks clause — `UnderstoodSummary.test.tsx` |
| TC-R16-W-34 | The weight line shows only for inform/draft/recommend at `autonomy_level <= 1` — `UnderstoodSummary.test.tsx` |
| TC-R16-W-35 | "If it gets something wrong" (new section) renders the reversibility line — `UnderstoodSummary.test.tsx` |
| TC-R16-W-36 | An unclassified `decision_type_other` adds the "ask your AI risk team" clause — `UnderstoodSummary.test.tsx` |
| TC-R16-W-37 | No jurisdictions renders the plain "None of the listed countries…" fallback, not "No countries specified" — `UnderstoodSummary.test.tsx` |
| TC-R16-W-38 | No rendered summary text contains "unregistered", a zone letter, "(draft)" or a bare field code, across every plain section at once — `UnderstoodSummary.test.tsx` |

`TC-R16-C-06` (`UnderstoodSummary.test.tsx`) is **updated, not superseded**: its formal criterion (test-cases-019.md, "every distinct data class is listed, most sensitive first, with no bare code") is unchanged and still holds; only the wording the test matches against changed ("everyday business information" → "everyday work information").

## §6 — W-6: one "also completes" note per safeguard, in grammatical English (D-76)

| ID | Asserts |
|---|---|
| TC-R16-W-39 | A safeguard covering one review joins with no "and" — `verdict-view-model.test.ts` |
| TC-R16-W-40 | A safeguard covering two reviews prints ONE note with "a and b" — never two notes — `verdict-view-model.test.ts` |
| TC-R16-W-41 | Three covered reviews join "a, b and c" — `verdict-view-model.test.ts` |
| TC-R16-W-42 | A safeguard covering nothing has no `alsoCompletesNote` — `verdict-view-model.test.ts` |
| TC-R16-W-49 | The first screen renders ONE "(Doing this also completes …)" note per safeguard, not one per covered review, and never the old grammatically-broken per-review template — `VerdictDisplay.r16d1.test.tsx` |

`TC-R16-D1-07d`/`TC-R16-D1-07e` (`verdict-view-model.test.ts`) are **updated, not superseded**: the sentinel review names they assert are reworded to noun phrases (D-76); the behaviour under test (sentinel resolution) is unchanged.

## §7 — W-7: "already in place" only where the evidence covers this tool (D-77)

| ID | Asserts |
|---|---|
| TC-R16-W-43 | `applies_to` absent (unscoped) — verified everywhere, exactly the pre-W-7 behaviour — `verdict-view-model.test.ts` |
| TC-R16-W-44 | `applies_to` present, graph's platform is in scope — still verified — `verdict-view-model.test.ts` |
| TC-R16-W-45 | `applies_to` present, graph's vendor is in scope — still verified — `verdict-view-model.test.ts` |
| TC-R16-W-46 | `applies_to` present, graph is outside scope — outstanding (counted in the headline's N), with a "not for this tool" note naming the scoped platforms/vendors by plain name — `verdict-view-model.test.ts` |
| TC-R16-W-47 | `applies_to` present, no graph available (reopened from the register) — outstanding, with a "couldn't check" note — `verdict-view-model.test.ts` |
| TC-R16-W-48 | Out-of-scope evidence with an attestation on file still reads attested, not outstanding (attested beats outstanding) — `verdict-view-model.test.ts` |
| TC-R16-W-51 | Evidence scoped by `applies_to`, with the graph outside that scope, reads UNVERIFIED in the control-evidence panel and shows the "not for this tool" note instead of the detail line — `VerdictDisplay.test.tsx` |
| TC-R16-W-52 | The policy schema accepts `verification_evidence.applies_to` with only platforms, only vendors, or both — `policy.test.ts` |
| TC-R16-W-53 | The policy schema rejects `applies_to` with both lists empty or absent — at least one must be named — `policy.test.ts` |
| TC-R16-W-54 | `checkPolicyReferences` accepts a registered platform or vendor id in `applies_to`, with no packs loaded — `policy-references.test.ts` |
| TC-R16-W-55 | `checkPolicyReferences` reports an unregistered platform id in `applies_to` as an error, always (never gated on packs) — `policy-references.test.ts` |
| TC-R16-W-56 | `checkPolicyReferences` reports an unregistered vendor id in `applies_to` as an error, always — `policy-references.test.ts` |

## §8 — W-8: owner wording and a rendering bug (D-78)

| ID | Asserts |
|---|---|
| TC-R16-W-50 | The owner text and the "yours" chip never concatenate into one run-together word (a real space text node separates them) — `VerdictDisplay.r16d1.test.tsx` |

(`CTRL-CONDUCT-01`'s `plain_owner_with` wording change — "compliance" → "your compliance team" — is a policy-text change with no new engine behaviour to assert beyond what TC-R16-D1-05f/05g already cover generically; verified live in the browser walkthrough, §Verification below.)

## §9 — Full-flow integration (App + IntakeFlow)

| ID | Asserts |
|---|---|
| TC-R16-W-57 | A contradiction on the form path stops at `contradiction_review`, never passing through `graph_review` — `IntakeFlow.back.test.tsx` (tagged onto the existing test that already drove this scenario) |
| TC-R16-W-58 | The form path reaches "Here's what we understood" directly — no "Confirm what we understood", no "worth a second look", no graph-review node cards, no bare field code — `IntakeFlow.r16w.test.tsx` |
| TC-R16-W-59 | Back from the questionnaire returns to the form with its answers intact — `IntakeFlow.r16w.test.tsx` |
| TC-R16-W-60 | "Change an answer" from confirmation reopens the form with its answers intact — `IntakeFlow.r16w.test.tsx` |
| TC-R16-W-61 | A refresh on confirmation keeps the "Not sure" assumptions list (restored from the draft, not a component `useState`) — `IntakeFlow.r16w.test.tsx` |
| TC-R16-W-62 | Submit, Change an answer, submit again — exactly one `use_case_created` for the intake, and the confirmed use case has that id — `IntakeFlow.r16w.test.tsx` |
| TC-R16-W-63 | A similarly-described, already-decided use case shows as a collapsed "similar decided case" panel on the form-path summary, with the same posture line — `IntakeFlow.r16w.test.tsx` |
| TC-R16-W-64 | The subtitle, welcome note, and describe step all read the new plain-language text (§4) — `IntakeFlow.r16w.test.tsx` |
| TC-R16-W-65 | A real verdict with a knowledge-lens match renders the panel inside a collapsed-by-default `<details>`, after the reviewer section — `IntakeFlow.r16w.test.tsx` |
| TC-R16-W-66 | W-1's second half: the text left in question 2 is the description recorded on `use_case_created` and on the register node — not the first screen's words (added at owner-side review: the first build pre-filled question 2 but still recorded the first screen's text) — `IntakeFlow.r16w.test.tsx` |
| TC-R16-W-67 | After one successful confirmation in a tab, "+ New pre-check" starts a case whose "Confirm and evaluate" still works without a reload — the confirm guard, deliberately left set after a successful confirm, is released by starting over (pre-existing bug found by the R16-W walkthrough's second submission; the test fails with the release removed) — `IntakeFlow.r16w.test.tsx` |

## Untested behaviours

None by omission. Two items are verified live rather than by a unit/integration
test, and are recorded as such rather than silently skipped:

- The duplicate-check and adopted-screen copy rewrites (§4 of the contract:
  "HAS THIS BEEN CHECKED BEFORE?", "Something similar has been checked
  before", "EARLIER RESULT USED", the 1LoD tier-free line, both renamed
  buttons) are exercised structurally by `WalkingSkeleton.test.tsx`'s
  existing suite (updated in place to the new copy — see the handover) and
  by `IntakeFlow.r16w.test.tsx`'s own flow; there is no NEW dedicated TC id
  for the copy strings themselves, consistent with how the pre-existing
  duplicate-gate tests were never pinned to the old copy by a dedicated id
  either.
- `StepTracker`'s three relabelled steps ("Similar checks", "Your answers",
  "Result") have no dedicated test file (none existed before this round);
  confirmed by the live browser walkthrough, §Verification below.

## Verification

`npm test` ×3 (never bare `vitest`), `npx tsc --noEmit`, `npm run build`,
`python3 scripts/spec-parity-check.py`, `python3 scripts/trace-check.py`,
and a live browser walkthrough of the guided form, the confirmation
summary, the duplicate-check screens, and the verdict first screen.

| Date | Change |
|---|---|
| 2026-10-02 | Written for R16-W (walkthrough fixes before chunk D2). |
| 2026-10-02 | Owner-side review: TC-R16-W-66 (question 2's text is the recorded description; checks now run before the creation write) and TC-R16-W-67 (confirm guard released on starting over). |

---

*Developed using the Grounded Vibe Methodology*


| TC-R16-W-11 | Superseded by R18-A (specs/intake-flow.md 27.6): question 2 is no longer a stored answer but the editor of the one description, so a stored question-2 value has no precedence to hold; replaced by the description-prop tests in StructuredForm.test.tsx and TC-R18-GI-8-09. |