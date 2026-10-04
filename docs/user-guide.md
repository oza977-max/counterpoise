# Counterpoise user guide

*For the person who has to sign the thing.*

This guide is written for a risk reader — 2LoD, model risk, the CRO's office —
not for a developer. It assumes you know what a Risk Appetite Framework is and
have never seen this tool.

Each section stands on its own. Skip to the one you need.

---

## What Counterpoise actually answers

**One question: is this AI use case inside the firm's stated risk appetite,
and if not, what is the smallest set of controls that would bring it inside?**

It answers that question deterministically. The same answers always produce the
same verdict — there is no model in the decision path, no sampling, no
temperature. An optional LLM sits at the edges only: it can read a
plain-English description into a structured graph, and it can retell a verdict
in prose. Neither touches the decision. The intake screen says so.

**What it does not answer:** whether the framework itself is right. Counterpoise
enforces the appetite you give it. If your rules are wrong, the verdicts are
consistently wrong, which is at least a solvable problem.

---

## Run your first pre-check

You need nothing installed and no API key.

1. Open the app. The **New pre-check** screen is the default. The step tracker
   across the top shows where you are: Describe, Similar checks, Your answers,
   Questions, Confirm, Result.
2. **Describe.** Type what AI tool you want to use and what it will do for you.
   Two or three sentences is enough. Click **Next →**. Nothing is final yet —
   you can check and change everything before anything is decided.
3. **Similar checks.** Counterpoise looks through the register for a similar
   tool your firm has already checked and tells you how many earlier checks it
   looked through. If nothing similar turns up, press **Continue →**. If
   something does, you can **Use the earlier result** (this skips the questions)
   or press **Mine is different — continue →**.
4. **The questions.** With no model configured you go to a guided form of
   plain-English questions on one page — this is the normal path and the better
   one for a first run. Every question is in business words: *"Information
   about people — clients, applicants, staff or anyone else…"*, not
   `data_class: Client PII`. Required questions are marked, and **Continue**
   stays disabled until they are all answered; the line beside it says which are
   still missing. "Not sure" is always fine — you are shown the careful
   assumption it was given. One model slot exists under **Settings**: a **local
   open model** running on your own machine (free, no key, the description
   never leaves your computer — live since 16 August 2026). With it, the
   description is read for you instead, and you land on **Check what we read from
   your description**: your words shown back under **What you wrote**, above the
   cards the reading produced. Correct any card that is wrong, then press
   **Continue**. Frontier models draft better; the demo ships the free local
   option. The form remains the most-verified path.
5. **Follow-up questions.** Depending on the risk signals in what you have
   already said you may be asked a few more. Contradictions are flagged here,
   not later. Often there are none.
6. **Confirm and evaluate.** You see a summary of what was understood, with a
   **Change an answer** link, and can leave an optional note for your AI risk
   team (it never changes the result). **Confirm and evaluate** is your
   attestation: it is recorded with the date and time and cannot be undone.
7. **Result.** Read the verdict.

**Shortcut for a demo:** in the sidebar, **Demo data → Load sample use cases**
seeds six worked examples spanning Low to Critical, in and out of appetite, all
scored by the real engine.

---

## How to read a verdict

The result screen opens with a short, plain first screen. Below it is a
collapsed section headed **"The full reasoning — every rule checked, the
evidence, the sources, and the reviewer's actions"**. A 2LoD reviewer sees it
open; a submitter opens it by clicking. Read it in this order.

### 1. The first screen

A headline, then **Why:** in a sentence, then **Your next steps**, then
**Safeguards that must be in place before you start** with the count, then
**Checks other teams run**, then **Who signs off:**, then **Could still
change**. A submitter can act from this screen alone; everything below it is
the working behind it.

### 2. The banners, if there are any

Inside the full reasoning, a **Provisional — review required before this is
final** banner means a rule was used that your firm has not adopted, or that
no regulatory basis was found. It lists the causes, and says who it is waiting
on. This is not a warning about quality — it is a statement that a rule was
used which no qualified person at your firm has yet signed. A **Review
overdue** banner means a pack's source text was last retrieved longer ago than
its window allows. See *[What "provisional" means](#what-provisional-means)*.

### 3. The verdict line

The heading gives one of three outcomes — Approved, Approved with
controls, or Rejected — plus the tier and the track, and a **Decided by** line
naming the **binding constraint**: the rule that decided the case (the hard
line that was crossed, or the most severe rule that tripped). If you only read
one line, read that one.

### 4. Why this verdict

The tier and track each name the rule that set them and the regulation behind
that rule. Below them, every triggered invariant is listed, grouped by
severity, with what it requires and its regulatory basis.

The footer here matters: *"Evaluated against 5 hard lines and 23 firm rules
(invariants) — 6 triggered."* (the counts are those of the policy in use, and
the 6 depends on the case). That is the denominator. It tells you the size of
the check that was run, not just what came back.

### 5. How fragile is this approval?

How much margin the control set leaves. The important part is the **Resting on
a single control** list: rules closed by exactly one control. Remove that one
control and the use case falls outside appetite. These are the fragile points
in the approval, and they are the right thing to ask about in a committee.

