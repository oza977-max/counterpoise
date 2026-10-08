import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// R18-A skeleton of the public-site dist scan (specs/intake-flow.md §27.9):
// anchored key patterns with length minimums, a reviewed allow-list, a
// non-zero exit on a hit. R18-G hardens it; this pins what A promises.

const SCRIPT = resolve(__dirname, '../scripts/scan-dist.mjs');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scan-dist-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function scan(allowText?: string) {
  const args = [SCRIPT, join(dir, 'dist')];
  if (allowText !== undefined) {
    writeFileSync(join(dir, 'allow.txt'), allowText);
    args.push('--allow', join(dir, 'allow.txt'));
  } else {
    writeFileSync(join(dir, 'allow.txt'), '');
    args.push('--allow', join(dir, 'allow.txt'));
  }
  return spawnSync('node', args, { encoding: 'utf8' });
}

function put(name: string, text: string) {
  mkdirSync(join(dir, 'dist', 'assets'), { recursive: true });
  writeFileSync(join(dir, 'dist', name), text);
}

describe('scripts/scan-dist.mjs (R18-A skeleton)', () => {
  it('passes on a clean build and says so', () => {
    put('index.html', '<html>nothing secret; Bearer is just a word; ' + 'a'.repeat(64) + '</html>');
    const r = scan();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no secrets found/i);
  });

  it.each([
    ['an Anthropic-style key', 'sk-ant-' + 'A1b2C3d4E5f6G7h8I9j0_-'],
    ['an OpenAI-style key', 'sk-' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6'],
    ['a GitHub token', 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5'],
    ['a fine-grained GitHub token', 'github_pat_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5'],
    ['an AWS access key id', 'AKIA' + 'ABCDEFGHIJKLMNOP'],
    ['a Google API key', 'AIza' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R'],
    ['a Slack token', 'xoxb-' + '1234567890-abc'],
    ['a private key block', '-----BEGIN RSA PRIVATE KEY-----'],
    ['a JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz'],
  ])('fails (non-zero) on %s and names the file', (_what, secret) => {
    put('assets/app.js', `var x = "${secret}";`);
    const r = scan();
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/assets\/app\.js/);
    // R18-A review m11: the log names the pattern, the file and the length of the match, and
    // carries no character of the hit itself (not even a prefix).
    expect(r.stderr).toContain(`(${secret.length} characters)`);
    expect(r.stdout + r.stderr).not.toContain(secret.slice(0, 6));
  });

  it('does not match a too-short look-alike (length minimums are part of the pattern)', () => {
    put('assets/app.js', 'sk-ant-short ghp_short AKIAshort');
    expect(scan().status).toBe(0);
  });

  it('a reviewed allow-list entry (file|matched text) silences exactly that match', () => {
    const secret = 'sk-ant-' + 'A1b2C3d4E5f6G7h8I9j0_-';
    put('assets/vendor.js', `var x = "${secret}";`);
    expect(scan(`# reviewed benign\nassets/vendor.js|${secret}\n`).status).toBe(0);
    put('assets/other.js', `var y = "${secret}";`);
    expect(scan(`assets/vendor.js|${secret}\n`).status).not.toBe(0);
  });
});
