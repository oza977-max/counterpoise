import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy, onPolicyUpdated, validateConditionFieldValue } from './policy';
import { addNode } from './register';
import { getAll } from './audit';
import type { RegisterNode, LifecycleStage } from './types';

const VALID_YAML = `
version: "1.0"
policy_id: "RAF-001"
firm_name: "Test Bank"

translation_attestation:
  attested_by: "Test Bank — 2LoD Lead"
  role: "Head of AI Governance"
  date: "2026-05-01"
  raf_version_checked: "Board-approved AI RAF v1.0"

hard_lines: []

tracks:
  - id: "TRACK-I"
    name: "Track I"
    description: "Traditional MRM"
    conditions:
      - field: "model_type"
        value: { in: ["statistical"] }
    short_circuit: true
    regulatory_basis: "SS1/23 §3.4"

tiers:
  - id: "TIER-LOW"
    name: "Low"
    triggers:
      - field: "exposure"
        value: "internal-only"

invariants: []

controls:
  - id: "CTRL-ENC-01"
    name: "Encryption in transit"
    description: "TLS 1.3+"
    resolves: []
    burden: 1
    verification: "manual check"

kri_thresholds: {}

jurisdictions: []

roles:
  "1LoD": { access: "own" }
  "2LoD": { access: "all" }

tier_workflow:
  Critical: "2LoD-approve"
  High: "2LoD-approve"
  Medium: "2LoD-notify"
  Low: "self-service"

safety_margin: 0.10
`;

function withYamlPatch(base: string, patch: (yaml: string) => string): string {
  return patch(base);
}

describe('loadPolicy', () => {
  it('returns valid: true with the parsed policy for a well-formed YAML file [TC-CF-5-03]', () => {
    const result = loadPolicy(VALID_YAML);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.policy.policy_id).toBe('RAF-001');
      expect(result.policy.controls).toHaveLength(1);
      expect(result.warnings).toEqual([]);
    }
  });

  it('warns but does not block when firm_name is still the [FIRM] placeholder', () => {
    const yaml = VALID_YAML.replace('firm_name: "Test Bank"', 'firm_name: "[FIRM]"');
    const result = loadPolicy(yaml);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.warnings.some((w) => /\[FIRM\]/.test(w))).toBe(true);
    }
  });

  it('rejects malformed YAML with a named parse error', () => {
    const result = loadPolicy('version: "1.0"\n  bad_indent: [1, 2');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const [firstError] = result.errors;
      expect(firstError?.kind).toBe('policy-invalid');
      expect(firstError?.field).toBe('yaml');
      expect(firstError && firstError.reason.length).toBeGreaterThan(0);
    }
  });

  it('rejects a policy with an empty controls array', () => {
    const yaml = VALID_YAML.replace(
      /controls:\n(.|\n)*?verification: \"manual check\"\n/,
      'controls: []\n',
    );
    const result = loadPolicy(yaml);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) => e.field === 'controls' && /empty/.test(e.reason),
        ),
      ).toBe(true);
    }
  });

  it('rejects a policy whose tier_workflow is missing one of the four required tiers (realistic-fixture variant)', () => {
    const yaml = withYamlPatch(VALID_YAML, (y) =>
      y.replace(
        `tier_workflow:
  Critical: "2LoD-approve"
  High: "2LoD-approve"
  Medium: "2LoD-notify"
  Low: "self-service"`,
        `tier_workflow:
  Critical: "2LoD-approve"
  High: "2LoD-approve"
  Medium: "2LoD-notify"`,
      ),
    );
    const result = loadPolicy(yaml);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) => e.field === 'tier_workflow' && /Low/.test(e.reason),
        ),
      ).toBe(true);
    }
  });

  it('rejects a condition using an operator outside the allowed set', () => {
    const yaml = VALID_YAML.replace(
      'value: { in: ["statistical"] }',
      'value: { unsupported_op: ["statistical"] }',
    );
    const result = loadPolicy(yaml);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.kind === 'policy-invalid')).toBe(true);
    }
  });

  it('rejects a condition value outside the canonical vocabulary', () => {
    const yaml = VALID_YAML.replace(
      'value: { in: ["statistical"] }',
      'value: { in: ["not-a-real-model-type"] }',
    );
    const result = loadPolicy(yaml);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => /not-a-real-model-type/.test(e.reason)),
      ).toBe(true);
    }
  });

  it('rejects a tier rule whose name is not one of Critical/High/Medium/Low (P3-C01 review finding)', () => {
    const yaml = VALID_YAML.replace('name: "Low"', 'name: "Very Low"');
    const result = loadPolicy(yaml);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /Very Low/.test(e.reason))).toBe(true);
    }
  });
});

