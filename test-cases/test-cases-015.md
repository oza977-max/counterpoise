# Counterpoise — Test Cases, Round 15

*Written 2026-08-25 alongside the R15 build (targeted UI redesign,
`requirements/requirements-015.md`, `reviews/design-deliberation-001/proposal.md`).
R15-C1's tests were written with the build but their rows were only added on
2026-10-03 (code review 006, A-6) — see "R15-C1" below; R15-C2 shipped without
new automated test cases.*

## R15-C1 — register wording, legend and the role switcher (rows added 2026-10-03)

| ID | Asserts |
|---|---|
| TC-R15-C1-01 | The register's Stage column shows the plain STAGE_LABELS word and keeps the raw stage value only as a data attribute — `RegisterView.r15c1.test.tsx` |
| TC-R15-C1-02 | The stage filter chips use the STAGE_LABELS words, not the raw stage values — `RegisterView.r15c1.test.tsx` |
| TC-R15-C1-03 | The 2LoD default view shows only rows awaiting sign-off, with a "Show all" toggle that reveals everything — `RegisterView.r15c1.test.tsx` |
| TC-R15-C1-04 | An always-visible legend explains Tier, Track, Stage and Verdict — `RegisterView.r15c1.test.tsx` |
| TC-R15-C1-05 | The provisional roll-up renders as a distinct banner with role="note" — `RegisterView.r15c1.test.tsx` |
| TC-R15-C1-06 | The Flags column shows badges when a row is flagged and a stable accessible name when it is not — `RegisterView.r15c1.test.tsx` |
| TC-R15-C1-07 | The Counterpoise self-assessment row gets a distinct class and a visible tag — `RegisterView.r15c1.test.tsx` |
| TC-R15-C1-08 | The role switcher is labelled "Viewing as" and shows a visible honesty note — `App.r15c1.test.tsx` |
| TC-R15-C1-09 | The role options carry a first-mention gloss — `App.r15c1.test.tsx` |
| TC-R15-C1-10 | The 1LoD register scope note uses the honest view-preference wording — `App.r15c1.test.tsx` |

## R15-C3 — Guided form + Confirm & attest + questionnaire tag

Proposal §3.2, §3.5, §3.7. Skeptic amendment S1b (Must): the raw-vocabulary
fix lands at the shared source, `graph-summary.ts#graphSummaryRows()`, so
both ConfirmationStep and VerdictDisplay's "What you told us" fold pick it
up from one function.

