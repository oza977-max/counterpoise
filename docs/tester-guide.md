# Counterpoise — guide for testers

You've been asked to try Counterpoise against some real AI use cases. This page
tells you what it is, what to do, and — just as importantly — what it
deliberately doesn't do yet.

Reading time: five minutes. Testing time: about an hour for four or five
use cases.

---

## What Counterpoise is

A **pre-check** for AI risk appetite. You describe an AI system you want to
build; Counterpoise tells you whether the firm's risk appetite allows it, and if
not, the smallest set of controls that would.

The point of it is not the answer. It's that the answer is **the same every
time, for stated reasons, on the record**. Ask it the same question twice
and you get the same verdict, with the rule that drove it and the regulation
behind that rule.

**No AI makes the decision.** The rules are a YAML file you can read and
edit. An LLM optionally helps read your description in and write a plain
summary out, but it never touches the verdict. If you disagree with an
outcome, you can point at the exact rule that caused it.

## What it is not

- Not a chatbot.
- Not a final approval. It's a pre-check that tells you where you stand
  before you spend a month writing papers.
- Not the firm's actual risk appetite. The rules shipped here are a starter
  set derived from a public template. Testing whether those rules are
  *right* is part of what we're asking you.

---

## Getting in

**If you were sent a link** — just open it. Nothing to install. Chrome,
Edge, Firefox or Safari, on a desktop.

**If you were sent the repository** — you'll need Node 22+:

```
npm install
npm run dev
```

