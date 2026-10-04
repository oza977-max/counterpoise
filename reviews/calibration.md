---
schema_version: 0
---

# Review Calibration — AIGate

Carried forward between review rounds. Round 2 reads this and applies a
strict criterion; round 1 ran liberal because there was nothing to calibrate
against.

## Score history

| Round | Date | Type | Panels | Critical | Important | Minor/Sugg | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | 2026-07-26 | code | A,B,C,D,E | 7 | 6 | 7 | Merge |
| 1 | 2026-07-26 | test | full mode | 0 | 0 | 0 | **Demo-ready** |
| 1 | 2026-07-26 | explore | interruption | 1 | 1 | 1 | 3 defects, 1 obs |
| 2 | 2026-07-27 | explore | confirmation | 0 | 1 | 1 | D-001 fix confirmed |
| 2 | 2026-07-27 | test | full mode | 0 | 0 | 0 | **Ship-ready** |
| 1 | 2026-07-27 | oracle | fable+opus, blind | — | — | — | 30/31 status, 24/31 binding |
| 2 | 2026-07-27 | oracle | fable+opus, blind | — | — | — | 30/31 status, **31/31 binding** |
| 2 | 2026-07-28 | code | A,B,C,D,E | 3 | 3 | 3 | **Merge with caveats** |
| 1 | 2026-07-29 | design | A,B,C,D,E,F | 2 | 11 | 2 | **Build with caveats** |
| 3 | 2026-08-04 | test | full mode | 0 | 7 | 9 | **Demo-ready** |
| 3 | 2026-08-06 | code | A,B,C,D,E | 0 | 6 | 0 | **Merge with caveats** |
| 4 | 2026-08-08 | test | full mode | 0 | 2 | 1 | **Demo-ready** |
| 5 | 2026-08-09 | test | full mode | 0 | 0 | 0 | **Demo-ready** |
| 6 | 2026-08-15 | test | full mode | 0 | 0 | 0 | **Ship-ready** (OQ-5: user chose ship; no CI, manual evidence) |
| 1 | 2026-08-25 | doc | A,B,C,D (standalone) | 2 | 15 | 10 | **Do not publish — revise first** ("After Deployment" briefing, 2nd ed.; all C+I fixed same-session per owner triage → 3rd ed. republished; R2 recommended) |
| 2 | 2026-08-25 | doc | A,B,C,D strict | 0 | 3 | 4 | **Publish with revisions** (3rd ed. scored 8.2 — integrity 9 ↑, transparency 8 ↑, prose 6 ↓ regression from R1 fixes; all 3 Importants + prose pass fixed per owner triage → 4th ed.; stopping rule not yet met, targeted R3 optional) |
| 2 | 2026-08-31 | design | A,B,C,D,E,G (G supplementary, strict) | 6 | 8 | 3 | **Build with caveats** (verdict/sign-off screen; triggered by explore-006's 3 Critical UX findings; 4 panels independently converged on the same fix mechanism for the core finding; owner chose fix-everything) |
| 4 | 2026-08-31 | code | A,B,C,D,E,G ×2 (DUAL: calibrated + blind) + F mechanical | 1 | 9 | 7 | **Merge** (full-day range f4b40d6^..HEAD, 26 commits/91 files; owner chose fix-all C+I+M — F1–F17 fixed + verified same session, 712/712 ×3, F1 re-proven live; 5 observations logged. Dual review earned its cost: 3 of 10 Importants blind-only (F2 rendered reserved word, F3 question-generator vocabulary, F5 single-select compound gap). Capture-recapture ≈56% coverage — weak signal (sets not method-independent); optional targeted R2 on untouched intersection (src/llm, CSS, seeds) noted, not required) |
| 3 | 2026-08-31 | design | A,C,D,E,G strict (no B/F — no contract/quality-attribute change) | 2 | 6 | 3 | **Build with caveats** (verdict screen information architecture and narrative flow — not another leak sweep; owner's own proposed 5-beat restructure independently stress-tested rather than rubber-stamped; both Criticals are proposal-design gaps, not pre-existing code bugs — beat 4 forced grouping [C+G converged] and binding-constraint deletion's false premise [A+D converged]; triage pending) |
| 4 | 2026-08-31 | design | A,C,D,E, + Panel G fanned out one sub-panel per screen (9 screens) — 13 panels total (no B/F) | 10 | 14 | 8 | **Build with caveats** (app-wide narrative flow — same audience-hospitality lens applied to every screen outside the already-fixed verdict screen; owner asked "look at all screens with same lens"; strongest signal is 3-panel convergence [A+C+D] that the round-3 fix — Fold, NF-11 — was built as a one-screen patch, not a reusable house convention, and did not propagate; triage pending) |
| 3 | 2026-08-31 | explore | persona demo (founder/skeptical-banker/consultant roleplay, grounded in live site content) | 1 | 2 | 1 | 4 findings — audit trail not tamper-evident (Critical), Track/Tier never mapped to a real bank's committees + coverage-gap queue no visibility (Important), margin-of-safety uncalibrated (Minor); owner chose fix-everything, including the item the consultant flagged as future-phase infra |
| 4 | 2026-08-31 | explore | confirmation, same persona, no founder present | 0 | 0 | 1 obs | 3 of 4 findings confirmed CLOSED by direct inspection (live chain-integrity check, in-product governance mapping, honest calibration wording); 1 observation — completion tracking remains a stated, accepted V1 limitation, not silently missing |
| 5 | 2026-09-28 | code | A,B,C,D,E,G ×2 (DUAL: calibrated + blind) + F mechanical | 8 | 14 | 7 | **Merge with caveats** (owner fix-all ×3: round 1 27/29 verified + 9 new; round 2 all 9 verified + 5 new (2C/1I/2M) fixed with tests, not re-reviewed — stopping rule) (pre-release gate for v1.0.0, range 7a82346..HEAD, 6 commits/41 files: hand-off bundle + control attestation + traceability tests. 72 raw → 29 de-duplicated + 3 observations. Dual review: 9 of 22 C+I reported by ≥1 blind panel, 3 blind-only (F7 spec/guard-test contradiction, F17 cross-tab register writes, F19 dropped attestation). Verdict recorded after the fix pass is re-reviewed) |
| 1 | 2026-10-02 | design | A,B,C,D,E + F (comprehension sub-panel, utility-tree H/H leaf NF-12), liberal | 15 | 19 | 13 | **Build with caveats** (round 2 strict: 42/47 closed, 5 partly, 19 new incl. 4 C — all written into v2.1, not re-reviewed; owner: start building) (build contract R16 for the plain-language intake + verdict, before any code; 3 owner decisions: two team names, review plain names approved, Q6/Q7 'Not sure' → strictest) |
| 3 | 2026-10-02 | design | A,B,C,D,E,F1,F2 ×2 (DUAL: calibrated + blind), strict — design review 007 | 10 | 23 | 5 | **Do not build** (as written — R16-W built without a cleared review, checked retroactively; R16-D2 and R16-E plans before build. 108 raw → 34 + 1 minor batch; 15 of 34 rest on blind-only reports. Owner triage: fix all 14 built-code findings after renaming the product to Counterpoise; rewrite both plans with every fix and build D2 then E in order; adopt WCAG 2.1 AA for new and changed screens; NF-12 gate amended to cover a "No"; pack-rule "No" limitation NOT approved → fix in D2. Rewritten plans get a fix-verification pass, then a verdict for build) |
| 3v | 2026-10-03 | design | fix verification — one independent read-only reviewer (Sonnet) on R16-D2/R16-E v2.1 against DR7-15..34 and the built R16-F code; every claim spot-checked by the main loop | 0 | 7 | 8 | **Build with caveats** (19 of 20 plan findings closed, DR7-34 partial → closed in v2.2; 7 builder-would-go-wrong gaps (3 in E: per-question focus credited to a step-only mechanism, a second extraction-error call site, an opposite narrow-screen CSS rule; 4 in D2: unspecified "fields" method, §2-vs-§4b contradiction, unnamed evidence helpers, DR7-34 doubled note) + 21 stale citations (19 wrong, 2 approximate) + 8 clarity items. Owner: "apply all, then build" — all applied as v2.2. Not a 4th review round: verification of round-3 fixes. Caveats: D2 before E; re-find citations at build; single reviewer, not a panel) |
| — | 2026-10-03 | build loop | /gvm-build Hard Gate 3 — one fresh Sonnet reviewer per pass, per chunk (R16-F, R16-D2, R16-E); every finding re-checked by the main loop | 0 | 10 | 10 | R16-F `[(1,1),(2,1),(3,1),(4,1),(5,1)]` — stalled, stopped at pass 5, closed by owner decision after fixing pass 5; R16-D2 `[(1,0)]` — converged; R16-E `[(1,2),(2,1),(3,1),(4,1)]` — closed by owner decision after fixing pass 4. Every C/I fixed with a test shown failing without the fix. Two loops have no `(final, 0)` terminator — recorded as such, not padded; the multi-panel `/gvm-code-review` of the whole R16 range follows |
| 6 | 2026-10-03 | code | A,B,C,D,E,G ×2 (DUAL: calibrated + blind) + F (assembled stub prompt) + EBT linter + 6 fresh-context verifiers (gvm-graph) | 6 | 17 | 23 | **Do not merge** (whole R16 range b1e146b..9348882, 15 commits / 51 production files. 31 C/I claims verified: 20 confirmed, 10 partly, 1 disproven (dropped). Hand-off "tampered" Critical PROVEN by test and bisected to code-review-005 fix round 1 (3e4f119) — live since 2026-09-28. Capture-recapture ≈54% coverage → second full round. Owner triage: fix all 6 C; fix 16 I + accept EBT-1 as a labelled exception; fix every Minor + the stub flag; fixes under full GVM build discipline; then R2) |
| 7 | 2026-10-03 | code | A,B,C,D,E,G ×2 (DUAL: calibrated + blind) + F (assembled stub prompt) + EBT linter + 3 fresh-context verifiers (gvm-graph) | 0 | 12 | 28 | **Do not merge** (second full round of the R16 range b1e146b..9ecdee6 after the CR6 fixes and ENG-ID; 49 commits / 56 production files. 14 distinct C/I claims verified: 12 confirmed, 2 downgraded to Minor, 0 disproven; 6 proved by probe tests in a scratch copy. Capture-recapture ≈65% (round 6: ≈54%). Owner triage: fix all 12 I and all 28 M; CR7-23 keep the listed country; stub flags dismissed (allowlist); EBT-2/3 accepted as labelled exceptions, EBT-4 dismissed) |
| — | 2026-10-04 | build loop | CR7 fix round — /gvm-build Hard Gate 3, fresh Sonnet reviewer per pass per chunk; plan checked before code (24 problems in v1) | 0 | 7 | — | FX7-1 `[(1,3),(2,1),(3,1),(4,0)]`; FX7-2 `[(1,1),(2,0)]`; FX7-3 `[(1,0)]`; FX7-4 `[(1,1),(2,1),(3,0)]`; FX7-6 `[(1,0)]` — every loop converged; all Minors fixed; 3 merge-time defects caught by the main loop (cross-builder fixture clash, reused test ids, register snapshot on the raw policy). Owner asleep: product questions took the cautious option, listed in build/handovers/CR7-fixes.md for confirmation. Next: review of the fix round, then /gvm-test |
| 8 | 2026-10-04 | code | A,B,C,D,E,G ×2 (DUAL: calibrated + blind) + F (assembled stub prompt, valid allowlist) + EBT linter + 2 fresh-context verifiers | 0 | 5 | 15 | **Merge with caveats** (review of the CR7 fix round bdb5d50..ea01a1a, 80 commits / 34 production files. 7 code C/I claims verified: 4 Important, 3 downgraded to Minor, 0 disproven; most proved by probes running the real reducer/view-model/audit store; capture-recapture ≈52%. Owner triage: fix all 4 Important + 15 Minor in a CR8 fix round before /gvm-test; publish the CR7-12 docs draft with 2 outcome corrections; stub flags dismissed; 37 test spies accepted and to be labelled) |
| — | 2026-10-04 | build loop | CR8 fix round — plan checked before code (17 problems in v1); fresh Sonnet reviewer per pass per chunk | 0 | 1 | — | FX8-1 `[(1,0)]`; FX8-2 `[(1,0)]`; FX8-3 `[(1,1),(2,0)]` — converged; all Minors fixed; builders stated the P1–P5 properties in code and the reviewers attacked them (a 2000-run planner probe, a 192-combination sign-off probe). One chair instruction reverted on builder evidence (O(n) check per append) |
| 9 | 2026-10-04 | code | A,B,C,D,E,G ×2 (DUAL: calibrated + blind) + F (assembled stub prompt) + EBT linter + 1 fresh-context verifier | 0 | 2 | 13 | **Merge with caveats** (review of the CR8 fix round 4aea27e..a2fe323, 45 commits / 20 production files + docs. P1–P5 held under attack by every panel; E, F and the EBT view found nothing. 2 Important: the user guide's false "self-service final" self-approval claim (6 panels) and "What you need to do: Nothing." under a confirm-the-sign-off headline (4 panels, 2 render probes). 13 Minor: O-4/O-5 promised in the plan and dropped (chair's miss), README chain over-claim, guide/tester-guide claims the app does not show, 2 spec html twins, Clear-all incomplete path, a try-these pin. 1 disputed Important sent to a verifier with a reducer probe → unreachable → Observation. Capture-recapture ≈98% (shared prompts; small population). Owner triage: fix both I, all 13 M, and OB-1 properly (drop, not narrow); OB-2..9 recorded) |

