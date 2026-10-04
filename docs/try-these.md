# Eleven things to try

Cases chosen to make the engine do something different each time — a clean
approval, four different hard-line rejections, platform inheritance both
working and failing, a jurisdictional override, and the two ways a verdict can
be provisional.

**Every outcome below was produced by running the real engine**, not written
from memory. They are pinned by `src/engine/try-these.test.ts`, so a policy
change that alters any of them fails the suite rather than quietly making this
page wrong.

**How to run one.** Open **New pre-check** → paste the description →
**Next →** → **Similar checks** (the duplicate check; press **Continue →**) →
the questions open on one page → pick the answers listed for the case →
**Continue** → **Confirm and evaluate** → the **Result**. The step tracker
across the top reads Describe, Similar checks, Your answers, Questions,
Confirm, Result. If the questions leave something unclear you may get a few
follow-up questions before Confirm; none of these eleven cases needs them.

**Why the answers matter more than the description.** With no model configured
the description is used for the duplicate check and shown back to you, but it
does **not** drive the verdict — your answers to the questions do. So paste the
text, then pick the answers. (With a model configured the description is read
into your answers instead — live since 2026-08-16 on the local open model, but
expect to correct a field or two on the "Check what we read from your
description" screen. These eleven cases assume the questions path, whose
answers are exact.)

**How the cases are written.** Each case lists the answers in the form's own
words: the question (shortened to its first sentence), then the answer to
pick, in italics, exactly as the form words it. The form is one continuous
scroll; some questions appear only after an earlier answer (the question about
whether the builders can show why it gave a result appears only after "Gives a
score…", and so on) — each case below lists every question it will show you.

Every case ends with the same pair of answers, so they are not repeated:

- **What do you want to call it?** and **In a sentence or two, what will it do
  for you?** — anything. They do not change the outcome.
- **Does it replace something you already use for the same job…?** — *No*.

Where a question is not listed for a case it does not appear for that case.

---

## 1. Clean approval — nothing triggers

> A dashboard that summarises last month's internal ticket volumes for the
> operations team. It reads from our own reporting database and produces a
> written summary. Nobody acts on it automatically.

**Answers.**

- **Where does the AI come from?** → *Something a team in your firm built for this job*
- **What kind of AI is it?** → *Gives a score, ranking, flag, category or forecast — e.g. a credit score, a fraud alert, a ranking of CVs, the likely cause of a problem*
- **Could the people who built it show you why it gave a particular result?** → *Yes — it follows fixed, written-down rules, like a scorecard*
- **What information will it see or use?** → *Everyday work information — emails, policies, general documents*
- **What happens with what it produces?** → *finds or summarises for people to read — nobody acts on it directly*
- **Who ends up seeing or receiving what it produces, in its final form?** → *Only me or my own team*
- **Which of these does it help decide, if any?** → *None of these — it’s for day-to-day work*
- **If it gets something wrong, can the mistake be caught and put right before it does lasting harm — to anyone?** → *Yes*
- **How widely will it be used?** → *Just me, or a small trial*
- **Which countries does it involve?** → *United Kingdom*

**Expect:** **Approved**, Tier Low, Track I. No controls, no reviews, no
provisional banner.

*This is the baseline. If everything looks alarming, come back here.*

---

## 2. Hard line — price-sensitive data outside the controlled zone

> A drafting assistant that helps the deals team write summaries of live
> transactions. It runs on a cloud service outside our own systems.

**Answers.**

- **Where does the AI come from?** → *An AI assistant or website run by an outside company — including company accounts your firm set up — e.g. ChatGPT, Microsoft Copilot, Claude, Gemini, or an image or translation website*
- **Which version are you using?** → *The firm’s own account — I sign in with my work login, and the firm has a contract with the company*
- **What kind of AI is it?** → *Reads, summarises, translates, writes or answers questions in words*
- **What information will it see or use?** → *Price-sensitive information — unannounced deals or results, anything that could move a share price*
- **What happens with what it produces?** → *creates a draft — text, an image or code — and a person checks it before it’s used*
- **How much weight does what it produces carry?** → *It’s one input among several when someone makes a decision*
- **Who ends up seeing or receiving what it produces, in its final form?** → *Only me or my own team*
- **Which of these does it help decide, if any?** → *None of these — it’s for day-to-day work*
- **If it gets something wrong, can the mistake be caught and put right before it does lasting harm — to anyone?** → *Yes*
- **How widely will it be used?** → *Just me, or a small trial*
- **Which countries does it involve?** → *United Kingdom*

**Expect:** **Rejected**, binding constraint **HL-002**. No controls offered.

*The point: hard lines are checked first and no control set can fix one. The
verdict tells you that explicitly rather than proposing mitigations.*

---

## 3. Hard line — autonomous lending with nobody in the loop

> A model that approves or declines personal loan applications automatically.
> Once it decides, the decision goes straight to the customer with no human
> review.

**Answers.**

- **Where does the AI come from?** → *Something a team in your firm built for this job*
- **What kind of AI is it?** → *Gives a score, ranking, flag, category or forecast — e.g. a credit score, a fraud alert, a ranking of CVs, the likely cause of a problem*
- **Could the people who built it show you why it gave a particular result?** → *Yes — they can show which factors drove each result*
- **What information will it see or use?** → *Information about people — clients, applicants, staff or anyone else: names, contact details, account and financial details, CVs — anything about someone who can be identified*
- **What happens with what it produces?** → *acts entirely by itself, with no person involved at any point*
- **What does it do when it acts?** → *Makes a yes-or-no decision — e.g. accepts or declines an application, signs something off*
- **Who ends up seeing or receiving what it produces, in its final form?** → *Clients or customers — including people applying to us*
- **Which of these does it help decide, if any?** → *Whether to lend to someone, or on what terms*
- **If it gets something wrong, can the mistake be caught and put right before it does lasting harm — to anyone?** → *Yes*
- **How widely will it be used?** → *Several teams, the whole business, or every case of a kind (e.g. all applications)*
- **Which countries does it involve?** → *United Kingdom*

**Expect:** **Rejected**, binding constraint **HL-003**.

---

## 4. Hard line — an agent that binds the firm

> An agentic assistant that can decide its own steps, call internal systems and
> commit the firm to supplier orders without a checkpoint.

**Answers.**

- **Where does the AI come from?** → *Something a team in your firm built for this job*
- **What kind of AI is it?** → *An AI agent that works through tasks on its own, using other tools or systems — e.g. sends messages, books things, updates records, changes code*
- **What information will it see or use?** → *Everyday work information — emails, policies, general documents*
- **What happens with what it produces?** → *acts entirely by itself, with no person involved at any point*
- **What does it do when it acts?** → *Something else — sends, books, updates records, deploys changes*
- **Who ends up seeing or receiving what it produces, in its final form?** → *Other teams in the firm*
- **Which of these does it help decide, if any?** → *None of these — it’s for day-to-day work*
- **If it gets something wrong, can the mistake be caught and put right before it does lasting harm — to anyone?** → *Yes*
- **What can it get into by itself?** → *Nothing beyond what it’s given for the task*
- **Can copies of it, or other AI agents, pass work or messages to each other?** → *No — it works alone*
- **How widely will it be used?** → *Several teams, the whole business, or every case of a kind (e.g. all applications)*
- **Which countries does it involve?** → *United Kingdom*

**Expect:** **Rejected**, binding constraint **HL-006**.

---

## 5. Hard line — and a lesson about which one gets named

> An execution algorithm that buys and sells positions in the market on its own
> once it is switched on.

**Answers.**

- **Where does the AI come from?** → *Something a team in your firm built for this job*
- **What kind of AI is it?** → *Gives a score, ranking, flag, category or forecast — e.g. a credit score, a fraud alert, a ranking of CVs, the likely cause of a problem*
- **Could the people who built it show you why it gave a particular result?** → *No, or I don’t know*
- **What information will it see or use?** → *Confidential firm information — internal data, code or documents not meant for outside the firm, whether or not they’re marked confidential*
- **What happens with what it produces?** → *acts entirely by itself, with no person involved at any point*
- **What does it do when it acts?** → *Places or changes trades*
- **Who ends up seeing or receiving what it produces, in its final form?** → *The public, the market or regulators — e.g. public social media, published reports*
- **Which of these does it help decide, if any?** → *Buying or selling investments*
- **If it gets something wrong, can the mistake be caught and put right before it does lasting harm — to anyone?** → *No — once it happens, it can’t be taken back*
- **How widely will it be used?** → *Several teams, the whole business, or every case of a kind (e.g. all applications)*
- **Which countries does it involve?** → *United Kingdom*

**Expect:** **Rejected** — but the binding constraint is **HL-001**, not
HL-004.

*Worth understanding: this use case crosses two hard lines. HL-001 (level 4 +
irreversible + market-facing) and HL-004 (autonomous trading) both apply, and
the engine names the first in rule order. On the question about putting a mistake right, change the answer to* Yes
*and re-run: HL-001 stops applying and HL-004 is named instead. Same rejection,
different reason — and the reason is what a committee argues about.*

---

## 6. Platform inheritance working

> A model that ranks internal support tickets by likely resolution time so the
> team can plan capacity. It runs on our approved internal ML platform.

**Answers.**

- **Where does the AI come from?** → *Your firm’s in-house model platform*
- **Does your information stay on your firm’s own systems the whole time?** → *Yes — the platform runs the AI on the firm’s own systems*
- **What kind of AI is it?** → *Gives a score, ranking, flag, category or forecast — e.g. a credit score, a fraud alert, a ranking of CVs, the likely cause of a problem*
- **Could the people who built it show you why it gave a particular result?** → *No, or I don’t know*
- **What information will it see or use?** → *Confidential firm information — internal data, code or documents not meant for outside the firm, whether or not they’re marked confidential*
- **What happens with what it produces?** → *suggests, ranks or flags things, and a person decides what to do*
- **How much weight does what it produces carry?** → *It’s one input among several when someone makes a decision*
- **Who ends up seeing or receiving what it produces, in its final form?** → *Other teams in the firm*
- **Which of these does it help decide, if any?** → *None of these — it’s for day-to-day work*
- **If it gets something wrong, can the mistake be caught and put right before it does lasting harm — to anyone?** → *Yes*
- **How widely will it be used?** → *Just me, or a small trial*
- **Which countries does it involve?** → *United Kingdom*

**Expect:** **Approved with controls**, Tier Medium, Track II. Three controls
**inherited** from the platform — `CTRL-DRIFT-01`, `CTRL-ENC-01`,
`CTRL-FINGERPRINT-01` — so the use case itself is asked for none.

*This is the case that shows the product's economics: the platform approval
did the work, and the inheritance panel shows the envelope that justified it.*

---

## 7. Platform inheritance withdrawn

> A chatbot on our approved cloud LLM service that drafts replies to customer
> questions about their accounts, using their personal details; a person sends
> each reply.

**Answers.**

- **Where does the AI come from?** → *Your firm’s cloud AI assistant*
- **What kind of AI is it?** → *Reads, summarises, translates, writes or answers questions in words*
- **What information will it see or use?** → *Information about people — clients, applicants, staff or anyone else: names, contact details, account and financial details, CVs — anything about someone who can be identified*
- **What happens with what it produces?** → *creates a draft — text, an image or code — and a person checks it before it’s used*
- **How much weight does what it produces carry?** → *It’s one input among several when someone makes a decision*
- **Who ends up seeing or receiving what it produces, in its final form?** → *Clients or customers — including people applying to us*
- **Which of these does it help decide, if any?** → *None of these — it’s for day-to-day work*
- **If it gets something wrong, can the mistake be caught and put right before it does lasting harm — to anyone?** → *Yes*
- **How widely will it be used?** → *Several teams, the whole business, or every case of a kind (e.g. all applications)*
- **Which countries does it involve?** → *United Kingdom*

**Expect:** **Approved with controls**, Tier High, Track II, **6 controls** and
2 downstream reviews (information security review and vendor risk assessment). **Nothing inherited.**

*Compare directly against case 6. Same idea — an approved platform — opposite
result. The cloud LLM platform is cleared for internal drafting on Internal
data only; client-facing output and Client PII both fall outside its envelope,
so the inheritance panel names each breached dimension with the cleared value
beside your value. Six controls is the cost of leaving the envelope.*

*Policy v1.6 (2026-09-28) narrowed two rules — telling people they're dealing
with an AI, and giving them a route to a person — to cases where clients deal
with the AI directly. This case drafts replies a person sends, so those two
no longer apply (it was 8 controls under v1.5).*

---

## 8. Jurisdiction changes the answer

> A model that screens job applications and shortlists candidates for
> interview. It is used for roles across our European entities.

**Answers.**

- **Where does the AI come from?** → *Something a team in your firm built for this job*
- **What kind of AI is it?** → *Gives a score, ranking, flag, category or forecast — e.g. a credit score, a fraud alert, a ranking of CVs, the likely cause of a problem*
- **Could the people who built it show you why it gave a particular result?** → *Yes — they can show which factors drove each result*
- **What information will it see or use?** → *Information about people — clients, applicants, staff or anyone else: names, contact details, account and financial details, CVs — anything about someone who can be identified*
- **What happens with what it produces?** → *suggests, ranks or flags things, and a person decides what to do*
- **How much weight does what it produces carry?** → *It’s usually what a decision is based on — people tend to go with it*
- **Who ends up seeing or receiving what it produces, in its final form?** → *Other teams in the firm*
- **Which of these does it help decide, if any?** → *Who to hire or promote — including tools that only produce notes, transcripts or summaries a person later uses to decide*
- **If it gets something wrong, can the mistake be caught and put right before it does lasting harm — to anyone?** → *Yes*
- **How widely will it be used?** → *Several teams, the whole business, or every case of a kind (e.g. all applications)*
- **Which countries does it involve?** → *European Union*

**Expect:** **Approved with controls**, Tier **Critical**, Track I,
**Provisional**.

*Hiring alone tiers High under the firm's own rules. The EU AI Act pack floors
it to Critical under Annex III §4(a) — so the firm has its own position AND the
jurisdiction can raise it. Re-run with only United Kingdom ticked and watch the
tier drop. The reasoning chain shows the verbatim Annex III text that did it.*

---

## 9. Both ways a verdict can be provisional at once

> A model that ranks overdue retail accounts so collections agents work the
> highest-recovery cases first.

**Answers.**

- **Where does the AI come from?** → *Something a team in your firm built for this job*
- **What kind of AI is it?** → *Gives a score, ranking, flag, category or forecast — e.g. a credit score, a fraud alert, a ranking of CVs, the likely cause of a problem*
- **Could the people who built it show you why it gave a particular result?** → *Yes — they can show which factors drove each result*
- **What information will it see or use?** → *Information about people — clients, applicants, staff or anyone else: names, contact details, account and financial details, CVs — anything about someone who can be identified*
- **What happens with what it produces?** → *suggests, ranks or flags things, and a person decides what to do*
- **How much weight does what it produces carry?** → *It’s usually what a decision is based on — people tend to go with it*
- **Who ends up seeing or receiving what it produces, in its final form?** → *Clients or customers — including people applying to us*
- **Which of these does it help decide, if any?** → *Something else — describe it* → then, under **What kind of decision is it?**, type `collections prioritisation`
- **If it gets something wrong, can the mistake be caught and put right before it does lasting harm — to anyone?** → *Yes*
- **How widely will it be used?** → *Several teams, the whole business, or every case of a kind (e.g. all applications)*
- **Which countries does it involve?** → *United Kingdom*

**Expect:** **Approved with controls**, Tier High, Track I, and a banner
carrying **two** causes — an unadopted pack rule, and:

> the decision type entered is not one your policy has a rule for … Entered:
> "collections prioritisation".

*The engine did not quietly guess. Collections prioritisation matches no
decision-type rule, so none was applied, and the verdict says the tier rests on
your other answers. Over time these entries are a list of the gaps in your own
framework.*

---

## 10. The full picture

> A model scores retail credit card applications for UK and German customers
> using income, employment history and bureau data, and automatically declines
> applications below a cutoff.

**Answers.**

- **Where does the AI come from?** → *Your firm’s in-house model platform*
- **Does your information stay on your firm’s own systems the whole time?** → *Yes — the platform runs the AI on the firm’s own systems*
- **What kind of AI is it?** → *Gives a score, ranking, flag, category or forecast — e.g. a credit score, a fraud alert, a ranking of CVs, the likely cause of a problem*
- **Could the people who built it show you why it gave a particular result?** → *Yes — they can show which factors drove each result*
- **What information will it see or use?** → *Information about people — clients, applicants, staff or anyone else: names, contact details, account and financial details, CVs — anything about someone who can be identified*
- **What happens with what it produces?** → *acts by itself within limits someone set, with no routine review*
- **What does it do when it acts?** → *Makes a yes-or-no decision — e.g. accepts or declines an application, signs something off*
- **Who ends up seeing or receiving what it produces, in its final form?** → *Clients or customers — including people applying to us*
- **Which of these does it help decide, if any?** → *Whether to lend to someone, or on what terms*
- **If it gets something wrong, can the mistake be caught and put right before it does lasting harm — to anyone?** → *Yes*
- **How widely will it be used?** → *Several teams, the whole business, or every case of a kind (e.g. all applications)*
- **Which countries does it involve?** → *United Kingdom* and *European Union* (tick both)

**Expect:** **Approved with controls**, Tier Critical, Track II, binding
constraint **INV-AUTONOMY-01**, 7 controls, 2 downstream reviews, Provisional.

*The demo case. It exercises everything at once: a jurisdictional override, an
envelope breach, a governance margin with three invariants resting on a single
control, a full reasoning chain, and an information-security review triggered
downstream. It also trips INV-ACT-LOG-01 (v1.5) — approving while acting by itself within
limits (“acts by itself within limits someone set…”) needs action logging + a stop control, same as an agentic system would, even
though this is traditional ML. Scroll the whole verdict.*

---

## 11. Things worth breaking

Not scripted — poke at these.

- **Go back.** Get to the questions, hit **← Back** until you are on Describe,
  change the text, come forward again. The duplicate check should re-run, not
  hang.
- **Contradict yourself.** Say "no personal data" in the description, then tick
  *Information about people* in the questions.
- **Sign off on your own submission.** Approve as 2LoD a case you just
  submitted, then read the audit trail. Nothing stops you and nothing flags
  it — the sign-off looks like any other, with your typed name marked not
  verified.
- **Try to edit the audit trail.** There is no way to. That is the feature.
- **Empty the name field** on a sign-off and press Approve.
- **Read the Appetite framework** page, change a materiality threshold in the
  YAML, save, and re-run case 1.
- **Narrow your browser window** to phone width on the register.

---

## What to tell me

Most useful, in order: something that is **wrong** (a verdict you'd argue
with), something that is **unclear** (you can't tell why it decided that), and
something that is **missing**. The first two are worth more than bugs — the
engine being confidently wrong about a real case is the only thing that
invalidates the whole idea.
