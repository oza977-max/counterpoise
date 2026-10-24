#!/usr/bin/env node
// scan-dist — fails the build if the built site (dist/) contains something that
// looks like a credential, or a script loaded from another origin. R18-A skeleton,
// hardened in R18-G (specs/intake-flow.md §27.9): anchored patterns with length minimums,
// a reviewed allow-list, a non-zero exit on a hit; the same pattern scan over the
// repository's other public files (docs/, README.md and backtest/cases.json); a hit
// for any <script src> that names another origin; and an optional confidentiality word
// list held OUTSIDE the repository.
//
// Usage: node scripts/scan-dist.mjs [dir=dist] [--allow FILE] [--with-public] [--public-only]
//          [--repo DIR] [--wordlist FILE] [--release]
//   --with-public  also scan docs/, README.md and backtest/cases.json (relative to --repo,
//                  default: the repository this script is in)
//   --public-only  scan only those public files (no dist/)
//   --wordlist     one term per line, '#' starts a comment; a case-insensitive substring
//                  match in any scanned file is a hit. The log names the file and the
//                  line of the list, never the word. Also read from COUNTERPOISE_WORDLIST.
//   --release      the word list is required: without one the run fails closed (exit 2)
// Exit: 0 clean, 1 a hit, 2 something to scan or a required list is missing.
//
// Deliberately NOT patterns: a bare "Bearer" and a bare 64-hex string — they match
// the SDK's own header code and the policy file's hashes.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PATTERNS = [
  ['Anthropic-style key', /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ['OpenAI-style key', /sk-[A-Za-z0-9]{32,}/g],
  ['GitHub token', /ghp_[A-Za-z0-9]{30,}/g],
  ['GitHub fine-grained token', /github_pat_[A-Za-z0-9_]{30,}/g],
  ['AWS access key id', /AKIA[0-9A-Z]{16}/g],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/g],
  ['Slack token', /xox[bap]-[0-9A-Za-z-]{10,}/g],
  ['Private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['JWT', /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Allow-list lines are `relative/path|exact matched text`; `#` starts a comment. */
function readAllow(file) {
  if (!file || !existsSync(file)) return new Set();
  return new Set(
    readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#')),
  );
}

export const PUBLIC_FILES_NOTE = 'docs/, README.md and backtest/cases.json';

/** Third-party script: a <script> whose src is absolute or protocol-relative (the build uses relative paths only). */
const THIRD_PARTY_SCRIPT = /<script\b[^>]*?\bsrc\s*=\s*["']?(?:https?:)?\/\/[^"'\s>]+/gi;

/** The files to scan under one root, as [absolute path, name shown in the log]. */
function filesUnder(root, shownPrefix = '') {
  return walk(root).map((file) => [file, shownPrefix + relative(root, file).split('\\').join('/')]);
}

/** The public files outside dist/: docs/ (recursive), README.md, backtest/cases.json. Throws if one is missing. */
export function publicFiles(repo) {
  const out = [];
  const docs = join(repo, 'docs');
  if (!existsSync(docs)) throw new Error('docs/ does not exist');
  out.push(...filesUnder(docs, 'docs/'));
  for (const name of ['README.md', 'backtest/cases.json']) {
    const full = join(repo, name);
    if (!existsSync(full)) throw new Error(`${name} does not exist`);
    out.push([full, name]);
  }
  return out;
}

/** Word-list terms with the list line each came from (1-based). */
export function readWordList(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l, i) => [l.trim(), i + 1])
    .filter(([l]) => l !== '' && !l.startsWith('#'))
    .map(([term, line]) => ({ term: term.toLowerCase(), line }));
}

/** Scan [file, shownName] pairs. `words` is the parsed word list or null. */
export function scanFiles(files, allow, words = null) {
  const hits = [];
  for (const [file, rel] of files) {
    // latin1 reads every byte, so a binary asset cannot throw; the patterns are ASCII.
    const text = readFileSync(file, 'latin1');
    for (const [label, re] of PATTERNS) {
      for (const m of text.matchAll(re)) {
        if (allow.has(`${rel}|${m[0]}`)) continue;
        hits.push({ file: rel, label, length: m[0].length });
      }
    }
    if (/\.html?$/i.test(rel)) {
      for (const m of text.matchAll(THIRD_PARTY_SCRIPT)) hits.push({ file: rel, label: 'third-party script source', length: m[0].length });
    }
    if (words !== null && words.length > 0) {
      const lower = readFileSync(file, 'utf8').toLowerCase();
      for (const { term, line } of words) {
        if (lower.includes(term)) hits.push({ file: rel, label: `word list line ${line}`, length: term.length });
      }
    }
  }
  return hits;
}

/** Kept for callers of the skeleton: scan one directory. */
export function scan(root, allow, words = null) {
  return scanFiles(filesUnder(root), allow, words);
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const take = (flag) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args.splice(at, 2)[1] : undefined;
  };
  const flag = (name) => {
    const at = args.indexOf(name);
    if (at < 0) return false;
    args.splice(at, 1);
    return true;
  };
  const allowFile = take('--allow') ?? join(here, 'dist-scan-allow.txt');
  const repo = resolve(take('--repo') ?? join(here, '..'));
  const wordlistArg = take('--wordlist') ?? process.env.COUNTERPOISE_WORDLIST;
  const withPublic = flag('--with-public');
  const publicOnly = flag('--public-only');
  const release = flag('--release');
  const root = resolve(args[0] ?? join(repo, 'dist'));

  let words = null;
  if (wordlistArg && existsSync(wordlistArg)) words = readWordList(wordlistArg);
  if (release && words === null) {
    console.error('scan-dist: this is a release run and the confidentiality word list is missing (name it with --wordlist FILE or COUNTERPOISE_WORDLIST). Failing closed.');
    process.exit(2);
  }

  const files = [];
  if (!publicOnly) {
    if (!existsSync(root)) {
      console.error(`scan-dist: ${root} does not exist. Run the build first.`);
      process.exit(2);
    }
    files.push(...filesUnder(root));
  }
  if (withPublic || publicOnly) {
    try {
      files.push(...publicFiles(repo));
    } catch (e) {
      console.error(`scan-dist: ${e.message}. Nothing to scan means nothing was checked.`);
      process.exit(2);
    }
  }

  const hits = scanFiles(files, readAllow(allowFile), words);
  if (hits.length > 0) {
    for (const h of hits) {
      // The pattern's label, the file and the length of the match only: the log itself
      // (CI output is world-readable on a public repository) must carry no character of the hit.
      console.error(`scan-dist: ${h.label} in ${h.file} (${h.length} characters)`);
    }
    console.error(`scan-dist: ${hits.length} possible problem(s). Remove them, or review and list a benign one in scripts/dist-scan-allow.txt.`);
    process.exit(1);
  }
  const where = publicOnly ? PUBLIC_FILES_NOTE : withPublic ? `${root} and ${PUBLIC_FILES_NOTE}` : root;
  console.log(`scan-dist: no secrets found in ${where}.`);
  console.log(words !== null ? 'scan-dist: word list applied.' : 'scan-dist: word list not applied (a local release gate; name it with --wordlist or COUNTERPOISE_WORDLIST).');
}
