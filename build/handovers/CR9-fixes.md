# Handover — CR9 fixes (code review 009)

*2026-10-04. Contract: `build/prompts/CR9-fixes.md` v2 (v1 checked independently before any code: 18 problems
applied). Owner triage: fix both Important (CR9-01 by rewording the docs — no self-approval flag built), all 13
Minor, and OB-1 properly (drop, not narrow); OB-2..OB-9 recorded only.*

## What was fixed, in plain words
- **One sign-off fact, every place on the screen.** When no sign-off is on record (or we can't tell whether one
  is needed), the "What you need to do" box, its "Then" row, the appetite line and the stage note now say so too —
  no part of the result says "Nothing." or "final" while the headline says to confirm the sign-off first. One
  wording, defined once, is used everywhere.
- **"Not sure" notes can't go stale.** Editing any field a "Not sure" note covers now removes the whole note
  (before, the note's field list shrank but its sentence — e.g. "it acts entirely by itself" — stayed).
- **The model line no longer implies a skipped question:** "No AI model is recorded for this use case — your AI
  risk team may ask which one it uses."
- **Policy save:** if queuing re-checks fails part-way, the app still switches to the saved rules at once.
- **Clear all data blocked by another tab:** the header's role goes back to 1LoD as the message says, and the
  message names "your audit trail" / "your register of use cases" instead of database ids.
- **Worked examples 7 and 10** are now pinned through the real form mapping and engine (both reviews asserted).
- **Docs:** the user guide, regulator brief and README no longer claim a self-approved case is flagged — they say
  nothing stops or flags it and the sign-off shows a typed, unverified name. The README's audit-chain wording
  matches the app. The user guide's rule count (23), "change the version yourself", and its reading order with the
  screen's real section titles; the tester guide's sample table (both rejections are hard lines; all six samples
  are provisional), its labels and stage name.
- **Specs:** verdict-audit.html gained the CR8 four-state sign-off section; register-lifecycle.html's §9 now
  describes the self-assessment that exists; spec twins for every code change; `test-cases/test-cases-031`.

## Every item (BC-006)
| Id | Disposition |
|---|---|
| CR9-01 | done — FX9-2 0baef41 (+ 582f6db); docs only, P8 notes in the builder report |
| CR9-02 | done — FX9-1 d39304c/da91f3b, f7e8f1b, ff21aa3; TC-CR9-02a..02e; TC-CR8-02a amended |
| CR9-03 | done — FX9-1 b8f6ca6/b95376a; TC-CR9-03; TC-CR7-06b amended |
| CR9-04 | done — FX9-1 fc71c76/893d748; TC-CR9-04; TC-CR7-11a..11i amended (guards re-pointed, not vacuous) |
| CR9-05 | done — FX9-2 0baef41 (README :101, :303, :308; regulator brief) |
| CR9-06, -07, -12 | done — FX9-2 4279712 |
| CR9-08 | done — FX9-2 0b64b19 |
| CR9-09 | done — FX9-2 884d472 (§9, traceability and test rows; changelog now true) |
| CR9-10, -11 | done — FX9-2 c38299e (samples re-run through the engine; temporary test not committed) |
| CR9-13, -14 | done — FX9-1 bc944fb/dc18d55; TC-CR9-13, -13-1, -14; TC-CR8-16b, TC-CR7-15-3 amended |
| CR9-15 | done — FX9-1 5e05198; TC-CR9-15a/b (cases 7 and 10 only — not every case) |
| OB-1 | done — FX9-1 506713b/19a1a3e; TC-CR9-OB1; TC-CR8-01f/01g/01j amended, 01d extended |
| OB-2..OB-9 | not taken — recorded only (owner triage) |
| Main loop | merges, spec twins + test-cases-031 (64418d8), ritual, walkthrough, this handover |

## Review passes
Format `[(pass, Critical+Important)]`; every Minor in every pass fixed.
- Plan check: 18 problems in v1 → v2 (9 would-go-wrong, incl. the same false self-approval claim in the
  regulator brief and README, and tests whose `.not.toContain` guards would have gone vacuous).
- FX9-1 code: `[(1, 1), (2, 0)]` — pass 1: the stage note still said "final" under a missing sign-off.
- FX9-2 docs: `[(1, 0)]`.

## Main loop
Merged FX9-2 then FX9-1 (no conflicts, no cross-builder reds); spec twins (intake-flow, verdict-audit,
register-lifecycle, cross-cutting, policy-schema) and test-cases-031 (+ test-cases-030 rows 01f/01g/01j amended);
ritual: `npm test` ×3 (1810 each), tsc, build, spec-parity clean, trace-check clean, no new reused test ids.
Live walkthrough (2LoD): a signed-off Medium case reads "signed off by your AI risk team" and shows the new model
sentence; a High case moved locally to Cleared with no sign-off reads "Not confirmed." in the headline, and the
next steps, the to-do box ("Also, no sign-off … confirm with them before you start"), the "Then" row and the stage
note all agree (the test case was restored afterwards); a policy save reads "Policy saved — 17 active use cases
queued"; no console errors. The blocked Clear-all path needs a second tab holding the database — covered by
TC-CR9-13/-14, not walked live.

## Known limits / notes
- Builder choices beyond the contract: the `in_production` stage note under an unconfirmed sign-off (review pass
  2); a throw from the success-path `onSaved` now propagates instead of reading as "save-failed"; the
  determined-self-service sweep fixture overrides tier/controls on a real evaluate() output (the form can't
  produce exactly one control at Low).
- Noted by FX9-2, not fixed (outside triage): glossary.md still uses "Governance margin"/"Standing conditions";
  register-lifecycle.html's older requirement tables (RG-…) are an older design than its .md; try-these/glossary/
  regulator-brief "no way to edit or delete" ignore Clear all data (OB-4).
- 16 test ids are reused from earlier rounds (CR6-era, e.g. TC-CR6-02c); none new. Worth a renumbering pass.

## Next (GVM)
`/gvm-test`.
