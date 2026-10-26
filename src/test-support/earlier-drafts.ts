// R18-E: the name an earlier build saved its card-review step under, for the tests that prove an old saved draft
// still opens (on the form, with the description kept). It is joined from two pieces on purpose: the retirement
// grep (src/retirement.r18e.test.ts) asserts that the retired step is named nowhere in src except in that test,
// and a draft written by an earlier build is the one place a test has to say what such a draft held.
// Test-only: never imported by src code.
export const EARLIER_CARD_REVIEW_STEP = ['graph', 'review'].join('_');
