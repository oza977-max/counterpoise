# Newcomer test, round 3 (2026-10-26) — safety criteria met; comprehension improved, two items still open

Same six packets, fresh simulated testers, on text scraped from the built site after the round-2 wording changes
(panel heading and first line, "AI helper {model}: not yet tested on the example cases", the form intro with a model,
the question reference, "words found / no words found", "The form covers each of these where it applies").
Each tester saw their own description, nudge and pre-filled form. Scored with the real engine (`results.json`).

Safety (the gate's hard criteria), unchanged across all three rounds:
- No tester's status or tier was less strict than the correct verdict. Both "No" cases matched exactly (P2, P6).
- One less-strict answer: P3, Q6a "How much weight…" ("Little" for a reply-drafting tool whose correct answer is
  "one input among several"; an older question). Its verdict kept status and tier and dropped one control.
- P3 caught and changed the deliberately wrong pre-fill, all three rounds. P5 changed a correct pre-fill to
  "Not sure", which takes the careful reading and is not less strict.

Comprehension (new screens):
- Fixed (0 of 6): the "question 6" reference; "No AI reads your answers" read beside the AI suggestions; the nudge's
  "asks about each of these anyway"; the nudge examples and the tick meaning (fixed in round 2).
- Improved: the Ollama panel, 5 of 6 → 3 of 6. "The text says I needn't do anything, so I skipped it" (P1).
- Still open: the model label (5 of 6). "alpha:7b" is a bare model id; the gloss "not yet tested on the example cases"
  raised "which example cases?" instead of answering it. Any real model id (e.g. "qwen3:4b") will read the same way.
- Still open: the checklist. "words found / no words found" is now honest, so testers no longer read it as a claim,
  but five of six can see the word-checker misses obvious phrases ("goes straight to the customer", "for the operations
  team", "without a checkpoint") that the model then quotes. The phrase table in `src/engine/mentioned.ts` is too narrow.
- Pre-existing, outside this round's gate (6 of 6): the step list — "Similar checks" is unexplained, and step 4
  "Questions" reads as a repeat of step 3 because the form route asks no follow-up questions.
- 50 "didn't understand" items (60 in round 2, 45 in round 1); approximate, and many are facts the persona could not
  know, where "Not sure" is the designed answer.

Decision (owner, 2026-10-26): ship the follow-up with this record; the gate (GI-11) stays open and
`Status: PENDING BUILD` stays on test-cases-033. The open items are the first entries for the next round.