## Round 1 measurements

**Capture-recapture.** Panels A and B independently found the same defect
(`platform_satisfies` unconsumed) — one overlapping pair. Lincoln-Petersen
on a single pair estimates ~30 total against 26 unique found, ≈87% coverage.
**One overlap makes this estimate very noisy**; treat it as "probably most of
them", not a number. Round 2 was optional on this evidence, not indicated.

**Borderline filter.** 4 borderlines raised, 2 kept (50%). Kept: the N=1
margin degeneracy (independently raised by two panels — promoted per the
multi-panel rule) and the `pack_files` drift risk. Discarded: two `source_url`
provenance nits already covered by a stronger finding.

**Where the defects were.** 9 of 13 Critical/Important findings were in code
written the same day as the review. The oldest untouched code produced almost
nothing. This is the single most useful calibration signal from round 1:
recency predicts defect density here far better than complexity does.

## Build verification 001 (test phase)

Verdict **Demo-ready**, emitted by `gvm_verdict.evaluate` over the
thirteen-criterion table. Ship-ready blocked by a single gate:

**VV-2(c) FAIL — exploratory testing has never been performed.** No
`test/explore-NNN.md` charter exists. Every VV-3 gate passed and no VV-4
trigger fired, so the fall-through is Demo-ready rather than Not shippable.

Measurements worth carrying:
- 60/80 requirements IMPLEMENTED, 0 PARTIAL, 0 STUB, 20 deferred. No
  in-scope Must unimplemented.
- Zero blocking integration seams.
- **Acceptance-criterion traceability is 30/116 (26%).** A seven-case sample
  of the untraceable ones found a verifying test for every one — so the gap
  is traceability, not coverage. It is nonetheless the same mechanism that
  hid CS-1 for two months behind a duplicate id, and it is a poor answer for
  a product selling auditability.
- Real-chain test is exemplary: whole App, real engine and store, with the
  Anthropic SDK the only mock in the suite.

**The verdict understates the real gap.** Demo-ready is about the build. The
substantive issue is that zero historical committee decisions have ever been
compared against an engine verdict — the product's core thesis is untested,
and no amount of green suite changes that.

## Oracle rounds (new artefact type — see backtest/oracle-protocol.md)

A blind adjudication method with no GVM skill behind it, built because the
back-test needed a ground truth and committee recollection was rejected as one.
Two independent adjudicators (Claude Fable 5, Claude Opus 4.8) score every
corpus case from `policy/appetite.yaml` alone — no sight of the engine's
verdicts, its tests, its code, or any written prediction. Disagreements are the
output; agreement is weak evidence.

**Reading the disagreement pattern is the whole method:**

| Pattern | Diagnosis |
|---|---|
| Both oracles agree, engine differs | Engine defect |
| Oracles disagree with each other | The RULE is ambiguous |
| All three agree but the answer is wrong | Rulebook defect |
| Engine cannot decide | Coverage hole |

**Round 001 → 002 measurements.** Binding-constraint agreement went 24/31 →
**31/31** after the tie-break was fixed; status held at 30/31 (the persistent
disagreement is H-01, inheritance semantics the policy never defines). Round
001 found 9 of 28 model_type × bindingness pairs unrouted and five verified
structural defects. Round 002's brief added a REGRESSION hunt, and that is what
made it valuable.

**RF-4 — a fix that displaces the defect one rule down.** NEW recurring
finding, and the most important lesson of the two rounds. Both adjudicators
independently observed that several round-001 fixes reintroduced the same
defect one rule further on: promoting the special tracks made TRACK-III-AGENTIC
unreachable for autonomy≥3 agents; widening HL-002 orphaned INV-ZONE-01;
CTRL-AUTONOMY-BOUND-01 fixed abolish-the-use-case in INV-AUTONOMY-01 and
INV-AUTONOMY-02 inherited it; fixing the tie-break in code left the rule absent
from the policy; applying "obligations follow the affected person" to conduct
and fairness left the sibling rules gated on model family.

