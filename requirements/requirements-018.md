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

**R18-GI-12 (Must):** Pre-fill accuracy is measured, not assumed. A
repeatable script in the project runs the 31-case corpus through the
connected model and reports, per question, how often the pre-fill was right,
left blank, or wrong, plus verdict agreement; the result is recorded under
`backtest/model-comparison/` with the model's name and date. The recommended
model is changed only with a recorded result. It is not a build-breaking
test (models change; it needs a network).

> Fit criterion: running the script against the recommended model writes a
> dated result file with the per-question table; the docs name the
> recommended model and point to its latest result.

**R18-GI-13 (Must):** Wrong is worse than blank. The checklist, the nudge,
the pre-fill marks and the record never claim more than the code can show:
"mentioned" not "understood"; "from your description" only with a verified
quote; "confirmed by you" only after the person's own tick or change.

> Fit criterion: every rendered sentence introduced by this round is
> covered by a test that renders the state in which it would be false and
> asserts it is absent (BC-005).

## 2. Model setting (MS)

*(next domain — to be elicited)*

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

*(logged as they arise)*

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

---

*Developed using the Grounded Vibe Methodology*
