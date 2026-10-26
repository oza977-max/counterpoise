# Counterpoise — Test Cases, Round 18

*Written 2026-10-02. R16 chunk A1 — the schema, engine and loader-check work
behind the plain-language redesign (`build/prompts/R16.md` v2.1, §1.1–§1.5):
PE-9's list-valued `system_access_scope`, CF-6's optional plain-language
schema fields, per-instance downstream review sources, the
`checkPolicyReferences` loader check and its call-site wiring, and the
`envelope.ts` ranking export. The plain-language TEXT (chunk A2), the guided
form (chunk B/E) and the verdict's first screen (chunk D1/D2) are separate,
later chunks — nothing here renders a token, a placeholder, or new
user-facing copy.*

Test files: `src/engine/access-scope.test.ts`, `src/engine/condition.test.ts`,
`src/engine/agent-infra.test.ts`, `src/engine/build-graph-from-form.test.ts`,
`src/components/field-copy.test.ts`, `src/components/graph-summary.test.ts`,
`src/components/__tests__/GraphView.r16a1.test.tsx`,
`src/store/policy.test.ts`, `src/store/packs.test.ts`,
`src/engine/evaluate.test.ts`, `src/engine/jurisdiction.test.ts`,
`src/engine/envelope.test.ts`, `src/store/policy-references.test.ts`,
`src/components/__tests__/App.r16a1.test.tsx`,
`src/components/__tests__/IntakeFlow.r16a1.test.tsx`,
`src/components/__tests__/PolicyEditor.r16a1.test.tsx`,
`src/components/__tests__/SettingsPanel.r16a1.test.tsx`,
`src/seeds/sample-register.test.ts`, `src/seeds/ib-portfolio.test.ts`,
`src/seeds/aigate-self-assessment.test.ts`.

## §1.1 — PE-9: list-valued `system_access_scope`

`normaliseAccessScope` (`src/engine/access-scope.ts`) is the single
implementation of the validate/canonicalise rule; `condition.ts` and every
renderer that touches the field were updated to handle a list without
crashing, per the contract.

