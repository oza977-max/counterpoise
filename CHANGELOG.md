# Changelog

All notable user-visible changes to Counterpoise. Written from the point of view of
someone using the tool, not someone building it — internal refactors, test
scaffolding and build mechanics are left out.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions refer to the **application**; the starter risk-appetite policy carries
its own version (currently `1.9`), shown in the app header and recorded on
every verdict.

---

## [0.18.0] — 2026-10-26 — the proof-of-concept release

The version the project is parked at as a working proof of concept. It covers
three rounds of work since 0.17.0 (R16, the rename, R18) and four rounds of
review fixes.

### Changed — the product is now called Counterpoise (2026-10-02)

- New name, logo and tab icon; the code and the live demo moved to
  `oza977-max/counterpoise`. Cases saved and hand-off files exported by
  earlier versions still open — the stored identifiers did not change.

### Added — R16, plain language from end to end

- The questions are a guided form in plain words, written from the policy's
  own approved plain-language text (policy 1.7).
- "What we understood": the case summarised in the form's own words before
  you confirm.
- A new first screen for the result: the decision, the reason and the next
  steps up front. A "No" gets its own screen naming the hard line crossed.
- "Not sure" answers are saved with the case as stated assumptions, and a
  form answer can be corrected later.
- Plain names for the two models the policy allows (policy 1.9, wording only).
- A warning when a description tries to dictate its own rating ("classify
  this as low risk…"). The rules still decide; the warning makes the attempt
  visible.

### Added — R18, describe first, with an optional AI helper

- Every case starts with a description in your own words. A checklist shows
  which topics your words touch, and a short nudge lists the ones they don't.
- **Optional AI helper.** Connect a model in Settings — on this computer, on a
  firm server, or Ollama's cloud — and it suggests answers from your
  description, quoting the words it relied on. A suggestion counts only after
  you tick "I've checked this answer" or change it. Without a model you
  answer the questions yourself, and nothing else changes.
- Each case records where every answer came from (typed, or suggested and
  checked), and the register shows it.
- **Correct a check from the register.** An older case opens on the form;
  its "Not sure" answers come back for a fresh tick, and anything not carried
  over is marked.
- One route: every case goes through the same form.
- **Test it.** Settings can run the connected model over the 31 public worked
  cases and label it with what it filled in right, left blank and got wrong.
- On the public demo: an "Optional: connect an AI helper" panel with the two
  setup steps, and "Try an example" with ten worked cases.
- Settings, the describe screen and About say where your description goes
  when a model is connected. With no model and no Anthropic key saved,
  nothing about a case leaves the browser.

### Fixed

- Fixes from code reviews 006–009 and end-to-end test 007, among them: one
  confirmation per case across browser tabs, a hand-off import that is
  honest about what it holds, and WCAG 2.1 AA on every changed screen.

### Known limits at this version

- **First-time users.** Six simulated newcomers, three rounds: none reached
  a less strict decision or risk tier than the right one, and the one
  deliberately wrong suggestion was caught every round. Two things still confused most of them — the
  AI helper's technical model name, and the topic checklist's narrow word
  matching. Both are written up for a next round in `specs/forward-notes.md`.
- **The AI helper has not been run against a real model's replies yet.** Its
  test replies are marked provisional, and the app labels a model "not yet
  tested" until it has been tested in Settings.
- The demo's rules are not signed off by a firm, so every result says
  "provisional". That is deliberate.

---

## [0.17.0] — 2026-08-26

### Changed — R15, the targeted redesign (Option B)

A six-panel design deliberation (AI governance, regulation, banking
practice, clarity, interaction design, information layout) recommended a
targeted redesign over a full rebuild — presentation only, the engine and
audit model untouched. Shipped in five chunks:

- **Register** — 2LoD default view is "awaiting your sign-off," Show-all
  one click away; grouped filter chips with an always-visible legend; Stale
  and Sampling merged into one Flags column; stage labels in plain words
  (`pre_checked` → "Awaiting 2LoD sign-off") with the raw value kept for
  audit reconciliation; role switcher relabelled "Viewing as" with an
  explicit no-sign-in note.
- **Verdict & sign-off** — a "Before you sign off" checklist of jump links
  (never checkboxes — this is read-and-jump, not a task list); sticky
  section nav that deliberately excludes a direct link to Sign-off, so a
  reviewer still has to scroll through the reasoning; the self-asserted-name
  caveat now also appears at the point of approval, not just the header.
- **Guided form & Confirm & attest** — five plain-language sections
  (About it / input data / processing / output / jurisdictions); optional
  fields state what leaving them blank means; long help text moves behind
  "Why we ask" disclosures, load-bearing sentences stay visible outside
  them; the raw engine vocabulary that used to leak into the attest screen
  and the verdict's "what you told us" fold (`traditional-ml`, `L3`, `Zone
  B`) now renders in plain words from one shared source, so both screens
  stay in sync by construction.
- **Appetite framework & header** — the readable rulebook (levers, action
  banner, jurisdiction packs, hard lines, risk knowledge) is the default
  view for every role; the YAML editor sits behind a closed-by-default
  disclosure with an honest no-sign-in line; the header's translation-
  fidelity warning is now a visible chip with an accessible expand/hide
  detail, not a hover-only tooltip.
- **Graph review & rule-improvement queue** — "model confident — no
  verified basis" reworded to "not found in your text — worth a second
  look," kept as its own distinct badge (not merged with "guessed" — a
  design panel explicitly rejected collapsing the two); long provenance
  quotes truncate with an expand action, the extracted value itself never
  does; the queue leads with the plain rule name and a "has applied to N
  decided cases" line, and now tags each entry as filed by a reviewer or
  by the risk-knowledge lens.

### Fixed

- The register table's Policy Version and Flags columns could overflow
  past the page edge at ordinary desktop widths — the table now scrolls
  inside its own bounds at any width, not just on mobile.
- A first-time visitor's register showed only the app's own
  self-assessment. The 16-case investment-bank sample portfolio now loads
  automatically alongside it, so the register, sign-off queue and
  risk-knowledge lens all have something real to show without a manual
  "load sample data" step.
- Seeded sample verdicts (both the investment-bank portfolio and the
  smaller sample set) never carried the marker that tells the app they'd
  been checked against the risk-knowledge lens — so every seeded case
  looked like it predated that feature and the MIT AI Risk Repository
  panel never appeared on them. Fixed at the shared seeding source.

### Added

- **Research**: "After Deployment" — a published research briefing on
  post-deployment AI risk and its implications for financial institutions,
  built from the MIT AI Risk Repository and 20+ independently graded
  regulatory and industry sources, with two rounds of adversarial review.
  Linked from the README and served at `/research/after-deployment.html`
  on the live demo.

---

## [0.16.0] — 2026-08-18

### Changed — the verdict screen recomposed (the R9 treatment)

A GVM design-review panel (Cooper / Krug / Fogg / Few grounding) decided
what stays visible and what sits one click away — nothing removed:

- **"What you need to do" now comes first**, right under the one-sentence
  headline — before tier/track and the binding rule.
- **"Why this verdict" stays open** — it is the reasoning that makes the
  verdict defensible; everything below it is substantiation.
- **Five panels fold behind one click, each with a gist you can read
  without opening:** fragility ("7 rules held by a single control · margin
  of safety 42%"), platform & vendor inheritance, the regulatory reasoning
  chain ("1 rule from regulation fired — pending firm sign-off"), expiry
  conditions, and "what you told us". The control-set panel folds only
  when every control is already VERIFIED; any outstanding evidence keeps
  it open.
- **Plainer words:** "Margin of safety" replaces HEADROOM; "Derived:" /
  "Inherited:" replace the all-caps arrow labels; the control-evidence
  axes read "built right (design)" / "working right (operating)"; the
  binding rule says "— the single rule that decided this"; an internal
  spec id left a heading.

## [0.15.1] — 2026-08-18

### Changed — the verdict says what to do, in plain words

User report: "Resolvable citations · CTRL-CITE-01 · outstanding" told a
reader a code and a status, not what the control is, why this case needs
it, or what done looks like — and "too much happening" to tell what the
verdict was.

- **One-sentence headline first:** "Inside appetite once 9 controls are
  in place, with 2 separate reviews other teams own. Not final until a
  second-line reviewer signs off."
- **Every required control now explains itself** with three plain lines
  read straight from the policy file and the verdict's own reasoning:
  *what it is*, *why this case needs it* (the rule that demanded it, in
  words), and *what "in place" looks like* (how you would evidence it).
- **The to-do list is grouped** — controls to put in place / separate
  reviews other teams own / then sign-off — instead of eleven
  same-weight items.
- Control codes demoted to quiet secondary text everywhere; the
  evidence panel is named for what it shows ("The control set, with
  evidence status") instead of a requirement id.
- Also fixed a 1-in-3 flaky test on the memo-hash download (an async
  race) — caught by the run-three-times ritual.

## [0.15.0] — 2026-08-18

### Changed — the knowledge lens earns its place

Two practical-judgment reviews (a second-line practitioner driving the
live app; an AI-risk taxonomist auditing the curated file) judged the
risk-knowledge panel "wallpaper a real review team would switch off
within a month." Every finding fixed:

- **Gaps now lead.** Uncovered risk classes render first, in their own
  highlighted treatment, and a one-line notice appears near the top of
  the case page whenever a gap exists — a gap can no longer hide below
  the fold among "already covered" lines.
- **"Already covered" collapses to one line** ("8 known risk domains
  already addressed — show"), expandable. Nothing hidden; attention
  directed.
- **Filing a gap now shows it.** After "file as coverage gap", the entry
  flips to a permanent "Filed — on the rule-improvement queue" state,
  read from the audit trail itself so it survives reloads and cannot be
  double-filed.
- **Old cases say why they show nothing.** Cases decided before the lens
  existed now carry "not evaluated against the risk-knowledge taxonomy"
  instead of silent absence.
- **The curated entries earn their matches.** A real bug fixed: the
  vendor-concentration entry checked a value that doesn't exist in the
  data model, so it misfired — and its "no rule covers this" claim is
  now a documented decision rather than an accident. Three over-broad
  entries that tagged whole model families (every agentic case, every
  client-facing case) gained discriminating conditions.

## [0.14.0] — 2026-08-18

### Added — the trust-mechanics round (every concept-review finding closed)

- **Staleness is now machine-enforced, not calendar-dependent.** Every
  jurisdiction pack carries a review window; a verdict citing regulatory
  text past its window shows an undismissable "review overdue" marker,
  and the policy screen shows each pack's age. The risk-knowledge file
  now names its curator, its review owner, and its own freshness window.
- **A spot-check net under self-service.** Self-served low-tier verdicts
  are deterministically sampled (1 in K, set in the policy file) for a
  second-line spot review — the register flags "sampling review due" and
  the review lands on the permanent record. The rule-challenges screen
  now shows how often each rule fires versus how often it is challenged.
- **Honesty badges recalibrated in both directions.** The quote marker
  now says exactly what was checked ("found word-for-word — check it
  supports the value"); a model that is confident with no verified basis
  says so in one combined marker; rules inferred from regulatory text
  state plainly that the regulator has not confirmed that reading; and
  provisional causes split into "sign-off gaps" (closeable paperwork)
  versus "substantive caveats", with the register showing how many
  verdicts would be final once the paperwork lands.
- **Model-family approvals now expire.** A family approval carries a
  re-attest-by date; past it, the family confers no approval and the
  model routes to review. Settings shows the local model's exact digest
  so a deployment can verify it runs the build that was benchmarked.
- **The challenge memo is tied to the enforced rules.** Each memo prints
  a content hash of the active policy file, so what was attested can be
  checked against what was enforced.
- **A narrower front door.** The first-line role no longer sees
  reviewer-only machinery; the README opens with a 90-second orientation
  and "back-test your own committee's past decisions" is now the first
  real adoption step.

### Deliberately not built

- A one-click "accept all AI-drafted fields" fast path was considered
  and declined: it would reintroduce the exact automation-bias risk this
  round exists to counter. The per-field confirmation gate stands.

## [0.13.0] — 2026-08-17

### Added

- **The third lever: risk knowledge.** Alongside your firm's appetite and
  jurisdiction rules, AIGate now carries a curated advisory lens against
  the MIT AI Risk Repository's public domain taxonomy (CC BY 4.0). Where a
  use case's shape matches a known risk class, it's shown beside the
  verdict — never inside it. Its schema has no field that can express a
  tier, control, or verdict effect, so it cannot decide anything even by
  accident, and a test proves `evaluate()`'s output is byte-identical
  whether the lens is loaded or not. Where a matched risk has no rule
  covering it yet, one tap files the gap into the rule-improvement queue.
- **Model governance.** Intake now asks which AI model is running a use
  case, same as it already asks which vendor. An unlisted or unapproved
  model triggers a named review, exactly like an unapproved vendor
  already does. Models are classed by provenance (vendor-hosted /
  open-weights self-hosted / fine-tuned in-house) as an attribute the
  firm's own rules judge — never a hardcoded penalty. AIGate's own
  self-assessment now honestly declares the model it runs on.
- **Approved-model families, not just exact versions.** A registry entry
  can approve a whole model family by vendor + version pattern, so the
  list doesn't go stale every time a vendor ships a point release. An
  exact match still always wins where one exists, and this never weakens
  the existing requirement that higher-stakes use cases pin an exact,
  validated model version.
- **The three levers, visibly distinct in the app.** The policy screen and
  About page now name all three sources a verdict can trace to — firm
  appetite (decides), jurisdiction packs (decide, where the law applies),
  and risk knowledge (informs, never decides) — with the README diagram
  and `docs/approach.md` updated to match.

## [0.12.0] — 2026-08-17

### Added

- **A downloadable effective-challenge memo.** Every verdict screen — the
  intake result and the 2LoD sign-off page — can now export a markdown memo
  written in the reviewer's language: the verdict in appetite vocabulary,
  the inherent and residual positions, the full regulatory chain with its
  quoted sources, every sign-off on the record, and every provisional or
  unverified marker carried verbatim. The memo restates the record; it does
  not strengthen it, and generating one writes nothing anywhere.
- **Inherent and residual framing on the verdict.** The rules that trip
  before controls are now labelled as the inherent position, and the
  minimal control set as the residual position — the standard 2LoD
  vocabulary, as labels only. Nothing is recomputed.
- **Design and operating effectiveness on control evidence.** A control's
  verification evidence in the policy file may now attest the two standard
  effectiveness axes separately (effective / deficient / not assessed), and
  the verdict renders a chip for each. Existing single-status evidence
  stays valid and renders exactly as before.

## [0.11.1] — 2026-08-17

### Fixed

- **The guided form's audit trail now records the birth of a use case.**
  Found by running cases through the actual app screens and comparing the
  resulting trail against a seeded one, event by event: the AI intake path
  wrote the "use case created" event (with your original description and
  how it came in), but the guided form — the most-used path — never did.
  Both paths now write it identically.

---

## [0.11.0] — 2026-08-17

An investment-bank portfolio in the box.

### Added

- **"Load investment-bank portfolio"** (sidebar → Demo data): 16 use cases
  across Markets, Advisory, Operations, Finance, HR, Technology, Risk,
  Compliance and Legal — every verdict computed by the real engine at load
  time, nothing canned. Most carry the full first-line-to-second-line
  chain on the audit trail (named sample reviewers, clearly marked as
  seeds); one case has a correction request with the reviewer's reason;
  several are deliberately left awaiting sign-off so the reviewer queue
  has real work; and one carries a filed rule challenge so the
  rule-improvement queue shows a live example. Outcomes genuinely vary —
  in appetite, in with controls, and outside — because the cases were
  designed to exercise different rules, not to look good.

---

## [0.10.0] — 2026-08-17

Honest everywhere AND legible: the review screen recomposed. Round 9, from
the product's first design review ("honest everywhere and legible
nowhere"). Nothing honest was removed — content became aggregated,
prioritised, or one click away.

### Added

- **A checklist at the top of the review screen**: "3 steps before you can
  proceed", each item naming its card and scrolling to it, each vanishing
  as you complete it. Your to-do list no longer lives inside the error you
  get for clicking Proceed too early.
- **"Fix guessed values"** on cards the model guessed at — the card that
  most needs action no longer looks like the one with no button.

### Changed

- **"Why these values matter" is now one click away** per card, so the
  two fields needing judgment stop drowning in twelve lines of
  always-the-same explanation. (The round formally amends the earlier
  requirement's wording from "displays" to "displays, or reveals in one
  click" — recorded in requirements-009.)
- **One alarm per card**: the uncertainty banner is the only loud element;
  guessed markers became quiet badges; plausibility warnings got their own
  advisory look so advisory ≠ blocking at a glance.
- **Required actions come before reading material**: jurisdictions moved
  above similar decided cases, and similar cases collapse to a one-line
  count you can expand.
- Long descriptions scroll inside a capped box instead of pushing the
  cards below the fold.

### Fixed (delta code review 005)

- The precedent list now refreshes when you correct the graph in place.
- The sign-off page no longer re-reads the whole register after every
  action just to redraw an unchanged precedent list.
- The "never leaves this machine" check now also runs at the exact moment
  a description is sent, not only when settings are saved.

---

## [0.9.0] — 2026-08-17

The register starts paying rent: similar decided cases, plus a housekeeping
and review batch.

### Added

- **Similar decided cases.** The graph review screen and the 2LoD sign-off
  page now show up to three similar cases this register has already
  decided — outcome (in appetite vocabulary), tier, track, required
  controls, and the policy version they were decided under. Deterministic
  word-overlap matching, fully explainable, and advisory on its face:
  precedent informs, the rules decide.
- **A new action type: `inform`** — answers or presents information
  directly. Closes the sweep-001 gap where a website chatbot's answers
  were schema-forced to "trade".
- **CI.** Every push now runs the full test/typecheck/build/spec-parity
  gate on GitHub — the "no CI" caveat carried since release 006 is closed.
- **First judge experiment ran** (reviews/judge-001.md): the local 4B
  model as an advisory judge scored 1/11 against the engine — with its
  written reasoning right in 10 of 11 and the schema's field order to
  blame. The lesson (reason before prediction) is recorded in FN-009.

### Fixed

- **"+ New pre-check" now starts a new pre-check** after a finished one —
  the oldest recorded bug (v0.3.2). In-progress drafts are untouched.
- From the fresh review pass (code-review-004, honesty + correctness
  panels): "Confirmed by you." can no longer appear on a card nobody
  confirmed; the "never leaves this machine" promise is now enforced in
  code (the model slot only accepts a local address); decision-type and
  human-in-the-loop fields can now carry provenance quotes instead of
  always reading as guessed; a failed evaluation no longer hides the
  jurisdictions panel or your description; a hung model server times out
  instead of loading forever.

---

## [0.8.1] — 2026-08-17

One model slot, honestly framed.

### Changed

- **The vendor API key field is gone.** Settings now has a single generic
  model slot for plain-language intake — the demo runs on the free local
  open model that has actually been exercised live (Qwen 3 4B), with a
  footnote stating plainly that frontier models draft noticeably better
  and that a firm deployment would point the same slot at a stronger model
  inside its own boundary. Every screen and document that referenced the
  vendor key now tells the single-model story.

---

## [0.8.0] — 2026-08-17

Jurisdictions are confirmed, never assumed. Round 7, from sweep-001's
sharpest finding: the model once invented "US" as a jurisdiction — a valid
code, so it would have silently switched on the US regulatory rule pack.

### Added

- **A jurisdictions panel on the graph review screen (AI path).** The
  model's reading is shown by name ("United States (US)") and framed as
  proposed; you confirm it, or edit it with checkboxes limited to the
  jurisdictions your policy declares. An empty reading says plainly that
  only the firm's own appetite will apply, and asks you to confirm that
  too. **Proceed refuses until you have** — the field that decides which
  regulations judge your use case is never left to a model. Edits are
  recorded as versioned corrections, like any other change. The guided
  form is unchanged (its jurisdiction answer was always explicit).

---

## [0.7.1] — 2026-08-16

The follow-up questions stop being confusing. Every item here reproduces a
finding from the user's own run.

### Fixed

- **Some questions wrongly asked for typed text.** "What level of human
  oversight…?" showed an empty text box, and whatever you typed was written
  into a numeric field — corrupting the record and jamming the flow. Those
  questions (autonomy, reversibility, scale) are now proper buttons, and a
  validation gate refuses any answer outside a field's legal values, from
  any path.
- **Answer buttons now speak plain English** — "Inside the firm only — our
  own systems (Zone C)" instead of a bare "Zone A/B/C" row; same wording as
  the form and the graph review, one shared source.
- **Each answer is acknowledged**: "Recorded: … " with an **Undo**, instead
  of the next question silently replacing the screen.
- **The question count explains itself** — "Question 1 of 10 · all 10 asked
  because your description did not state them" replaces the contradictory
  "0 / 10 · budget ≤5".
- **A double-click can no longer record an answer twice** and skip the next
  question (guarded in the UI and refused in the state machine).

---

## [0.7.0] — 2026-08-16

The model must show its working. Requirements round 6, from the user's
"give a confidence score on each interpretation" — reshaped into something
checkable.

### Added

- **Every extracted value now shows the words it came from.** Under each
  field: *based on: "firms internal data"* — the exact phrase from your
  description the model read. The quote is mechanically verified to exist
  in your description; a model that paraphrases or invents a quote gets
  that field treated as a guess. No confidence percentages — you can check
  a quote in a second; nobody can check "82%".
- **Guessed fields are asked, not nodded through.** A field the
  description doesn't support shows *"the description does not say — the
  model guessed"*, its card cannot be one-click confirmed, and the flow
  asks it as a specific question with the same plain-English options as
  the form. Vague descriptions now cost questions instead of hiding
  guesses.
- **A context box on every question** — "anything the reviewer should
  know about this answer?" Optional, read by the person who signs off,
  never by the rules; recorded with the attestation and shown on the
  sign-off page.

### Fixed

- **Question answers now actually change the evaluated graph.** Answers
  were recorded and checked for contradictions, but the engine evaluated
  the model's original best-guess values regardless of what you answered —
  found while specifying this round. An answer that differs from the graph
  is now applied as a recorded, versioned correction, so the verdict is
  computed from what you said.

---

## [0.6.0] — 2026-08-16

The graph review now explains itself. Requirements round 5, raised by the
user after real local-model runs: "the graph can actually show you whether
it's right or wrong — it's a bit naive right now."

### Added

- **Every value on the review screen now says what it means and why it
  matters.** "Zone A" reads "On the open internet — outside the firm's
  control", with "Hard lines and zone rules read this field" underneath. The
  same plain-English wording as the guided form, so the two screens cannot
  disagree. Decision type and human-in-the-loop, previously invisible here,
  now render too — "not stated" when the model didn't say, never a default.
- **On the AI path, nothing is scored until you confirm each card.** Every
  card starts "proposed by the model"; Proceed refuses (and says why) until
  each is confirmed or corrected. Editing a value counts as confirming that
  card — you clearly read it. The guided form is unchanged: you typed those
  answers yourself.
- **Uncertainty is loud.** A card the model flagged as low-confidence says
  "the model was not confident here" and asks for its own explicit check.
- **Plausibility warnings.** When your description sounds internal but a
  value says open internet, or mentions training (which the rulebook has no
  action type for), or says a person reviews while the graph says otherwise
  — the field gets a ⚠ note. Advisory only: warnings never change a value
  and never block. Each pattern in the table exists because a real run
  produced that misread.
- **Junk jurisdictions are surfaced, not carried.** The model once returned
  "Internal" as a jurisdiction; unrecognised values are now removed before
  you see the graph, and the screen names what was ignored.
- A hint when a graph has two or more processing steps: consider one use
  case per pre-check.

---

## [0.5.0] — 2026-08-16

Plain-language intake without an API bill — and its first-ever live run.

### Added

- **Local open-model support.** Under Settings, point AIGate at a small open
  model running on your own machine via Ollama (free, no account, no key).
  It enables the same plain-language intake as the API key: describe the
  use case, the model proposes a data-flow graph, you review and correct
  every field before anything is scored. Your description goes to a local
  process on your computer — never to the internet. A saved Anthropic key,
  if you have one, still takes precedence.
- **"Test & save"** checks the connection and that the model is actually
  downloaded before saving — and tells you the exact command to run if not.

### Changed

- **The "never run live" disclosure is now dated history for one provider.**
  On 16 August 2026 the plain-language path ran live for the first time,
  against qwen3:4b on the author's own machine: a real description became a
  usable draft graph in ~15 seconds, with one field misread (data zone) —
  caught on the review screen, which is what it is for. The Anthropic-API
  variant remains never-run-live and still says so. All seven disclosure
  surfaces updated to the two-provider truth.

---

## [0.4.0] — 2026-08-15

The rule-improvement queue: rules can now be challenged, and the challenges
have somewhere to go.

### Added

- **"Challenge a rule" on the sign-off page.** A 2LoD reviewer who thinks a
  rule the verdict relied on is wrong, too broad, or missing a distinction
  can now say so, on the record. The challenge names the rule (picked from
  the verdict's own reasoning, or typed as a reference), the reasoning, and
  who filed it. It is advisory by construction: the verdict stands
  unchanged, nothing moves in the lifecycle, and the challenge cannot be
  edited or withdrawn afterwards — it is part of the audit trail.
- **A "Rule challenges" screen** (sidebar), grouping every filed challenge
  by rule for the people who author the rulebook. Nothing in the queue
  feeds back into the engine — rule changes still happen the only way they
  ever have: a human edits the framework or a pack, and signs it off.
- The design behind this — an advisory dissent panel where machine
  reviewers could one day file through the same channel, with the same
  authority over the verdict (none) — is recorded in
  `specs/forward-notes.md` FN-009 rather than built, because this build
  has never run an LLM call live and won't pretend otherwise.

---

## [0.3.2] — 2026-08-15

Second hostile walkthrough, remaining paths.

### Fixed

- **The duplicate check now matches what you described, not just the short
  name.** Re-typing a word-for-word identical description of an existing
  case found nothing, because matching ran against register labels — three-
  word names. Descriptions are now stored on the register entry and matched
  alongside the name. (Entries saved before this version carry no stored
  description and still match on name only.)

- **← Back can no longer walk you out of a correction.** On a correction
  pass it stepped "back" to a duplicate check for an empty description — a
  step the correction never came through — and proceeding from there
  silently turned the correction into a fresh blank draft. A correction's
  only exits are completing it or starting over.

### Known, recorded

- After completing a pre-check, the "+ New pre-check" sidebar item does not
  reset the finished flow — navigate to Register and back to start a new
  one. Recorded, not yet fixed.

### Verified working

- The full correction chain: rejected verdict → correct one field → still
  correctly rejected (the other zone still breached) → correct the second →
  in appetite with controls. All six audit events in order, both
  corrections with before/after values, the original rejection preserved.
- 1LoD sees no sign-off actions on the review page — role-gating holds.

---

## [0.3.1] — 2026-08-15

Found by testing the product as a user, again. Two of the three would never
have been caught by the suite, because they lived in the gaps between
correct components.

### Fixed

- **Lying to the form no longer sails through.** Describe the use case as
  "no client data at all", then declare Client PII in the guided form, and
  nothing happened — the contradiction detector ran only on questionnaire
  answers, and the guided form (which marks nothing uncertain) generates no
  questions, so the check was skipped along with the questionnaire. The
  contradiction review now gates the skip itself: both statements shown,
  a written resolution required before attestation.

- **Resolving a contradiction no longer dead-ends.** After resolution the
  flow returned to a zero-question questionnaire reading "All questions
  answered." — over no forward control. Pre-existing on the normal path too,
  whenever a contradiction fired on the final answer. Resolution now
  proceeds to the attestation.

- **Your resolution explanation is now on the record.** The justification
  you are required to type was carried in memory and never written anywhere
  — it evaporated at attestation. It now lands on the attestation event and
  reads back on the sign-off page: *"1 contradiction resolved: '…'"*. On an
  audit product, an explanation that vanishes is a defect, not a detail.

- The welcome card's "Got it" button was nearly invisible.

### Verified along the way

- "Clear all data" correctly refuses when AIGate is open in another tab, and
  says so — the error message diagnosed this tester's environment exactly.
- "Start over instead" genuinely starts over.

---

## [0.3.0] — 2026-08-15

### Added — the product explains itself

- **An About screen, in the app.** The live link used to drop first-time
  visitors straight into "New pre-check" with no context — the README and
  its diagrams live on GitHub, where most visitors of the hosted app never
  go. About answers the first three questions (what is this, who wrote the
  rules, is an AI judging me), states what the tool deliberately is not, and
  points at the fastest explainer the product has: AIGate's own
  self-assessment in the register — the tool judged the tool.

- **A first-visit pointer** on the intake screen — one dismissible card, a
  two-minute-overview link, dismissed for good once you say so.

- **A regulator brief** ([docs/regulator-brief.md](docs/regulator-brief.md))
  — one page for a supervisory reader, answering the five questions they
  ask: is an AI making the decision (no, and how that is asserted by test),
  who is accountable for each determination (a named human per layer, with
  the gaps marked provisional rather than hidden), can a decision be
  evidenced later, how the encoding of regulation stays honest, and what
  happens when the tool doesn't know. No marketing adjectives; every claim
  already true in the repo.

- **A glossary** ([docs/glossary.md](docs/glossary.md)) — all 25 terms the
  product uses, in plain words, from risk appetite to HITL.

---

## [0.2.3] — 2026-08-15

### Added

- **"Anything the reviewer should know?"** — one optional free-text note at
  the attestation step. It is recorded permanently with your attestation and
  shown to the 2LoD reviewer above the verdict at sign-off, framed with the
  sentence that makes it safe: *the rules did not read it — the verdict is
  computed only from the structured answers.*

  This is the deliberate answer to "should every dropdown have a write-in?"
  — no. The closed dropdowns are the axes the rules are written in; a
  write-in on the data-sensitivity question would let a hurried submitter
  type "deal-related context" instead of facing the MNPI option, and walk
  past a hard line. Free text belongs where a human reads it. For saying the
  whole thing in your own words, the plain-language description path already
  exists and is read into the same structured graph you confirm.

### Not changed, on purpose

- No dropdown gained a free-text escape. Data class, zones, autonomy,
  exposure, weight and reversibility are complete classifications, not lists
  with gaps — being forced to choose IS the control. Platform, vendor and
  decision type, the three genuinely open sets, already have their escape
  hatches with the gap stated on the verdict.

---

## [0.2.2] — 2026-08-15

### Changed

- **The Provisional banner stopped presuming who reviews.** It said "legal
  review required" for every cause. Your packs disagree: DORA is signed by
  Technology Risk, SS1/23 by Model Risk — and a decision type your policy
  doesn't list is a question for whoever owns the risk appetite, not a
  lawyer. The heading is now "review required before this is final", and
  where the verdict knows who is actually pending — from its own reasoning
  chain — it names them: *"Waiting on: Legal/Compliance, Technology Risk"*.

- **The verdict now shows its living status** ("in good standing", as of a
  date) — the field the engine has recorded on every verdict since V1 and
  the screen never displayed.

### Internal

- Every one of the 158 acceptance criteria now names, in its own text, the
  test file that proves it — and each criterion's id appears in that test's
  title. This is what moved the release verdict to **Ship-ready** for the
  first time (verification 006), with one caveat on the record: there is no
  CI, so all evidence is manual, reproducible by `npm test`.
- Two criteria asserted behaviour that was never built (an automatic version
  bump on save; confidence scores that V2-E deliberately removed). Rewritten
  to what the product actually does, with dated notes, rather than tagged
  dishonestly.

---

## [0.2.1] — 2026-08-15

### Changed — the verdict now tells you what to do, in your own language

Reported after using it: *"a business user won't understand most of it… the
engine might be working but the verdict should be something a business user
understands — how it's derived and what they need to do."* Every point was
right. Nothing was removed — the full basis a reviewer signs against is still
there, underneath.

- **A "What you need to do" panel, at the top.** Every required control, every
  downstream review, and the sign-off, as one numbered list in plain language.
  This information was all on the screen before, spread across three panels
  and written in identifiers; nobody should have to assemble their own to-do
  list from a verdict.

- **Controls are named wherever they appear.** `CTRL-FINGERPRINT-01` is now
  **Output fingerprinting + version pinning**, with the identifier kept small
  beside it. The names were always in the policy — the screen just showed them
  in one panel and the raw code everywhere else. The identifier stays visible
  because it is what makes an item quotable in a committee paper and findable
  in the policy file.

- **"Governance margin" is now "How fragile is this approval?"** It used to
  read `→ NO HEADROOM INV-CITE-01, INV-CONDUCT-01, INV-SEC-01,
  INV-SYNTHMARK-01` — four codes you had to scroll up and look up one at a
  time. It now lists what each rule actually says, and explains the percentage
  in words instead of leaving you to guess what it was a percentage of.

- **"Standing conditions" is now "What would make this verdict expire"**, and
  it answers the two questions it used to leave open: *who checks these* —
  nobody automatically, they are read at the next re-review — and *what
  happens if one is breached* — the approval stops holding and the use case
  comes back through the gate.

- **The duplication is explained rather than hidden.** Data zone and autonomy
  appear both as expiry conditions and in what you told us. That is deliberate
  — one is the bound the verdict *depends on*, the other is what you
  *declared* — and the screen now says so instead of looking like a bug.

---

## [0.2.0] — 2026-08-14

### Added

- **You can now describe a decision type your policy doesn't list.** The
  "What kind of decision does it feed?" dropdown had eight fixed values, and a
  bank's real decision types have a long tail — collections prioritisation,
  AML alert triage, suitability assessment. There is now a **Something else —
  let me describe it** option with a free-text box.

  **What it deliberately does not do is pretend the engine understood you.**
  That field is a matching key, not a description: it drives two hard lines
  (autonomous credit/lending, autonomous trading), the Critical and High tier
  triggers, and EU AI Act Annex III. Free text matches none of them. So the
  text is recorded, no decision-type rule is applied, and the verdict says so
  in as many words — naming what you typed:

  > Cause: the decision type entered is not one your policy has a rule for, so
  > no decision-type rule could be applied. The tier and track above rest on
  > the other answers alone. Entered: "collections prioritisation".

  The verdict is marked Provisional on that basis. Accepting free text and
  quietly returning a lower tier would have been the worst outcome available —
  a silent under-classification, which is the one thing this product exists
  not to do.

  Leaving the question blank is still different from describing something:
  blank says no decision type applies; free text says one applies and your
  framework has no rule for it. Only the second is a hole worth showing you.

### Changed

- Over time, the decision types people type here are a list of the gaps in
  your own risk appetite framework. They are recorded on each verdict rather
  than discarded.

---

## [0.1.2] — 2026-08-09

Closes the four items that were still open at v0.1.1 — the two carried from
build verification 004, and the two limits recorded in the v0.1.1 notes.

### Fixed

- **The app works on a narrow screen.** It had no responsive rules at all, so
  below about 700px the fixed sidebar and the main column together overflowed
  the viewport and the whole page scrolled sideways. The layout now stacks
  into one column, and the two things that genuinely cannot reflow — the
  register table and the data-flow graph — scroll inside their own boxes
  instead of dragging the page with them.

  This is not a mobile redesign. A nine-column register and a data-flow graph
  are desktop artefacts; the change makes them survive a narrow viewport, not
  pretend to be designed for one.

- **Fonts are served from the app itself.** The hosted page fetched IBM Plex
  from Google. Some corporate networks block that outright, so a demo inside
  a bank could silently fall back to a system serif — and every visitor's
  browser made a third-party request. There is now nothing external to block,
  and nothing external to leak to. Adds about 70 KB.

- **The specs no longer contradict the engine.** Four spec files documented a
  `track_floor` rule effect that does not exist, and one contradicted itself
  about it within a single page. Two acceptance criteria still asserted the
  behaviour it would have produced, so they failed verification against an
  engine that was working correctly.

  The engine's actual rule — unchanged since V2-A — is that a jurisdiction
  pack never moves the track. "Most demanding standard governs" is expressed
  by *adding* obligations: controls and reviews from every applicable pack are
  combined, and a tier floor only ever raises the tier. That is the stricter
  reading, which is the point — nominating one pack as "governing" would mean
  discarding the obligations the others imposed.

### Changed

- **Jurisdiction rules are now applied in a fixed order regardless of how the
  packs were loaded.** No verdict was ever affected — the loader already
  sorted them — but the guarantee lived in the caller rather than in the
  functions themselves. It now holds by construction.

### Internal

- Four acceptance criteria specified generative property tests that had never
  been written. They exist now, covering: adding a jurisdiction never lowers a
  tier or moves a track; reordering the policy file never changes a verdict; a
  use case that crosses a hard line stays rejected no matter what controls are
  available; and every control the solver returns does real work, with none
  redundant. 399 tests in total.

---

## [0.1.1] — 2026-08-08

Two things a real user hit within minutes of the first release. Both were
reported from using the product, not found by a review.

### Fixed

- **You can go back.** Intake was forward-only: once you left the description
  step, the only way to correct a typo was *Clear all data and start over*,
  which destroys the whole session. There is now a **← Back** control on the
  duplicate check, the graph review and the questions, and the step
  immediately behind you in the tracker is a real button.

  Confirm stays one-way on purpose — it is an attestation, and stepping back
  across it would let you un-sign something you have signed.

  What you have typed is kept. Going back from the questions to the graph does
  clear your answers, because changing the graph regenerates the questions —
  keeping answers to superseded questions would be worse than asking again.

- **The step tracker stops lying.** Completed steps were marked with a ✓ that
  looked clickable and did nothing. That was the sharper half of the report:
  the one control you would reach for to go back was inert.

- **Text no longer spills out of the verdict box.** A long citation — such as
  *"EU AI Act Annex III §5(b) and §4(a); ECOA/Reg B; FCA Consumer Duty PRIN
  2A"* — could not wrap, and pushed the whole "Why this verdict" panel past
  the edge of its card.

### Changed

- **"Why this verdict" now says what the rules are.** It listed identifiers
  like `INV-AUTONOMY-01` and `TIER-CRITICAL` with nothing to tell you what
  kind of rule they were or where they came from. It now opens by
  distinguishing the three: **hard lines**, checked first and absolute — no
  control set can fix one; **invariants**, your firm's own appetite rules,
  each naming the controls that satisfy it; and **jurisdiction-pack rules**,
  which come from regulation rather than from your firm and are set out
  separately in the reasoning chain. The list of triggered invariants is
  labelled as such rather than left as bare IDs.

---

## [0.1.0] — 2026-08-08 — V1 scope, verified Demo-ready

Pre-1.0 by intent. "V1" throughout this repository names the *feature scope*,
not the release maturity: a build with no authentication, browser-held storage
and a Demo-ready verification verdict is not a 1.0.

The first complete build. Everything below works end to end and was walked
live before release; the full evidence is in
[`test/test-004.html`](test/test-004.html).

### The gate

- **Submit a use case in plain language or through a guided form.** With no
  API key the guided form asks business questions — "what kind of information
  does it use?", "how much can it do without a person?" — and states on screen
  that no AI reads your answers or makes the decision. With a key, a
  plain-English description is read into the same data-flow graph. Either way
  the graph is shown back to you for correction before anything is evaluated.
- **A duplicate check runs before intake.** The register is searched for a use
  case with overlapping characteristics. You can adopt the existing
  classification or record that yours is genuinely new; either choice is
  written to the audit trail.
- **Targeted questions, not a questionnaire.** The number and content of
  follow-up questions are driven by the risk signals detected in your
  description — a Low-tier case is asked few, a Critical one more. Answers
  that contradict each other are flagged before you can proceed.
- **You attest to the graph.** Confirmation is timestamped and permanently
  recorded, and the screen says so.

### The verdict

- **Approved, approved with controls, or rejected** — with the tier, the
  track, and the single binding constraint named.
- **Every step carries its regulatory citation.** The tier names the rule that
  set it; each tripped invariant names the regulation behind it.
- **The minimal control set is solved, not suggested.** The engine returns the
  smallest set of controls that brings the use case inside appetite, and each
  control names the invariants it patches.
- **A governance margin** shows how much headroom that control set leaves, and
  names the invariants resting on a single control — the ones where removing
  one control puts you outside appetite.
- **A regulatory reasoning chain** quotes the verbatim source text of every
  jurisdiction rule that fired, states what was derived from it, and whether
  that derivation restates the text or infers from it.
- **Standing conditions** record the operating bounds the approval assumes.
  The verdict holds while the system stays inside them; drift outside voids it.
- **Platform and vendor inheritance** shows what an existing approval already
  covered and, dimension by dimension, exactly where your use case falls
  outside that envelope.
- **A rejected verdict gives the forward path**, not a list of things you did
  wrong.

### The register and sign-off

- **A graph-based AI register** — shared components appear once, not once per
  use case. Filter by tier, track, status and stage; export the whole thing as
  JSON.
- **Lifecycle governance by tier.** Low self-serves; Medium, High and Critical
  wait for 2LoD sign-off.
- **A reviewer sees the same verdict the submitter saw**, on the sign-off page,
  and the sign-off names the verdict it attests to.
- **An append-only audit trail.** Nothing can be edited or deleted through the
  application. Double-clicking an approve button appends one event, not two.
- **AIGate submits itself through its own gate** on first launch, so there is
  always a worked example in the register.

### Honesty, as a feature

These are deliberate, and the product states them on screen rather than in a
footnote:

- **Unadopted pack rules make a verdict provisional**, and the banner names
  which rules and why.
- **A control with no evidence renders UNVERIFIED**, never a blank or a
  reassuring default.
- **The translation-fidelity label is computed** from the policy's attestation
  block. An unattested policy says "unattested" in the header; it is not
  hardcoded either way.
- **A sign-off records the typed name and labels it "name not verified"** —
  because there is no authentication behind it.
- **The audit trail says it is client-side and proof-of-concept grade.**
- **Three jurisdiction packs were deleted rather than shipped.** The Canada,
  Singapore and Japan starter packs emitted real control requirements from
  regulatory text nobody had retrieved. They were removed in policy v1.3; those
  three remain declared jurisdictions with no pack. A rule citing a source
  nobody read is worse than no rule.
- **A confidence score was removed** and replaced with each rule's *basis* —
  whether it restates its quoted text, infers from it, or rests on judgement.
  A reviewer can check a basis by reading the rule against its own citation.
  Nobody can check a number that was invented.

### Configuration

- **The firm's appetite is a YAML file you can read and edit** in the app, with
  validation on save and automatic re-evaluation queued for affected use cases.
- **Jurisdiction packs update independently** of the main policy file.
- **A policy file missing a required field cannot be used**, and a pack rule
  without a source citation is rejected on load.
- **Every verdict records the policy version and the version of every pack that
  was active**, so a verdict issued last month is not silently rewritten by a
  policy change today.

### Known limits at V1

Stated here as well as in the product. None is a defect; each is a boundary.

*As of 0.1.2 the last row has been closed — the property tests now exist. The
others still hold.*

| Limit | What it means |
|---|---|
| No authentication | The 2LoD role is a dropdown. A sign-off records a typed name and says it is unverified. |
| No segregation of duties | Nothing stops a submitter approving their own use case. The record discloses it; it does not prevent it. |
| Client-side storage | The audit trail is append-only by construction but held in your browser — not tamper-evident. |
| Pack rules unadopted | Every shipped deck carries `[FIRM]` sign-off placeholders, so verdicts relying on them are provisional until your CRO adopts them. |
| Four decks only | SS1/23, SR 26-2, EU AI Act, DORA. Canada, Singapore and Japan are declared with no pack. |
| No post-deployment monitoring | Standing conditions are recorded and checked at re-review, not watched live. That is V2. |
| No shadow-AI discovery | AIGate cannot see use cases that never come through intake. That is V2. |
| Condition language cannot scope to a node type | A rule that should apply only to where processing happens cannot yet be written correctly. |
| No property-based tests | Four acceptance criteria specify generative tests that were never written. The behaviour they describe is covered by example tests. |

---

## Policy versions

The starter risk-appetite policy is versioned separately from the application,
because a firm adopting AIGate will fork it.

### [1.3] — starter policy

- **Removed the Canada, Singapore and Japan packs.** They emitted real controls
  from illustrative rule text whose sources were never retrieved. The three
  remain declared jurisdictions with no assessed pack.

### [1.2] — starter policy

- Retired an invariant that had become unreachable — its condition had drifted
  to be byte-identical to a hard line that already caught the same case.
- Narrowed the AI-disclosure invariant back to client-facing systems: the
  transparency article it derives from requires a person interacting, not
  merely a channel.
- Removed a model-type gate from the escalation invariant, so a route to a
  human follows the affected person rather than the technology.
- The autonomy invariants now require an *acting* output, so they stop
  demanding an authority envelope of systems that only provide information.

### [1.1] — starter policy

- First revision after two independent adjudicators scored the worked-case
  corpus against v1.0.
