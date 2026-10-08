# Counterpoise — Test Cases, Round CR6 (code review 006 fixes)

*Written 2026-10-03. `build/prompts/CR6-fixes.md` v2 — the fixes for code review 006
(`code-review/code-review-006.html`): a hand-off bundle written by the app's own
export now imports; "Start over" and "Back" no longer leave earlier work running
or switch off the guessed-value check; a draft saved by an older build cannot
crash the page; stored answers that are no longer on offer take the stricter
"Not sure" reading; the description path asks "replaces something you already
use?"; required questions are announced to screen readers; results and
in-progress lines are announced; several wording, contrast and display fallbacks
are corrected. Built on top of R16-E (commit `9348882`). Specs are not edited by
builders; the amended spec sections are marked "(CR6, 2026-10-03)" in
`specs/intake-flow`, `specs/verdict-audit`, `specs/evaluation-engine`,
`specs/policy-schema` and `specs/cross-cutting`.*

Test files: `src/store/handoff.test.ts`,
`src/store/assumption-fields.test.ts`, `src/store/policy-references.test.ts`,
`src/llm/graph-extractor.test.ts`, `src/engine/plain-intake.test.ts`,
`src/engine/build-graph-from-form.test.ts`, `src/engine/evaluate.test.ts`,
`src/components/intake-state.test.ts`, `src/components/intake-draft.test.ts`,
`src/components/plain-copy.test.ts`,
`src/components/plain-copy.cr6-fx4.test.ts`,
`src/components/verdict-view-model.test.ts`,
`src/components/__tests__/RegisterView.handoff.test.tsx`,
`src/components/__tests__/ErrorBoundary.test.tsx`,
`src/components/__tests__/IntakeFlow.cr6-fx2.test.tsx`,
`src/components/__tests__/IntakeFlow.cr6-fx3.test.tsx`,
`src/components/__tests__/IntakeFlow.back.test.tsx`,
`src/components/__tests__/StructuredForm.test.tsx`,
`src/components/__tests__/StructuredForm.cr6-fx4.test.tsx`,
`src/components/__tests__/QuestionnaireStep.cr6-fx4.test.tsx`,
`src/components/__tests__/VerdictDisplay.cr6-fx4.test.tsx`,
`src/components/__tests__/RegisterDetail.cr6-fx4.test.tsx`,
`src/components/__tests__/UnderstoodSummary.test.tsx`,
`src/components/__tests__/PolicyEditor.test.tsx`,
`src/components/__tests__/RegisterView.test.tsx`,
`src/components/__tests__/app-css.cr6-fx4.test.ts`.

## §1 — Hand-off import keeps the events exactly as written (CR6-01, CR6-30)

| ID | Asserts |
|---|---|
| TC-CR6-01a | The app's own self-assessment case, exported and round-tripped through JSON, imports into an empty machine (it was refused as tampered before) — `handoff.test.ts` |
| TC-CR6-01b | A `verdict_corrected` payload in the real writer's own key order (`corrections_count` right after `knowledge_lens_matched_entry_ids`, then `submitter_note`, `assumptions`, `evidence_scope`) imports — `handoff.test.ts` |
| TC-CR6-01c | After that import, `verifyChain()` on the receiving machine reports the chain intact — the stored events keep their original bytes — `handoff.test.ts` |
| TC-CR6-01d | `replaceWithBundle` accepts the same real case and the local chain verifies afterwards — `handoff.test.ts` |
| TC-CR6-30 | The generic invalid-format message reads "a Counterpoise", not "an Counterpoise" — `handoff.test.ts` |
| TC-CR6-30b | A file that is not JSON at all gets the same corrected grammar on the register screen — `RegisterView.handoff.test.tsx` |

## §2 — "Start over" and "Back" leave no earlier work running (CR6-02, CR6-14)

