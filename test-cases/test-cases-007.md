# Counterpoise — Test Cases, Round 7

*Written 2026-08-17 alongside the build (v0.8.0) from
`requirements/requirements-007.md`. Every case exists in the suite and
carries its id in the covering test's title — traceability 100% at birth.*

Test file: `src/components/__tests__/GraphReview.r7.test.tsx` (flow +
reducer), plus the updated GRAPH_EXTRACTED expectation in
`src/components/intake-state.test.ts`.

| ID | Asserts | Notes |
|---|---|---|
| TC-R7-JC-1-01 | The hallucinated code renders named ("United States (US)"), framed as model-proposed, pre-checked | Fixture is sweep-001's real hallucination |
| TC-R7-JC-2-01 | Proceed refuses with a plain-English message until jurisdictions confirmed; confirming opens it | |
| TC-R7-JC-2-02 | Reducer refuses QUESTIONS_GENERATED while unconfirmed (defense in depth) | |
| TC-R7-JC-2-03 | Form path (no flag) is not gated | R3-JU already covers it explicitly |
| TC-R7-JC-3-01 | Unchecking the hallucinated code confirms implicitly and opens Proceed | Edit-is-confirmation, ADR-IF-R5-1 rule |
| TC-R7-JC-3-02 | JURISDICTIONS_SET replaces the list, appends a versioned correction (node ref `graph`), confirms | |

R7-NF-1 is held by TC-PE-1-01 unchanged and the suite-wide reserved-words
guard.

## Superseded

| ID | Reason |
|---|---|
| TC-R7-JC-1-01 | Superseded by R18-GI-10 (R18-A): a model-proposed, pre-ticked country no longer exists; the form's countries start unticked. The form's own country ticking is proved by TC-CR7-02c-edit and TC-CR8-08b. No replacement for the model-proposed case — behaviour retired. |
| TC-R7-JC-3-01 | Superseded by R18-GI-10 (R18-A): unticking a model-proposed country confirmed it implicitly on the card review, which is unreachable. No replacement — behaviour retired. |
| TC-R7-JC-2-01 | Superseded by R18-GI-10 (R18-A): the card review's refusal to proceed until the countries were confirmed is unreachable; on the form the person ticks countries themselves and is never asked to confirm a model's. No replacement — behaviour retired. |