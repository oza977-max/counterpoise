# Build Checks

Standing checks promoted from recurring review findings. A check is loaded into
the build prompt and names the defect class, the diagnosing framework, and the
acceptance criterion.

Classification per Appendix C.2: **permanent** checks are literature-grounded
and never retire; **retirable** checks are project-specific and are surfaced for
retirement after three silent rounds.

---

## BC-001 — A spec claim about existing code must cite where it was verified

**Class:** permanent.
**Promoted:** 2026-07-29, after design review round 1.
**Diagnosing framework:** Fagan (author preparation — a claim not checked is not
a claim); the project's own calibration mandate "verify documentation claims
against behaviour, not against other documents".

**The defect class.** A specification asserts something about a symbol that
already exists — a prop is optional, a payload can carry a field, a value lives
on this type, a framework behaves this way — and the assertion is never checked
against the code. The spec then reads as authoritative and is wrong, and the
error is only found when someone tries to build from it, or later.

**Evidence of recurrence.**

| Round | Instance |
|---|---|
| explore 003 (2026-07-28) | D-002 claimed the guided form had no jurisdiction field. It had six checkboxes. |
| tech-spec round 3 (2026-07-29) | Phase 8 sequenced a chunk first because existing tests "would break". They could not — the assertions fire on a different screen. |
| design round 1 (2026-07-29) | C-1 assumed the sign-off payload could reference a verdict; C-2 assumed evidence status lived on the Verdict; I-1 assumed an affordance could be suppressed by omission; I-5 assumed StrictMode semantics backwards. |
| design review 007 (2026-10-02) | The R16 delta plans asserted four untrue facts about existing code: a `SUMMARY_VALUES` export, a tick-all editor in GraphView (R16.md D-22), the guessed-field mechanism covering two new extraction fields, and a session value carrying assumptions to the verdict step. None carried a `(verified: path:line)` citation. |

**Acceptance criterion.** Any spec statement asserting a property of an existing
symbol carries an inline citation of the form `(verified: path:line)` or is
rewritten as an explicit assumption to be checked during the build. A spec
section describing a component's contract without any such citation fails this
check. Reviewers may challenge a citation by reading the cited line.

**Last triggered:** design review 007, 2026-10-02 (four instances in the R16-D2/R16-E plans).

---

## BC-002 — Check and use data at a boundary in one and the same form

**Class:** permanent (tier 1).
**Promoted:** 2026-10-03, after code review 006 (systemic — three consecutive rounds).
**Diagnosing framework:** Bratus, Patterson & Sassaman, LANGSEC ("Security Applications of Formal Language Theory", 2013) —
recognise an input fully before acting on it, and never parse the same input twice with two different parsers; Kleppmann,
*Designing Data-Intensive Applications* ch. 4 — data written by one version must stay readable by the next.

**The defect class.** Data arrives from outside the code that will use it — a file from another person, a model reply, a
saved session draft, a record written by an older build, a stored answer whose options have since changed — and is checked
in one form but used in another: an integrity check computed over a re-serialised copy instead of the bytes as written; a
schema that validates the outer object and lets nested fields through unchecked; a saved state restored with no version
check; a stored value that no longer matches the current option set mapped to a default instead of the documented
"Not sure" path.

**Evidence of recurrence.**

| Round | Instance |
|---|---|
| code review 005 (2026-09-28) | Hand-off import validated the outer shape only (F3, F4, F13, F20); the nested verdict's confidence_caveats unchecked though a reader dereferences them (N4). |
| design review 007 (2026-10-02) | A bundle carrying an unknown record field reported as tampered — the schema stripped keys before the seal was recomputed; hand-off assumptions planned as "three strings"; the form's tick-all bypassing the single recogniser. |
| code review 006 (2026-10-03) | Hand-off verifies the hash chain over schema-PARSED (re-ordered) events → every real case rejected as tampered (CR6-01); Undo on a session saved by an older build crashes (CR6-04); stale stored answers skip the stricter-reading rule (CR6-06); stale country codes shown raw (CR6-23). |

