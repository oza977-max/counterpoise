import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// R18-G hardening of the public-site scan (specs/intake-flow.md §27.9): the pattern scan also covers the
// repository's other public files (docs/, README.md, backtest/cases.json), a script tag naming another
// origin is a hit, an optional confidentiality word list held outside the repository is applied (and a
// release run fails closed without it), and both workflows run the scan after the build.

const ROOT = resolve(__dirname, '..');
const SCRIPT = resolve(ROOT, 'scripts/scan-dist.mjs');
const KEY = 'sk-ant-' + 'A1b2C3d4E5f6G7h8I9j0_-';

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'scan-r18g-'));
  mkdirSync(join(repo, 'dist', 'assets'), { recursive: true });
  mkdirSync(join(repo, 'docs'), { recursive: true });
  mkdirSync(join(repo, 'backtest'), { recursive: true });
  writeFileSync(join(repo, 'dist', 'index.html'), '<html><script type="module" src="./assets/index.js"></script></html>');
  writeFileSync(join(repo, 'dist', 'assets', 'index.js'), 'console.log(1)');
  writeFileSync(join(repo, 'docs', 'guide.md'), '# Guide\nnothing secret');
  writeFileSync(join(repo, 'README.md'), '# Readme');
  writeFileSync(join(repo, 'backtest', 'cases.json'), '{"cases":[]}');
  writeFileSync(join(repo, 'allow.txt'), '');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

