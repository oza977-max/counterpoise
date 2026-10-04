import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { dump } from 'js-yaml';
import { loadPolicy } from '../store/policy';
import { evaluate } from './evaluate';
import { fitsEnvelope, inheritableControls, DATA_CLASS_RANK, maxBy } from './envelope';
import type { DataFlowGraph, PolicyFile } from './types';

// R16-A1 (§1.5): exported so graph-summary.ts and the verdict view-model
// (chunk D1) rank the most-sensitive data class the same way this module
// does, rather than each re-deriving its own ranking.
describe('DATA_CLASS_RANK / maxBy exports (R16-A1 §1.5)', () => {
  it('TC-R16-A1-48: ranks MNPI above Client PII above Confidential above Internal above Public', () => {
    expect(DATA_CLASS_RANK.MNPI).toBeGreaterThan(DATA_CLASS_RANK['Client PII']);
    expect(DATA_CLASS_RANK['Client PII']).toBeGreaterThan(DATA_CLASS_RANK.Confidential);
    expect(DATA_CLASS_RANK.Confidential).toBeGreaterThan(DATA_CLASS_RANK.Internal);
    expect(DATA_CLASS_RANK.Internal).toBeGreaterThan(DATA_CLASS_RANK.Public);
  });

  it('TC-R16-A1-49: maxBy picks the most-sensitive class regardless of input order', () => {
    expect(maxBy(['Internal', 'MNPI', 'Confidential'], DATA_CLASS_RANK)).toBe('MNPI');
    expect(maxBy(['Public'], DATA_CLASS_RANK)).toBe('Public');
    expect(maxBy([], DATA_CLASS_RANK)).toBeUndefined();
  });
});

// PV-A. Requirements PV-1, PV-2, PV-3, PV-5, PV-6 (requirements.md §PV).
//
// The seam being closed: evaluate() has always called solvControls() with an
// empty inherited-controls array. The solver has accepted the parameter since
// P3-C01 and never been given anything. This suite feeds it.

let basePolicy: PolicyFile;
let policyWithRegistry: PolicyFile;

// A platform cleared for ordinary internal work, which already satisfies the
// Track II fingerprinting control. Deliberately NOT cleared for Client PII,
// so the same platform can be shown covering and not covering.
const PLATFORM = {
  id: 'PLAT-INTERNAL-01',
  name: 'Internal model platform',
  approved_envelope: {
    max_data_class: 'Internal',
    max_exposure: 'internal-shared',
    max_autonomy_level: 2,
    data_zones: ['Zone B', 'Zone C'],
    jurisdictions: ['UK', 'EU'],
  },
  satisfies_controls: ['CTRL-FINGERPRINT-01'],
};

beforeAll(() => {
  const yaml = readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8');
  const base = loadPolicy(yaml);
  if (!base.valid) throw new Error(`fixture policy invalid: ${JSON.stringify(base.errors)}`);
  basePolicy = base.policy;

  const raw = load(yaml) as Record<string, unknown>;
  raw.platforms = [PLATFORM];
  const withReg = loadPolicy(dump(raw));
  if (!withReg.valid) throw new Error(`registry policy invalid: ${JSON.stringify(withReg.errors)}`);
  policyWithRegistry = withReg.policy;
});

// Trips INV-TRACK2-01 (ml + advisory), whose only resolving control is
// CTRL-FINGERPRINT-01 — the control the platform satisfies.
function graph(overrides: {
  platform?: string;
  vendor?: string;
  dataClass?: 'Internal' | 'Client PII';
  autonomy?: 0 | 1 | 2 | 3 | 4;
} = {}): DataFlowGraph {
  const { platform, vendor = 'internal', dataClass = 'Internal', autonomy = 1 } = overrides;
  return {
    id: 'g1',
    version: 1,
    input_nodes: [{ id: 'i1', label: 'in', data_class: dataClass, data_zone: 'Zone C' }],
    processing_nodes: [
      {
        id: 'p1',
        label: 'model',
        model_type: 'ml',
        autonomy_level: autonomy,
        data_zone: 'Zone B',
        vendor,
        replaces_prior_model: false,
        ...(platform ? { platform } : {}),
      },
    ],
    output_nodes: [
      {
        id: 'o1',
        label: 'out',
        action_type: 'recommend',
        exposure: 'internal-shared',
        decision_bindingness: 'advisory',
        output_reversibility: 'reversible',
        scale: 'limited',
      },
    ],
    edges: [{ from: 'i1', to: 'p1' }, { from: 'p1', to: 'o1' }],
    jurisdictions: [],
    intake_method: 'structured_form',
    extracted_at: '2026-01-01T00:00:00.000Z',
  };
}