// R16-A1 (PE-9 §1.1): list-valued fields (today, only system_access_scope)
// support the "in" operator only — every other shape is a CF-5 error, both
// via the exported validator directly and end-to-end through loadPolicy.
// CF-6 (R16-A1 §1.2): plain-language fields are optional everywhere they're
// added. Each test loads a policy WITH the field, confirms it round-trips,
// and the existing VALID_YAML fixture (with none of these fields) already
// proves "existing policy files load unchanged" across every other test in
// this file.
describe('CF-6 optional plain-language fields (R16-A1)', () => {
  it('TC-R16-A1-35: a control accepts plain_action, plain_owner, plain_owner_with and covers_reviews', () => {
    const yaml = VALID_YAML.replace(
      'verification: "manual check"',
      [
        'verification: "manual check"',
        '    plain_action: "The connection is encrypted."',
        '    plain_owner: "@submitter"',
        '    plain_owner_with: "compliance"',
        '    covers_reviews: ["PV-UNREGISTERED"]',
      ].join('\n'),
    );
    const result = loadPolicy(yaml);
    expect(result.valid).toBe(true);
    if (result.valid) {
      const ctrl = result.policy.controls[0]!;
      expect(ctrl.plain_action).toBe('The connection is encrypted.');
      expect(ctrl.plain_owner).toBe('@submitter');
      expect(ctrl.plain_owner_with).toBe('compliance');
      expect(ctrl.covers_reviews).toEqual(['PV-UNREGISTERED']);
    }
  });

  it('TC-R16-A1-36: an invariant accepts plain_reason', () => {
    const yaml = VALID_YAML.replace(
      'invariants: []',
      `invariants:
  - id: "INV-TEST-01"
    description: "test"
    plain_reason: "it sends personal details about people to {destination}"
    condition:
      exposure: "client-facing"
    required_controls: []
    severity: "High"`,
    );
    const result = loadPolicy(yaml);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.policy.invariants[0]?.plain_reason).toBe(
        'it sends personal details about people to {destination}',
      );
    }
  });

  it('TC-R16-A1-37: a hard line accepts plain_reason and plain_change', () => {
    const yaml = VALID_YAML.replace(
      'hard_lines: []',
      `hard_lines:
  - id: "HL-TEST-01"
    description: "test"
    condition:
      exposure: "client-facing"
    reason: "formal reason"
    regulatory_basis: "Test Reg"
    plain_reason: "plain reason text"
    plain_change: "plain change text"`,
    );
    const result = loadPolicy(yaml);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.policy.hard_lines[0]?.plain_reason).toBe('plain reason text');
      expect(result.policy.hard_lines[0]?.plain_change).toBe('plain change text');
    }
  });

  it('TC-R16-A1-38: a downstream_reviews rule accepts plain_name and plain_owner', () => {
    const yaml =
      VALID_YAML +
      `
downstream_reviews:
  - id: "DR-TEST-01"
    review: "Formal review name"
    plain_name: "a plain review name"
    plain_owner: "your information-security team"
    condition: {}
`;
    const result = loadPolicy(yaml);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.policy.downstream_reviews?.[0]?.plain_name).toBe('a plain review name');
      expect(result.policy.downstream_reviews?.[0]?.plain_owner).toBe('your information-security team');
    }
  });

  it('TC-R16-A1-39: a platform/vendor registry entry accepts plain_name, vendor_id and kind', () => {
    const yaml =
      VALID_YAML +
      `
platforms:
  - id: "PLAT-TEST-01"
    name: "Formal platform name"
    plain_name: "Your firm's cloud AI assistant"
    vendor_id: "VENDOR-TEST-01"
    approved_envelope: {}
    satisfies_controls: []
vendors:
  - id: "VENDOR-TEST-01"
    name: "Formal vendor name"
    plain_name: "Your firm's company AI assistant account"
    kind: "company_assistant"
    approved_envelope: {}
    satisfies_controls: []
`;
    const result = loadPolicy(yaml);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.policy.platforms?.[0]?.plain_name).toBe("Your firm's cloud AI assistant");
      expect(result.policy.platforms?.[0]?.vendor_id).toBe('VENDOR-TEST-01');
      expect(result.policy.vendors?.[0]?.plain_name).toBe("Your firm's company AI assistant account");
      expect(result.policy.vendors?.[0]?.kind).toBe('company_assistant');
    }
  });

  it('TC-R16-A1-40: rejects an invalid kind value on a vendor entry', () => {
    const yaml =
      VALID_YAML +
      `
vendors:
  - id: "VENDOR-TEST-01"
    name: "Formal vendor name"
    kind: "not-a-real-kind"
    approved_envelope: {}
    satisfies_controls: []
`;
    const result = loadPolicy(yaml);
    expect(result.valid).toBe(false);
  });

  it('the shipped starter policy still loads with none of the new plain-language fields present', () => {
    const raw = readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8');
    const result = loadPolicy(raw);
    expect(result.valid).toBe(true);
  });
});