**The mechanism behind RF-4 is a process failure, not a reasoning failure.**
All of it was built outside the GVM discipline — no chunk prompts, no
handovers, and no independent review convergence loop. The convergence loop is
exactly what catches a fix that displaces a defect. Code review 002 confirms
it: the panels found the vacuous totality test in one pass, and it had already
been cited three times as evidence.

## Recurring findings

**RF-1 — "declared, threaded, never consumed".** Now seven confirmed
instances: regulatory citations dropped at verdict assembly (V1);
`platform_satisfies` (twice — the field itself, and again when PV-A added a
parallel mechanism instead of removing it); `safety_margin` discarded as
`_margin`; `resolveActivePacks` ignoring the jurisdiction registry; the CS-1
margin fields computed and never rendered; `ConfidenceCaveat.field`.

Mechanical guards added: parity rules **R6** (engine parameters named `_x`,
with `.parity-allowlist` requiring written rationale) and **R7** (no
test-case id used by two different tests). R6 found three further instances
on its first run.

**R6 does not catch the variants that matter most.** It matches only the
`_paramName` spelling. It did not catch the CS-1 margin fields (computed,
persisted, unrendered) or `ConfidenceCaveat.field` (written, never read).
A field-level read/write analysis would. **Round 2 should treat "find the
variants R6 cannot see" as a standing panel mandate.**

**RF-2 — parallel `.md`/`.html` artefacts drift silently.** Two instances in
one day: `verdict-audit.html` missing a V2-D reword, and nine test cases
written to `test-cases.md` and never rendered into the HTML. The parity
script reads `.md` only, by design, so it cannot see this class at all.
Candidate for an R8 rule.

Code review 004 (2026-08-31): TWO more instances in one day's diff —
`verdict-audit.html` again (missed `control_ownership_assigned`; both the
calibrated and blind D panels converged on it) and `policy-schema.md/.html`
missing `governance_mapping` entirely. Four confirmed instances now. The
class survives because CLAUDE.md documents it as a discipline rather than a
check; the R8 candidate rule (an automated .md-section-heads vs .html
comparison) is overdue.

**RF-3 — new-vocabulary propagation misses (named by code review 004).** A
schema addition must reach EVERY consumer of the vocabulary, and today's
`system_access_scope`/`multi_instance_coordination` addition missed four:
the question-generator's closed-set maps (F3 — re-arming the documented
v0.7.1 free-text corruption class, latent only because the LLM extractor's
schema lags), both spec twins (F6/F7), and the grounding doc's draft values
(F11). The rulebook additions themselves were clean — it is the SECONDARY
consumers, the ones not on the happy path of the feature being built, that
get missed. Standing mandate for future reviews of any schema change:
enumerate consumers of the vocabulary FIRST (grep the field-name across
src+specs+grounding), then check each got the update.

**RF-4 — reserved-word regressions keep arriving via honest copy.** Code
review 004: "rejected" entered a rendered register line via the R15
propagation commit (F2, blind-panel find), and the FIX PASS itself briefly
introduced "fired" into policy YAML that renders in the editor whose test
bans it — caught by the ritual, pre-commit. The banned-word list is
distributed across test assertions (/approved|rejected/i on the verdict
screen, "immutable" on the trail copy, "fired" on the policy editor) with
no single registry; a grep-able manifest of banned-rendered-words plus the
surfaces they bind to would convert this class from review-catch to
mechanical check.

## Anchor examples

**Worst — a duplicate id concealing an unbuilt requirement.** `TC-CS-1-02`
meant three different things across requirements, spec and code. CS-1's
safety margin was half-built for two months while the traceability matrix
reported it covered, because the code test carrying that id asserted
something else entirely. Cost: a Must requirement unbuilt and unnoticed.

**Worst — a documented lesson violated while visible.** `sample-register.ts`
used check-then-act on an append-only trail. `aigate-self-assessment.ts` sat
beside it doing it correctly, and CLAUDE.md documents the exact fix. Being
told is not the same as being guarded.

**Best — a latent defect caught by asking what the tests structurally cannot
see.** C-6 was invisible to 245 passing tests because the inheritance block
only renders when a platform is declared and no test declared one. Panel D
found it by reading the convention rather than running the suite.

**Best — honesty machinery verified rather than assumed.** Panel E confirmed
placeholder quotes genuinely produce their caveat, `[FIRM]`/`[DATE]` reads as
unsigned, and OB-1..5/PV-4/PV-7 are unclaimed anywhere in code. Zero
Criticals on the product's core claim.

## Resolved this round

All 13 Critical and Important findings fixed and verified (253 tests, 3
consecutive runs, tsc, build, parity R1–R7, live browser check).

## Round 2 (code) measurements — 2026-07-28

Range `f256308..HEAD`: 8 commits, 38 files, +4652/-565, built entirely outside
the GVM discipline. Verdict **Merge with caveats**. 3 Critical, 3 Important,
3 Minor.

**Capture-recapture.** Panels A (3) and D (4) overlapped on 1 finding.
Lincoln-Petersen: (3×4)/1 = 12 estimated, 9 unique found, ≈75% coverage.
**One overlapping pair makes this extremely noisy** — the same caveat as round
1. Nominally <80% indicates a round 3; the finding distribution argues against
it, because 7 of 9 share one mechanical root cause and a third round would
mostly re-scan documentation.

**The single most valuable finding of either code round: the vacuous test.**
`track.test.ts` asserted `if (!assignTrack(g, tracks))`. `assignTrack` returns a
`Result` OBJECT — always truthy — so `unrouted` could never be populated and the
test passed against ANY policy. Proven by deleting TRACK-I and watching all four
tests stay green. It was written specifically to guard the defect class that had
already shipped twice, it guarded nothing, and its green tick was cited in the
policy comments, the commit message and the round-002 report as proof of
totality. **A test that cannot go red is worse than no test, because it is
quoted as evidence.** Fixed, plus a mutation guard that breaks the routing on
purpose and requires the checker to notice.

**RF-2 confirmed again, at scale.** 7 of 9 findings are one root cause: the
pack deletion was applied to code and policy and propagated to nothing else —
README, `specs/policy-schema.md` + `.html`, two MUST-priority test cases in both
twins, `docs/approach.md`, `docs/rules.md`, `backtest/use-cases.md`. Shared rule
24. `spec-parity-check.py` reads only `.md` and structurally cannot see the
`.html` half.

**Cross-panel synthesis that neither panel could reach alone.** Panel A verified
`docs/rules.md` regenerates byte-for-byte identical; Panel D found its header
count wrong. Both correct — the defect is in the GENERATOR, not the file.

**Where the defects were, again.** Zero engine defects survived inspection.
Panel B returned zero findings and Panel C cleared totality, reachability,
subsumption, termination and ordering by programmatic enumeration. Every
Critical was either a test that could not fail or a document contradicting
shipped behaviour. Recency still predicts density — but this round says
something sharper: **the code was fine and the claims about it were not.**

## Open

**SR-1 — PV-2 and PV-5 unreachable from intake.** `deferred — awaiting
triage`. Promotion route to `requirements.md` not yet chosen. Re-prompt at
the next checkpoint per shared rule 27.

## For round 3

1. Strict criterion continues. **Dual review triggers** (shared rule 16 — two
   completed code rounds now exist).
2. **Standing mandate: hunt vacuous assertions.** Round 2's Critical was a test
   that could never fail. For every test that guards a named defect class, the
   reviewer must mutate the thing under guard and confirm the test goes red.
   Reading the assertion is not verification.
3. **Standing mandate: RF-4.** For every fix in the range, ask what it displaced
   — check the rule immediately after it in any ordered list, and every sibling
   of the rule that was changed.
4. Verify documentation claims against behaviour, not against other documents.
   Round 2's remaining Criticals were all prose contradicting shipped code.
5. An R8 parity rule for `.md`/`.html` divergence is now overdue — RF-2 has
   recurred in three consecutive rounds.

## For round 2 (superseded — retained as the record)

1. Apply the strict criterion (consumer FAIL only).
2. Standing mandate: hunt the RF-1 variants R6 cannot pattern-match.
3. Weight panel attention toward recently-written code.
4. Consider an R8 parity rule for `.md`/`.html` divergence.
5. Dual review does not trigger until round 3.
6. Ship-ready achieved in run 002 after explore-001 found D-001 (Critical),
   it was fixed, and explore-002 confirmed the fix.

## Lesson from the 001 -> 002 sequence

The verdict got WORSE before it got better. Run 001 returned Demo-ready with
VV-2(c) failing purely because no exploratory session existed. Once one did,
VV-2(c) passed but VV-4(d) triggered on the Critical that session found — a
re-run at that moment would have been Not shippable. Only fixing D-001 and
re-testing produced Ship-ready.

Demo-ready in run 001 was therefore partly a reward for not having looked.
Worth remembering when a gate passes on absence of evidence.

**Methodology gap:** `ExploreDefect` has no `resolved` field, so a fixed
defect cannot be marked fixed inside its artefact. Clearing VV-4(d) requires
an entirely new session, which creates pressure to edit the record instead.
`explore-001.md` was deliberately left unedited. A `resolved:` / `fixed_in:`
field would close this.

