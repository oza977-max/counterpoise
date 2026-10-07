# Counterpoise — Cross-Cutting Specification

**Version:** 1.0  
**Date:** June 2026  
**Status:** Draft  
**Covers:** Tech stack, project structure, module conventions, error handling, TypeScript standards, testing approach, build configuration

---

## Expert Panel

| Expert | Work | Role in This Document |
|--------|------|-----------------------|
| Dan Vanderkam | *Effective TypeScript* (2nd ed., O'Reilly 2024) | TypeScript standards — strict typing, discriminated unions, interface design |
| Dan Abramov / React Core Team | react.dev | React conventions — component composition, state lifting, unidirectional data flow |
| Kent C. Dodds | Testing Library (testing-library.com) | Testing conventions — behaviour-first, user-interaction testing |
| Kent Beck | *Test-Driven Development: By Example* (Addison-Wesley 2002) | TDD discipline — red-green-refactor, test-first |
| Andrew Hunt & David Thomas | *The Pragmatic Programmer* (20th anniversary ed., 2019) | DRY, no hardcoded secrets, tracer bullets |
| Martin Fowler | *Patterns of Enterprise Application Architecture* (Addison-Wesley 2002) | Module boundaries, anti-bloat, Repository pattern |
| Robert C. Martin | *Clean Code* (Prentice Hall 2008) | Single responsibility, error handling, naming |
| Mike Cohn | *Agile Estimating and Planning* (Prentice Hall 2005) | Vertical slicing — first runnable slice governs chunk ordering |

---

## 1. Architecturally Significant Requirements Addressed

| ASR | Requirement | Decision forced |
|---|---|---|
| Client-side only | NF-3, NF-4 | No server, no backend — everything in the browser |
| Deterministic engine | NF-1, PE-1 | Engine is a pure function — no LLM in evaluation path |
| LLM at edges only | UC-3, NF-1 | Anthropic SDK used only for graph extraction and reasoning trace |
| No install for end users | NF-4 | Build output is a `dist/` folder served by any static server |
| TypeScript strict | (stack constraint) | Strict mode, no `any`, discriminated unions for domain types |

---

## 2. Tech Stack

### ADR-001: React + Vite + TypeScript as the application framework

**Decision:** React 18 + Vite 5 + TypeScript 5.x (strict mode). No server-side rendering. Single-page application.

**Status:** Accepted

**Context:** Counterpoise is a browser-only governance tool (NF-3, NF-4). No backend. Must run from a `dist/` folder served by any static server or opened via `file://` with a local web server. The intake flow, graph editing UI, and register view are sufficiently complex to benefit from a component model. No server components — all components are client components.

**Options considered:**
1. **Vanilla TypeScript + Vite** — zero framework overhead, but complex multi-step flows (intake wizard, graph editor, register) require significant hand-rolled UI plumbing. Increases build time substantially.
2. **React + Vite + TypeScript** — standard React 18 component model; Vite builds to a static `dist/`; Testing Library for behaviour-first tests; well-understood patterns.
3. **Preact + Vite + TypeScript** — 3kb bundle vs ~45kb React. Acceptable trade-off but less ecosystem support and not preferred by stack constraints.

**Decision:** React + Vite + TypeScript. The component model is proportionate to the UI complexity. Bundle size is not a constraint for a local governance tool.

**Consequences:** All components are client components (no RSC). State managed with React's built-in hooks + Zustand for cross-component state (register, verdict). No SSR complexity.

---

### Core library choices

| Concern | Library | Version | Rationale |
|---|---|---|---|
| YAML parsing | `js-yaml` | ^4.1 | De-facto standard; types included via `@types/js-yaml` |
| IndexedDB | `idb` | ^8.0 | Typed Promise wrapper over IndexedDB; used by WHATWG; OQ-2 resolution |
| Form management | `react-hook-form` | ^7.x | Performance-first; minimal re-renders; Zod integration |
| Schema validation | `zod` | ^3.x | Runtime validation + TypeScript type inference from schema |
| LLM integration | `@anthropic-ai/sdk` | ^0.39+ | Browser-compatible (`dangerouslyAllowBrowser: true`); model: `claude-sonnet-4-6` |
| ID generation | `uuid` | ^9.x | RFC 4122; v4 for use case IDs, verdict IDs |
| State management | `zustand` | ^4.x | Minimal cross-component store; no boilerplate |
| Testing | `vitest` + `@testing-library/react` | latest | Vite-native test runner; Testing Library for behaviour-first tests |
| YAML diff (for pack updates) | `deep-diff` | ^1.0 | For RA-10 diff mechanics (V1.5) — include schema now |

**No UI component library.** Counterpoise uses custom components styled with plain CSS. The Tufte/Few design system (from the requirements + health report HTML) sets the visual language. No Tailwind, no MUI, no Radix — keeps the bundle lean and the styling deterministic.

---

## 3. Project Structure

```
aigate/                         # Project root
├── index.html                  # Vite entry point
├── vite.config.ts              # Vite config (base: './' for file:// compatibility)
├── tsconfig.json               # TypeScript strict mode
├── package.json
├── policy/                     # Policy files (user-editable, not bundled)
│   ├── appetite.yaml           # Main policy file (starter config)
│   └── packs/
│       ├── sr-26-2.yaml
│       ├── ss1-23.yaml
│       ├── eu-ai-act.yaml
│       ├── osfi-e23.yaml
│       ├── mas-feat.yaml
│       ├── dora.yaml
│       └── fsa-japan.yaml
├── src/
│   ├── main.tsx                # React entry point
│   ├── App.tsx                 # Root component + router
│   ├── engine/                 # Policy engine — pure functions, no React
│   │   ├── evaluate.ts         # Main evaluation pipeline (PE-1 through PE-6)
│   │   ├── greedy-solver.ts    # Minimal control set solver (CS-1, CS-2)
│   │   ├── workflow-router.ts  # Tier-to-governance-stage routing (LC-2)
│   │   ├── jurisdiction.ts     # Jurisdiction override pack application
│   │   ├── contradiction.ts    # Graph contradiction detection (UC-5, OB-2)
│   │   └── types.ts            # Shared engine types (Graph, Verdict, Policy, etc.)
│   ├── llm/                    # LLM boundary — only caller of Anthropic SDK
│   │   ├── graph-extractor.ts  # UC-3: description → data-flow graph
│   │   ├── reasoning-trace.ts  # VD-8: verdict → plain-English trace
│   │   └── client.ts           # Anthropic SDK wrapper (API key management)
│   ├── store/                  # Persistence
│   │   ├── db.ts               # IndexedDB schema + idb setup
│   │   ├── policy.ts           # Parse + validate YAML policy + packs
│   │   ├── register.ts         # Use case register (graph model) — RG-1
│   │   ├── role.ts             # localStorage 1LoD/2LoD role toggle
│   │   └── audit.ts            # Append-only audit trail — NF-2, VD-4
│   ├── components/              # React components (flat — matches implementation-guide.md chunk deliverables)
│   │   ├── IntakeFlow.tsx       # UC-1 through UC-7, UC-3a — 9-state machine
│   │   ├── GraphReview.tsx
│   │   ├── QuestionnaireStep.tsx
│   │   ├── ContradictionReview.tsx
│   │   ├── ConfirmationStep.tsx
│   │   ├── StructuredForm.tsx   # UC-3a fallback
│   │   ├── VerdictDisplay.tsx   # VD-1 through VD-8
│   │   ├── ReasoningTrace.tsx
│   │   ├── CorrectionFlow.tsx
│   │   ├── RegisterView.tsx     # RG-1 through RG-5
│   │   ├── UseCaseDetail.tsx
│   │   ├── SettingsPanel.tsx    # CF-1 through CF-5, API key
│   │   ├── PriorityChip.tsx     # Shared
│   │   ├── StatusBadge.tsx
│   │   ├── AuditTrail.tsx
│   │   └── __tests__/           # Co-located component tests
│   └── hooks/                  # Custom hooks
│       ├── usePolicy.ts        # Load + validate policy file
│       ├── useRegister.ts      # Register CRUD via IndexedDB
│       └── useRole.ts          # Role context (1LoD / 2LoD)
├── public/                     # Static assets
└── dist/                       # Build output (gitignored)
```

**Key structural rule:** `src/engine/` has zero React imports. It is pure TypeScript. This enforces the determinism requirement (NF-1) — the engine is testable in isolation without React render infrastructure. The `src/llm/` directory is the only place the Anthropic SDK is imported.

---

## 4. TypeScript Standards (Vanderkam)

- **Strict mode enabled** in `tsconfig.json`: `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`
- **Discriminated unions** for all domain status types:
  ```typescript
  type VerdictStatus = 'approved' | 'approved_with_controls' | 'rejected';
  type Tier = 'Critical' | 'High' | 'Medium' | 'Low';
  type Track = 'I' | 'II' | 'III';
  type LifecycleStage = 'Idea' | 'Exploring' | 'Pre-checked' | 'Approved' | 'In Production' | 'Monitored' | 'Retired';
  ```
- **No `any`** — use `unknown` + type guard functions for external data (YAML parse results, LLM responses)
- **Interfaces for shared domain objects** (Policy, Graph, Verdict, UseCase, AuditRecord) — placed in `src/engine/types.ts`
- **Zod schemas** for all external boundaries (YAML policy parse, LLM response parse, IndexedDB read) — Zod schema IS the runtime validator AND the TypeScript type source

---

## 5. Error Handling Conventions (Martin, McConnell)

### Engine errors
The engine uses a `Result<T, E>` pattern (no exceptions in the evaluation path):

```typescript
type Result<T, E = EngineError> = 
  | { ok: true; value: T }
  | { ok: false; error: E };

type EngineError = 
  | { kind: 'policy-invalid'; field: string; reason: string }
  | { kind: 'hard-line-tripped'; invariantId: string; path: string }
  | { kind: 'no-control-set'; unsatisfiableInvariant: string }
  | { kind: 'jurisdiction-conflict'; packs: string[]; reason: string };
```

Engine functions never throw — they return `Result`. The UI layer handles `ok: false` cases.

### LLM errors
LLM calls can fail (network, rate limit, invalid key). The `src/llm/client.ts` wraps all SDK calls in try/catch and returns `Result<T, LlmError>`. If any LLM call fails, the UI falls back to the structured form (UC-3a) or flags the error — it never propagates an unhandled exception.

### Policy load errors (CF-5)
Policy validation errors are surfaced at startup via the `usePolicy` hook. If the policy is invalid, the hook returns `{ valid: false, errors: PolicyValidationError[] }` and the App renders a banner above whatever screen is showing (heading "Policy file invalid") naming each invalid field to the roles that can fix it. Evaluation is disabled until the error is resolved. CR8-13 changes who sees the field paths (§13b).

**Amended (GT7, 2026-10-04).** The start-up gate also covers the regulatory rules packs. A pack that fails to load adds the loader's own reason to the same banner list. `loadPackSet(sources)` (`src/store/pack-source.ts`) is the one loader: App, IntakeFlow, RegisterDetail and SettingsPanel all load packs through it, so no screen can drop a broken pack quietly while another keeps checking (PolicyEditor calls `loadPacks` directly so it can show each jurisdiction's error in full). The reason names the pack, the rule id when the problem is inside a rule, and the field path, e.g. `pack SS1-23 rule BAD-1 rejected: missing/invalid field "rules.0.source.text" — …`; the banner shows it verbatim, as a raw list item, to the 2LoD role and on the Appetite framework screen, and every other role and screen still sees the one plain sentence. The heading stays "Policy file invalid". While a pack failure is outstanding, nothing is written: evaluation is refused (the Continue gate on the review screen and the Confirm step, with the same plain policy-problem message and the detail to the console), "Use the earlier result" is refused, "Mine is different" is refused when it would record a dismissed match, both Settings sample-data seeds are refused, and App does not run the Counterpoise self-assessment seeding. The load is whole-pack: a rejected pack is absent, the rest still load. TC-CF-5-02, TC-CF-5-02b to -02j, TC-RA-7-01 (`test-cases-032.md`).

