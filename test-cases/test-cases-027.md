# Counterpoise — Test Cases, Round MODEL-NAMES (plain names for the approved models)

*Written 2026-10-03. CR6-19 gave `ApprovedModel` an optional `plain_name` and made
the description-path model buttons and the questionnaire's "Recorded" line show
`plain_name ?? model_id`, but the two shipped entries had no plain name, so a raw
id (`VENDOR-LLM-v1`, `qwen3:4b`) still reached a button. The owner approved the
text on 2026-10-03; policy 1.8 -> 1.9 adds it (presentation text only; the
backtest is unchanged apart from its version string). Every model entry that is
not a family entry renders as a button, approved or not, so the local model's
name is used wherever it can render.*

Test file: `src/components/__tests__/QuestionnaireStep.mn.test.tsx`.

## §1 — The shipped models carry plain names

| ID | Asserts |
|---|---|
| TC-MN-01 | Every non-family `approved_models` entry in the real `policy/appetite.yaml` has a `plain_name` |
| TC-MN-02 | Rendering the real policy, the description-path model question shows "A licensed AI model from an outside company (example)" and no button is labelled with `VENDOR-LLM-v1` |
| TC-MN-03 | The unapproved local model also renders as a button, under "A small open model running on your own computer", and the "Recorded" line uses that name, never `qwen3:4b` |
| TC-MN-04 | Neither plain name contains the words "approved" or "rejected" (the verdict-screen single-match query) |
| TC-MN-05 | The review screen names a declared model by the same plain name the button used (real policy: `qwen3:4b` → "A small open model running on your own computer"), never the raw id — found in the MODEL-NAMES review |
| TC-MN-05b | A model id the policy does not list is shown on the review screen as written |

## Amended existing cases

| ID | What changed |
|---|---|
| TC-R17-PV-04 | The shipped policy version is now 1.9 (was 1.8) — `evaluate.test.ts` |
| TC-R16-A2-11 | The shipped policy version is now 1.9 (was 1.8) — `plain-language-coverage.test.ts` |

## Superseded

| ID | Reason |
|---|---|
| TC-MN-05 | Superseded by R18-GI-10 (R18-E): a declared model's plain name on the review row belonged to `GraphView`, the card review's screen, which is deleted. No replacement — behaviour retired. |
| TC-MN-05b | Superseded by R18-GI-10 (R18-E): an unlisted model id shown as written on the review row belonged to `GraphView`, the card review's screen, which is deleted. No replacement — behaviour retired. |