| ID | Asserts |
|---|---|
| TC-CR6-02a | Continue on the new case works while the abandoned case's extraction is still pending, and the late result never lands on the new case — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-02b | An abandoned duplicate check's match never appears on the new case — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-02c | "Try again" works on the new case after Start over, even though the abandoned case's own retry was still pending; after an adoption has finished, "+ New pre-check" (not Start over) and a new case's "Use the earlier result" works (the guard was released) — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-02d | Rendered inside StrictMode, the duplicate check still completes and shows its result exactly once (regression guard — no cleanup flag was added) — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-02e | After an earlier result was used, a fresh case (reached through "+ New pre-check", not Start over) and a new description show neither wording of the adopted screen ("Earlier result used from…" or "An earlier result on your firm's register was used.") — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-02f | A held duplicate check resolving after Back and a changed description never shows its stale match card and writes no audit event — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-02g | While "Use the earlier result" is held, Back, the step-tracker back, Start over and both gate buttons are disabled, and exactly one `addNode` happens — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-02h | Back is unusable during a held adoption, so no second adoption can follow; exactly one `classification_adopted` event. The same lock holds while "Mine is different" is writing its dismissal — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-02i | Adoption is final. (A) After adopting, leaving and coming back (a remount) starts a fresh intake: no adopt offer, and the saved draft is gone. (B) The adopted screen has no Back button, and "+ New pre-check" (not Start over, which that screen does not offer) starts a fresh intake — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-02j | An abandoned "Mine is different" finishing late does not unlock the new case's decision that is still writing — the lock is released only by its own attempt — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-02k | Once an earlier result has been used, the "Picked up where you left off" banner is gone — the case is finished, not unfinished — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-02l | A failed "Use the earlier result" save shows a plain message that sends the person to the register first (part of it may already be there); a failed "Mine is different" save says so plainly and the choice can be made again — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-02m | After a failed "Mine is different" save, Start over and a new description show no leftover "could not be saved" — the message belongs to its own case — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-14 | After Start over, a new case's pending extraction shows "Reading your description…", never the abandoned case's old error — `IntakeFlow.cr6-fx2.test.tsx` |

## §3 — Back from the questions keeps the guessed-value check (CR6-03)

