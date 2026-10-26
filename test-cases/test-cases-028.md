# Counterpoise — Test Cases, Round UNSIGNED-MODEL (a model the firm lists but has not accepted)

*Written 2026-10-03. The shipped `qwen3:4b` entry is listed in `approved_models`
with `is_approved: false`. Its button, "Recorded" line and review-screen row now
say so in the owner-approved words, and its owed model-registry review reads
"your AI risk team accepting this model" instead of "adding the model to your
firm's list of known models" (the model is already on the list; what is owed is
the firm's acceptance). Presentation only: no engine change, no policy change,
no policy version bump. Code review 007 finding CR7-35 is folded in: a listed
model with no `plain_name` never shows its raw id.*

Test file: `src/components/__tests__/QuestionnaireStep.um.test.tsx` (real `policy/appetite.yaml`, BC-003).

## §1 — The unaccepted model says so

| ID | Asserts |
|---|---|
| TC-UM-01 | `qwen3:4b`'s button and "Recorded" line read "{plain name} — not yet accepted by your firm, so it gets an extra check"; `VENDOR-LLM-v1`'s do not |
| TC-UM-02 | The review-screen row for `qwen3:4b` carries the same label; `VENDOR-LLM-v1` and an unlisted id do not |
| TC-UM-03 | A real `evaluate()` of a case declaring `qwen3:4b` owes "your AI risk team accepting this model", never "adding the model to your firm's list" |
| TC-UM-04 | A case declaring a model id not in the policy still owes "adding the model to your firm's list of known models" |
| TC-UM-05 | The new strings contain neither "approved" nor "rejected" |
| TC-UM-06 | A family-matched model whose family is not (or no longer) accepted — real policy, `gpt-4o-2026-08-01` with the gpt-4o family lapsed — owes "your AI risk team accepting this model", never "adding … to your firm's list" (found in the UNSIGNED-MODEL review) |
| TC-UM-07 | A stored case still owing the model review keeps "accepting this model" after the firm later accepts that model (the screen reads today's policy) |

## Code review 007 — CR7-35

| ID | Asserts |
|---|---|
| TC-CR7-35a | The reference check emits a warning (never an error) naming each non-family `approved_models` entry with no `plain_name`; the real policy gives none; a blank (whitespace-only) `plain_name` is warned about too |
| TC-CR7-35b | With no `plain_name`, the button, "Recorded" line and review row show "Model n" (numbered among the unnamed, in list order, as suppliers are), keep the not-yet-accepted suffix when `is_approved` is false, and never show the raw id |
| TC-CR7-35c | A declared model id not on the list is shown as written (the person typed it) |
| TC-CR7-35d | In a mixed list (named, unnamed, blank-named) only the unnamed are numbered, in list order, and a blank `plain_name` counts as none — never a blank button |

## Amended existing cases

| ID | What changed |
|---|---|
| TC-MN-03 | `qwen3:4b` is `is_approved: false`, so its button, "Recorded" line and review row now read its plain name plus the not-yet-accepted suffix |
| TC-CR6-19 | A listed model with no `plain_name` now shows "Model 1" rather than its raw id (CR7-35b) |
| TC-MN-05 | Same as TC-MN-03, for the review-screen row |
| TC-R16-E-31b | Same as TC-CR6-19: the unnamed model's button reads "Model 1" |

## Superseded

| ID | Why |
|---|---|
| TC-UM-02 | Superseded by R18-GI-10 (R18-E): the review-screen row for `qwen3:4b` belonged to the card review, which is deleted. The label itself is still asserted on the form's model button and "Recorded" line (TC-UM-01, TC-MN-03). |

## Changelog

| Date | Change |
|---|---|
| 2026-10-24 | R18-E review pass 1: TC-UM-02 recorded as Superseded by R18-GI-10. |
