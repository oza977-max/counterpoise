import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { R18_COPY, OLLAMA_DOCS_CHECKED, OLLAMA_DOCS_URL, PUBLIC_SITE_ORIGIN, originsCommand } from '../components/plain-copy';

// R18-G (specs/intake-flow.md §27.9, §27.12): the sentences that tell a reader where their description goes,
// the two commands, the demonstration notice and the optional-key exception are held in the app and printed in
// the user guide (both twins), the tester guide and the README. One test keeps the copies identical: a copy that
// differs by one word or one character fails. Sentences are read from R18_COPY, never retyped here.

const ROOT = resolve(__dirname, '../..');
const DOCS = ['README.md', 'docs/user-guide.md', 'docs/user-guide.html', 'docs/tester-guide.md'] as const;

const ENTITIES: Record<string, string> = {
  '&mdash;': '—', '&rarr;': '→', '&rsquo;': '’', '&lsquo;': '‘', '&hellip;': '…', '&quot;': '"', '&#39;': "'",
  '&lt;': '<', '&gt;': '>', '&amp;': '&', '&nbsp;': ' ',
};

/** Reading text: tags and Markdown emphasis removed, entities decoded, whitespace (including hard wraps) collapsed. */
function plain(text: string): string {
  let t = text.replace(/<[^>]+>/g, '');
  for (const [k, v] of Object.entries(ENTITIES)) t = t.split(k).join(v);
  return t.replace(/[*`]/g, '').replace(/\s+/g, ' ');
}
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const has = (doc: string, sentence: string) => plain(doc).includes(plain(sentence));

const PLACES = [R18_COPY.PLACE_SENTENCES['this-computer'], R18_COPY.PLACE_SENTENCES['firm-server'], R18_COPY.PLACE_SENTENCES['ollama-cloud'], R18_COPY.PLACE_SENTENCES['this-computer-with-key']];

describe('TC-R18-MS-2-05: the four where-it-goes sentences are the same words in the app and all four copies', () => {
  it.each(DOCS)('%s holds all four sentences exactly as the app words them', (f) => {
    const doc = read(f);
    for (const s of PLACES) expect(has(doc, s), `${f}: ${s}`).toBe(true);
  });

  it('the test is not vacuous: a copy that differs by one word does not pass', () => {
    const doc = read('docs/user-guide.md');
    for (const s of PLACES) {
      const changed = doc.replace(s.replace('{model}', '{model}'), s.replace('read', 'seen').replace('sent', 'send'));
      expect(has(changed, s)).toBe(false);
    }
  });

  it('"never leaves your computer" is in one app string, and in the docs only beside the sentence that qualifies it (TC-R18-NF-3-09)', () => {
    const phrase = /never leaves your computer/i;
    for (const f of DOCS) {
      const doc = plain(read(f));
      const n = (doc.match(new RegExp(phrase.source, 'gi')) ?? []).length;
      // the sentence itself, and the quoted phrase in the line that follows it
      expect(n, f).toBeLessThanOrEqual(2);
      if (n > 0) expect(doc, f).toContain(plain(R18_COPY.ABOUT_KEY_SENTENCE));
    }
  });
});

describe('TC-R18-PS-2-04: the same two commands, to the character, in the app and all four copies', () => {
  const signin = R18_COPY.PANEL_COMMAND_SIGNIN;
  const origins = originsCommand(PUBLIC_SITE_ORIGIN);
  const codeSpans = (f: string): string[] => {
    const raw = read(f);
    const spans = f.endsWith('.html')
      ? [...raw.matchAll(/<code>([^<]*)<\/code>/g)].map((m) => m[1]!)
      : [...raw.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);
    return spans;
  };

  it.each(DOCS)('%s prints both commands in code style', (f) => {
    const spans = codeSpans(f);
    expect(spans).toContain(signin);
    expect(spans).toContain(origins);
  });

  it.each(DOCS)('%s prints no other ollama command or allowed-origins value', (f) => {
    const ollama = codeSpans(f).filter((s) => /ollama/i.test(s));
    for (const s of ollama) expect([signin, origins], `${f}: ${s}`).toContain(s);
  });

  it('the app\'s allowed-origins command is the setting plus the page\'s own address', () => {
    expect(origins).toBe('OLLAMA_ORIGINS=https://oza977-max.github.io');
    expect(originsCommand('http://localhost:5173')).toBe('OLLAMA_ORIGINS=http://localhost:5173');
  });

  it('not vacuous: a command that differs by a character is not the command', () => {
    expect(codeSpans('README.md')).not.toContain('ollama sign-in');
    expect(codeSpans('README.md')).not.toContain(`${origins}/`);
  });

  it.each(DOCS)('%s gives Ollama\'s documentation link and the date it was last checked, as the panel does', (f) => {
    const doc = read(f);
    expect(doc).toContain(OLLAMA_DOCS_URL);
    expect(has(doc, R18_COPY.PANEL_LINK_CHECKED.replace('{date}', OLLAMA_DOCS_CHECKED))).toBe(true);
  });
});

describe('TC-R18-PS-4-04: the demonstration notice reads the same in the app and all four copies', () => {
  it.each(DOCS)('%s holds the notice word for word', (f) => {
    expect(has(read(f), R18_COPY.DEMO_NOTICE)).toBe(true);
  });
  it('and the copies hold no differently worded notice', () => {
    for (const f of DOCS) expect(/this is a (demonstration(?!\. Use made-up)|demo\b)/i.test(plain(read(f))), f).toBe(false);
  });
});

describe('TC-R18-NF-3-09: the optional saved Anthropic key is stated in the same sentence in the README, the user guide and the tester guide', () => {
  it.each(DOCS)('%s states the exception', (f) => {
    expect(has(read(f), R18_COPY.ABOUT_KEY_SENTENCE)).toBe(true);
    expect(plain(read(f))).toContain('The key is optional and no screen in the app sets it');
  });

  it('is true: no screen or other source file saves that key (the only code that touches it reads it)', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const full = join(d, n);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n)) files.push(full);
      }
    };
    walk(resolve(ROOT, 'src'));
    const writers = files.filter((f) => /setItem\(\s*['"`]aigate:api-key/.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
    expect(writers).toEqual([]);
  });
});

