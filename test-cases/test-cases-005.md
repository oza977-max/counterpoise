# Counterpoise — Test Cases, Round 5

*Written 2026-08-16 alongside the build (v0.6.0) from
`requirements/requirements-005.md`. As in round 4, every case already exists
in the suite and carries its id in the covering test's title — traceability
100% at the moment of writing.*

Test files: `src/components/__tests__/GraphReview.r5.test.tsx` (review
screen + reducer + flow), `src/engine/plausibility.test.ts` (warning table),
plus `src/components/intake-state.test.ts` (updated GRAPH_EXTRACTED shape)
and `src/components/__tests__/WalkingSkeleton.test.tsx` (the simulated user
now confirms every card, as a real one must).

| | Count |
|---|---|
| Round-5 test cases | 21 |
| GraphReview.r5 (GR-1/2/3/5, GX-1) | 12 |
| plausibility (GR-4) | 11 tests covering 6 case ids |

## Case index

| ID | Asserts | File |
|---|---|---|
| TC-R5-GR-1-01 | Meanings rendered distinct from raw enums, consequence line per field | GraphReview.r5 |
| TC-R5-GR-1-02 | A changed value shows the changed meaning | GraphReview.r5 |
| TC-R5-GR-1-03 | Absent optional fields render "not stated", never a default | GraphReview.r5 |
| TC-R5-GR-2-01 | Proceed refused with plain-English count until every card confirmed; opens after | GraphReview.r5 |
| TC-R5-GR-2-02 | Review screen states values are proposed, not scored | GraphReview.r5 |
| TC-R5-GR-2-03 | Form path carries no unconfirmed set — no gate, no chrome | GraphReview.r5 |
| TC-R5-GR-2-04 | Reducer refuses QUESTIONS_GENERATED while nodes unconfirmed (defense in depth) | GraphReview.r5 |
| TC-R5-GR-2-05 | NODE_CONFIRMED removes exactly that node | GraphReview.r5 |
| TC-R5-GR-2-06 | A correction confirms the corrected node implicitly | GraphReview.r5 |
| TC-R5-GR-3-01 | Uncertain node: loud alert, its own confirm wording, no en-bloc confirm | GraphReview.r5 |
| TC-R5-GR-4-01a/b … -06 | Each plausibility pair fires on its motivating live fixture, not on neutral text; empty description fires nothing; pairs compose | plausibility |
| TC-R5-GR-5-01 | Hygiene hint at ≥2 processing nodes, absent at 1 | GraphReview.r5 |
| TC-R5-GX-1-01 | Unrecognised jurisdiction dropped from graph and surfaced by name; recognised kept | GraphReview.r5 |

R5-NF-1 is held by the pre-existing determinism test (TC-PE-1-01, unchanged);
R5-NF-3's reserved-words and text-not-markup constraints are held by the
suite-wide single-match guard and the existing [SECURITY] patterns — no new
rendered string here matches `/approved|rejected/i` (verified by suite run).

## Superseded

| ID | Reason |
|---|---|
| TC-R5-GR-2-01 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |
| TC-R5-GX-1-01 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |

| TC-R5-GR-2-02 | Superseded by R18-GI-10 (Round 18, chunk R18-A): the description is no longer read by a model and the card review, questionnaire and extraction are unreachable (one route: describe, then the guided form). The case drove only that retired route; what the form route still owes is proved by the TC-R18-* cases and the rewritten tests that remain. |