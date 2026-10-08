# Counterpoise — Test Cases, Round GT7 (defects found by /gvm-test 007)

*Written 2026-10-04. The acceptance close-out (/gvm-test 007) found four cases whose clauses the build did not meet and one live-model weakness: a broken rules pack was named without its rule id and did not stop checking (TC-CF-5-02, TC-RA-7-01); the AI-written explanation was never told the track reason or the tier reason, and its test only read back its own mock (TC-VD-8-01); the regulatory reasoning did not say which attribute of the case set a rule off (TC-RA-9-01); and a description that dictated its own rating partly steered the demo model (TC-UC-3-04). This round fixes the first four and takes the light measure for the fifth: a warning, a note in the record and an honest statement in the docs. The stronger defence is not built and stays open. Build contract: `build/prompts/GT7-fixes.md` (v2); spec: `specs/cross-cutting.md` §5, `specs/verdict-audit.md` §5.7 and §7, `specs/intake-flow.md` §26, `specs/policy-schema.md` §6, `specs/evaluation-engine.md` §3.9. IDs are the ones the tests carry in their titles.*

Test files: `src/store/packs.test.ts`, `src/llm/reasoning-trace.test.ts`,
`src/engine/evaluate.test.ts`, `src/engine/condition.test.ts`,
`src/engine/condition.triggered-by.test.ts`, `src/engine/rating-instructions.test.ts`,
`src/engine/mutation-gaps.test.ts`, `src/components/trigger-copy.test.ts`,
`src/components/plain-copy.rating.test.ts`,
`src/components/__tests__/PackGate.gt7.test.tsx`,
`src/components/__tests__/PackGate.gt7-other-screens.test.tsx`,
`src/components/__tests__/PolicyEditor.packerror.test.tsx`,
`src/components/__tests__/VerdictDisplay.ga-trigger.test.tsx`,
`src/components/__tests__/RatingInstructions.gt7.test.tsx`,
`src/store/handoff.chain.test.ts`, `src/store/docs-limits.gt7.test.ts`.

Note on kind: the pack-failure tests (TC-CF-5-02b to -02i) inject a broken rules pack at the one module boundary that supplies pack sources (`getPackSources()` in `src/store/pack-source.ts`) — the owner-accepted fault-injection kind of test, not a real broken file.

## §1 — A rules pack that fails to load names the rule and stops the checking (P9: CF-5, RA-7)

| ID | Asserts |
|---|---|
| TC-CF-5-02b | A pack that fails to load: the "Policy file invalid" banner shows the loader's reason to the 2LoD role, Confirm is refused, and nothing is written to the audit trail — `PackGate.gt7.test.tsx` |
| TC-CF-5-02c | A 1LoD submitter sees the plain sentence, never the raw pack reason — `PackGate.gt7.test.tsx` |
| TC-CF-5-02d | The first evaluation gate (Continue on the review screen) refuses with the plain policy-problem message — `PackGate.gt7.test.tsx` |
| TC-CF-5-02e | With the shipped, valid packs there is no banner and `loadPackSet` reports no errors — `PackGate.gt7.test.tsx` |
| TC-CF-5-02f | With a broken pack, "Use the earlier result" refuses with the plain message and writes nothing (no record, no audit events) — `PackGate.gt7.test.tsx` |
| TC-CF-5-02g | Settings refuses both sample-data seeds on a broken pack and writes nothing — `PackGate.gt7-other-screens.test.tsx` |
| TC-CF-5-02h | The register's case page hands its verdict view only the packs that loaded; the broken pack is absent — `PackGate.gt7-other-screens.test.tsx` |
| TC-CF-5-02i | With a broken pack, "Mine is different" (when a match is shown) writes no dismissed-match event and shows the plain message — `PackGate.gt7.test.tsx` |
| TC-CF-5-02j | The Appetite framework screen shows the load error in full as visible text: the pack, the rule id and the field path — `PolicyEditor.packerror.test.tsx` |

## §2 — The explanation is told the track reason, the tier reason and the citation (P10: VD-8)

| ID | Asserts |
|---|---|
| TC-VD-8-01b | A hard-line verdict (no tier or track reason) still hands the model the binding reason and its regulatory basis, and the call allows 1024 tokens — `reasoning-trace.test.ts` |

## §3 — Every regulation shown says what set it off (P11: RA-9)