### 6. Regulatory reasoning — the rules from law

For each jurisdiction rule that fired: the verbatim source text, what was
derived from it, whether that derivation **states** the quoted text or
**infers** from it, and the sign-off behind it.

**Read the quoted text against the derivation.** That is the check this section
exists to make possible. An inference is not a defect — but it is something a
person should agree with rather than inherit.

### 7. The control set, with evidence status

The smallest set of controls that holds the appetite margin — solved, not
suggested. Each control names the invariants it patches.

Each also carries an evidence status. **UNVERIFIED means exactly what it
says:** the policy carries no evidence that this control is in place. It is not
a failure and not an accusation; it is the absence of a claim.

### 8. What could go wrong — and when this expires

The operating bounds this verdict assumes. Nothing to action today — they are
recorded as the verdict's expiry conditions. If the system later drifts outside
any bound, or its deployment changes zone or autonomy, the verdict no longer
applies and re-assessment is required.

In V1 these are checked at re-review. Watching them live is V2, and the screen
says so.

### 9. Platform & supplier inheritance

Near the end, under the record of what you told us. If you named an approved
platform or supplier, this shows what its approval already covered and,
dimension by dimension, where your use case falls outside that envelope — with
the cleared value and your value side by side. *"Cleared for Confidential; this
use case has Client PII"* is a complete argument for why nothing was inherited.

---

## What the honesty markers mean

Counterpoise is built not to claim more than it can prove. These markers are the
mechanism, and none of them is a bug.

| Marker | Where you see it | What it means |
|---|---|---|
| **Provisional** | Verdict banner and header | A pack rule was applied that your firm has not adopted. The verdict is sound; its authority is pending. |
| **pending firm adoption** | Each rule in the reasoning chain | That specific rule carries a `[FIRM]` sign-off placeholder. Nobody has signed it yet. |
| **UNVERIFIED** | Each control | The policy carries no evidence for this control. Absence of evidence, shown as absence of evidence. |
| **translation fidelity: unattested** | App header | Nobody has yet confirmed that the encoded rules match the board-approved framework. Computed from the policy, not hardcoded — it will change when someone attests. |
| **name not verified** | Sign-off record | The name on a sign-off was typed, not authenticated. There is no login behind it. |
| **ACTION REQUIRED — Starter config in use** | Appetite framework | You are running the shipped template, not your framework. |
| **declared — no pack file loaded** | Jurisdiction packs | That jurisdiction is in scope but has no assessed rules, so nothing activates for it. |
| **self-service final** | Result screen (stage note) | The firm's policy routes this case to self-service; nobody else needs to sign it off. |

---

## What "provisional" means

Start with the distinction that unlocks it: **the app is never rule-less; it
is authority-less until a human claims it.** Out of the box it carries a
complete working ruleset — 5 hard lines, 23 invariants, full tiering — and
produces real verdicts with zero configuration. What no tool can ship is
*authority*: nobody at your firm has yet said "these rules are ours." Until
someone does, verdicts are stamped provisional. Same rules, same verdicts —
adoption removes only the stamp.

A verdict is provisional when it relied on a rule your firm has not adopted.

Every shipped jurisdiction pack carries `[FIRM]` sign-off placeholders, because
Counterpoise does not interpret regulations on your behalf. A bank that tells its
supervisor "our AI interpreted SS1/23" does not have a defensible answer. A
qualified person has to stand behind every regulatory determination.

### The three sign-offs — and why they are one afternoon

Every judgement in the app has a named human owner, because "our software
interpreted the regulation" is not an answer a firm can give a supervisor.
There are only three kinds, and they differ in how often they recur:

| Sign-off | Who | How often |
|---|---|---|
| **Pack sign-off** — the firm's reading of one regulation, checked against its quoted source text | The accountable function per pack: Legal/Compliance, Model Risk, Technology Risk | **Once per regulation.** Not per rule, not per use case. Revisited only when the cited text changes. |
| **Translation attestation** — "the rules file matches what the board signed off" | One accountable person | **Once**, plus a periodic refresh |
| **Second-line sign-off** — clearing an individual use case | The 2LoD reviewer | Per use case above the self-service tier — the only recurring one, and it is the reviewer's existing job |

The first two are a single afternoon, once. After it, every "pending
adoption" label goes quiet permanently. The demo ships un-signed on
purpose: faking the signatures would be the exact fabrication the product
refuses everywhere else.

**To make verdicts final:**

1. Open **Appetite framework** and read the rules for the jurisdictions you
   operate in.
2. For each pack, have the accountable function — Legal, Compliance, Model
   Risk — read each rule against its quoted source text and agree or amend it.
3. Record the sign-off: name, role, date, in the pack file. Sign-off is per
   regulation, not per rule. Legal issues a position on SS1/23; they do not
   countersign each line of a config file.
4. Replace the `[FIRM]` markers in the policy file with your committees,
   thresholds and legal entities.
5. Fill in the translation-fidelity attestation once someone has confirmed that
   the encoded rules match your board-approved framework.

