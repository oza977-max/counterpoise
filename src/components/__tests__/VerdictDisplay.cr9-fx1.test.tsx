import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../../store/policy';
import { evaluate } from '../../engine/evaluate';
import { buildGraphFromForm } from '../../engine/build-graph-from-form';
import VerdictDisplay from '../VerdictDisplay';
import { SIGNOFF_MISSING_CONFIRM, SIGNOFF_UNKNOWN_CONFIRM } from '../verdict-view-model';
import type { DataFlowGraph, PolicyFile } from '../../engine/types';
import type { Verdict } from '../../types/verdict';
import type { LifecycleStage } from '../../store/types';

// FX9-1 / code review 009 — CR9-02 (P6): one sign-off fact on every surface of the verdict screen.
// Real shipped policy, real evaluate() output (BC-003); the verdict's tier / controls are overridden
// to reach each state (the engine cannot be steered to "Medium, zero controls" from a form alone).
function realPolicy(): PolicyFile {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('bad policy');
  return r.policy;
}
function graphFor(): DataFlowGraph {
  return buildGraphFromForm(
    {
      useCaseName: 'x', description: 'y', inputDataClass: 'Internal', inputDataZone: 'Zone B', modelType: 'ml',
      autonomyLevel: 1, processingDataZone: 'Zone B', outputActionType: 'recommend', outputExposure: 'internal-shared',
      decisionBindingness: 'advisory', outputReversibility: 'reversible', outputScale: 'limited',
      replacesPriorModel: false, jurisdictions: [],
    },
    '2026-01-01T00:00:00.000Z',
    () => crypto.randomUUID(),
  );
}
function verdictFrom(policy: PolicyFile, over: Partial<Verdict> = {}): Verdict {
  const e = evaluate(graphFor(), policy);
  if (!e.ok) throw new Error('eval failed');
  return {
    ...e.value, id: 'v1', use_case_id: 'uc', living_status: 'approved' as const,
    living_status_updated_at: '2026-01-01T00:00:00Z', attested_by: '1LoD', attested_at: '2026-01-01T00:00:00Z',
    graph_version: 1, corrections: [], status: 'approved_with_controls', downstream_reviews: [], ...over,
  } as Verdict;
}
const SIGNED_OFF_EVENT = {
  event_id: 'e', use_case_id: 'uc', event_type: 'twoloD_reviewed', occurred_at: '2026-01-02T00:00:00.000Z', actor: '2LoD',
  payload: { type: 'twoloD_reviewed', action: 'approved', verdict_id: 'v1', attested_by_name: 'R' }, prev_hash: null, hash: 'h',
} as never;

function renderIt(opts: { tier: string; controls: number; stage?: LifecycleStage; signedOff?: boolean }) {
  const policy = realPolicy();
  const ids = policy.controls.slice(0, opts.controls).map((c) => c.id);
  const verdict = verdictFrom(policy, { tier: opts.tier as Verdict['tier'], controls: ids });
  return render(
    <VerdictDisplay verdict={verdict} auditEvents={opts.signedOff ? [SIGNED_OFF_EVENT] : []} policy={policy} registerStage={opts.stage} onCorrect={vi.fn()} />,
  );
}
const todoText = (c: HTMLElement) => c.querySelector('#verdict-todo-section')!.textContent ?? '';

describe('VerdictDisplay — CR9-02: the "What you need to do" box under an unclear sign-off', () => {
  it('TC-CR9-02a: Medium, stage approved, no events, no controls — the box does not say "Nothing." alone and carries the confirm sentence', () => {
    const { container } = renderIt({ tier: 'Medium', controls: 0, stage: 'approved' });
    const t = todoText(container);
    expect(t).toContain(SIGNOFF_MISSING_CONFIRM);
    expect(t).not.toMatch(/nothing\./i);
  });

  it('TC-CR9-02b: no stage at all — the box carries the unknown sentence', () => {
    const { container } = renderIt({ tier: 'Medium', controls: 0 });
    const t = todoText(container);
    expect(t).toContain(SIGNOFF_UNKNOWN_CONFIRM);
    expect(t).not.toMatch(/nothing\./i);
  });

  it('TC-CR9-02c: missing sign-off WITH controls — the "Then" group has a row worded as the view-model constant, not the pre-check text', () => {
    const { container } = renderIt({ tier: 'High', controls: 1, stage: 'approved' });
    const t = todoText(container);
    expect(t).toContain('Then');
    expect(t).toContain(SIGNOFF_MISSING_CONFIRM);
    expect(t).not.toMatch(/above the self-service threshold/i);
    // unknown, with controls
    const u = renderIt({ tier: 'High', controls: 1 });
    expect(todoText(u.container)).toContain(SIGNOFF_UNKNOWN_CONFIRM);
  });

  const PERMISSIVE = /you can start|nothing\.|no sign-off needed|nobody —/i;
  const STATES: Array<{ name: string; tier: string; stage?: LifecycleStage; signedOff?: boolean; unclear?: 'missing' | 'unknown' }> = [
    { name: 'signed off', tier: 'High', stage: 'approved', signedOff: true },
    { name: 'needsSignOff', tier: 'High', stage: 'pre_checked' },
    { name: 'missing', tier: 'High', stage: 'approved', unclear: 'missing' },
    { name: 'unknown', tier: 'High', unclear: 'unknown' },
    { name: 'determined self-service', tier: 'Low', stage: 'approved' },
  ];
  it('TC-CR9-02d: P6 sweep — whole-screen text for each sign-off state, 0 and 1 control', () => {
    for (const s of STATES) {
      for (const controls of [0, 1]) {
        const { container, unmount } = renderIt({ tier: s.tier, controls, stage: s.stage, signedOff: s.signedOff });
        const text = container.textContent ?? '';
        if (s.unclear) {
          expect(text, `${s.name}/${controls}`).not.toMatch(PERMISSIVE);
          expect(text, `${s.name}/${controls}`).toContain(s.unclear === 'missing' ? SIGNOFF_MISSING_CONFIRM : SIGNOFF_UNKNOWN_CONFIRM);
        } else if (s.name === 'determined self-service') {
          expect(text, `${s.name}/${controls}`).toMatch(/you can start/i);
        }
        unmount();
      }
    }
  });
});
