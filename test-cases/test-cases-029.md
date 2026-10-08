# Counterpoise — Test Cases, Round CR7 (code review 007 fixes) — waves 1 and 2

*Written 2026-10-04. Code review 007 found that several screens and stores did
less than the specs said, or said more than they did: a saved draft restored
into a screen that could not finish, "Back" lost what the questions had
changed, the audit trail could fork between two tabs, a policy with a dangling
reference was saved and then stopped every evaluation, and a few messages told
the person something the code could not back up. This is the first wave of
fixes. The amended spec sections are marked "(CR7, 2026-10-04)" in
`specs/intake-flow`, `specs/verdict-audit`, `specs/register-lifecycle`,
`specs/policy-schema` and `specs/cross-cutting`. The CR7-35 rows (a model with
no plain name) are in `test-cases-028` — another session wrote them.*

Test files: `src/components/__tests__/IntakeFlow.cr7-fx1.test.tsx`,
`src/components/__tests__/PolicyEditor.cr7.test.tsx`,
`src/components/__tests__/SettingsPanel.cr7.test.tsx`,
`src/components/__tests__/StructuredForm.test.tsx`,
`src/components/__tests__/ConfirmationStep.test.tsx`,
`src/components/intake-state.test.ts`, `src/components/intake-draft.test.ts`,
`src/engine/plain-intake.test.ts`, `src/llm/graph-extractor.test.ts`,
`src/llm/reasoning-trace.test.ts`, `src/seeds/cr7-seeds.test.ts`,
`src/store/cr7-audit-tabs.test.ts`, `src/store/cr7-policy-update.test.ts`,
`src/store/cr7-reset.test.ts`, `src/store/policy-references.test.ts`,
`src/store/register.model-nodes.test.ts`.

## §1 — Restoring a saved draft at the extraction step restarts the extraction once

| ID | Asserts |
|---|---|
| TC-CR7-01a-1 | The extractor is called exactly once and the review screen appears — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-01a-2 | Still exactly one call when mounted twice — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-01b | Restored + the extraction fails -> the Try again panel shows — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-01c | A fresh, non-restored description path calls the extractor exactly once — `IntakeFlow.cr7-fx1.test.tsx` |

## §2 — Re-entries into the review screen keep the "Not sure" assumptions

| ID | Asserts |
|---|---|
| TC-CR7-02-1 | STEP_BACK from the questionnaire carries NO assumptions — they are re-asked (CR7-03) — `intake-state.test.ts` |
| TC-CR7-02-2 | A revisited review screen stays marked as revisited across a trip into the questions and Back (including a contradiction round trip) — `intake-state.test.ts` |
| TC-CR7-02-3 | A first reading of the review screen is NOT marked as revisited, before or after a trip into the questions — `intake-state.test.ts` |
| TC-CR7-02a-1 | Change an answer -> Continue -> Confirm keeps the "Not sure" assumption in graph_confirmed and on the result, and the countries panel is present — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-02c | Change an answer -> Continue -> Confirm keeps the "Not sure" assumption in graph_confirmed and on the result, and the countries panel is present — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-02a-2 | CHANGE_ANSWER on the description path carries the assumptions and the frozen uncertain list, marks the countries as already checked, and flags the re-entry — `intake-state.test.ts` |
| TC-CR7-02b-1 | After a failed evaluation the re-entered review keeps the assumption through to the second graph_confirmed — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-02b-2 | A failed evaluation hands the assumptions and uncertain list back to the review screen too — `intake-state.test.ts` |
| TC-CR7-02c-edit | After Change an answer a country can be ticked; the graph changes, a jurisdictions correction is recorded and reaches the trail on Confirm — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-02d-1 | Correcting from the result keeps the assumption in verdict_corrected — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-02d-2 | CORRECT_VERDICT carries what the last confirmation was based on — `intake-state.test.ts` |
| TC-CR7-02e-1 | "Not sure" again for a question that already has an assumption leaves exactly one — `intake-state.test.ts` |
| TC-CR7-02e-2 | A definite answer for a question that had an assumption removes it (and leaves the others) — `intake-state.test.ts` |
| TC-CR7-02f-1 | Undo after a replaced assumption restores the previous array — `intake-state.test.ts` |
| TC-CR7-02f-2 | Undo of a first "Not sure" removes it again — `intake-state.test.ts` |
| TC-CR7-02h-1 | Not sure -> confirmation -> Change an answer -> Continue (questions) -> Back -> Continue -> Confirm keeps the earlier "Not sure" in graph_confirmed (and not the one given in the abandoned round) — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-02h-2 | The same through a correction from the result — verdict_corrected keeps the earlier "Not sure" — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-02h-3 | Change an answer -> Continue (questions) -> a new "Not sure" -> Back: the earlier round's assumption is back, the new one is re-asked — `intake-state.test.ts` |
| TC-CR7-02h-4 | The same round trip from a correction pass — `intake-state.test.ts` |

## §3 — Back from the questions restores everything the questions changed

| ID | Asserts |
|---|---|
| TC-CR7-03-1 | QUESTIONS_GENERATED snapshots the graph, corrections and the untrimmed guessed list — `intake-state.test.ts` |
| TC-CR7-03-2 | After an answer that trims the field and changes the graph, Back restores all three so the field is asked again — `intake-state.test.ts` |
| TC-CR7-03-3 | The snapshot survives Undo, a contradiction round trip, and a second answer — `intake-state.test.ts` |
| TC-CR7-03-4 | A questionnaire saved before this change (no snapshot) steps back exactly as it did before — `intake-state.test.ts` |
| TC-CR7-03a | "Not sure" -> Back -> Continue asks the field again, the result lists the assumption once, and no duplicate graph_corrected events are written — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-03e | "Not sure" -> Back -> Continue asks the field again, the result lists the assumption once, and no duplicate graph_corrected events are written — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-03b | A vendor guess -> "Not on this list" -> Back -> Continue asks the supplier again, and the AI guess never reaches the result — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-03c | A declared-model guess -> "Not on the list" -> Back -> Continue asks the model again — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-03d | Decision type "Something else" -> Back -> Continue asks it again — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-03f-1 | Failed evaluation -> questions -> Back: Back from the review is still refused, and the case id is unchanged — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-03f-2 | A review re-entered after a failed evaluation is still "after a failed evaluation" after a trip into the questions and Back, and Back from it is refused — `intake-state.test.ts` |
| TC-CR7-03f-3 | A first reading is not marked as after a failed evaluation — `intake-state.test.ts` |

## §4 — The optional model name is asked and read by one rule

| ID | Asserts |
|---|---|
| TC-CR7-04a | A model typed under "outside assistant", then Q3 switched to "built in your firm", never reaches the result or the register — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-04b | Q3ShowsModelQuestion is true for outside-assistant, supplier-feature, specialist-product only — `plain-intake.test.ts` |
| TC-CR7-04c | A stale 3model left behind after Q3 changed to firm-built names no model — `plain-intake.test.ts` |
| TC-CR7-04d | The same 3model is read when Q3 is a supplier option — `plain-intake.test.ts` |
| TC-CR7-04e | For every Q3 option, the model question is on screen exactly when the engine would read it — `StructuredForm.test.tsx` |

## §5 — Two tabs appending to the audit trail extend one chain

| ID | Asserts |
|---|---|
| TC-CR7-05 | Two tabs appending in turn do not fork the chain — `cr7-audit-tabs.test.ts` |
| TC-CR7-05b | An append whose database handle is closed mid-flight reopens and succeeds — `cr7-audit-tabs.test.ts` |

## §6 — Saving the policy is single-flight and says what happened

| ID | Asserts |
|---|---|
| TC-CR7-06a-1 | Two rapid clicks on Save queue each active case once (the real trail) — `PolicyEditor.cr7.test.tsx` |
| TC-CR7-06a-2 | Save is disabled while the save is running — `PolicyEditor.cr7.test.tsx` |
| TC-CR7-06b | A failing onPolicyUpdated shows a plain message, not a silent unhandled rejection — `PolicyEditor.cr7.test.tsx` |
| TC-CR7-06c | A retry after a part-way failure queues each case exactly once, and a later save after a new verdict queues again — `cr7-policy-update.test.ts` |
| TC-CR7-06d-1 | After a retry the saved message says how many were already waiting — `PolicyEditor.cr7.test.tsx` |
| TC-CR7-06d-2 | With nothing already waiting the message has no "already waiting" part — `PolicyEditor.cr7.test.tsx` |
| TC-CR7-06e | If the browser refuses to store the policy, the alert does not claim it was saved or that saving again is safe — `PolicyEditor.cr7.test.tsx` |

## §10 — The adopted screen names the matched case only to the 2LoD view

| ID | Asserts |
|---|---|
| TC-CR7-10a | A 1LoD view that adopts never has the matched label in the DOM — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-10b | A 2LoD view still sees the matched label — `IntakeFlow.cr7-fx1.test.tsx` |

## §13 — A policy problem no longer costs the person their answers

| ID | Asserts |
|---|---|
| TC-CR7-13 | An invalid policy -> Continue -> remount: the answers are still there — `IntakeFlow.cr7-fx1.test.tsx` |

## §15 — Clear all data clears the drafts and the markers

| ID | Asserts |
|---|---|
| TC-CR7-15-1 | Clears the saved intake drafts (all three keys) and the hand-off marker, then reloads — `SettingsPanel.cr7.test.tsx` |
| TC-CR7-15-2 | The confirmation says exactly what is cleared and what is kept (BC-005) — `SettingsPanel.cr7.test.tsx` |
| TC-CR7-15-3 | An incomplete reset clears the drafts too, and its message says exactly what was and was not cleared — `SettingsPanel.cr7.test.tsx` |
| TC-CR7-15-4 | Clears the hand-off sync marker and the welcome flag, keeps the policy and model settings — `cr7-reset.test.ts` |

## §16 — A finished confirm or adopt clears only its own draft

| ID | Asserts |
|---|---|
| TC-CR7-16-1 | Clears when the stored draft carries this useCaseId — `intake-draft.test.ts` |
| TC-CR7-16-2 | Clears when there is no stored draft (nothing to protect) — `intake-draft.test.ts` |
| TC-CR7-16-3 | Leaves a draft with a different useCaseId — `intake-draft.test.ts` |
| TC-CR7-16-4 | Leaves a draft with no useCaseId at all (a case just started) — `intake-draft.test.ts` |
| TC-CR7-16-5 | An adopt (which mints its id inside the handler) also clears the duplicate-check draft it came from, and only that one — `intake-draft.test.ts` |
| TC-CR7-16a | A confirm that finishes after the person left leaves a different case's draft alone — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-16b-1 | An adopt that finishes after the person left leaves a different case's draft alone — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-16b-2 | A finished adopt still clears its own saved draft — `IntakeFlow.cr7-fx1.test.tsx` |

## §17 — A failing first-run seed does not block the duplicate check

| ID | Asserts |
|---|---|
| TC-CR7-17 | With the seed wait rejecting, a draft restored at the duplicate check still resolves it — `IntakeFlow.cr7-fx1.test.tsx` |

## §18 — Seeds run once per case under the case lock

| ID | Asserts |
|---|---|
| TC-CR7-18-1 | Two module instances seeding the sample register at once write one set of events — `cr7-seeds.test.ts` |
| TC-CR7-18-2 | Two module instances seeding the investment-bank portfolio at once write one set of events — `cr7-seeds.test.ts` |
| TC-CR7-18-3 | Two module instances seeding the self-assessment at once write it once — `cr7-seeds.test.ts` |

## §19 — The reasoning-trace call cannot hold the case lock

| ID | Asserts |
|---|---|
| TC-CR7-19 | The SDK call carries a 15 s timeout and no retries, so a stalled call cannot hold the case lock — `reasoning-trace.test.ts` |

## §20 — A reset and a later write cope with each other

| ID | Asserts |
|---|---|
| TC-CR7-20a | Reset succeeds when this tab's own database connections are open — `cr7-reset.test.ts` |
| TC-CR7-20b | A write after another instance's reset reopens the database instead of throwing — `cr7-reset.test.ts` |

## §21 — Correction writes are planned against the trail

| ID | Asserts |
|---|---|
| TC-CR7-21a | A form-path correction -> failed evaluation -> retry writes one set of graph_corrected events — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-21b | A description-path correction -> failed evaluation -> retry puts the correction on the trail exactly once — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-21c-1 | A->B (failed), B->A, then A->B again: the third is NOT treated as already there — `intake-state.test.ts` |
| TC-CR7-21c-2 | The same change retried with a fresh id IS skipped when nothing reversed it — `intake-state.test.ts` |
| TC-CR7-21d-1 | A description-path retry after a failed evaluation records corrections_count equal to the graph_corrected events on the trail — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-21d-2 | SinceLastResult counts the events in the window plus the ones about to be written, and ignores those before the last result — `intake-state.test.ts` |
| TC-CR7-21e-1 | A->B, A->C, then A->B again: the third is written (the trail would otherwise end at C while the graph says B) — `intake-state.test.ts` |
| TC-CR7-21e-2 | A pending correction equal to the latest written value for its field is skipped — `intake-state.test.ts` |
| TC-CR7-21f-1 | A form correction that fails, then a resubmit with the name back as it was, writes the reverse corrections, and the count matches the trail — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-21f-2 | A->B was written, the field is back at A and nothing is pending: one B->A correction is written, same source, and the count includes it — `intake-state.test.ts` |
| TC-CR7-21f-3 | When the trail already ends at the graph value nothing is synthesised — `intake-state.test.ts` |
| TC-CR7-21g | List values compare as sets — a different order is the same correction — `intake-state.test.ts` |
| TC-CR7-21h | A data class ticked, evaluation fails, it is unticked and resubmitted: the net trail value equals the original set — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-21i-1 | A node the resolver cannot find writes NOTHING for that key — never a null on the trail — `intake-state.test.ts` |
| TC-CR7-21i-2 | The form path resolver maps the ORIGINAL ids by role, and the inputs sentinel to the sorted distinct data classes — `intake-state.test.ts` |
| TC-CR7-21i-3 | The resolver returns list values sorted, so a synthesised correction is stored the way formCorrections stores them — `intake-state.test.ts` |
| TC-CR7-21j | A country ticked (and "somewhere else" unticked), evaluation fails, then put back: a reverse graph\|jurisdictions correction is on the trail — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-21k | An output-node answer (how widely it is used) changed, evaluation fails, then put back: the reverse correction is on the trail — `IntakeFlow.cr7-fx1.test.tsx` |

## §22 — The confirmation count matches the trail

| ID | Asserts |
|---|---|
| TC-CR7-22 | The confirmation says "N corrections made … preserved in the audit trail" — and the trail holds exactly N graph_corrected events — `IntakeFlow.cr7-fx1.test.tsx` |

## §23 — Countries panel: a listed country is kept beside "Somewhere else, or not sure"

| ID | Asserts |
|---|---|
| TC-CR7-23a | UK + elsewhere keeps UK and lists the unchecked country as an assumption — `plain-intake.test.ts` |
| TC-CR7-23b | "Somewhere else, or not sure" on its own gives an empty jurisdictions list and no assumption — `plain-intake.test.ts` |
| TC-CR7-23c | With the shipped policy and packs the UK pack applies and the result is not provisional for want of a regulatory basis — `plain-intake.test.ts` |

## §24 — Back and Start over clear the previous screen's error line

| ID | Asserts |
|---|---|
| TC-CR7-24-1 | Back, then forward again, shows no stale gate error — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-24-2 | Start over, then a fresh case to the review screen, shows no stale gate error — `IntakeFlow.cr7-fx1.test.tsx` |

## §26 — Placeholders outside the two filled fields warn

| ID | Asserts |
|---|---|
| TC-CR7-26 | A placeholder in a field that is never filled warns that it prints literally, and never claims it is recognised — `policy-references.test.ts` |
| TC-CR7-26b | In plain_reason and plain_change the message still names the recognised placeholders; they themselves do not warn — `policy-references.test.ts` |

## §27 — New error-level references in the policy

| ID | Asserts |
|---|---|
| TC-CR7-27a | Errors — controls[].resolves names an id that is neither an invariant nor a hard line — `policy-references.test.ts` |
| TC-CR7-27b | Errors — a platform or vendor satisfies_controls and coupled_clusters entry names a control that does not exist — `policy-references.test.ts` |
| TC-CR7-27c | Errors — a pack required_control names a control the policy does not have (only when packs are loaded) — `policy-references.test.ts` |
| TC-CR7-27d | The shipped policy and packs have none of these reference errors — `policy-references.test.ts` |

## §28 — Older saved question drafts restore as the review screen

| ID | Asserts |
|---|---|
| TC-CR7-28-1 | The review screen shows with every card to re-check, the countries unchecked, and the plain notice — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-28-2 | A draft the current build saved shows no such notice — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-28-3 | The notice is gone once the person leaves the review screen — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR7-28-4 | A bare (version 1) questions or contradiction-review draft on the description path restores as graph_review with every card to re-check, the countries unchecked, and nothing invented — `intake-draft.test.ts` |
| TC-CR7-28-5 | LoadDraftInfo says the draft was migrated, so the screen can say so — `intake-draft.test.ts` |
| TC-CR7-28-6 | A form-path questionnaire (plainAnswers present) is NOT migrated — `intake-draft.test.ts` |
| TC-CR7-28-7 | A draft saved by the current build (an envelope at the current version) is never migrated — `intake-draft.test.ts` |
| TC-CR7-28-8 | The migrated review keeps the assumptions and the frozen uncertain list the old draft held — `intake-draft.test.ts` |
| TC-CR7-28b-1 | The current draft version is 3, and a version-2 description-path questions draft with no back snapshot is migrated like a version-1 one — `intake-draft.test.ts` |
| TC-CR7-28b-2 | A version-2 draft that is on the form path, or that already has its back snapshot, is not migrated — `intake-draft.test.ts` |

## §30 — A recorded correction never carries an undefined value

| ID | Asserts |
|---|---|
| TC-CR7-30a | A questionnaire answer for a field that had no value is recorded with original_value null, not undefined — `IntakeFlow.cr7-fx1.test.tsx` |

## §31 — A listed decision type wins over the free-text one

| ID | Asserts |
|---|---|
| TC-CR7-31 | Decision_type_other is dropped when decision_type is set — `graph-extractor.test.ts` |
| TC-CR7-31b | The tool schema tells the model to use decision_type_other only when no listed type fits — `graph-extractor.test.ts` |

## §37 — The submitter-facing policy problem is one plain sentence

| ID | Asserts |
|---|---|
| TC-CR7-37 | An invalid policy on the form path shows no field path in the alert, and says who can fix it — `IntakeFlow.cr7-fx1.test.tsx` |

## §38 — The policy screen's per-country sign-off line

| ID | Asserts |
|---|---|
| TC-CR7-38a | No pack signed off says none — `PolicyEditor.cr7.test.tsx` |
| TC-CR7-38b | One of two EU packs signed off says N of M, and never "not yet signed off" or "all" — `PolicyEditor.cr7.test.tsx` |
| TC-CR7-38c | Every EU pack signed off says all signed off, and never claims "not yet signed off" — `PolicyEditor.cr7.test.tsx` |

## §41 — The register snapshots a model the way the engine resolved it

| ID | Asserts |
|---|---|
| TC-CR7-41a | A model that belongs to a listed family is snapshotted with the family vendor and acceptance — `register.model-nodes.test.ts` |
| TC-CR7-41b | An exact entry still resolves to itself, and an id no entry covers stays unknown / not accepted — `register.model-nodes.test.ts` |
| TC-CR7-41c | A typed name the family would accept becomes declared_model_id exactly as typed — `plain-intake.test.ts` |
| TC-CR7-41d | A model in a family past its reattest_by is snapshotted is_approved false, as the engine judged it — `IntakeFlow.cr7-fx1.test.tsx` |

## §O8 — Confirmation step wording

| ID | Asserts |
|---|---|
| TC-CR7-O8 | Does not claim the record "can't be edited"; says a change would show, and that it is kept in this browser with no outside check — `ConfirmationStep.test.tsx` |

## Amended existing cases

These cases keep their ids. Their assertions changed because they pinned the old behaviour; each change is a deliberate part of this round, not a weakening.

| ID | What changed |
|---|---|
| (V2-A "D2", no TC id) | Was: a pack with no signed-off rule reads "not yet signed off". Now: it reads "none signed off" (the line is "none / N of M / all signed off", counted per rule) — `PolicyEditor.test.tsx` |
| TC-CR6-03c | Was: Back from the questions restores the trimmed guessed list. Now: Back restores the untrimmed list from the snapshot, so every guessed question is asked again — `intake-state.test.ts` |
| TC-CR6-02c | Was: the adopted screen always names the matched case. Now: it names it only in the 2LoD view; any other view reads "An earlier result on your firm's register was used." — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-02e | Was: the adopted screen always names the matched case. Now: it names it only in the 2LoD view; any other view reads "An earlier result on your firm's register was used." — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-02g | Was: the adopted screen always names the matched case. Now: it names it only in the 2LoD view; any other view reads "An earlier result on your firm's register was used." — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-02h | Was: the adopted screen always names the matched case. Now: it names it only in the 2LoD view; any other view reads "An earlier result on your firm's register was used." — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-02i | Was: the adopted screen always names the matched case. Now: it names it only in the 2LoD view; any other view reads "An earlier result on your firm's register was used." — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-02k | Was: the adopted screen always names the matched case. Now: it names it only in the 2LoD view; any other view reads "An earlier result on your firm's register was used." — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-17a | Was: the submitter sees the policy checker's detail. Now: one plain sentence ("Your firm's rules file has a problem, so this can't be checked right now…"); the detail goes to the console only — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-17b | Was: the submitter sees the policy checker's detail. Now: one plain sentence ("Your firm's rules file has a problem, so this can't be checked right now…"); the detail goes to the console only — `IntakeFlow.cr6-fx2.test.tsx` |
| TC-R16-F-67 | Was: the submitter sees the policy checker's detail. Now: one plain sentence ("Your firm's rules file has a problem, so this can't be checked right now…"); the detail goes to the console only — `IntakeFlow.r16f.test.tsx` |
| TC-CR6-04a | Was: driven from the description path. Now: driven through the form-path questionnaire, which is where the behaviour lives — `intake-state.test.ts`, `IntakeFlow.cr6-fx2.test.tsx` |
| TC-CR6-04b | Was: driven from the description path. Now: driven through the form-path questionnaire — `intake-draft.test.ts` |
| TC-CR6-15a | Was: asserted straight after the confirm. Now: waits for the draft clear, because the clear is conditional on the draft still being this case's — `IntakeFlow.cr6-fx2.test.tsx` |
| (plain-intake, "even alongside other ticks") | Was: "Somewhere else, or not sure" forces an empty jurisdictions list even alongside other ticks. Now: a listed country is kept and the unknown one becomes an assumption (TC-CR7-23a); the lone tick still gives an empty list (TC-CR7-23b) — `plain-intake.test.ts` |

## Wave 2

*Written 2026-10-04. The second wave of code review 007 fixes (CR7-02 (6), 07, 08, 09, 10c, 11, 14, 25, 29, 30b, 35e, 36, 37, 39, 40) and the FX7-4 review passes (O-9 and the model-lookup guard). The amended spec sections are marked "(CR7, 2026-10-04)" in `specs/verdict-audit`, `specs/register-lifecycle`, `specs/intake-flow` and `specs/cross-cutting`. The CR7-35a to 35d rows are in `test-cases-028`; CR7-35e is here because it is a result-screen case.*

Test files: `src/components/verdict-view-model.cr7-fx4.test.ts`,
`src/components/__tests__/VerdictDisplay.cr7-fx4.test.tsx`,
`src/components/__tests__/RegisterDetail.cr7-fx4.test.tsx`,
`src/components/__tests__/RegisterDetail.nomodel.cr7.test.tsx`,
`src/components/__tests__/RegisterView.cr7-fx4.test.tsx`,
`src/components/__tests__/ModelLinkFailure.cr7.test.tsx`,
`src/components/__tests__/GraphView.cr7-fx4.test.tsx`,
`src/components/__tests__/GraphView.reentry.cr7.test.tsx`,
`src/components/__tests__/ContradictionReview.cr7-fx4.test.tsx`,
`src/components/__tests__/About.cr7-fx4.test.tsx`,
`src/components/__tests__/app-css.cr7-fx4.test.ts`.

## §02 (wave 2) — A revisited review does not claim a value was missing from the description

| ID | Asserts |
|---|---|
| TC-CR7-02g | With `reentry` set, a confident-but-unquoted field carries no "Not in your description" badge — `GraphView.cr7-fx4.test.tsx` |
| TC-CR7-02g-1 | The same graph on a first read (no `reentry`; a real extraction, provenance recorded, nothing quoted) still shows the badge — `GraphView.cr7-fx4.test.tsx` |
| TC-CR7-02g-2 | `reentry` does not hide a field the reader still has to check: a guessed field keeps its badge — `GraphView.cr7-fx4.test.tsx` |
| TC-CR7-02g-3 | Change an answer, through the real reducer, restores a review screen with no "Not in your description" badge — `GraphView.reentry.cr7.test.tsx` |
| TC-CR7-02g-3b | The same graph on a first review (no re-entry) still shows the badge — `GraphView.reentry.cr7.test.tsx` |
| TC-CR7-02h | With no provenance and no guessed list at all (a draft from an older build), no claim is made about the description; the badge says where the value came from wasn't saved — `GraphView.cr7-fx4.test.tsx` |

