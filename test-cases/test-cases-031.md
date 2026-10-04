# Counterpoise — Test Cases, Round CR9 (code review 009 fixes)

*Written 2026-10-04. Code review 009 found that the verdict screen's "What you need to do" box still read "Nothing." under a headline asking the person to confirm the sign-off, that a part-failed policy save left the app on the old rules, that "No model was named" implied a question the person had skipped, that an incomplete Clear all data left the old role in the header and printed internal database ids, that one of the try-these walkthrough cases was not pinned through the real answer mapping, and that a "Not sure" note could stay listed after the person changed a value it names. The amended spec sections are marked "(CR9, 2026-10-04)" in `specs/intake-flow`, `specs/verdict-audit`, `specs/register-lifecycle`, `specs/cross-cutting` and `specs/policy-schema`.*

Test files: `src/components/__tests__/VerdictDisplay.cr9-fx1.test.tsx`,
`src/components/__tests__/PolicyEditor.cr7.test.tsx`,
`src/components/__tests__/VerdictDisplay.cr7-fx4.test.tsx`,
`src/components/__tests__/App.cr9-fx1.test.tsx`,
`src/components/__tests__/SettingsPanel.cr8.test.tsx`,
`src/components/__tests__/SettingsPanel.cr7.test.tsx`,
`src/engine/try-these.test.ts`, `src/components/intake-state.test.ts`.

## §1 — A missing or unknown sign-off is said on every verdict-screen surface (CR9-02)

| ID | Asserts |
|---|---|
| TC-CR9-02a | A Medium case at stage "approved" with no audit events and no controls: the "What you need to do" box does not open with "Nothing." alone and carries the sentence asking the person to confirm the sign-off with their AI risk team — `VerdictDisplay.cr9-fx1.test.tsx` |
| TC-CR9-02b | No stage at all: the box carries the "we can't tell yet whether your AI risk team must sign this off" sentence — `VerdictDisplay.cr9-fx1.test.tsx` |
| TC-CR9-02c | A missing sign-off with controls to put in place: the "Then" group has a second-line sign-off row worded as the shared confirm sentence, not the pre-check text "above the self-service threshold" — `VerdictDisplay.cr9-fx1.test.tsx` |
| TC-CR9-02d | The whole screen is rendered for signed off, needs a sign-off now, missing, unknown and determined self-service, each with 0 and with 1 control, and its full text swept: for missing and unknown nothing says "you can start", "Nothing." on its own, "no sign-off needed" or "nobody —"; for determined self-service the permissive wording is still there — `VerdictDisplay.cr9-fx1.test.tsx` |
| TC-CR9-02e | A case at stage "in production" with a missing or unknown sign-off: the stage note says the sign-off is not on record or not known, instead of only "in production" — `VerdictDisplay.cr9-fx1.test.tsx` |

## §2 — A part-failed policy save tells the app about the stored rules (CR9-03)

| ID | Asserts |
|---|---|
| TC-CR9-03 | Saving the policy when queuing the re-evaluations fails: the "did not finish" message is shown and the app is told about the saved rules exactly once, so the header and new pre-checks use them at once — `PolicyEditor.cr7.test.tsx` |

## §3 — The no-model sentence is neutral (CR9-04)

| ID | Asserts |
|---|---|
| TC-CR9-04 | A form case built in the firm, with no model recorded, shows "No AI model is recorded for this use case — your AI risk team may ask which one it uses." and never the old "No model was named" nor any "was named" wording — `VerdictDisplay.cr7-fx4.test.tsx` |

## §4 — Clear all data ending incomplete (CR9-13, CR9-14)

| ID | Asserts |
|---|---|
| TC-CR9-13 | Role 2LoD, Clear all data ends incomplete: the header's role selector shows 1LoD at once and the message says the role was cleared — `App.cr9-fx1.test.tsx` |
| TC-CR9-13-1 | The same on a reviewer-only screen: the incomplete reset falls back to the intake screen rather than leaving it open under 1LoD — `App.cr9-fx1.test.tsx` |
| TC-CR9-14 | Both the audit and register stores report incomplete: the message names "your audit trail" and "your register of use cases" and prints no `aigate-` database id — `SettingsPanel.cr8.test.tsx` |