### UI errors
React error boundaries at the route level. Each major view (intake, verdict, register) has its own error boundary. Errors are shown as user-readable messages, never as stack traces.

**As built (CR6-04, 2026-10-03).** One boundary exists so far: `ErrorBoundary.tsx` wraps the intake flow in `App.tsx`, the view holding unfinished work that a stale saved draft could crash on every reload. A render-time crash there shows a plain message that claims only that anything already saved is on the register, and a "Start a fresh check" button that clears both saved drafts before remounting (TC-CR6-04c, 04d, 04e; `intake-flow.md` §3). The verdict and register views are not separately wrapped yet, so the sentence above is the target, not the current state. Engine failures shown on the intake screens use `engineErrorMessage(kind)` (`plain-copy.ts`): a plain sentence per engine error kind that blames the firm's rules or policy, never the person's answers (CR6-12).

**User-facing error copy (CR7-37, 2026-10-04).** A policy problem is shown to a submitter as one plain sentence — "Your firm's rules file has a problem, so this can't be checked right now. Nothing about your answers is at fault — your AI risk team can fix it in the Appetite framework screen." — never as field paths or checker reasons. The detail goes to the console for whoever fixes the policy (`intake-flow.md` §3; TC-CR7-37). The sentence is one constant, `POLICY_PROBLEM_MESSAGE` in `plain-copy.ts`, beside `engineErrorMessage`; `IntakeFlow.tsx` imports it and keeps no copy (TC-CR7-37-place).

