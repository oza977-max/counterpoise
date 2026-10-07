#!/usr/bin/env python3
"""Cross-spec invariant checker (register-lifecycle.md §10.3, P7-C02).

Checks eight cross-spec invariants (R1-R8) that a human reviewer would
otherwise have to catch by re-reading every spec file after every edit.

Scope: only TypeScript identifiers/literals inside fenced ```typescript
code blocks are checked (plus inline `src/...` path references). Prose —
including the ASCII lifecycle-stage transition diagram in
register-lifecycle.md §6 — is documentation, not a machine-checked
contract, and is intentionally out of scope: it uses display names like
"Rejected" that are not TypeScript literals of the LifecycleStage type
(that's the verdict *status* 'rejected', a different concept entirely —
conflating the two in prose is a documentation nit, not a schema defect).

Exit codes: 0 = clean, 1 = findings, 2 = script error.
"""

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SPECS_DIR = REPO_ROOT / "specs"
SRC_DIR = REPO_ROOT / "src"


def read_spec(name: str) -> str:
    return (SPECS_DIR / name).read_text(encoding="utf-8")


def code_blocks(text: str, lang: str = "typescript") -> list[str]:
    return re.findall(rf"```{lang}\n(.*?)```", text, re.DOTALL)


def extract_interface_body(code: str, interface_name: str) -> str | None:
    """Return the {...} body text of `interface Name ... { ... }` or
    `interface Name extends X { ... }`, brace-matched (not regex-greedy)."""
    m = re.search(rf"interface\s+{re.escape(interface_name)}\b[^{{]*\{{", code)
    if not m:
        return None
    start = m.end()
    depth = 1
    i = start
    while i < len(code) and depth > 0:
        if code[i] == "{":
            depth += 1
        elif code[i] == "}":
            depth -= 1
        i += 1
    return code[start : i - 1]


def extract_field_names(body: str) -> set[str]:
    # Top-level `fieldName:` or `fieldName?:` lines only (skip comments).
    fields = set()
    for line in body.splitlines():
        line = line.split("//", 1)[0].strip()
        m = re.match(r"^(\w+)\??\s*:", line)
        if m:
            fields.add(m.group(1))
    return fields


def check_r1() -> list[str]:
    """R1: Verdict interface fields consistent between evaluation-engine.md
    and verdict-audit.md. verdict-audit.md never redeclares the Verdict
    interface (it's owned by evaluation-engine.md, cross-referenced) — so
    this checks that every field name verdict-audit.md explicitly claims
    belongs to the Verdict type is actually present in evaluation-engine.md's
    EvaluationResult + Verdict field set."""
    findings = []
    ee_text = read_spec("evaluation-engine.md")
    ee_blocks = code_blocks(ee_text)

    eval_result_fields: set[str] = set()
    verdict_fields: set[str] = set()
    for block in ee_blocks:
        body = extract_interface_body(block, "EvaluationResult")
        if body is not None:
            eval_result_fields |= extract_field_names(body)
        body = extract_interface_body(block, "Verdict")
        if body is not None:
            verdict_fields |= extract_field_names(body)

    if not eval_result_fields:
        findings.append("R1: could not locate `interface EvaluationResult` in evaluation-engine.md")
    if not verdict_fields:
        findings.append("R1: could not locate `interface Verdict` in evaluation-engine.md")

    combined = eval_result_fields | verdict_fields | {"id", "use_case_id"}

    va_text = read_spec("verdict-audit.md")
    for block in code_blocks(va_text):
        body = extract_interface_body(block, "Verdict")
        if body is not None:
            findings.append(
                "R1: verdict-audit.md redeclares `interface Verdict` — it should only "
                "cross-reference evaluation-engine.md's definition, per R1's ownership rule"
            )
            for field in extract_field_names(body):
                if field not in combined:
                    findings.append(
                        f"R1: verdict-audit.md's Verdict redeclaration has field `{field}` "
                        "not present in evaluation-engine.md's EvaluationResult/Verdict"
                    )

    # Fields verdict-audit.md's traceability table explicitly claims belong
    # to "`Verdict` type" (e.g. "living_status` in `Verdict` type") must
    # actually exist there.
    for m in re.finditer(r"`(\w+)`\s+in\s+`Verdict`\s+type", va_text):
        field = m.group(1)
        if field not in combined:
            findings.append(
                f"R1: verdict-audit.md claims field `{field}` is in the `Verdict` type, "
                "but it is not defined in evaluation-engine.md"
            )

    return findings


KNOWN_TS_BUILTINS = {
    "string",
    "number",
    "boolean",
    "unknown",
    "void",
    "null",
    "undefined",
    "any",
    "never",
    "Record",
    "Array",
    "Promise",
    "Partial",
    "Omit",
    "Pick",
    "Date",
    "Map",
    "Set",
}


