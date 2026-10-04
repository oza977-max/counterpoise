import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PolicyEditor from '../PolicyEditor';
import * as policyStore from '../../store/policy';
import { addNode } from '../../store/register';
import { getAllForExport } from '../../store/audit';
import type { RegisterNode } from '../../store/types';

// Real onPolicyUpdated by default (BC-003: the trail is the real producer);
// individual tests make it fail through this spy.
// EBT exception (owner-accepted, code review 006/008): fault injection / fixture variation — the real module is wrapped; tests make onPolicyUpdated fail, or rewrite the REAL bundled pack sources.
vi.mock('../../store/policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/policy')>();
  return { ...actual, onPolicyUpdated: vi.fn(actual.onPolicyUpdated) };
});

// CR7-38: the pack sign-off state is varied per test by rewriting the REAL
// bundled pack sources (never hand-typed packs).
const packHolder = vi.hoisted(() => ({ rewrite: undefined as undefined | ((s: Record<string, string>) => Record<string, string>) }));
// EBT exception (owner-accepted, code review 006/008): fault injection / fixture variation — the real module is wrapped; tests make onPolicyUpdated fail, or rewrite the REAL bundled pack sources.
vi.mock('../../store/pack-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/pack-source')>();
  return {
    getPackSources: () => {
      const real = actual.getPackSources();
      return packHolder.rewrite ? packHolder.rewrite(real) : real;
    },
  };
});