---

## 6. Testing Conventions (Beck, Dodds)

### Test locations
Tests co-located with source:
```
src/engine/evaluate.ts
src/engine/evaluate.test.ts   ← same directory
```

### Test layers

| Layer | What to test | How |
|---|---|---|
| Engine (pure functions) | Evaluation correctness, solver correctness, jurisdiction logic | Vitest unit tests — no React, no mocks |
| LLM boundary | Graph extraction + reasoning trace | Mock Anthropic SDK; test prompt construction and response parsing |
| Store | IndexedDB read/write, append-only constraint | Vitest with fake-indexeddb |
| UI components | User interactions, form flows, verdict display | Testing Library — find by role/label, simulate user events |
| Integration | Full intake → evaluation → verdict → register cycle | Vitest + Testing Library + mocked LLM |

### Key rules (Beck, Dodds)
- Write the failing test first (TDD discipline for engine functions)
- Test the public interface, not internals — `evaluator.test.ts` tests `evaluate(graph, policy)`, not internal helper functions
- No `any` in test assertions — typed assertions against typed results
- `describe` block names describe the scenario; `it` names describe the expected behaviour

**Long intake UI tests under load (FX7-6, CR7, 2026-10-04).** The intake UI tests re-render the whole app on every keystroke, so typing a long description made the long flows run past vitest's 5 second default on a loaded machine. Test files only; the global timeout is unchanged. Where typing is not what a test is about, it fills a long text with one paste (`fillText`, `src/components/__tests__/fillText.ts`) and uses userEvent `delay: null`. A per-test budget is allowed only with a written reason: `SLOW_FLOW_MS` (15 s) for the multi-screen flows, and `DUP_CHECK_WAIT` (5 s) for the wait after the duplicate check, which reads the whole register and is the first wait to watch if the register grows. No assertion was weakened and no test id changed (`build/handovers/FX7-6-results.md`).

