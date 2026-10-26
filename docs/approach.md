# How Counterpoise works — the approach, for firms evaluating it

This explains the thinking, not the buttons. It is written for a risk or
compliance leader deciding whether this is worth piloting, and it is
deliberately blunt about what the approach cannot do.

---

## 1. What question this actually answers

**Not** *"is this AI use case compliant with the EU AI Act?"* Nothing can
answer that from a config file, and a tool that claims to is a liability
rather than a control.

What it answers is: **given the risk appetite your firm has adopted, is this
use case inside it — and if not, what is the smallest set of controls that
brings it inside?**

Regulation enters at one remove. It shaped your appetite when you wrote it,
and jurisdiction packs catch the specific places where local law is stricter
than your baseline. The output is *"in appetite with these five controls"*,
never *"compliant"*. That distinction is the whole basis on which this is
defensible in front of a supervisor.

---

## 2. Three levers, and only two of them decide

This is the point most people miss on first contact. **Appetite decides.
Law decides, where it applies. Knowledge only challenges** — and that third
one is new (round 11), added because the first two answer "who says no?"
and nothing answered "what does the world already know can go wrong with
a use case shaped like this?"

**Your appetite — `policy/appetite.yaml`.** Five hard lines, five track
rules, four tier rules, fourteen invariants, fourteen controls. This does
almost all of the work. Turn every jurisdiction off and the tool still
functions.

**Jurisdiction packs — `policy/packs/*.yaml`.** Seven rules across four
regulations. These only ever *modify* an answer the appetite already
produced. A pack rule can do exactly four things:

| Effect | Meaning |
|---|---|
| `tier_floor` | Here, this cannot be rated below X |
| `required_control` | Here, this control is mandatory regardless |
| `required_review` | Here, this review must happen |
| `hard_line` | Here, this is simply not allowed |

None of them classify anything on their own.

### Why a 200-page regulation yields two rules

You do not encode the regulation. You encode only the places where it
**changes the answer** for a use case, given its attributes. Everything else
in the document is either:

- **Not about triaging use cases** — governance structures, reporting
  timelines, definitions, penalties, scope articles. There is nothing to test
  against a data-flow graph.
- **Already in your appetite** — independent validation, documentation,
  monitoring, human oversight. Your invariants require those anyway.
  Restating them in a pack duplicates the baseline and creates two places to
  maintain one rule.

EU AI Act Annex III §5(b) says credit scoring of natural persons is
high-risk. That one sentence changes the tier for a whole class of use cases,
so it earns a rule. Article 6's classification *methodology* does not — it is
how you reason about risk, not a test you can run.

A count of rules is therefore a terrible measure of coverage. The right
question is *"has anything ever been decided differently because of this
regulation, and is that difference encoded?"*

---

## 2a. The third lever — knowledge, and its honest boundary