| ID | Asserts |
|---|---|
| TC-CR6-03a | `QUESTIONS_GENERATED` carries `guessedFields`, `provenance` and the gate values onto the questionnaire, and `STEP_BACK` restores them on the review screen — `intake-state.test.ts` |
| TC-CR6-03b | The review screen after Back still shows its quotes and its checked state (provenance and `unconfirmedNodeIds` both survive the round trip) — `intake-state.test.ts` |
| TC-CR6-03c | A guessed field that has been answered drops out of the carried `guessedFields`, so Back and Continue will not ask it again — `intake-state.test.ts` |
| TC-CR6-03d | A form-path (or gate-free correction) review has no `unconfirmedNodeIds` / `jurisdictionsConfirmed`, and Back from its questionnaire keeps both undefined — "no gate" is unaffected (TC-R5-GR-2-03 stays green) — `intake-state.test.ts` |
| TC-CR6-03e | Back carries `ignoredJurisdictions`, and a Back and Continue round trip keeps the first `uncertainNodeIds` even though `guessedFields` has since been trimmed — `intake-state.test.ts` |
| TC-CR6-D1 | "Change an answer" on a `structured_form` case returns to the guided form, not the review screen (the fixture's invalid `intake_method: 'form'` was corrected) — `IntakeFlow.back.test.tsx` |

## §4 — A saved draft from an older build cannot crash the page (CR6-04, C-3)

| ID | Asserts |
|---|---|
| TC-CR6-04a | A pre-`9348882` undo snapshot (`{ graph, correctionsLen }` only) does not crash `ANSWER_UNDONE` — it falls back to the current questions/assumptions (`intake-state.test.ts`); through the page, a draft saved with the old undo shape restores without a crash, offers no Undo for that answer, and Undo works for the next one (`IntakeFlow.cr6-fx2.test.tsx`) |
| TC-CR6-04b | A draft with no version envelope (what every earlier build wrote) restores, but drops the questionnaire step's undo snapshot — never the whole draft — `intake-draft.test.ts` |
| TC-CR6-04c | A render error below the boundary shows a plain message and a "Start a fresh check" button that clears the saved draft — both the intake draft and the guided-form draft — `ErrorBoundary.test.tsx` |
| TC-CR6-04d | The crash message makes no claim about the firm record being untouched; it says only that anything already saved is on the register, and says "Something went wrong" once — `ErrorBoundary.test.tsx` |
| TC-CR6-04e | A draft that crashes the intake render shows the boundary from inside the app, and its button gets a working intake back (the app wraps the intake flow in the boundary) — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-C3 | Undo is offered after an answer and gone after it is pressed, even though the previous answer is still shown as "Recorded" — `IntakeFlow.cr6-fx2.test.tsx` |

## §5 — Announcements, the saved result, and a policy that cannot run (CR6-08, 12, 15, 17, B-10)

| ID | Asserts |
|---|---|
| TC-CR6-08a | The announcement while the result is being worked out differs from the announcement once it is ready — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-08b | The in-progress lines ("Evaluating…", "Looking through earlier checks…") are status regions — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-08c | The "nothing similar found" text sits inside an element with `role="status"`. It does not check that this is the same region as the line before it, or that the region is persistent — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-12 | Every engine error kind reads as the firm's rules, never the person's answers, and never leaks the raw kind string — `plain-copy.test.ts` |
| TC-CR6-15a | After navigating away mid-confirm and back, the saved draft is gone — no stale confirmation screen — and the result is really on the trail — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-15b | The "already has a result" message claims no cause it cannot know — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-15c | Restoring an `evaluation_pending` draft shows a plain pointer to the register, no endless "Evaluating…", and clears the draft — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-17a | On the guided form's own Continue, an invalid policy shows a message at the button and never silently does nothing — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-17b | On the review screen's own Continue, an invalid policy shows a message at the button and never silently does nothing — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-B10 | Nothing is carried from submission: the form-submitted reducer routes to the questionnaire and carries no stale contradiction (`intake-state.test.ts`); a contradiction that still holds on the current graph is shown, and one an answer resolved does not come back even if a stale copy was saved (`IntakeFlow.cr6-fx2.test.tsx`) |
| TC-CR6-B10c | Explain one contradiction, answer the next question: it is not raised again, and the explanation is saved with the draft; an explained entry for a different contradiction does not hide the live one — `IntakeFlow.cr6-fx2.test.tsx` |

## §6 — The description path asks everything it should (CR6-05, B-8, B-9)

| ID | Asserts |
|---|---|
| TC-CR6-05a | A realistic model reply with no quote for `replaces_prior_model` is guessed, and the real question generator turns it into a question — `graph-extractor.test.ts` |
| TC-CR6-05b | On the description path a guessed `replaces_prior_model`, answered "Not sure", becomes true, is recorded as an assumption and listed back, and the case takes Track II (the test selects its own case, never the first one in the register) — `IntakeFlow.cr6-fx3.test.tsx` |
| TC-CR6-05c | A reply that quotes `replaces_prior_model` verbatim from the description is verified, not guessed — `graph-extractor.test.ts` |
| TC-CR6-B8 | An input node with no `basis_quotes` object at all has every one of its quote fields guessed — `graph-extractor.test.ts` |
| TC-CR6-B9 | A free-typed, unclassified decision label reaches the graph as `decision_type_other` with no `decision_type` set — `graph-extractor.test.ts` |
| TC-CR6-B9b | The tool schema declares the same 200-character bound on `decision_type_other` as the validation gate — `graph-extractor.test.ts` |
| TC-CR6-27 | Every field the question generator can emit is in the hand-off's `ASSUMPTION_GRAPH_FIELDS` — `assumption-fields.test.ts` |

## §7 — Stored answers that are no longer on offer take the Not sure path (CR6-06)

| ID | Asserts |
|---|---|
| TC-CR6-06a | A stale or removed supplier id takes the same path as "I don't know" — same supplier label, listed as an assumption — `plain-intake.test.ts` |
| TC-CR6-06b | A stale or removed platform id takes the "Not sure" path — Zone A, the unregistered supplier label, listed as an assumption — `plain-intake.test.ts` |
| TC-CR6-06c | An unrecognised Q6 value takes the "Not sure" path — execute, level 4, no human check, binding, listed as an assumption — `plain-intake.test.ts` |
| TC-CR6-06d | A stale stored answer leaves Continue disabled until the question is picked again — `StructuredForm.test.tsx` |
| TC-CR6-06e | A stale Q5 tick (alone or mixed with real ticks) takes the "Not sure" path — Confidential, listed as an assumption (`plain-intake.test.ts`); a stale stored tick leaves Continue disabled until the question is picked again (`StructuredForm.test.tsx`) |
| TC-CR6-06f | An unrecognised Q9, Q14 or Q6a value each takes its own "Not sure" path — irreversible, unknown and material respectively — and is listed as an assumption — `plain-intake.test.ts` |

## §7a — Evaluation: the clock, review sources, policy references (B-15, C-5, A-5)

| ID | Asserts |
|---|---|
| TC-CR6-B15 | `extracted_at` is exactly the timestamp parameter, not the engine's own clock — identical inputs and timestamp produce an identical graph — `build-graph-from-form.test.ts` |
| TC-CR6-C5a | Two different packs sharing a rule id but with different review text keep both obligations, ordered by rule id then review text — `evaluate.test.ts` |
| TC-CR6-C5b | `checkPolicyReferences` warns when two loaded packs share a rule id, naming both packs — `policy-references.test.ts` |
| TC-CR6-C5c | Two packs sharing a rule id and identical review text still collapse to one source — `evaluate.test.ts` |
| TC-CR6-C5d | A warning when a firm downstream-review id collides with a loaded pack rule id, naming the pack — `policy-references.test.ts` |
| TC-CR6-A5 | A platform's `vendor_id` that is not a registered vendor id is always an error — `policy-references.test.ts` |

## §8 — What renders: required questions, contrast, wording, fallbacks (FX-4)

| ID | Asserts |
|---|---|
| TC-CR6-07a | Free-text controls and radio groups carry `required` / `aria-required`; tick-all legends say "(tick at least one)"; the asterisk has hidden text "(required)" — `StructuredForm.cr6-fx4.test.tsx` |
| TC-CR6-07b | A visible line by Continue says what is still missing and is tied to the button with `aria-describedby`; once the form is truly complete both the line and the `aria-describedby` are gone — `StructuredForm.cr6-fx4.test.tsx` |
| TC-CR6-07d | The "Still to answer" line has no doubled stops, a noun on the count ("and N more questions") and one final stop — `StructuredForm.cr6-fx4.test.tsx` |
| TC-CR6-07e | A required single-select is a fieldset with `role="radiogroup"` and `aria-required`, named by its legend, and "required" is announced once — `StructuredForm.cr6-fx4.test.tsx` |
| TC-CR6-07f | The "Still to answer" line names each question by its first sentence only, never its help text ("What kind of AI is it", not "…? If more than one fits — …") — found in the live walkthrough — `StructuredForm.cr6-fx4.test.tsx` |
| TC-CR6-07c | A visually-hidden helper class exists for the required-field text — `app-css.cr6-fx4.test.ts` |
| TC-CR6-09 | Each named faint-text rule (first-screen "also covers", the access-scope legend, the chain source) is at least 4.5:1 on its background, computed from the CSS tokens — `app-css.cr6-fx4.test.ts` |
| TC-CR6-10 | The register detail names the correction's source in plain words (form, review screen, or an answer to a question) and says nothing for an older record without one — `RegisterDetail.cr6-fx4.test.tsx` |
| TC-CR6-11 | With both a platform and a supplier declared (no model is declared) and no graph, one combined entry is built from the verdict's own inheritance, saying the record does not keep the two apart; it names them by plain name, never by raw id (amended CR7-14) — `VerdictDisplay.cr6-fx4.test.tsx` |
| TC-CR6-11b | Real policy: PLAT-CLOUD-LLM (on the registry) + VENDOR-NOT-LISTED, no graph — the entry names only the unlisted supplier as not on the covered registry (as "a supplier not on your firm's list", never the raw id), still lists the inherited controls, and never says "nothing inherited"; the fold summary states the same split ("N controls still inherited from the listed one") — `VerdictDisplay.cr6-fx4.test.tsx` |
| TC-CR6-11c | Real policy: PLAT-CLOUD-LLM with Confidential data (outside its Internal-only envelope) + VENDOR-NOT-LISTED, no graph — the entry reads "Partly on the registry", names the unlisted supplier by its plain words rather than its id, and says the listed one inherits nothing because its approval does not cover this use case (no claimed cause beyond that) — `VerdictDisplay.cr6-fx4.test.tsx` |
| TC-CR6-11d | Real policy: PLAT-CLOUD-LLM + VENDOR-APPROVED-LLM (both listed) with Confidential data, no graph — nothing inherited, and the entry says "their approval does not cover this use case", never "falls outside the covered envelope" (the engine can inherit nothing for more than one reason) — `VerdictDisplay.cr6-fx4.test.tsx` |
| TC-CR6-13b | Two packs sharing a rule id with different review text: each review's plain wording comes from the pack rule whose review text matches — `verdict-view-model.test.ts` |
| TC-CR6-16 | Every action type at every autonomy level reads as a full line; at level 2 and above it names the action — `plain-copy.cr6-fx4.test.ts` |
| TC-CR6-18 | With an empty core reason, no sentence starts with ". " or ", " and none carries a doubled stop — `verdict-view-model.test.ts` |
| TC-CR6-19 | The model button label and the Recorded line use `plain_name`, falling back to `model_id` — `QuestionnaireStep.cr6-fx4.test.tsx`. Amended (gvm-test 007, 2026-10-04): the fallback is now a neutral "Model n", never the raw id (CR7-35b, see test-cases-028); the test title says so |
| TC-CR6-19b | The policy schema accepts and keeps an approved model's `plain_name` — `QuestionnaireStep.cr6-fx4.test.tsx` |
| TC-CR6-20 | The evidence-scope caveat (`--scope`) has its own contrast-safe rule that differs from plain evidence text — `app-css.cr6-fx4.test.ts` |
| TC-CR6-21 | The questions' tick-all list resets the fieldset and styles each option like the form's — `app-css.cr6-fx4.test.ts` |
| TC-CR6-22 | The "No" screen's paragraphs have spacing and size rules like the first-screen reason — `app-css.cr6-fx4.test.ts` |
| TC-CR6-23 | On the summary, a country code the policy does not list is never shown bare — `UnderstoodSummary.test.tsx` |
| TC-CR6-23b | Two unlisted codes read "2 other countries", never "another country, another country"; listed names are de-duplicated — `UnderstoodSummary.test.tsx` |
| TC-CR6-23c | `countryName` gives the policy's own country name, or the neutral "another country" for an unlisted code — `plain-copy.cr6-fx4.test.ts` |
| TC-CR6-29 | The register's lifecycle banner and the policy screen's framing never render the reserved words: the banner reads "cleared by 2LoD" and the policy screen says "ruled out straight away". No test carries this id in its name — it is named only in comments beside assertions inside `RegisterView.test.tsx` and `PolicyEditor.test.tsx`, so it is traced by a comment, not by a test name (amended 2026-10-04, O-6) |
| TC-CR6-A2 | `plain_change` placeholders are filled like `plain_reason`, for a firm hard line and a pack hard line — `verdict-view-model.test.ts` |
| TC-CR6-D2 | The unregistered-component text says "supplier and platform risk assessment" — `VerdictDisplay.cr6-fx4.test.tsx` |
| TC-CR6-G7 | A value with the id shape AND a prefix the policy's own platform/vendor ids use, with no registry match, reads "a supplier not on your firm's list"; anything else (incl. `SUP_42`, with no policy prefix) is shown as written — `plain-copy.cr6-fx4.test.ts` |
| TC-CR6-G7b | Real names that look like ids (Q-Corp, V-Systems, ACME-Vision, ZED-AI, Q-ID, NOVA-Clara, AB12-Labs, K9-AI) are shown as written, with or without a policy; `VENDOR-GONE-01` / `PLAT-GONE-01` are still masked — `plain-copy.cr6-fx4.test.ts` |
| TC-CR6-G8 | When nothing is outstanding the count heading is absent; the in-place line keeps its own wording — `VerdictDisplay.cr6-fx4.test.tsx` |
| TC-CR6-G8b | With something outstanding the count heading still shows — `VerdictDisplay.cr6-fx4.test.tsx` |

## Amended existing cases

These cases keep their ids. Their assertions changed because they pinned the old behaviour; each change is a deliberate part of this round, not a weakening.

| ID | What changed |
|---|---|
| TC-R16-D1-07f | Was: a pack-sourced review with no local plain-name data falls back to the generic pack-review line. Now: with no pack data available the generic line is still used (§4.4), and with the real `ss1-23.yaml` loaded the review uses the pack rule's own words (CR6-13) — `verdict-view-model.test.ts` |
| TC-R3-JU-5-01 | Was: nine fieldsets carry `aria-required`. Now: every required control is announced — radio groups carry `role="radiogroup"` with `aria-required`, and the free-text controls carry `required` / `aria-required` (CR6-07) — `StructuredForm.test.tsx` |
| TC-R16-F-71 | Last step changed: after the result is shown the "Picked up where you left off" banner is gone (TC-CR6-02k) and "+ New pre-check" is usable, instead of the banner's "Start over instead" re-enabling. The behaviour it exists for — nothing can start a new case while the result is being worked out — is asserted unchanged; the final check is also wrapped in `waitFor` (slower CI runners) — `IntakeFlow.r16f.test.tsx`; the last step now clicks "+ New pre-check" and asserts an empty description field (the button is never disabled, so "enabled" alone proved nothing) |
| TC-R16-E-11 | The field list is no longer hand-typed: it is derived from `QUOTE_FIELDS`, `AGENT_REACH_FIELDS` and the condition keys of the real `policy/appetite.yaml` and packs (CR6-25) — `plain-copy.test.ts` |
| TC-R16-W-19 | The expected state after a submission with questions and a contradiction no longer carries `submissionContradictions` — nothing is carried from submission (B-10, rewritten) — `intake-state.test.ts` |
| TC-R16-F-24 | Reads the saved draft through `loadDraft()` instead of parsing the raw storage value, because the draft is now saved in a `{ version, state }` envelope (CR6-04) — `IntakeFlow.r16f.test.tsx` |
| TC-R16-F-69 | Fixture only: its draft used `'4': 'llm'`, never a real option of question 4; it now uses `'language'` (CR6-06 rejects an unknown value) — `IntakeFlow.r16f.test.tsx` |
| TC-R16-E-68 | Fixture only (the same change applies to TC-R16-E-66d, -69, -70 and -72): the description-path model replies now carry verbatim `basis_quotes` taken from the description each test types (a node with no quotes now reads as every field guessed, B-8); fields a test expects to be asked stay unquoted, so each still proves what it proved — `IntakeFlow.r16e.test.tsx` |

Further tests changed for the same reasons without a case id of their own: the
`WalkingSkeleton` and `GraphReview.r5/r6/r9` model-reply mocks carry realistic
verbatim quotes; every caller of `buildGraphFromForm` passes a timestamp (B-15);
the "replaces something you already use?" form-path test now pins the exact
assumption reference; `UnderstoodSummary`'s jurisdiction line pins the policy's
country name; `PolicyEditor` and `RegisterView` pin the reworded text (TC-CR6-29).

## Superseded

| ID | Reason |
|---|---|
| TC-CR6-14 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |
| TC-CR6-17b | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |
| TC-CR6-05b | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |
| TC-CR6-02j | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |
| TC-CR6-04b | Superseded by R18-NF-5 and R18-GI-10 (R18-A): a draft from an earlier build no longer restores as a questionnaire, so there is no unsafe undo snapshot to drop; such a draft opens the form with the description kept and no answers (TC-R18-NF-5-01). |

| TC-CR6-C3 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |