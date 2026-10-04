# Counterpoise — Test Cases, Round CR8 (code review 008 fixes)

*Written 2026-10-04. Code review 008 found places where the screens said more than the code could prove or less than it did: a review-card edit left a stale "Not sure" disclosure behind, Back could still walk out of an attested case through the confirmation step, a result with no stage claimed nobody had to sign off, the audit chain was described as revealing every deletion, a model-review sentence was garbled, the "overdue" line counted packs the result never used, and a few stores could write twice or half a seed. The amended spec sections are marked "(CR8, 2026-10-04)" in `specs/intake-flow`, `specs/verdict-audit`, `specs/register-lifecycle` and `specs/cross-cutting`.*

Test files: `src/components/intake-state.test.ts`,
`src/components/__tests__/IntakeFlow.cr7-fx1.test.tsx`,
`src/components/__tests__/ConfirmationStep.test.tsx`,
`src/components/verdict-view-model.cr8-fx3.test.ts`,
`src/components/__tests__/VerdictDisplay.cr8-fx3.test.tsx`,
`src/components/__tests__/RegisterDetail.cr8-fx3.test.tsx`,
`src/components/__tests__/SettingsPanel.cr8.test.tsx`,
`src/components/__tests__/App.r16a1.test.tsx`, `src/components/__tests__/IntakeFlow.r16a1.test.tsx`,
`src/components/__tests__/IntakeFlow.r16f.test.tsx`,
`src/components/__tests__/app-css.cr8-fx3.test.ts`,
`src/store/cr8-store.test.ts`, `src/seeds/cr8-seed-recovery.test.ts`.

## §1 — A card edit removes the "Not sure" assumptions it contradicts (CR8-01; amended CR9: drops, no longer narrows)

| ID | Asserts |
|---|---|
| TC-CR8-01a | Change an answer, edit the assumed field's card, Confirm: that assumption is gone from what the confirmation carries, and so from the recorded confirmation and the result — `intake-state.test.ts` |
| TC-CR8-01b | The same after a failed evaluation — `intake-state.test.ts` |
| TC-CR8-01c | The same for a correction from the result (`CORRECT_VERDICT`) — `intake-state.test.ts` |
| TC-CR8-01d | A countries edit keeps the "somewhere else, or not sure" assumption, because the panel cannot say "somewhere else", and leaves the other assumptions as they were — `intake-state.test.ts` |
| TC-CR8-01e | An edit to a different field keeps the assumption, with its fields untouched — `intake-state.test.ts` |
| TC-CR8-01f | A question-6 assumption plus one autonomy edit: the whole assumption is dropped, none of its other three fields stays listed (amended CR9; this row used to say the other three fields stay listed) — `intake-state.test.ts` |
| TC-CR8-01g | A question-3 assumption plus a supplier edit: the whole assumption is dropped, the data-zone field is no longer listed (amended CR9; this row used to say the data-zone field stays listed) — `intake-state.test.ts` |
| TC-CR8-01h | An assumption from an older draft that lists no fields cannot be matched, so any card edit drops it — `intake-state.test.ts` |
| TC-CR8-01i | Not sure, Change an answer, edit the assumed field's card, Confirm: the recorded confirmation on the real trail carries no assumption for that field — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR8-01j | A different assumption that lists the countries field is dropped by a countries edit; only question 11 is exempt (amended CR9; this row used to say it is narrowed) — `intake-state.test.ts` |

## §2 — Sign-off is only claimed where it can be determined (CR8-02)

| ID | Asserts |
|---|---|
| TC-CR8-02a | A required sign-off with none on record (past "pre-checked", no approving review): no next step says "you can start" — `verdict-view-model.cr8-fx3.test.ts` |
| TC-CR8-02b | No valid policy and a stage past "pre-checked": no "you can start" and no "nobody" anywhere — `verdict-view-model.cr8-fx3.test.ts` |
| TC-CR8-02c | No stage at all (the intake result before the save lands): no sign-off claim on any surface — `verdict-view-model.cr8-fx3.test.ts` |
| TC-CR8-02d | A determined self-service case (explicit stage plus a self-service policy) still says it can start — `verdict-view-model.cr8-fx3.test.ts` |
| TC-CR8-02e | A signed-off case is unaffected by a missing policy or stage, because the audit trail alone decides — `verdict-view-model.cr8-fx3.test.ts` |
| TC-CR8-02f | Stage "approved" with no policy: the stage note, headline and who-signs-off line say nothing permissive — `VerdictDisplay.cr8-fx3.test.tsx` |
| TC-CR8-02g | No stage at all: nothing on the screen says the person can start or that nobody signs off — `VerdictDisplay.cr8-fx3.test.tsx` |
| TC-CR8-02h | Stages idea, exploring and retired make no sign-off claim even with a self-service policy — `VerdictDisplay.cr8-fx3.test.tsx` |
| TC-CR8-02i | Stages idea, exploring and retired make no sign-off claim; approved, in production and monitored may — `verdict-view-model.cr8-fx3.test.ts` |
| TC-CR8-02j | The can't-be-determined headline opens "Not yet confirmed." — `verdict-view-model.cr8-fx3.test.ts` |

## §3 — Back stays refused after a failed evaluation, through the confirmation (CR8-03)

| ID | Asserts |
|---|---|
| TC-CR8-03a | Confirmed, evaluation fails, no questions, Continue to the confirmation, Change an answer, Back: refused — `intake-state.test.ts` |
| TC-CR8-03b | On screen: failed evaluation, Continue, Change an answer: Back is not offered, and the case id is the same on the second Confirm — `IntakeFlow.cr7-fx1.test.tsx` |
| TC-CR8-03c | The converse: a first-time confirmation (no failure), Change an answer, Back is allowed, because nothing is attested yet — `intake-state.test.ts` |
| TC-CR8-03d | Over every step and action, from a state after a confirmed attestation, on a description graph and on a form graph: no sequence of actions other than Start over reaches the duplicate check or changes the case id — `intake-state.test.ts` |

## §4 — The audit chain: what is claimed and what is detectable (CR8-04)

| ID | Asserts |
|---|---|
| TC-CR8-04a | The confirmation notice no longer says a later change would show; it says an edit to an earlier entry would show, removing the newest entries would not, and there is no outside check — `ConfirmationStep.test.tsx` |
| TC-CR8-04b | Deleting the newest event leaves a chain that still verifies (the known limit, pinned) — `cr8-store.test.ts` |
| TC-CR8-04c | The register banner says only that no break was found in the events present, and the caveat names what cannot be detected — `RegisterDetail.cr8-fx3.test.tsx` |
| TC-CR8-04d | The register detail, the result's reviewer section and the About page carry no over-claim — `RegisterDetail.cr8-fx3.test.tsx` |

## §5 — The correction planner reads the latest value written so far (CR8-06)

| ID | Asserts |
|---|---|
| TC-CR8-06a | A trail holding A to B and a batch [B to C, C to B]: both are written, the net value is B and the count is 3 — `intake-state.test.ts` |
| TC-CR8-06b | A plain form-path retry that re-mints A to B over a trail whose latest value is B is still skipped — `intake-state.test.ts` |
| TC-CR8-06c | Over random sequences of edits, retries and reversals on one field, the net value on the trail always equals the graph value — `intake-state.test.ts` |

## §6 — The audit tip hint is checked against the stored tip (CR8-07)

| ID | Asserts |
|---|---|
| TC-CR8-07 | A hint taken at the same event count but over a different trail is not trusted — `cr8-store.test.ts` |
| TC-CR8-07b | Known limit: tampering that deletes an earlier event and then appends is not detected by the tip hint — `cr8-store.test.ts` |

## §7 — Correct from the result shows the countries panel (CR8-08)

| ID | Asserts |
|---|---|
| TC-CR8-08a | `CORRECT_VERDICT` lands on a review whose countries are already checked, as Change an answer and a failed evaluation already do — `intake-state.test.ts` |
| TC-CR8-08b | Correct from the result: the countries panel renders and a country can be ticked, recorded as a countries correction on the corrected verdict — `IntakeFlow.cr7-fx1.test.tsx` |

## §8 — Overlapping policy saves queue a case once (CR8-09)

| ID | Asserts |
|---|---|
| TC-CR8-09 | Two policy-update calls in flight together queue each case once — `cr8-store.test.ts` |

## §9 — A half-seeded case is completed, not repeated (CR8-10)

| ID | Asserts |
|---|---|
| TC-CR8-10a | Events written but no register row: re-seeding writes only the missing rows, no second set of events — `cr8-seed-recovery.test.ts` |
| TC-CR8-10b | The investment-bank portfolio recovers the stage its own scripted 2LoD events imply; an approved case stays approved — `cr8-seed-recovery.test.ts` |
| TC-CR8-10c | A case with events but no verdict is skipped and reported, and nothing is written — `cr8-seed-recovery.test.ts` |
| TC-CR8-10d | The self-assessment recovers its node, vendor, edge and model link without a second set of events — `cr8-seed-recovery.test.ts` |
| TC-CR8-10e | The use-case node is written last, so a run interrupted before it is completed by the next with no duplicate rows — `cr8-seed-recovery.test.ts` |
| TC-CR8-10f | Recovery points the node at the latest verdict, so a later corrected verdict wins — `cr8-seed-recovery.test.ts` |

## §10 — The model-governance review sentence is one whole, true sentence (CR8-11)

| ID | Asserts |
|---|---|
| TC-CR8-11 | The shipped local model (listed, not yet accepted) reads as one whole sentence at every place that prints it — `VerdictDisplay.cr8-fx3.test.tsx` |
| TC-CR8-11-1 | A model the policy does not list says so, by the name as typed — `VerdictDisplay.cr8-fx3.test.tsx` |
| TC-CR8-11-2 | The rejected-screen copy prints the same rewritten sentence — `VerdictDisplay.cr8-fx3.test.tsx` |
| TC-CR8-11-3 | A family whose attestation has lapsed reads with the neutral wording, never "not current" — `VerdictDisplay.cr8-fx3.test.tsx` |
| TC-CR8-11-4 | An entry the firm has since accepted reads with the neutral wording, never "not current" — `VerdictDisplay.cr8-fx3.test.tsx` |

## §11 — The header tagline is readable (CR8-12)

| ID | Asserts |
|---|---|
| TC-CR8-12 | The header tagline chip is at least 4.5 to 1 against the header background — `app-css.cr8-fx3.test.ts` |
| TC-CR8-12-1 | The header text and the muted header colour are each at least 4.5 to 1 against the header background — `app-css.cr8-fx3.test.ts` |

## §12 — The policy banner shows raw field paths only to whoever can fix the file (CR8-13)

| ID | Asserts |
|---|---|
| TC-CR8-13 | A 1LoD submitter sees the plain message in the banner list, not the raw field path — `App.r16a1.test.tsx` |

## §13 — The failed-evaluation alert (CR8-14)

| ID | Asserts |
|---|---|
| TC-CR8-14 | The alert keeps its prefix and the policy sentence, and no longer tells the person to check the details and try again — `IntakeFlow.cr7-fx1.test.tsx` |

## §14 — Clear all data names everything (CR8-16)

| ID | Asserts |
|---|---|
| TC-CR8-16a | The confirmation names the role, hand-off record, welcome flag and drafts it clears, and what it keeps — `SettingsPanel.cr8.test.tsx` |
| TC-CR8-16b | The incomplete message names the same cleared items and says a blocked delete may still complete — `SettingsPanel.cr8.test.tsx` |
| TC-CR8-16c | The browser-storage keys the reset clears are exactly the ones the messages name — `SettingsPanel.cr8.test.tsx` |

## §15 — The overdue regulatory line counts only packs the result used (CR8-17)

| ID | Asserts |
|---|---|
| TC-CR8-17 | A stale pack the result did not use: no overdue line — `verdict-view-model.cr8-fx3.test.ts` |
| TC-CR8-17-1 | A stale pack the result used: the line is shown — `verdict-view-model.cr8-fx3.test.ts` |
| TC-CR8-17-2 | A legacy result with no record of packs used: no overdue line, since nothing says a pack was used — `verdict-view-model.cr8-fx3.test.ts` |
| TC-CR8-17-3 | Two stale packs, one used: only the used one is named; a legacy result shows no banner — `VerdictDisplay.cr8-fx3.test.tsx` |
| TC-CR8-17-4 | The record names pack A while the stale source is pack B: no overdue line — `verdict-view-model.cr8-fx3.test.ts` |

## Amended existing cases

These cases keep their ids. Their assertions or fixtures changed because they pinned the old behaviour; each change is a deliberate part of this round, not a weakening.

