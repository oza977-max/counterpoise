import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

// R16-F §5 (DR7-06, design-review-007.html). Mechanical guard for
// cross-cutting.md §7 Rule 1 ("engine is a pure island... Never: engine →
// ui") and CLAUDE.md's matching rule. src/engine/plain-intake.ts used to
// import `findQuestion`/`makeAssumption` and the `QuestionId`/
// `PlainAnswers` types straight from src/components/plain-copy.ts — a live
// violation with no lint rule to catch it (it was found by a design-review
// panel reading imports by hand). This test makes that mechanical: it scans
// every PRODUCTION (non-test) file under src/engine/ for an import whose
// specifier resolves into src/components/, and fails if one exists.
//
// Test files under src/engine/ are deliberately exempt — see the module
// doc comment on this exemption in specs/cross-cutting.md's R16-F §5 note.
// backtest-parity.test.ts/backtest-parity-nonblind.test.ts legitimately
// resolve a worked case's plain-English answers back to engine keys via
// plain-copy.ts's word -> key lookups (optionKeyForText, findQuestion),
// which exist only component-side because the WORDS live there — a
// test-layer integration concern, not a production purity violation.

const ENGINE_DIR = resolve(__dirname, '.');

function listProductionSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listProductionSourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// Every module a file imports — `import`, `import type`, `export … from`,
// and `import()` — read by TypeScript's own pre-processor, not a regex.
// (Verifying R16-F, review pass 1: the first version read import statements
// one LINE at a time, so an import written across several lines —
// `import type {\n  Foo,\n} from '../components/x'`, the style six engine
// files already use — slipped past it unseen.)
function importedModules(text: string): string[] {
  return ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName);
}