describe('list-valued field condition validation (R16-A1)', () => {
  it('TC-R16-A1-28: accepts the "in" operator on system_access_scope', () => {
    expect(validateConditionFieldValue('system_access_scope', { in: ['shared_infrastructure'] })).toEqual([]);
  });

  it('TC-R16-A1-29: rejects not_in on system_access_scope', () => {
    const errors = validateConditionFieldValue('system_access_scope', { not_in: ['shared_infrastructure'] });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.reason).toMatch(/system_access_scope/);
    expect(errors[0]?.reason).toMatch(/"in"/);
  });

  it('TC-R16-A1-30: rejects gte/lte on system_access_scope', () => {
    expect(validateConditionFieldValue('system_access_scope', { gte: 1 }).length).toBeGreaterThan(0);
    expect(validateConditionFieldValue('system_access_scope', { lte: 1 }).length).toBeGreaterThan(0);
  });

  it('TC-R16-A1-31: rejects bare equality on system_access_scope', () => {
    expect(validateConditionFieldValue('system_access_scope', 'shared_infrastructure').length).toBeGreaterThan(0);
  });

  it('TC-R16-A1-32: rejects an unknown value inside an "in" list on system_access_scope (canonical vocabulary)', () => {
    const errors = validateConditionFieldValue('system_access_scope', { in: ['root-access'] });
    expect(errors.some((e) => /root-access/.test(e.reason))).toBe(true);
  });

  it('TC-R16-A1-33: a policy whose invariant condition uses not_in on system_access_scope is rejected end-to-end', () => {
    const yaml = VALID_YAML.replace(
      'invariants: []',
      `invariants:
  - id: "INV-TEST-01"
    description: "test"
    condition:
      system_access_scope: { not_in: ["none"] }
    required_controls: []
    severity: "High"`,
    );
    const result = loadPolicy(yaml);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /system_access_scope/.test(e.reason))).toBe(true);
    }
  });

  it('does not flag other fields that are not list-valued', () => {
    expect(validateConditionFieldValue('autonomy_level', { gte: 1 })).toEqual([]);
    expect(validateConditionFieldValue('exposure', 'client-facing')).toEqual([]);
  });
});

function makeUseCaseNode(lifecycleStage: LifecycleStage, label: string): RegisterNode {
  return {
    node_id: crypto.randomUUID(),
    node_type: 'use_case',
    label,
    created_at: new Date().toISOString(),
    metadata: {
      node_type: 'use_case',
      submitted_by: '1LoD',
      lifecycle_stage: lifecycleStage,
      current_verdict_id: null,
      tier: 'Low',
      track: 'I',
    },
  };
}

