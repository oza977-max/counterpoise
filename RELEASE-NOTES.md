# v0.18.0 — 26 October 2026

Developer-facing notes; the user-facing version is `RELEASE-NOTES.html`, and
the full history is `CHANGELOG.md`.

**This is the proof-of-concept release.** The project is parked here: the
live demo is this version, every open item is written down, and nothing is
half-built. It covers everything since v0.17.0 (26 August 2026): Round 16,
the rename to Counterpoise, the review fix rounds, and Round 18.

## What's new

- **R16 — plain language end to end** (handovers `R16-A1` … `R16-F`, `R16-W`):
  plain-language policy fields and approved text (policy 1.7); the guided
  form and "what we understood"; the result's first screen and the "No"
  screen; "Not sure" answers saved as assumptions; correcting a form answer;
  the description path speaking the form's words (UC-12).
- **Rename to Counterpoise** (2026-10-02): brand, repo and live-site address.
  Internal `aigate` identifiers kept on purpose so saved cases and exported
  files still open.
- **R18 — describe first, optional AI helper** (`requirements/requirements-018.md`,
  test cases `test-cases-033`, handovers `R18-A` … `R18-G`):
  - R18-A: describe-first screen, topic checklist and nudge, one route through the form.
  - R18-B: model setting by place (this computer, firm server, Ollama cloud), status line, Clear-all behaviour.
  - R18-C1/C2: pre-fill request and verifier (closed-set checks, exact quotes), per-answer ticks, reading step.
  - R18-D1/D2: `answer_sources` recorded once per confirm, shown in the register, carried in hand-off files; correcting a check from the register.
  - R18-E: older cases open on the form; "Not sure" answers return for a fresh tick.
  - R18-F: in-app model test over the 31 public worked cases, with a stored, dated label.
  - R18-G: public-site panel and "Try an example", empty-first status regions, accessibility and keyboard walk, `scan:dist` on public files with an outside word list, CSP on the built page.
  - Follow-up (b665a5c): five newcomer-test wording changes, old name removed from public text.
- **Policy 1.9**: plain names for the two allowed models (presentation text only).
- **Rating-instruction warning** (GT7): a rule-based warning when a description tries to dictate its own rating.

## Fixes

- Code reviews 006, 007, 008 and 009 and end-to-end test 007, each closed by a
  fix round (`CR6-fixes` … `CR9-fixes`, `FX7-*`, `FX8-*`, `FX9-*`, `GT7-fixes`).
- CI timing fixes at the Round 18 merge (status regions mount empty, then
  fill; the precedent lookup tolerates storage closing mid-lookup).

## Known issues

- **Newcomer gate GI-11 is OPEN.** Three rounds, six simulated first-time
  users on text scraped from the built site. Safety held every round: no
  less strict decision or tier, both "No" cases exact, the planted wrong
  pre-fill caught. Not met: comprehension of the model's technical name
  (5 of 6 confused) and the topic checklist's narrow phrase matching
  (5 of 6). One less strict answer remains (P3, Q6a "how much weight").
  Owner decision 2026-10-26: ship with the record. Open items:
  `specs/forward-notes.md`, 2026-10-26 entry.
- **R18-C0 not done.** Real model replies were never captured; the fixtures
  behind the failure messages are `provisional: true`.
- **Demo rules are unsigned**, so every verdict is provisional (NF-7, by design).
- Four design deviations in Round 18 were ratified by the owner on 2026-10-26
  rather than re-reviewed; they are marked in the specs.

## Quality summary

- Code review: **Merge with caveats** (code-review-009, 2026-10-04: 0 Critical; both Important closed in CR9-fixes).
- Design review: **Build with caveats** (design-review-008, 2026-10-07, Round 18).
- Test: **Demo-ready** (test-007, 2026-10-04: VV-2(a) fails on one owner-held clause of TC-UC-3-04 and on sampled, not exhaustive, trace reading).
- Round 18 had no round-level `/gvm-code-review` or `/gvm-test`. Each chunk
  instead ran its own independent review loop to zero Critical/Important,
  recorded as "Review passes" in its handover, plus a live walkthrough.
- At release: `npm test` 3,427 passed, 1 skipped in 5 of 6 local runs. The
  sixth had one failure on a machine at load ~30 on 8 cores; per the
  calibration rule, local results under load are not evidence, and CI on the
  release commit is the record. `tsc` clean, build clean, `scan:dist --release` with the word list clean, spec parity
  clean, trace check clean (2 cases PENDING BUILD, GI-11-01/-02). CI and the
  Pages deploy green on b665a5c; live bundle checked.
