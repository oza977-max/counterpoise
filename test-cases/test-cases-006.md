# Counterpoise — Test Cases, Round 6

*Written 2026-08-16 alongside the build (v0.7.0) from
`requirements/requirements-006.md`. Every case exists in the suite and
carries its id in the covering test's title — traceability 100% at birth.*

Test files: `src/components/__tests__/GraphReview.r6.test.tsx` (quote gate,
review rendering, questions, write-back, end-to-end), plus updated
`graph-extractor.test.ts` (GraphExtraction shape) and `QuestionnaireStep`
behaviour exercised in the flow test.

| | Count |
|---|---|
| Round-6 test cases | 9 |

## Case index

| ID | Asserts | Notes |
|---|---|---|
| TC-R6-PV-1-01 | Verified quotes returned as provenance; graph carries no basis_quotes | ADR-IF-R6-1 |
| TC-R6-PV-2-01 | A fabricated quote (absent from the description) demotes the field to guessed; the quote is discarded | The substring check is the feature |
| TC-R6-PV-2-02 | An empty quote demotes to guessed | |
| TC-R6-PV-2-03 | Matching is case-/whitespace-insensitive; fully quoted nodes have no guessed entry | |
| TC-R6-PV-3-01 | Review renders "based on: …" for quoted fields, a distinct guessed marker otherwise | |
| TC-R6-PV-4-01 | A card with a guessed field renders no plain confirm action | ADR-IF-R6-2 |
| TC-R6-QN-1-01 | A guessed field yields its targeted question with canonical options; quoted fields yield none | |
| TC-R6-QN-1-02 | An answer differing from the graph applies as a correction on questionnaire state | ADR-IF-R6-3 — closes the discovered answers-never-consumed defect |
| TC-R6-QN-1-03 | End to end: guessed fields asked; differing answers counted as corrections on the attestation; context reaches the graph_confirmed record | Covers R6-CX-1's persistence half |

Legacy shape (a node with NO basis_quotes object — pre-R6 drafts and
fixtures) is covered implicitly by the entire pre-R6 suite continuing to
pass unchanged: such nodes make no provenance claims and follow the R5
confirm flow (intake-flow.md §16.3).

R6-NF-1 is held by TC-PE-1-01 unchanged; R6-NF-3's provider parity is held
by both provider paths exiting through the same `parseExtraction` (asserted
structurally in graph-extractor.test.ts).

