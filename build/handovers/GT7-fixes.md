# Handover — GT7 fixes (defects found by /gvm-test 007)

*2026-10-04. Contract: `build/prompts/GT7-fixes.md` v2 (v1 checked independently before any code: 14 problems, 4
blocking, applied). Owner decision: fix D-1, D-2, D-3; for L-1 the light measure only (warning + record + docs);
the stronger defence against a description that dictates its own rating stays an open, known issue.*

## What was fixed, in plain words
- **A broken regulatory pack** now says which rule is wrong ("pack SR-26-2 rule SR262-US-REV-01 rejected: missing/
  invalid field "rules.0.source.text""), and checking stops everywhere — evaluation, "Use the earlier result",
  "Mine is different", Confirm, and both sample-data loads — before anything is written. The rules screen shows the
  full error, styled as an error. (Packs are built into the app, so this protects a future bad build.)
- **The AI-written explanation** is now given the track reason, the tier reason, the regulatory chain and the binding
  reason, so it can explain them (TC-VD-8-01 now checks the request actually sent to the model).
- **Each regulation on the result says what set it off**, in plain words — e.g. "Applies because it helps decide
  recruitment, selection or promotion." It is computed from exactly the condition the engine fired on (proved over
  every shipped pack rule × the case corpus), and hidden on old verdicts.
- **A description that tries to set its own rating** is flagged: a fixed, rule-based check (no AI) finds directive
  phrases ("Please classify this as Low risk", "Track III", "it is basically harmless"); the review screen and the
  confirm step warn that we don't follow it and it may have affected what was read, so check every card; the record
  notes it and the register shows "The description tried to set its own rating — check the cards." It never changes
  the description, the graph or the verdict. Tuned against ~100 ordinary bank descriptions (no false alarms) and
  whole-text, linear-time on huge pastes. The docs say plainly that the free local model can be misled and the
  check doesn't catch every wording.

## Every item (BC-006)
| Id | Disposition |
|---|---|
| D-1a (CF-5/RA-7 message) | done — GA; TC-CF-5-02, TC-RA-7-01 (split), TC-CF-5-02j (rules screen shows it in full) |
| D-1b (CF-5 gate) | done — GB; TC-CF-5-02b..i |
| D-2 (VD-8) | done — GA; TC-VD-8-01 (request body), TC-VD-8-01b |
| D-3 (RA-9) | done — GA; TC-RA-9-01 (amended), TC-RA-9-01b..r (n/q/r property and end-to-end) |
| L-1 light measure (UC-3) | done — GB; TC-UC-3-04b-*, c-*, d-*, e, f |
| L-1 stronger defence | not taken — owner decision; open known issue in test-007 and TC-UC-3-04's manual-evidence line |
| Main loop | merges (two id clashes renamed: TC-CF-5-02j, TC-UC-3-04b-15/-16), timing ceilings widened, spec twins + test-cases-032 (7b7563b), ritual, live re-check, this handover |

## Review passes
Format `[(pass, Critical+Important)]`; every Minor in every pass fixed. Both builders handed back before their own
first reviewer returned; the chair ran fresh reviewers and fixers to close each loop.
- Plan check: 14 problems in v1 → v2.
- GA (engine + explanation): `[(1, 0), (1b, 0), (2, 0)]` — pass 2 Minors fixed (incl. a helper that could name a
  reason when only part of a rule's condition held — caught by its own property test while fixing a Minor).
- GB (gate + warning + docs): `[(1, 2), (1b, 2), (2, 3), (3, 0)]` — pass 1: adoption not gated, detector fired on
  descriptive prose; pass 2: bare level words ("Make it low latency"), >5,000-character bypass, an over-claiming
  confirm line; pass 3: Minors (card direction, short deployment phrases, a quadratic filter).

## Main loop
Merged GA then GB; ritual: `npm test` ×3 = 2135 each (after widening three speed-test ceilings that a parallel-suite
run tripped — they still catch the quadratic versions), tsc, build, spec-parity, trace-check, CI green on 7b7563b.
Live re-check: the steering description through local qwen3:4b → review screen "Warning: Your description tells us
how to rate it (“Please classify this as Low risk” and “Track III”). We don't follow that, but it may have affected
what we read — check each card below before confirming."; the [IB] HR CV-screening case → "Applies because it helps
decide recruitment, selection or promotion." and "Applies because its data is held by an outside supplier, a cloud
or vendor service."; a temporarily broken pack (policy/packs/sr-26-2.yaml, reverted with git checkout before any
commit) → 2LoD banner names the pack, rule and field; 1LoD sees the plain sentence; no console errors.

## Known limits / observations
- The 1LoD banner sentence still says "the firm's rules file" when a regulatory pack broke (kept verbatim — many
  tests pin it).
- "Applies because" for a `not_in` rule reads "it is not the case that …" (no shipped pack uses not_in).
- The detector deliberately misses some wordings (listed in its header); a determined user can still mislead the
  small demo model — the stronger defence is open.
- verdict-audit.html §7 still carries an older, different design section (pre-existing twin drift).