| ID | Asserts |
|---|---|
| TC-R15-C3-01 | `graphSummaryRows()` routes Input data / Model / Autonomy / Data zone / Output through `field-copy.ts`'s `plainWithCode()` — the rendered value is `"<short plain phrase> · <code>"`, not the raw enum alone (S1b) |
| TC-R15-C3-02 | The same fixed row shape appears at BOTH call sites from one function: ConfirmationStep's attest grid (`ConfirmationStep.test.tsx`, pre-existing coverage, unaffected by this change) and VerdictDisplay's "What you told us" fold (`VerdictDisplay.test.tsx`, renegotiated in this round — see below) **[Amended 2026-09-28: the "pre-existing coverage" claim for ConfirmationStep.test.tsx was inaccurate — that file had no assertion on the attest grid's rows. A new test there now proves the ConfirmationStep call site.]** |
| TC-R15-C3-03 | The `UC-6 · CONFIRM & ATTEST` internal-id tag no longer renders on the Confirm & attest screen |
| TC-R15-C3-04 | The `UC-4 · TARGETED QUESTIONS` internal-id tag no longer renders on the targeted-questions screen |
| TC-R15-C3-05 | `StructuredForm` renders five `<fieldset>`/`<legend>` sections ("About it", "What it uses", "What the AI is and how it runs", "What comes out and who it reaches", "Where it applies") — verified live; no automated DOM-structure assertion added (out of scope for this pass) **[Amended 2026-09-28: an automated fieldset/legend test now exists in StructuredForm.test.tsx.]** |
| TC-R15-C3-06 | No form field is hidden behind an "advanced" toggle — all pre-existing `getByLabelText` queries in `StructuredForm.test.tsx` still resolve unchanged, proving every field stayed on the single scroll |
| TC-R15-C3-07 | The load-bearing zone-crossing sentence ("not where the data is stored — where it gets sent...") and the load-bearing bindingness sentence ("be honest about what happens in practice...") stay visible outside their "Why we ask" `<details>` — pre-existing `StructuredForm.test.tsx` assertions on both sentences continue to pass unchanged |
| TC-R15-C3-08 | Optional fields (platform, vendor, decision type, human-in-the-loop) state the consequence of leaving them blank in the field label itself ("optional — blank means: …") **[Amended 2026-09-28: true for platform, vendor and human-in-the-loop, which use "optional — blank means: …" verbatim. The decision-type label instead reads "optional — leave blank only if it feeds no decision at all" — guidance on when blank is allowed, not the consequence of blank. The test pins each label's real text; the wording inconsistency is recorded here, not hidden.]** |
| TC-R15-C3-09 | `FIELD_CONSEQUENCES` (field-copy.ts, R5-GR-1) — computed since that round and never rendered anywhere — is now consumed by `StructuredForm`'s "Why we ask" disclosures, closing a computed-but-never-consumed gap |

### Renegotiated

- `VerdictDisplay.test.tsx` — "renders the record & provenance panel..."
  previously asserted the raw `'Client notes · Client PII'` /
  `'Drafting model · llm'` strings. Renegotiated (not weakened) to assert
  the plainWithCode() form the shared fix now produces:
  `'Client notes · Personal details of clients · Client PII'` /
  `'Drafting model · A chatbot or writing assistant · LLM'`.

### Verification

`npm test` ×3 — 680/680, identical across runs. `npx tsc --noEmit` clean.
`npm run build` clean. `python3 scripts/spec-parity-check.py` — clean (R1–R8
all pass). No new automated tests target TC-R15-C3-05 (fieldset structure)
or the questionnaire rule-name-with-quiet-id change (§3.7) directly — both
were verified by reading the rendered JSX and by TypeScript's structural
checks, not by a live browser walkthrough, which this build pass did not
have tooling access to run.

| Date | Change |
|---|---|
| 2026-08-25 | Written with the R15-C3 build. |
| 2026-08-25 | R15-C4 section added. |

---

## R15-C4 — Appetite framework split + header chip

Proposal §3.4, §3.8. Readable rulebook (levers, action-required banner,
jurisdiction packs, hard lines, risk knowledge) is now the default view of
`PolicyEditor.tsx` for every role; the YAML editor sits behind a
closed-by-default `aria-expanded` disclosure carrying the honest no-sign-in
line. The header's "translation fidelity" chip drops its `title=` tooltip
for a visible warning + an `aria-expanded` disclosure carrying the same
`attestation.reason` text.

| ID | Asserts |
|---|---|
| TC-R15-C4-01 | `PolicyEditor`'s YAML-editor disclosure button renders `aria-expanded="false"` on first render and the `#policy-yaml-input` textarea is not in the document until it is opened — the readable panels above it (levers, jurisdiction packs, hard lines, risk knowledge) render regardless, satisfying "readable rulebook is the default view" **[Amended 2026-09-28: the mechanism has since changed — design-review round 4 migrated this disclosure to the shared native <details>/<summary> Fold, so it carries an open attribute, not aria-expanded. The substance (closed by default, readable panels render regardless) is what the test proves.]** |
| TC-R15-C4-02 | Opening the disclosure flips `aria-expanded` to `true`, reveals the textarea, Validate/Save and the verbatim honesty sentence "This build has no sign-in — anyone can open this. A real deployment restricts it to the rule authors." **[Amended 2026-09-28: same mechanism change as C4-01 — opening the <details> reveals the textarea and the honesty sentence.]** |
| TC-R15-C4-03 | All pre-existing `PolicyEditor.test.tsx` and `PolicyEditor.r12.test.tsx` coverage (pre-fill, validate, save success/failure, ACTION REQUIRED banner, jurisdiction pack list, hard lines, pack age/overdue, invalid-YAML panel suppression) is unchanged in behaviour — only renegotiated to open the disclosure first before querying the textarea |
| TC-R15-C4-04 | `WalkingSkeleton.test.tsx`'s P7-C03 Part B save-flow integration test opens the disclosure before finding the textarea; the real-save assertion (queued count, header policy version bump) is otherwise unchanged |
| TC-R15-C4-05 | No role prop is read by `PolicyEditor`, and none was before this chunk — confirmed by reading the component and its call site in `App.tsx` (`<PolicyEditor onSaved={...} />`, unconditional). The "NOT role-gated" requirement (§3.4) was already true structurally; this chunk adds a code comment recording the check rather than removing gating that did not exist. This is the documented exception to G6 (§7 gates), not a violation of it |
| TC-R15-C4-06 | `App.tsx`'s fidelity chip no longer renders a `title=` attribute; a button with `aria-expanded` toggles a `<p>` containing `attestation.reason` verbatim — verified by reading the JSX (no automated App.tsx test previously covered the `title=` tooltip, so none needed renegotiating) |
| TC-R15-C4-07 | `VerdictDisplay.tsx`'s "Rulebook translation: unattested — the jurisdiction pack rules used here are proposed readings your firm has not yet adopted." checklist line (added R15-C2) is untouched — confirmed by diff; this chunk only touches the header instance |

### Verification

`npm test` ×3 — 682/682, identical across runs (up from 680 in R15-C3; six
tests added, four renegotiated in place). `npx tsc --noEmit` clean.
`npm run build` clean. `python3 scripts/spec-parity-check.py` — clean
(R1–R8 all pass; no spec `.md`/`.html` file was touched this chunk). No
live browser walkthrough — this build pass did not have that tooling
available; verified instead by reading the rendered JSX, the full test
suite, and TypeScript's structural checks.

---

## R15-C5 — Graph review refinements + rule-improvement queue

Proposal §3.6 + §3.9 + §3.10's one-line describe-step note. The last of
R15's five chunks. `GraphView.tsx`'s field labels now reuse the four
question-derived words the proposal names, sourced from a single new
`field-copy.ts` export (`GRAPH_FIELD_LABELS`) rather than re-typed inline;
the engine field name stays visible beside each as quiet code
(`.graph-node__field-code`), following the same "quiet code beside plain
label" pattern used everywhere else in this redesign, not deleted.
"model confident — no verified basis" is reworded to "not found in your
text — worth a second look" and now shares a `.graph-node__badge` base
class with "guessed" (same shape, same visual family) while keeping its
own modifier class (`--no-basis` vs. `--guessed`) and its own text — the
merge IxD ID-6 asked for and the panel rejected in §5 was not made; the
underlying three provenance states (quoted / guessed / confident-no-basis)
and the no-plain-confirm gate for guessed cards are untouched code paths,
confirmed by reading `GraphView.tsx`'s conditional branches, which are
unchanged in structure. A silently-unanswered optional field (decision
type, human-in-the-loop) now renders a quiet `.graph-node__badge--not-stated`
badge instead of a plain "not stated" text node indistinguishable from a
real value. The "Why these values matter" disclosure button gained
`aria-expanded`/`aria-controls`, replacing nothing (it had neither before —
this closes the gap, matching the pattern from C1/C2/C4). Long provenance
quotes (`ProvenanceQuote`) truncate past 90 characters with a
`aria-expanded` "show full quote" button; the field VALUE beside the quote
is never touched by this truncation — it always renders in full. In
`RuleImprovementQueue.tsx`, each group heading now leads with the plain
rule label and demotes the rule id to quiet code (falling back to the id
alone when no label was ever resolved, e.g. a free-typed rule reference);
"fired on N decided cases" is reworded to "has applied to N decided
cases"; each entry now carries a source tag distinguishing "filed by a
reviewer" from "filed by the risk-knowledge lens", derived by reading the
existing `filed_by_name` string's `"(risk-knowledge lens, ...)"` marker
(the coverage-gap write path, ADR-EE-R11-2) rather than by adding a new
audit-event field — no write path changed. The "advisory by construction"
paragraph (`.rule-queue__intro`) and the append-only caveat
(`.rule-queue__caveat`) are untouched verbatim — grepped for and confirmed
unmodified before and after this change. §3.10 (intake describe, About,
Settings, Demo data) needed no code change: reading `IntakeFlow.tsx`
confirmed the step-1 no-model-configured copy already states in one line
what happens next, so this note was already true.

| ID | Asserts |
|---|---|
| TC-R15-C5-01 | `GraphView.tsx`'s `data_class`, `decision_bindingness`, `output_reversibility` and `autonomy_level` field rows render the plain question-derived label from `field-copy.ts`'s `GRAPH_FIELD_LABELS`, with the engine field name still present as a `<code>` element beside it — verified by reading the JSX; no automated test previously asserted the old inline label text, so none needed renegotiating |
| TC-R15-C5-02 | `GraphView.r12.test.tsx` TC-R12-BD-1-02/03 — renegotiated in place: the confident-no-basis marker's text assertion moved from `/model confident — no verified basis/i` to `/not found in your text — worth a second look/i`; the underlying condition under test (no quote, not guessed, model not marked uncertain) is unchanged |
| TC-R15-C5-03 | The "guessed" and "no-basis" badges both render `.graph-node__badge` plus their own distinct modifier class (`.graph-node__badge--guessed` / `.graph-node__badge--no-basis`) and distinct text — confirmed by reading `ProvenanceBadge` in `GraphView.tsx`, a single small component the three call sites (field loop, vendor row, model row) share, replacing three near-duplicated inline blocks |
| TC-R15-C5-04 | `GraphReview.r6.test.tsx`'s guessed-badge assertion (`/guessed — the description does not say/i`) and `GraphReview.r9.test.tsx`'s `.graph-node__guessed-badge` count assertion both pass unchanged — the guessed badge's class and text were preserved exactly, only its markup source moved into `ProvenanceBadge` |
| TC-R15-C5-05 | `GraphReview.r5.test.tsx` TC-R5-GR-1-03 — absent optional fields still render the exact text "not stated" (now wrapped in `.graph-node__badge--not-stated` rather than a bare text node) — passes unchanged, confirming the reword did not touch this string |
| TC-R15-C5-06 | The "Why these values matter" button renders `aria-expanded={showWhy}` and `aria-controls` pointing at the node's `<dl id="why-${node.id}">` — verified by reading the JSX; no automated test previously covered this button's accessible state, so none needed renegotiating |
| TC-R15-C5-07 | `ProvenanceQuote` truncates quote text over 90 characters with a `show full quote` button carrying `aria-expanded`; the sibling `.graph-node__meaning` span (the field value) is rendered outside `ProvenanceQuote` entirely and is never passed through it — confirmed by reading the component boundary |
| TC-R15-C5-08 | `RuleImprovementQueue.test.tsx`'s heading-order assertion — renegotiated from `'INV-DATA-01 — Client PII rule'` to `'Client PII rule INV-DATA-01'`, asserting the plain label now leads and the id trails as quiet code; the no-label fallback case (`'TIER-PII-01'`) is unchanged |
| TC-R15-C5-09 | `RuleImprovementQueue.r12.test.tsx` TC-R12-AB-2-01 — renegotiated from `/challenged 1 time · fired on 1 decided case/i` to `/challenged 1 time · has applied to 1 decided case/i`; the underlying `deriveFiredCounts` computation is untouched |
| TC-R15-C5-10 | Each queue entry renders a `.rule-queue__source-tag` reading "filed by a reviewer" or "filed by the risk-knowledge lens", derived in `deriveQueue()` from whether `filed_by_name` contains the literal marker `(risk-knowledge lens` — no new field was added to the `rule_dissent_filed` audit-event type (`store/types.ts` unchanged) |
| TC-R15-C5-11 | `RuleImprovementQueue.test.tsx` TC-R4-RC-5-01 through -05 (empty state, grouping/ordering, advisory posture text, reserved-words guard, hostile-dissent-as-text) and TC-R4-NF-2-01 (no duplicate writes on remount) all pass unchanged — the advisory paragraph and append-only caveat were not edited |
| TC-R15-C5-12 | `.rule-queue__intro` and `.rule-queue__caveat` text is byte-identical before and after this chunk — confirmed by diff against the pre-chunk file |

### Verification

`npm test` ×3 — 682/682, identical across all three runs (unchanged count
from R15-C4: two existing test files were renegotiated in place for the
reworded copy, no test was added or removed). `npx tsc --noEmit` clean
(one type error surfaced and fixed during the build: `ProvenanceQuote`'s
`text` prop needed a non-null assertion on `quotes[spec.field]` inside the
already-truthy-checked branch). `npm run build` clean. `python3
scripts/spec-parity-check.py` — clean (R1–R8 all pass; no spec `.md`/`.html`
file was touched this chunk). No live browser walkthrough — this build
pass did not have that tooling available; verified instead by reading the
rendered JSX, the full test suite, and TypeScript's structural checks.
This is the last of R15's five chunks; requirements-015.md's Changelog
notes the build status (not a release) in the same pass.


### Traceability closed — 2026-09-28

Every case in this file is now proved by an automated test that names it,
checked mechanically by `python3 scripts/trace-check.py` (247/247 across all
test-case files at the time of writing). Rows that R15 had verified only "by
reading the JSX" or "by diff" (C3-03, C3-04, C3-05, C3-08, C3-09, C4-05,
C4-06, C4-07, C5-01, C5-03, C5-06, C5-07, C5-10, C5-12) now have their own
tests; the rest were already proved by existing tests, which now carry the
id. Three rows overstated what had been verified — amended in place above,
each marked with its date.

### Retired by R16 chunk B — 2026-10-02

The field-by-field guided form TC-R15-C3-05/07/08/09 verified is replaced
in full by `build/prompts/R16.md` §2.2's situational question set — see
`test-cases-019.md` for the new form's own test cases (TC-R16-B-*). Moved
to Superseded below.

## Superseded

| ID | Reason |
|---|---|
| TC-R15-C3-05 | "`StructuredForm` renders five `<fieldset>`/`<legend>` sections (`About it`, `What it uses`, `What the AI is and how it runs`, `What comes out and who it reaches`, `Where it applies`) with the documented legend text." R16 chunk B's replacement form uses a different section grouping for the new question set (`About it`, `Where it comes from`, `What it does`, `Decisions and safeguards`, `Scope and countries`) — the specific legend text this case pinned no longer exists by design, not by regression. |
| TC-R15-C3-07 | "The load-bearing zone-crossing sentence (`not where the data is stored — where it gets sent...`) and the load-bearing bindingness sentence (`be honest about what happens in practice...`) stay visible outside their `Why we ask` `<details>`." Both sentences were written for the retired `sf-processing-zone`/`sf-bindingness` fields, which no longer exist — the new form asks about the submitter's situation (§2.2) rather than the zone or bindingness directly, so neither sentence has a field left to attach to. The new form's own help text (`plain-copy.ts`) is tested directly in `StructuredForm.test.tsx` / `plain-intake.test.ts`. |
| TC-R15-C3-08 | "Optional fields (platform, vendor, decision type, human-in-the-loop) state the consequence of leaving them blank in the field label itself." Those four fields do not exist in the new form in that shape — platform/vendor are resolved from Q3's situational answer (never asked as a bare optional field), decision type is Q8 (required, not optional — UC-8's design explicitly requires an answer so the engine is never silently under-informed), and human-in-the-loop is derived from Q6, never asked directly (principle 1: no engine vocabulary on the form). TC-R16-B-12's never-render-`[FIRM]` fallback label test and TC-R3-JU-5-02 (adapted, `test-cases-019.md`) cover the surviving optional free-text fields (3supplierName, 3model). |
| TC-R15-C3-09 | "`FIELD_CONSEQUENCES` (field-copy.ts, R5-GR-1) is consumed by `StructuredForm`'s `Why we ask` disclosures." The retired form's fields (and their `FIELD_CONSEQUENCES` entries) are gone; the new form's help text lives in `plain-copy.ts`'s own `help` field per question, tested directly where it is used, not through `field-copy.ts`'s now-unrelated map. |
| TC-R15-C3-06 | "No form field is hidden behind an `advanced` toggle — all pre-existing `getByLabelText` queries in `StructuredForm.test.tsx` still resolve unchanged, proving every field stayed on the single scroll." Those specific queries targeted the retired field set. The new form keeps the same "one continuous scroll, no toggle" structure (`structured-form__scroll-note`, unchanged) — every one of its own questions, including the conditional ones, is reachable by `StructuredForm.test.tsx`'s own queries with no toggle ever opened (the conditional questions are situational follow-ups per §2.2, shown or hidden by an earlier ANSWER, not by a reader-operated "advanced" control) — but there is no longer a single dedicated case naming this property; it is demonstrated structurally (no toggle exists in the component at all) and by every other test in the file not needing to open one. |
| TC-R15-C5-01 | "`GraphView.tsx`'s `data_class`, `decision_bindingness`, `output_reversibility` and `autonomy_level` field rows render the plain question-derived label from `field-copy.ts`'s `GRAPH_FIELD_LABELS`, with the engine field name still present as a `<code>` element beside it." R16-E §4 (D-103, "No code beside any label") reverses this case's own premise: the review screen's field rows now read from `QUESTIONNAIRE_COPY` instead of `GRAPH_FIELD_LABELS`, and the engine field name is removed from the row entirely, not merely relabelled — a quiet `<code>` beside the label is exactly what principle 1 now forbids on this screen. The replacement fact (the row label, with no code anywhere) is covered by `test-cases-024.md`'s TC-R16-E-41/41b. |
| TC-R15-C5-02 | Superseded by R18-GI-10 (R18-E): the combined 'not in your description' marker on a field belonged to `GraphView`, the card review's screen, which is deleted. No replacement — behaviour retired. |
| TC-R15-C5-03 | Superseded by R18-GI-10 (R18-E): the guessed and no-basis badges and their text belonged to `GraphView`, the card review's screen, which is deleted. No replacement — behaviour retired. |
| TC-R15-C5-04 | Superseded by R18-GI-10 (R18-E): the one-alarm-per-card rule belonged to `GraphView`, the card review's screen, which is deleted. No replacement — behaviour retired. |
| TC-R15-C5-05 | Superseded by R18-GI-10 (R18-E): 'not stated' for absent optional fields belonged to `GraphView`, the card review's screen, which is deleted. No replacement — behaviour retired. |
| TC-R15-C5-06 | Superseded by R18-GI-10 (R18-E): the 'Why these values matter' toggle's aria attributes belonged to `GraphView`, the card review's screen, which is deleted. No replacement — behaviour retired. |
| TC-R15-C5-07 | Superseded by R18-GI-10 (R18-E): quote truncation behind a toggle belonged to `GraphView`, the card review's screen, which is deleted. No replacement — behaviour retired. |

---

*Developed using the Grounded Vibe Methodology*

## Changelog

| Date | Change |
|---|---|
| 2026-10-03 | Code review 006 (A-6): rows TC-R15-C1-01 to -10 added for tests that existed without rows; the header no longer says R15-C1 shipped without automated tests. |
