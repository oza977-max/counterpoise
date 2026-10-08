#!/usr/bin/env node
// scan-dist — fails the build if the built site (dist/) contains something that
// looks like a credential. R18-A skeleton (specs/intake-flow.md §27.9): anchored
// patterns with length minimums, a reviewed allow-list, a non-zero exit on a hit.
// R18-G hardens it and extends it to docs/, README.md and backtest/cases.json.
//
// Usage: node scripts/scan-dist.mjs [dir=dist] [--allow scripts/dist-scan-allow.txt]
//
// Deliberately NOT patterns: a bare "Bearer" and a bare 64-hex string — they match
// the SDK's own header code and the policy file's hashes. The confidentiality word
// list is held outside the repository and is a local release gate, not run here.
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

export function scan(root, allow) {
  const hits = [];
  for (const file of walk(root)) {
    const rel = relative(root, file).split('\\').join('/');
    // latin1 reads every byte, so a binary asset cannot throw; the patterns are ASCII.
    const text = readFileSync(file, 'latin1');
    for (const [label, re] of PATTERNS) {
      for (const m of text.matchAll(re)) {
        if (allow.has(`${rel}|${m[0]}`)) continue;
        hits.push({ file: rel, label, text: m[0] });
      }
    }
  }
  return hits;
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const allowAt = args.indexOf('--allow');
  const allowFile = allowAt >= 0 ? args.splice(allowAt, 2)[1] : join(here, 'dist-scan-allow.txt');
  const root = resolve(args[0] ?? 'dist');
  if (!existsSync(root)) {
    console.error(`scan-dist: ${root} does not exist. Run the build first.`);
    process.exit(2);
  }
  const hits = scan(root, readAllow(allowFile));
  if (hits.length > 0) {
    for (const h of hits) {
      // The pattern's label, the file and the length of the match only: the log itself
      // (CI output is world-readable on a public repository) must carry no character of the hit.
      console.error(`scan-dist: ${h.label} in ${h.file} (${h.text.length} characters)`);
    }
    console.error(`scan-dist: ${hits.length} possible secret(s). Remove them, or review and list a benign one in scripts/dist-scan-allow.txt.`);
    process.exit(1);
  }
  console.log(`scan-dist: no secrets found in ${root}.`);
}