## §07 — The case name in the register is a button

| ID | Asserts |
|---|---|
| TC-CR7-07 | The case name is a button; Tab reaches it and Enter opens the case — `RegisterView.cr7-fx4.test.tsx` |
| TC-CR7-07-1 | Two cases with the same name get different accessible names, from their tier and stage — `RegisterView.cr7-fx4.test.tsx` |

## §08 — Contrast tokens

| ID | Asserts |
|---|---|
| TC-CR7-08-ink-faint | `--ink-faint` is at least 4.5:1 on each of `--card-bg`, `--paper`, `--cream` and `--warn-bg` (four tests, one per background, each named `TC-CR7-08-ink-faint-on` plus the token) — `app-css.cr7-fx4.test.ts` |
| TC-CR7-08-warn-text | `--warn-text` on `--warn-bg` is at least 4.5:1 — `app-css.cr7-fx4.test.ts` |
| TC-CR7-08-control-border | The form-control border is at least 3:1 on the card and the page — `app-css.cr7-fx4.test.ts` |

## §09 — The sign-off wording comes from the trail, the policy and the stage

| ID | Asserts |
|---|---|
| TC-CR7-09a | A signed-off Track II case (stage approved, a second-line review event) names the sign-off and never says self-service — `verdict-view-model.cr7-fx4.test.ts` |
| TC-CR7-09b | A genuine self-service case (Low tier, stage approved) is unchanged: nobody signs off — `verdict-view-model.cr7-fx4.test.ts` |
| TC-CR7-09c | A correction requested is not a sign-off: the case still needs one and never claims it was signed off — `verdict-view-model.cr7-fx4.test.ts` |
| TC-CR7-09d | Signed off, then corrected: the new verdict is not "signed off" — `verdict-view-model.cr7-fx4.test.ts` |
| TC-CR7-09e | A rejected review is not a sign-off either — `verdict-view-model.cr7-fx4.test.ts` |
| TC-CR7-09i | Signed off, then the firm edits `tier_workflow` to self-service: the trail still says signed off, never "nobody" — `verdict-view-model.cr7-fx4.test.ts` |
| TC-CR7-09j | With no policy at all, an approving review on the trail still reads signed off, never "nobody" — `verdict-view-model.cr7-fx4.test.ts` |
| TC-CR7-09k | A later stage that needed a sign-off but has no approving review claims neither "pending" nor "nobody"; the headline says no sign-off is on record, with and without outstanding safeguards — `verdict-view-model.cr7-fx4.test.ts` |
| TC-CR7-09f | On the screen, a signed-off Track II case (stage approved) says it was signed off and never "self-service" or "nobody" — `VerdictDisplay.cr7-fx4.test.tsx` |
| TC-CR7-09g | On the screen, a genuine self-service case (Low tier, stage approved) keeps its self-service wording — `VerdictDisplay.cr7-fx4.test.tsx` |
| TC-CR7-09h | Stage approved for a case that needed a sign-off but has no approving review on this verdict: no "self-service" and no "signed off by" — `VerdictDisplay.cr7-fx4.test.tsx` |

## §10 (wave 2) — The register's audit lines for another case's name

| ID | Asserts |
|---|---|
| TC-CR7-10c | A 1LoD view omits the matched label from both lines (`classification_adopted`, `duplicate_dismissed`); the 2LoD view keeps it — `RegisterDetail.cr7-fx4.test.tsx` |
| TC-CR7-10c-1 | The rendered trail for a 1LoD viewer never carries the matched label (real component, real store) — `RegisterDetail.cr7-fx4.test.tsx` |

## §11 — "No model was named" is said only when it can be proved

| ID | Asserts |
|---|---|
| TC-CR7-11a | Shown in the reviewer section when no processing node names a model — `VerdictDisplay.cr7-fx4.test.tsx` |
| TC-CR7-11b | Absent when a model is named (the false case) — `VerdictDisplay.cr7-fx4.test.tsx` |
| TC-CR7-11c | Absent when there is no graph to read, since the register path cannot say none was named — `VerdictDisplay.cr7-fx4.test.tsx` |
| TC-CR7-11d | On the register, a case with no `uses_model` edge shows the line — `RegisterDetail.nomodel.cr7.test.tsx` |
| TC-CR7-11e | On the register, a case whose model was linked does not show it (real `addUseCaseModelLink`) — `RegisterDetail.nomodel.cr7.test.tsx` |
| TC-CR7-11f | A case from before model links existed cannot be told apart from "none named", so nothing is claimed — `RegisterDetail.nomodel.cr7.test.tsx` |
| TC-CR7-11g | A model named in a later correction (which writes no link): nothing is claimed — `RegisterDetail.nomodel.cr7.test.tsx` |
| TC-CR7-11h | The link write fails: the case is still saved (no dead end), flagged `model_link_unrecorded`, and the register never claims "No model was named" — `ModelLinkFailure.cr7.test.tsx` |
| TC-CR7-11h-1 | On success the link exists for the saved case; the change of write order loses nothing — `ModelLinkFailure.cr7.test.tsx` |
| TC-CR7-11i | `model_link_unrecorded` means "cannot tell", never "no model was named" — `verdict-view-model.cr7-fx4.test.ts` |
| TC-CR7-11j | The link write and the flag write both reject: the verdict still shows and the case is saved — `ModelLinkFailure.cr7.test.tsx` |