## §5 — Try-these cases are pinned through the real answer mapping (CR9-15)

| ID | Asserts |
|---|---|
| TC-CR9-15a | Case 7, driven from the page's plain answers through the real mapping, graph build and evaluation: High tier, nothing inherited, exactly 6 controls and both downstream reviews — `try-these.test.ts` |
| TC-CR9-15b | Case 10 the same way: Critical, Track II, bound by autonomy, 7 controls, both downstream reviews, and a provisional verdict — `try-these.test.ts` |

## §6 — A card edit drops the whole "Not sure" assumption it contradicts (OB-1)

| ID | Asserts |
|---|---|
| TC-CR9-OB1 | A four-field question-6 assumption is gone after an autonomy edit; an edit to an unrelated field leaves every assumption whole — `intake-state.test.ts` |

## Amended existing cases

These cases keep their ids. Their assertions or fixtures changed because they pinned the old behaviour; each change is a deliberate part of this round, not a weakening.

| ID | What changed |
|---|---|
| TC-CR7-06b | A failing queuing step used to assert the app was NOT told about the saved policy; it now asserts it is told exactly once, because the rules are stored (CR9-03) — `PolicyEditor.cr7.test.tsx` |
| TC-CR7-11a | The sentence it looks for is now "No AI model is recorded for this use case — …" (CR9-04) — `VerdictDisplay.cr7-fx4.test.tsx` |
| TC-CR7-11b | Same: the absent-case guard is re-pointed at the new sentence and its class, so it cannot pass vacuously (CR9-04) — `VerdictDisplay.cr7-fx4.test.tsx` |
| TC-CR7-11c | Same (CR9-04) — `VerdictDisplay.cr7-fx4.test.tsx` |
| TC-CR7-11d | Same: the register's no-link case shows the new sentence (CR9-04) — `RegisterDetail.nomodel.cr7.test.tsx` |
| TC-CR7-11e | Same: the guard for a linked model is re-pointed at the new sentence and its class (CR9-04) — `RegisterDetail.nomodel.cr7.test.tsx` |
| TC-CR7-11f | Same: an old case that cannot be told apart claims nothing (CR9-04) — `RegisterDetail.nomodel.cr7.test.tsx` |
| TC-CR7-11g | Same: a model named in a later correction claims nothing (CR9-04) — `RegisterDetail.nomodel.cr7.test.tsx` |
| TC-CR7-11h | Same: after a failed link write the register never says the new sentence (CR9-04) — `ModelLinkFailure.cr7.test.tsx` |
| TC-CR7-11i | Its title now says "never 'no AI model is recorded'" instead of "never 'no model was named'"; the assertion is unchanged (CR9-04) — `verdict-view-model.cr7-fx4.test.ts` |
| TC-CR8-16b | The incomplete message now names the stores in plain words, not database ids (CR9-14) — `SettingsPanel.cr8.test.tsx` |
| TC-CR7-15-3 | The incomplete message now reads "your audit trail" where it used to print "aigate-audit (blocked)", and no database id appears (CR9-14) — `SettingsPanel.cr7.test.tsx` |
| TC-CR8-02a | A required sign-off with none on record: the next step is checked against the shared confirm wording, "confirm with them before you start" (CR9-02) — `verdict-view-model.cr8-fx3.test.ts` |
| TC-CR8-01d | Extended: a countries edit keeps the question-11 assumption and now also drops another assumption that lists the countries field (CR9, OB-1) — `intake-state.test.ts` |
| TC-CR8-01f | A question-6 assumption plus one autonomy edit now drops the whole assumption instead of keeping the other three fields (CR9, OB-1) — `intake-state.test.ts` |
| TC-CR8-01g | A question-3 assumption plus a supplier edit now drops the whole assumption instead of keeping the data-zone field (CR9, OB-1) — `intake-state.test.ts` |
| TC-CR8-01j | A different assumption that lists the countries field is now dropped by a countries edit, not narrowed; question 11 stays (CR9, OB-1) — `intake-state.test.ts` |
| (unnamed test, no TC id: "says plainly when there is nothing to do at all") | With no controls and no reviews and no stage, the box now opens "Nothing to put in place" (the sign-off is unknown) instead of "Nothing." (CR9-02) — `VerdictDisplay.test.tsx` |
