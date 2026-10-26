import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { WORKED_EXAMPLES } from './worked-examples';

// R18-G, TC-R18-PS-3-02 (specs/intake-flow.md §27.12): the ten example descriptions are byte-identical
// to the ones printed in docs/try-these.md, and the app's list and the guide's own test read ONE module.

const ROOT = resolve(__dirname, '../..');
const guide = readFileSync(resolve(ROOT, 'docs/try-these.md'), 'utf8');

/** The guide's numbered sections: heading title and the block-quoted description, whose hard line breaks
 *  are joined with single spaces (what a person pastes from the rendered page; pinned since R18-A). */
function guideCases(): { n: number; title: string; description: string }[] {
  const out: { n: number; title: string; description: string }[] = [];
  const re = /^## (\d+)\. (.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(guide))) {
    const n = Number(m[1]);
    if (n > 10) continue; // section 11, "Things worth breaking", is not scripted
    const rest = guide.slice(m.index + m[0].length);
    const lines: string[] = [];
    let started = false;
    for (const line of rest.split('\n')) {
      if (line.startsWith('> ')) {
        started = true;
        lines.push(line.slice(2));
      } else if (started) break;
      else if (/^## /.test(line)) break;
    }
    out.push({ n, title: m[2]!, description: lines.join(' ') });
  }
  return out;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe('TC-R18-PS-3-02: the examples and the guide are one source', () => {
  it('offers ten, and the guide scripts exactly ten, numbered 1 to 10', () => {
    expect(WORKED_EXAMPLES).toHaveLength(10);
    expect(guideCases().map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('each example description is byte-identical to the guide\'s (hard line breaks joined by one space)', () => {
    const cases = guideCases();
    WORKED_EXAMPLES.forEach((ex, i) => {
      expect(Buffer.from(ex.description, 'utf8').equals(Buffer.from(cases[i]!.description, 'utf8')), `example ${i + 1}`).toBe(true);
    });
  });

  it('the comparison is not vacuous: one changed character in the guide\'s text is found', () => {
    const cases = guideCases();
    const changed = cases[0]!.description.replace('dashboard', 'dashbord');
    expect(Buffer.from(WORKED_EXAMPLES[0]!.description).equals(Buffer.from(changed))).toBe(false);
    // a straight apostrophe is not a curly one: byte identity, not look-alike identity
    expect(Buffer.from("last month's").equals(Buffer.from('last month’s'))).toBe(false);
  });

  it('each example title is the guide\'s heading for that case', () => {
    const cases = guideCases();
    WORKED_EXAMPLES.forEach((ex, i) => expect(ex.title).toBe(cases[i]!.title));
  });

  it('the list in the app and the guide\'s own test import the same module, and nothing else holds the texts', () => {
    const tryExample = readFileSync(resolve(ROOT, 'src/components/TryExample.tsx'), 'utf8');
    const guideTest = readFileSync(resolve(ROOT, 'src/engine/try-these.test.ts'), 'utf8');
    expect(tryExample).toMatch(/from '\.\.\/engine\/worked-examples'/);
    expect(guideTest).toMatch(/from '\.\/worked-examples'/);
    // No other source file holds an example's text: a copy there could drift from the module.
    const holders = walk(resolve(ROOT, 'src'))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
      .filter((f) => {
        const text = readFileSync(f, 'utf8');
        return WORKED_EXAMPLES.some((ex) => text.includes(ex.description));
      })
      .map((f) => relative(ROOT, f));
    expect(holders).toEqual(['src/engine/worked-examples.ts']);
  });
});