**RF-3 — the guard existed but not everywhere.** D-001 was the same
state-lands-too-late pattern as code-review C-5, on a handler that lacked the
ref guard its neighbours had. explore-002 checked adjacent surfaces (2LoD
approve) and found them guarded, so the defect was isolated rather than
systemic. When a defect class is fixed in one place, audit every sibling
call site — not just the one that failed.

---

## Round 1 (design) measurements — 2026-07-29

First recorded design round. `design-review-001.html` exists but carries no
verdict string and no score-history row, so there was no design baseline; this
round establishes one.

**Capture-recapture.** 3 cross-panel overlaps (B∩C ×2 on `onCorrect` and
`findLatestVerdictEvent`; C∩E ×1 on the missing `verdict_id`). Lincoln-Petersen
across those pairs estimates ~11 against 15 unique found — coverage above the
80% threshold, so R2 was not indicated. Treat the estimate as soft: three
overlaps is a thin basis.

**Panel yield.** A 2, B 5, C 4, D 5, E 3, F 1. Panel B and Panel D carried the
round — both by reading source rather than specs. Panel A's single Important
(R3-JU-6 untraced) was the one finding no code read could have produced.

**The dominant failure mode, and it is not new.** Both Criticals and two
Importants (I-1, I-5) have one cause: a claim written into a spec and never
checked against the code it describes. Specifically — the sign-off payload was
assumed able to carry a verdict reference; the reclassification affordance was
assumed suppressible by not mentioning it; control evidence status was assumed
to live on the Verdict; StrictMode semantics were assumed backwards. Each check
was one command.

This is the third occurrence in recent project history: charter 003's D-002
(claimed a form field absent that was present), the Phase 8 query-tightening
premise (claimed tests would break that could not), and now these four. Round
2 (code) already recorded "verify documentation claims against behaviour, not
against other documents" and its Criticals were all prose contradicting shipped
code. **Two consecutive rounds is the promotion threshold under shared rule 21
approaching; a third makes it mandatory.** Promoted to a build check now rather
than waiting — see `build-checks.md` BC-001.

**What held.** ADR-EE-R3-1 was probed by two panels as possible scope creep and
independently defended by both. Panel F found the (H,H) risk lower than the tree
assumed — `VerdictDisplay` has no effects at all. No vacuous tests in the
original 33, which is a change from round 2 where the Critical was exactly that.

## Anchor examples — design (new)

**Worst, contracts (score 6):** register-lifecycle §15.1 stated the
reclassification affordance was "deliberately not carried over" while
`VerdictDisplay`'s `onCorrect` prop was required and its button ungated. The
spec described an outcome the component could not produce.

