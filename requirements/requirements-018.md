# Counterpoise Requirements — Round 18

## Round 18 — One set of questions: describe, pre-fill, confirm

**Status: IN ELICITATION (2026-10-04).** Owner-led round after `/gvm-test 007`.
Scope: the written-description path and the guided form become one route
(describe → the connected model pre-fills the form's answers, with proof →
the person confirms each pre-filled answer and answers the rest → the same
engine); a model setting that works with Ollama's free cloud models and with
a firm's own model; honest wording wherever a description leaves the
computer; what the public demo site tells visitors. Numbered 18 because the
R16 prefix is taken by the plain-language intake amendments in
`requirements.md` and R17 by the track-order round (`test-cases-017.md`).

## Provenance

- `backtest/model-comparison/README.md` (2026-10-04): all 31 corpus
  descriptions run through the real extractor, question generator and engine
  on three free models. Fully-right verdicts: `qwen3:4b` on this computer
  6/31; `gemma4` on Ollama's free cloud 21/31; `gpt-oss:120b` cloud 16/26.
  Follow-up questions repeated across cases because the app asks about every
  detail the description did not state — 13.4 "guessed" details per case
  with the stronger model, not fewer.
- The guided form already sets every one of the 15 details the rules test
  (`src/engine/build-graph-from-form.ts`); every question is required and
  "Not sure" takes the strictest reading (round 16, UC-8..UC-12).
- `/gvm-test 007` (`test/test-007.html`): a description that dictated its own
  rating partly steered the small model; the GT7 light measure (warning,
  record, docs) is built; the stronger defence was left open.
- Owner decisions this round (2026-10-04): describe first, then the form;
  gentle nudge for missing facts, never block; each pre-filled answer
  visibly marked and confirmed one by one; the detailed multi-step map is
  retired and the form is the record; after editing the description only
  untouched answers are re-pre-filled; "Not sure" may be pre-filled with a
  quote; pre-fill accuracy is measured on a standing basis.

## Expert Panel

| Expert | Work | Role in this document |
|---|---|---|
| Karl Wiegers | *Software Requirements* (3rd ed.) | Classification, MoSCoW, fit criteria, ambiguity words |
| Gause & Weinberg | *Exploring Requirements* | Context-free questions, assumption surfacing, "how would you know?" |
| Jeff Patton | *User Story Mapping* | The describe → pre-fill → confirm journey |
| Alan Cooper | *About Face* (4th ed.) | The submitter and reviewer personas carried from round 16 |
| Christensen / Moesta | *Competing Against Luck*; *Demand-Side Sales 101* | The job statement |
| Suzanne & James Robertson | *Mastering the Requirements Process* (Volere) | Non-functional categories: privacy, usability, accessibility, operability (activated: personal data, third-party model service, accessibility) |
| Janice Redish | *Letting Go of the Words* | Plain-language wording of the checklist, nudge and marks |
| Michael Power | *The Audit Society* | What an audit record must say about where an answer came from |
| OWASP | LLM Top 10 | Prompt injection via the description; data leaving the device |
| NIST AI RMF; EU AI Act; PRA SS1/23 | (project roster, Tier 2b) | Human oversight of model-suggested answers; record-keeping |

## Purpose & Vision

*(written last — see Phase 5)*

## Target User

Carried from round 16: **the submitter** (first line — a person with an
everyday job who wants to use an AI tool and must find out whether they can,
with no training in risk vocabulary) and **the reviewer** (second line — the
AI risk team member who signs off and must be able to see exactly what was
said, by whom, and what the model contributed). This round adds nothing to
who they are; it changes how the submitter's own words reach the form.

**Job statement.** When I have an AI tool in mind and a page of questions in
front of me, I want to say what it does in my own words and have the form
filled in from that — with every filled answer shown to me for checking —
so I can finish the pre-check quickly without being asked the same things
twice, and the reviewer can see which answers were mine.

## User Journey

1. The submitter describes the tool in one box. Beside it, a short checklist
   of the form's questions ticks itself as the description *mentions* each
   one — it claims "mentioned", never "understood".
2. On Next, anything not mentioned is listed with a one-click example
   sentence to add. The person may add or just continue.
3. If a model is connected, it reads the description and pre-fills the
   form's answers — only where it can quote the description's own words,
   which the app checks really appear there. Everything else stays blank.
4. The form opens. Pre-filled answers are visibly marked with their quote
   and "is this right?"; each needs its own tick or a change. Blank answers
   are answered as today. The contradiction check still runs.
5. Confirm and evaluate, as today. The record says, per answer, whether the
   person typed it, confirmed a pre-fill, or changed one — with the quote.
6. The reviewer sees the description and the per-answer source on the
   register. Correcting a result returns to the same form, pre-filled with
   the confirmed answers.

## 1. Guided intake (GI)

The form is the one set of questions. The description's job is to feed it
and to be the record of what the person said; the model's job is to save
typing, never to decide. Every rule below protects one of three things: the
person is never blocked, nothing is claimed that cannot be shown, and the
engine only ever sees answers a person confirmed.

**R18-GI-1 (Must):** Every pre-check starts with the description screen: one
text box and, beside it, a checklist of the form's questions in the form's
own short plain words. Each item ticks itself live as the description
mentions it, and reads "mentioned", not "answered".

> Fit criterion: the tick is computed from the text alone by a fixed,
> deterministic rule (no model, no clock) and is identical for identical
> text; one test per checklist item shows it ticking on a sentence that
> mentions it and staying unticked on one that does not; no item's label uses
> engine vocabulary (NF-11); the checklist is announced to assistive
> technology as a status region and does not rely on colour alone.

**R18-GI-2 (Must):** When the person presses Next with items unmentioned,
the app lists them ("Your description doesn't mention: …") with a one-click
example sentence for each, and lets the person continue regardless. Nothing
is required at this step; the form asks every question anyway.

> Fit criterion: with every item mentioned no note shows; with two
> unmentioned the note names exactly those two; clicking an example appends
> its sentence to the description (and the item ticks); Next is never
> disabled by this rule.

**R18-GI-3 (Must):** If a model is connected, it reads the description and
pre-fills form answers — only where it can cite words from the description
as proof. The app checks each cited quote actually occurs in the description
(exact, after whitespace normalisation); a pre-fill whose quote does not
occur, or that cites nothing, is discarded and the question stays blank. "Not
sure" may be pre-filled on the same terms. The countries list may be
pre-filled on the same terms. The GT7 rating-instruction warning still shows
when the description tries to dictate its own rating.

> Fit criterion: a description with a verifiable sentence per question
> pre-fills those questions and no others; a model reply whose quote is not
> in the text leaves that question blank and writes nothing; the engine's
> input is built only from confirmed form answers, never from the model's
> reply directly (a test shows the model's reply cannot reach `evaluate()`
> without passing through a confirmed form).

**R18-GI-4 (Must):** On the form, every pre-filled answer is visibly marked
"from your description: “…quote…” — is this right?" and needs its own
confirmation (a tick, or a change, which counts as confirmation). There is no
accept-all. Continue stays disabled until every pre-filled answer is
confirmed or changed and every blank answer is answered.

> Fit criterion: a form with three pre-filled answers and one blank enables
> Continue only after three confirmations/changes and one answer; the mark
> shows the quote verbatim; the newcomer test (NF-12) covers the marked form.

**R18-GI-5 (Must):** The record of a confirmed pre-check states, per
answer, where it came from — typed by the person, pre-filled by the model
and confirmed, or pre-filled and changed (with the model's quote and the
model's name) — and the reviewer sees this on the register alongside the
description. The hand-off file carries it. Records from before this round,
and records with no pre-fill, still open and read exactly as today.

> Fit criterion: the register detail for a pre-filled case shows the source
> per answer; a hand-off round trip keeps it; a bundle without it imports;
> an old multi-node record opens unchanged.

**R18-GI-6 (Must):** The contradiction check (UC-5) still compares the
description with the confirmed answers, pre-filled or typed, and asks the
person to explain before confirming.

> Fit criterion: "no client data at all" in the description plus a confirmed
> "information about people" answer stops at the explanation step, whether
> that answer was typed or a changed pre-fill.

**R18-GI-7 (Must):** The model never blocks. If it is not connected, is
slow beyond a stated limit, fails, or returns nothing usable, the form opens
blank with one plain sentence saying so, the description is kept, and the
person continues as today.

> Fit criterion: with no model configured, with a model that times out, and
> with a model that returns an unreadable reply, the form opens blank within
> the limit and shows the sentence; no error word from the model reaches the
> screen; nothing is written to the trail by the failed attempt.

**R18-GI-8 (Must):** If the person goes back and edits the description after
pre-fill, only answers they have not yet confirmed or changed are re-pre-filled
from the new text; confirmed and changed answers are kept.

> Fit criterion: confirm one pre-fill, change another, leave a third
> unconfirmed, edit the description, return: the first two are unchanged
> and still marked as confirmed/changed; the third is re-pre-filled (or
> blank) from the new text.

**R18-GI-9 (Must):** The description, the pre-filled answers, their quotes
and the person's confirmations survive a reload, as drafts do today, and are
cleared when the pre-check completes or the person starts over.

> Fit criterion: reload at the description step and at the half-confirmed
> form step restores both; "Start over" clears both.

**R18-GI-10 (Must):** One route. The detailed multi-step map screen ("Check
what we read from your description") is retired; the form's one-input,
one-AI-step, one-output shape is the record for every case. Correcting a
result returns to the form pre-filled with the confirmed answers. Cases
already on the register that carry the older multi-step map stay readable
and correctable.

> Fit criterion: no screen in the new build renders the retired card
> review; the 11 worked examples and the 31-case corpus still produce their
> pinned verdicts through the form; an old multi-node case opens on the
> register and its verdict screen renders.

**R18-GI-11 (Must):** The newcomer comprehension gate (NF-12) applies to the
description screen with its checklist and nudge, and to the pre-filled form
with its marks, before they ship.

> Fit criterion: the recorded newcomer test includes at least one persona
> who describes first and confirms pre-fills, one who ignores the nudge, and
> one who changes a wrong pre-fill; 0 "didn't understand", 0 less-strict
> answers.

**R18-GI-12 (Must):** Pre-fill accuracy is measured, not assumed. The
standing measurement is the in-app model test (R18-MS-4): the 31-case corpus
run through the configured model, scored per question (right, blank, wrong)
and by verdict agreement, with the result kept against the model's name,
where it ran, and the date. A model with no recorded result is shown as
"untested" wherever its name appears. The corpus itself lives in the
project (`backtest/cases.json`) and is the test's only input — never a
person's own description. *(Amended during domain 2: the owner chose an
in-app test over a repo script.)*

> Fit criterion: the Settings screen and the description screen both show
> "untested" for a model with no recorded result and "tested N/31 on
> <date>" after one; the scoring is deterministic for a fixed set of model
> replies (a test feeds canned replies and gets the same table every time).

**R18-GI-13 (Must):** Wrong is worse than blank. The checklist, the nudge,
the pre-fill marks and the record never claim more than the code can show:
"mentioned" not "understood"; "from your description" only with a verified
quote; "confirmed by you" only after the person's own tick or change.

> Fit criterion: every rendered sentence introduced by this round is
> covered by a test that renders the state in which it would be false and
> asserts it is absent (BC-005).

## 2. Model setting (MS)

Any model, declared honestly, proven on the 31 cases before anyone relies
on it. Today the app accepts only a model on this computer and promises the
description never leaves it. This round widens the choice to a firm's own
server and to Ollama's cloud through the local app, and replaces the promise
with a declared, recorded fact. Nothing here is a recommendation of a
particular model: the test is the recommendation.

**R18-MS-1 (Must):** Settings offers three declared places for the
description-reading model: *on this computer* (an address on this machine,
as today); *on my firm's server* (an address the person enters); *Ollama's
cloud, through the Ollama app on this computer* (the local address plus a
model whose name carries Ollama's cloud tag). The person must choose one
before saving. A model name carrying the cloud tag may only be saved under
the cloud choice.

> Fit criterion: a loopback address with a cloud-tagged model is refused
> under "this computer" with a plain sentence and accepted under "Ollama's
> cloud"; a non-loopback address is refused under "this computer" and
> accepted under "my firm's server"; the saved setting records the choice.

**R18-MS-2 (Must):** The app says where the description goes, every time,
in plain words, and only what it can show. At set-up and on the description
screen before the person types: "Your description will be read on this
computer by <model>" / "…sent to your firm's server at <address> and read by
<model>" / "…sent to Ollama's cloud and read by <model>". "Never leaves your
computer" is said only for the first choice. The case record names the
model and where it ran. The user guide, tester guide and README say the
same.

> Fit criterion: each of the three sentences renders only under its own
> choice; the register detail and the hand-off file carry model name and
> place for a pre-filled case; a docs test keeps the four copies identical.

**R18-MS-3 (Must):** Any model. Settings lists the models the chosen server
reports and lets the person type one it does not list; the app ships no
model, recommends none, and names none as the default. The measured results
(R18-MS-4) are the only guidance.

> Fit criterion: with a server reporting three models, all three are
> offered and a typed fourth is accepted; no model name is hard-coded in
> the Settings screen's copy.

**R18-MS-4 (Must):** Test it before you trust it. From Settings the person
can run the configured model against the 31 built-in cases. The run shows
progress, can be stopped early, and uses exactly the path a real pre-fill
uses. It reports, per form question, how often the pre-fill was right, left
blank, or wrong, and how often the resulting verdict matched the known
answer; the result is saved against model name, place and date and shown in
Settings. A model may be saved without a test but is labelled "untested"
until one is recorded (R18-GI-12). The test sends only the built-in cases,
never a person's description.

> Fit criterion: a stopped run reports the cases completed so far and says
> it was stopped; the per-question table and verdict count are deterministic
> for canned replies; the saved result survives reload; the model's label
> changes from "untested" to "tested N/31 on <date>".

**R18-MS-5 (Must):** Works with servers that ignore the strict answer
format. The app gets a usable reply from models that honour the strict
format and from those that do not, with no extra set-up: it asks in the
strict format first and, if the reply is not in shape, asks again as a tool
call with the field list spelled out, and remembers what worked for that
model.

> Fit criterion: a fake server that ignores the format setting and a fake
> server that honours it both yield a valid pre-fill from the same settings;
> the second request is made only after an out-of-shape reply; the
> remembered mode is used first next time.

**R18-MS-6 (Must):** Connection honesty for a firm server. An address over
plain http is accepted but shows, at set-up and on the description screen,
that the description travels unencrypted inside the firm's network; an https
address shows no such line.

> Fit criterion: the line renders for `http://` firm addresses and not for
> `https://`; it never renders for the this-computer choice.

**R18-MS-7 (Must):** Plain words for the server's own failures. The replies
seen in testing — a model retired, a model not included in the free
allowance, the allowance used up, no sign-in, the server not answering —
each become one plain sentence that says what to do (sign in, pick another
model, wait, start the app), and never blocks the form (R18-GI-7).

> Fit criterion: a test per reply shape asserts the plain sentence and that
> no raw server text reaches the screen.

**R18-MS-8 (Must):** The test's 31 cases are the public corpus already in
the project; they contain no firm's data, and the app ships them as it ships
the rulebooks. Scoring uses the corpus's known correct answers.

> Fit criterion: the cases bundled in the build are byte-identical to
> `backtest/cases.json`; a confidentiality scan of the bundle finds no firm
> name.

## 3. Public demo site (PS)

*(to be elicited)*

## Non-Functional Requirements

*(to be elicited with domains 2 and 3)*

## Assumptions

- The guided form's questions do not change in this round; only how they are
  reached and pre-filled does.
- A firm that connects its own model accepts that descriptions are sent to
  it; the app's job is to say so plainly (domain 2).

## Constraints

- Engine purity (NF-1): nothing in this round may put a model, a clock or
  randomness into the deterministic engine.
- The verdict screen must never render the reserved words of the status
  label outside it (CLAUDE.md).
- Honesty (NF-2/NF-7, BC-005) is a functional requirement.

## Out of Scope

- A stronger defence against a description that dictates its own rating
  beyond R18-GI-3's proof rule and the GT7 warning (recorded open in
  `test/test-007.html`).
- A hosted relay that holds a shared model key for the public site (domain 3
  states the alternative).

## Open Questions

**OQ-1 — Scoring basis for the in-app test.** The corpus records each
case's correct *graph*, not its correct *form answers*. Two ways to score a
pre-fill: author form answers for all 31 cases by hand (human-led, like pack
authoring), or turn the pre-filled answers into a graph through the form's
own mapping and compare that with the case's graph (the method the
2026-10-04 comparison used). For the tech spec; either must give a
deterministic per-question table.

**OQ-2 — Untested models in real use.** Drafted as: allowed, labelled
"untested" on the description screen. The alternative is to refuse pre-fill
until a test is recorded. Owner to confirm with domain 2.

**OQ-3 — Plain-http firm addresses.** Drafted as: allowed with an
unencrypted-connection line (R18-MS-6). The alternative is to refuse plain
http outside this computer. Owner to confirm with domain 2.

## Requirements Index

*(generated at finalisation)*

## Priority Model

| Level | Meaning |
|---|---|
| Must | Non-negotiable. The round fails its purpose without this. |
| Should | Expected. Omit only with a stated reason. |
| Could | Desirable if the effort is low. |
| Won't | Deferred to a later round, on the record. |

## Changelog

| Date | Change |
|---|---|
| 2026-10-04 | Round 18 opened after `/gvm-test 007`; domain 1 (Guided intake, R18-GI-1..13) drafted from the owner's decisions and the model comparison. |
| 2026-10-04 | Domain 1 confirmed by the owner. Domain 2 (Model setting, R18-MS-1..8) drafted: three declared places, honest notice, any model with an in-app 31-case test instead of a recommended model (owner's call), automatic format fallback, firm-server connection honesty, plain words for server failures. R18-GI-12 amended to point at the in-app test. OQ-1..3 logged. |

---

*Developed using the Grounded Vibe Methodology*
