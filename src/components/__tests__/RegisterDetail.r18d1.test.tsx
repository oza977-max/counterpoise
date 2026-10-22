import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import RegisterDetail, { currentVerdictAttestationFields } from '../RegisterDetail';
import { loadPolicy } from '../../store/policy';
import { getAll } from '../../store/audit';
import { R18_COPY } from '../plain-copy';
import {
  seedCase,
  realisticSources,
  cloudSources,
  typedOnlySources,
  countedSources,
  DESCRIPTION,
  READ_CLOUD,
  READ_FIRM,
  READ_LOCAL,
} from '../../test-support/answer-sources-fixtures';
import type { PolicyFile } from '../../engine/types';

// R18-D1 (specs/intake-flow.md §27.13 "Register detail"). The register shows where each saved answer came from, read
// from the record: one line per distinct read, the same share line as the confirmation step, then per answer who
// supplied it. Every sentence is asserted in the state where it would be false (TC-R18-GI-13-01), and the record is
// treated as untrusted input (TC-R18-GI-5-05). The existing RegisterDetail tests run unchanged and are the proof
// that a case with no sources reads exactly as before.

const loaded = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
if (!loaded.valid) throw new Error('shipped policy invalid');
const POLICY: PolicyFile = loaded.policy;

let n = 0;
async function open(opts: Parameters<typeof seedCase>[1]) {
  const id = `uc-d1-${(n += 1)}`;
  await seedCase(id, opts);
  const view = render(<RegisterDetail useCaseId={id} role="2LoD" policy={POLICY} onBack={() => {}} />);
  await screen.findByRole('heading', { name: 'Client email drafting assistant' });
  return view;
}
const sourcesList = () => screen.getByRole('list', { name: R18_COPY.SOURCES_HEADING });
const rowFor = (re: RegExp) => within(sourcesList()).getAllByRole('listitem').find((r) => re.test(r.textContent ?? ''))!;
const noSources = () => screen.queryByRole('list', { name: R18_COPY.SOURCES_HEADING });