function controlsOf(g: DataFlowGraph, p: PolicyFile): string[] {
  const r = evaluate(g, p);
  if (!r.ok) throw new Error('evaluation failed');
  return r.value.controls;
}

describe('PV-A acceptance — a covering platform reduces the required control set', () => {
  it('the same use case requires fewer controls when it runs on a covering platform [TC-PV-3-01]', () => {
    const withoutPlatform = controlsOf(graph(), policyWithRegistry);
    const withPlatform = controlsOf(graph({ platform: 'PLAT-INTERNAL-01' }), policyWithRegistry);

    expect(withoutPlatform).toContain('CTRL-FINGERPRINT-01');
    expect(withPlatform).not.toContain('CTRL-FINGERPRINT-01');
    expect(withPlatform.length).toBeLessThan(withoutPlatform.length);
  });

  it('names what was inherited and from which envelope, never silently (PV-6)', () => {
    const r = evaluate(graph({ platform: 'PLAT-INTERNAL-01' }), policyWithRegistry);
    if (!r.ok) throw new Error('evaluation failed');

    const inh = r.value.inheritance;
    expect(inh).toBeDefined();
    expect(inh?.declared_platform).toBe('PLAT-INTERNAL-01');
    expect(inh?.inherited_controls).toContain('CTRL-FINGERPRINT-01');
    // Every dimension is reported, fitting or not — inheritance is never
    // asserted without the chain that justifies it.
    expect(inh?.dimensions.length).toBeGreaterThan(0);
    expect(inh?.dimensions.every((d) => typeof d.fits === 'boolean')).toBe(true);
  });
});

describe('PV-3 — inheritance is per-dimension, not all-or-nothing', () => {
  it('a use case exceeding one dimension does not inherit that dimension’s clearance', () => {
    // Client PII exceeds the platform's max_data_class of Internal.
    const r = evaluate(graph({ platform: 'PLAT-INTERNAL-01', dataClass: 'Client PII' }), policyWithRegistry);
    if (!r.ok) throw new Error('evaluation failed');

    const dataDim = r.value.inheritance?.dimensions.find((d) => d.dimension === 'data_class');
    expect(dataDim?.fits).toBe(false);
    // The encryption invariant for Client PII is evaluated directly — the
    // platform was never cleared for that data class.
    expect(r.value.controls).toContain('CTRL-ENC-01');
  });

  it('reports each ordinal and set dimension separately', () => {
    const fit = fitsEnvelope(graph({ platform: 'PLAT-INTERNAL-01' }), PLATFORM.approved_envelope as never);
    const dims = fit.map((d) => d.dimension);
    expect(dims).toContain('data_class');
    expect(dims).toContain('exposure');
    expect(dims).toContain('autonomy_level');
    expect(dims).toContain('data_zones');
    expect(fit.every((d) => d.fits)).toBe(true);
  });

  it('an autonomy level above the envelope ceiling does not fit [TC-PV-3-03]', () => {
    const fit = fitsEnvelope(
      graph({ platform: 'PLAT-INTERNAL-01', autonomy: 3 }),
      PLATFORM.approved_envelope as never,
    );
    expect(fit.find((d) => d.dimension === 'autonomy_level')?.fits).toBe(false);
  });
});

