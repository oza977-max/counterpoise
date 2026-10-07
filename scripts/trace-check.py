#!/usr/bin/env python3
"""Traceability check: every test case ID in test-cases/*.md must be proved
by a test that names it.

Counterpoise sells auditability, so "every obligation is traceable" is a product
claim, not a bookkeeping nicety. This makes the claim mechanical:

  1. Collect every TC-* id defined in test-cases/test-cases*.md, whether as a
     `### TC-...` heading (round 1-4 format), a `| TC-... |` table row
     (round 5+ format), or a range/wildcard table row that names a whole
     family of cases on one line (see RANGE_DOT / RANGE_LETTER / WILDCARD
     below — every form in use today is expanded, not skipped).
  2. A case is TRACED when its id appears in at least one test file under
     src/ (a describe/it name or a comment naming it), matched with a left
     AND right word boundary so TC-PE-1-01 is not satisfied by TC-PE-1-010,
     TC-PE-1-01a, or a longer id it happens to be a substring of.
  3. Every path on a `[Trace: <path>; <path>; ...]` line must point at a
     file that exists — every path, not just the first.
  4. Any `| TC-...` row that none of the above patterns can parse is printed
     as a WARNING rather than silently skipped.

Exit 1 if any case is untraced or any trace path is dangling (warnings do
not fail the build — they flag a row this script does not yet understand).
Cases that are deliberately not built are listed in DEFERRED with the
reason; they are reported, never silently skipped.

A test-cases file written ahead of its build carries a line `Status: PENDING BUILD`
near the top. Its ids are reported as PENDING (counted, listed, never failed) until
the build round removes the line; from then on every id needs a named test as usual.
`[Trace: not-yet-traced]` (no impact-map to trace through) is not a file path and is skipped.

A case whose behaviour was intentionally replaced by a later requirement is
listed in a `## Superseded` section of a test-cases file, as a table row
`| TC-... | <reason, naming what replaced it> |`. It no longer needs a test,
but it is printed as SUPERSEDED with its reason on every run — retired in the
open, never dropped silently. A superseded row without a reason is an error.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Cases whose criterion describes something deliberately not built. Each needs
# a reason a reader can check. Empty is the goal.
DEFERRED: dict[str, str] = {}

ID = r"TC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+"
HEADING = re.compile(r"^###\s+(" + ID + ")", re.M)
TABLE_ROW = re.compile(r"^\|\s*(" + ID + r")\s*\|", re.M)

# A [Trace: ...] line names one or more paths separated by "; ", optionally
# followed by an em-dash comment (e.g. `[Trace: a.ts — "why"]`). Capture the
# whole path list — up to "]" or "—", never across a newline — then split it
# on ";" so every path is validated, not just the first.
TRACE_LINE = re.compile(r"^\[Trace:\s*([^\]\n—]+)", re.M)

# Range / wildcard notations let one table row name a whole family of cases
# instead of one row per case. All three are anchored to a full table row
# (`^\|...\|`) so they never fire on an ordinary bare-id row, and each is
# built from the literal forms in use today in test-cases/*.md:
#   TC-R11-MG-1..5                        -> RANGE_DOT (plain)
#   TC-R11-MG-1a-1..5                     -> RANGE_DOT (prefix itself ends in a range)
#   TC-R10-CM-1-01..-10 (11 tests incl. -03b) -> RANGE_DOT (with named extra(s))
#   TC-R5-GR-4-01a/b … -06                -> RANGE_LETTER (lettered sub-cases)
#   TC-R11-KL-*                           -> WILDCARD (prefix-only)
RANGE_DOT = re.compile(
    r"^\|\s*(TC-[A-Za-z0-9-]+-)(\d+)\.\.-?(\d+)"
    r"(?:\s*\(\d+\s+tests?\s+incl\.\s+(-[A-Za-z0-9]+(?:,\s*-[A-Za-z0-9]+)*)\))?"
    r"\s*\|",
    re.M,
)
RANGE_LETTER = re.compile(
    r"^\|\s*(TC-[A-Za-z0-9-]+-)(\d+)[a-z]/[a-z]\s*(?:…|\.\.\.)\s*-(\d+)\s*\|", re.M
)
WILDCARD = re.compile(r"^\|\s*(TC-[A-Za-z0-9-]+-)\*\s*\|", re.M)
ANY_TC_ROW = re.compile(r"^\|\s*TC-.*$", re.M)
PENDING_MARKER = re.compile(r"^Status:\s*PENDING BUILD\b", re.M)
SUPERSEDED_SECTION = re.compile(r"^## Superseded[^\n]*\n(.*?)(?=^## |\Z)", re.M | re.S)
SUPERSEDED_ROW = re.compile(r"^\|\s*(" + ID + r")\s*\|\s*([^|\n]*?)\s*\|", re.M)


def expand_range_dot(m: "re.Match[str]") -> list[str]:
    prefix, start, end, extras = m.group(1), m.group(2), m.group(3), m.group(4)
    width = len(start)
    ids = [f"{prefix}{str(n).zfill(width)}" for n in range(int(start), int(end) + 1)]
    if extras:
        ids += [f"{prefix}{e.strip().lstrip('-')}" for e in extras.split(",")]
    return ids


def expand_range_letter(m: "re.Match[str]") -> list[str]:
    prefix, start, end = m.group(1), m.group(2), m.group(3)
    width = len(start)
    return [f"{prefix}{str(n).zfill(width)}" for n in range(int(start), int(end) + 1)]


def is_traced(tc: str, mode: str, test_text: str) -> bool:
    """mode 'exact': tc must appear whole, on both sides. 'letter-suffix': tc
    may be followed by exactly one lowercase letter (the 01/01a/01b case).
    'prefix': tc (wildcard row, trailing '*' stripped) may be followed by
    anything — satisfied by any test naming an id with that prefix."""
    left = r"(?<![A-Za-z0-9])"
    if mode == "prefix":
        pattern = left + re.escape(tc.rstrip("*"))
    elif mode == "letter-suffix":
        pattern = left + re.escape(tc) + r"[a-z]?(?![A-Za-z0-9])"
    else:
        pattern = left + re.escape(tc) + r"(?![A-Za-z0-9])"
    return re.search(pattern, test_text) is not None


def main() -> int:
    case_files = sorted((ROOT / "test-cases").glob("test-cases*.md"))
    defined: dict[str, tuple[str, str]] = {}  # id -> (source file, check mode)
    pending_files: set[str] = set()  # files marked "Status: PENDING BUILD"
    dangling: list[str] = []
    expansions: list[str] = []
    warnings: list[str] = []
    superseded: dict[str, str] = {}  # id -> "reason (file)"
    bad_superseded: list[str] = []

    for f in case_files:
        text = f.read_text(encoding="utf-8")
        if PENDING_MARKER.search(text):
            pending_files.add(f.name)
        for sec in SUPERSEDED_SECTION.finditer(text):
            for row in SUPERSEDED_ROW.finditer(sec.group(1)):
                tc, why = row.group(1), row.group(2).strip()
                if not why:
                    bad_superseded.append(f"{f.name}: {tc} is listed as superseded with no reason")
                superseded[tc] = f"{why} ({f.name})"
        consumed: set[int] = set()  # start offsets of rows already accounted for

        for m in HEADING.finditer(text):
            defined.setdefault(m.group(1), (f.name, "exact"))

        for m in RANGE_DOT.finditer(text):
            ids = expand_range_dot(m)
            for tc in ids:
                defined.setdefault(tc, (f.name, "exact"))
            extra = m.group(4)
            note = f" (+ named extra: {extra})" if extra else ""
            expansions.append(
                f"{f.name}: {m.group(1)}{m.group(2)}..{m.group(3)}{note} -> {len(ids)} cases"
            )
            consumed.add(m.start())

        for m in RANGE_LETTER.finditer(text):
            ids = expand_range_letter(m)
            for tc in ids:
                defined.setdefault(tc, (f.name, "letter-suffix"))
            expansions.append(
                f"{f.name}: {m.group(1)}{m.group(2)}a/b … -{m.group(3)} "
                f"-> {len(ids)} cases (letter-suffix, each may carry a/b/c sub-tests)"
            )
            consumed.add(m.start())

        for m in WILDCARD.finditer(text):
            tc = f"{m.group(1)}*"
            defined.setdefault(tc, (f.name, "prefix"))
            expansions.append(f"{f.name}: {tc} -> prefix check ({m.group(1)})")
            consumed.add(m.start())

        for m in TABLE_ROW.finditer(text):
            defined.setdefault(m.group(1), (f.name, "exact"))
            consumed.add(m.start())

        for m in ANY_TC_ROW.finditer(text):
            if m.start() not in consumed:
                warnings.append(f"{f.name}: unparsed row: {m.group(0).strip()}")

        for m in TRACE_LINE.finditer(text):
            for raw in m.group(1).split(";"):
                path = raw.strip().rstrip(",;:")
                if not path or path == "not-yet-traced":
                    continue
                if not (ROOT / path).exists():
                    dangling.append(f"{f.name}: [Trace: {path}] — file does not exist")

    test_text = "\n".join(
        p.read_text(encoding="utf-8")
        for p in (ROOT / "src").rglob("*")
        if p.is_file() and re.search(r"\.test\.tsx?$", p.name)
    )

    untraced = []
    pending: list[str] = []
    for tc, (src, mode) in sorted(defined.items()):
        if tc in DEFERRED or tc in superseded:
            continue
        if not is_traced(tc, mode, test_text):
            if src in pending_files:
                pending.append(tc)
            else:
                untraced.append(f"{tc}  ({src})")

    retired = len([tc for tc in defined if tc in superseded and tc not in DEFERRED])
    traced = len(defined) - len(untraced) - len(pending) - len(DEFERRED) - retired
    print(f"trace-check: {len(defined)} test cases across {len(case_files)} files")
    print(f"  traced to a named test: {traced}")
    if expansions:
        print("  range/wildcard rows expanded:")
        for e in expansions:
            print(f"    {e}")
    for tc, why in sorted(DEFERRED.items()):
        print(f"  DEFERRED {tc}: {why}")
    for tc, why in sorted(superseded.items()):
        print(f"  SUPERSEDED {tc}: {why}")
    for b in bad_superseded:
        print(f"  ERROR {b}")
    for f_name in sorted(pending_files):
        n = len([t for t in pending if defined[t][0] == f_name])
        print(f"  PENDING BUILD {f_name}: {n} cases not yet built (reported, not failed)")
    for u in untraced:
        print(f"  UNTRACED {u}")
    for d in dangling:
        print(f"  DANGLING {d}")
    for w in warnings:
        print(f"  WARNING {w}")
    if untraced or dangling or bad_superseded:
        return 1
    print("trace-check: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