describe('RegisterDetail - answer sources, the lines (TC-R18-GI-5-01, MS-2-04, GI-5-06)', () => {
  it('TC-R18-GI-5-01d1: names the model and where it ran, the value in words, and who supplied each answer', async () => {
    const { container } = await open({ sources: cloudSources() });
    expect(screen.getByText("read by gemma4:cloud by Ollama's cloud, through the Ollama app on the computer in use")).toBeInTheDocument();
    expect(rowFor(/Which countries/)).toHaveTextContent('United Kingdom');
    expect(rowFor(/Which countries/)).toHaveTextContent('typed by you');
    expect(rowFor(/What information will it see/)).toHaveTextContent(/Everyday work information/);
    expect(rowFor(/What information will it see/)).toHaveTextContent('filled from your description and confirmed by you — “internal ticket volumes” (suggested by gemma4:cloud)');
    expect(rowFor(/How widely/)).toHaveTextContent(/changed by you \(from Just me, or a small trial — “a small trial”, suggested by gemma4:cloud\)/);
    expect(rowFor(/How widely/)).toHaveTextContent(/My team, as part of normal work/);
    expect(container.textContent).not.toMatch(/never leaves your computer/i);
    // a line only for an answer that has a source recorded: three answers, three rows
    expect(within(sourcesList()).getAllByRole('listitem')).toHaveLength(3);
  });

  it('TC-R18-MS-2-04: the register detail names the model and the place; a typed-only case names neither', async () => {
    await open({ sources: cloudSources() });
    expect(document.body.textContent).toContain('gemma4:cloud');
    expect(document.body.textContent).toContain("Ollama's cloud");
  });

  it('TC-R18-GI-5-04: a typed-only case shows "typed by you" and no model, no place, no host, no share line', async () => {
    const { container } = await open({ sources: typedOnlySources() });
    expect(within(sourcesList()).getAllByText('typed by you')).toHaveLength(3);
    expect(screen.queryByText(/^read by /)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/read by|suggested by|Ollama|the program at|the server at|filled in by a model|Counterpoise does not check them/);
    expect(container.textContent).toContain('Ticket volume report');
  });

  it('TC-R18-GI-5-06: each of the three places is stated as configured, past tense, with the model and host, never as a promise', async () => {
    const cases: [typeof READ_LOCAL, RegExp][] = [
      [READ_LOCAL, /read by alpha:7b by the program at http:\/\/localhost:11434 on the computer in use/],
      [READ_FIRM, /read by firm-model:2 by the server at https:\/\/models\.example\.internal:8443, which the person declared as the firm's/],
      [READ_CLOUD, /read by gemma4:cloud by Ollama's cloud, through the Ollama app on the computer in use/],
    ];
    for (const [read, line] of cases) {
      const { container, unmount } = await open({ sources: cloudSources(read) });
      expect(container.textContent).toMatch(line);
      expect(container.textContent).not.toMatch(/never leaves your computer/i);
      for (const sentence of Object.values(R18_COPY.PLACE_SENTENCES).flatMap((s) => (typeof s === 'string' ? [s] : Object.values(s)))) {
        if (typeof sentence === 'string' && sentence.length > 12) {
          expect(container.textContent).not.toContain(sentence.replace('{host}', read.host));
        }
      }
      // honest about what the record is: configured, not proven
      expect(container.textContent).toContain(R18_COPY.READ_NOTE);
      unmount();
    }
  });

  it('lists one read line per distinct read, and none twice', async () => {
    const sources = { ...realisticSources(), reads: [READ_LOCAL, { ...READ_LOCAL }, READ_CLOUD] };
    await open({ sources });
    expect(screen.getAllByText(/^read by /)).toHaveLength(2);
  });
});

describe('RegisterDetail - the share line (TC-R18-GI-3-17)', () => {
  it('TC-R18-GI-3-17: "5 of 14 answers were filled in by a model and confirmed by you, and 2 were changed by you" from the record', async () => {
    await open({ sources: countedSources(14, 5, 2) });
    expect(screen.getByText('5 of 14 answers were filled in by a model and confirmed by you, and 2 were changed by you')).toBeInTheDocument();
  });

  it('uses the confirmation step\'s own wording for one changed answer and for none', async () => {
    await open({ sources: realisticSources() });
    expect(screen.getByText('2 of 4 answers were filled in by a model and confirmed by you, and 1 was changed by you')).toBeInTheDocument();
  });

  it('TC-R18-GI-13-01d1a: no share line when nothing was filled in or changed (N = K = 0), however many answers were typed', async () => {
    await open({ sources: typedOnlySources() });
    expect(screen.queryByText(/answers were filled in by a model/)).not.toBeInTheDocument();
  });

  it('TC-R18-GI-13-01d1b: no share line for earlier-record answers alone', async () => {
    await open({
      sources: { reads: [], answers: [{ question_id: '9', value: 'yes', origin: 'from_earlier_record' }] },
    });
    expect(screen.queryByText(/filled in by a model/)).not.toBeInTheDocument();
    expect(rowFor(/Does it ever|mistake|put right|wrong/i)).toHaveTextContent('from the earlier record');
  });
});

describe('RegisterDetail - the quote is no longer in the description (TC-R18-GI-5-09)', () => {
  it('TC-R18-GI-5-09: says so on the answer whose recorded quote_in_final_description is false, and not on the others', async () => {
    await open({ sources: realisticSources() });
    expect(rowFor(/Who ends up seeing/)).toHaveTextContent('the quote is no longer in your description');
    expect(rowFor(/What information will it see/)).not.toHaveTextContent(/no longer in your description/);
    expect(rowFor(/Which countries/)).not.toHaveTextContent(/no longer in your description/);
    expect(screen.getAllByText(/no longer in your description/)).toHaveLength(1);
  });

  it('TC-R18-GI-13-01d1c: while every quote is still there (or the record does not say), the phrase is absent', async () => {
    const sources = realisticSources();
    sources.answers[2]!.quote_in_final_description = true;
    delete sources.answers[1]!.quote_in_final_description; // not recorded: no claim either way
    await open({ sources });
    expect(document.body.textContent).not.toMatch(/no longer in your description/);
  });
});

describe('RegisterDetail - origins are claimed only where the row says so (TC-R18-GI-13-01)', () => {
  it('"changed by you" only on a changed answer; "confirmed by you" only on a confirmed one; "from the earlier record" only on a record row', async () => {
    await open({
      sources: {
        reads: [READ_LOCAL],
        answers: [
          { question_id: '4', value: 'language', origin: 'typed' },
          { question_id: '5', value: ['people'], origin: 'prefilled_confirmed', quotes: [{ option: 'people', quote: 'client names' }], quote_in_final_description: true, read: 0 },
          { question_id: '6', value: 'drafts', origin: 'from_earlier_record' },
          { question_id: '9', value: 'no', origin: 'prefilled_changed', quotes: [{ option: 'yes', quote: 'a quote' }], changed_from: [{ option: 'yes', quote: 'a quote' }], read: 0 },
        ],
      },
    });
    const typed = rowFor(/what kind of AI/i);
    expect(typed).toHaveTextContent('typed by you');
    expect(typed).not.toHaveTextContent(/confirmed by you|changed by you|earlier record|suggested by/);
    const confirmed = rowFor(/What information/);
    expect(confirmed).not.toHaveTextContent(/changed by you|typed by you|earlier record/);
    const record = rowFor(/What happens with what it produces/);
    expect(record).toHaveTextContent('from the earlier record');
    expect(record).not.toHaveTextContent(/typed by you|confirmed by you|changed by you|suggested by/);
    const changed = rowFor(/mistake|put right/i);
    expect(changed).toHaveTextContent('changed by you (from Yes — “a quote”, suggested by alpha:7b)');
    expect(changed).not.toHaveTextContent(/confirmed by you|typed by you/);
  });

  it('names no model on a row whose read is missing, out of range, or has an empty model name', async () => {
    await open({
      sources: {
        reads: [{ model: '', place: 'this-computer', host: 'http://localhost:11434' }],
        answers: [
          { question_id: '5', value: ['people'], origin: 'prefilled_confirmed', quotes: [{ option: 'people', quote: 'q1' }], read: 99 },
          { question_id: '6', value: 'drafts', origin: 'prefilled_confirmed', quotes: [{ option: 'drafts', quote: 'q2' }] },
          { question_id: '7', value: 'clients', origin: 'prefilled_confirmed', quotes: [{ option: 'clients', quote: 'q3' }], read: 0 },
        ],
      },
    });
    for (const row of within(sourcesList()).getAllByRole('listitem')) {
      expect(row).toHaveTextContent('filled from your description and confirmed by you');
      expect(row).not.toHaveTextContent(/suggested by/);
    }
  });
});

describe('RegisterDetail - a hand-off file is untrusted (TC-R18-GI-5-05)', () => {
  it('shows markup as text, bidi and hidden characters as escapes, and never the raw unknown words', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const { container } = await open({
      sources: {
        reads: [{ model: `<b>gemma</b>${evil}`, place: '__proto__', host: 'http://h‮ost' }],
        answers: [
          { question_id: '5', value: ['people'], origin: 'prefilled_confirmed', quotes: [{ option: 'people', quote: `${evil}‮quote` }], quote_in_final_description: true, read: 0 },
          { question_id: '6', value: 'constructor', origin: 'approved-by-model' },
          { question_id: '<script>alert(1)</script>', value: ['__proto__'], origin: 'constructor' },
          { question_id: '9', value: 'yes', origin: '<script>alert(1)</script>' },
          { question_id: '4', value: 'language', origin: 'prefilled_confirmed', quotes: [{ option: 'language', quote: 'q' }], read: 99 },
        ],
      },
    });
    // no element was created from the record's text
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    // the literal characters are on the screen, as text
    expect(container.textContent).toContain('<b>gemma</b>');
    expect(container.textContent).toContain(evil);
    expect(container.textContent).toContain('⟦U+202E⟧');
    expect(container.textContent).not.toMatch(/‮/);
    // an unknown place is never shown as the word, and the host still is
    expect(container.textContent).toContain("a place this version doesn't recognise");
    expect(container.textContent).not.toContain('__proto__ ');
    // an unknown origin is "source not recognised", and the raw word is not repeated as a claim
    expect(within(sourcesList()).getAllByText('source not recognised')).toHaveLength(3);
    expect(container.textContent).not.toContain('approved-by-model');
    // a value of "constructor" is inert text; an unknown question id is shown raw
    expect(rowFor(/<script>/)).toHaveTextContent('<script>alert(1)</script>');
    expect(rowFor(/<script>/)).toHaveTextContent('__proto__');
    expect(container.textContent).toContain('constructor');
    // the screen did not throw and the page still shows the case
    expect(screen.getByRole('heading', { name: 'Client email drafting assistant' })).toBeInTheDocument();
  });

  it('a record with garbage in place of answer_sources renders nothing extra and does not crash', async () => {
    for (const junk of ['text', 5, [], { reads: 'x', answers: 'y' }, { reads: [], answers: [] }]) {
      const { unmount } = await open({ sources: junk });
      expect(noSources()).toBeNull();
      unmount();
    }
  });
});

describe('RegisterDetail - the corrected description (TC-R18-GI-5-11)', () => {
  const D2 = 'It reads client names and account details. Our team in Paris will use it daily.';

  it('TC-R18-GI-5-11: shows the corrected description and the correction\'s own sources; use_case_created is never rewritten', async () => {
    const id = 'uc-corrected';
    await seedCase(id, { sources: realisticSources(), corrections: [{ answer_sources: cloudSources(), description: D2 }] });
    const { container } = render(<RegisterDetail useCaseId={id} role="2LoD" policy={POLICY} onBack={() => {}} />);
    await screen.findByRole('heading', { name: 'Client email drafting assistant' });
    expect(screen.getByRole('heading', { name: R18_COPY.CORRECTED_DESCRIPTION_HEADING })).toBeInTheDocument();
    expect(container.textContent).toContain(D2);
    // the correction's sources, not the first confirmation's
    expect(container.textContent).toContain('gemma4:cloud');
    expect(container.textContent).not.toContain('alpha:7b');
    const events = await getAll(id);
    const created = events.find((e) => e.payload.type === 'use_case_created')!.payload as { description: string };
    expect(created.description).toBe(DESCRIPTION); // D1 unchanged
  });

  it('TC-R18-GI-13-01d1d: no "corrected" description when no correction edited it, even for a corrected case', async () => {
    await open({ sources: realisticSources(), corrections: [{ answer_sources: realisticSources() }] });
    expect(screen.queryByRole('heading', { name: R18_COPY.CORRECTED_DESCRIPTION_HEADING })).not.toBeInTheDocument();
    expect(sourcesList()).toBeInTheDocument();
  });

  it('currentVerdictAttestationFields: the latest correction that edited the description wins; a later one that did not leaves it', async () => {
    const id = 'uc-fields';
    await seedCase(id, {
      sources: realisticSources(),
      corrections: [{ answer_sources: cloudSources(), description: 'first edit' }, { answer_sources: cloudSources(), description: D2 }, { answer_sources: cloudSources() }],
    });
    const f = currentVerdictAttestationFields(await getAll(id));
    expect(f.description).toBe(D2);
    expect(f.answer_sources).toEqual(cloudSources());
  });

  it('currentVerdictAttestationFields: without a correction it reads graph_confirmed, and carries no description key at all', async () => {
    const id = 'uc-fields-2';
    await seedCase(id, { sources: realisticSources() });
    const f = currentVerdictAttestationFields(await getAll(id));
    expect(f.answer_sources).toEqual(realisticSources());
    expect('description' in f).toBe(false);
  });

  it('a correction that wrote no sources shows none: an older confirmation\'s never describe a corrected case', async () => {
    await open({ sources: realisticSources(), corrections: [{}] });
    expect(noSources()).toBeNull();
    expect(document.body.textContent).not.toContain('alpha:7b');
  });
});

describe('RegisterDetail - a case without sources reads as before', () => {
  it('shows nothing of this round: no sources block, no heading, no read note', async () => {
    const { container } = await open({});
    expect(noSources()).toBeNull();
    expect(screen.queryByRole('heading', { name: R18_COPY.SOURCES_HEADING })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/read by|typed by you|filled in by a model|Counterpoise does not check them/);
    expect(container.querySelector('.register-detail__sources')).toBeNull();
  });
});

describe('RegisterDetail - the share line needs the real catalogue (review pass 1 minor 2)', () => {
  it('with a valid policy (what the register passes) the share line is shown with M counted from the catalogue', async () => {
    await open({ sources: cloudSources() });
    expect(screen.getByText(/of \d+ answers were filled in by a model and confirmed by you/)).toBeInTheDocument();
  });

  it('with no valid policy the share line is not shown (M could not be counted), while the rows still are', async () => {
    const id = 'uc-d1-nopolicy';
    await seedCase(id, { sources: cloudSources() });
    render(<RegisterDetail useCaseId={id} role="2LoD" onBack={() => {}} />);
    await screen.findByRole('heading', { name: 'Client email drafting assistant' });
    expect(screen.queryByText(/answers were filled in by a model/)).toBeNull();
    expect(screen.getByText(/read by gemma4:cloud/)).toBeInTheDocument();
  });
});
