# Newcomer test, round 1 (2026-10-25) — FAILED, kept as evidence

Six simulated first-time users (packets P1–P6) on text scraped from the built site.
Scored by `src/test-support/newcomer-r18-score.ts` with the real engine (`results.json`).

- Less-strict answers: 1 (P3, Q6a "how much weight", an older question). No tester's status or tier was less strict.
- P3 caught and changed the deliberately wrong pre-fill.
- 45 "didn't understand" notes. On the new Round 18 screens: the Ollama setup text (4 testers),
  the bare model name "alpha:7b" (4), the nudge's example sentences (1), what the tick means (1).
- Setup error (the tester's fault was none): the scraped form showed one fixed description's pre-fills
  (client names, branch staff, UK team) to every tester, so three testers flagged quotes that were not theirs.
  Round 2 scrapes each tester's own pre-filled form.

`answers/raw/` holds each tester's answers exactly as given; `answers/` the same values keyed by question id.