---

## 7. Module Boundary Rules

**Rule 1 — Engine is a pure island:** `src/engine/*` imports only from `src/engine/types.ts` and standard TypeScript types. No React, no idb, no Anthropic SDK, no browser APIs.

**Amended 2026-10-03 (CR6, B-15).** `buildGraphFromForm` no longer reads a clock inside the engine: it takes the timestamp as a parameter and every caller (the form, the seed cases) passes it, so identical inputs and timestamp build an identical graph (TC-CR6-B15).

**Amended 2026-10-03 (ENG-ID).** The ids followed: `buildGraphFromForm(values, extractedAt, newId)` no longer calls `crypto.randomUUID()`. The caller passes `newId`, an id source (the form and the seed cases pass `() => crypto.randomUUID()`), and the engine draws from it in a fixed order — graph, processing node, output node, then each input node — so identical values, timestamp and id sequence build a byte-identical graph (TC-ENG-ID-01..03). No production file under `src/engine/` now reads a clock, draws a random number or mints an id, and `engine-boundary.test.ts` checks that mechanically by reading each file's syntax tree: `Date.now()`, `new Date()` with no arguments, `Math.random()`, `performance.now()` and any use of `crypto` fail the build (TC-ENG-ID-04/05). Date arithmetic on a value passed in, such as `new Date(Date.UTC(...))`, stays allowed.