function run(extra: string[] = [], env: Record<string, string> = {}) {
  return spawnSync('node', [SCRIPT, join(repo, 'dist'), '--allow', join(repo, 'allow.txt'), '--repo', repo, ...extra], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('TC-R18-PS-5-01: the pattern scan covers docs/, README.md and backtest/cases.json', () => {
  it('a clean build and clean public files pass, and the run says what it covered', () => {
    const r = run(['--with-public']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no secrets found/i);
    expect(r.stdout).toMatch(/docs\/, README\.md and backtest\/cases\.json/);
  });

  it.each([
    ['docs/guide.md', () => writeFileSync(join(repo, 'docs', 'guide.md'), `key ${KEY}`)],
    ['README.md', () => writeFileSync(join(repo, 'README.md'), `key ${KEY}`)],
    ['backtest/cases.json', () => writeFileSync(join(repo, 'backtest', 'cases.json'), `{"k":"${KEY}"}`)],
  ])('a key in %s fails the scan and names that file, without echoing the key', (file, plant) => {
    plant();
    const r = run(['--with-public']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(file);
    expect(r.stdout + r.stderr).not.toContain(KEY.slice(0, 8));
  });

  it('without --with-public only the named directory is scanned (the A-skeleton behaviour is unchanged)', () => {
    writeFileSync(join(repo, 'README.md'), `key ${KEY}`);
    expect(run().status).toBe(0);
  });

  it('a public file in a nested docs folder is covered too', () => {
    mkdirSync(join(repo, 'docs', 'assets'), { recursive: true });
    writeFileSync(join(repo, 'docs', 'assets', 'note.html'), `<p>${KEY}</p>`);
    const r = run(['--with-public']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('docs/assets/note.html');
  });

  it('a missing public path is not silently skipped: the run fails', () => {
    rmSync(join(repo, 'backtest', 'cases.json'));
    const r = run(['--with-public']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/backtest\/cases\.json/);
  });

  it('a reviewed allow-list entry (file|text) works for a public file too, and for no other file', () => {
    writeFileSync(join(repo, 'docs', 'guide.md'), `key ${KEY}`);
    writeFileSync(join(repo, 'allow.txt'), `docs/guide.md|${KEY}\n`);
    expect(run(['--with-public']).status).toBe(0);
    writeFileSync(join(repo, 'README.md'), `key ${KEY}`);
    expect(run(['--with-public']).status).toBe(1);
  });

  it('the repository\'s own docs, README and backtest/cases.json hold no credential-shaped string today', () => {
    const r = spawnSync('node', [SCRIPT, '--public-only', '--repo', ROOT, '--allow', resolve(ROOT, 'scripts/dist-scan-allow.txt')], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});

describe('TC-R18-NF-3-03: no script is loaded from another origin', () => {
  it.each([
    ['an absolute https source', '<script src="https://cdn.example.test/lib.js"></script>'],
    ['an absolute http source', "<script src='http://cdn.example.test/lib.js'></script>"],
    ['a protocol-relative source', '<script type="module" crossorigin src="//cdn.example.test/lib.js"></script>'],
    ['an unquoted source', '<script src=https://cdn.example.test/lib.js></script>'],
    ['an uppercase tag', '<SCRIPT SRC="https://cdn.example.test/lib.js"></SCRIPT>'],
  ])('%s in a built page fails and names the page', (_n, tag) => {
    writeFileSync(join(repo, 'dist', 'index.html'), `<html>${tag}</html>`);
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/third-party script/i);
    expect(r.stderr).toContain('index.html');
    expect(r.stderr).not.toContain('cdn.example.test');
  });

  it('own relative sources and plain mentions of a URL in text do not fail', () => {
    writeFileSync(join(repo, 'dist', 'index.html'), '<html><p>see https://docs.ollama.com/faq</p><script type="module" src="./assets/index.js"></script><a href="https://x.test/">x</a></html>');
    expect(run().status).toBe(0);
  });

  it('every page of the real index.html names only relative sources', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
    for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)) expect(m[1]).toMatch(/^\//);
    expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=\s*["']?(https?:)?\/\/[^/]/i);
  });
});

describe('TC-R18-MS-8-02: the confidentiality word list is held outside the repository and applied by the same scan', () => {
  const WORD = 'zzcodename';
  function list(text: string) {
    const f = join(repo, '..', `wordlist-${process.pid}.txt`);
    writeFileSync(f, text);
    return f;
  }

  it('a listed word in a shipped file is a hit; the log names the file and the list line, not the word', () => {
    writeFileSync(join(repo, 'dist', 'assets', 'index.js'), `var a = "the ${WORD.toUpperCase()} project";`);
    const f = list(`# comment\n\n${WORD}\n`);
    const r = run(['--wordlist', f]);
    rmSync(f);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('assets/index.js');
    expect(r.stderr).toMatch(/word list line 3/);
    expect(r.stdout + r.stderr).not.toMatch(new RegExp(WORD, 'i'));
  });

  it('applies to docs, README and cases.json with --with-public', () => {
    writeFileSync(join(repo, 'README.md'), `about ${WORD}`);
    const f = list(`${WORD}\n`);
    const r = run(['--with-public', '--wordlist', f]);
    rmSync(f);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('README.md');
  });

  it('a clean build passes with a list, and says the list was applied', () => {
    const f = list(`${WORD}\n`);
    const r = run(['--with-public', '--wordlist', f]);
    rmSync(f);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/word list applied/i);
  });

  it('a release run fails closed when the list is missing; an ordinary run says it was not applied', () => {
    const missing = join(tmpdir(), 'no-such-wordlist.txt');
    const rel = run(['--release', '--wordlist', missing]);
    expect(rel.status).toBe(2);
    expect(rel.stderr).toMatch(/word list/i);
    const relNone = run(['--release']);
    expect(relNone.status).toBe(2);
    const ordinary = run(['--wordlist', missing]);
    expect(ordinary.status).toBe(0);
    expect(ordinary.stdout).toMatch(/word list not applied/i);
  });

  it('the list can be named by an environment variable, so the local ritual need not retype a path', () => {
    writeFileSync(join(repo, 'dist', 'assets', 'index.js'), `var a = "${WORD}";`);
    const f = list(`${WORD}\n`);
    const r = run([], { COUNTERPOISE_WORDLIST: f });
    rmSync(f);
    expect(r.status).toBe(1);
  });

  it('the corpus holds exactly 31 cases', () => {
    const corpus = JSON.parse(readFileSync(resolve(ROOT, 'backtest/cases.json'), 'utf8')) as { cases: unknown[] };
    expect(corpus.cases).toHaveLength(31);
  });
});

describe('TC-R18-PS-5-01: both workflows run the scan after the build, before anything is published', () => {
  const ci = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const deploy = readFileSync(resolve(ROOT, '.github/workflows/deploy-pages.yml'), 'utf8');

  it('ci.yml runs npm run scan:dist after npm run build', () => {
    expect(ci.indexOf('npm run build')).toBeGreaterThan(-1);
    expect(ci.indexOf('npm run scan:dist')).toBeGreaterThan(ci.indexOf('npm run build'));
  });

  it('deploy-pages.yml runs npm run scan:dist after npm run build and before the artifact is uploaded', () => {
    const build = deploy.indexOf('npm run build');
    const scan = deploy.indexOf('npm run scan:dist');
    expect(build).toBeGreaterThan(-1);
    expect(scan).toBeGreaterThan(build);
    expect(deploy.indexOf('upload-pages-artifact')).toBeGreaterThan(scan);
  });

  it('the npm script scans the public files as well as dist/', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['scan:dist']).toContain('--with-public');
  });
});