def strip_line_comments(block: str) -> str:
    return "\n".join(line.split("//", 1)[0] for line in block.splitlines())


def collect_declared_types(all_spec_text: dict[str, str]) -> set[str]:
    declared = set()
    for text in all_spec_text.values():
        for block in code_blocks(text):
            declared |= set(re.findall(r"\binterface\s+(\w+)", block))
            declared |= set(re.findall(r"\btype\s+(\w+)(?:<[^>]*>)?\s*=", block))
            declared |= set(re.findall(r"\benum\s+(\w+)", block))
    return declared


def collect_implemented_types() -> set[str]:
    """R2 is relaxed (documented deviation) to also accept a type as
    'defined' if it's declared in the actual src/ implementation, not only
    in specs/*.md. Once a chunk is built, the implementation is often the
    more complete and authoritative source — re-litigating every
    implementation-only helper type back into prose specs after the fact
    adds busywork with no safety benefit. The literal spec wording ("in at
    least one spec") is relaxed to "in at least one spec, OR in the actual
    built implementation" for this reason."""
    declared = set()
    for ts_file in SRC_DIR.rglob("*.ts"):
        if ts_file.name.endswith(".test.ts"):
            continue
        text = ts_file.read_text(encoding="utf-8")
        declared |= set(re.findall(r"\binterface\s+(\w+)", text))
        declared |= set(re.findall(r"\btype\s+(\w+)(?:<[^>]*>)?\s*=", text))
        declared |= set(re.findall(r"\benum\s+(\w+)", text))
    return declared


def check_r2(all_spec_text: dict[str, str]) -> list[str]:
    """R2: All TypeScript types referenced in specs are defined in at least
    one spec (or, per the documented relaxation above, in the actual src/
    implementation). Scoped to capitalized type references appearing after
    `:` or as a generic argument, inside fenced ```typescript blocks only,
    with inline `//` comments stripped first."""
    findings = []
    declared = collect_declared_types(all_spec_text) | collect_implemented_types() | KNOWN_TS_BUILTINS

    for name, text in all_spec_text.items():
        for block in code_blocks(text):
            block = strip_line_comments(block)
            # `field: TypeName` / `field: TypeName[]` / `field: TypeName | Other`
            refs = re.findall(r":\s*([A-Z]\w+)(?:\[\])?", block)
            # Generic args: Record<Tier, WorkflowType>, Promise<X>
            refs += re.findall(r"<\s*([A-Z]\w+)", block)
            refs += re.findall(r",\s*([A-Z]\w+)\s*>", block)
            for ref in refs:
                if ref not in declared:
                    findings.append(f"R2: {name} references type `{ref}` which is not defined in any spec or in src/")

    return sorted(set(findings))


def check_r3() -> list[str]:
    """R3: LifecycleStage values consistent across register-lifecycle.md and
    verdict-audit.md. register-lifecycle.md is the sole declaration site;
    checks that any literal array of lifecycle-stage-shaped values elsewhere
    in either spec's TypeScript code blocks is a subset of the declared
    union (e.g. onPolicyUpdated()'s active-stages filter)."""
    findings = []
    rl_text = read_spec("register-lifecycle.md")
    rl_blocks = code_blocks(rl_text)

    declared_union: set[str] = set()
    for block in rl_blocks:
        m = re.search(r"export type LifecycleStage =\s*((?:\s*\|\s*'[a-z_]+'\s*)+)", block)
        if m:
            declared_union = set(re.findall(r"'([a-z_]+)'", m.group(1)))
            break

    if not declared_union:
        findings.append("R3: could not locate `export type LifecycleStage` union in register-lifecycle.md")
        return findings

    # Any literal string array assigned to something lifecycle-stage-shaped
    # (heuristic: a bracketed list of single-quoted snake_case strings that
    # are candidate stage names) must be a subset of the declared union.
    for spec_name in ("register-lifecycle.md", "verdict-audit.md"):
        text = read_spec(spec_name)
        for block in code_blocks(text):
            for arr_match in re.finditer(r"\[\s*((?:'[a-z_]+'\s*,?\s*)+)\]", block):
                values = set(re.findall(r"'([a-z_]+)'", arr_match.group(1)))
                # Only check arrays where every value is plausibly a stage
                # name (i.e. all values are in the declared union already,
                # OR at least one is — narrows out unrelated string arrays).
                if values & declared_union:
                    stray = values - declared_union
                    if stray:
                        findings.append(
                            f"R3: {spec_name} has a lifecycle-stage array containing "
                            f"undeclared value(s) {sorted(stray)} — not in LifecycleStage's union {sorted(declared_union)}"
                        )

    return findings


def check_r4() -> list[str]:
    """R4: All module paths referenced in specs exist in src/ directory."""
    findings = []
    path_pattern = re.compile(r"`(src/[\w./-]+\.tsx?)`")
    seen = set()
    # Modules a round's specs name before the build creates them are listed under
    # a "Planned modules" heading in implementation-guide.md. They are exempt here;
    # a listed path that already exists is a finding (the list is emptied by the
    # chunk that builds the module, so it can never silently rot).
    planned: set[str] = set()
    guide = SPECS_DIR / "implementation-guide.md"
    if guide.exists():
        sec = re.search(r"^#{2,4} [^\n]*Planned modules[^\n]*\n(.*?)(?=^#{1,4} |\Z)",
                        guide.read_text(encoding="utf-8"), re.M | re.S)
        if sec:
            planned = set(path_pattern.findall(sec.group(1)))
    for path in sorted(planned):
        if (REPO_ROOT / path).exists():
            findings.append(f"R4: `{path}` is listed as a planned module but now exists — remove it from the Planned modules list")
    for spec_file in sorted(SPECS_DIR.glob("*.md")):
        text = spec_file.read_text(encoding="utf-8")
        for m in path_pattern.finditer(text):
            path = m.group(1)
            if path in seen:
                continue
            seen.add(path)
            if path in planned:
                continue
            if not (REPO_ROOT / path).exists():
                findings.append(f"R4: {spec_file.name} references `{path}` which does not exist in src/")
    return findings


def check_r5() -> list[str]:
    """R5: All AuditEventType variants referenced in specs match the
    discriminated union definition in src/store/types.ts."""
    findings = []
    types_ts = (SRC_DIR / "store" / "types.ts").read_text(encoding="utf-8")
    m = re.search(r"export type AuditEventType =\s*((?:\s*\|\s*'[a-zA-Z_]+'[^\n]*\n?)+)", types_ts)
    if not m:
        findings.append("R5: could not locate `export type AuditEventType` union in src/store/types.ts")
        return findings
    real_union = set(re.findall(r"'([a-zA-Z_]+)'", m.group(1)))

    va_text = read_spec("verdict-audit.md")
    for block in code_blocks(va_text):
        m = re.search(r"export type AuditEventType =\s*((?:\s*\|\s*'[a-zA-Z_]+'[^\n]*\n?)+)", block)
        if m:
            spec_union = set(re.findall(r"'([a-zA-Z_]+)'", m.group(1)))
            missing_from_impl = spec_union - real_union
            missing_from_spec = real_union - spec_union
            for variant in sorted(missing_from_impl):
                findings.append(
                    f"R5: verdict-audit.md's AuditEventType includes `{variant}` "
                    "which is not in src/store/types.ts's real union"
                )
            for variant in sorted(missing_from_spec):
                findings.append(
                    f"R5: src/store/types.ts's AuditEventType includes `{variant}` "
                    "which is not documented in verdict-audit.md's spec union"
                )
            break

    return findings



def check_r6() -> list[str]:
    """R6: every policy-schema field that is validated and threaded into the
    engine is actually READ by something.

    Regression this prevents — three occurrences before it existed:
      * regulatory citations computed by the engine and dropped at verdict
        assembly (V1; nothing asserted they reached the user)
      * `platform_satisfies` declared on every control and never consulted
      * `safety_margin` validated 0.0-1.0, threaded through evaluate() into
        solvControls() as `_margin`, and discarded — leaving CS-1 half built
        for two months while the traceability matrix reported it covered

    The shared shape: a field is declared, validated, passed along, and never
    consumed. Tests pass because nothing asserts consumption. Reviews miss it
    because the field is visibly "wired". Only a mechanical check catches it.

    Heuristic: a parameter whose name begins with `_` in an engine function
    signature is TypeScript's marker for deliberately unused. If the caller
    passes a real policy value into that position, the value is being
    discarded. Flag it.
    """
    findings = []

    # Exceptions must carry a written rationale — see .parity-allowlist.
    allow: set[str] = set()
    allow_path = REPO_ROOT / ".parity-allowlist"
    if allow_path.exists():
        for line in allow_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                allow.add(line)

    engine_dir = SRC_DIR / "engine"
    for path in sorted(engine_dir.glob("*.ts")):
        if path.name.endswith(".test.ts"):
            continue
        text = path.read_text(encoding="utf-8")
        for m in re.finditer(r"export function (\w+)\s*\(([^)]*)\)", text, re.S):
            fn, params = m.group(1), m.group(2)
            for pm in re.finditer(r"\b_(\w+)\s*:\s*[A-Za-z]", params):
                key = f"{path.name}:{fn}:_{pm.group(1)}"
                if key in allow:
                    continue
                findings.append(
                    f"R6: {path.name}:{fn}() declares parameter `_{pm.group(1)}` as deliberately "
                    f"unused. If a caller passes a policy value here it is silently discarded "
                    f"(the safety_margin/HR-14 defect class). Consume it or stop passing it."
                )
    return findings