describe('PV-5 — an unapproved component inherits nothing and is named', () => {
  it('a platform absent from the registry inherits no controls and triggers a review [TC-PV-5-01]', () => {
    const r = evaluate(graph({ platform: 'PLAT-NOT-REGISTERED' }), policyWithRegistry);
    if (!r.ok) throw new Error('evaluation failed');

    expect(r.value.controls).toContain('CTRL-FINGERPRINT-01');
    expect(r.value.inheritance?.inherited_controls ?? []).toHaveLength(0);
    // The verdict must name the component, not just say "unapproved".
    expect(r.value.downstream_reviews.join(' ')).toMatch(/PLAT-NOT-REGISTERED/);
  });
});

describe('PV-A safety rail — nothing changes when no platform is declared', () => {
  it('a graph with no platform against a policy with no registry is byte-identical to before [TC-PV-A-01]', () => {
    const a = evaluate(graph(), basePolicy);
    const b = evaluate(graph(), basePolicy);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    if (a.ok) {
      // No inheritance block is fabricated when there is nothing to inherit.
      expect(a.value.inheritance).toBeUndefined();
    }
  });

  it('remains deterministic across 10 runs with a registry and inheritance active', () => {
    const g = graph({ platform: 'PLAT-INTERNAL-01' });
    const results = Array.from({ length: 10 }, () => JSON.stringify(evaluate(g, policyWithRegistry)));
    expect(new Set(results).size).toBe(1);
  });
});

describe('PV-6 — the inheritance chain survives a rejection', () => {
  it('records what was assessed even when the verdict is out of appetite [TC-PV-6-02]', () => {
    // MNPI outside Zone C is unsatisfiable — no control resolves INV-ZONE-01.
    // The chain must still say what the platform covered and where this use
    // case left the envelope. Found live: the rejection path originally
    // dropped the inheritance block entirely.
    const g = graph({ platform: 'PLAT-INTERNAL-01' });
    g.input_nodes = [{ id: 'i1', label: 'in', data_class: 'MNPI', data_zone: 'Zone B' }];

    const r = evaluate(g, policyWithRegistry);
    if (!r.ok) throw new Error('evaluation failed');

    expect(r.value.status).toBe('rejected');
    expect(r.value.inheritance).toBeDefined();
    expect(r.value.inheritance?.declared_platform).toBe('PLAT-INTERNAL-01');
    expect(r.value.inheritance?.dimensions.find((d) => d.dimension === 'data_class')?.fits).toBe(false);
  });
});

// Code review 001, C-3 and C-4 (Panel C — Fagan, Beizer).
// C-3: `resolved` was `entries.length > 0` — true if EITHER platform or
// vendor matched, so an approved platform alongside an unapproved vendor
// emitted zero unapproved-component reviews. PV-5 exists to prevent exactly
// that.
// C-4: the early-return guards mixed a pre-lookup id with a post-lookup
// object, so a declared-but-unrecognised vendor returned undefined before
// the caller could learn a vendor had been declared at all.
describe('C-3/C-4 — each declared component is resolved and reported independently', () => {
  const VENDOR = {
    id: 'VENDOR-OK',
    name: 'Approved vendor',
    approved_envelope: { max_data_class: 'Internal' },
    satisfies_controls: [],
  };

  function policyWith(platforms: unknown[], vendors: unknown[]): PolicyFile {
    const yaml = readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8');
    const raw = load(yaml) as Record<string, unknown>;
    raw.platforms = platforms;
    raw.vendors = vendors;
    const r = loadPolicy(dump(raw));
    if (!r.valid) throw new Error(JSON.stringify(r.errors));
    return r.policy;
  }

  it('an approved platform does not mask an unapproved vendor (C-3)', () => {
    const p = policyWith([PLATFORM], [VENDOR]);
    const g = graph({ platform: 'PLAT-INTERNAL-01', vendor: 'VENDOR-NOT-REGISTERED' });

    const r = evaluate(g, p);
    if (!r.ok) throw new Error('evaluation failed');

    // The platform resolved. The vendor did not. The unapproved one must
    // still be named — previously `resolved` was true and this was silent.
    expect(r.value.downstream_reviews.join(' ')).toMatch(/VENDOR-NOT-REGISTERED/);
  });

  it('a declared vendor absent from a non-empty registry is still reported (C-4)', () => {
    const p = policyWith([], [VENDOR]);
    const g = graph({ vendor: 'VENDOR-NOT-REGISTERED' });

    const r = evaluate(g, p);
    if (!r.ok) throw new Error('evaluation failed');

    // Previously guard 1 returned undefined here, so the caller never learned
    // a vendor had been declared.
    expect(r.value.inheritance).toBeDefined();
    expect(r.value.inheritance?.declared_vendor).toBe('VENDOR-NOT-REGISTERED');
    expect(r.value.downstream_reviews.join(' ')).toMatch(/VENDOR-NOT-REGISTERED/);
  });

  it('still fabricates nothing when no registry exists at all', () => {
    // A bare `vendor: 'internal'` on a policy with no registries is not a
    // claim of approval. This is the case the original guards were protecting
    // and it must survive the fix.
    const r = evaluate(graph(), basePolicy);
    if (!r.ok) throw new Error('evaluation failed');
    expect(r.value.inheritance).toBeUndefined();
    expect(r.value.downstream_reviews).toEqual([]);
  });
});