**Worst, coverage (score 8):** R3-JU-6 ("a Provisional verdict states its
cause") was never traced onto the sign-off page — a rendering surface the same
round created. The requirement was not scoped to one screen; the design assumed
it was.

**Best, structure (score 7 despite):** ADR-EE-R3-1 diagnosed a real pre-existing
duplication, rejected the cheap fix with a stated reason, and disclosed the
scope expansion in the chunk plan. Two panels probed it for scope creep and both
cleared it.

## For round 4

1. Strict criterion continues. Dual review now genuinely triggers — three
   completed rounds across types.
2. **BC-001 applies** (see build-checks.md): every spec claim about an existing
   symbol must cite the file:line it was verified against.
3. RF-2 (.md/.html divergence) recurred again this round — four consecutive.
   Round 3 mitigated it for requirements and test-cases by generating the HTML;
   the four domain specs are still hand-maintained twins and drifted twice
   during this session's edits, caught only by scripted probes. Generating them
   is now overdue.

| 2026-08-04 | /gvm-test 003 (full mode, post-Phase-8) | Demo-ready | 148 cases walked: 123 PASS, 7 FAIL, 9 STUB, 5 deliberate deviations, 1 BLOCKED. VV-2(a) failed; no VV-4 trigger. Systemic finding: five deviations decided in code comments and never written back to requirements.md. |
| 3 | 2026-08-07 | code | A,B,C,D,E,blind | 1 | 5 | 2 | **Merge with caveats** — 3 of 6 findings introduced during the round-4 fix pass; blind panel found the identity gap |

## Doc review round 1 (2026-08-25) — "After Deployment" briefing

**Scores (Panel D, analytic):** Argument 9 · Factual integrity 8 ·
Evidence transparency 7 · Prose/audience fit 7 · Dataviz 9 → **8.0
overall** (whitepaper threshold 9.0; public-facing 9.3).

**Capture-recapture:** ~30 unique findings, only 2 confirmed cross-panel
overlaps (Fig-2 arithmetic B∩D; dek A∩C) — sparse overlap implies
estimated coverage well under 80%; **R2 recommended** after fixes.
**Borderline filter:** 5 raised, 3 kept (60%).

**Anchor examples (doc dimension):**
- Factual integrity, worst: "EU AI Act high-risk live 2 Aug 2026" —
  false at publication (Digital Omnibus postponed Annex III to Dec
  2027, OJ 24 Jul 2026); survived TWO editions and a 4-agent research
  pass because everyone verified the statistic's original source, not
  its current status. Regulatory-status claims age; re-check at every
  edition, not just at first citation.
- Factual integrity, worst-2: Fig-2 caption exclusions double-counted
  (654+323+3≠977); panels caught what the author's own arithmetic
  missed. Always have someone re-add the figure captions.
- Evidence transparency, best: withdrawn-statistics paragraph naming
  what failed verification and why — panels called it exemplary.
- Dataviz, best: bar-width encodings spot-checked to reconcile with
  labelled counts within rounding across all figures.

**Recurring-candidate (watch in R2):** press-graded stats drifting into
settled-fact prose (Stanford/McKinsey pattern); ledger scope gaps
(claims that aren't numbers escaping the ledger).

## Doc review round 2 (2026-08-25) — strict, same day

**Key lesson: fixes create defects.** Both genuinely new R2 findings
were introduced BY R1 fixes (the closing verdict contradicting the
build-status box; the no-common-cause caveat breaking the "four
mechanisms" framing), and Panel D measured a prose REGRESSION (long
paragraphs 2→6) caused by fix-density. Verification rounds must diff
the fixes, not just re-scan the document.

**Second lesson, confirming R1's:** the IBM "63% no AI governance
policy" was the same either/or-combined-stat error already fixed once
for the Wolters Kluwer 72% — the correction standard must be applied to
ALL stats when one instance is found, not just the flagged one.
Candidate build-check if it recurs in R3.

All external spot-checks this round verified verbatim at primary
sources (Fed FEDS Notes, EUR-Lex OJ date for Reg 2026/1744, IBM 20%/
+$670K); MAS consultation confirmed via cache.

## Design review round 2 (2026-08-31) — verdict/sign-off screen, audience hospitality

**Scores (full review):** Requirements coverage 6 · Interface contracts 5 ·
Structural soundness 6 · Implementability 8 · Security 10 · Audience
hospitality (Panel G, supplementary) 3. No dimension gap flagged as
structural — every finding, including the core one, has a proven fix
using patterns already in the codebase.

**Multi-panel convergence — the strongest signal this round.** Four
independent panels (A, C, D, G) landed on the identical root cause and
fix mechanism for the review's central finding ("Why this verdict" has
no fold seam) without seeing each other's output. This is the pattern
calibration should watch for going forward: when 3+ panels converge
unprompted on one fix, treat it as high-confidence even before manual
verification — though manual verification still ran and confirmed it.

**Anchor examples:**
- Worst, audience hospitality: the sign-off checklist (the screen's
  designated "fast first read") leads with a bare rule ID before any
  plain-language gloss reaches the reader — found independently by 4
  panels, the single clearest instance of "jargon precedes its own
  gloss" in the whole review.
- Worst, interface contracts: `RegisterDetail.tsx`'s audit-trail
  timeline renders the literal word "rejected" — a live violation of
  the project's own explicit reserved-word rule (HR3-08), caught by a
  panel whose mandate was contract mismatches, not reserved words —
  cross-panel scanning found what a reserved-word-specific check would
  have caught directly, worth noting as a coverage argument for keeping
  panels orthogonal by defect class rather than by area.
- Best, implementability: every Critical finding except the core one
  had a working precedent already in the same file — `findRuleDescription`
  used two hundred lines away for an identical problem, `STAGE_LABELS`
  correctly used for the same field the audit trail gets wrong. The
  fixes are consistency fixes, not new capability.

**Recurring-candidate, watch in future rounds:** ID-before-gloss is now
confirmed as a *pattern*, not a single defect — 6 separate instances
found this round alone. If this recurs in a future round after the
current fix pass, promote to a build check (grep for bare `{verdict.*id}`
or `<code>{...}</code>` renders with no adjacent label resolution).

## Design review round 3 (2026-08-31) — verdict screen information
architecture and narrative flow

**Scope note.** This round did not re-scan for jargon or leaked IDs —
that class was round 2's job and is fixed. This round targeted a
different defect class entirely: the screen's *shape* — is it organized
by data type (one panel per engine field) or by narrative arc (decision
→ why → action → risk → record)? The owner's own diagnosis and a
sketched 5-beat restructure (Minto Pyramid Principle) were the object
under review, not the code as-shipped — a deliberate departure from
prior rounds, where the review target was always the current build.

**Scores (full review):** Requirements coverage 7 · Structural soundness
6 · Implementability 7 · Security 9 · Audience hospitality (Panel G,
supplementary) 7. Panels B (interface contracts) and F (quality
attributes) did not run — no API/data contract changes and no new
quality-attribute scenario in scope; both explicitly recorded as
not-applicable rather than silently skipped.

**Multi-panel convergence — again the strongest signal.** Two
independent pairs of panels, each scanning for an unrelated defect
class, converged on the same two problems in the *proposal itself*: (C
+ G) on beat 4 being a forced grouping — only expiry-conditions
actually fits "what could change this"; (A + D) on the binding-constraint
deletion resting on a false premise — the appetite line the proposal
claimed made it redundant never actually renders the rule ID at all.
Consistent with round 2's finding: unprompted convergence across
orthogonal panels is the highest-confidence signal this methodology
produces, this time catching flaws in the *reviewer's own proposal*
rather than in shipped code — the panels did not rubber-stamp the
diagnosis they were handed.

**Anchor examples:**
- Worst, structural soundness: beat 4 ("what could change this") bundles
  fragility (present-tense, not forward-looking), inheritance
  (provenance, not risk), and living-status (a status readout) alongside
  the one panel that actually belongs there (expiry) — bucketed for
  beat-count symmetry, not conceptual unity. The clearest instance this
  project has produced of a synthesis step imposing a clean-sounding
  structure the underlying content doesn't actually support.
- Worst, audience hospitality: the proposal folds beat 4 away by default
  for non-2LoD readers — hiding "this decision could expire or fall
  apart" from exactly the first-time, non-technical reader the owner
  named as the person they're most worried about losing. A fix aimed at
  that reader that would have made their actual worry *less* visible if
  built as sketched.
- Best, implementability: Panel D produced a concrete, six-step
  incremental build sequence (each step independently shippable and
  test-verifiable) rather than treating the restructure as one big-bang
  change — directly actionable, no further design work needed to start
  building steps 1-4.

**Recurring-candidate, watch in future rounds:** this is the second
round in a row (round 2, round 3) where a reviewing panel found a real
defect the main-loop synthesis had missed *before* dispatching the
panels — round 2 found the reserved-word "rejected" leak outside its
own mandate; round 3 found the binding-constraint deletion's premise
was factually wrong. If a third round produces a similar catch, promote
"synthesis-stage claims about existing code get independently verified
by at least one panel before being treated as ground truth" to a
standing process note in this skill's Hard Gates, not just an
observation here.

**Root-cause finding, not just a defect list (Panel A):** no requirement
in this project forbids internal spec-ID leaks into rendered text, and
none specifies fold-state-by-audience — that requirements gap, not a
coding mistake, is why 5 prior design rounds (R9, R12, R13, R14, R15-C2)
never caught this. The fix pass this round should close the code-level
defects AND add the missing requirement, or the class of bug can recur
in a future feature.

## Design review round 4 (2026-08-31) — app-wide narrative flow

**Scope note.** The owner asked to apply round 3's audience-hospitality
lens to every screen in the app, not just the one it was built for.
Nine screens/steps (the 6-step intake flow, the register list, the
appetite framework, rule challenges + about) were scanned in parallel
by Panel G, one sub-panel per screen — the first time this skill has
fanned a single panel out across that many independent targets in one
round. Four holistic panels ran once, app-wide, excluding the verdict
screen (already fixed). No Panel B/F — same rationale as round 3.

**Scores (full review):** Requirements coverage 6 · Structural soundness
5 · Implementability 6 · Security 9 · Audience hospitality (Panel G,
averaged across 9 screens) 4. Lowest Panel G score of any design round
run so far on this project — worse than the verdict screen scored
*before* round 3's fix (3/10).

**Multi-panel convergence — the strongest signal, again, but this time
about a systemic gap rather than a single defect.** Three panels
(A, C, D), each scanning for an unrelated defect class, independently
converged on the same root cause: round 3's fix was built as a
one-screen patch, not a reusable house convention, so it could not
propagate. Panel A found NF-11 already violated on two other screens
(regression-by-omission, not a new gap). Panel C and Panel D
independently found the `Fold` component that made the fix work is a
private, unexported function — reinvented three different ways
elsewhere with three different accessibility semantics, rather than
reused once. Three-panel convergence on a *process* gap, not a code
defect, is a new pattern for this project's calibration history — worth
watching whether it recurs.

**Anchor examples:**
- Worst, audience hospitality: the intake flow's duplicate-check step,
  where the on-screen instruction text for a non-2LoD user ("contact
  AI Risk to adopt") is directly contradicted by a fully clickable
  button right next to it that performs the adoption itself with zero
  role gating — the screen's words and its only interactive affordance
  disagree with each other.
- Worst, requirements coverage: `NF-10` rendered bare, unglossed, inside
  an `alert`-role banner on the Appetite framework screen — the single
  highest-visibility NF-11 violation found, because alert-role content
  is precisely what a screen reader or a scanning eye lands on first.
- Best, implementability: Panel D didn't just flag the Fold-reuse gap,
  it ranked all four candidate screens by fix risk (RuleImprovementQueue
  easiest → graph-review step hardest, with a named reason for each) and
  caught a real DOM-semantics trap in advance — swapping PolicyEditor's
  hand-rolled disclosure for the extracted Fold would change whether
  collapsed content is removed from the DOM or merely hidden, which an
  existing test already guards, but only if the implementer knows to
  check it.

**Recurring-candidate, now confirmed a pattern across 3 consecutive
rounds:** round 2 found a defect outside its panel's own mandate
(reserved-word leak), round 3 found the reviewer's own proposal
contained a factual error, round 4 found the reviewer's own round-3 fix
never propagated past the screen it shipped on. Per the round-3 note,
this is the third instance — promote "synthesis-stage claims about
existing code or prior fixes get independently verified by at least one
panel before being treated as settled" to a standing process note in
`gvm-design-review`'s Hard Gates, not just an observation here.

**Process implication, not just a defect list:** the implementation
path for this round explicitly sequences "extract Fold into a shared
component" as step 1, before any screen-specific fix — every other
fix in this round's findings depends on that extraction existing.
Future design reviews of newly-added screens should check reusable
patterns (Fold, NF-11's gloss discipline) as part of Panel A's
requirements-coverage pass by default, not wait for a dedicated
app-wide round to discover the drift.

## Code review round 5 (2026-09-28) — hand-off bundle + control attestation, pre-v1.0.0 gate

**Scope and shape.** 6 commits / 41 files since code-review-004. 13 panels (A–E, G, each
calibrated + blind; F mechanical). Strict criterion. EBT linter 0; stub detection 0.
72 raw findings → 29 after de-duplication (8 C / 14 I / 7 M) + 3 observations. Owner
disposition: fix all 29 before tagging v1.0.0.

**Where the defects clustered.** 20 of 22 C+I findings sit in the hand-off import — code
built in one session, tested only through its store API with well-formed synthetic
bundles, and never through its UI. The attestation write path itself came through clean.
Lesson: a feature that reads a FILE FROM ANOTHER PERSON is an input boundary, and was
built as if it were an internal call (outer-shape zod check, `.passthrough()` inside).

**Anchor examples:**
- Worst, honesty (G, both twins): "The bundle is sealed: any change in transit is detected"
  over an unkeyed SHA-256 anyone can recompute — the product's own NF-2 "tamper-evident,
  not tamper-proof" discipline was applied to the local trail and forgotten for the new
  surface. Same class: "a backup was downloaded first", asserted whether or not it was.
- Worst, logic (C both, B both, G both — 6 panels): replace proceeds after a swallowed
  backup failure. Highest-convergence finding of any code round so far.
- Worst, traceability (A both, D both, G blind): features labelled with requirement ids
  that already mean something else (RG-6/RG-7) — invisible to trace-check, which only
  reads TC ids. A mechanical check covers only the id namespace it was written for.
- Best, blind-only: F7 — the audit spec and its guard test still assert "no clear"; the
  guard is a keyword blocklist the new `replaceAllRawEvents` name evades. A blocklist
  test cannot guard an allowlist invariant.
- Best, concurrency (E calibrated): the prefix check reads outside the write queue it
  feeds — the write-queue docstring guaranteed append-vs-append only, and the new
  read-then-write path silently fell outside that guarantee.

**Recurring:**
- **RF-3 (new-vocabulary propagation) — second consecutive round.** The new "attested"
  tier reached WhatToDo and SignOffChecklist but not the evidence-status panel (F8), and
  "in place" was reused for a different aggregate (F11). One more round → build check.
- **NEW candidate RF-5 — a claim about a safety mechanism stated unconditionally in copy.**
  F1, F2, F14 (and the diverged message). Watch next round.
- **NEW candidate RF-6 — an import/file boundary validated at the outer shape only.**
  F3, F4, F13, F20.

**Self-caught this session, recorded for honesty:** the chair's own trace-check (written
the same day) under-counted range-notation rows — found by Panel C (F22); the individual
cases were verified tested by grep before inclusion.

**Fix round 1 re-review (same day, panels B, C, E, G, strict).** 27 of 29 verified fixed;
F6 and F16 partly closed. 9 NEW findings in the fix code itself (4 C / 2 I / 3 M), all
around the hand-off replace and the review-folding helper. Owner: "Fix all 9" (round 2 of 3).
- **RF-5 confirmed (second sighting within one round):** the round-1 fix added a new
  unconditional safety claim — "Your previous register is in the backup file you saved" —
  while the two-step flow it introduced opened a window (sign off a case between backup and
  replace, same tab) in which that claim is false (N2), and a catch-all suffix "your
  register was not changed" after the audit trail had in fact been replaced (N1, 2 panels).
  Lesson: every message on a destructive path must be derived from what actually happened,
  never appended as a fixed sentence.
- **New anchor, concurrency (E):** a queue added to fix one race (F17) made a second
  ordering DETERMINISTIC — a register-queued step awaiting the audit queue — reproduced in a
  standalone harness (N3). Lesson: never wait on another store's queue while holding one.
- **RF-6 recurs inside its own fix:** import validation tightened every event field except
  the nested verdict's `confidence_caveats`, which a downstream reader dereferences (N4).
  Validate what consumers read, not what the schema author thought of.
- **Chair's own addition caught by a panel:** the "same check under another name" helper,
  tightened by the chair to ≥2 significant words, is still a subset match (N6) — equality of
  word sets is the defensible rule.

**Fix round 2 re-check (round 3 of 3, panels B, E, C+G, strict).** N1–N9 all verified; 5 new
(2 C / 1 I / 2 M), owner: fix all 5 with tests, no 4th round → verdict Merge with caveats.
- **NEW candidate RF-8 — recovery state for a destructive multi-step flow lived only in React
  memory.** The half-finished replace could be finished only while one component stayed mounted;
  a reload or view switch lost it, and re-importing said "up to date" (R3-1). Same root: a second
  import could overwrite the pending decision (R3-2). Lesson: any state that means "the stores
  disagree until the user acts" must be re-derivable from the stores themselves.
- **Pre-existing defect surfaced by a contract sweep:** the challenge memo was the one reader of
  `verdict.explanation` (of eight) without a guard (R3-3) — found by Panel B grepping every reader
  while verifying N4. Sweeping all consumers of a field is cheap and keeps finding these.

## Design review 006 round 1 (2026-10-02) — plain-language intake + verdict contract (R16)

**Scope and shape.** A build contract (build/prompts/R16.md v1), reviewed before any code by six
panels (A–E always-on + F comprehension, the one high-importance/high-risk utility-tree leaf).
Liberal criterion. 47 findings after de-duplication (15 C / 19 I / 13 M), all in the contract.

**Anchor examples:**
- Worst, security (E): free-text supplier names "matched to the firm's list" would let a submitter
  type an assessed supplier's name and inherit its approved limits — the exact adversary the
  review was told to look for, missed by the author because the design was written for the
  honest submitter. Same class: "Not sure" on reversibility mapped to a value no hard line matches.
- Worst, structure (C): the first screen would have become the FOURTH independent computation of
  "is this control outstanding?" on one page — the class that produced code review 005's F8.
- Best, requirements (A): moving all existing content into a fold "for your AI risk team" would
  have hidden the submitter's own correction button and the medium-confidence caveat.
- Best, implementability (D): a required engine input (processing zone) had no source at all.

**Recurring / new patterns:**
- **RF-6 (boundary validated at the outer shape only) recurs at design time:** identity of
  reviews, suppliers and platforms was specified for the happy path only.
- **NEW candidate RF-7 — a design written for the honest user.** Every new free-text, "Not sure"
  and firm-edited surface needs a named adversary before it is specified (threat model now
  mandatory in R16 v2 §0.1).

**Self-caught, recorded for honesty:** the chair wrote the contract and its worked example used a
description where its own definition required an id (CTRL-INDEP-VAL-01 → SS1-UK-REV-01).

## Explore rounds 3-4 (2026-08-31) — persona demo, then confirmation

**Scope note.** A different exploratory format from rounds 1-2: not a
practitioner walking the live UI, but a three-agent roleplay (a founder
persona, a skeptical bank persona grounded in a real institution's actual
governance process, a consultant persona synthesizing) reacting ONLY to
what the live, published site actually says — the About page and one
real verdict screen, pulled fresh via the browser before the roleplay
ran. Tests self-explanation and claim-accuracy, not UI mechanics.

**Round 3 findings, ranked by the consultant persona's own blocking-ness
scale:** audit trail not tamper-evident (Critical — vetoes any live-
decision framing on its own); Track/Tier never mapped to a real bank's
committee structure, coverage-gap queue with no visibility or teeth
(both Important); margin-of-safety number rendered with unwarranted
confidence (Minor). The consultant explicitly flagged the audit-trail
item as "future-phase infrastructure" appropriate to defer — the owner
overrode that recommendation and asked for it to be built now, not
deferred.

**What got built, not just labeled.** The audit-trail fix is the
anchor example for this round: rather than softening the "not tamper-
evident" copy, store/audit.ts now computes a real SHA-256 hash chain
over the whole trail, verifyChain() detects tampering by actually
recomputing it, and RegisterDetail runs that check live and renders
its real result. Building it surfaced two genuine bugs neither the
roleplay nor a code read would have found: a concurrency race in
concurrent append() calls (fixed with an internal write queue) and a
pre-existing fire-and-forget append() on the busiest intake path,
invisible until hashing made every write slow enough to expose it.
Both were caught by the verification ritual's 3x-consecutive-run rule
doing exactly the job it exists to do — the flake was real, not noise.

**Round 4 (confirmation) — the strongest form of verification this
project uses.** Not "were the fixes made" but "does an independent,
fresh-context skeptical persona reviewing the live product cold reach a
different conclusion." Three of four findings confirmed closed by
direct inspection: the chain-integrity line is genuinely live-computed,
not asserted; the governance-mapping line names a real committee
in-product; the calibration wording no longer implies false precision.
One item (completion tracking) stayed open — correctly, since fixing it
was never in scope this round — and the persona itself distinguished
"made visible and honest" from "actually fixed," which is exactly the
distinction this project's honesty requirements (NF-2, design-vision
L-3) exist to preserve. A tool that can talk a skeptic partway to yes
without lying about the rest is the product working as intended.

**Recurring-candidate, now confirmed across explore rounds specifically
(not just design rounds):** both explore round-2 (2026-07-27) and this
round-4 used the same pattern — a confirmation pass with a fresh or
independent perspective, run immediately after a fix, rather than
trusting the fix description. Worth formalizing as a standing practice
for any Critical-severity explore finding: fix, then re-run the same
scenario cold before considering it closed.

## Design review 007 (2026-10-02) — R16 delta: walkthrough fixes (built), the "No" screen and the description path (plans)

**Scope and shape.** Round 3 of the R16 lineage, strict, dual review: seven
panels (A–E always-on; F1 first-time comprehension and operability and F2
audit-trail integrity of new writes — the two High/High utility-tree leaves),
each run calibrated and blind — 14 Sonnet panels. R16-W was reviewed
retroactively: it had been built without a cleared design review (a DR-1
breach the owner caught by asking "are you following GVM?"). 108 raw findings
→ 34 consolidated + a batch of 5 minors: 10 Critical, 23 Important. Scores
(calibrated/blind): A 6/6, B 3/4, C 4/6, D 5/4, E 5/5, F1 4/4, F2 3/3.
Hallucination check: 12 load-bearing quotes from 9 panels verified verbatim;
one panel claim corrected at synthesis (BC-7 said an unknown-field bundle
imports silently — it fails as a false "tampered").

**Dual review earned its cost again.** 15 of the 34 consolidated findings rest
wholly or partly on blind-only reports, including all three cross-tab and
abandonment integrity defects (F2B-7, F2B-8, F2B-1) and the leftover machine
words on the review screen (F1B-1, F1B-3).

**Anchor examples:**
- Worst, implementability/contracts: the plans asserted four facts about the
  existing code that were never true — a `SUMMARY_VALUES` export, a tick-all
  editor in GraphView (R16.md D-22), the guessed-field mechanism covering two
  new extraction fields, and a session value carrying assumptions to the
  verdict step. BC-001 existed precisely for this and was not applied by the
  plan's own author (the chair).
- Worst, integrity (F2): a hand-off bundle carrying any record field the
  importing version does not know is reported as tampered — the schema strips
  unknown payload keys before the seal and chain are recomputed.
- Best, requirements (A): both coverage matrices independently located all
  three partial requirements (UC-12, VD-10, NF-12) at the same seam — the
  parallel D2/E build.
- Best, operability (F1): the first review in this project to test the
  keyboard and screen-reader path; it found the requirement itself still
  says WCAG does not apply.

**Recurring patterns:**
- **BC-001 triggered (4 instances)** — see reviews/build-checks.md.
- **RF-6 recurs** (boundary validated at the outer shape only): hand-off
  `assumptions[].questionId` planned as "three strings"; the form's Q13
  mapping bypassing the single access-scope recogniser.
- **RF-7 recurs** (a design written for the honest user): W-9's zone answer
  and W-7's evidence scope are self-attestation levers no plan named.
- **Lesson — a live walkthrough is not a substitute for the design gate.**
  The walkthrough that produced R16-W found real defects, but building its
  fixes without a review re-created the same class it was fixing: plausible
  plans asserting unverified things about the code.

**Owner triage (2026-10-02):** fix all 14 built-code findings, after first
renaming the product AIGate → Counterpoise; rewrite R16-D2 and R16-E with every
fix and build them in order; adopt WCAG 2.1 AA for every new or changed screen
and fix the three known gaps; amend NF-12 so the newcomer test covers a "No",
a correction and a tick-all question; the pack-rule "No" limitation was not
approved — fix it in D2.


**Fix verification (2026-10-03).** Group 1 built as R16-F and verified line
by line: the main loop found five more defects the build agent had missed or
worked around (one test's fixture was bent to hide a duplicated message; one
test-case note claimed coverage through a mock) — fixed with tests. The plans
went to one independent read-only reviewer, whose report was then spot-checked
against the code before the owner saw it; it was accurate on every checked
point except one count ("20 of 21 closed" — its own table had 20 findings).
Lesson, again: a sub-agent's own verification measures what it was told to
count (test-case ids, a summary line), not what matters (every word carried
over, every claim true) — the main loop must check the substance. The same day
a model-written set of HTML twins passed its own id-count check while dropping
paragraphs and table rows; it was replaced by a deterministic converter
(`scripts/test-cases-html.py`) verified word for word.
## Build review loops (2026-10-03) — R16-F, R16-D2, R16-E

**Shape.** The `/gvm-build` independent review loop, run for the first time in
this project as the skill specifies (it had been skipped for earlier R16
chunks — the owner caught it by asking "following GVM?"). One fresh Sonnet
reviewer per pass per chunk, told what earlier passes found and fixed, held to
the Finding Quality Gate, reading code at the commit or in the working tree.
The main loop re-checked every finding against the code before fixing it.

**Measurements.**
- R16-F: `[(1,1),(2,1),(3,1),(4,1),(5,1)]`. Stalled — the stall rule fired at
  pass 5 and the owner was asked. Each finding was narrower than the last:
  a guard blind to multi-line imports → a dead Confirm button after a failed
  read → a stale "couldn't check" message → a millisecond-wide window where an
  old attempt could record old answers → a pre-existing, display-only window
  while the result was worked out.
- R16-D2: `[(1,0)]`. Converged on the first pass (one Minor, fixed).
- R16-E: `[(1,2),(2,1),(3,1),(4,1)]`. Each pass found a smaller wording gap on
  the description path; closed by the owner after the pass-4 fix.

**Anchor examples:**
- Best catch, R16-E pass 4: the review screen's "Why these values matter"
  lines are hidden until clicked, so every guard test — which scanned the
  screen as first drawn — never read them; one said "binding". Rendered-text
  guards must open every disclosure before scanning, and the copy tables
  themselves should be checked directly (TC-R16-E-83 does both now).
- Best catch, R16-F pass 2: a storage read outside any error handling left
  Confirm dead with no message and an unhandled rejection.
- Weakest evidence, R16-D2 pass 1: the reviewer cited line numbers that cannot
  exist in the files it named (`verdict-view-model.ts:948-4069`). Its claims
  were right, but only reading the code showed that — never trust a
  sub-agent's line numbers as evidence.

**Recurring pattern — the async gap.** All five R16-F findings after pass 1
sit in one place: the time between a person's click and the next screen. The
fix for each pass (an await added before a state change) opened the next
window. One pass over the whole lifecycle — every control a person can use,
from the click until the result is on screen — would have found passes 3–5
together. Use that as the check whenever a fix adds an await before a state
transition.

**Lesson, again: the main loop finds what the builder does not report.**
After each build agent reported "all done, nothing skipped", the main loop's
own verification found more (R16-E: machine talk in a note, a button the guard
missed, and a pre-existing output limit that made the description path fail
on a three-sentence description with the real local model). The live
walkthrough found the last of these; no test could have.

## Code review round 6 (2026-10-03) — the whole R16 redesign

**Scope and shape.** b1e146b..9348882 (15 commits, 51 production files, 73 test files). Strict criterion, dual review: six
lenses (A–E plus G honesty/plain-language/accessibility), each calibrated and blind — 12 Sonnet panels; Panel F run with the
mechanically assembled stub prompt; the EBT contract linter run with the shared helper. Then the gvm-graph verify step for the
first time in this project: 6 fresh-context checkers received only claims and cited locations (no reviewer reasoning).
Result: 6 Critical, 17 Important, 23 Minor, 5 observations; 1 claim disproven by its checker (CR6-28) and dropped; 10 claims
corrected (severity or reachability). Before this round the chair had been verifying in the main loop only — the owner's
"prompt-audit" request caught that, and the stub panel had been run as a home-made script rather than the assembled prompt.

**Capture-recapture.** Calibrated vs blind per lens (EBT hits excluded — both twins were handed them): A 34%, B 56%, C 35%
(no shared finding; Chapman), D 75%, E 100%, G 84%; pooled est. 80, found 43 → **~54%**. Below 80% → second full round
recommended and chosen. 15 of 33 Critical/Important findings rest wholly on one blind panel.

**Anchor examples:**
- Worst, contracts (B blind only — the B calibrated twin listed the opposite as "verified sound"): the hand-off import verifies
  the hash chain over the schema-PARSED events; zod rebuilds object keys in schema order; real verdicts are written in
  evaluate()'s order → every real case rejected as "tampered" since code-review-005 fix round 1 (3e4f119). Proven by a real
  export→import of the app's own self-assessment case; bisected (36c9a9b ✓, 498b8fd ✓, 3e4f119 ✗ … 9348882 ✗). Every test
  used a hand-typed minimalVerdict in the schema's own key order.
- Worst, logic (C calibrated): Back from the questions rebuilds the review step without guessedFields/provenance, so a
  model-guessed value reaches the result unasked — an ordinary navigation switching off a safety gate.
- Best, verification: the batch-6 checker disproved CR6-28 by finding the early return applies only to NON-corrections, and
  the batch-3 checker corrected a contrast claim's background (3.20:1 on --paper, worse than reported).
- Best, references (A calibrated): replaces_prior_model is required from the model but never in QUOTE_FIELDS, so a field that
  short-circuits Track II is never asked on the description path — while a test claimed the generator could emit it.

**Recurring / promotions (shared rule 21):**
- **RF-6 → promoted to BC-002** (code review 005, design review 007, code review 006 — three consecutive rounds): data
  crossing a boundary checked in one shape and used in another (hand-off key order; old saved-session shape; stale stored
  answers; stale country codes).
- **"Sample data shaped to pass" → promoted to BC-003** (code review 005 fixture-only hand-off tests; design review 007 fix
  verification — a fixture bent to hide a duplicate, pack countries spelled as words; code review 006 schema-ordered hand-off
  fixtures, a hand-typed coverage list, a test checking fieldsets only).
- **NEW candidate RF-9 — a safety gate switched off by ordinary navigation** (R16-F build loop passes 2–5; this round CR6-02,
  CR6-03, CR6-15). One more round → build check.
- **NEW candidate RF-10 — computed but never consumed** (CR6-10 correction_source, CR6-13 pack review names; the CLAUDE.md
  gotcha by name).
- RF-3 (new vocabulary not propagated): **no instance this round** (D calibrated looked for it explicitly) — streak broken.
- RF-5 (claim stated more strongly than the evidence): second code-round sighting — CR6-15's "probably confirmed in another
  tab or window" for a same-tab completion.

**Lesson.** A fix round re-reviewed only against schema-shaped fixtures shipped a total break of the feature it was fixing,
and two later review rounds plus a design review did not see it. A mechanism that verifies integrity must be tested with data
the real producer wrote, end to end — which is what BC-003 now requires.

## Code review round 7 (2026-10-03) — second full round of the R16 range

**Scope and shape.** b1e146b..9ecdee6 (49 commits, 56 production files, 86 test files), priority on the 27 files the CR6
fixes changed. Strict criterion, dual review across six lenses (12 Sonnet panels), Panel F via the assembled stub prompt,
the EBT linter as a script, then 3 fresh-context checkers (5/4/5 claims) that could copy the repo and run probe tests.
Result: 0 Critical, 12 Important, 28 Minor, 11 observations; 0 disproven; 2 downgraded (form-draft loss needs an invalid
policy → Minor; the reserved word inside a raw supplier id is test fragility → Minor); 2 mechanisms corrected.

**Capture-recapture.** A 62%, B 56% (Chapman), C 77%, D 40% (Chapman), E 64%, G 100%; pooled est. ~69, found 45 → **~65%**.
Spec/docs (D) and contracts (B) are where twins barely overlap — the next round's blind spots.

**Anchor examples:**
- Worst, logic (C calibrated + blind, A calibrated, checker probe): the CR6-03 fix carried the gate fields through Back only;
  "Change an answer", EVALUATION_FAILED and Back's own answers still drop the "Not sure" assumptions, and "Not on this list"
  then Back lets the AI's rejected supplier guess reach the result unasked. The fix text named all three re-entries; the
  build fixed one, and its tests used fixtures that could not see the other two.
- Worst, timing (E calibrated + blind, proved): the audit chain tip is cached per tab; the cross-tab lock orders writes but
  never refreshes it → a two-tab reviewer forks the append-only trail permanently. Invisible to jsdom (no navigator.locks,
  one module instance per test).
- Best, contracts (B calibrated): proved the CR6-01 hand-off fix with every seeded case and a maximal real assumption
  payload exported and re-imported in a scratch copy — BC-003 applied by the reviewer, not just the builder.
- Best, verification: checker V1 corrected CR7-02's field list (three of the five "dropped" fields were never carried on the
  confirmation step by design) and downgraded the form-draft claim on its precondition, rather than rubber-stamping.

