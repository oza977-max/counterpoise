# Counterpoise — Test Cases, Round 12

*Written 2026-08-18 alongside the build (v0.14.0) from
`requirements/requirements-012.md`. Traceability 100% at birth.*

Test files: `src/engine/temporal.test.ts` (23 tests — the round's engine
core), plus TC-R12-prefixed additions across `knowledge-lens.test.ts`,
`packs.test.ts`, `policy.test.ts`, `challenge-memo.test.ts`, and nine new
component test files covering the UI surfaces (sampling, staleness,
provisional families, badges, nav gating).

## R12-ST — Staleness machine-enforced

| Asserts |
|---|
| `computeStaleSources`: pack past its window reported with exact days overdue; on-the-boundary date NOT stale; packs missing either field skipped; output sorted by pack id (NF-1) |
| `applyReattestExpiry`: family entry past `reattest_by` treated as not approved; on/before the date unchanged; non-family and undated entries untouched; input policy not mutated |
| Verdict staleness marker renders (role=alert, PROVISIONAL idiom) when `stale_sources` non-empty; absent otherwise; legacy verdicts without the field render unchanged |
| Policy screen pack rows show "retrieved N days ago · review window D days" with an overdue state |
| Knowledge-lens meta parses ({meta, entries} form), legacy bare-array still accepted; meta renders curated_by/date/review owner + age warning past `max_staleness_days` |

## R12-BD — Badges and causes

| Asserts |
|---|
| Quote affordance copy claims verbatim presence only ("check it supports the value") — no implication of validation |
| "Model confident — no verified basis" combined marker renders when confidence and quote-status disagree; advisory idiom, not an alarm |
| `derived`-basis chain entries carry "The regulator has not confirmed this reading." on the verdict and in the memo |
| Provisional causes group under "Sign-off gaps" vs "Substantive caveats"; register pilot line counts only verdicts whose causes are all sign-off gaps |

## R12-AB — Automation-bias countermeasures (the Critical)

| Asserts |
|---|
| `isSampledForReview` deterministic (same id → same answer, 100 calls); ~1-in-K distribution over many ids; degenerate rates never select |
| Sampling chip appears on self-served Low-tier decided rows (2LoD view); cleared once a `sampling_reviewed` event exists |
| Review panel appends exactly ONE `sampling_reviewed` event on double-click (in-flight ref guard — same append-only data-integrity pattern as dissent filing) |
| Rule challenges screen shows "challenged N times · fired on M decided cases" derived read-only from existing events |

## R12-MG / R12-MISC / R12-AD

| Asserts |
|---|
| Schema accepts `reattest_by`, `sampling_rate`, pack-level `retrieved_date`/`max_staleness_days`; wrong types rejected |
| Settings probe surfaces the local model's Ollama digest |
| Memo prints "Policy content hash: <sha256>" when supplied, "not computed" when absent (legacy call sites) |
| 1LoD role hides the Rule challenges nav item (falls back to intake if active); 2LoD unchanged |

R12-NF-1 is held by construction (temporal functions take the date as a
parameter; `evaluate()` signature untouched; TC-PE-1-01 unchanged) plus the
temporal tests' fixed-date determinism. R12-NF-2 by the suite-wide
reserved-words guard over every new string. R12-NF-3 by the single-event
double-click test. R12-AD-4 (the declined fast path) needs no test — the
deviation is recorded in requirements-012.md.

**Suite at close: 657 tests / 72 files, green ×3.**

| Date | Change |
|---|---|
| 2026-08-18 | Written with the R12 build. |
| 2026-10-08 | R18-B retires the Settings "Test & save" probe; one row moved to Superseded below. |

## Superseded

| ID | Reason |
|---|---|
| TC-R12-MG-2-01 | Superseded by R18-MS-1 and R18-MS-3 (R18-B): the Settings probe that contacted the local model server on save and printed the model's Ollama digest is gone. The setting is now saved by place with no network call, and the explicit "Find models" press lists names only (`GET /api/tags`); no digest is read, shown or recorded this round (specs/intake-flow.md §27.8, §27.13). No replacement — behaviour retired. |

---

*Developed using the Grounded Vibe Methodology*
