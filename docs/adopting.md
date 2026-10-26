# Adopting Counterpoise

*Moved here from the README on 2026-10-22, word for word, so the README can stay short. Nothing was cut.*

## The rules are yours to own

Counterpoise works by checking AI use cases against a **Risk Appetite Framework (RAF)** — a set of rules that defines what AI risk the bank will and won't accept. Every verdict, every control requirement, every jurisdiction override traces back to a rule in that framework.

**This means Counterpoise is only as good as the rules you give it** — though it is
never rule-less: a complete starter ruleset works out of the box, and what
adoption adds is *authority*, not function. Same rules, same verdicts; the
provisional stamp is the only thing a CRO's signature removes.

### If your bank has a formal AI Risk Appetite Framework

You are in the best position. You translate your existing RAF into Counterpoise's policy file format (YAML). The engine enforces your rules consistently. Verdicts are traceable to your own documented policy.

### If your bank has some AI governance, but it's scattered

Most banks are here — a model risk policy, an AI ethics statement, some vendor guidelines, nothing unified. Counterpoise ships with a starter policy file derived from a regulator-grounded AI Risk Appetite template. Use it as your starting point. Customise it to reflect your actual committees, thresholds, and appetite. You are not starting from nothing.

### If your bank has no AI-specific governance yet

The starter config effectively becomes your AI risk appetite framework. It is grounded in SR 26-2 (US), SS1/23 (UK PRA), EU AI Act and DORA. Canada, Singapore and Japan are declared operating jurisdictions with no assessed pack — the starter packs for those were deleted in policy v1.3 because their rule text was illustrative and their sources were never retrieved, and a rule citing a source nobody read is worse than no rule. It is a credible, defensible starting point — but it is not your framework until your CRO or equivalent has reviewed and adopted it.

**The starter config is a template. You own what you adopt.**

Using the starter config verbatim without review is an implicit governance decision. Document that decision. The starter config includes placeholder markers (`[FIRM]`) for content your organisation must fill in — committees, thresholds, legal entity references. A verdict produced before those are filled is provisional, not final.

## How regulatory grounding works — and its limits

Counterpoise evaluates use cases against **regulatory override packs** — structured rule files for SR 26-2, SS1/23, EU AI Act and DORA. These drive jurisdiction-aware verdicts: a use case touching UK entities is evaluated against SS1/23's technology-agnostic MRM standard; one touching EU borrowers with credit-scoring characteristics triggers EU AI Act Annex III's forced-Critical classification.

**Regulations evolve. This is the hardest problem in the product.**

Positions move: the US recently carved generative and agentic AI out of its model definition; the EU delayed some obligations while others became live law. A product that encodes a snapshot of today's regulations and never updates is not a governance tool — it is a liability. (The current per-pack states and dates live in [`docs/approach.md`](docs/approach.md), where they are maintained.)

### How Counterpoise approaches this

**Every rule cites its primary source — the verbatim regulatory text it derives from.**

Not: *"Track II if quantitative output into a regulated decision"*

But: *"Track II — from SS1/23 §3.4: 'models that produce quantitative outputs used in material decisions require independent validation.' Basis: states the quoted text."*

This means:
- The verdict shows you the exact regulatory text behind every decision. You can verify it yourself against the source.
- When a regulation changes, only the rules citing the changed sections need review — not the whole pack.
- Every rule declares its **basis** — whether it restates the quoted text, infers from it, or rests on legal judgement. That is something a reviewer can check by reading the rule against its own citation, rather than a confidence score somebody had to invent.

**Every pack requires a human reviewer sign-off** — name, role, date — against the primary source text. Sign-off is per regulation, not per rule: Legal issues a position on SS1/23, they do not countersign each line of a config file. (A single rule can carry its own sign-off where a firm deviates from the central reading.) Counterpoise does not interpret regulations autonomously. A bank that tells the PRA "our AI interpreted SS1/23" does not have a defensible answer. A qualified person must stand behind every regulatory determination. Counterpoise makes that accountability traceable and minimal in effort: reviewers sign off only on rules citing changed text, not the whole pack every time.

**Verdicts show the full reasoning chain:** regulatory text → derived rule → verdict, with the basis of each step stated. A regulator asking "why was this Track II?" sees the SS1/23 section, the rule, and who reviewed it — not just a version number.

**When a bank disagrees with the central interpretation**, they can override locally — but they must cite the competing text and record their reasoning. Silent overrides are not permitted.

**What this does not solve:** genuine legal ambiguity. When regulatory text is contested, Counterpoise marks the rule `judgement`, renders the verdict provisional, and routes to the bank's legal team. It does not pretend to resolve what qualified lawyers disagree about. That is the honest boundary of what a tool can do.

## Getting started, in order

1. **Try the live site** — load the samples, open two or three verdicts.
2. **Back-test your own committee's past decisions, on your own copy of the app** (never on the public demo,
   which must not receive real company information) — before touching any
   configuration, run cases your firm has *already decided* through the
   gate and compare its verdicts with what your committee actually ruled.
   [`backtest/use-cases.md`](backtest/use-cases.md) has eight worked
   scenarios with paste-in descriptions and expected outcomes to show the
   method. Where the tool disagrees with your committee, *that
   disagreement is the finding* — it's either a wrong rule to fix or an
   inconsistency worth knowing about. This is the fastest honest test of
   whether appetite-as-code works for your firm, and it costs nothing but
   an afternoon.
3. Open `policy/appetite.yaml` — read the preamble, understand the starter rules.
4. Replace `[FIRM]` placeholders with your organisation's details.
5. Review the materiality tiers and adjust thresholds to your actual appetite.
6. Submit your own new use cases through the gate.

**Making it a habit, not a demo:** the pre-check only compounds if people
come back. Two zero-build triggers that work today — bookmark the live
site's **New pre-check** page in the team's AI/tooling request template
("attach your Counterpoise verdict id to the ticket"), or add a checklist line to
your PR/change template ("AI in this change? Link the pre-check verdict").
The register then becomes the firm's memory of every AI decision without
anyone maintaining a separate log.

## Moving cases between machines — what the hand-off can and can't prove

- **Hand-off merges only a continuation.** The first time a reviewer receives a case, their browser already holds its own demo history, so the import reports different histories — normal here, since every browser seeds its own demo cases — and offers **Save a backup of mine first** (a backup file downloads; browsers can sometimes block this, so it asks you to confirm it saved), then **I have my backup — replace my register**. After that, each return trip merges cleanly. On import the app re-checks every entry: accidental damage or a simple edit is caught and the import refuses. It can't prove who made the file — anyone holding it could rebuild it to pass these checks — so exchange bundles only with people you trust, by a route you trust. (The same limit the audit trail states for itself: tamper-evident, not tamper-proof.) If the submitter *also* keeps working while the reviewer has the case, a later import reporting different histories is shown as a warning, not treated as routine — check with the sender before replacing — and it still refuses to merge rather than guessing which to keep. The safe pattern: one side works at a time. Giving each case its own history (so unrelated work never collides) is next.