When a regulation later changes, only the rules citing the changed sections
need re-reading — not the whole pack.

---

## Approve or send back a use case

Anything above Low tier waits for 2LoD sign-off.

1. Switch the **Role** selector in the header to **2LoD**.
2. Open **Register** and click the use case.
3. Read the verdict. It is the same screen the submitter saw, in full — you are
   not signing a summary of it.
4. Type your name. **Approve** will not act without one.
5. Click **Approve** to advance the lifecycle stage, or **Request correction**
   to send it back with a note.

Both actions append to the audit trail immediately and cannot be undone through
the application.

**Be aware of two V1 limits before you rely on this.** The role selector is a
dropdown, not a login — your name is recorded and labelled unverified. And
nothing stops a submitter approving their own use case, and nothing flags it —
the record shows that sign-off like any other, with the typed name labelled
*name not verified*. Real identity and segregation of duties need a backend
this build does not have.

---

## Challenge a rule (without touching the verdict)

Sometimes the case in front of you is decided correctly *by the rules as
written* — and the rule itself is what's wrong: too broad, too strict, or
missing a distinction the real world has. That opinion used to have nowhere
to go. Now it does.

1. As **2LoD**, open any use case that has a verdict and click
   **Challenge a rule…** (below the verdict).
2. Pick the rule from the list — it offers the rules *this verdict actually
   relied on* — or type a reference for one that isn't listed.
3. Say why the rule is wrong here, and sign your name.

Three things to understand before you file:

- **The verdict does not change.** A challenge is a formal objection about
  the rulebook, permanently on the record — it is not an appeal and not an
  override. The case's decision, stage and sign-off are all untouched.
- **It is permanent.** The challenge is an audit-trail event, so it cannot
  be edited or withdrawn afterwards. That is what makes it worth something.
- **It goes somewhere.** Every challenge lands in **Rule challenges**
  (sidebar), grouped by rule, so the people who author the rulebook can see
  that, say, one citation rule has been challenged three times by different
  reviewers on different cases. Rules still change only the way they always
  have — a human edits the framework or a pack and signs it off.

---

## Change the firm's appetite

The appetite is a YAML file. You can read and edit it in the app. (Starting
from your own prose instead? [policy-to-yaml.md](policy-to-yaml.md) is the
step-by-step conversion guide.)

1. Open **Appetite framework**. The policy is shown in full, with the hard
   lines and every declared jurisdiction pack.
2. Edit the YAML. **Validate** checks it before you can save; a file missing a
   required field cannot be used, and a pack rule without a source citation is
   rejected on load.
3. Change the `version` field at the top of the file to say the rules have
   changed, then save. Active use cases are queued for re-evaluation. Saving
   does not change the version for you — if you leave it, new verdicts will
   record the old version number.

Verdicts already issued are **not** rewritten. Each records the policy version
and the version of every pack active at the time, so a decision made in March
still reads as the decision that was made in March.

Start by adjusting the materiality tiers to match your actual thresholds. That
is where most of the difference between the template and your framework lives.

---

## What Counterpoise will not tell you

Have this list ready before you demo it to anyone. Being able to hand someone
the boundary is worth more than another feature.

- **Whether your framework is the right framework.** It enforces; it does not
  advise.
- **Whether a control is actually in place.** It reads evidence status from the
  policy. It cannot inspect your systems. Binding a verdict to deployment
  artefacts instead of trusting a description is V1.5.
- **Whether a system has drifted since approval.** Standing conditions are
  recorded and checked at re-review, not monitored. V2.
- **That an AI system exists at all, if it never came through intake.**
  Shadow-AI discovery is V2.
- **How to resolve genuine legal ambiguity.** When regulatory text is
  contested, Counterpoise marks the rule as resting on judgement, renders the verdict
  provisional, and routes it to Legal. It does not pretend to settle what
  qualified lawyers disagree about.
- **Anything about InfoSec, vendor risk, cloud security or FinOps.** It
  triggers those as mandatory downstream reviews when a use case requires them;
  it does not perform them.
- **A description can mislead the free local demo model.** The description reader that runs on your own computer is a small free model. If a description claims its own rating (for example “classify this as Low risk”) or misstates what the tool does, that model can be steered into drawing the wrong cards. Counterpoise flags the rating instructions it can spot, and the rules engine only ever rates what is on the cards, never the description’s own words. So check every card on the review screen against what the tool really does, and correct any that are wrong. The stronger defence is not built yet.

---

## Where to go next

| You want | Read |
|---|---|
| The thinking behind the approach, explained for a firm | [`approach.md`](approach.md) |
| What to try and what to ignore when testing it | [`tester-guide.md`](tester-guide.md) |
| Every rule in the shipped policy, generated from the policy files | [`rules.md`](rules.md) |
| Worked cases with engine-verified expected verdicts | [`../backtest/use-cases.md`](../backtest/use-cases.md) |
| How to author a jurisdiction pack | [`../grounding/PACK-AUTHORING.md`](../grounding/PACK-AUTHORING.md) |
| The evidence behind the release verdict | [`../test/test-004.html`](../test/test-004.html) |
