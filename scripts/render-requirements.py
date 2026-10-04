#!/usr/bin/env python3
"""Render requirements/requirements-NNN.md -> requirements-NNN.html (usage: render-requirements.py NNN "Subtitle" "Round N · date").

Exists because this repo's .md/.html twins have drifted three times when edited
by hand (RF-2). The HTML for round 3 is generated, never hand-edited: edit the
markdown and re-run this script. spec-parity-check.py reads only .md and cannot
catch the drift, so the only durable fix is to remove the second author.
"""
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NNN = sys.argv[1] if len(sys.argv) > 1 else "003"
SUBTITLE = sys.argv[2] if len(sys.argv) > 2 else ""
META = sys.argv[3] if len(sys.argv) > 3 else ""
MD = ROOT / "requirements" / f"requirements-{NNN}.md"
HTML_OUT = ROOT / "requirements" / f"requirements-{NNN}.html"
CSS_SOURCE = ROOT / "requirements" / "requirements-002.html"

PRIORITY_CLASS = {"Must": "priority-must", "Should": "priority-should",
                  "Could": "priority-could", "Won't": "priority-wont"}


def inline(text: str) -> str:
    """Markdown inline -> HTML. Escape first, then re-introduce markup."""
    out = html.escape(text, quote=False)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", out)
    return out


def render(md: str) -> str:
    css_src = CSS_SOURCE.read_text()
    css = css_src[css_src.index("    <style>"):css_src.index("</style>") + len("</style>")]

    body: list[str] = []
    toc: list[str] = []
    lines = md.split("\n")
    i = 0
    in_req = False

    in_section = False

    def close_req():
        nonlocal in_req
        if in_req:
            body.append("                    </div>")
            in_req = False

    def close_section():
        nonlocal in_section
        close_req()
        if in_section:
            body.append("            </section>")
            in_section = False

    while i < len(lines):
        line = lines[i]

        m = re.match(r"^\*\*(R\d+-[A-Z]+-\d+) \((Must|Should|Could|Won't)\):\*\*\s*(.*)", line)
        if m:
            close_req()
            rid, pri, first = m.groups()
            text = [first]
            i += 1
            while i < len(lines) and lines[i].strip() and not lines[i].startswith(">") \
                    and not re.match(r"^\*\*R\d+-", lines[i]) and not lines[i].startswith("#"):
                text.append(lines[i])
                i += 1
            body.append(f'''                    <div class="requirement">
                        <div class="requirement-header">
                            <span class="req-id">{rid}</span>
                            <span class="priority-chip {PRIORITY_CLASS[pri]}">{pri}</span>
                        </div>
                        <p class="requirement-text">{inline(" ".join(t.strip() for t in text))}</p>''')
            in_req = True
            continue

        if line.startswith("> "):
            quote = []
            while i < len(lines) and lines[i].startswith(">"):
                quote.append(lines[i].lstrip(">").strip())
                i += 1
            joined = " ".join(q for q in quote if q)
            joined = re.sub(r"^Fit criterion:\s*", "", joined)
            body.append(f'                        <div class="fit-criterion">{inline(joined)}</div>')
            continue

        if line.startswith("## "):
            close_section()
            title = line[3:].strip()
            anchor = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40]
            if not title.startswith("Counterpoise"):
                toc.append(f'                <li><a href="#{anchor}">{inline(title)}</a></li>')
                body.append(f'            <section id="{anchor}">\n                <h2>{inline(title)}</h2>')
                in_section = True
            i += 1
            continue

        if line.startswith("### "):
            close_req()
            title = line[4:].strip()
            anchor = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40]
            body.append(f'                <h3 id="{anchor}">{inline(title)}</h3>')
            i += 1
            continue

        if line.startswith("|"):
            close_req()
            tbl = []
            while i < len(lines) and lines[i].startswith("|"):
                tbl.append(lines[i])
                i += 1
            cells = [[c.strip() for c in r.strip("|").split("|")] for r in tbl]
            head, rows = cells[0], [r for r in cells[2:]]
            body.append("                <table>\n                    <thead><tr>"
                        + "".join(f"<th>{inline(h)}</th>" for h in head) + "</tr></thead>\n                    <tbody>")
            for r in rows:
                body.append("                        <tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>")
            body.append("                    </tbody>\n                </table>")
            continue

        if line.startswith("- "):
            close_req()
            items = []
            while i < len(lines) and (lines[i].startswith("- ") or lines[i].startswith("  ")):
                if lines[i].startswith("- "):
                    items.append(lines[i][2:].strip())
                elif items:
                    items[-1] += " " + lines[i].strip()
                i += 1
            body.append("                <ul>" + "".join(f"<li>{inline(it)}</li>" for it in items) + "</ul>")
            continue

        if re.match(r"^\d+\. ", line):
            close_req()
            items = []
            while i < len(lines) and (re.match(r"^\d+\. ", lines[i]) or lines[i].startswith("   ")):
                if re.match(r"^\d+\. ", lines[i]):
                    items.append(re.sub(r"^\d+\.\s*", "", lines[i]).strip())
                elif items:
                    items[-1] += " " + lines[i].strip()
                i += 1
            body.append("                <ol>" + "".join(f"<li>{inline(it)}</li>" for it in items) + "</ol>")
            continue

        if line.strip() and not line.startswith("#") and line.strip() != "---":
            para = [line]
            i += 1
            while i < len(lines) and lines[i].strip() and not lines[i].startswith(("#", ">", "|", "- ")) and not re.match(r"^\*\*R\d+-", lines[i]) \
                    and not re.match(r"^\d+\. ", lines[i]) and lines[i].strip() != "---":
                para.append(lines[i])
                i += 1
            joined = " ".join(p.strip() for p in para)
            if in_req:
                body.append(f"                        <p>{inline(joined)}</p>")
            else:
                body.append(f"                <p>{inline(joined)}</p>")
            continue

        i += 1

    close_section()
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Round {NNN} &middot; Counterpoise &mdash; Requirements</title>
{css}
</head>
<body>
    <div class="container">
        <nav class="toc-nav">
            <h3>Contents</h3>
            <ul>
{chr(10).join(toc)}
            </ul>
        </nav>
        <main>
            <header>
                <h1>Counterpoise &mdash; Requirements, Round {int(NNN)}</h1>
                <p class="subtitle">{html.escape(SUBTITLE)}</p>
                <p class="meta">{html.escape(META)} &middot; Generated from requirements-{NNN}.md &mdash; do not hand-edit</p>
            </header>
{chr(10).join(body)}
        </main>
    </div>
</body>
</html>
"""


if __name__ == "__main__":
    HTML_OUT.write_text(render(MD.read_text()))
    print(f"rendered {MD.name} -> {HTML_OUT.name}")
    sys.exit(0)