| ID | Asserts |
|---|---|
| TC-R16-A1-01 | `normaliseAccessScope` accepts a single known value and preserves its shape (bare string, not wrapped in an array) — `access-scope.test.ts` |
| TC-R16-A1-02 | Accepts an array and returns it in canonical order — `access-scope.test.ts` |
| TC-R16-A1-03 | Shuffled tick order produces the byte-identical canonical array regardless of input order — `access-scope.test.ts` |
| TC-R16-A1-04 | Rejects an empty array (non-empty rule) — `access-scope.test.ts` |
| TC-R16-A1-05 | Rejects undefined/null as having no value — `access-scope.test.ts` |
| TC-R16-A1-06 | Rejects an unknown value, single or inside a list — `access-scope.test.ts` |
| TC-R16-A1-07 | Rejects duplicate values in a list — `access-scope.test.ts` |
| TC-R16-A1-08 | Rejects "none" combined with another value, in either order — `access-scope.test.ts` |
| TC-R16-A1-09 | Accepts "none" alone, as a single value or a one-element list — `access-scope.test.ts` |
| TC-R16-A1-10 | `ACCESS_SCOPE_CANONICAL_ORDER` is none, shared_infrastructure, credentialed_systems, deployment_authority — `access-scope.test.ts` |
| TC-R16-A1-11 | An array-valued field contributes each element to the candidate set (`collectFieldValues`) — `condition.test.ts` |
| TC-R16-A1-12 | A single (non-array) value on a list-valued field still matches as before — `condition.test.ts` |
| TC-R16-A1-13 | `describeGraphPath` names every input, not just the first, with two inputs — `condition.test.ts` |
| TC-R16-A1-14 | Names every input with three inputs — `condition.test.ts` |
| TC-R16-A1-15 | A single input keeps the existing input → model → output shape — `condition.test.ts` |
| TC-R16-A1-16 | Falls back to the processing node when there are no input nodes at all — `condition.test.ts` |
| TC-R16-A1-17 | A two-kind agent (shared infrastructure + credentialed systems ticked at once) trips both INV-AGENT-INFRA-01 and INV-AGENT-CRED-01, with both controls — `agent-infra.test.ts` |
| TC-R16-A1-18 | `buildGraphFromForm`: a single systemAccessScope value is stored unchanged (shape preserved) — `build-graph-from-form.test.ts` |
| TC-R16-A1-19 | A list of systemAccessScope values is stored in canonical order, regardless of tick order — `build-graph-from-form.test.ts` |
| TC-R16-A1-20 | An invalid systemAccessScope (e.g. "none" + another value) is omitted, not fabricated — `build-graph-from-form.test.ts` |
| TC-R16-A1-21 | `systemAccessScopeLabel`: a single value renders exactly as before this change — `field-copy.test.ts` |
| TC-R16-A1-22 | A list of values renders every value, joined, without crashing — `field-copy.test.ts` |
| TC-R16-A1-23 | A one-element list renders the same as the bare value it contains — `field-copy.test.ts` |
| TC-R16-A1-24 | `graphSummaryRows`: a single system_access_scope value renders one row, unchanged — `graph-summary.test.ts` |
| TC-R16-A1-25 | A list of system_access_scope values does not crash and names every value — `graph-summary.test.ts` |
| TC-R16-A1-26 | `GraphView` display: a single value renders its meaning, as before — `GraphView.r16a1.test.tsx` |
| TC-R16-A1-27 | A list of values renders without crashing and names every value — `GraphView.r16a1.test.tsx` |
| TC-R16-A1-28 | `validateConditionFieldValue` accepts the "in" operator on system_access_scope — `policy.test.ts` |
| TC-R16-A1-29 | Rejects not_in on system_access_scope — `policy.test.ts` |
| TC-R16-A1-30 | Rejects gte/lte on system_access_scope — `policy.test.ts` |
| TC-R16-A1-31 | Rejects bare equality on system_access_scope — `policy.test.ts` |
| TC-R16-A1-32 | Rejects an unknown value inside an "in" list on system_access_scope (canonical vocabulary) — `policy.test.ts` |
| TC-R16-A1-33 | A policy whose invariant condition uses not_in on system_access_scope is rejected end-to-end via `loadPolicy` — `policy.test.ts` |
| TC-R16-A1-34 | A pack rule whose condition uses not_in on system_access_scope rejects the WHOLE pack via `loadPacks` — `packs.test.ts` |

## §1.2 — CF-6: optional plain-language schema fields

All fields below are optional; the shipped starter policy (with none of
them) loads unchanged — asserted directly in both `policy.test.ts` and
`policy-references.test.ts` (TC-R16-A1-51).

| ID | Asserts |
|---|---|
| TC-R16-A1-35 | A control accepts `plain_action`, `plain_owner`, `plain_owner_with` and `covers_reviews` — `policy.test.ts` |
| TC-R16-A1-36 | An invariant accepts `plain_reason` — `policy.test.ts` |
| TC-R16-A1-37 | A hard line accepts `plain_reason` and `plain_change` — `policy.test.ts` |
| TC-R16-A1-38 | A `downstream_reviews` rule accepts `plain_name` and `plain_owner` — `policy.test.ts` |
| TC-R16-A1-39 | A platform/vendor registry entry accepts `plain_name`, `vendor_id` and `kind` — `policy.test.ts` |
| TC-R16-A1-40 | Rejects an invalid `kind` value on a vendor entry — `policy.test.ts` |
| TC-R16-A1-41 | A pack `required_review` effect accepts optional `plain_name` and `plain_owner` — `packs.test.ts` |

## §1.3 — Every review has a source

| ID | Asserts |
|---|---|
| TC-R16-A1-42 | The pack hard-line rejection carries `downstream_reviews` and `downstream_review_sources`, mirroring the base hard-line branch — the documented bug fix (previously neither field was set) — `evaluate.test.ts` |
| TC-R16-A1-43 | A BASE hard-line rejection carries sources from the firm, unregistered-component and model-governance producers (never pack obligations, since tier/track are skipped on a hard-line trip) — `evaluate.test.ts` |
| TC-R16-A1-44 | `downstream_reviews` is derived from `downstream_review_sources`, de-duplicated by review text — two firm rules sharing the same review text (DR-INFOSEC-01/02) produce two sources but one review string — `evaluate.test.ts` |
| TC-R16-A1-45 | The FINAL assembly branch includes a pack-sourced review, keyed by the pack rule's own id — `evaluate.test.ts` |
| TC-R16-A1-46 | The UNSATISFIABLE-INVARIANT rejection branch also includes the pack-sourced review, from all four producers — `evaluate.test.ts` |
| TC-R16-A1-47 | `applyJurisdictionOverrides`'s `addedReviews` is sorted by `rule_id`, deterministically, across multiple firing review rules — `jurisdiction.test.ts` |

