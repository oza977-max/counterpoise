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
| TC-R7-JC-1-01 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |
| TC-R7-JC-3-01 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |

| TC-R7-JC-2-01 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |