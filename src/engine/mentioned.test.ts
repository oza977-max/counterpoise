import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  mentionedItems,
  foldForMention,
  normForQuote,
  CHECKLIST_ITEM_IDS,
  PREFILL_MAX_CHARS,
  codePointLength,
} from './mentioned';
import type { ChecklistItemId } from './prefill-types';

// R18-A deliverable 1 (specs/intake-flow.md §27.2, ADR-IF-R18-1). The
// jurisdictions are the policy's real list (policy/appetite.yaml:1197).
const JURISDICTIONS = [
  { code: 'UK', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'EU', name: 'European Union' },
  { code: 'CA', name: 'Canada' },
  { code: 'SG', name: 'Singapore' },
  { code: 'JP', name: 'Japan' },
];

const ticked = (text: string) => mentionedItems(text, JURISDICTIONS);
const has = (text: string, id: ChecklistItemId) => ticked(text).has(id);

// The 13 rows of TC-R18-GI-1-02, verbatim from test-cases-033.md.
const ROWS: { id: ChecklistItemId; ticks: string; stays: string }[] = [
  { id: 'where-ai-comes-from', ticks: 'We bought it from a specialist supplier.', stays: 'We want to try something new.' },
  { id: 'kind-of-ai', ticks: 'It gives each application a score.', stays: 'It is a new project for next quarter.' },
  { id: 'can-explain', ticks: 'The supplier can show which factors drove each score.', stays: 'The supplier is based in Leeds.' },
  { id: 'information-used', ticks: 'It reads client names and account details.', stays: 'It saves time every Friday.' },
  { id: 'what-it-does-with-output', ticks: 'A person checks each draft before it is used.', stays: 'The team is enthusiastic.' },
  { id: 'weight-of-output', ticks: 'Staff usually go with its suggestion.', stays: 'It was announced in March.' },
  { id: 'who-receives', ticks: 'The summaries go out to clients.', stays: 'It runs overnight.' },
  { id: 'what-it-decides', ticks: 'It helps decide who gets a loan.', stays: 'It is good with spreadsheets.' },
  { id: 'mistake-recoverable', ticks: 'A person can correct any mistake before it is sent.', stays: 'It looks tidy.' },
  { id: 'how-widely', ticks: 'Every application will go through it.', stays: 'It was built last year.' },
  { id: 'countries', ticks: 'It will be used by our offices in the United Kingdom and Germany.', stays: 'It runs overnight on weekends.' },
  { id: 'replaces-something', ticks: 'It replaces our old spreadsheet scorecard.', stays: 'It sits on the shared drive.' },
  { id: 'agentic-reach', ticks: 'It has its own logins for other systems.', stays: 'It has a blue logo.' },
];

describe('the item list (R18-A, intake-flow §27.2)', () => {
  it('has exactly the 13 items of the spec, once each', () => {
    expect([...CHECKLIST_ITEM_IDS].sort()).toEqual(ROWS.map((r) => r.id).sort());
    expect(new Set(CHECKLIST_ITEM_IDS).size).toBe(13);
  });
});

describe('TC-R18-GI-1-01: typing a sentence about countries ticks the countries item', () => {
  it('ticks countries and not the information item, and nothing else', () => {
    const t = ticked('It will be used by our offices in the United Kingdom and Germany.');
    expect(t.has('countries')).toBe(true);
    expect(t.has('information-used')).toBe(false);
    expect([...t]).toEqual(['countries']);
  });
});

describe('TC-R18-GI-1-02: each item ticks on its sentence and stays unticked on the other', () => {
  it('covers one row per shipped item (a missing row fails)', () => {
    expect(ROWS.map((r) => r.id).sort()).toEqual([...CHECKLIST_ITEM_IDS].sort());
  });
  for (const row of ROWS) {
    it(`TC-R18-GI-1-02 [${row.id}] ticks on "${row.ticks}"`, () => {
      expect(has(row.ticks, row.id)).toBe(true);
    });
    it(`TC-R18-GI-1-02 [${row.id}] stays unticked on "${row.stays}"`, () => {
      expect(has(row.stays, row.id)).toBe(false);
    });
    // "The supplier is based in Leeds." rightly ticks where-the-AI-comes-from (a supplier is named).
    if (row.id !== 'can-explain') {
      it(`TC-R18-GI-1-02 [${row.id}] the unticked sentence ticks nothing at all`, () => {
        expect([...ticked(row.stays)]).toEqual([]);
      });
    }
  }
});

describe('TC-R18-GI-1-03: a near miss does not tick an item', () => {
  it('"Unity" and "Unitedhealth" tick nothing', () => {
    const t = ticked('The Unity team built it and it sells to the Unitedhealth group of companies.');
    expect(t.has('countries')).toBe(false);
    expect([...t]).toEqual([]);
  });
  it('a stem matches the start of a word, never the middle ("misclassified" is not "classif")', () => {
    expect(has('We classify each case.', 'kind-of-ai')).toBe(true);
    expect(has('This is a classification model.', 'kind-of-ai')).toBe(true);
    expect(has('The declassified file.', 'kind-of-ai')).toBe(false);
  });
  it('a whole phrase needs a non-letter on both sides ("scored" is the word "score" inflected; "scorecard" is not)', () => {
    expect(has('It scored them.', 'kind-of-ai')).toBe(true);
    expect(has('The scorecard.', 'kind-of-ai')).toBe(false);
    expect(has('Underscore.', 'kind-of-ai')).toBe(false);
  });
});

// What this proves, no more: repeated calls on one text agree, and the rule's source
// contains no clock, random, network or storage call. "With a model configured or not"
// is true by construction (mentionedItems takes only the text and the jurisdiction
// list); a faked clock or a configured model is not exercised here.
describe('TC-R18-GI-1-04: repeated calls on the same text agree, and the rule source has no clock, random, network or storage call', () => {
  it('returns the same set (same members, same order) on repeated calls', () => {
    const text = ROWS.map((r) => r.ticks).join(' ');
    const a = [...ticked(text)];
    for (let i = 0; i < 20; i++) expect([...ticked(text)]).toEqual(a);
  });
  it('depends on the text and the jurisdiction list only: the source has no clock, random or I/O', () => {
    const src = readFileSync(resolve(__dirname, 'mentioned.ts'), 'utf-8')
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(src).not.toMatch(/Date\.now|new Date|Math\.random|performance\.now|fetch\(|localStorage|sessionStorage|indexedDB|XMLHttpRequest/);
  });
});

describe('TC-R18-GI-1-05: a tick falls away when the sentence is deleted', () => {
  it('"replaces" is mentioned, then not mentioned once the sentence is gone', () => {
    expect(has('It replaces our old spreadsheet scorecard.', 'replaces-something')).toBe(true);
    expect(has('', 'replaces-something')).toBe(false);
    expect(has('It replaces our old spreadsheet scorecard. It runs overnight.'.replace('It replaces our old spreadsheet scorecard. ', ''), 'replaces-something')).toBe(false);
  });
});

describe('TC-R18-GI-1-09: a two-letter code ticks countries only when written as a code', () => {
  it('the pronoun "us" does not tick; "US" and "EU"/"UK" written as codes do; names tick in any case', () => {
    expect(has('It gives us a score.', 'countries')).toBe(false);
    expect(has('Our US office will use it.', 'countries')).toBe(true);
    expect(has('Used in the EU and the UK.', 'countries')).toBe(true);
    expect(has('used in the united kingdom.', 'countries')).toBe(true);
    expect(has('United Kingdom', 'countries')).toBe(true);
  });
  it('a lower-case code is not a code ("uk", "eu", "us", "ca")', () => {
    for (const w of ['uk', 'eu', 'us', 'ca', 'sg', 'jp']) expect(has(`please send it to the ${w} team`, 'countries')).toBe(false);
  });
  it('a code inside a longer word is not a code ("USB", "EUR", "UKULELE", "CAT")', () => {
    for (const w of ['USB', 'EUR', 'UKULELE', 'CAT', 'US2', '2US']) expect(has(`the ${w} thing`, 'countries')).toBe(false);
  });
  it('the code is matched against the ORIGINAL text, bounded by non-letters, including punctuation and brackets', () => {
    for (const s of ['(US)', 'US,', 'the US.', '"EU"', 'UK/EU', 'UK-based', 'us/UK']) expect(has(s, 'countries')).toBe(true);
  });
  it('uses the list it is given: another firm’s list ticks its own codes and names, not ours', () => {
    const other = [{ code: 'CH', name: 'Switzerland' }];
    expect(mentionedItems('Our CH office', other).has('countries')).toBe(true);
    expect(mentionedItems('Our UK office', other).has('countries')).toBe(false);
    expect(mentionedItems('Our Switzerland office', other).has('countries')).toBe(true);
  });
  it('a longer code or an empty list does not throw, and country names still tick with no list', () => {
    expect(mentionedItems('Offices in Germany', []).has('countries')).toBe(true);
    expect(mentionedItems('Offices in Germany', [{ code: 'WORLD', name: 'The world' }]).has('countries')).toBe(true);
    expect(mentionedItems('x', [{ code: '', name: '' }]).has('countries')).toBe(false);
  });
  it('R18-A review m6: a 2-3 letter jurisdiction NAME is held to the capitals rule too', () => {
    const named = [{ code: 'USA-GOV', name: 'US' }];
    expect(mentionedItems('It gives us a score.', named).has('countries')).toBe(false);
    expect(mentionedItems('Our US desk will use it.', named).has('countries')).toBe(true);
    // Accepted limit, pinned so it is a decision and not an accident: an all-capitals text ticks on "US".
    expect(mentionedItems('IT GIVES US A SCORE.', named).has('countries')).toBe(true);
  });
  it('R18-A review m6: the written-out forms "U.S.", "U.K.", "USA" and "UAE" tick (also with no list)', () => {
    for (const s of ['our U.S. desk', 'Our u.s. desk', 'the U.K. office', 'staff in the USA', 'a UAE branch', 'U.S.-based']) {
      expect(mentionedItems(s, []).has('countries')).toBe(true);
    }
    for (const s of ['the bus.s thing', 'usable', 'a uaeX tool', 'it gives us a score']) {
      expect(mentionedItems(s, []).has('countries')).toBe(false);
    }
  });
  it('a list entry cannot inject a pattern: regex characters in names are literal', () => {
    const odd = [{ code: 'A.B', name: '(x+)+$' }];
    expect(mentionedItems('aXb and aaaaaaaaaaaaaaaaaaaaaaaa!', odd).has('countries')).toBe(false);
  });
});

describe('the normalisers (R18-A, intake-flow §27.2)', () => {
  it('foldForMention lower-cases, folds curly quotes and dashes, collapses whitespace', () => {
    expect(foldForMention('It  CAN’T\t explain\n“why” – ever — now')).toBe('it can\'t explain "why" - ever - now');
  });
  it('normForQuote collapses whitespace runs and trims, nothing else', () => {
    expect(normForQuote('  Hello  World\t\n“x”  ')).toBe('Hello World “x”');
    expect(normForQuote('ABC')).toBe('ABC');
    expect(normForQuote('')).toBe('');
  });
});

describe('realistic-fixture variants (TDD-3)', () => {
  it('multi-line text: items on different lines all tick', () => {
    const t = ticked('We bought it from a supplier.\n\nIt replaces our old tool.\r\nIt will be used in the UK.\n');
    expect([...t].sort()).toEqual(['countries', 'replaces-something', 'where-ai-comes-from'].sort());
  });
  it('a phrase broken by a line break or tab still matches (whitespace runs collapse)', () => {
    expect(has('a small\ntrial of it', 'how-widely')).toBe(true);
    expect(has('a small\t\ttrial of it', 'how-widely')).toBe(true);
    expect(has('a small trial of it', 'how-widely')).toBe(true);
  });
  it('curly quotes and dashes match their plain forms', () => {
    expect(has('The supplier can’t explain why.', 'can-explain')).toBe(true);
    expect(has('Price‑sensitive and price–sensitive data.', 'information-used')).toBe(true);
  });
  it('an emoji beside a phrase does not break the boundary', () => {
    expect(has('🚀 Used in the UK 🇬🇧', 'countries')).toBe(true);
    expect(has('🚀bought🚀 it', 'where-ai-comes-from')).toBe(true);
  });
  it('upper-case and mixed-case text ticks as lower-case does', () => {
    expect(has('WE BOUGHT IT FROM A SUPPLIER', 'where-ai-comes-from')).toBe(true);
    expect(has('Replaces The Old One', 'replaces-something')).toBe(true);
  });
  it('8,001 code points: runs on the whole text, ticks the item at the very end, and stays fast', () => {
    const filler = '😀'.repeat(4000) + ' '.repeat(3000) + 'x'.repeat(1000);
    const text = filler + ' It replaces it';
    expect([...text].length).toBeGreaterThan(8000);
    const start = Date.now();
    const t = ticked(text);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(t.has('replaces-something')).toBe(true);
    const exactly = 'a'.repeat(7990) + ' replaces';
    expect(ticked(exactly).has('replaces-something')).toBe(true);
  });
  it('a long run of near-matches does not backtrack badly', () => {
    const text = 'classi '.repeat(1500) + 'unite '.repeat(1500);
    const start = Date.now();
    ticked(text);
    expect(Date.now() - start).toBeLessThan(2000);
  });
  it('blank and whitespace-only text tick nothing', () => {
    for (const s of ['', ' ', '\n\t ']) expect([...ticked(s)]).toEqual([]);
  });
});

describe('TC-R18-GI-2-01 / -02 support: joined sentences', () => {
  it('the thirteen ticks-on sentences together tick all thirteen', () => {
    expect([...ticked(ROWS.map((r) => r.ticks).join(' '))].sort()).toEqual([...CHECKLIST_ITEM_IDS].sort());
  });
  it('without the countries and replaces sentences, exactly those two are unmentioned', () => {
    const text = ROWS.filter((r) => r.id !== 'countries' && r.id !== 'replaces-something')
      .map((r) => r.ticks)
      .join(' ');
    const missing = CHECKLIST_ITEM_IDS.filter((id) => !ticked(text).has(id));
    expect(missing.sort()).toEqual(['countries', 'replaces-something']);
  });
});

describe('false-tick guards for the example phrases of the spec table', () => {
  const guards: [ChecklistItemId, string[], string[]][] = [
    ['where-ai-comes-from', ['We use ChatGPT for this.', 'Built in-house by the platform team.', 'Built by our team.', 'a vendor product'], ['Claudette will help.', 'The geminids shower.']],
    ['kind-of-ai', ['It will translate letters.', 'It summarises calls.', 'It generates text.', 'An agent that books things.', 'a forecast of volumes', 'a ranking of CVs'], ['It will regenerate nothing.']],
    ['can-explain', ['It follows fixed rules.', 'We can’t explain why it decides.', 'It cannot explain itself.'], ['It follows the rules of the road.']],
    ['information-used', ['Public information only.', 'Confidential papers.', 'Applicant CVs.', 'Customer account details.', 'Price-sensitive data.'], ['It reads the weather.']],
    ['what-it-does-with-output', ['It flags odd items.', 'It suggests next steps.', 'It acts by itself.', 'It runs automatically.', 'It drafts replies.', 'It approves requests.'], ['It looks at charts.']],
    ['weight-of-output', ['It is one input among several.', 'Staff relied on it.', 'The decision is based on it.'], ['The input file is large.']],
    ['who-receives', ['Results are published.', 'Sent to customers.', 'Shared with other teams.', 'For my team.', 'Sent to the regulator.'], ['It was a long day.']],
    ['what-it-decides', ['Used for hiring.', 'For pricing.', 'To detect fraud.', 'To lend money.', 'For trading.', 'A regulatory return.'], ['It prices nothing.']],
    ['mistake-recoverable', ['Nothing can be undone.', 'It cannot be taken back.', 'The harm is irreversible.'], ['It makes me happy.']],
    ['how-widely', ['A small trial.', 'A pilot.', 'The whole business.', 'Just my team.'], ['A pile of work.']],
    ['replaces-something', ['It is replacing the old one.', 'Instead of our old tool.', 'We will retire the old system.'], ['It is a replica.']],
    ['agentic-reach', ['It can deploy code.', 'It holds an access token.', 'It can pass work to other agents.'], ['The logo is blue.', 'It has a login screen.']],
  ];
  for (const [id, yes, no] of guards) {
    it(`[${id}] ticks on ${yes.length} listed phrases`, () => {
      for (const s of yes) expect(has(s, id), s).toBe(true);
    });
    it(`[${id}] does not tick on ${no.length} look-alike sentences`, () => {
      for (const s of no) expect(has(s, id), s).toBe(false);
    });
  }
});

describe('the length rule counts code points (R18-A, intake-flow §27.3)', () => {
  it('PREFILL_MAX_CHARS is 8000; an emoji is one code point; 8,000 is within and 8,001 is over', () => {
    expect(PREFILL_MAX_CHARS).toBe(8000);
    expect(codePointLength('😀')).toBe(1);
    expect('😀'.length).toBe(2);
    expect(codePointLength('😀'.repeat(8000))).toBe(8000);
    expect(codePointLength('😀'.repeat(8000) + 'x')).toBe(8001);
    expect(codePointLength('')).toBe(0);
    expect(codePointLength('é')).toBe(2);
  });
});
