// R18-B (specs/intake-flow.md §27.4, DR8-R2-E-N1). Pure.
//
// Everything rendered from a description, a quote or a server-reported model
// name goes through this, so hidden or reordering characters cannot disguise
// what is on the screen: every control, format, private-use, surrogate and
// unassigned code point (Unicode Cc, Cf, Co, Cs, Cn — zero-width and
// bidirectional-override characters included) becomes a visible escape such as
// ⟦U+202E⟧. Line feed, carriage return and tab are kept so a multi-line
// description stays readable.

const HIDDEN = /^[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}]$/u;

export function visibleText(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch === '\n' || ch === '\r' || ch === '\t' || !HIDDEN.test(ch)) {
      out += ch;
    } else {
      out += `⟦U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟧`;
    }
  }
  return out;
}
