# Requirements Health Report — Acknowledged Decisions

Format: {issue-ID} | {requirement-ID} | {issue-type} | {disposition} | {date} | {assumption-for-tests}

HR-01 | UC-2 | Untestable — similarity threshold undefined | Acknowledge | 2026-06-04 | Tests use 0.80 as default threshold; one test for LLM-path and one for keyword fallback path
HR-02 | NF-5 | Untestable — hardware baseline undefined | Acknowledge | 2026-06-04 | Tests use development machine as baseline; "standard laptop" = MacBook Air M2 8GB
HR-03 | CF-1, PE-7 | Duplicate — near-identical policy file requirement | Acknowledge | 2026-06-04 | Tests written once, traced to both CF-1 and PE-7
HR-04 | PE-5, PE-6, RA-1, RA-2 | Duplicate — jurisdiction logic covered in two domains | Acknowledge | 2026-06-04 | Tests written once, traced to all four IDs
HR-07 | NF-3 | Missing — API key config UX not specified | Acknowledge | 2026-06-04 | Tests assume: key stored in localStorage, masked field, fallback to form on missing/invalid key
HR-08 | NF-2, VD-4 | Inconsistency — provisional audit trail vs absolute VD-4 claim | Acknowledge | 2026-06-04 | Tests verify application-layer immutability only (no delete/edit button); V1 verdicts labelled "Provisional audit trail"
HR-09 | RG-1 | Untestable — graph query latency undefined | Acknowledge | 2026-06-04 | Tests use 2-second target on register of 500 use cases
HR-10 | LC-6 | Missing — failure behaviour on Counterpoise self-assessment reject | Acknowledge | 2026-06-04 | Tests verify: self-assessment use case exists in register; Rejected verdict shows prominent warning to 2LoD role
HR-11 | (pipeline) | False positive — mtime staleness after git filter-repo | Acknowledge | 2026-07-26 | No regeneration needed; requirements.md and test-cases.md last changed in the same commit c6f1892. GVM shared rule 19 mtime heuristic is unreliable in rewritten repos — use last content-change commit date.
HR-12 | PV-1..PV-8 | Scope — built despite recorded V2+ deferral | Promote into scope | 2026-07-26 | PV-1/2/3/5/6/8 promoted from "V2+ deferred" to in-scope; traceability matrix updated; TC-PV-* generated this run. PV-4 (question-budget reduction) and PV-7 (re-evaluation on approval change) remain deferred.
HR-13 | CS-1, PV-3 | ID collision — TC-CS-1-02 means three different things | Reallocate | 2026-07-26 | test-cases.md retains TC-CS-1-02 ("safety margin maintained"). Implementation-guide's inheritance meaning becomes TC-PV-3-01. greedy-solver.test.ts renamed to its correct existing ID. Propagated across all three artefacts per shared rule 24.
HR3-01 | R3-RD-1 | Untestable — "decision-bearing content" undefined | Fix | 2026-07-29 | Round 3. Fit criterion replaced with a closed six-item list (status+tier, binding constraint, invariant ids with citations, control ids with evidence status, margin + no-headroom ids, standing conditions). Content outside the list is not asserted.
HR3-02 | R3-JU-5 | Untestable — "or equivalent" is an open set | Fix | 2026-07-29 | Round 3. Mechanism named: visible required-marker AND aria-required="true". Assertion is set-equality between fields blocking progress and fields marked.
HR3-03 | R3-JU-3, R3-JU-6 | Inconsistency — both demand the same sentence | Fix | 2026-07-29 | Round 3. Resolved as distinct and both applying: JU-3 is prose for the submitter, JU-6 is a labelled reason on the record. Asserted separately.
HR3-04 | R3-JU-2 | Weak — "record the reason" names no location | Fix | 2026-07-29 | Round 3. Reason must be a named enumerable value on the verdict, not inferred from prose. Field named by the tech spec.
HR3-05 | R3-JU-1 | Weak — no representation distinguishes "not answered" from "answered: none" | Fix | 2026-07-29 | Round 3. Explicit answered-state required on the form, separate from the selected set. Mechanism left to tech spec.
HR3-06 | R3-JU-2, LC-2 | Missing — 2LoD sign-off behaviour for a Provisional verdict | Defer | 2026-07-29 | Round 3. Deliberate deferral, recorded in the Out of Scope section. Revisit when both causes of Provisional can be observed together.
HR3-07 | R3-JU-1 | Missing — pre-existing intake drafts bypass the new check | Fix | 2026-07-29 | Round 3. R3-JU-7 added: a draft saved before this round is treated as unanswered. Silent acceptance would reintroduce the defect JU-1 closes.
HR3-08 | R3-RD-1 | Constraint conflict — rendering the verdict puts "Approved" on the register page | Proceed | 2026-07-29 | Round 3. Not a requirements defect. Carried to the tech spec: tighten the single-match /approved|rejected/i queries before RD-1 lands.
HR18-01 | R18-GI-3, R18-GI-13 | Weak — a real quote does not prove the answer; steering phrases could ride as the quote | Fix | 2026-10-04 | Round 18. Owner: quote is evidence shown to the person (confirmation is the control); a quote that is itself a rating instruction is never accepted. Amended into R18-GI-3.
HR18-02 | R18-GI-10 | Inconsistency — old cases "correctable" vs card review retired | Fix | 2026-10-04 | Round 18. Owner: correcting an old case opens the pre-filled form from its recorded answers where they map, description kept, rest blank and marked.
HR18-03 | R18-GI-1 | Missing — no description length bound | Fix | 2026-10-04 | Round 18. Owner: 8,000 characters; beyond it the model is skipped, the full text kept. New R18-GI-14.
HR18-04 | R18-MS-1 | Untestable — "cloud tag" undefined | Fix | 2026-10-04 | Round 18. Defined as a name ending :cloud or -cloud.
HR18-05 | R18-MS-4, R18-NF-1 | Untestable — per-case limit has no value | Fix | 2026-10-04 | Round 18. 60 seconds per case.
HR18-06 | R18-GI-3 | Missing — tick-all pre-fill unspecified | Fix | 2026-10-04 | Round 18. One verified quote per ticked option.
HR18-07 | R18-GI-3 | Missing — value outside the options | Fix | 2026-10-04 | Round 18. Discarded like an unverified quote.
HR18-08 | R18-PS-3 | Weak — examples vs model dependence | Fix | 2026-10-04 | Round 18. No example promises the same pre-fill from every model.
HR18-09 | R18-GI-1 | Weak — "mentioned" rule unspecified | Acknowledge | 2026-10-04 | Round 18. Technical-spec decision (OQ-5); test cases pin concrete tick / no-tick sentences.
HR18-10 | OQ-1 | Open — scoring basis of the in-app test | Acknowledge | 2026-10-04 | Round 18. Technical-spec decision; test cases are written at the behaviour level (deterministic per-question table).
HR18-11 | R18-MS-5, R18-NF-3 | Missing — Clear all data vs saved test results and format mode | Fix | 2026-10-04 | Round 18. Kept with model settings.
