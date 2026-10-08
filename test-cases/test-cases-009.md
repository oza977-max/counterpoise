# Counterpoise — Test Cases, Round 9

*Written 2026-08-17 alongside the build (v0.10.0) from
`requirements/requirements-009.md`. Traceability 100% at birth.*

Test file: `src/components/__tests__/GraphReview.r9.test.tsx`, plus amended
assertions in GraphReview.r5 (TC-R5-GR-1-01, criterion amendment applied),
GraphReview.r6 (badge wording) and WalkingSkeleton (labels now legitimately
appear twice — card + checklist).

| ID | Asserts |
|---|---|
| TC-R9-SC-1-01 | Checklist lists exactly the outstanding obligations (guessed fixes, confirms, jurisdictions); completing one removes its line |
| TC-R9-SC-1-02 | Zero obligations renders the done state |
| TC-R9-SC-3-01 | Uncertainty + guesses + advisory warning = exactly one warn-styled alarm, one quiet badge, one advisory note (role=note, not alert) |
| TC-R9-SC-4-01 | Guessed card offers "Fix guessed values" opening its editor; still no plain confirm (ADR-IF-R6-2 held) |
| TC-R9-SC-4-02 | Jurisdictions precede similar-cases in DOM order |

R9-SC-2's amended criterion is held by the amended TC-R5-GR-1-01 (meanings
by default, consequences after one click). R9-SC-5's collapsed rendering is
covered by TC-R9-SC-4-02's collapse handling plus the unchanged R8
component tests (the full panel renders inside the disclosure). R9-NF-1/2
are held by the unchanged R5–R8 gate/guard suites, the suite-wide
reserved-words guard, and TC-R3-NF-2-01's no-write pattern.

## Superseded

| ID | Reason |
|---|---|
| TC-R9-SC-1-01 | Superseded by R18-GI-10 (R18-A): the review screen's checklist of outstanding obligations (guessed fixes, confirms, countries) is unreachable. The description screen's mentioned or not mentioned checklist is a different thing (TC-R18-GI-1-01..09). No replacement — behaviour retired. |
| TC-R9-SC-4-02 | Superseded by R18-GI-10 (R18-A): the review screen's order of countries and similar cases is unreachable (similar cases now come before the form). No replacement — behaviour retired. |
| TC-R9-SC-1-02 | Superseded by R18-GI-10 (R18-A): the review screen's done state for zero outstanding obligations is unreachable. No replacement — behaviour retired. |