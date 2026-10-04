# Counterpoise — a brief for a supervisory reader

One page on what this tool is, where a human is accountable at every step,
and what it deliberately does not do. Every claim here is implemented and
testable in the public repository; nothing is aspirational. Terms are in the
[glossary](glossary.md).

---

## What it is

A pre-check gate. A firm's AI risk appetite — normally prose in a
board-approved framework — is encoded as executable rules. A proposed AI use
case is described as a data-flow graph (what data goes in, what model
processes it, what comes out and who acts on it) and evaluated against those
rules. The output is a verdict: inside appetite, inside appetite subject to a
named set of controls, or outside appetite — with the rule, the regulatory
citation and the responsible sign-off behind each step of the reasoning.

## Five questions, answered directly

**Is an AI system making the risk decision?**
No. The evaluation is a deterministic rules engine: identical inputs produce
byte-identical verdicts, asserted by automated test on every change. A large
language model is used optionally and only at the boundary — to read a
plain-language description into the structured form. Its output is displayed
to the submitter for correction and is not used until a person confirms it.
With no model configured, none is involved anywhere. (Disclosed for
completeness: the optional path runs against a small open model on the
user's own machine — no data leaves the device; exercised live since
2026-08-16, including a 15-case domain sweep. All verified behaviour in
this brief refers to the deterministic form path; model output is a draft
the submitter corrects field by field — with the model's verbatim basis
quoted and mechanically checked — never an input the engine trusts.)

**Who is accountable for each determination?**
A named human at every layer, and the tool records where accountability is
still missing rather than papering over it:

| Determination | Accountable party | Recorded as |
|---|---|---|
| The facts of the use case | The submitter | A timestamped attestation |
| The firm's appetite rules | The firm (CRO or equivalent adopts the rules file) | Version-pinned policy; `[FIRM]` markers until adopted |
| Each regulatory interpretation | A named function per pack — e.g. Legal/Compliance, Model Risk, Technology Risk | Per-pack sign-off: name, role, date |
| The final decision above self-service tier | A second-line reviewer | A named sign-off event in the audit trail |

Where a sign-off has not yet happened, every verdict that relies on the
unsigned rule is marked **provisional** and names the pending function on
its face. The tool does not interpret regulation autonomously, and a verdict
never claims an adoption that has not occurred.

**Can a decision be evidenced after the fact?**
Each verdict records the exact policy version and the version of every
regulatory pack active at evaluation time. A later policy change does not
rewrite an earlier verdict. The event trail is append-only by construction —
the application exposes no update or delete path, which is itself asserted
by test. (Limitation, stated plainly: in this proof-of-concept the trail is
held client-side, so its tamper-evidence has limits: an edited entry, or a
deleted one with later entries after it, shows as a break in the hash chain;
removing the newest entries does not, and neither would someone with access
to the machine rewriting every entry consistently. A server-side system of
record is future scope.)

**How does the encoding of regulation stay honest?**
Each pack rule quotes the verbatim regulatory text it derives from and
declares its **basis** — whether the rule restates the quoted text, is
derived from it, or rests on legal judgement. A reviewer checks a rule by
reading it against its own citation. An earlier design used numeric
confidence scores; these were removed as unverifiable precision. When
regulation changes, only rules citing the changed sections need re-review.
Three starter packs were deleted from the product because their source text
had not been verifiably retrieved — a rule citing a source nobody read was
judged worse than no rule.

**What happens when the tool doesn't know?**
It says so, on the decision itself, in six distinct ways: unsigned pack
rules mark a verdict provisional; a control with no recorded evidence
renders as outstanding, never as satisfied; a decision type outside the
policy's vocabulary is named as a gap in the framework; genuine legal
ambiguity is labelled judgement and routed to the firm's legal function;
translation fidelity of the whole rules file reads "unattested" until a
person attests it; and a reviewer sign-off records that the typed name was
not authenticated.

**Can a malicious description manipulate the outcome?**
The relevant attack class is prompt injection and jailbreaking — adversarial
text that hijacks a language model's output (demonstrated publicly against
open models via assistant-priming, and the subject of substantial defensive
research, e.g. constitutional classifiers, arXiv:2501.18837). The
architecture bounds this by construction: no language model sits in the
decision path, so there is no model to jailbreak into a verdict. On the
optional edge paths, model output is forced through a fixed schema, values
outside the canonical vocabulary are rejected, the human confirms the
extracted structure before it is used, and the AI-written prose retelling
labels itself as commentary that the deterministic reasoning overrides. The
worst a successful injection achieves is a wrong *proposal*, which the
submitter then attests — and attestation, not extraction, is what carries
accountability. Hostile text in any free field renders as text, never as
markup, asserted by test.

**How the rulebook improves without weakening the decision path.** A
second-line reviewer who believes a rule (not a case) is wrong files a rule
challenge: permanent, attributed, on the audit trail. Challenges accumulate
per rule in a review queue for the framework's owners. The channel is
advisory by construction — a challenge cannot alter any verdict, stage or
sign-off, and rules change only through the existing human edit-and-sign-off
path. Dissent is captured as evidence, never as override.

## What it deliberately does not do

- It does not author or advise on risk appetite. It enforces what the firm
  adopts.
- It does not replace information-security, vendor, or legal review — it
  triggers those as named downstream obligations.
- It does not monitor deployed systems. Each verdict records the operating
  bounds it assumed; those are checked at re-review, not watched live.
- It does not detect AI systems that bypass intake.
- It has no user authentication or segregation of duties in this version.
  Nothing stops a submitter approving their own case and nothing flags it;
  the sign-off on the record shows a typed name, labelled as not verified.

## Correspondence to supervisory expectations

Stated as design intent, not as a compliance claim: determinism and
version-pinning address the reproducibility expectations of model risk
management regimes (SS1/23, SR 26-2); per-rule citation with human sign-off
addresses the expectation that firms — not tools — hold regulatory
interpretations; the append-only trail addresses evidencing. The firm using
the tool remains solely responsible for its own compliance.