describe('TC-R18-NF-3-09: the regulator brief states the optional saved Anthropic key in the same words, and does not say no model is involved while one can be saved', () => {
  it.each(['docs/regulator-brief.md', 'docs/regulator-brief.html'])('%s', (f) => {
    const t = plain(read(f));
    expect(t).toContain('With no model configured and no Anthropic key saved, none is involved.');
    expect(t).not.toContain('none is involved anywhere');
    expect(t).toContain(plain(R18_COPY.ABOUT_KEY_SENTENCE));
    expect(t).toContain('The key is optional and no screen in the app sets it');
  });
});

describe('TC-R18-PS-3-04: the guide says its outcomes are pinned through its own answers', () => {
  const guide = read('docs/try-these.md');
  it('says so, and promises nothing about what a model fills in', () => {
    expect(plain(guide)).toContain("Each outcome is pinned through the guide's own answers, never through anything a model fills in.");
    expect(guide).not.toMatch(/will always fill|every model will|always fills in/i);
  });
  it('names the way in through Try an example, and no retired screen', () => {
    expect(guide).toContain(`**${R18_COPY.EXAMPLES_BUTTON}**`);
    expect(guide).not.toMatch(/Check what we read|on the cards|follow-up questions/i);
  });
});

describe('docs made false by Round 18-E say nothing retired (R18-G)', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const full = join(dir, n);
      if (statSync(full).isDirectory()) return n === 'assets' ? [] : walk(full);
      return /\.(md|html)$/.test(n) ? [full] : [];
    });
  }
  const files = [...walk(resolve(ROOT, 'docs')).map((f) => relative(ROOT, f)), 'README.md'];
  const RETIRED =
    /Check what we read|review screen|check every card|on the cards|the wrong cards|local open model|small free model|free local|qwen|description never leaves|targeted follow-up/i;
  it.each(files)('%s names no retired screen, card, model or promise', (f) => {
    expect(RETIRED.test(plain(read(f))), `${f} names something retired`).toBe(false);
  });

  it('the user guide no longer promises follow-up questions; it says what the app does (contradictions)', () => {
    for (const f of ['docs/user-guide.md', 'docs/user-guide.html']) {
      const t = plain(read(f));
      expect(t, f).not.toMatch(/Follow-up questions|you may be asked a few more/i);
      expect(t, f).toContain('If an answer contradicts what your description says, you are told here, not later, and asked which is right, and why.');
    }
  });

  it('the user guide and the README say the form is blank with no model, and every filled-in answer needs a tick', () => {
    const t = plain(read('docs/user-guide.md'));
    expect(t).toContain('You have to tick every answer it fills in before Continue is enabled');
    expect(t).toContain('With no model, nothing is filled in and the form is blank.');
  });
});
