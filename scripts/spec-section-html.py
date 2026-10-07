#!/usr/bin/env python3
"""Splice a Markdown section of a spec into its hand-edited HTML twin, deterministically.

Usage (repo root):
    python3 scripts/spec-section-html.py <spec> <md-start-heading> <md-end-marker|-> <html-start-h2-text> [<html-end-marker|->]
Replaces the HTML from the <h2> whose text starts with <html-start-h2-text> up to the next <h2>
(or the end marker) with the HTML rendering of the Markdown from <md-start-heading> up to
<md-end-marker>. Also replaces every changelog row dated 2026-10-07 with the Markdown's rows.
Exists because the twins drift when edited by hand and a model-written twin dropped content
(design review 008). Renders only the constructs the specs use: #/##/### headings, paragraphs,
bullet and numbered lists (with continuation lines), tables, code fences, blockquotes, rules,
inline `code`, **bold**, *italic*, links.
"""
import html, importlib.util, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("tch", ROOT / "scripts" / "test-cases-html.py")
tch = importlib.util.module_from_spec(spec); spec.loader.exec_module(tch)
inline, split_row, slug = tch.inline, tch.split_row, tch.slug


def render(md: str, id_prefix: str) -> str:
    lines = md.split("\n"); out = []; i = 0; n = len(lines); para = []; used = set()
    def flush():
        nonlocal para
        if para:
            out.append("    <p>" + inline(" ".join(x.strip() for x in para)) + "</p>"); para = []
    while i < n:
        line = lines[i]; s = line.strip()
        if not s: flush(); i += 1; continue
        if s.startswith("```"):
            flush(); lang = s[3:].strip(); i += 1; buf = []
            while i < n and not lines[i].strip().startswith("```"): buf.append(lines[i]); i += 1
            i += 1
            cls = f' class="language-{lang}"' if lang else ""
            out.append(f"    <pre><code{cls}>" + html.escape("\n".join(buf), quote=False) + "</code></pre>"); continue
        m = re.match(r"^(#{2,4}) (.*)$", s)
        if m:
            flush(); lvl = len(m.group(1)); text = m.group(2)
            sid = slug(id_prefix + " " + text, used)
            out.append(f'    <h{lvl} id="{sid}">{inline(text)}</h{lvl}>'); i += 1; continue
        if re.fullmatch(r"-{3,}", s): flush(); out.append("    <hr>"); i += 1; continue
        if s.startswith(">"):
            flush(); buf = []
            while i < n and lines[i].strip().startswith(">"): buf.append(lines[i].strip().lstrip(">").strip()); i += 1
            out.append("    <blockquote><p>" + inline(" ".join(buf)) + "</p></blockquote>"); continue
        if s.startswith("|"):
            flush(); rows = []
            while i < n and lines[i].strip().startswith("|"): rows.append(lines[i]); i += 1
            header = split_row(rows[0])
            body = [r for r in rows[1:] if not re.fullmatch(r"\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?", r.strip())]
            out.append("    <table>\n      <thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in header) + "</tr></thead>\n      <tbody>")
            for r in body: out.append("        <tr>" + "".join(f"<td>{inline(c)}</td>" for c in split_row(r)) + "</tr>")
            out.append("      </tbody>\n    </table>"); continue
        bm = re.match(r"^\s*([-*]) ", line); nm = re.match(r"^\s*(\d+)\. ", line)
        if bm or nm:
            flush(); items = []; tag = "ul" if bm else "ol"; pat = r"^\s*[-*] " if bm else r"^\s*\d+\. "
            while i < n:
                l = lines[i]
                if re.match(pat, l): items.append(re.sub(pat, "", l).strip())
                elif l.strip() and (l.startswith("  ") or l.startswith("\t")) and items and not re.match(r"^\s*([-*]|\d+\.) ", l): items[-1] += " " + l.strip()
                else: break
                i += 1
            out.append(f"    <{tag}>\n" + "\n".join(f"      <li>{inline(t)}</li>" for t in items) + f"\n    </{tag}>"); continue
        para.append(line); i += 1
    flush()
    return "\n".join(out) + "\n"


def md_rows(md: str) -> list[str]:
    return [l for l in md.split("\n") if l.startswith("| 2026-10-07 |") or re.match(r"^\| \d+\.\d+ \| 2026-10-07 \|", l)]


def main():
    name, md_start, md_end, h_start = sys.argv[1:5]
    h_end = sys.argv[5] if len(sys.argv) > 5 else "-"
    md = (ROOT / "specs" / f"{name}.md").read_text(encoding="utf-8")
    i = md.index(md_start)
    j = len(md) if md_end == "-" else md.index(md_end, i)
    frag = md[i:j]
    # strip the section's own h2 line for rendering as h2 with a stable id
    first, _, rest = frag.partition("\n")
    h2_text = first.lstrip("# ").strip()
    prefix = re.match(r"(\d+\w*)", h2_text).group(1) if re.match(r"\d", h2_text) else "r18"
    body = render(rest, "r18-" + prefix)
    new_html = f'    <h2 id="r18-{slug(prefix, set())}">{inline(h2_text)}</h2>\n' + body
    p = ROOT / "specs" / f"{name}.html"; h = p.read_text(encoding="utf-8")
    m = re.search(r'^[ \t]*<h[23][^>]*>\s*' + re.escape(h_start), h, re.M)
    if not m: sys.exit("html start heading not found: " + h_start)
    a = m.start()
    if h_end == "-":
        b = h.index("</main>", a)
        tail = h[b:]
        # keep a trailing attribution paragraph if present immediately before </main>
        am = re.search(r'\n[ \t]*<p class="gvm-attribution">.*?</p>\s*$', h[a:b], re.S)
        keep = am.group(0).lstrip("\n") if am else ""
        h = h[:a] + new_html + ("    " + keep.strip() + "\n" if keep else "") + tail
    else:
        b = re.search(r'^[ \t]*<h2[^>]*>\s*' + re.escape(h_end), h[a + 5:], re.M).start() + a + 5
        h = h[:a] + new_html + "\n" + h[b:]
    # changelog rows
    rows = md_rows(md)
    h = re.sub(r"[ \t]*<tr>(?:(?!</tr>).)*2026-10-07(?:(?!</tr>).)*</tr>\n", "", h, flags=re.S)
    cm = re.search(r'<h2 id="changelog[^"]*">.*?<tbody>\n', h, re.S)
    if cm and rows:
        ins = ""
        for r in rows:
            cells = split_row(r)
            ins += "        <tr>" + "".join(f"<td>{inline(c)}</td>" for c in cells) + "</tr>\n"
        h = h[:cm.end()] + ins + h[cm.end():]
    p.write_text(h, encoding="utf-8")
    print(f"{name}.html: spliced {len(frag.splitlines())} md lines, {len(rows)} changelog rows")

main()
