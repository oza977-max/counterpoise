// R18-G (specs/intake-flow.md §27.9). The Content-Security-Policy added to the BUILT page as a <meta>:
// only the directives that need no model address.
//   script-src 'self'  - no inline script, no script from another origin
//   object-src 'none'  - no plug-in content
//   base-uri 'none'    - no <base> to redirect relative paths
//   form-action 'none' - no form can post anywhere
// NOT set, on purpose: connect-src (the firm server's address is the person's own, so it cannot be narrowed)
// and frame-ancestors (a browser ignores it in a <meta>). Added by vite.config.ts at build time only, because
// the dev server injects an inline script. Adopted after a check that the built app runs from dist/ over http
// (vite preview), recorded in build/handovers/R18-G.md.

export const CSP_DIRECTIVES = ["script-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"] as const;
export const CSP_CONTENT = CSP_DIRECTIVES.join('; ');
export const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CSP_CONTENT}" />`;