**Recurring / promotions (shared rule 21):**
- **RF-9 → promoted to BC-004** (R16-F build loop, code review 006, code review 007 — plus design review 007): a safety or
  honesty field carried on one step and dropped on a return path (CR7-01, 02, 03, 28).
- **RF-5 → promoted to BC-005** (third code-round sighting): a claim stated more strongly than the evidence — CR7-09
  ("no sign-off needed" on a signed-off case), CR7-22 ("corrections preserved"), CR7-40 ("machine-verified"), O-8.
- RF-3 (vocabulary not reaching secondary consumers) **returned** after one silent round: CR7-12 (user docs still describe the
  old form), CR7-35 (model plain_name reached one of three consumers). docs/ is read by no check.
- RF-10 (computed but never consumed) — no new instance; CR7-11 is an unbuilt requirement, a different class.
- New candidate RF-11 — cross-tab state assumed per-tab-safe (CR7-05, CR7-18): one round.

**Lesson.** A fix whose own text lists several paths ("Back, and the EVALUATION_FAILED/CHANGE_ANSWER re-entries") was
closed on the first path only, and its review pass checked the path it was shown. The fix plan's path list must become the
test list.

## CR7 fix round (2026-10-04) — build review loops

**What the loops caught that the plan and builders did not.** FX7-1's four passes each found a real
defect in the previous pass's FIX (countries locked → Back after a re-entered review → correction
de-duplication skipping A→B after A→C → a synthesised correction writing null because the form rebuilds
node ids). The invariant "the trail's net value equals the evaluated graph" was only stated in pass 2;
once stated, passes 3 and 4 attacked it directly. Lesson: state the invariant a fix must preserve in the
fix instruction, and have the reviewer try to break it.