| ID | What changed |
|---|---|
| TC-R16-D1-01e | Were built on a case with no stage or no valid policy and read "you can start" or "no sign-off needed". Now re-fixtured with an explicit stage and a self-service policy where the case is meant to be self-service, and the wording is cautious where the case cannot be determined (CR8-02) — `verdict-view-model.test.ts` (01e, 01g, 01i, 09b, 08a), `VerdictDisplay.r16d1.test.tsx` (13) |
| TC-R16-D1-01g | Were built on a case with no stage or no valid policy and read "you can start" or "no sign-off needed". Now re-fixtured with an explicit stage and a self-service policy where the case is meant to be self-service, and the wording is cautious where the case cannot be determined (CR8-02) — `verdict-view-model.test.ts` (01e, 01g, 01i, 09b, 08a), `VerdictDisplay.r16d1.test.tsx` (13) |
| TC-R16-D1-01i | Were built on a case with no stage or no valid policy and read "you can start" or "no sign-off needed". Now re-fixtured with an explicit stage and a self-service policy where the case is meant to be self-service, and the wording is cautious where the case cannot be determined (CR8-02) — `verdict-view-model.test.ts` (01e, 01g, 01i, 09b, 08a), `VerdictDisplay.r16d1.test.tsx` (13) |
| TC-R16-D1-09b | Were built on a case with no stage or no valid policy and read "you can start" or "no sign-off needed". Now re-fixtured with an explicit stage and a self-service policy where the case is meant to be self-service, and the wording is cautious where the case cannot be determined (CR8-02) — `verdict-view-model.test.ts` (01e, 01g, 01i, 09b, 08a), `VerdictDisplay.r16d1.test.tsx` (13) |
| TC-R16-D1-08a | Were built on a case with no stage or no valid policy and read "you can start" or "no sign-off needed". Now re-fixtured with an explicit stage and a self-service policy where the case is meant to be self-service, and the wording is cautious where the case cannot be determined (CR8-02) — `verdict-view-model.test.ts` (01e, 01g, 01i, 09b, 08a), `VerdictDisplay.r16d1.test.tsx` (13) |
| TC-R16-D1-13 | Were built on a case with no stage or no valid policy and read "you can start" or "no sign-off needed". Now re-fixtured with an explicit stage and a self-service policy where the case is meant to be self-service, and the wording is cautious where the case cannot be determined (CR8-02) — `verdict-view-model.test.ts` (01e, 01g, 01i, 09b, 08a), `VerdictDisplay.r16d1.test.tsx` (13) |
| TC-R16-A1-62 | Was: any role sees the raw field path in the app-wide policy banner. Now re-scoped to the 2LoD role, who edits the file (CR8-13) — `App.r16a1.test.tsx` |
| TC-R16-A1-63 | Were: the intake alert carried the raw field path. Now: the default view shows the plain policy sentence and the raw path is absent (CR8-13) — `IntakeFlow.r16a1.test.tsx`, `IntakeFlow.r16f.test.tsx` |
| TC-R16-F-59 | Were: the intake alert carried the raw field path. Now: the default view shows the plain policy sentence and the raw path is absent (CR8-13) — `IntakeFlow.r16a1.test.tsx`, `IntakeFlow.r16f.test.tsx` |
| (exact-shape reducer tests, no TC id) | The expected shapes now include `afterFailedEvaluation: false` on the confirmation step and `jurisdictionsConfirmed: true` on the review a correction lands on (CR8-03, CR8-08) — `intake-state.test.ts` |
| TC-CR8-01d | The v2 plan had a countries edit drop the "somewhere else, or not sure" assumption. Corrected: it stays, because the countries panel cannot say "somewhere else", so the disclosure remains true — `intake-state.test.ts` |
| TC-CR7-39 | Their result fixtures now carry a record of the packs used (`pack_versions`), because the overdue line counts only stale sources from those packs (CR8-17) — `verdict-view-model.cr7-fx4.test.ts` (39), `VerdictDisplay.cr7-fx4.test.tsx` (39-2), `VerdictDisplay.r12.test.tsx` (ST-1-01) |
| TC-CR7-39-2 | Their result fixtures now carry a record of the packs used (`pack_versions`), because the overdue line counts only stale sources from those packs (CR8-17) — `verdict-view-model.cr7-fx4.test.ts` (39), `VerdictDisplay.cr7-fx4.test.tsx` (39-2), `VerdictDisplay.r12.test.tsx` (ST-1-01) |
| TC-R12-ST-1-01 | Their result fixtures now carry a record of the packs used (`pack_versions`), because the overdue line counts only stale sources from those packs (CR8-17) — `verdict-view-model.cr7-fx4.test.ts` (39), `VerdictDisplay.cr7-fx4.test.tsx` (39-2), `VerdictDisplay.r12.test.tsx` (ST-1-01) |