function componentImports(text: string): string[] {
  return importedModules(text).filter((spec) => /(^|\/)components\//.test(spec));
}

describe('engine/screen boundary (cross-cutting.md §7 Rule 1, CLAUDE.md)', () => {
  it('TC-R16-F-01: no production file under src/engine/ imports from src/components/', () => {
    const offenders: string[] = [];
    for (const file of listProductionSourceFiles(ENGINE_DIR)) {
      for (const spec of componentImports(readFileSync(file, 'utf-8'))) {
        offenders.push(`${file}: imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // Proves the guard above actually catches something, rather than
  // vacuously passing because the regex never matches anything real — the
  // same "prove the check can fail" discipline the hash-chain forgery test
  // (audit.ts's __recomputeChainForTests) uses for a different limit.
  it('TC-R16-F-02: the scan itself would flag a components/ import if one existed', () => {
    const sample = [
      "import { findQuestion } from '../components/plain-copy';",
      "import type { Assumption } from './plain-copy';",
      "export { x } from '../components/x';",
    ].join('\n');
    expect(componentImports(sample)).toEqual(['../components/plain-copy', '../components/x']);
  });

  it('TC-R16-F-66: an import written across several lines, or loaded on demand, is caught too', () => {
    const sample = [
      'import type {',
      '  QuestionId,',
      '  PlainAnswers,',
      "} from '../components/plain-copy';",
      "const later = await import('../components/verdict-view-model');",
      "// a comment that says from '../components/not-an-import' is not an import",
    ].join('\n');
    expect(componentImports(sample)).toEqual(['../components/plain-copy', '../components/verdict-view-model']);
  });
});

// ENG-ID (2026-10-03). The same Rule 1 made mechanical for the other half of
// the island: no clock, no randomness, no id minting. build-graph-from-form.ts
// called crypto.randomUUID() for two full review rounds after the rule was
// written, and B-15 found its `new Date()` only by reading — nothing would
// have failed. This reads every production file's syntax tree (so comments
// that NAME these calls, which several engine files do on purpose, are not
// flagged) and lists every forbidden call it finds.
//
// Forbidden: Date.now(), new Date() with no arguments, Math.random(),
// performance.now(), and any use of `crypto` (randomUUID, getRandomValues).
// `new Date(Date.UTC(...))` — date arithmetic on a value passed in, as
// attestation.ts does — is deterministic and stays allowed.
//
// A tripwire for the accidental call, not a proof against a determined one:
// aliasing (`const r = Math.random; r()`) is out of its reach. It does see
// through a `globalThis.` prefix and bracket access (`Date['now']`).
function nonDeterministicCalls(text: string): string[] {
  const source = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const ownerOf = (e: ts.Expression): string => e.getText(source).replace(/^globalThis\./, '');
  const visit = (node: ts.Node): void => {
    const access =
      ts.isPropertyAccessExpression(node)
        ? { owner: ownerOf(node.expression), name: node.name.text }
        : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)
          ? { owner: ownerOf(node.expression), name: node.argumentExpression.text }
          : undefined;
    if (access) {
      const { owner, name } = access;
      if (
        (owner === 'Date' && name === 'now') ||
        (owner === 'Math' && name === 'random') ||
        (owner === 'performance' && name === 'now')
      ) {
        found.push(`${owner}.${name}`);
      }
    }
    if (ts.isIdentifier(node) && node.text === 'crypto') found.push('crypto');
    // `globalThis.crypto` is already caught as the name `crypto` above; only
    // the bracket form hides the name inside a string.
    if (ts.isElementAccessExpression(node) && access?.owner === 'globalThis' && access.name === 'crypto') {
      found.push('crypto');
    }
    if (
      ts.isNewExpression(node) &&
      ownerOf(node.expression) === 'Date' &&
      (node.arguments === undefined || node.arguments.length === 0)
    ) {
      found.push('new Date()');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('engine purity (cross-cutting.md §7 Rule 1, NF-1)', () => {
  it('TC-ENG-ID-04: no production file under src/engine/ reads a clock, draws a random number or mints an id', () => {
    const offenders: string[] = [];
    for (const file of listProductionSourceFiles(ENGINE_DIR)) {
      for (const call of nonDeterministicCalls(readFileSync(file, 'utf-8'))) {
        offenders.push(`${file}: ${call}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('TC-ENG-ID-05: the scan would flag each forbidden call, and ignores comments and date arithmetic on a passed-in value', () => {
    const flagged = [
      'const a = Date.now();',
      'const b = new Date();',
      'const c = new Date;',
      'const d = Math.random();',
      'const e = crypto.randomUUID();',
      'const f = globalThis.crypto.getRandomValues(buf);',
      'const g = performance.now();',
      'const h = globalThis.Date.now();',
      "const i = Date['now']();",
      "const j = globalThis['crypto'];",
      'const k = new globalThis.Date();',
    ].join('\n');
    expect(nonDeterministicCalls(flagged)).toEqual([
      'Date.now',
      'new Date()',
      'new Date()',
      'Math.random',
      'crypto',
      'crypto',
      'performance.now',
      'Date.now',
      'Date.now',
      'crypto',
      'new Date()',
    ]);

    const allowed = [
      '// no Date.now(), no Math.random(), no crypto.randomUUID() here',
      'const last = new Date(Date.UTC(y, m, 0)).getUTCDate();',
      "const label = 'crypto';",
    ].join('\n');
    expect(nonDeterministicCalls(allowed)).toEqual([]);
  });
});

// R18-C2 (specs/implementation-guide.md §12; TC-R18-NF-4-03): the one-engine guarantee made mechanical.
// Round 18 puts a model's reply on the form, so the island must still hold nothing of the model, the
// screen, the store or the network; and the model's reply, the answer sources and the reading record must
// not be reachable from evaluate() — by import, or by being handed to it from any screen.
const SRC_DIR = resolve(__dirname, '..');
const FORBIDDEN_IN_ENGINE = [/(^|\/)llm(\/|$)/, /(^|\/)store(\/|$)/, /^react(-dom)?(\/|$)/, /^idb$/, /^@anthropic-ai\//];

function forbiddenEngineImports(text: string): string[] {
  return importedModules(text).filter((spec) => FORBIDDEN_IN_ENGINE.some((re) => re.test(spec)));
}

function listAllProductionFiles(dir: string): string[] {
  return listProductionSourceFiles(dir).filter((f) => !/__tests__|__fixtures__|test-support|test-utils/.test(f));
}

/** Every engine module reachable from `entry` through relative imports. */
function engineClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importedModules(readFileSync(file, 'utf-8'))) {
      if (!spec.startsWith('.')) continue;
      const base = resolve(file, '..', spec);
      for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
        try {
          if (statSync(cand).isFile()) queue.push(cand);
        } catch {
          /* not this candidate */
        }
      }
    }
  }
  return seen;
}

/** The text of the arguments of every call to `evaluate(` in a file. */
function evaluateCallArguments(text: string): string[] {
  const source = ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'evaluate') {
      found.push(node.arguments.map((a) => a.getText(source)).join(', '));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('one engine: nothing of a model reaches evaluate() (R18-NF-4)', () => {
  it('TC-R18-NF-4-03: no production file under src/engine/ imports the model call, the store, React, idb or the SDK, and none reads a clock or random number', () => {
    const offenders: string[] = [];
    for (const file of listProductionSourceFiles(ENGINE_DIR)) {
      for (const spec of forbiddenEngineImports(readFileSync(file, 'utf-8'))) offenders.push(`${file}: imports ${spec}`);
      for (const call of nonDeterministicCalls(readFileSync(file, 'utf-8'))) offenders.push(`${file}: ${call}`);
    }
    expect(offenders).toEqual([]);
    // the scan can fail
    expect(forbiddenEngineImports("import { requestPrefill } from '../llm/prefill';\nimport { a } from '../store/audit';\nimport React from 'react';")).toEqual([
      '../llm/prefill',
      '../store/audit',
      'react',
    ]);
  });

  it('evaluate() cannot reach the reply, the answer sources or the reading record through its imports (TC-R18-NF-4-01)', () => {
    const closure = [...engineClosure(join(ENGINE_DIR, 'evaluate.ts'))].map((f) => f.slice(ENGINE_DIR.length + 1));
    const reply = ['prefill-types.ts', 'prefill-verify.ts', 'answer-sources.ts', 'form-answer-state.ts', 'question-structure.ts'];
    expect(closure.filter((f) => reply.includes(f))).toEqual([]);
    expect(closure).toContain('evaluate.ts'); // the walk found something
    // and the walk can fail: from a module that does import one, it finds it
    const viaVerify = [...engineClosure(join(ENGINE_DIR, 'prefill-verify.ts'))].map((f) => f.slice(ENGINE_DIR.length + 1));
    expect(viaVerify).toContain('prefill-types.ts');
  });

  it('no screen or store hands evaluate() anything but the graph, the policy and the packs (TC-R18-NF-4-01)', () => {
    const offenders: string[] = [];
    let calls = 0;
    for (const file of listAllProductionFiles(SRC_DIR)) {
      for (const args of evaluateCallArguments(readFileSync(file, 'utf-8'))) {
        calls += 1;
        if (/prefill|reply|answerState|lastRead|outcome|quote/i.test(args)) offenders.push(`${file}: evaluate(${args})`);
      }
    }
    expect(calls).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
    expect(evaluateCallArguments('const r = evaluate(graph, policy, prefill.answers);')).toEqual(['graph, policy, prefill.answers']);
  });
  it('no production file that imports the reply types or the answer sources also imports evaluate (TC-R18-NF-4-01)', () => {
    // HEURISTIC, and its limits: it reads import specifiers by text, so it sees a direct import of
    // prefill-types / answer-sources and of the evaluate module in the same file. It does NOT see a file
    // that reaches the reply through a re-export or a third module, nor a value passed through an untyped
    // parameter. The call-argument scan above and the import-closure walk cover those gaps in part; the
    // rest is review. IntakeFlow.tsx is the one screen that legitimately does both - it holds the form's
    // answers and runs the verdict - so it is allow-listed, and its evaluate() arguments are scanned above.
    // R18-F adds the in-app test's scorer, the one measurement-only second route from a Prefill to evaluate()
    // (specs/intake-flow.md §27.11). The next test pins who may import it.
    const ALLOWED = ['components/IntakeFlow.tsx', 'engine/question-fields.ts'];
    const touchesReply = (spec: string) => /(^|\/)(prefill-types|answer-sources)$/.test(spec);
    const touchesEvaluate = (spec: string) => /(^|\/)evaluate$/.test(spec);
    const both: string[] = [];
    for (const file of listAllProductionFiles(SRC_DIR)) {
      const specs = importedModules(readFileSync(file, 'utf-8'));
      if (specs.some(touchesReply) && (specs.some(touchesEvaluate) || evaluateCallArguments(readFileSync(file, 'utf-8')).length > 0)) {
        both.push(file.slice(SRC_DIR.length + 1));
      }
    }
    expect(both.sort()).toEqual(ALLOWED);
    // the scan can fail
    const sample = "import type { Prefill } from './prefill-types';\nimport { evaluate } from './evaluate';";
    expect(importedModules(sample).some(touchesReply) && importedModules(sample).some(touchesEvaluate)).toBe(true);
  });

  it('TC-R18-GI-12-07: the scorer is the only measurement route to evaluate() - only the in-app test runner imports it, and nothing in the intake route does', () => {
    const importsScorer = (spec: string) => /(^|\/)question-fields$/.test(spec);
    const importers: string[] = [];
    const namedElsewhere: string[] = [];
    for (const file of listAllProductionFiles(SRC_DIR)) {
      const rel = file.slice(SRC_DIR.length + 1);
      const text = readFileSync(file, 'utf-8');
      if (importedModules(text).some(importsScorer)) importers.push(rel);
      if (/\bapplyPrefillToGraph\b/.test(text) && rel !== 'engine/question-fields.ts') namedElsewhere.push(rel);
    }
    expect(importers.sort()).toEqual(['llm/model-test.ts']);
    expect(namedElsewhere).toEqual([]);
    // the intake route itself, by name
    for (const name of ['components/IntakeFlow.tsx', 'components/StructuredForm.tsx', 'components/useReadingAttempt.ts', 'components/ConfirmationStep.tsx']) {
      expect(importedModules(readFileSync(join(SRC_DIR, name), 'utf-8')).some(importsScorer), name).toBe(false);
    }
    // the scan can fail
    expect(importedModules("import { scoreCase } from '../engine/question-fields';").some(importsScorer)).toBe(true);
  });
});