**BC-004 and BC-005 worked as build checks.** Both new checks fired inside the loops before merge: BC-004
on every re-entry path (FX7-1 pass 1), BC-005 on "you can start" with no sign-off on record (FX7-4 pass 2)
and "the policy was saved" when storage refused it (FX7-2 pass 2).

**Merge-time defects (main loop).** Three issues appeared only when wave-1 branches met: FX7-3's new
reference check refused FX7-2's new test policy; builders reused test ids (the parity R7 rule only
matches upper-case ids, so it missed `TC-CR7-02a`-style reuse); the register's model snapshot used the
raw policy while the engine used the expiry-applied one. Lesson: run the full ritual after EVERY merge,
not only at the end; R7 should be widened.

**Test hardening.** Under 16 CPU burners the intake suite went from 3–11 failures to 0 in three
consecutive loaded runs; the cost driver was character-by-character typing (3–4× faster with paste).

## Code review round 8 (2026-10-04) — review of the CR7 fix round

**Shape.** bdb5d50..ea01a1a, strict, dual review (12 Sonnet panels), Panel F with the corrected
allowlist (the round-7 `.stub-allowlist` was in a format the tooling rejects — found while assembling
this round's prompt, fixed 311e986), EBT linter, 2 fresh checkers. 0 Critical, 5 Important (one the
known docs item), 15 Minor, 12 observations; 3 claims downgraded, 0 disproven.

