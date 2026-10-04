# Build contract — CR9 fixes (code review 009)

*v2, 2026-10-04 (v1 checked independently before any code: 18 problems — 9 would-go-wrong, 9 clarity — all applied in "v2 amendments" at the end, which OVERRIDE the item text above where they differ). Source: `code-review/code-review-009.html`. Owner triage: fix both Important (CR9-01 by
rewording the docs — no self-approval flag is built), all 13 Minor, and OB-1 properly (drop, not narrow).
OB-2..OB-9 recorded only. Build discipline: /gvm-build — TDD (red commit, then green), one id per test, fresh
Sonnet reviewer per chunk until a pass finds 0 Critical/Important, every Minor fixed. Run tests with `npm test`
/ `npm test -- <path>` only (never bare `npx vitest`). Never render the words "approved"/"rejected" in a new
verdict-screen string. Confidentiality rule (CLAUDE.md) applies to every line written. Line numbers below are
"cited" — re-find them before editing.*

## Properties the fixes must hold (reviewers attack these)
- **P6 — one sign-off fact, every surface.** When `view.signOffMissing` or `view.signOffUnknown` is true, no
  element anywhere on the verdict screen (headline, next steps, the "What you need to do" box, its "Then" row,
  who-signs-off, stage note, finish line) says or implies that nothing is needed or that the person can start.
  Test by rendering the whole VerdictDisplay in each state and sweeping its full text, not one element.
- **P7 — a "Not sure" note is listed only while every field it covers still holds the assumed value.** Any
  review-screen card edit (CORRECTION_APPLIED) or countries edit (JURISDICTIONS_SET) of a field an assumption
  covers removes that whole assumption (no narrowing), except the question-11 "somewhere else, or not sure"
  assumption on a countries edit (its sentence stays true). A legacy assumption with no `fields` keeps today's
  behaviour (dropped on any edit).
- **P8 — the docs say only what the app does.** Every sentence changed in docs/, README.md or specs/ is checked
  against the code or a render; the commit message or chunk notes cite where (file:line or test id) for each
  factual claim changed. BC-005 now names the docs as surfaces.
- **BC-006.** The handover lists every id below as done (commit + test id) or not taken (reason). The chair
  (main loop) items are tracked the same way.

## FX9-1 — code (one Sonnet builder, isolated worktree)
Files: src/components/VerdictDisplay.tsx, src/components/verdict-view-model.ts, src/components/intake-state.ts,
src/components/PolicyEditor.tsx, src/components/SettingsPanel.tsx, src/App.tsx, src/store/reset.ts (only if
needed), src/engine/try-these.test.ts, and their tests. Not docs/ or specs/.

- **CR9-02 (Important) — "What you need to do: Nothing." under a confirm-the-sign-off headline.** (cited:
  VerdictDisplay.tsx WhatToDo ~401-485, the zero-controls/zero-reviews branch, and the "Then" row ~636 which is
  keyed on `needsSignOff` only.) **Fix:** WhatToDo already receives `view`; in the zero branch, when
  `view.signOffMissing`, say "Nothing to put in place — but no sign-off from your AI risk team is on record for
  this version, so confirm with them before you start."; when `view.signOffUnknown`, "Nothing to put in place —
  but we can't tell yet whether your AI risk team must sign this off, so check with them before you start."
  (keep the existing `needsSignOff` sentence). In the controls/reviews branch, the "Then" group shows a row for
  missing/unknown too, worded the same way as the view-model's next step for that state (reuse one constant —
  do not write a third wording). **Tests:** TC-CR9-02a (Medium, stage approved, no events, no controls → the
  todo box does not start with "Nothing." alone and contains the confirm sentence), -02b (no stage → unknown
  sentence), -02c (missing with controls → "Then" row present), -02d (P6 sweep: for each of signed off /
  needsSignOff / missing / unknown / determined self-service, render the full VerdictDisplay with 0 and 1
  controls; for missing and unknown the whole text matches none of /you can start|nothing\.|no sign-off
  needed|nobody —/i except inside the confirm sentence — assert precisely; for determined self-service the
  existing permissive wording is still present).
