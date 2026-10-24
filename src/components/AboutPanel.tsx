// The live link drops visitors into "New pre-check" with no context; the
// README and its diagrams live on GitHub where most visitors never go
// (2026-08-15). This screen is the app answering the three questions every
// first-timer has — what is this, who wrote the rules, is an AI judging me.
//
// Copy rule: never the words "appr*ved" or "rej*cted" (BC-V12B-03 — the
// acceptance suite holds a single-match guard over the verdict, and this
// session walked into it three times). Say "inside appetite" / "outside
// appetite" instead, which is also the more precise language.
// Rule 4 (cross-cutting.md §7): presentation-only.
// CR7-36 / BC-005. "Out of the box" is a statement about the policy file that
// ships with the app, so the counts are read from that file — not typed here
// (the typed 18 had gone stale: the file has more), and not from the firm's
// own edited copy.
import shippedPolicyYaml from '../../policy/appetite.yaml?raw';
import { loadPolicy } from '../store/policy';
import { R18_COPY } from './plain-copy';

const shipped = loadPolicy(shippedPolicyYaml);
const SHIPPED_HARD_LINES = shipped.valid ? String(shipped.policy.hard_lines.length) : 'several';
const SHIPPED_APPETITE_RULES = shipped.valid ? String(shipped.policy.invariants.length) : 'a full set of';

interface AboutPanelProps {
  onNavigate: (view: 'intake' | 'register' | 'policyEditor') => void;
}