describe('onPolicyUpdated (TC-LC-4-01)', () => {
  it('queues re_evaluation_queued for approved/in_production/pre_checked use cases only, and never changes lifecycle_stage', async () => {
    const stages: LifecycleStage[] = [
      'idea',
      'exploring',
      'pre_checked',
      'approved',
      'in_production',
      'monitored',
      'retired',
    ];
    const nodes = stages.map((stage) => makeUseCaseNode(stage, `${stage}-case`));
    for (const node of nodes) {
      await addNode(node);
    }

    await onPolicyUpdated('2.0');

    for (const node of nodes) {
      const events = await getAll(node.node_id);
      const queued = events.filter((e) => e.event_type === 're_evaluation_queued');
      const shouldBeQueued = ['approved', 'in_production', 'pre_checked'].includes(
        node.metadata.node_type === 'use_case' ? node.metadata.lifecycle_stage : '',
      );

      if (shouldBeQueued) {
        expect(queued).toHaveLength(1);
        expect(queued[0]?.payload).toEqual({ type: 're_evaluation_queued', policy_version: '2.0' });
        expect(queued[0]?.actor).toBe('system');
      } else {
        expect(queued).toHaveLength(0);
      }

      // §8: lifecycle_stage never changes on policy save, regardless of
      // whether re-evaluation was queued.
      const stageChangeEvents = events.filter((e) => e.event_type === 'lifecycle_stage_changed');
      expect(stageChangeEvents).toHaveLength(0);
    }
  });
});

describe('ControlSchema — verification_evidence (V1.3)', () => {
  it('accepts a control with optional verification_evidence and rejects a bad status literal', () => {
    const withEvidence = VALID_YAML.replace(
      'verification: "manual check"',
      'verification: "manual check"\n    verification_evidence:\n      status: "verified"\n      detail: "attested"',
    );
    expect(loadPolicy(withEvidence).valid).toBe(true);

    const badStatus = VALID_YAML.replace(
      'verification: "manual check"',
      'verification: "manual check"\n    verification_evidence:\n      status: "checked"',
    );
    const result = loadPolicy(badStatus);
    expect(result.valid).toBe(false);
  });

  // R16-W W-7 (D-77). Absent applies_to = unscoped (unchanged); present
  // must name at least one platform or vendor id — an applies_to with
  // both lists empty would silently scope the evidence to nothing, which
  // is never what a policy author means by writing it.
  it('TC-R16-W-52: accepts verification_evidence.applies_to with only platforms, only vendors, or both', () => {
    const withPlatforms = VALID_YAML.replace(
      'verification: "manual check"',
      'verification: "manual check"\n    verification_evidence:\n      status: "verified"\n      applies_to:\n        platforms: ["PLAT-X"]',
    );
    expect(loadPolicy(withPlatforms).valid).toBe(true);

    const withVendors = VALID_YAML.replace(
      'verification: "manual check"',
      'verification: "manual check"\n    verification_evidence:\n      status: "verified"\n      applies_to:\n        vendors: ["VENDOR-X"]',
    );
    expect(loadPolicy(withVendors).valid).toBe(true);

    const withBoth = VALID_YAML.replace(
      'verification: "manual check"',
      'verification: "manual check"\n    verification_evidence:\n      status: "verified"\n      applies_to:\n        platforms: ["PLAT-X"]\n        vendors: ["VENDOR-X"]',
    );
    expect(loadPolicy(withBoth).valid).toBe(true);
  });

  it('TC-R16-W-53: rejects verification_evidence.applies_to with both lists empty (or absent) — it must name at least one platform or vendor', () => {
    const emptyLists = VALID_YAML.replace(
      'verification: "manual check"',
      'verification: "manual check"\n    verification_evidence:\n      status: "verified"\n      applies_to:\n        platforms: []\n        vendors: []',
    );
    expect(loadPolicy(emptyLists).valid).toBe(false);

    const neitherList = VALID_YAML.replace(
      'verification: "manual check"',
      'verification: "manual check"\n    verification_evidence:\n      status: "verified"\n      applies_to: {}',
    );
    expect(loadPolicy(neitherList).valid).toBe(false);
  });
});