- **CR9-03 (Minor, was O-5) — a part-failed policy save leaves the app on the old rules.** (cited:
  PolicyEditor.tsx ~137-141.) **Fix:** call `onSaved?.()` in the save-failed catch (the YAML is already stored);
  not in the store-failed branch. **Test:** TC-CR9-03 (make `onPolicyUpdated` reject → `onSaved` called once and
  the save-failed message shown; store-failed still does not call it — existing test stays).
- **CR9-04 (Minor, was O-4) — "No model was named" implies a skipped question.** (cited: VerdictDisplay.tsx
  ~1526; the register reuses the same line via `noModelNamed`.) **Fix:** neutral wording on every surface that
  renders it: "No AI model is recorded for this use case — your AI risk team may ask which one it uses." Keep
  the existing conditions (graph rule; `registerSaysNoModelNamed` on the register). Update the tests that pin
  the old sentence (VerdictDisplay.cr7-fx4, RegisterDetail.nomodel.cr7, ModelLinkFailure.cr7) and the comment
  in IntakeFlow (~1686). **Test:** TC-CR9-04 (an in-house form case renders the neutral sentence and never
  "No model was named").
- **CR9-13 (Minor) — incomplete Clear all data says the role was cleared; the header still shows the old
  role.** (cited: SettingsPanel.tsx ~113-122; App.tsx:37 `useState(getRole())`, `handleRoleChange` ~83.)
  **Fix:** SettingsPanel takes an optional `onRoleReset` prop; App passes a handler that runs the same path as
  choosing 1LoD in the selector (state + the ruleQueue fallback); SettingsPanel calls it on the incomplete
  path. The message stays true. **Test:** TC-CR9-13 (App-level: role 2LoD, Clear all data resolves incomplete →
  the header selector shows 1LoD and the message says the role was cleared).