export default function AboutPanel({ onNavigate }: AboutPanelProps) {
  return (
    <section aria-label="About Counterpoise" className="about-panel">
      <h1>What this is</h1>
      <p>
        A bank writes down what AI risk it will and will not accept — its <strong>risk appetite</strong>.
        Counterpoise turns that document into executable rules, so that asking &ldquo;can we build this AI
        tool?&rdquo; takes minutes instead of months: describe the use case, answer a short set of
        questions, and get a verdict — inside appetite, inside appetite with named controls, or outside
        appetite — with the exact rule and regulation behind every step.
      </p>
      {/* design-review round 4 (Panel G — Rule challenges + About,
          Minor): the primary CTA used to be the very last element on the
          page, after ~1000 words — a skeptical-but-busy reader could
          abandon before reaching it. Kept at the bottom too (nothing
          deleted); this is the early affordance for anyone who wants to
          skip straight to trying it. */}
      <p>
        <button type="button" className="about-panel__link about-panel__cta" onClick={() => onNavigate('intake')}>
          Run your first pre-check →
        </button>
      </p>

      <h2>No AI is in the decision</h2>
      <p>
        The verdict is computed by deterministic rules: the same answers produce the same verdict, every
        time. An optional AI model helps only at the edges — reading a plain-language description into a
        structured form, which you then check and correct yourself. Nothing it writes is used until a
        person confirms it. This is also the security posture: with no model in the decision path,
        there is no model to jailbreak into a verdict — adversarial text can at most mis-propose,
        never decide.
      </p>
      <p>{R18_COPY.ABOUT_MODEL_PARAGRAPH}</p>

      <h2>It comes with rules — you bring the authority</h2>
      <p>
        A common first question: &ldquo;if my firm has no appetite document, does this app have no
        rules?&rdquo; The opposite. Out of the box it carries a complete working ruleset —{' '}
        {`${SHIPPED_HARD_LINES} hard lines, ${SHIPPED_APPETITE_RULES} appetite rules`}, the full tiering and control machinery — derived from a regulator-grounded
        template, and it produces real verdicts with zero configuration.
      </p>
      <p>
        What it does <em>not</em> come with is <strong>authority</strong>. Rules and authority are
        deliberately separate: the rules enforce from the first click, but every verdict is stamped
        provisional until someone at your firm says &ldquo;these rules are ours.&rdquo; Same rules,
        same verdicts — the stamp is the only thing adoption removes. A bank must own its appetite, so
        the app ships a complete one and makes owning it a deliberate act instead of a default.
      </p>

      <h2>The three levers</h2>
      <p>
        Every verdict traces to exactly one of three sources — and they do not all have the same power.
        <strong> Appetite decides. Law decides, where it applies. Knowledge only challenges.</strong>
      </p>
      <ul>
        <li>
          <strong>The firm&rsquo;s own appetite</strong> — decides. A framework signed off at board
          level, translated into a plain, commented rules file a risk manager can read and edit.
        </li>
        <li>
          <strong>Jurisdiction packs</strong> — decide, where the law applies. SS1/23 (UK), SR 26-2 (US),
          the EU AI Act and DORA, each rule quoting the verbatim regulatory text it derives from, each
          pack requiring a named human sign-off. Until your firm adopts a pack, verdicts that rely on it
          are marked provisional — the tool says so rather than hiding it.
        </li>
        <li>
          <strong>Risk knowledge</strong> — informs, never decides. A curated lens against the{' '}
          <a href="https://airisk.mit.edu/" target="_blank" rel="noreferrer">
            MIT AI Risk Repository
          </a>
          &rsquo;s public domain taxonomy (CC BY 4.0). Where a use case&rsquo;s shape matches a known risk
          class the firm&rsquo;s own rules are silent on, it says so beside the verdict — and one tap
          files that gap into the rule-improvement queue for a human rule-author to consider. Its schema
          has no field capable of expressing a tier, control, or verdict effect; it cannot decide even by
          accident.
        </li>
      </ul>
      <p>
        <button type="button" className="about-panel__link" onClick={() => onNavigate('policyEditor')}>
          Read the rules in force →
        </button>
      </p>

      <h2>The sign-offs, in one minute</h2>
      <p>
        Everything provisional in this app traces to one principle: when a supervisor asks &ldquo;why
        did you decide that?&rdquo;, a <em>person</em> must answer — a tool cannot. So every judgement
        has a named owner, and there are only three kinds:
      </p>
      <ul>
        <li>
          <strong>Pack sign-off</strong> — a named function (Legal, Model Risk, Technology Risk) reads
          a regulation pack against its quoted source text and signs the firm&rsquo;s reading of that
          law. <em>Once per regulation</em> — not per rule, not per use case — and revisited only when
          the cited text changes.
        </li>
        <li>
          <strong>Translation attestation</strong> — one person confirms the rules file matches what the
          board signed off. <em>Once</em>, with a periodic refresh. This is what the header&rsquo;s
          &ldquo;translation fidelity&rdquo; badge is waiting for.
        </li>
        <li>
          <strong>Second-line sign-off</strong> — a reviewer clears an individual use case above the
          self-service tier. The only <em>recurring</em> one, and it is the reviewer&rsquo;s existing
          day job — the app just hands them the evidence pre-assembled.
        </li>
      </ul>
      <p>
        The first two are a single afternoon, once. After it, every &ldquo;pending adoption&rdquo;
        label in this app goes quiet permanently. The demo deliberately ships in the un-signed state,
        because faking those signatures would be exactly the kind of claim this product exists to
        refuse.
      </p>

      {/* v0.4.0. Copy rule holds here too: no "appr*ved"/"rej*cted". */}
      <h2>When a rule is wrong, say so — on the record</h2>
      <p>
        Reviewers applying rules to real cases are the first to notice when a rule is too broad or
        misses a real-world distinction. A second-line reviewer can <strong>challenge a rule</strong>{' '}
        from any sign-off page: name the rule, say why, sign it. The challenge is permanent, and it
        changes <em>nothing</em> about the verdict — dissent here is evidence for the people who
        author the rulebook (collected under <strong>Rule challenges</strong> in the sidebar), never
        an override. Rules change the way they always have: a human edits them, and signs off.
      </p>

      <h2>The fastest way to understand it</h2>
      <p>
        On first launch, Counterpoise submitted itself through its own gate — the tool judged the tool. Its
        verdict sits in the register alongside every other use case, with the same citations and the
        same audit trail. Open it, and you have seen the whole product.
      </p>
      <p>
        <button type="button" className="about-panel__link" onClick={() => onNavigate('register')}>
          See Counterpoise&rsquo;s own self-assessment →
        </button>
      </p>

      <h2>What it deliberately is not</h2>
      <ul>
        <li>Not a chatbot, and not a document generator.</li>
        <li>It does not write your risk appetite — it enforces the one you give it.</li>
        <li>
          It does not replace security, vendor or legal review — it triggers those as named downstream
          steps when a use case requires them.
        </li>
        <li>
          This version runs entirely in your browser: nothing you enter leaves this machine. The audit
          trail is hash-chained — an edited event, or a deleted event with later events after it,
          breaks the chain, and every sign-off page runs a live check for that. Removing the newest
          events can&apos;t be detected from inside this browser, and a full, consistent rewrite by
          someone with access to this machine can&apos;t be ruled out either — that needs an external,
          write-once store, which this version does not have.
        </li>
      </ul>

      <p>
        <button type="button" className="about-panel__link about-panel__cta" onClick={() => onNavigate('intake')}>
          Run your first pre-check →
        </button>
      </p>
    </section>
  );
}