## §14 — The inheritance fold names components in plain words

| ID | Asserts |
|---|---|
| TC-CR7-14 | A firm-account case, with and without a graph, shows the plain platform and supplier names and never `VENDOR-APPROVED-LLM` or `PLAT-CLOUD-LLM`; the reserved-word single-match guard still holds (one test with a graph, named `TC-CR7-14-1`, and one without, `TC-CR7-14-2`) — `VerdictDisplay.cr7-fx4.test.tsx` |

## §25 — The review screen shows whether it replaces something

| ID | Asserts |
|---|---|
| TC-CR7-25 | The processing card shows the row with Yes or No, and the "why these values matter" line carries its consequence — `GraphView.cr7-fx4.test.tsx` |
| TC-CR7-25-1 | The row can be corrected: editing sends a boolean to `onCorrect` — `GraphView.cr7-fx4.test.tsx` |

## §29 — A firm rule and a pack rule sharing an id

| ID | Asserts |
|---|---|
| TC-CR7-29 | When the verdict recorded the pack rule's review text, the pack's plain words show, not the firm's — `verdict-view-model.cr7-fx4.test.ts` |
| TC-CR7-29-1 | When the verdict recorded the firm rule's own review text, the firm's words still show — `verdict-view-model.cr7-fx4.test.ts` |

## §30 (wave 2) — Correction values on the register read plainly

| ID | Asserts |
|---|---|
| TC-CR7-30b | A null original value reads "not stated" — `RegisterDetail.cr7-fx4.test.tsx` |
| TC-CR7-30b-1 | An absent original value (an old record, or a JSON round trip that dropped `undefined`) reads "not stated", not "undefined" — `RegisterDetail.cr7-fx4.test.tsx` |
| TC-CR7-30b-2 | Real values, including 0 and false, still show as themselves — `RegisterDetail.cr7-fx4.test.tsx` |

## §35 (wave 2) — The reviewer section names a model by its plain name

| ID | Asserts |
|---|---|
| TC-CR7-35e | The model-governance review line reads with the model's plain name everywhere it is printed; the raw id appears only inside a quiet `<code>` — `VerdictDisplay.cr7-fx4.test.tsx` |
| TC-CR7-35e-1 | A model the policy does not list is shown as written, since there is nothing to translate — `VerdictDisplay.cr7-fx4.test.tsx` |

## §36 — The About page counts what the app ships with

| ID | Asserts |
|---|---|
| TC-CR7-36 | The sentence carries the shipped file's hard-line count and appetite-rule count — `About.cr7-fx4.test.tsx` |
| TC-CR7-36-1 | A firm edit to its own policy (fewer rules) does not change what the page says it ships with — `About.cr7-fx4.test.tsx` |

## §37 (wave 2) — The policy-problem sentence has one home

| ID | Asserts |
|---|---|
| TC-CR7-37-place | `POLICY_PROBLEM_MESSAGE` lives in `plain-copy.ts` as one plain sentence; `IntakeFlow.tsx` imports it and keeps no copy — `ContradictionReview.cr7-fx4.test.tsx` |

## §39 — "Could still change" says when regulatory text is overdue

| ID | Asserts |
|---|---|
| TC-CR7-39 | `stale_sources` non-empty adds a "Could still change" line about overdue regulatory text — `verdict-view-model.cr7-fx4.test.ts` |
| TC-CR7-39-1 | No stale sources (absent or empty): no overdue line (the false case) — `verdict-view-model.cr7-fx4.test.ts` |
| TC-CR7-39-2 | On the screen, "Could still change" carries the overdue line when `stale_sources` is set, and not when it is empty — `VerdictDisplay.cr7-fx4.test.tsx` |

## §40 — The checklist says what "verified" means

| ID | Asserts |
|---|---|
| TC-CR7-40 | The sign-off checklist says "marked verified in your firm's policy file" — `VerdictDisplay.cr7-fx4.test.tsx` |

## FX7-4 — Review-pass guards

| ID | Asserts |
|---|---|
| TC-FX7-4-MODEL-1 | A family member, an exact entry and an unlisted id resolve on this screen exactly as the engine resolves them — `verdict-view-model.cr7-fx4.test.ts` |
| TC-FX7-4-MODEL-2 | The view model calls the engine's `resolveApprovedModel` and keeps no copy of the rule — `verdict-view-model.cr7-fx4.test.ts` |
| TC-FX7-4-O9 | On the contradiction screen the reassurance says this is not a result yet, and never "nothing is wrong" — `ContradictionReview.cr7-fx4.test.tsx` |