**Risk knowledge — `grounding/risk-knowledge.yaml`.** Not a pack, not part
of the appetite file, its own schema. Entries are curated against the [MIT
AI Risk Repository](https://airisk.mit.edu/)'s public domain taxonomy
(Slattery et al., MIT FutureTech; CC BY 4.0; 1,700+ risks from 65
frameworks). Where a use case's shape matches a known risk class, the
review and sign-off screens show it, named, beside the verdict — never
inside it.

Its schema has no field that can express a tier, control, hard line, or
verdict effect. That is not a policy choice a future edit could quietly
relax — the type itself has no such field, so a rule author cannot smuggle
a deciding effect in even by accident (`parseKnowledgeLens` rejects any
unrecognised key). `evaluate()`'s decision output is byte-identical whether
this file is loaded or not, and a test asserts it.

**The honest boundary, stated plainly:** this file is curated by a person,
by hand, against a taxonomy someone else maintains. It is a snapshot, not a
live sync. The MIT repository updates quarterly; this file updates when a
person re-reads it and decides what changed. That gap is a monitoring-loop
tripwire (re-review on each MIT update), not something the tool hides —
where the lens is silent on a use case's actual risk, the tool says
nothing, and silence is not the same claim as "no risk here."

Where a matched entry's risk class has no covering rule, the panel says so
and files a coverage-gap into the same rule-improvement queue a reviewer's
dissent already feeds — knowledge becoming rule-authoring fuel through the
one channel that already turns disagreement into a human decision, never
an automatic one.

---

## 3. How a rule is built

Three parts, kept side by side so an auditor can challenge the middle one:

```yaml
source:                    # the fact — copy-pasted, with a link
  document: "EU AI Act"
  section: "Annex III §5(b)"
  text: "AI systems intended to be used to evaluate the creditworthiness
         of natural persons or establish their credit score, with the
         exception of AI systems used for the purpose of detecting
         financial fraud"
  source_url: "https://artificialintelligenceact.eu/annex/3/"
  retrieved_date: "2026-07-26"
effect:                    # what it does to the verdict
  type: "tier_floor"
  minimum_tier: "Critical"
condition:                 # the machine test — this is the interpretation
  decision_type: { in: ["credit-decision", "lending-decision"] }
basis: "derived"           # what the rule does to its own quoted text
```

**`basis` replaced an earlier confidence score, and the reason matters.**
Grading rules High/Medium/Low was subjective: two reviewers grade the same
rule differently, and nothing told a reader what "Medium" obliged them to do.
`basis` asks a question anyone can check by putting the rule beside its quote:

| `basis` | Meaning | Effect on the verdict |
|---|---|---|
| `verbatim` | Restates the quoted passage; nothing read in | no caveat |
| `derived` | A direct inference from the passage | caveat — check the inference holds |
| `judgement` | Rests on a reading the passage does not settle | verdict is provisional |

If a rule's quote is still an authoring placeholder, `basis` is meaningless —
you cannot ask "does this restate the text" when there is no text. The engine
detects this and says so, rather than letting it pass as merely unsigned.

---

## 4. Sign-off: how it works in practice

The common objection is *"nobody is going to read a regulation and map every
sentence."* Correct — and nobody is being asked to.

**The extraction happens before sign-off.** The pack author reads the
regulation once and pulls out the handful of provisions that actually bite.
What the reviewer receives is not a regulation; it is a short stack of
finished claims, each carrying its own evidence and a link to the source.

Reviewing one rule is three questions:

1. **Is that quote actually what the section says?** Follow `source_url`,
   compare. Two minutes.
2. **Does the machine condition capture what the quote requires?** This is
   the judgement call, and it is the entire reason a qualified person is
   involved.
3. **Is the declared `basis` honest?**

### Sign-off is per pack, not per rule

Legal issues a position on a regulation. They do not countersign each line of
a config file. Requiring a signature per rule made adoption a task no firm
would finish — which left every deployment permanently provisional, the exact
failure the field existed to prevent.

So the pack header carries the sign-off and rules inherit it. A single rule
can carry its own where a firm deviates from the central reading.

### The artifact should be a memo, not the YAML

Banks sign documents. That is the operating model — everything traces to an
approved document with an owner, a version and a date. So the sign-off is a
one-page memo: the regulation, the rules listed with their citations, a
signature block. Ordinary committee paper. The config records the reference.
Nobody outside engineering should ever open the YAML.

### Who owns which pack

| Regulation | Typical owner |
|---|---|
| SS1/23, SR 26-2 | Model Risk — it is their standard |
| EU AI Act, conduct | Legal / Compliance |
| DORA, resilience | Technology Risk |

You do not need one heroic reviewer. You need each owner to confirm the slice
they already own.

### What it costs

For one jurisdiction, ten to fifteen rules:

- **Drafting:** 2–3 days for someone who knows both the regulation and the
  use cases.
- **Review:** half a day, because they are checking a draft, not authoring
  one.
- **Maintenance:** subscribe to the regulator's alerts; when text changes,
  re-sign only the rules citing the changed section. About an hour a month.

Seven jurisdictions is 3–4 weeks of drafting plus seven separate reviews.
That is a project, not a side task. Do one.

---

## 5. Build the corpus from decisions, not from regulations

The recommended order is counter-intuitive and it matters.

Do **not** start by reading regulations top-down. Start with the last twenty
use cases your committee actually decided. For each, ask: *what rule would
have produced this outcome?* Write that rule. **Then** find the provision
that justifies it.

Three things fall out:

- **The corpus is calibrated by construction.** Rules derived from real
  decisions reproduce real decisions. Rules derived top-down are a hypothesis
  you still have to test — and that is where these projects die.
- **You only encode what has mattered.** If no provision of a given
  regulation has ever changed one of your decisions, it does not need a rule.
- **Legal reviews something concrete.** *"Does this rule reflect our
  position?"* with a real decision behind it beats *"is this an accurate
  reading of Article 6?"*

This is the same exercise as back-testing the tool, so it is not extra work —
it is the work you already needed to do, with the rules written down as a
by-product.

**Sequence it this way:** turn packs off, back-test your appetite file
against twenty decided cases, let pack rules fall out of the disagreements,
then take those rules to one owner as a memo. The expensive expert-dependent
work happens *after* you know whether the core idea holds.

### The corpus keeps improving after launch: rule challenges

Back-testing calibrates the rules once. The **rule-improvement queue** keeps
them calibrated. When a 2LoD reviewer applying a rule to a live case believes
the rule — not the case — is wrong, they file a challenge from the sign-off
page: the rule, the reasoning, their name, permanently on the audit trail.
Challenges accumulate per rule on the **Rule challenges** screen, so the rule
owner sees "this rule has drawn four objections from three reviewers" as
evidence, not hearsay.

Two design decisions carry the weight. A challenge is **advisory by
construction** — it cannot change a verdict, move a case, or feed the engine;
rules change only through the same edit-and-sign-off path as ever, so the
authority model is untouched. And the channel is **role-agnostic by design**:
today the challengers are people, but an advisory machine reviewer (small,
rubric-grounded judge models of the kind Haize Labs' work demonstrates) would
file through the same event with the same authority over decisions — none.
That second half is deliberately a design note, not shipped code
(`specs/forward-notes.md` FN-009), because this build has never run an LLM
call live and does not pretend otherwise.

---

## 6. What is honestly not solved

- **Omission in intake.** The tool reasons about what it was told. A use case
  described inaccurately gets a confident, wrong answer. Self-attestation is
  the weakest link in the whole chain.
- **Determinism is not correctness.** The same answer every time is not the
  same as the right answer. Only back-testing tells you that.
- **Genuine legal ambiguity.** Where text is contested, the rule is marked
  `judgement`, the verdict is provisional, and it routes to Legal. The tool
  does not pretend to resolve what qualified lawyers disagree about.
- **Regulatory staleness.** A confident verdict from an outdated rule is
  worse than no tool. The maintenance loop above is not optional.
- **Nothing is verified.** Controls you claim are believed. Controls carrying
  real evidence show VERIFIED; everything else reads UNVERIFIED.

---

## 7. Current state of the shipped packs

Starter packs are a template on exactly the same terms as the starter
appetite: **you own what you adopt.** As of the last review (2026-07-26):

| Pack | Rules | Verified text | State |
|---|---|---|---|
| EU-AIACT | 4 | 4 | Draft — quotes retrieved, awaiting review |
| SS1-23 | 1 | 1 | Draft |
| SR-26-2 | 1 | 1 | Draft |
| DORA | 1 | 1 | Draft |
| OSFI-E23 | 1 | 0 | Not authored — placeholder text |
| MAS-FEAT | 1 | 0 | Not authored; source superseded — successor (MAS Guidelines on AI Risk Management) in consultation as of early 2026; the SG pack will be authored from the FINAL text on issuance, within its transition window |
| FSA-JP | 1 | 0 | Not authored — no source identified |

"Draft" means the quote was retrieved from the cited URL and copied verbatim,
but **no lawyer has checked it**, and the text-to-condition mapping is a
drafting judgement. "Not authored" means the rule text is a placeholder and
the engine will say so on any verdict that touches it.

Rules carrying a `Reviewer:` comment in the YAML are the ones drafted with
least confidence. Start there.

### Regulatory notes from that review

- **SR 26-2** (issued 2026-04-17, replacing SR 11-7) carves generative and
  agentic AI *out* of the model definition — but general risk management
  still applies. That gap is what a firm's own AI appetite has to fill, and
  it is why generative and agentic systems route to a separate governance
  track here rather than being treated as ungoverned.
- **EU AI Act:** the Digital Omnibus postponed Annex III high-risk
  obligations to 2 December 2027. **Article 50 transparency was not
  postponed** and applies from 2 August 2026 — which is why the appetite now
  carries an AI-disclosure invariant.
- **OSFI E-23:** final published 2025-09-11, in force 1 May 2027.
- **MAS:** FEAT is non-binding principles; formal AI Risk Management
  Guidelines were consulted on (closed 31 Jan 2026) with a 12-month
  transition. Not yet a stable rule source — re-author when they publish.

---

*Nothing in this repository is legal, regulatory or compliance advice. The
starter appetite and packs are unadopted templates. A verdict produced before
your firm has adopted them is provisional, not final.*