// R12 schema additions (TC-R12-SCHEMA; ADR-PS-R12-1).
describe('R12 schema additions', () => {
  it('TC-R12-SCHEMA-01: accepts sampling_rate as a top-level number', () => {
    const yaml = VALID_YAML + '\nsampling_rate: 5\n';
    const result = loadPolicy(yaml);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.policy.sampling_rate).toBe(5);
  });

  it('TC-R12-SCHEMA-02: rejects sampling_rate of the wrong type', () => {
    const yaml = VALID_YAML + '\nsampling_rate: "five"\n';
    const result = loadPolicy(yaml);
    expect(result.valid).toBe(false);
  });

  it('TC-R12-SCHEMA-03: is valid without sampling_rate (optional, backward compatible)', () => {
    const result = loadPolicy(VALID_YAML);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.policy.sampling_rate).toBeUndefined();
  });

  it('TC-R12-SCHEMA-04: accepts reattest_by on an approved_models entry', () => {
    const yaml =
      VALID_YAML +
      `
approved_models:
  - model_id: "fam"
    vendor: "v"
    provenance_class: "vendor_hosted"
    is_approved: true
    is_family: true
    reattest_by: "2027-01-01"
`;
    const result = loadPolicy(yaml);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.policy.approved_models?.[0]?.reattest_by).toBe('2027-01-01');
  });

  it('TC-R12-SCHEMA-05: rejects reattest_by of the wrong type', () => {
    const yaml =
      VALID_YAML +
      `
approved_models:
  - model_id: "fam"
    vendor: "v"
    provenance_class: "vendor_hosted"
    is_approved: true
    reattest_by: 20270101
`;
    const result = loadPolicy(yaml);
    expect(result.valid).toBe(false);
  });
});

// Traceability close-out (2026-08-15): criteria that had no covering test.
describe('the shipped policy file is the CF-1/CF-3 evidence', () => {
  it('is commented plain text a risk reader can open in any editor [TC-CF-1-01]', () => {
    const raw = readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8');
    // Human-readable comments explaining sections — CF-1's fit criterion.
    expect((raw.match(/^\s*#/gm) ?? []).length).toBeGreaterThan(20);
    // No minified content: real line structure, no absurdly long lines.
    expect(raw.split('\n').every((l) => l.length < 400)).toBe(true);

    // gvm-test 007 close-out: the Then also forbids "binary encoding" and
    // "developer-only syntax", and says every rule, threshold and tier is
    // readable as plain English. Asserted over the whole file, not a sample.
    // No control characters (a binary or corrupted file would have them).
    expect(raw).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    // No YAML tags (!!), merge keys (<<:), anchors (&x) or aliases (*x) outside
    // comments and quoted strings — the constructs a non-developer cannot read.
    const code = raw
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .map((l) => l.replace(/"(?:[^"\\]|\\.)*"/g, '""'))
      .join('\n');
    expect(code).not.toMatch(/!!|<<:|(^|\s)&[A-Za-z]|(^|\s)\*[A-Za-z]/m);
    // Every hard line, invariant, tier and control has a plain-English sentence.
    const loaded = loadPolicy(raw);
    if (!loaded.valid) throw new Error('shipped policy invalid');
    const p = loaded.policy;
    const sentences = [
      ...p.hard_lines.map((h) => h.description),
      ...p.invariants.map((i) => i.description),
      ...p.controls.map((c) => c.description),
    ];
    expect(sentences.length).toBeGreaterThan(20);
    expect(sentences.every((d) => typeof d === 'string' && d.trim().split(/\s+/).length >= 3)).toBe(true);
    expect(p.tiers.length).toBeGreaterThan(0);
    expect(p.tiers.every((t) => t.name.trim().length > 0)).toBe(true);
  });

  it('a policy with a blank version cannot be used at all [TC-CF-3-01]', () => {
    const raw = readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8');
    const result = loadPolicy(raw.replace(/^version:.*$/m, 'version: ""'));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.field === 'version')).toBe(true);
  });
});