**Rule 2 — LLM boundary is isolated:** `src/llm/*` is the only place the Anthropic SDK is imported. Nothing in `src/engine/*` or `src/store/*` calls the LLM.

**Rule 3 — Store is persistence-only:** `src/store/*` handles IndexedDB reads and writes. No evaluation logic, no LLM calls, no React imports.

**Rule 4 — UI is presentation-only:** `src/components/*` renders state and calls engine/store functions. No evaluation logic inline in components. Business logic lives in engine or store.

**Dependency direction:** `ui → store`, `ui → engine`, `ui → llm`. Never: `engine → ui`, `store → engine`, `llm → store`.

**R16-F §5 (DR7-06).** `src/engine/plain-intake.ts` imported question-text helpers and types (`findQuestion`, `makeAssumption`, `QuestionId`, `PlainAnswers`) straight from `src/components/plain-copy.ts` — a live `engine → ui` violation with no lint rule to catch it. Fixed by moving the ids/keys the mapping needs (`QuestionId`, `PlainAnswers`, and a new `AssumptionRef` type) into `src/engine/plain-questions.ts`; `plain-copy.ts` (which keeps every WORD — question text, option text, assumption sentences) imports them back and re-exports them, so existing component imports are unaffected. The engine now returns assumption *references* instead of worded assumptions; `plain-copy.ts`'s `describeAssumptions()` is the one place a reference becomes a worded `Assumption`. A guard test (`src/engine/engine-boundary.test.ts`) reads every import in every non-test file under `src/engine/` — `import`, `import type`, `export … from` and `import()`, through TypeScript's own pre-processor (`ts.preProcessFile`), so an import written across several lines is seen too (the first version read one line at a time and missed that; found by R16-F's review pass 1) — and fails if any resolves into `src/components/` — mechanical enforcement of Rule 1, where a review previously had to catch this by reading every import by hand. Test files under `src/engine/` are deliberately out of scope for the guard: `backtest-parity.test.ts`/`backtest-parity-nonblind.test.ts` legitimately resolve a worked case's plain-English answers back to engine keys via `plain-copy.ts`'s word→key lookups, which exist only component-side — a test-layer integration concern (§6's table above already allows an "Integration" layer spanning boundaries), not a production purity violation.

---

## 8. Vite Configuration

```typescript
// vite.config.ts
export default {
  base: './',           // Relative paths — required for file:// compatibility (NF-4)
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom'],
          'engine': ['js-yaml', 'uuid'],
        }
      }
    }
  }
}
```

`base: './'` is critical — without it, Vite generates absolute paths (`/assets/...`) that break when opened from a local file system.

---

## 9. API Key Management