**Capture-recapture.** A 45%, B 67%, C 100%, D 40%, E 60%, G 67% — pooled ≈52%. Five panels
independently found the same stale-assumption defect (CR8-01); three proved the same planner defect
(CR8-06).

**Anchor examples:**
- Worst, logic (five panels): CR7-02 carried the "Not sure" assumptions through every re-entry, but the
  card-edit action on the revisited screen never removes one — the fix created the stage on which the
  false claim plays. A fix that carries state forward must also say what removes it.
- Worst, honesty (G blind, proved): the audit-trail wording written overnight ("a later change would
  show as a break") is false for deleting the newest entries; the register banner says "verified …
  unbroken". The chain has no tail anchor; integrity wording must stay modest.
- Best, verification: checker V8-1 downgraded the planner and tip-hint claims on their preconditions
  while still proving the mechanism, and split CR8-04 by surface (register banner Important, confirm
  notice Minor).

**Recurring / promotions.**
- BC-004 (RF-9) fired again: CR8-01 (card edit), CR8-03 (the confirmation hop), CR8-08 (correction from
  the result). The build check named paths; its acceptance criterion now needs the converse — for every
  field a fix carries forward, the actions that must REMOVE or RESET it.
- BC-005 (RF-5) fired again: CR8-02 (next steps contradict the headline), CR8-04 (chain wording), O-1/O-2.
  Lesson: test every surface that renders the same fact, not only the one the fix touched.
- RF-2 (twin drift): CR8-15 — the parity script still reads .md only.
- New candidate: "a fix's own residual list understates reach" — CR8-07 was stated as a rare identical-
  count case; it is the normal Clear-all-data + re-seed tester flow.

## Code review round 9 (2026-10-04) — review of the CR8 fix round

**Shape.** 4aea27e..a2fe323, strict, dual review (12 Sonnet panels) + Panel F + EBT linter + 1 fresh
verifier. 0 Critical, 2 Important, 13 Minor, 9 observations. One reported Important disproven on reach
(verifier probe: the stale multi-field "Not sure" sentence is unreachable from the app) → OB-1.

**Capture-recapture.** Calibrated set 12 distinct, blind 14, shared 11 → N̂ ≈ 15, found 15 (≈98%;
round 8 ≈52%). Both sets used the same common prompt, so treat as "small remaining population".

**Anchor examples:**
- Best, fix quality: every panel attacked P1–P5 directly (planner batches, the Back guard to depth 7,
  tier × stage × signed-off enumeration) and none broke. Writing the properties into the contract made
  the fix round reviewable.
- Worst, honesty (6 panels): the published user guide says a self-approval is disclosed as
  "self-service final"; the app shows "signed off by your AI risk team". The docs were re-verified for
  outcomes only, not for every claim.
- Worst, surfaces (4 panels, 2 probes): P4 listed headline, next steps, who-signs-off and stage note;
  the always-rendered "What you need to do" box was a fifth surface of the same fact.
- Worst, process (7 panels): O-4 and O-5, taken by the main loop in the plan, were neither done nor in
  the handover's not-taken list.
- Best, verification: a 2-vs-3 panel split on reach settled by one verifier enumerating every way a
  graph_review state can be built, with a reducer probe for the mechanism.

**Recurring / promotions.**
- BC-005 fired a third round (CR9-01, CR9-02, CR9-05): its "every surface" criterion now names the
  published docs (README, user guide, tester guide) as surfaces of the same fact.
- RF-2 twin drift again (CR9-08, CR9-09): the parity script still reads .md only — third round.
- New BC-006: every plan item ends in the handover as done (with its test) or not taken (with a reason).

## Parity Check History

| Date | Total | Per rule | Δ vs previous |
|---|---|---|---|
| 2026-10-02 (before design review 007) | 0 | R1–R8: 0 | 0 |