| ID | Asserts |
|---|---|
| TC-RA-9-01b | A UK/EU credit case against the real EU pack: the credit-scoring rule's chain entry carries the decision type "credit-decision" — `evaluate.test.ts` |
| TC-RA-9-01c | A pack hard-line rejection's chain entry also says what set it off — `evaluate.test.ts` |
| TC-RA-9-01d | The helper returns, per condition field, only the case's values that satisfy it, fields sorted, values distinct — `condition.test.ts` |
| TC-RA-9-01e | An unconditional rule gives an empty list; a value-equality condition reports the matching value; the jurisdictions list counts as one candidate, as in the engine — `condition.test.ts` |
| TC-RA-9-01f | The fields the shipped packs test read as plain sentence fragments — `trigger-copy.test.ts` |
| TC-RA-9-01g | Never shows a raw field code or enum value, mapped or not (NF-11) — `trigger-copy.test.ts` |
| TC-RA-9-01h | A chain entry with `triggered_by` shows "Applies because" in plain words, never the raw field or value — `VerdictDisplay.ga-trigger.test.tsx` |
| TC-RA-9-01i | An unmapped field renders a generic plain sentence, with no snake_case and no raw enum (NF-11) — `VerdictDisplay.ga-trigger.test.tsx` |
| TC-RA-9-01j | An old stored verdict (no `triggered_by`), or an empty one, renders the entry with no "Applies because" line — `VerdictDisplay.ga-trigger.test.tsx` |
| TC-RA-9-01k | A hand-off bundle exported from real `evaluate()` output keeps `triggered_by` through import, chain intact — `handoff.chain.test.ts` |
| TC-RA-9-01l | An old bundle whose chain entries lack `triggered_by` still imports — `handoff.chain.test.ts` |
| TC-RA-9-01m | "At least", "at most" and "is not one of" conditions report the satisfying values too, and only those — `condition.test.ts` |
| TC-RA-9-01n | For every shipped pack rule and a set of cases: `triggered_by` is non-empty exactly when the rule fired — `condition.triggered-by.test.ts` |
| TC-RA-9-01o | A condition met on one field but not another reports nothing — `condition.test.ts` |
| TC-RA-9-01q | `evaluate()`'s regulatory chain `triggered_by` equals the helper's answer for the rule, end to end — `condition.triggered-by.test.ts` |
| TC-RA-9-01r | A pack hard-line rule that fires carries its `triggered_by` into the rejection chain — `condition.triggered-by.test.ts` |

There is no TC-RA-9-01p: the id was skipped while the tests were written and is not used.

## §4 — A description that dictates its own rating is flagged, never obeyed (P12: UC-3, L-1 light measure)

| ID | Asserts |
|---|---|
| TC-UC-3-04b-01 | The try-these file yields all eleven descriptions, so the next family of tests cannot pass on an empty list — `rating-instructions.test.ts` |
| TC-UC-3-04b-02 | (one test per description, NN = 01 to 11) Each of the eleven descriptions in `docs/try-these.md` does not fire — `rating-instructions.test.ts` |
| TC-UC-3-04b-03 | No seeded sample-register or investment-bank-portfolio description fires — `rating-instructions.test.ts` |
| TC-UC-3-04b-04 | (one test per table line, NN = 01 onward) Plain operational prose does not fire, one test per line of a table ("Runs in Zone C", "autonomy level 3", "a self-service portal", "market risk", "track invoices", "credit risk data", "a low-risk internal pilot", "the data is classified as Zone C", "Use it in Zone A", "Track I accounts are premium", …) — `rating-instructions.test.ts` |
| TC-UC-3-04b-05 | The TC-UC-3-04 steering text fires — `rating-instructions.test.ts` |
| TC-UC-3-04b-06 | The gvm-test 007 live steering text fires, and its parts are quoted in text order — `rating-instructions.test.ts` |
| TC-UC-3-04b-07 | (one test per table line, NN = 01 onward) Instructions in several wordings each fire, one test per line of a table — `rating-instructions.test.ts` |
| TC-UC-3-04b-08 | Matches are de-duplicated, in text order, each cut to 80 characters, at most five — `rating-instructions.test.ts` |
| TC-UC-3-04b-09 | The check is deterministic and pure: same text, same answer, every time — `rating-instructions.test.ts` |
| TC-UC-3-04b-10 | One very long instruction is cut to 80 characters — `rating-instructions.test.ts` |
| TC-UC-3-04b-11 | 100,000 newlines plus rating words finish in under a second — `rating-instructions.test.ts` |
| TC-UC-3-04b-12 | Steering text after 6,000 characters of ordinary words still fires — `rating-instructions.test.ts` |
| TC-UC-3-04b-13 | An instruction straddling a window boundary is found once; ordinary text at a boundary never fires — `rating-instructions.test.ts` |
| TC-UC-3-04b-14 | Steering at the end of 100,000 characters of ordinary words is found in under a second — `rating-instructions.test.ts` |
| TC-UC-3-04b-15 | A rating verb with a risk level followed by a noun is prose, not an instruction; a real instruction still fires — `rating-instructions.test.ts` |
| TC-UC-3-04b-16 | 1.5 MB with 30,000 strong and 30,000 weak hits finishes in under two seconds — `rating-instructions.test.ts` |
| TC-UC-3-04c-01 | The review screen warns, in a status region with a visible "Warning:" lead-in, and quotes at most the first two phrases — `RatingInstructions.gt7.test.tsx` |
| TC-UC-3-04c-02 | An ordinary description gets no warning on the review screen — `RatingInstructions.gt7.test.tsx` |
| TC-UC-3-04c-03 | The confirmation step repeats a one-line warning on the description path — `RatingInstructions.gt7.test.tsx` |
| TC-UC-3-04c-04 | The form path shows no warning anywhere, even when the typed sentence reads like an instruction (no model reads it) — `RatingInstructions.gt7.test.tsx` |
| TC-UC-3-04c-05 | Confirming a description-path case records the phrases on the "graph confirmed" event; an ordinary description writes no such field — `RatingInstructions.gt7.test.tsx` |
| TC-UC-3-04c-06 | The register's audit line is one fixed sentence for every role, with no quoted phrase — `RatingInstructions.gt7.test.tsx` |
| TC-UC-3-04c-07 | The verdict is identical with and without the phrases when the graph is the same — `RatingInstructions.gt7.test.tsx` |
| TC-UC-3-04d-01 | A hand-off bundle made from real app output carries the phrases and round-trips; a bundle without them imports too — `RatingInstructions.gt7.test.tsx` |
| TC-UC-3-04d-02 | A bundle whose phrases field is the wrong shape is rejected, and nothing is imported — `RatingInstructions.gt7.test.tsx` |
| TC-UC-3-04e | The same limits paragraph appears in the user guide (both twins), the tester guide and the README — `docs-limits.gt7.test.ts` |
| TC-UC-3-04f | A quoted phrase containing the decision words is shown without them, so the verdict-screen query for those words stays unambiguous — `plain-copy.rating.test.ts` |

