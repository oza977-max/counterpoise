# Counterpoise — Test Cases, Round R16-E

*Written 2026-10-03. `build/prompts/R16-E.md` v2.2 — the description-first
path speaks the form's words: the extractor gains the agent fields, one
`QUESTIONNAIRE_COPY` table drives the questionnaire AND the review screen,
"Not sure" answers on this path become assumptions in R16-D2's shape, the
review screen is reworded and works in a narrow window, extraction errors
and the contradiction screen are reworded, "Please double-check" names
what each path shows, and the summary merges this path's "couldn't tell"
list. Built on top of R16-F (commit `52b2edf`) and R16-D2 (commit
`2acea83`).*

Test files: `src/llm/graph-extractor.test.ts`,
`src/components/plain-copy.test.ts`, `src/components/intake-state.test.ts`,
`src/components/__tests__/QuestionnaireStep.r16e.test.tsx`,
`src/components/__tests__/GraphView.r16e.test.tsx`,
`src/components/__tests__/ContradictionReview.r16e.test.tsx`,
`src/components/__tests__/UnderstoodSummary.test.tsx`,
`src/components/__tests__/IntakeFlow.r16e.test.tsx`,
`src/engine/contradiction.test.ts`.

## §1 — Extraction can carry the agent fields, checked through the single gate (D-100; DR7-25)

| ID | Asserts |
|---|---|
| TC-R16-E-01 | A valid list of several `system_access_scope` values is accepted and canonically ordered — `graph-extractor.test.ts` |
| TC-R16-E-02 | A single-element list is accepted — `graph-extractor.test.ts` |
| TC-R16-E-03 | `"none"` combined with another value fails the whole extraction (rejected) — `graph-extractor.test.ts` |
| TC-R16-E-04 | A duplicate value fails the whole extraction (rejected) — `graph-extractor.test.ts` |
| TC-R16-E-05 | A value outside the four legal values fails the whole extraction (rejected) — `graph-extractor.test.ts` |
| TC-R16-E-06 | Absent on a non-agent is accepted and not guessed — no claim, no question — `graph-extractor.test.ts` |
| TC-R16-E-07 | Absent on an agentic node is forced guessed — an agent's reach is never silently "not stated" — `graph-extractor.test.ts` |
| TC-R16-E-08 | A legal value with no verified quote is guessed, same mechanism as every other field — `graph-extractor.test.ts` |
| TC-R16-E-09 | `multi_instance_coordination` accepts its three legal values and rejects anything else — `graph-extractor.test.ts` |
| TC-R16-E-10 | A verified quote keeps the field out of guessed, same as any other field — `graph-extractor.test.ts` |

## §2 — One copy table for every questionnaire field (D-101; DR7-26/28/29/31)

| ID | Asserts |
|---|---|
| TC-R16-E-11 | Every field the generator can emit has a `QUESTIONNAIRE_COPY` entry with a non-empty question and shortLabel — `plain-copy.test.ts` |
| TC-R16-E-12 | `data_class` renders its exact question and five option labels; "Not sure" → `Confidential` — `plain-copy.test.ts` |
| TC-R16-E-13 | `decision_type` offers exactly one lending option (`credit-decision`) and a "Something else" pseudo-option, never `lending-decision`, and no "Not sure" — `plain-copy.test.ts` |
| TC-R16-E-14 | `output_reversibility` offers Q9's two real options only (never `unknown`); "Not sure" → `irreversible` — `plain-copy.test.ts` |
| TC-R16-E-15 | `system_access_scope`'s "Not sure" is all three non-none values, canonically ordered — `plain-copy.test.ts` |
| TC-R16-E-16 | `scale` and `decision_type` offer no "Not sure" — the form has none either — `plain-copy.test.ts` |
| TC-R16-E-17 | `vendor` and `declared_model_id` each offer their own two fixed static choices, with their own help text — `plain-copy.test.ts` |
| TC-R16-E-18 | `questionnaireCopyForField`'s fallback reads "Please check this detail: …" for a field with no entry — never the bare field id alone — `plain-copy.test.ts` |
| TC-R16-E-19 | The fallback prefers a caller-supplied label over the bare field id — `plain-copy.test.ts` |
| TC-R16-E-20 | `vendorNotOnListValue` wraps typed text — with the curly apostrophe the guided form uses (the straight one this case first pinned was the inconsistency review pass 1 found) — and falls back to an unlisted-supplier sentence when left blank — `plain-copy.test.ts` |
| TC-R16-E-26 | The multi-select renders a `<fieldset>` with a `<legend>`, one `<label>` per option, and "Done" disabled until something is ticked — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-30 | `decision_type` offers "Something else — describe it" alongside the real options, excluding `lending-decision` — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-31 | `vendor` renders the firm's registered supplier plus "Not on this list" and "I don't know" (never a free-text box) — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-31b | `declared_model_id` renders the firm's approved model plus its own two fixed choices — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-31c | `vendor_name` (the "Not on this list" follow-up) is optional free text — Submit is enabled even blank — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-68 | End to end: picking "Something else" and typing a description leaves `decision_type` unset and records `decision_type_other`, reaching the evaluated verdict's provisional "could still change" line — `IntakeFlow.r16e.test.tsx` |
| TC-R16-E-69 | End to end: vendor "Not on this list", typing a name wraps it as `"{name} (not on your firm's list)"` — `IntakeFlow.r16e.test.tsx` |