**Acceptance criterion.** For every boundary the chunk touches: (1) integrity checks (hashes, seals) are computed over the
data exactly as written and stored as written — never over a parser's re-built copy; (2) the recogniser that validates is
the one whose output is used, at every nesting level a consumer reads; (3) persisted state carries a version and is
migrated or refused on mismatch, never read as if current; (4) a stored value outside the current option set takes the
documented "unknown" path. A chunk touching a boundary without a test of each applicable point fails this check.

**Last triggered:** code review 006, 2026-10-03.

---

## BC-003 — Test a boundary with data the real producer wrote

**Class:** permanent (tier 1).
**Promoted:** 2026-10-03, after code review 006 (systemic — three consecutive rounds).
**Diagnosing framework:** Kaner, *Lessons Learned in Software Testing* — realistic test data catches realistic bugs;
Beck, *Test-Driven Development* — a test that cannot fail tests nothing; GVM TDD-3 (realistic-fixture variant).

**The defect class.** A test of a boundary uses sample data typed by hand in the shape the consumer expects (the schema's
key order, the values the screen already handles, a country spelled the way the formatter wants), so the test passes while
the real producer's output fails — or a guard test checks a hand-copied list instead of the source it claims to mirror.

**Evidence of recurrence.**

| Round | Instance |
|---|---|
| code review 005 (2026-09-28) | 20 of 22 C+I findings in a feature tested only through its store API with well-formed synthetic bundles, never through its UI. |
| design review 007 fix verification (2026-10-02/03) | A test fixture bent to hide a duplicated message; sample packs spelling "the European Union" when real packs say "EU"; tests pinning garbled fallback prose. |
| code review 006 (2026-10-03) | Every hand-off test used a hand-typed verdict in the schema's own key order, so the total hand-off break stayed green for five days (CR6-01); TC-R16-E-11's "every field the generator can emit" list hand-typed (CR6-25); TC-R3-JU-5-01 checks fieldsets only (CR6-07). |

**Acceptance criterion.** Each boundary a chunk touches has at least one test whose input was produced by the real producer
(the app's own writer, evaluate(), the seed path, a real export) rather than typed in the consumer's shape — for the hand-off,
an app-written case exported and imported end to end. A guard test that claims to mirror a source derives its list from that
source at test time. A boundary test suite with only hand-shaped fixtures fails this check.

**Last triggered:** code review 006, 2026-10-03.

---

## BC-004 — Every return path keeps the safety and honesty fields

**Class:** permanent (tier 1).
**Promoted:** 2026-10-03, after code review 007 (systemic — three consecutive code-review rounds plus a build loop).
**Diagnosing framework:** Fagan, *Design and Code Inspections* — every path needs defined entry and exit criteria;
Beizer, *Software Testing Techniques* — bugs cluster at boundaries and error paths.

**The defect class.** A state carries a safety gate or an honesty field (guessed values still to confirm, "Not sure"
assumptions, provenance quotes, the countries gate, a pending follow-up question) on the way forward, and one of the ways
BACK into an earlier step — Back, Start over, Undo, Change an answer, a failed evaluation, a restored draft, a reload —
rebuilds the earlier step without it. The case then reaches the result unasked or presented as firmer than it is.

**Evidence of recurrence.**

| Round | Instance |
|---|---|
| R16-F build loop (2026-10-03) | Passes 2–5 each found a navigation path that switched off a gate. |
| code review 006 (2026-10-03) | CR6-02 (Start over left work running), CR6-03 (Back dropped the guessed-value check), CR6-15. |
| code review 007 (2026-10-03) | CR7-02 (Change an answer / failed evaluation drop assumptions), CR7-03 (Back drops answers; a rejected supplier guess reaches the result), CR7-01 (restored extraction never restarts), CR7-28 (old draft restores without the guessed list). |

**Acceptance criterion.** For each state a chunk adds or changes, list every action that can re-enter an earlier step
(the reducer's step × action table) and, for each, a test that starts from a state holding every safety/honesty field and
asserts they survive the round trip — or that the step is rebuilt fail-safe (re-asks). A fix whose text names several
paths has one test per named path. Prefer making the fields required on the step's type so a dropped field fails to compile.
**The converse (added after code review 008):** for every field a fix carries forward, list the actions
that must REMOVE or RESET it (an edit that makes an assumption untrue, a step that ends a guard's
reason) and test each — CR8-01 was a carried assumption no card edit removed.

**Last triggered:** code review 008, 2026-10-04 (CR8-01, CR8-03, CR8-08).

---

## BC-005 — Say no more than the code can prove

**Class:** permanent (tier 1).
**Promoted:** 2026-10-03, after code review 007 (third code-review round; NF-2/NF-7 honesty rule in CLAUDE.md).
**Diagnosing framework:** Redish, *Letting Go of the Words* — the reader acts on what the words say; Anderson,
*Security Engineering* — assurance claims must match the mechanism.

**The defect class.** Rendered text states something stronger than the code establishes: a status derived from a field that
does not mean what the sentence says, an "always/never/preserved/verified" the code does not guarantee, a fixed string that
describes data the screen never reads.

**Evidence of recurrence.**

| Round | Instance |
|---|---|
| code review 005/006 | CR6-15's "probably confirmed in another tab or window" for a same-tab completion; earlier "immutable" trail copy. |
| code review 008 (2026-10-04) | CR8-02 "You can start" in next steps under a "no sign-off on record" headline; CR8-04 "verified … unbroken" / "would show as a break" when deleting the newest entries passes the check. |
| code review 009 (2026-10-04) | CR9-02 "What you need to do: Nothing." under a "confirm the sign-off first" headline (a fifth surface P4 did not list); CR9-01 the user guide's "discloses it as self-service final"; CR9-05 README "a deleted record shows up as a break". |
| code review 007 (2026-10-03) | CR7-09 "no sign-off needed — self-service" on a case 2LoD signed off; CR7-22 "corrections are preserved in the audit trail" when only a count is written; CR7-40 "machine-verified" for evidence typed into the policy file; CR7-38 "not yet signed off" hard-coded for every pack. |

**Acceptance criterion.** Every new or changed user-visible sentence that asserts a fact about the case, the trail or the
policy names (in a code comment or the spec) the field or event it is derived from, and a test renders it in the state where
the claim would be FALSE and asserts it is absent. Fixed strings that describe data are computed from that data.
Every surface that renders the same fact (headline, next steps, stage note, banner, confirm notice) is checked
together — CR8-02's next steps contradicted the fixed headline; CR9-02's to-do box was a fifth surface. The published
docs (README, docs/user-guide, docs/tester-guide, docs/try-these) are surfaces too: a fix that changes what a screen
claims greps the docs for the old claim, and a docs publish checks every factual sentence against the app, not only the
worked outcomes.

**Last triggered:** code review 009, 2026-10-04 (CR9-01, CR9-02, CR9-05).

## BC-006 — Every plan item ends in the handover as done or not taken

**Class:** permanent (tier 1).
**Promoted:** 2026-10-04, after code review 009.
**Diagnosing framework:** Fagan, inspection exit criteria — an item without a recorded disposition is an
unchecked exit; Keeling, *Design It!* — a decision that is not written down is not a decision.

**The defect class.** A fix plan assigns an item (often to the chair / main loop rather than a builder), the item is
neither built nor listed as not taken, and the handover reads as if it were done. A reader trusts the handover.

**Evidence of recurrence.**

| Round | Instance |
|---|---|
| code review 009 (2026-10-04) | O-4 ("No model was named" only when asked) and O-5 (refresh the app after a part-failed policy save) — "Taken" in build/prompts/CR8-fixes.md, absent from the code and from the handover's not-taken list; 7 panels found O-5. |

**Acceptance criterion.** Before the handover is written, every finding id and every "taken" observation id in the
contract is listed in the handover with one of: done (commit + test id) / not taken (reason). Items assigned to the main
loop are tracked like a builder's. A grep of the contract's ids against the handover returns no id missing.

**Last triggered:** code review 009, 2026-10-04 (CR9-03, CR9-04).