## Amended existing cases

| ID | What changed |
|---|---|
| TC-CF-5-02 | The load error now names the rule id and the field path, and a pack failure joins the start-up gate (the rest in TC-CF-5-02b to -02j above). The test is in `packs.test.ts`, single-id; it fails against the earlier code. `test-cases.md` carries an "Amended (GT7, 2026-10-04)" note — `packs.test.ts` |
| TC-RA-7-01 | Split out of the old double-tagged test into its own single-id test; it asserts the pack id and the rule id (`BAD-1`) are in the reason, and the bad rule is second in the file so the first rule cannot satisfy it — `packs.test.ts` |
| TC-VD-8-01 | Now asserts the request body the SDK mock received, for a verdict from real `evaluate()` on a pack-forced Critical tier: it contains the track rule's name and id, the base-tier reason, and each chain entry's document, section and derived sentence. The old test, which read back the mock's own prose, is kept and retitled as rendering only — `reasoning-trace.test.ts` |
| TC-RA-9-01 | The EU hiring case now also asserts the chain entry's `triggered_by` is the decision type "hiring" — `evaluate.test.ts` |
| MUT-4a | The unsigned-pack-rule mutation test now expects `triggered_by` on the chain entry, equal to the fixture rule's own condition (the label field and value) — `mutation-gaps.test.ts` |
| TC-UC-3-04 | Manual evidence extended (`test-cases.md`): the 2026-10-04 live check with the local qwen3:4b model — a description that dictated its own rating partly steered extraction (data read as internal, Zone A, autonomy 0), giving "approved with controls, High" where the honest reading is a hard-line rejection; the engine rated the cards correctly; light measure built (warning, record, docs); stronger defence open. The case stays partly open (live model steering) |

## Superseded

| ID | Reason |
|---|---|
| TC-UC-3-04c-01 | Superseded by R18-GI-10 (R18-A): the review screen's rating-instruction warning is unreachable. The same warning on the description screen, with a Warning: lead-in and at most the first two phrases quoted, is TC-R18-GI-3-19 (IntakeFlow.r18a.describe.test.tsx and plain-copy.rating.test.ts). |
| TC-UC-3-04c-03 | Superseded by R18-GI-10 (R18-A): the confirmation step's warning repeated a model-path reading; a form-built case never carries rating instructions (TC-UC-3-04c-04 pins that). No replacement — behaviour retired. |
| TC-UC-3-04c-05 | Superseded by R18-GI-10 (R18-A): graph_confirmed gets no rating_instructions field from a form-built case. Reading of old records that carry it is TC-UC-3-04d-01 and -02. No replacement for the write — behaviour retired. |
| TC-UC-3-04c-02 | Superseded by R18-GI-10 (R18-A): the review screen's no-warning case is unreachable. An ordinary description getting no warning on the description screen is part of TC-R18-GI-3-19. |