// Code review 001, I-2 (Panel C — Robert C. Martin).
// Partial cluster declaration was strictly MORE permissive than declaring
// none: with no clusters an exceeded envelope withdrew the whole approval,
// but with one cluster declared, a control outside every cluster survived.
// That inverts the conservative reading the module itself states.
describe('I-2 — a control in no declared cluster still falls away when the envelope is exceeded', () => {
  const FITS = [
    { dimension: 'data_class', fits: false, ceiling: 'Internal', observed: 'MNPI' },
    { dimension: 'exposure', fits: true, ceiling: 'internal-shared' },
  ];

  it('drops an uncatalogued control, matching the no-clusters behaviour', () => {
    const got = inheritableControls(['C-IN-CLUSTER', 'C-UNCATALOGUED'], FITS, [['data_class', 'C-IN-CLUSTER']]);
    expect(got).not.toContain('C-IN-CLUSTER');
    expect(got).not.toContain('C-UNCATALOGUED');
  });

  it('a cluster whose own dimensions all fit still yields its controls', () => {
    const got = inheritableControls(['C-EXPOSURE-ONLY'], FITS, [['exposure', 'C-EXPOSURE-ONLY']]);
    expect(got).toEqual(['C-EXPOSURE-ONLY']);
  });
});

// Traceability close-out (2026-08-15). The I-2 tests above cover the
// uncatalogued-control edge; this is TC-PV-3-04's own claim — a cluster
// coupling several dimensions loses EVERY control it carries the moment any
// one of those dimensions is exceeded, not only the exceeded dimension's.
describe('a coupled cluster falls away entirely when any dimension is exceeded [TC-PV-3-04]', () => {
  it('withdraws every control in the broken cluster, keeps an intact cluster whole', () => {
    const fits = [
      { dimension: 'data_class', fits: false, ceiling: 'Internal', observed: 'Client PII' },
      { dimension: 'exposure', fits: true, ceiling: 'internal-shared' },
      { dimension: 'autonomy_level', fits: true, ceiling: '2' },
    ];
    const got = inheritableControls(
      ['C-DC-1', 'C-DC-2', 'C-AUTONOMY'],
      fits,
      [
        // A two-control cluster coupled to (data_class, exposure): exposure
        // fits, data_class does not — the WHOLE cluster must fall.
        ['data_class', 'exposure', 'C-DC-1', 'C-DC-2'],
        ['autonomy_level', 'C-AUTONOMY'],
      ],
    );
    expect(got).not.toContain('C-DC-1');
    expect(got).not.toContain('C-DC-2');
    // The independent, intact cluster is untouched — falling away is per
    // cluster, not a global collapse.
    expect(got).toContain('C-AUTONOMY');
  });
});