- **CR9-14 (Minor) — the incomplete message prints database ids.** (cited: SettingsPanel.tsx ~117,
  reset.ts ~56.) **Fix:** the message names "your audit trail" / "your register of use cases" (map in the
  component; keep reset.ts's result shape unless a mapping there is cleaner — say which). No outcome words
  ("blocked", "error"). **Test:** TC-CR9-14 (incomplete for both → message contains both plain names and no
  `aigate-`).
- **CR9-15 (Minor) — try-these case 7 is not pinned through the real mapping.** (cited:
  src/engine/try-these.test.ts:117-137.) **Fix:** drive case 7 from the page's plain answers through
  `plainAnswersToFormValues` + `buildGraphFromForm` + `evaluate` and assert tier, controls and BOTH downstream
  reviews; do the same for case 10 (two reviews); if cheap, every case. Fix the stale title ("costs 8
  controls" → what it asserts). Keep the existing ids; new assertions get TC-CR9-15a/b. Must be able to fail
  (prove by temporarily breaking the expectation, then restore).
- **OB-1 (owner: fix properly) — narrowing keeps a sentence that names the edited field.** (cited:
  intake-state.ts `narrowAssumptions` ~679-692.) **Fix (P7):** drop any assumption whose `fields` include the
  edited field (no narrowing), keep `keepQuestionIds` for question 11 on a countries edit, keep the no-`fields`
  legacy rule. Rename the helper to say what it does (e.g. `dropAssumptionsCovering`) and update its comment.
  **Tests:** amend TC-CR8-01f/-01g (and any other narrowing test) to the drop behaviour — list each amended id
  in the chunk notes; add TC-CR9-OB1 (Q6 four-field assumption + autonomy_level edit → the assumption is gone;
  an unrelated field edit → it stays; countries edit → question 11 assumption stays).

## FX9-2 — docs and spec twins (one Sonnet builder, isolated worktree)
Files: docs/user-guide.md + docs/user-guide.html, docs/try-these.md, docs/tester-guide.md, README.md,
specs/verdict-audit.html, specs/register-lifecycle.html. Do not touch src/ or the .md specs. For every factual
sentence you change, check it against src/ (or a render via a test you run, not commit) and list the source in
your notes (P8). Keep both user-guide twins saying the same thing.

- **CR9-01 (Important) — the self-approval claim.** (cited: user-guide.md:236-238 and the marker table row
  :163; html :490, :428; try-these.md:344.) **Fix:** say what the app does: nothing stops a submitter approving
  their own case and nothing flags it — the record shows the sign-off like any other, with the typed name
  labelled not verified; segregation of duties needs a backend. Correct the "self-service final" table row to
  its real meaning (a case the firm's policy routes to self-service, shown on the result) and its location.
  Adjust try-these line 344 so it does not imply a distinctive record.
- **CR9-05 (Minor) — README chain over-claim.** README.md:101, :303, :308: use the tester-guide wording (an
  edited entry, or a deleted one with later entries after it, shows as a break; removing the newest entries does
  not; a full rewrite with recomputed hashes would not either). Grep the whole README and docs/ for "intact",
  "deleted", "tamper" claims and fix any other over-claim you find (list them).
- **CR9-06 (Minor) — "18 invariants".** user-guide :99, :171 (html :361, :436): the policy has 5 hard lines and
  23 invariants (`policy/appetite.yaml`); quote the real footer wording ("Evaluated against N hard lines and M
  firm rules (invariants)", VerdictDisplay.tsx ~347) or avoid hard numbers in examples.
- **CR9-07 (Minor) — "the policy version increments".** user-guide ~283-287 (html ~511): saving does not change
  the version; tell the editor to change the `version` field when they change the rules.
- **CR9-10 (Minor) — tester-guide sample table.** docs/tester-guide.md:89-97: verify every row by running the
  six samples through the engine in a scratch test you do not commit (or `src/seeds/sample-register.ts` + an
  existing seeding test). Known: deal memo is Out of appetite, Critical / Track I, hard line HL-002; the credit
  line is Critical / Track I, HL-001 — both rejections are hard lines; all six samples carry a provisional
  reason. Fix the row, the sentence and the Provisional column.
- **CR9-11 (Minor) — tester-guide labels.** :225-260 → the app's labels: "What kind of decision is it?",
  "Something else — describe it", "What could go wrong — and when this expires", "Anything your AI risk team
  should know? (optional)"; step 3 "pre-checked" → the register's label "Awaiting 2LoD sign-off" (check
  field-copy.ts STAGE_LABELS). Grep the tester guide for every other quoted label and check it exists.
- **CR9-12 (Minor) — user-guide "How to read a verdict".** :103, :110, :137 (html :363, :366, :377): use the
  screen's own section titles (find them in VerdictDisplay.tsx), and add the first screen (headline, "Your next
  steps", safeguards) at the start of the reading order.
- **CR9-08 (Minor) — verdict-audit.html lacks the CR8-02 "four states" bullet.** Port specs/verdict-audit.md:431
  into the html's CR8 amendments list (and check the html's CR7-09 pointer now resolves).
- **CR9-09 (Minor) — register-lifecycle.html §9.** Replace the html's §9 (runSelfAssessment/BankAppetite design
  that does not exist) with the .md's §9, including the CR8-10 "use-case node written last" note; fix the
  html changelog row that claims §9 was amended.

## Main loop (chair) — tracked under BC-006
- Merge FX9-1 and FX9-2; resolve cross-builder reds.
- Spec twins (.md + .html) for the code changes: intake-flow (P7 drop rule replacing the CR8-01 narrowing
  text), verdict-audit (CR9-02 WhatToDo states, CR9-04 neutral model sentence), cross-cutting (Clear-all
  incomplete path resets the role in the header, plain store names), register-lifecycle if the model sentence
  is quoted there; amendments marked "(CR9, 2026-10-04)".
- `test-cases/test-cases-031.md` (+ html via scripts/test-cases-html.py): one row per TC-CR9 id; amended ids.
- Ritual: `npm test` ×3, `npx tsc --noEmit`, `npm run build`, `python3 scripts/spec-parity-check.py`,
  `python3 scripts/trace-check.py`, no reused test ids; live walkthrough on a fresh origin (http://[::1]:5173):
  a no-controls Medium case past pre-check with no sign-off (todo box), the neutral model sentence on an
  in-house case, a policy save; push; CI + Pages green.
- Handover `build/handovers/CR9-fixes.md` with every id's disposition (BC-006) and the review passes.

## Expected cross-builder reds until merge
None expected (no shared files). If FX9-1's wording changes break a docs-reading test, note it.

## v2 amendments (plan check, 18 items — these override the text above)
1. **CR9-03:** TC-CR7-06b (PolicyEditor.cr7.test.tsx ~190) asserts `onSaved` NOT called when `onPolicyUpdated`
   rejects — amend it to `toHaveBeenCalledTimes(1)` (list it as amended); TC-CR9-03 may extend 06b. Only the
   store-failed branch keeps "onSaved not called" (TC-CR7-06e). Do not move the success-path `onSaved?.()`.
   Mock with `vi.mocked(policyStore.onPolicyUpdated).mockRejectedValueOnce(...)` as 06b does.
2. **CR9-04 tests:** every `.not.toContain('No model was named')` (ModelLinkFailure.cr7 ~122 TC-CR7-11h;
   RegisterDetail.nomodel.cr7 ~97/103/109; VerdictDisplay.cr7-fx4 ~148/155) becomes an assertion that the NEW
   sentence (or `.verdict__no-model-named`) is absent — otherwise the guard goes vacuous. Update the `LINE`
   constants (RegisterDetail.nomodel.cr7 ~21, VerdictDisplay.cr7-fx4 ~133); fix the TC-CR7-11i title. Keep ids.
3. **CR9-04 surfaces:** add IntakeFlow.tsx (~1686) and RegisterDetail.tsx (~690) — comment-only — to FX9-1;
   fix the comments at VerdictDisplay.tsx ~37-38 and verdict-view-model.ts ~181. Keep the identifiers
   `noModelNamed`, `registerSaysNoModelNamed` and the class `verdict__no-model-named`. Main loop edits the
   quoted sentence IN PLACE at specs/verdict-audit.md ~422 / .html ~485 and register-lifecycle.md ~757 / .html
   ~266, plus an amendment note.
4. **CR9-14:** amend TC-CR8-16b (SettingsPanel.cr8 ~62) and TC-CR7-15-3 (SettingsPanel.cr7 ~73). Keep reset.ts's
   result shape (the push is at reset.ts ~70; SettingsPanel ~118 is its only reader). In SettingsPanel, take the
   text before " (", map `aigate-audit` → "your audit trail", `aigate-register` → "your register of use cases",
   any other id → "some stored data" (a raw id can never print).
5. **CR9-13:** the handler must NOT write the role key Clear all just removed (`handleRoleChange` calls
   `setRole`): split out a state-only reset — `setRoleState('1LoD')` + the same ruleQueue replaceState fallback.
   `getRole()` already defaults to 1LoD (role.ts ~5). The prop is optional (existing `render(<SettingsPanel />)`
   tests omit it; SettingsPanel renders only at App.tsx ~332). TC-CR8-16c (store-level) is unaffected.
6. **CR9-02 wording, one source:** export two constants from verdict-view-model.ts —
   `SIGNOFF_MISSING_CONFIRM` and `SIGNOFF_UNKNOWN_CONFIRM` — and use them in (a) the WhatToDo zero branch,
   (b) the WhatToDo lead "Then a second-line reviewer signs off." (~503, also keyed on needsSignOff: for
   missing/unknown with controls, append the matching constant), (c) the "Then" row (~636-648 — for
   missing/unknown REPLACE the row text; the "above the self-service threshold, so it is not final until…" text is
   false there), and (d) buildNextSteps' missing step (today an inline literal ~679-681). Do NOT add a new
   unknown-state next step (it would change step counts pinned by TC-CR8-02 tests and D-38); the finish line
   already covers unknown. Zero branch JSX: signed off / self-service / needsSignOff keep today's "Nothing. This
   use case sits inside appetite as described, …" (+ needsSignOff sentence); missing/unknown read
   "Nothing to put in place — " + the constant (drop the leading "Nothing." sentence; keep "This use case sits
   inside appetite as described, with no controls required and no further reviews triggered." after it).
   Suggested constants: missing — "no sign-off from your AI risk team is on record for this version, so confirm
   with them before you start."; unknown — "we can't tell yet whether your AI risk team must sign this off, so
   check with them before you start." Grammar must read correctly in every place a constant is used.
7. **P6 appetite line:** VerdictDisplay.tsx ~1649 "Inside appetite as described — nothing to put in place." adds
   clauses only for needsSignOff/signedOff — append a non-permissive clause for missing/unknown (e.g. " Whether
   it is final is not confirmed yet — see your next steps.") and include it in the sweep.
8. **TC-CR9-02d:** drop the "except inside the confirm sentence" clause (none of the new sentences match the
   regex). The sweep reads `container.textContent` (includes the closed reviewer `<details>`; the heading
   "Safeguards that must be in place before you start" does not match). Fixture for determined self-service with
   1 control: a Low-tier verdict with exactly one control under the shipped policy's tier_workflow (build it from
   a real evaluate() of a Low case, or name the fixture you use). No new string contains approved/rejected;
   stage `approved` fixtures render the existing stage notes, which are fine.
9. **OB-1 tests:** amend TC-CR8-01f, -01g AND -01j (01j asserts narrowing on a countries edit → becomes "dropped;
   question 11 stays"); TC-CR9-OB1's countries clause extends TC-CR8-01d instead of duplicating it. Main loop
   amends the test-cases-030 rows for 01f/01g/01j and its §1 heading (both twins) and specs/intake-flow.md
   ~1076 + .html. Callers of the helper: intake-state.ts ~953 and ~1001.
10. **CR9-01 scope widened:** the same false disclosure claim is in docs/regulator-brief.md ~115-117 and
    docs/regulator-brief.html ~377 ("the record disclosing a self-approved case is the control") and README.md
    ~485-486 ("the record that currently *discloses* a self-approved case will *prevent* one"). Add
    regulator-brief.md/.html and those README lines to FX9-2; reword to: no segregation of duties yet; nothing
    flags a self-approval; the sign-off shows a typed, unverified name. Grep docs/ and README for "disclos".
    In user-guide's marker table, "self-service final" renders on the verdict screen's stage note
    (VerdictDisplay.tsx ~141) — the "Where" column becomes "Result screen (stage note)" and the meaning "the
    firm's policy routes this case to self-service; nobody else needs to sign it off". try-these bullet is at
    ~343-344.
11. **CR9-05:** quote the app's real banner text ("No break found in the N events present." — check src) and
    the tester-guide wording (~191-196). README ~35 and ~94 ("tamper-evident, not tamper-proof") are fine.
    Include docs/regulator-brief.md ~58 in the sweep. OB-4 (glossary.md ~27, try-these ~346 "no way to edit"):
    note, do not fix, unless that sentence is already being edited.
12. **CR9-12:** check EVERY numbered heading of "How to read a verdict" against the screen's real titles (not only
    the three named; e.g. "The verdict line", "Why this verdict", "The regulatory reasoning chain", "The minimal
    control set"); renumber after inserting the first-screen section; grep for in-guide anchors/references; same
    in the .html. ("no headroom" is at ~106.)
13. **CR9-09:** also fix register-lifecycle.html traceability rows ~999 and ~1083 to match the .md; keep the h2
    `id="aigate-self-assessment"` (~677; the block runs to just before ~798); correct the changelog row ~1203
    only once the real §9 is in.
14. **CR9-15:** the page gives answers as label text; `plainAnswersToFormValues` takes option keys. Hard-code the
    option keys in the test and assert (via plain-questions.ts / plain-copy) that each key's label equals the
    page's label, so the page text is pinned too (pattern: backtest-parity-nonblind.test.ts ~119). Fix both the
    stale title and the stale comment (~122-134). Assert the engine's exact review strings (case 7: information
    security review and vendor risk assessment, try-these.md ~224).
15. **CR9-10/11:** every sample carries a provisional reason, so fix the column header or sentence, not one cell.
    tester-guide ~111 also says "pre-checked". For the decision-type "Something else" use plain-copy.ts ~361's
    "Something else — describe it" (not ~329's action-type option).
16. **CR9-08:** after porting md ~431 into the html list (~493-497), the html changelog row (~1083) that already
    claims the four-state wording becomes true, and the CR7-09 "CR8 amendments below" pointer (~484) resolves.
17. **Order:** FX9-2 edits specs/verdict-audit.html (CR9-08) and register-lifecycle.html (CR9-09); the main loop
    later edits the same files for CR9-02/04 — so the main loop merges FX9-2 before its own spec work. No test reads
    docs/ or specs/; "no cross-builder reds" stands.
18. Files, updated — FX9-1 adds IntakeFlow.tsx and RegisterDetail.tsx (comments only) and the CR9-04 test files;
    FX9-2 adds docs/regulator-brief.md + .html.