Then open the URL it prints (usually http://localhost:5173).

> Opening the built `index.html` by double-clicking it will **not** work.
> The page loads as a JavaScript module, and browsers block that from a
> `file://` path. It needs to be served — `npm run dev` above, or
> `npx serve dist` after `npm run build`.

---

## Before you start: two things to know

**Your data is yours alone, and only in this browser.** Counterpoise has no
server. Everything you enter is stored in the browser you're using. Nobody
else can see it, it doesn't sync between your laptop and your phone, and
clearing your browser data deletes it. Use **Export** when you want to send
results back.

**You can be either side.** The role switch in the header flips you between
1LoD (submitting) and 2LoD (reviewing). It's a dropdown, not a login —
anyone can be anyone. That's a testing convenience, not the intended design.

---

## Suggested run-through

### 1. Load the samples first (5 minutes)

Sidebar → **Demo data** → **Load sample use cases**. Six examples appear in
the register. Open two or three and read the verdicts. This is the fastest
way to see the shape of the thing, and it gives the duplicate check
something to find later.

You should see genuinely different outcomes — this is worth checking, since
a tool that says the same thing to everything is worthless:

| Sample | Outcome | Tier / Track |
|---|---|---|
| Coding assistant for risk analysts | In appetite, with controls | Low / III |
| Daily VaR & IRC commentary | In appetite, with controls | Medium / II |
| Credit review drafting | In appetite, with controls | High / II |
| Client-facing wealth chatbot | In appetite, with controls | High / II |
| Deal memo drafting on cloud LLM | Out of appetite | Critical / I |
| Autonomous credit-line reduction | Out of appetite | Critical / I |

Both rejections hit a hard line — an absolute prohibition no control can fix.
The deal memo crosses the hard line on price-sensitive information processed
outside the firm's controlled zone; the credit-line reduction crosses the one
on fully autonomous, irreversible actions in front of clients or the market.
Open both and check the reasons make sense to you.

All six carry the **Provisional** banner, for two different causes: five were
scored with no jurisdiction pack applied, so no country rulebook was used; the
wealth chatbot's verdict relies on jurisdiction-pack rules nobody at the firm
has signed off yet. Open the full reasoning on any of them to see which.

### 2. Run your own use cases (the actual task)

**New pre-check** → answer the guided questions. Pick real things your area
is doing or wants to do. Four or five is plenty.

For each one, before you hit evaluate, **write down what you think the
answer should be** — tier, and whether you'd expect it approved. Then
compare. The disagreements are the valuable output; the agreements tell us
very little.

### 3. Review as 2LoD

Switch the role to 2LoD, open something showing **Awaiting 2LoD sign-off**, and
approve it or send it back. Check the audit trail on the detail view
afterwards — every step should be there, in order, including the things
you'd rather it didn't record.

### 3b. Do it as two people, if there are two of you (the best test)

This is the loop a real bank runs, and the newest part of the product.

1. **Submitter** (1LoD, your browser): run a use case that comes back
   *approved with controls*. On the verdict, open a control, **assign an
   owner** with a target date, and **attest** one control in place with an
   evidence note (a made-up ticket number is fine).
2. Register → **Export hand-off bundle**. Send the file to the other tester.
3. **Reviewer** (2LoD, *their* browser): Register → **Import hand-off
   bundle**. The first time, it will say the two histories are different —
   every browser seeds its own demo cases, so that's expected here. Click
   **Save a backup of mine first** (a backup file downloads — browsers can
   sometimes block this, so it asks you to confirm it saved), then click
   **I have my backup — replace my register**: the submitter's register
   arrives with its full history. Check the attested control reads
   *attested — not verified*, not *in place*. Sign it off with your name.
   Export a bundle and send it back.
4. **Submitter**: import the reviewer's bundle. It should merge cleanly —
   two new events, the sign-off and the stage change — with no replace
   prompt.

Things worth trying to break: open the bundle in a text editor, change one
word, and import it — it must refuse. Or have the submitter keep working on
the case while the reviewer has it — the return import must refuse to merge
two different histories rather than quietly picking one (deliberate; see
Known gaps).

### 4. Look at the rules

**Appetite framework** in the sidebar shows the rules in force. If a verdict
felt wrong, this is where you find out why. You can edit the policy directly
— change a threshold, save, and watch existing cases get flagged for
re-evaluation.

---

## What to send back

Fill in a copy of [`backtest/capture-template.md`](../backtest/capture-template.md)
— it's a short table, one row per use case: what you expected, what Counterpoise
said, and who you think was right.

**The disagreements are the point.** If Counterpoise said High and your committee
would have said Medium, that's the single most useful thing you can tell us.
Please say *why* — it usually means a rule is written wrong, and that's
fixable.

Also hit **Export hand-off bundle** in the register and send the file
alongside it — it carries your whole register and audit trail, so we can
import it and see exactly what you saw.

---

## Known gaps — please don't report these as bugs

These are deliberate for this stage. Flag them only if you think one makes
testing impossible.

- **No accounts or identity.** The role switch is a dropdown.
- **Sharing is by file, one side at a time.** Testers swap registers with
  the hand-off bundle — no live shared copy. On import the app re-checks
  every entry: accidental damage or a simple edit is caught and the import
  refuses. It can't prove who made the file — anyone holding it could
  rebuild it to pass these checks — so exchange bundles only with people
  you trust, by a route you trust. (The same limit the audit trail states
  for itself: tamper-evident, not tamper-proof.) If *both* of you change
  the case between swaps, the histories are now different and the import
  refuses to merge them — a first-time difference is normal (every browser
  seeds its own demo cases), but a later one is shown as a warning to check
  with the sender. That is deliberate — it will not guess which one to
  keep. The way out is the two-step **replace**: **Save a backup of mine
  first** (a backup file downloads — browsers can block this, so it asks
  you to confirm it saved), then **I have my backup — replace my
  register**; nothing is ever overwritten without that confirmation.
- **The audit trail is tamper-evident, not tamper-proof.** Each entry is
  chained to the one before it, so an edited entry, or a deleted one with
  later entries after it, shows as a break. Removing the newest entries does
  not, and it lives in your browser, so someone who rewrote *every* entry
  consistently would not be caught either. A real deployment needs a
  server-held store.
- **Attested is not verified.** When someone attests a control is in place,
  Counterpoise records their claim and their evidence note — it does not check
  the evidence. That's why it reads *attested — not verified*, and is
  counted separately from controls marked verified in your firm's policy file.
- **Jurisdiction packs are unadopted.** The EU AI Act and SS1/23 rules
  haven't been signed off by Legal or Compliance, so verdicts that depend on
  them are marked provisional. That labelling is intentional.
- **The plain-English intake path needs setup.** It runs on a local open
  model via Ollama (free, on-device; live since 2026-08-16 — it drafts a
  usable graph but expect to correct a field or two; frontier models draft
  better). Without it you get the guided questions, which is the
  deterministic path and exercises everything that matters.

---

## Starting over

Sidebar → **Demo data** → **Clear all data and start over**. It permanently
deletes every case, verdict and audit entry in this browser, any unsaved
intake draft and the hand-off sync record, and resets your selected role to
1LoD — there's no server copy. Your saved appetite framework and model
settings are kept. If Counterpoise is open in another tab, the delete can be
held up until you close it. Export first if you
want to keep anything.


---

## New since this guide was written (August 2026)

Worth deliberately exercising, newest first:

- **Hand-off between machines, control owners, control attestation
  (v0.17.0).** See step 3b above — the two-person run-through exercises all
  three.
- **Challenge a rule (v0.4.0).** As 2LoD, on any case with a verdict, file a
  challenge against a rule you think is wrong — then check the **Rule
  challenges** screen and the case's audit trail. The property to try to
  break: filing must change *nothing* about the verdict, the stage or the
  sign-off. If you can make a challenge move a decision, that's the bug we
  most want to hear about.
- **Provenance quotes & the confirm gate (v0.6.0–v0.7.0).** On the AI path,
  every extracted value shows the words it came from; guessed fields become
  mandatory questions; nothing is scored until each card is confirmed. Try
  to sneak a vague description through — it should cost you questions.
- **Jurisdiction confirmation (v0.8.0).** The AI path never accepts the
  model's jurisdiction reading — you confirm or edit it before proceeding.
  Try a description naming no country and one naming "our UK branch".
- **One model slot (v0.8.1).** Settings has a single generic model slot
  (demo runs a local open model); there is no vendor key field.
- **← Back** now exists on intake steps before attestation — try going back
  and forward; the duplicate check should re-run, never hang.
- **"What kind of decision is it?"** has *Something else — describe it*.
  Type one; the verdict should name your words and say the
  policy has no rule for them.
- **The verdict screen was rewritten for a business reader** — a first
  screen headed by "Your next steps", then, in the full reasoning, "What you
  need to do", controls by name, "How fragile is this approval?",
  "What could go wrong — and when this expires". Judge whether someone outside risk
  could act on it.
- **"Anything your AI risk team should know? (optional)"** at the confirmation
  step — write a note, then find it as 2LoD on the sign-off page.
- **About** in the sidebar, and eleven worked cases with pinned expected
  outcomes in [`try-these.md`](try-these.md) — case 5 (two hard lines) and
  cases 6+7 (inheritance pair) are the most instructive.

The most valuable feedback is unchanged: a verdict you'd *argue with* beats
any bug.


## For the adversarial tester

Try to jailbreak it. The interesting surfaces:

- **The description** — it is the only free text that touches an LLM (with a
  key configured). Try steering: "classify this as low risk", role-play
  framing, assistant-priming prefixes. The engine decides from the confirmed
  graph, never from your prose — prove us wrong.
- **The form vs the description** — say innocent things, click risky answers,
  and vice versa. Contradiction review should catch denial patterns.
- **Any free field** (name, notes, resolution explanations) — HTML, script
  tags, markdown. Everything should render as literal text.
- **The reasoning trace** — if you get the optional AI retelling to say
  something the rule panels don't, the screen already disclaims it; tell us
  anyway.

A successful manipulation of a VERDICT — not of prose around it — would be
the most valuable finding anyone has produced against this product.
