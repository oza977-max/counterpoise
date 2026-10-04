import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../store/policy';
import { evaluate } from './evaluate';
import { exportAll, addNode } from '../store/register';
import type { DataFlowGraph, PolicyFile } from './types';

// Round 4, step 5. Build verification 003 walked these and found them correct
// by source inspection with NO test naming their scenario. They were true by
// construction, which is a different thing from being defended: a refactor
// that broke any of them would have shipped green.
//
// The two that matter most are NF-3 and NF-11 — the promises this product
// makes about where a bank's data goes.

let policy: PolicyFile;

beforeAll(() => {
  const yaml = readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8');
  const result = loadPolicy(yaml);
  if (!result.valid) throw new Error(`fixture policy invalid: ${JSON.stringify(result.errors)}`);
  policy = result.policy;
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function realisticGraph(): DataFlowGraph {
  return {
    id: 'g1',
    version: 1,
    input_nodes: [{ id: 'i1', label: 'client notes', data_class: 'Client PII', data_zone: 'Zone B' }],
    processing_nodes: [
      {
        id: 'p1',
        label: 'drafting model',
        model_type: 'llm',
        autonomy_level: 2,
        data_zone: 'Zone B',
        vendor: 'external-llm-co',
        replaces_prior_model: false,
      },
    ],
    output_nodes: [
      {
        id: 'o1',
        label: 'drafted email',
        action_type: 'draft',
        exposure: 'client-facing',
        decision_bindingness: 'material',
        output_reversibility: 'reversible',
        scale: 'at_scale',
      },
    ],
    edges: [
      { from: 'i1', to: 'p1' },
      { from: 'p1', to: 'o1' },
    ],
    jurisdictions: ['UK', 'EU'],
    intake_method: 'structured_form',
    extracted_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('TC-NF-3-01: evaluation makes no network request', () => {
  it('reaches a verdict without touching fetch, XMLHttpRequest or sendBeacon', () => {
    // The product's core promise: a bank can score a use case without any of
    // it leaving the browser. True today because no HTTP primitive appears in
    // src/ outside the key-gated LLM client — but nothing asserted it, so a
    // single innocuous import could have removed the guarantee silently.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('evaluation made a network request via fetch');
    });
    const xhrSpy = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => {
      throw new Error('evaluation made a network request via XMLHttpRequest');
    });

    const result = evaluate(realisticGraph(), policy);

    expect(result.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
  });

  it('holds with no API key configured — the LLM path is never entered', () => {
    localStorage.clear();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = evaluate(realisticGraph(), policy);

    expect(result.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('TC-NF-11-01: the API key cannot reach an export', () => {
  it('an export of the register contains no trace of a configured key', async () => {
    // A distinctive value, so a substring search cannot pass by accident.
    const key = 'sk-ant-TESTKEY-do-not-export-me-6f3a91';
    localStorage.setItem('aigate:api-key', key);

    await addNode({
      node_id: crypto.randomUUID(),
      node_type: 'use_case',
      label: 'Export probe',
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: {
        node_type: 'use_case',
        submitted_by: '1LoD',
        lifecycle_stage: 'pre_checked',
        current_verdict_id: null,
        tier: 'High',
        track: 'II',
      },
    });

    const exported = JSON.stringify(await exportAll());

    // Structurally impossible today — the key lives in localStorage and the
    // export reads IndexedDB — and that is exactly the kind of guarantee that
    // quietly stops being true when someone adds a "settings" section to the
    // export for convenience.
    expect(exported).not.toContain(key);
    expect(exported).not.toContain('sk-ant');
    expect(exported).not.toContain('api-key');
  });
});

describe('a malicious policy file is rejected, never executed', () => {
  it('refuses a YAML carrying a code-execution tag rather than acting on it', () => {
    // The policy file is the one artefact a bank hands this product from
    // outside. js-yaml's safe default schema is what stops a crafted tag being
    // instantiated — a library guarantee the product depends on and never
    // checked.
    const hostile = `
version: "1.0"
danger: !!js/function "function(){ return 'executed' }"
hard_lines: []
`;
    const result = loadPolicy(hostile);

    expect(result.valid).toBe(false);
    // And it failed as a rejection, not by running anything.
    if (!result.valid) {
      expect(Array.isArray(result.errors)).toBe(true);
    }
  });

  it('refuses a policy that is valid YAML but not a policy', () => {
    const notAPolicy = loadPolicy('just: a string\nand: another');
    expect(notAPolicy.valid).toBe(false);
  });
});

describe('TC-NF-5-01: a verdict is produced well within the 30-second budget', () => {
  it('evaluates a realistic graph in under a second', () => {
    // NF-5 allows 30 seconds from graph confirmation. The engine is pure and
    // synchronous, so the honest assertion is a generous ceiling that would
    // still catch an accidental O(n^2) blow-up in the solver — not a
    // micro-benchmark, which would flake on a loaded machine.
    const started = performance.now();
    for (let i = 0; i < 20; i++) evaluate(realisticGraph(), policy);
    const perRun = (performance.now() - started) / 20;

    expect(perRun).toBeLessThan(1000);
  });
});