const MINIMAL_VALID_POLICY_YAML = `
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
  # CR7-27: the shipped EU pack's required_control ids must exist in the
  # policy, or the (correct) reference check refuses the save.
  - id: "CTRL-DISCLOSE-01"
    name: "d"
    description: "d"
    resolves: []
    burden: 1
    verification: "v"
  - id: "CTRL-SYNTHMARK-01"
    name: "s"
    description: "s"
    resolves: []
    burden: 1
    verification: "v"

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


async function openYamlEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText(/edit the rulebook as yaml/i));
}

function useCase(label: string): RegisterNode {
  return {
    node_id: `cr7-06-${label}`,
    node_type: 'use_case',
    label,
    created_at: new Date().toISOString(),
    metadata: {
      node_type: 'use_case',
      submitted_by: '1LoD',
      lifecycle_stage: 'approved',
      current_verdict_id: null,
      tier: 'Low',
      track: 'I',
    },
  };
}

async function queuedFor(version: string) {
  const all = await getAllForExport();
  return all.filter((e) => e.payload.type === 're_evaluation_queued' && e.payload.policy_version === version);
}

async function pasteAndOpen(version: string) {
  const user = userEvent.setup();
  render(<PolicyEditor />);
  await openYamlEditor(user);
  const textarea = screen.getByLabelText(/policy yaml/i);
  await user.clear(textarea);
  await user.paste(MINIMAL_VALID_POLICY_YAML.replace('version: "1.0"', `version: "${version}"`));
  return user;
}

describe('PolicyEditor save (CR7-06)', () => {
  beforeEach(() => {
    localStorage.clear();
    packHolder.rewrite = undefined;
  });

  it('TC-CR7-06a-1: two rapid clicks on Save queue each active case once (the real trail)', async () => {
    await addNode(useCase('a'));
    await addNode(useCase('b'));
    await pasteAndOpen('cr7-06a');
    const save = screen.getByRole('button', { name: /^save/i });
    fireEvent.click(save);
    fireEvent.click(save); // synchronous second click, before any re-render
    await screen.findByText(/policy saved/i);
    await waitFor(async () => {
      const queued = await queuedFor('cr7-06a');
      const mine = queued.filter((e) => e.use_case_id.startsWith('cr7-06-'));
      expect(mine.map((e) => e.use_case_id).sort()).toEqual(['cr7-06-a', 'cr7-06-b']);
    });
    expect(policyStore.onPolicyUpdated).toHaveBeenCalledTimes(1);
  });

  it('TC-CR7-06a-2: Save is disabled while the save is running', async () => {
    let release!: () => void;
    vi.mocked(policyStore.onPolicyUpdated).mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve({ queuedCount: 0, alreadyPendingCount: 0 }); }),
    );
    await pasteAndOpen('cr7-06a2');
    fireEvent.click(screen.getByRole('button', { name: /^sav/i }));
    expect(await screen.findByRole('button', { name: /saving/i })).toBeDisabled();
    release();
    expect(await screen.findByText(/policy saved/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled();
  });

  it('TC-CR7-06b: a failing onPolicyUpdated shows a plain message, not a silent unhandled rejection', async () => {
    vi.mocked(policyStore.onPolicyUpdated).mockRejectedValueOnce(new Error('disk full'));
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<PolicyEditor onSaved={onSaved} />);
    await openYamlEditor(user);
    const textarea = screen.getByLabelText(/policy yaml/i);
    await user.clear(textarea);
    await user.paste(MINIMAL_VALID_POLICY_YAML);
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    const alert = await screen.findByText(/did not finish/i);
    // CR7-06c makes a retry safe, so the message says so
    expect(alert.textContent).toMatch(/saving again is safe/i);
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    expect(alert.textContent).not.toMatch(/disk full|Error:/);
    // CR9-03 (amended): the YAML WAS stored, so the app must pick up the new rules — onSaved fires once.
    expect(onSaved).toHaveBeenCalledTimes(1);
    // not stuck: Save is usable again
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled();
  });
});

describe('PolicyEditor save — a part-failed save still tells the app (CR9-03)', () => {
  beforeEach(() => {
    localStorage.clear();
    packHolder.rewrite = undefined;
  });

  it('TC-CR9-03: onPolicyUpdated rejects — onSaved is called exactly once and the save-failed message is shown', async () => {
    vi.mocked(policyStore.onPolicyUpdated).mockRejectedValueOnce(new Error('queue failed'));
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<PolicyEditor onSaved={onSaved} />);
    await openYamlEditor(user);
    const textarea = screen.getByLabelText(/policy yaml/i);
    await user.clear(textarea);
    await user.paste(MINIMAL_VALID_POLICY_YAML);
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(/did not finish/i)).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});

describe('PolicyEditor save — counts and storage failure (CR7-06)', () => {
  beforeEach(() => {
    localStorage.clear();
    packHolder.rewrite = undefined;
  });

  it('TC-CR7-06d-1: after a retry the saved message says how many were already waiting', async () => {
    vi.mocked(policyStore.onPolicyUpdated).mockResolvedValueOnce({ queuedCount: 1, alreadyPendingCount: 2 });
    const user = await pasteAndOpen('cr7-06d');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(/1 active use case queued for re-evaluation \(2 already waiting\)/i)).toBeInTheDocument();
  });

  it('TC-CR7-06d-2: with nothing already waiting the message has no "already waiting" part', async () => {
    vi.mocked(policyStore.onPolicyUpdated).mockResolvedValueOnce({ queuedCount: 2, alreadyPendingCount: 0 });
    const user = await pasteAndOpen('cr7-06d2');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(/policy saved/i)).toBeInTheDocument();
    expect(screen.queryByText(/already waiting/i)).not.toBeInTheDocument();
  });

  it('TC-CR7-06e: if the browser refuses to store the policy, the alert does not claim it was saved or that saving again is safe', async () => {
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<PolicyEditor onSaved={onSaved} />);
    await openYamlEditor(user);
    const textarea = screen.getByLabelText(/policy yaml/i);
    await user.clear(textarea);
    await user.paste(MINIMAL_VALID_POLICY_YAML);
    vi.mocked(policyStore.onPolicyUpdated).mockClear();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    try {
      await user.click(screen.getByRole('button', { name: /^save$/i }));
      const alert = await screen.findByText(/could not be saved to this browser/i);
      expect(alert.closest('[role="alert"]')).not.toBeNull();
      expect(alert.closest('[role="alert"]')!.textContent).not.toMatch(/was saved|saving again is safe/i);
    } finally {
      setItem.mockRestore();
    }
    expect(policyStore.onPolicyUpdated).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByText(/policy saved/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled();
  });
});

describe('PolicyEditor pack sign-off wording (CR7-38)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function sign(filesToSign: string[]) {
    return (real: Record<string, string>) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(real)) {
        out[k] = filesToSign.some((f) => k.endsWith(f))
          ? v
              .replace(/^reviewer_name:.*$/m, 'reviewer_name: "A. Reviewer"')
              .replace(/^sign_off_date:.*$/m, 'sign_off_date: "2026-09-01"')
          : v;
      }
      return out;
    };
  }

  function euLine() {
    const li = screen.getByText('EU').closest('li')!;
    return li.querySelector('.policy-view__pack-state-plain')!.textContent ?? '';
  }

  it('TC-CR7-38a: no pack signed off says none', () => {
    packHolder.rewrite = sign([]);
    render(<PolicyEditor />);
    expect(euLine()).toMatch(/\d+ rules? applying — none signed off/);
  });

  it('TC-CR7-38b: one of two EU packs signed off says N of M, and never "not yet signed off" or "all"', () => {
    packHolder.rewrite = sign(['eu-ai-act.yaml']);
    render(<PolicyEditor />);
    const line = euLine();
    expect(line).toMatch(/\d+ rules? applying — \d+ of \d+ signed off/);
    expect(line).not.toMatch(/none|all signed|not yet/);
  });

  it('TC-CR7-38c: every EU pack signed off says all signed off, and never claims "not yet signed off"', () => {
    packHolder.rewrite = sign(['eu-ai-act.yaml', 'dora.yaml']);
    render(<PolicyEditor />);
    const line = euLine();
    expect(line).toMatch(/\d+ rules? applying — all signed off/);
    expect(line).not.toMatch(/not yet|none/);
  });
});
