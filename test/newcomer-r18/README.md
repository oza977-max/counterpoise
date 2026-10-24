# Newcomer comprehension test, round 18 (NF-12, R18-GI-11)

## Scoring method (what "less strict" means)

A verdict A is LESS strict than the correct verdict C when, compared in this order:

1. **Status rank**: approved (0) < approved_with_controls (1) < rejected (2). A lower rank is less strict.
2. If status is equal, **tier**, using the engine's own order (`TIER_ORDER` in `src/engine/tier.ts`): Low < Medium < High < Critical. A lower tier is less strict.
3. If status and tier are equal, **required controls**: if A's control set is a strict subset of C's, A is less strict.

The scorer (`src/test-support/newcomer-r18-score.ts`) checks (a) each answer against the worked example's correct answer, (b) each wrong answer substituted ALONE into the correct answers, run through the real engine, (c) the tester's full answers against the expected verdict, and (d) counts of "didn't understand", less-strict answers, pre-fills ticked and changed.
Run: `npm test -- src/test-support/newcomer-r18-score.test.ts` (writes `results.json`; the file-runner part is skipped when `answers/` has no `Pn.json`).

Six simulated first-time users (`packets/P1.md` to `P6.md`). Each sees only the
screen text in `screens.json` plus their own pre-fills. `packet-meta.json` is the
organiser's key (which worked example, which pre-fill is deliberately wrong); do
not give it to a tester.

## Answer file: `answers/Pn.json`

```json
{
  "packet": "P1",
  "answers": {
    "1": "any name",
    "2": "the description typed (optional)",
    "3": "<option text, exactly>",
    "11": ["<option text>", "<option text>"],
    "8other": "free text, only if asked"
  },
  "prefills": [
    { "question": "6", "status": "ticked" },
    { "question": "7", "status": "changed", "changedTo": "<option text, exactly>" }
  ],
  "didntUnderstand": [
    { "item": "<quoted question or sentence>", "why": "<reason>" }
  ],
  "expectNext": "in the tester's own words",
  "ticksMean": "in the tester's own words"
}
```

- `answers` keys are the form's question ids (`3`, `4`, `4a`, `5`, `6`, `6a`, `6b`,
  `7`, `8`, `9`, `10`, `11`, `12`, `13`, `14`, `3a`, `3platformZone`). Values are the
  option text exactly as shown (tick-all questions: an array). `answers` holds the
  FINAL answer, after any change to a pre-filled one.
- `didntUnderstand` is an empty array when everything was understood.
- `status` is `"ticked"` or `"changed"`.