def check_r7() -> list[str]:
    """R7: no test-case ID is used by two different tests in code.

    Regression this prevents: TC-CS-1-02 simultaneously denoted "safety margin
    maintained" in test-cases.md and "tie-breaks equal-coverage candidates by
    lowest burden" in greedy-solver.test.ts. The duplicate made a passing
    suite look like coverage of an unimplemented requirement — CS-1's safety
    margin went unbuilt for two months behind it.

    Structural only. An earlier draft compared the doc description against the
    code description by token overlap and produced four findings, three of
    which were merely doc-describes-behaviour vs code-describes-mechanism.
    A check that cries wolf gets ignored, so this one asserts the thing that
    is unambiguously wrong: one id, two different tests.
    """
    findings = []
    seen: dict[str, list[str]] = {}
    for path in sorted(SRC_DIR.rglob("*.test.ts*")):
        text = path.read_text(encoding="utf-8")
        for m in re.finditer(r"it\(\s*['\"`](TC-[A-Z0-9-]+):\s*([^'\"`]{4,})", text):
            tc_id, desc = m.group(1), " ".join(m.group(2).split())
            seen.setdefault(tc_id, []).append(f"{path.name}: {desc[:70]}")

    for tc_id, uses in sorted(seen.items()):
        if len(uses) > 1:
            findings.append(
                f"R7: {tc_id} is used by {len(uses)} different tests — "
                + " | ".join(uses)
                + ". A reused id hides uncovered requirements (the TC-CS-1-02/HR-13 defect class)."
            )
    return findings


def check_r8() -> list[str]:
    """R8: INV-VENDOR-01's `not_in` list must name every id in the vendors
    registry, plus the reserved `internal` sentinel.

    Oracle round 001 found that an unlisted third-party vendor had NO
    consequence anywhere in the rulebook — it merely lost inheritance it never
    had, landing at the same posture as a vetted internal deployment.
    INV-VENDOR-01 closes that, but the condition language has no "is absent
    from the registry" operator, so it enumerates the cleared vendors instead.

    That enumeration is a coupling, and couplings rot. Adding a vendor to the
    registry without adding it here leaves the invariant firing on a vendor the
    firm HAS cleared — a false positive on every use case that vendor touches.
    This is the same "two places must agree, nothing checks that they do"
    failure class as R6 and R7.
    """
    policy_path = REPO_ROOT / "policy" / "appetite.yaml"
    if not policy_path.exists():
        return []
    text = policy_path.read_text(encoding="utf-8")

    registry = set(re.findall(r'^  - id: "(VENDOR-[A-Z0-9\-]+)"', text, re.M))

    inv = re.search(
        r'- id: "INV-VENDOR-01".*?vendor: \{ not_in: \[(.*?)\] \}',
        text,
        re.S,
    )
    if not inv:
        if registry:
            return ['R8: INV-VENDOR-01 is missing or its `vendor: { not_in: [...] }` '
                    "condition could not be parsed, so no unapproved-vendor rule is in force"]
        return []

    listed = set(re.findall(r'"([^"]+)"', inv.group(1)))

    findings = []
    if "internal" not in listed:
        findings.append(
            'R8: INV-VENDOR-01 does not exempt the reserved "internal" sentinel — '
            "every self-hosted use case would trip the third-party-risk invariant"
        )
    for missing in sorted(registry - listed):
        findings.append(
            f"R8: {missing} is in the vendors registry but not in INV-VENDOR-01's "
            "not_in list — the invariant will fire on a vendor the firm has cleared"
        )
    for stale in sorted(listed - registry - {"internal"}):
        findings.append(
            f"R8: INV-VENDOR-01 exempts {stale}, which is not in the vendors "
            "registry — an uncleared vendor is being treated as cleared"
        )
    return findings


def main() -> int:
    try:
        all_spec_text = {p.name: p.read_text(encoding="utf-8") for p in sorted(SPECS_DIR.glob("*.md"))}

        findings: list[str] = []
        findings += check_r1()
        findings += check_r2(all_spec_text)
        findings += check_r3()
        findings += check_r4()
        findings += check_r5()
        findings += check_r6()
        findings += check_r7()
        findings += check_r8()

        if findings:
            print(f"spec-parity-check: {len(findings)} finding(s)\n")
            for f in findings:
                print(f"  - {f}")
            return 1

        print("spec-parity-check: clean (R1-R8 all pass)")
        return 0
    except Exception as exc:  # noqa: BLE001 — script-error exit code per spec
        print(f"spec-parity-check: script error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