## §1.5 — `envelope.ts` ranking export

| ID | Asserts |
|---|---|
| TC-R16-A1-48 | `DATA_CLASS_RANK` ranks MNPI above Client PII above Confidential above Internal above Public — `envelope.test.ts` |
| TC-R16-A1-49 | `maxBy` picks the most-sensitive class regardless of input order — `envelope.test.ts` |

## §1.4 — Loader check (`checkPolicyReferences`) and its call sites

| ID | Asserts |
|---|---|
| TC-R16-A1-50 | A clean policy with no plain-language fields and no `covers_reviews` has no errors and no warnings — `policy-references.test.ts` |
| TC-R16-A1-51 | The real shipped starter policy (no plain-language fields yet) loads with no errors — `policy-references.test.ts` |
| TC-R16-A1-52 | Errors — a `covers_reviews` id that is not a firm review id, a pack review rule id, `PV-UNREGISTERED` or `MODEL-REGISTRY`, in the contract's own message shape — `policy-references.test.ts` |
| TC-R16-A1-53 | `covers_reviews` accepts a firm review id — `policy-references.test.ts` |
| TC-R16-A1-54 | Accepts a pack `required_review` rule id, but not a pack rule of a different effect type — `policy-references.test.ts` |
| TC-R16-A1-55 | Accepts the bare `PV-UNREGISTERED` and `MODEL-REGISTRY` sentinels — `policy-references.test.ts` |
| TC-R16-A1-56 | Errors — a non-"in" operator on the list-valued system_access_scope field, in an invariant condition, a hard line condition, a downstream_reviews condition, a track condition and a tier trigger — `policy-references.test.ts` |
| TC-R16-A1-57 | A pack rule condition using a non-"in" operator on a list-valued field is also an error — `policy-references.test.ts` |
| TC-R16-A1-58 | Warnings — an unknown placeholder in a plain-language field; `{audience}` and `{destination}` are recognised and do not warn — `policy-references.test.ts` |
| TC-R16-A1-59 | Warnings — an unknown `@` token in `plain_owner`; `@submitter` and `@model_owner` are recognised and do not warn — `policy-references.test.ts` |
| TC-R16-A1-60 | Warnings — a platform or vendor with no `plain_name`; one with `plain_name` does not warn — `policy-references.test.ts` |
| TC-R16-A1-61 | A pack `required_review` effect's `plain_name`/`plain_owner` are scanned for placeholders and tokens too — `policy-references.test.ts` |
| TC-R16-A1-62 | App.tsx start-up gate: a `covers_reviews` reference error shows the "Policy file invalid" banner, naming the bad id, evaluation disabled — `App.r16a1.test.tsx` |
| TC-R16-A1-63 | IntakeFlow's first evaluation gate: clicking Proceed with a reference error shows the message via `reviewGateError` and does not proceed to the questionnaire/confirmation step — `IntakeFlow.r16a1.test.tsx` |
| TC-R16-A1-64 | PolicyEditor Validate shows a `covers_reviews` reference error, naming the control and the missing id — `PolicyEditor.r16a1.test.tsx` |
| TC-R16-A1-65 | PolicyEditor Save is refused on the same reference error — `onSaved` is never called — `PolicyEditor.r16a1.test.tsx` |
| TC-R16-A1-66 | A reference WARNING (e.g. a platform with no plain_name) still validates successfully and is listed, never blocking — `PolicyEditor.r16a1.test.tsx` |
| TC-R16-A1-67 | SettingsPanel refuses "Load sample use cases" with a specific reference-error message, not the seed function's own "nothing added" — `SettingsPanel.r16a1.test.tsx` |
| TC-R16-A1-68 | Refuses "Reload investment-bank portfolio" with the same specific message — `SettingsPanel.r16a1.test.tsx` |
| TC-R16-A1-69 | `seedSampleRegister` refuses to seed at all on a policy reference error — `sample-register.test.ts` |
| TC-R16-A1-70 | `seedIbPortfolio` refuses to seed at all on a policy reference error — `ib-portfolio.test.ts` |
| TC-R16-A1-71 | `seedAigateSelfAssessment` refuses to seed at all on a policy reference error — `aigate-self-assessment.test.ts` |

### Untested behaviours

- IntakeFlow's **second** evaluation gate (the description-first/correction
  path, just before the final `evaluate()` call) is wired identically to
  the first (same `checkPolicyReferences` call, same `reviewGateError`
  pattern) but has no dedicated UI-level test — TC-R16-A1-63 proves the
  pattern through the first gate, which is reached by a much shorter path
  (a seeded `graph_review` draft vs. a full confirmation-step rebuild).
  Reusing an identical, already-proven code shape at the second site was
  judged lower-risk than the cost of a second full end-to-end harness.
- The downstream backtest re-run (`npm test`, which runs
  `backtest-corpus.test.ts` and `backtest-predictions.test.ts`) found **zero**
  worked cases whose `downstream_reviews` changed — `backtest/engine-
  verdicts.json` is byte-identical before and after this chunk (`git diff`
  confirms it), because none of the four shipped packs
  (`policy/packs/*.yaml`) defines a `hard_line` effect, so the pack
  hard-line bug fix (TC-R16-A1-42) has no real corpus case to move. This is
  the expected outcome stated in the contract (§1.3: "expected: only
  pack-hard-line rejections, which now list reviews") — there are none in
  the real corpus today, so no pinned expectation in `backtest/use-
  cases.md` or `backtest/corpus.md` needed updating.
- Token rendering (`@submitter`/`@model_owner`) and placeholder resolution
  (`{audience}`/`{destination}`) are explicitly out of scope for this
  chunk (chunk D1's view-model) — `checkPolicyReferences` validates which
  tokens/placeholders are *legal*, never resolves one, and no test here
  asserts resolved output.

### Verification

`python3 scripts/trace-check.py` and `python3 scripts/spec-parity-check.py`
— both clean. Every file touched was run individually with `npm test --
<path>` (never bare `vitest`) three times consecutively, then the full
suite three times via `npm test`. `npx tsc --noEmit` and `npm run build`
both clean.

## Chunk A2 — plain-language text (owner-approved)

Fills the CF-6 schema fields chunk A1 added, with the exact text approved in
`build/prompts/R16.md` v2.1 §1.6: `plain_action`/`plain_owner`/
`plain_owner_with`/`covers_reviews` on all 22 controls, `plain_reason` on all
23 invariants, `plain_reason`/`plain_change` on all 5 hard lines,
`plain_name`/`plain_owner` on the firm's three downstream review rules and on
the three pack `required_review` rules this reaches (`SS1-UK-REV-01`,
`DORA-EU-REV-01`, `SR262-US-REV-01`), `plain_name` (+ `vendor_id` on
`PLAT-CLOUD-LLM`) on both platforms, and `plain_name` + `kind` on
`VENDOR-APPROVED-LLM`. Presentation text only — `reason`, `description`,
`condition` and `regulatory_basis` are untouched, and nothing this chunk
writes is read by the engine yet (chunk D1 renders it). Policy `version`
1.6 → 1.7; each of the three edited packs' own `version` bumped too, with a
dated change-log note — `grounding/PACK-AUTHORING.md`'s "on change" rule
(RA-10) requires re-review/re-sign only for rules citing a CHANGED SECTION,
which is none of these (no `source.text`, `condition`, effect type/review
wording, or `basis` changed), so sign-off status is unchanged.
`grounding/PACK-AUTHORING.md` also gains a reviewer-checklist line (R16
§1.4, D-51): a `covers_reviews` entry is a claim the control's action
satisfies that review, to be checked like any other condition.

Test file: `src/store/plain-language-coverage.test.ts`, reading the shipped
`policy/appetite.yaml` and `policy/packs/*.yaml` directly off disk.

| ID | Asserts |
|---|---|
| TC-R16-A2-01 | Every control in the shipped policy has `plain_action` and `plain_owner` set — `plain-language-coverage.test.ts` |
| TC-R16-A2-02 | Every invariant in the shipped policy has `plain_reason` set — `plain-language-coverage.test.ts` |
| TC-R16-A2-03 | Every hard line in the shipped policy has `plain_reason` and `plain_change` set — `plain-language-coverage.test.ts` |
| TC-R16-A2-04 | The firm's three downstream review rules (DR-INFOSEC-01, DR-INFOSEC-02, DR-VENDOR-01) each have `plain_name` and `plain_owner` — `plain-language-coverage.test.ts` |
| TC-R16-A2-05 | The three pack `required_review` rules this chunk reaches (SS1-UK-REV-01, DORA-EU-REV-01, SR262-US-REV-01) each have `plain_name` and `plain_owner` — `plain-language-coverage.test.ts` |
| TC-R16-A2-06 | Both platforms have `plain_name`; PLAT-CLOUD-LLM carries `vendor_id: VENDOR-APPROVED-LLM` and PLAT-INTERNAL-ML carries none — `plain-language-coverage.test.ts` |
| TC-R16-A2-07 | Vendor VENDOR-APPROVED-LLM has `plain_name` and `kind: company_assistant` — `plain-language-coverage.test.ts` |
| TC-R16-A2-08 | `covers_reviews` is set exactly where the contract specifies (`CTRL-INDEP-VAL-01` → `[SS1-UK-REV-01]`, `CTRL-TPRM-01` → `[DR-VENDOR-01, PV-UNREGISTERED]`) and on no other control — `plain-language-coverage.test.ts` |
| TC-R16-A2-09 | `checkPolicyReferences` on the shipped policy + packs returns no errors and no warnings at all (stronger than "no missing-plain_name warnings") — `plain-language-coverage.test.ts` |
| TC-R16-A2-10 | No plain-language field in the shipped policy or its packs contains "approved", "rejected" or "fired" — `plain-language-coverage.test.ts` |
| TC-R16-A2-11 | The shipped policy's `version` is `"1.7"` — `plain-language-coverage.test.ts` |
| TC-R16-A2-12 | With no rule packs loaded at all, an unresolved `covers_reviews` id is a warning, not an error (it can't be checked, and an id matching nothing can only fail to fold a review, never hide one); with packs loaded it stays an error (TC-R16-A1-52) — `policy-references.test.ts` |

### Backtest (byte-identical check)

`backtest-predictions.test.ts` and `backtest-corpus.test.ts` were re-run
unedited against the new policy/pack text. `git diff backtest/engine-
verdicts.json` shows exactly one line changed — `policy_version: "1.6"` →
`"1.7"` — no verdict, controls list, downstream_reviews, tripped invariant,
or applied override differs for any of the 31 corpus cases. The new
`PLAT-CLOUD-LLM.vendor_id` link has no engine effect: `resolveInheritance()`
(`src/engine/evaluate.ts`) resolves `platform`/`vendor` only from the
graph's own declared ids and never reads a platform's `vendor_id` — that
mapping is chunk B's form work — confirmed by grep before editing and by
the unchanged backtest after.

### Verification (chunk A2)

Touched test run individually three times consecutively via `npm test --
src/store/plain-language-coverage.test.ts`, then the full suite three times
via `npm test`. `npx tsc --noEmit`, `npm run build`,
`python3 scripts/spec-parity-check.py` and `python3 scripts/trace-check.py`
all clean. `npm run docs:rules` regenerated (policy version line only).

| Date | Change |
|---|---|
| 2026-10-02 | Written for R16 chunk A1 (schema, engine, loader). |
| 2026-10-02 | Written for R16 chunk A2 (plain-language policy text). |

---

*Developed using the Grounded Vibe Methodology*

## Superseded

| ID | Reason |
|---|---|
| TC-R16-A1-26 | Superseded by R18-GI-10 (R18-E): a single system_access_scope value on the card belonged to `GraphView`, the card review's screen, which is deleted. No replacement — behaviour retired. |
| TC-R16-A1-27 | Superseded by R18-GI-10 (R18-E): a list of system_access_scope values on the card belonged to `GraphView`, the card review's screen, which is deleted. No replacement — behaviour retired. |