## Amended existing cases (wave 2)

These cases keep their ids. Their assertions changed because they pinned the old behaviour; each change is a deliberate part of this round, not a weakening.

| ID | What changed |
|---|---|
| TC-R12-BD-1-02 | Was: a field with no quote and not guessed, rendered with no `provenance` prop, shows "Not in your description — please check this". Now: the test passes `provenance={{}}`, a real extraction with nothing quoted, because with no `provenance` prop at all (an older draft) the screen no longer makes that claim (TC-CR7-02h) — `GraphView.r12.test.tsx` |
| TC-R16-E-44 | Was: a confident-but-unquoted field reads "Not in your description — please check this", rendered with no `provenance` prop. Now: the test passes `provenance={{}}` for the same reason — `GraphView.r16e.test.tsx` |
| TC-CR6-11 | Was: the combined entry named the platform and supplier by their raw registry ids. Now: it shows their plain names and never the ids (CR7-14) — `VerdictDisplay.cr6-fx4.test.tsx` |
| TC-CR6-11b | Was: the unlisted supplier is named by its raw id. Now: it reads "a supplier not on your firm's list", never the raw id (CR7-14) — `VerdictDisplay.cr6-fx4.test.tsx` |
| TC-CR6-11c | Was: the unlisted supplier is named by its raw id. Now: it reads "a supplier not on your firm's list" (CR7-14) — `VerdictDisplay.cr6-fx4.test.tsx` |
| TC-RG-9-04 | Was: the checklist read "evidence: N machine-verified, …". Now: it reads "N marked verified in your firm's policy file" (CR7-40) — `VerdictDisplay.cr005.test.tsx` |
| (control-evidence checklist, no TC id) | Was: "0 machine-verified". Now: "0 marked verified in your firm's policy file" (CR7-40) — `RegisterDetail.controlEvidence.test.tsx` |
| (verdict-view-model fixture `makePolicy`) | Was: `tier_workflow` values `'x'`. Now: `'self-service'`, because the sign-off derivation now reads `tier_workflow` (CR7-09) and an unknown value fails safe to "needs sign-off", which the fixture's tests did not mean — `verdict-view-model.test.ts` |

## Superseded

| ID | Reason |
|---|---|
| TC-CR7-01a-1 | Superseded by R18-GI-10 (R18-A): restarting a model extraction on a restored description draft is gone. Reload at each step is TC-R18-GI-9-01 and -02. No replacement — behaviour retired. |
| TC-CR7-01b | Superseded by R18-GI-10 (R18-A): a restored draft whose extraction fails (the Try again panel) is gone with the extraction. No replacement — behaviour retired. |
| TC-CR7-01c | Superseded by R18-GI-10 (R18-A): the extractor is never called from a fresh description now. No replacement — behaviour retired. |
| TC-CR7-03b | Superseded by R18-GI-10 (R18-A): a model-guessed supplier that must not reach the result no longer exists. The questions-step Back round trip is TC-CR7-03a and TC-CR7-03d. No replacement for the guess — behaviour retired. |
| TC-CR7-03c | Superseded by R18-GI-10 (R18-A): a model-declared model guess that must not reach the result no longer exists. The questions-step Back round trip is TC-CR7-03a and TC-CR7-03d. No replacement for the guess — behaviour retired. |
| TC-CR7-21b | Superseded by R18-GI-10 (R18-A): the description-path correction and retry is unreachable. The same once-only trail guarantee on the form route is TC-CR7-21a in IntakeFlow.cr7-fx1.test.tsx. |
| TC-CR7-28-5 | Superseded by R18-NF-5 (R18-A): loadDraftInfo no longer migrates an earlier draft, so its 'migrated' flag is always false; the screen's sentence comes from earlierVersionNotice (TC-R18-NF-5-01). |
| TC-CR7-28-6 | Superseded by R18-NF-5 (R18-A): no questionnaire draft is migrated now, form path or not. An earlier-version one opens the form with the description kept (TC-R18-NF-5-01) and a version-4 one restores as it is (TC-CR6-04a in IntakeFlow.cr6-fx2.test.tsx). |
| TC-CR7-28-8 | Superseded by R18-NF-5 (R18-A): there is no migrated card review to keep assumptions and the uncertain list on; an earlier draft carries no answers (TC-R18-NF-5-01). No replacement — behaviour retired. |
| TC-CR7-28b-2 | Superseded by R18-NF-5 (R18-A): the rule that a version-2 form draft or one with a back snapshot is not migrated is replaced by the one rule that no earlier-version draft is migrated (TC-R18-NF-5-01, -02). |
| TC-CR7-28-4 | Superseded by R18-NF-5 (R18-A): a bare version-1 questions draft no longer returns to the card review; it opens the form with the description kept and no answers (TC-R18-NF-5-01). |
| TC-CR7-28b-1 | Superseded by R18-NF-5 (R18-A): the current draft version is 4, and a version-2 draft is handled like every earlier one (opens the form, description kept: TC-R18-NF-5-01, -02). |
| TC-CR7-01a-2 | Superseded by R18-GI-10 (R18-A): there is no extractor call to count across a double mount. No replacement — behaviour retired. |