## §3 — Answering: multi-select, "Not sure", and three follow-ups (D-102; DR7-24/27/28/29)

| ID | Asserts |
|---|---|
| TC-R16-E-21 | `insertQuestions` splices the follow-up right after the answered question — `intake-state.test.ts` |
| TC-R16-E-22 | A "Not sure" `assumption` is accumulated into `state.assumptions`, created on first use — `intake-state.test.ts` |
| TC-R16-E-23 | A second "Not sure" answer appends to the existing assumptions list — `intake-state.test.ts` |
| TC-R16-E-24 | `ANSWER_UNDONE` removes the inserted follow-up and the recorded assumption together — `intake-state.test.ts` |
| TC-R16-E-25 | No `insertQuestions`/`assumption` leaves the reducer's existing, unchanged behaviour exactly as before — `intake-state.test.ts` |
| TC-R16-E-27 | Ticking two kinds then "Done" submits both (canonical ORDERING is `normaliseAccessScope`'s job downstream, proved end to end at TC-R16-E-72) — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-27b | Ticking "Nothing beyond…" clears any other tick, same exclusivity as the form's Q13 — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-28 | A multi-select question also offers "Not sure", submitting the strictest array directly (no ticking required) — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-29 | A select-type field offers "Not sure", submitting `QUESTIONNAIRE_COPY`'s stricter value with `notSure=true` — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-29b | A boolean-type field also offers "Not sure" — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-29c | `decision_type` and `scale` offer no "Not sure" button at all — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-32 | A scalar answer's "Recorded:" line shows the option LABEL, never the raw value (BC-4) — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-33 | A multi-select answer's "Recorded:" line joins labels "a, b and c" — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-34 | A guessed-field question introduces itself with the exact sentence "We couldn't tell this from your description:" — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-35 | A triggering rule with a `plain_reason` renders "Why we ask:", with `{audience}`/`{destination}` placeholders resolved — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-35b | A triggering rule with no `plain_reason` renders no "why we ask" line — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-35c | A purely guessed question (no real rule) renders no "why we ask" line either — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-36 | The per-answer context label names "your AI risk team", not "the reviewer" (F1B-6) — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-37 | The progress line never mentions a budget or a tier — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-38 | Answering a question moves focus to the next question's own heading — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-77 | When focus moves to a question the description did not answer, the focused element includes "We couldn’t tell this from your description" — a screen reader hears both (review pass 1) — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-80 | On the description path the summary's double-check gives the reason ("we read that…") and names the card from the shared `GRAPH_REVIEW_CARD_TITLES` (review pass 2: the card-title fix had no test) — `UnderstoodSummary.test.tsx` |
| TC-R16-E-75 | One question asked because the description didn't say reads "This is asked because your description didn’t say." — no "All 1", no model talk (found in the walkthrough) — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-75b | A mix of rule questions and "didn't say" questions counts each, in plain words — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-67 | End to end (BC-3): ticking the identical set the extractor already guessed, via the tick-all control, records no correction — `IntakeFlow.r16e.test.tsx` |
| TC-R16-E-70 | End to end: a "Not sure" answer on `output_reversibility` trips HL-001, and the "No" screen's "answers you weren't sure about" line names it — `IntakeFlow.r16e.test.tsx` |
| TC-R16-E-72 | End to end: ticking `deployment_authority` before `shared_infrastructure` still records the canonical order on the evaluated graph — `IntakeFlow.r16e.test.tsx` |

## §4 — The review screen: `GraphView` and the `graph_review` block (D-103; DR7-26/30/33)

| ID | Asserts |
|---|---|
| TC-R16-E-40 | The three columns are titled "What it uses" / "The AI" / "What comes out" — `GraphView.r16e.test.tsx` |
| TC-R16-E-41 | `data_class`'s row label is `QUESTIONNAIRE_COPY`'s shortLabel, with no `<code>` element anywhere on the card — `GraphView.r16e.test.tsx` |
| TC-R16-E-76 | A value a node can carry but nobody chooses — "unknown" on whether a mistake can be put right, and on whether copies work together — reads in the summary's own words, never the bare value (review pass 1; shown failing without the fix) — `GraphView.r16e.test.tsx` |
| TC-R16-E-78 | A recorded supplier reads as a name: a registered one by its plain name (never its internal id), built in-house as "None — your firm built it" (never "internal"), a typed name as written — one shared lookup (`supplierDisplayName`) for the review screen and the summary (review pass 2) — `GraphView.r16e.test.tsx` |
| TC-R16-E-82 | The questionnaire's "Recorded:" line names a supplier exactly as the button the person clicked did ("Supplier 1" when the firm gave no plain name) — never its registry id (review pass 3; shown failing with the old code) — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-79 | The decision menu never offers two identical choices: the legacy lending value is listed only when it is the recorded value, marked "(older answer)" (review pass 2) — `GraphView.r16e.test.tsx` |
| TC-R16-E-81 | A card column the description gave nothing for reads "Nothing found in your description" — it said "None extracted" (found verifying pass 2's fixes) — `GraphView.r16e.test.tsx` |
| TC-R16-E-41b | `vendor`/`declared_model_id` rows use their own shortLabel, never the bare word "vendor"/"model" — `GraphView.r16e.test.tsx` |
| TC-R16-E-42 | A verified quote reads `From your description: "{quote}"` — `GraphView.r16e.test.tsx` |
| TC-R16-E-43 | A guessed field reads "Not in your description — check this, or it becomes a question" — `GraphView.r16e.test.tsx` |
| TC-R16-E-44 | A confident-but-unquoted field reads "Not in your description — please check this" — `GraphView.r16e.test.tsx` |
| TC-R16-E-45 | An ordinary card reads "This is right"; an uncertain card reads "I've checked this — it's right" — `GraphView.r16e.test.tsx` |
| TC-R16-E-46 | A confirmed card reads "Checked by you." — never "Confirmed by you." — `GraphView.r16e.test.tsx` |
| TC-R16-E-47 | The gate note reads "We read these details from your description — nothing is decided until you've checked or corrected each one." — `GraphView.r16e.test.tsx` |
| TC-R16-E-48 | A single ignored jurisdiction reads `We ignored "{x}" — it isn't one of the countries your firm's rules cover.` — `GraphView.r16e.test.tsx` |
| TC-R16-E-49 | The review screen's plausibility note says why ("…but we read that a person is involved.") and names the card and the row — never a form question (the first version gave only where to look) — `GraphView.r16e.test.tsx` |
| TC-R16-E-50 | `App.css` stacks the cards in one column below 480px and no longer lets the graph scroll sideways — `GraphView.r16e.test.tsx` (it now checks exactly the 480px block, up to its own closing brace — review pass 3) |
| TC-R16-E-55 | `plausibilityMessageForForm` keeps the form path's own question wording, unchanged from R16-F, for all four signals — `plain-copy.test.ts` |
| TC-R16-E-56 | The description path's wording gives the reason in its own terms ("we read"), then the review screen's card and row — never a form question (it first gave only the pointer) — `plain-copy.test.ts` |
| TC-R16-E-57 | The three card titles (`GRAPH_REVIEW_CARD_TITLES`) are shared between this wording and `GraphView`'s own column headings — `plain-copy.test.ts` |
| TC-R16-E-66 | The `graph_review` screen's heading reads identically on a fresh entry — `IntakeFlow.r16e.test.tsx` |
| TC-R16-E-66b | …on a correction re-entry (`originalVerdictId` set) — `IntakeFlow.r16e.test.tsx` |
| TC-R16-E-66c | …on an evaluation-failure re-entry (`afterFailedEvaluation` set) — `IntakeFlow.r16e.test.tsx` |
| TC-R16-E-66d | A genuine evaluation failure on the description path re-enters `graph_review` with the new plain message ("Something went wrong working out the result: … Check the details below and try again.") — `IntakeFlow.r16e.test.tsx` |

## §5 — The description screen's own failures (D-104; DR7-30/AB-1)

| ID | Asserts |
|---|---|
| TC-R16-E-51 | `no-api-key` reads as the description reader not being set up on this computer — `plain-copy.test.ts` |
| TC-R16-E-52 | `network-error` reads as not being able to reach the description reader just now — `plain-copy.test.ts` |
| TC-R16-E-53 | `parse-error` reads as not being able to read the description reliably — `plain-copy.test.ts` |
| TC-R16-E-54 | The shared help line offers both recovery paths ("try again" / "answer the questions") — `plain-copy.test.ts` |
| TC-R16-E-64 | End to end: a fresh extraction failure and a retry failure show the identical plain message for the same error kind, plus "Answer the questions instead"; the retry button reads "Try again" (it said "Try extraction again" until the walkthrough) — `IntakeFlow.r16e.test.tsx` |
| TC-R16-E-65 | End to end: "Answer the questions instead" switches to the guided form with the typed description carried into question 2 — `IntakeFlow.r16e.test.tsx` |

## §6 — The contradiction screen (D-105; DR7-30/F1B-3)

| ID | Asserts |
|---|---|
| TC-R16-E-58 | `detectContradictions`' personal-information pair reads in plain words, with no engine vocabulary — `contradiction.test.ts` |
| TC-R16-E-59 | …the person-approval pair likewise — `contradiction.test.ts` |
| TC-R16-E-60 | The screen's heading reads "Your description and your answers don't match" — `ContradictionReview.r16e.test.tsx` |
| TC-R16-E-61 | Both statements render as independent sentences — no "You said" / "but also" quoting wrapper — `ContradictionReview.r16e.test.tsx` |
| TC-R16-E-62 | No field code or label renders anywhere on the screen — `ContradictionReview.r16e.test.tsx` |
| TC-R16-E-62b | The screen renders with none of §8's banned words, for either signal pair — `ContradictionReview.r16e.test.tsx` |
| TC-R16-E-63 | The field label reads "Which is right, and why?" and the button reads "Continue" — `ContradictionReview.r16e.test.tsx` |

## §7 — "Things we couldn't tell" on the summary (D-106; DR7-24/BB-1)

| ID | Asserts |
|---|---|
| TC-R16-E-71 | The description path merges BOTH the uncertain nodes and the questionnaire's "Not sure" assumptions into one list under "Things we couldn't tell from your description", chosen by `graph.intake_method` — `UnderstoodSummary.test.tsx` |

## §8 — The guard test (no engine vocabulary on any screen a submitter sees)

| ID | Asserts |
|---|---|
| TC-R16-E-39 | Every closed-vocabulary field's targeted question renders with none of the banned words — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-39b | The multi-select screen (`system_access_scope`) renders with none of the banned words — `QuestionnaireStep.r16e.test.tsx` |
| TC-R16-E-39c | A fully-populated `GraphView` graph (agentic, every badge/warning/checklist path at once) renders with none of the banned words — with every card's "Why these values matter" lines opened first (review pass 4) — `GraphView.r16e.test.tsx` |
| TC-R16-E-73 | The whole `graph_review` block (heading, checklist, cards, jurisdictions panel, together) renders with none of the banned words — with every card's "Why these values matter" lines opened first (review pass 4) — `IntakeFlow.r16e.test.tsx` |
| TC-R16-E-74 | The extraction-error screen renders with none of the banned words — `IntakeFlow.r16e.test.tsx` |
| TC-R16-E-83 | Every "Why these values matter" line (all of `FIELD_CONSEQUENCES`, not only the ones a fixture shows) carries none of the banned words and none of the reviewer's or engine's own terms ("registry", "floors", "severity", "instances", "incident", "Levels 3–4", "hard lines", "zone", "vendor", "governance", "appetite", "exposure", the two reserved verdict words) — review pass 4; shown failing with the old wording — `GraphView.r16e.test.tsx` |

## Untested behaviours

- **The local-model (Ollama) extraction path's own handling of `system_access_scope`/`multi_instance_coordination`.** §1's tests all drive the Anthropic-SDK path (`mockCreate`, the same mock boundary every other extraction test in this codebase uses). `localChatJson` (`src/llm/local-provider.ts`) feeds the identical `parseExtraction`/zod gate, so the same validation applies, but no test here drives that specific provider with these two fields — not a new gap this chunk introduces (the local-provider tests pre-date these two fields and were not in this chunk's file list).
- **`declared_model_id`'s own "Not on the list" follow-up, end to end.** `QuestionnaireStep.r16e.test.tsx` (TC-R16-E-31b) proves the registry option and the two fixed choices render; the follow-up's own text-input behaviour is proved generically by `vendor_name`'s identical mechanism (TC-R16-E-31c) and by code reading (`declared_model_id_name` is handled by the exact same `textOptional` branch) — not separately driven end to end through the real App, unlike `vendor_name` (TC-R16-E-69).
- **Every one of the fourteen closed-vocabulary fields' own `QUESTIONNAIRE_COPY` question/option text, individually.** TC-R16-E-11 proves every field has a non-empty entry; TC-R16-E-12/13/14/15/16/17 spot-check six of them (the ones with the least-obvious mapping — the single lending option, the two-option reversibility, the all-three-ticked multi-select "Not sure", the two fields with no "Not sure" at all, and vendor/model's own static choices). The other eight fields' exact wording is exercised incidentally by `QuestionnaireStep.r16e.test.tsx`'s guard test (TC-R16-E-39, which renders each field's targeted question) and by the end-to-end tests, but their precise option strings are not individually pinned by a dedicated assertion the way the six above are.
- **A description-path case that reaches `contradiction_review`.** §6's screen-level tests (TC-R16-E-60 to -63) render `ContradictionReview` directly from fixtures (the component-level pattern this codebase's own test files already use for this screen); no new end-to-end test here drives a real extracted graph all the way into a contradiction on the description path specifically — the pre-existing `IntakeFlow.back.test.tsx` case for this screen is on the form path, and was updated (not duplicated) for this chunk's wording change.

## Changelog

| Date | Change |
|---|---|
| 2026-10-03 | Written for R16-E (the description-first path speaks the form's words). |
| 2026-10-03 | Verification and review pass 1: TC-R16-E-75/75b (plain question-count note), TC-R16-E-76 ("unknown" in words), TC-R16-E-77 (focus includes the intro) added; TC-R16-E-20 and -64 corrected; the §8 guard's banned list now catches word forms (`extract…`, `guessed`/`guessing`, `local model`). |
| 2026-10-03 | Review pass 2: TC-R16-E-78 (supplier names, never ids), -79 (no duplicate decision choices), -80 (summary warning: reason + shared card title), -81 ("Nothing found in your description") added; -49 and -56 corrected — the description path's warning gave only where to look, never why. |
| 2026-10-03 | Review pass 3: TC-R16-E-82 added (the Recorded line could show a supplier's registry id); TC-R16-E-50 tightened to its own CSS block; the agent-access editor's group heading now uses the screen's plain label. |
| 2026-10-03 | Review pass 4: the "Why these values matter" lines were hidden until clicked, so the guard never read them — and one said "binding". Every line reworded in plain words; TC-R16-E-39c and -73 now open every card's lines before scanning; TC-R16-E-83 added. |

## Superseded

| ID | Reason |
|---|---|
| TC-R16-E-64 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |
| TC-R16-E-66 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |
| TC-R16-E-66b | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |
| TC-R16-E-66c | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |
| TC-R16-E-67 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |
| TC-R16-E-68 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |
| TC-R16-E-69 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |
| TC-R16-E-70 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |
| TC-R16-E-72 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |
| TC-R16-E-73 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |
| TC-R16-E-74 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |

| TC-R16-E-65 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |