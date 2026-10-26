# Newcomer test, round 2 (2026-10-26) — safety criteria met, comprehension still FAILS

Same six packets, fresh simulated testers, on text scraped from the built site after the round-1 wording fixes.
Each tester saw their own description, their own nudge and their own pre-filled form (the round-1 setup error is gone).
Scored by `src/test-support/newcomer-r18-score.ts` with the real engine (`results.json`).

Safety (the gate's hard criteria):
- No tester's status or tier was less strict than the correct verdict. Both "No" cases matched exactly (P2, P6).
- One less-strict answer, the same as round 1: P3, Q6a "How much weight…" (an older question; the tester's
  verdict kept the same status and tier but dropped one control).
- P3 caught and changed the deliberately wrong pre-fill. P2 ignored the nudge as scripted.

Comprehension:
- Fixed since round 1: the nudge's example sentences (now "For example:", 0 of 6 flagged) and what the tick means
  (0 of 6 flagged; all six explained it correctly).
- Not fixed: the Ollama / "Make it smarter" panel (5 of 6 — the new lead sentence did not help; the heading itself
  reads as "smarter how?") and the model label "alpha:7b" / "untested" (6 of 6).
- Newly visible with each tester on their own screens: the checklist's "not mentioned" contradicts the words the model
  then quotes from the same description (5 of 6); "No AI reads your answers" sits beside "Suggested by the AI model"
  and reads as a contradiction (4 of 6); "asked separately, in question 6" with unnumbered questions (5 of 6); the
  nudge's "the questions that follow ask about each of these anyway" is false where a question is conditional (3 of 6).
- Pre-existing, outside this round's gate: the "Similar checks" step (6 of 6), "your AI risk team", "pick the one
  nearest the bottom".
- 60 "didn't understand" notes in total (45 in round 1); the count is approximate and many are facts the persona
  could not know ("Not sure" is the designed answer there).

`answers/raw/` holds each tester's answers exactly as given; `answers/` the same values keyed by question id.
