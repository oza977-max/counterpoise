import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CSP_DIRECTIVES, CSP_CONTENT, CSP_META } from './csp';

// R18-G, specs/intake-flow.md §27.9. A Content-Security-Policy <meta> for the directives that do NOT need
// the model address, adopted only after the built app was checked running from dist/ over http (vite preview).
// connect-src cannot be narrowed (the firm server's address is the person's own) and frame-ancestors is
// ignored in a meta tag; both limits are recorded here and in the handover.

const ROOT = resolve(__dirname, '..');

describe('the CSP meta (R18-G, §27.9)', () => {
  it('is exactly the four directives that need no model address', () => {
    expect(CSP_DIRECTIVES).toEqual(["script-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]);
    expect(CSP_CONTENT).toBe("script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
  });

  it('claims nothing it cannot enforce: no connect-src (any firm address), no frame-ancestors (not allowed in a meta), no unsafe-*', () => {
    expect(CSP_CONTENT).not.toMatch(/connect-src|frame-ancestors|unsafe-inline|unsafe-eval|default-src/);
  });

  it('is a well-formed http-equiv meta', () => {
    expect(CSP_META).toBe(`<meta http-equiv="Content-Security-Policy" content="${CSP_CONTENT}" />`);
  });

  it('is added to the BUILT page only: the dev server needs an inline script, so the source page stays without it', () => {
    const config = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/from '\.\/src\/csp'/);
    expect(config).toMatch(/apply:\s*'build'/);
    expect(config).toMatch(/transformIndexHtml/);
    expect(readFileSync(resolve(ROOT, 'index.html'), 'utf8')).not.toMatch(/Content-Security-Policy/i);
  });
});