The Anthropic API key is stored in `localStorage` under the key `aigate:api-key`. It is:
- Never hardcoded or committed to git (`.gitignore` does not apply — it's in the browser)
- Never sent to any server other than `api.anthropic.com` (via the SDK)
- Displayed as a masked input (`type="password"`) in the Settings panel
- Read by `src/llm/client.ts` at call time — not stored in React state

The `dangerouslyAllowBrowser: true` flag in the Anthropic SDK is used explicitly because the user has been informed that their key choice determines data handling (per NF-3 and the README). This flag is deliberate, not a security oversight.

---

## 10. Role Context

There is no authentication in MVP (NF-4 / no-backend constraint). Role is a configurable toggle stored in `localStorage` under `aigate:role`, with values `'1LoD'` or `'2LoD'`. The `useRole` hook reads this value. The Settings panel provides a role selector.

This is explicitly a governance-tool trust model: the tool trusts the user to select their role honestly. True authentication is V2.

---

## 11. Requirement Traceability

| Requirements covered | Notes |
|---|---|
| NF-1, PE-1 | Engine pure function convention enforces determinism |
| NF-3 | No backend; API key in localStorage; no outbound calls except user's API key |
| NF-4 | `base: './'` in Vite config; runs from local file |
| CF-5 | Policy validation at startup; `usePolicy` hook; error screen on invalid policy |
| UC-3a | `StructuredForm.tsx` — fallback when no API key configured |
| OQ-1 | Anthropic `claude-sonnet-4-6` — resolved |
| OQ-2 | `idb` library for IndexedDB — resolved |
| OQ-3 | Role toggle in `localStorage` + Settings panel — resolved (minimal 2LoD mechanism) |

## 12. Open Questions Resolved

| OQ | Resolution |
|---|---|
| OQ-1 (LLM provider) | Anthropic `claude-sonnet-4-6`; fallback to structured form if no key |
| OQ-2 (Register persistence) | IndexedDB via `idb` library |
| OQ-3 (2LoD mechanism) | Role toggle in localStorage + Settings panel; role-filtered register view |
| OQ-4 (Duplicate detection) | LLM semantic comparison if API key present; exact-match + tag fallback otherwise |
| OQ-5 (Audit export format) | JSON primary; CSV secondary (RG-5) |

---

## 13. Local data and the reasoning-trace call (CR7, 2026-10-04)

**Clear all data (Settings, "Local data").** Everything Counterpoise stores lives in this browser. Clearing deletes the audit and register databases, the role, the hand-off sync marker, the welcome flag and the unsaved intake drafts (CR8-16 spells out how the messages name these, §13b). The drafts are cleared on an incomplete reset too, and the message for an incomplete reset says exactly what was and was not cleared. (CR9, 2026-10-04) When the reset ends incomplete, the header's role selector also goes back to 1LoD at once (CR9-13: state only — the stored role key was already removed by the reset, so nothing is written; before, the selector kept showing the old role until a reload; a reviewer-only screen falls back to intake). The same message names the stores in plain words, "your audit trail", "your register of use cases" and, for anything else, "some stored data" — never an internal database id (CR9-14). TC-CR9-13, TC-CR9-13-1, TC-CR9-14; TC-CR8-16b and TC-CR7-15-3 amended. It keeps the model settings and the saved appetite framework, which are the firm's configuration rather than test data. A database delete that another tab's connection blocks waits up to 3 seconds for that connection to close before it reports the block, because this tab's own handles close a moment after the request (TC-CR7-15, 20).

**The reasoning-trace call.** It runs inside the case lock, so a stalled call would hold the case. The SDK call carries a 15 second timeout and no retries (TC-CR7-19).

## 13a. Contrast tokens and the About page (CR7, 2026-10-04, wave 2)

**Contrast (CR7-08).** The faint-text and warning-text colours were too light to read comfortably. In `App.css`, `--ink-faint` is now `#686253` and `--warn-text` is `#7a5a22`, and a new token `--control-border` (`#7d7869`) is the border of form controls. Small text must reach at least 4.5:1 against every background it sits on (the card, the page, the cream band and the warning band), and a form-control border at least 3:1 against the card and the page. A token test, `app-css.cr7-fx4.test.ts`, reads the `:root` tokens from `App.css` and fails if any pair drops below those ratios (TC-CR7-08).

**About page (CR7-36).** The sentence saying how many hard lines and appetite rules the app ships with is computed from the shipped `policy/appetite.yaml` (read at build time and loaded through `loadPolicy`), not typed in and not taken from the firm's edited policy: a firm that edits its own rules does not change what the page says it shipped with. If the shipped file cannot be loaded the sentence falls back to words with no number (TC-CR7-36, 36-1).

## 13b. Clear-all wording, the policy banner and the header tagline (CR8, 2026-10-04)

**Clear all data names everything (CR8-16).** The confirmation, and the message for an incomplete reset, now name everything the reset clears: every use case, verdict and audit event in this browser; any unsaved intake draft; the selected role (it goes back to 1LoD); the record of past hand-off syncs; and the welcome-panel dismissal (the welcome panel shows again). They also name what is kept: the model settings and the saved appetite framework. They say that a delete held up by another tab can be held up until that tab closes and may still finish afterwards (TC-CR8-16a, 16b). The localStorage keys `reset.ts` clears are exactly the ones the messages name; a test reads them both so they cannot drift (TC-CR8-16c). This extends §13, which said the incomplete message "says exactly what was and was not cleared" without listing the items.

**The app-wide policy banner (CR8-13).** The banner keeps its heading "Policy file invalid — evaluation is disabled until this is resolved." on every screen and for every role. The raw field paths under it are shown only to the 2LoD role and on the Appetite framework screen, where the file is edited. Every other role on every other screen sees one plain sentence instead: "Your AI risk team needs to fix the firm's rules file before checks can run." The sentence has its own wording, so it never repeats the intake alert's policy sentence. TC-R16-A1-62 is re-scoped to the 2LoD role, TC-R16-A1-63 and TC-R16-F-59 assert the plain sentence in the default view and that the raw path is absent, and TC-CR8-13 checks a 1LoD submitter sees the plain message (§5, `intake-flow.md` §3).

**Amended (GT7, 2026-10-04).** A pack load failure is one more list item under this same banner (see CF-5 above); the heading, the plain sentence for other roles and the 2LoD/Appetite-framework-screen rule are unchanged.

**The header tagline contrast (CR8-12).** The tagline chip in the header was coloured with `--ink-faint`, a dark grey chosen for light cards, on the near-black `--header-bg` (about 2.9 to 1). A new token `--header-muted` (`#b7b2a3`, about 8 to 1 on the header) now colours it, and the contrast test (`app-css.cr8-fx3.test.ts`) covers the header pairs: the tagline chip, the header text and the muted colour must each reach 4.5 to 1 on `--header-bg` (TC-CR8-12, 12-1). This extends §13a, whose token test covered only the card, page, cream and warning backgrounds.

## 13c. Round 18 — the model setting, the pre-fill and what may leave the browser (R18, 2026-10-07; revised after design review 008)

The detailed design is `intake-flow.md` §27; this section records only what changes the cross-cutting rules.

- **Boundaries, unchanged and restated.** New pure modules live in `src/engine/*` and obey Rule 1 (no model, no clock, no random, no I/O): `mentioned.ts`, `prefill-types.ts` (the shared vocabularies, so no layer imports another for a type), `form-visibility.ts` (the form's rules, extracted from the component), `prefill-verify.ts`, `answer-sources.ts`, `answers-from-graph.ts` and `question-fields.ts`. Everything that calls a model is in `src/llm/*` (`prefill.ts`, `model-setting.ts`, `model-test.ts`) and receives its question catalogue as data, so `llm` never imports `components`. The model setting is kept in `localStorage` by `src/llm/model-setting.ts` (an accepted exception to "store is the only persistence": it is a setting, not case data); saved test results sit under their own key. Components render and own timers: the 30-second and 60-second budgets are a `setTimeout` plus an `AbortController` in the component, never `AbortSignal.timeout`. `engine-boundary.test.ts` is extended so `src/llm` cannot import `src/components`, and a grep test lists the only files allowed to call `fetch`.
- **What may leave the browser.** Case text goes only to the **declared model address** and only for a pre-fill (requests are POST-only, redirect refused, credentials omitted, no referrer); the in-app test sends only the bundled public corpus. The one declared exception is the optional saved Anthropic key (no screen sets it), which still enables the semantic duplicate check and the verdict explanation, both of which send case text to Anthropic; it is stated in the docs and covered by the egress tests. No analytics, beacon or third-party script. A CSP `<meta>` limited to the directives that do not need the model address (`script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`) is adopted after a `file://` check; `connect-src` cannot be narrowed (arbitrary firm address) and `frame-ancestors` cannot be set from a meta tag.
- **Where case text lives and for how long** is tabled in `intake-flow.md` §27.9 (session draft; append-only IndexedDB trail; hand-off file). The trail cannot be edited by design; that is a stated trade-off against confidentiality, and the export screen says what the file contains.
- **Clear all data** keeps `aigate:model-setting` and `aigate:model-test-results` (like the keys they replace), says so, and offers "Forget the model setting"; it clears both drafts as before. TC-CR8-16c's key list changes in the same commit.
- **Drafts** are version 4 (`intake-flow.md` §27.7); a draft from any earlier build lands on the form with the description and one plain sentence.
- **Build and CI.** Round 18 chunks land on a `round-18` branch (CI runs there) and merge to `main` only after R18-G, because every push to `main` is published. `npm run scan:dist` runs after `vite build` in `ci.yml` and `deploy-pages.yml`; the confidentiality word-list scan is a local release gate.
- **Test utilities added.** A fake-model fetch in `src/llm/test-utils.ts` (format-honouring, format-ignoring, never-answering, redirecting, failing with each reply shape; it rejects when its `signal` aborts); a fixture directory `src/llm/__fixtures__/`; fake clocks use `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })` with `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.
- **Reserved words.** No new string contains "approved" or "rejected" (the verdict screen's single-match query); a repo-wide scan test is added in R18-A and runs in every chunk.

## 14. Changelog

| Date | Change |
|---|---|
| 2026-10-07 | Round 18 — §13c added: boundaries for the new pure and model modules, what may leave the browser, Clear all data keeps the model setting, draft version 4, test utilities (see `intake-flow.md` §27). |
| 2026-10-04 | GT7 — defects found by /gvm-test 007 (TC-CF-5-02b to -02j, `test-cases-032.md`). The CF-5 start-up gate now covers the regulatory rules packs (P9): a pack that fails to load adds its reason (pack, rule id, field path) to the "Policy file invalid" banner and refuses evaluation, adoption, a dismissal that would write, both Settings seeds and the self-assessment seeding, through the one loader `loadPackSet` (`src/store/pack-source.ts`). §5 (policy load errors) and §13b amended. |
| 2026-10-04 | CR9 — code review 009 fixes (TC-CR9-*, `test-cases-031.md`). §13 gains the two Clear-all-data changes on an incomplete reset: the header's role selector goes back to 1LoD at once (CR9-13) and the message names the stores in plain words, never a database id (CR9-14). |
| 2026-10-04 | CR8 — code review 008 fixes (TC-CR8-*, `test-cases-030.md`). §5 amended and §13b added: the Clear all data messages name everything cleared and kept (CR8-16), the app-wide policy banner shows raw field paths only to 2LoD and on the Appetite framework screen (CR8-13), and the header tagline has its own contrast token `--header-muted` covered by the token test (CR8-12). |
| 2026-10-04 | CR7 — wave 2 (TC-CR7-*, TC-FX7-*, `test-cases-029.md`). §5 notes where the policy-problem sentence lives (`POLICY_PROBLEM_MESSAGE`); §6 gains the long-intake-test conventions (single paste, `delay: null`, written-reason budgets `SLOW_FLOW_MS` and `DUP_CHECK_WAIT`, no global timeout change; FX7-6); §13a added (the contrast tokens and their token test, CR7-08; the About page counts computed from the shipped policy, CR7-36). |
| 2026-10-04 | CR7 — code review 007 fixes, wave 1 (TC-CR7-*, `test-cases-029.md`). §5 gains the plain-sentence rule for policy problems shown to a submitter; §13 added (what Clear all data deletes and keeps, the 3 second wait on a blocked delete, the 15 second no-retry reasoning-trace call). |

---

*Developed using the Grounded Vibe Methodology*
