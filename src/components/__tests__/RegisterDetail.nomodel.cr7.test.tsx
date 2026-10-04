import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import RegisterDetail from '../RegisterDetail';
import { addNode, addUseCaseModelLink } from '../../store/register';
import { append } from '../../store/audit';
import { evaluate } from '../../engine/evaluate';
import { buildGraphFromForm } from '../../engine/build-graph-from-form';
import { loadPolicy } from '../../store/policy';
import appetiteYaml from '../../../policy/appetite.yaml?raw';
import type { RegisterNode } from '../../store/types';
import type { Verdict } from '../../types/verdict';

// UC-11 on the register path (CR7-11, coordinator follow-up). The register
// keeps no graph, but it can tell whether a model was named: the first
// confirmation writes an `ai_model` node and a `uses_model` edge only when one
// was declared. Rule the screen follows — it says "No AI model is recorded" only
// when ALL hold: the links loaded; no uses_model edge; the case was created
// after model links shipped (2026-08-18) so a missing edge means "none"; and
// no correction on the trail named a model later (a correction writes no link).
// Anything else shows nothing rather than a claim it cannot support.
const LINE = 'No AI model is recorded for this use case — your AI risk team may ask which one it uses.';

function policy() {
  const r = loadPolicy(appetiteYaml);
  if (!r.valid) throw new Error('bad policy');
  return r.policy;
}

function realVerdict(useCaseId: string, declaredModel?: string): { verdict: Verdict; graph: ReturnType<typeof buildGraphFromForm> } {
  const g = buildGraphFromForm(
    {
      useCaseName: 'x', description: 'y', inputDataClass: 'Internal', inputDataZone: 'Zone B', modelType: 'ml',
      autonomyLevel: 1, processingDataZone: 'Zone B', outputActionType: 'recommend', outputExposure: 'internal-shared',
      decisionBindingness: 'advisory', outputReversibility: 'reversible', outputScale: 'limited',
      replacesPriorModel: false, jurisdictions: [],
    },
    '2026-10-01T00:00:00.000Z',
    () => crypto.randomUUID(),
  );
  if (declaredModel) g.processing_nodes[0]!.declared_model_id = declaredModel;
  const e = evaluate(g, policy());
  if (!e.ok) throw new Error('eval failed');
  const verdict = {
    ...e.value, id: `v-${useCaseId}`, use_case_id: useCaseId, living_status: 'approved' as const,
    living_status_updated_at: '2026-10-01T00:00:00Z', attested_by: '1LoD', attested_at: '2026-10-01T00:00:00Z',
    graph_version: 1, corrections: [],
  } as Verdict;
  return { verdict, graph: g };
}

async function seed(opts: { declaredModel?: string; createdAt?: string; link?: boolean; correctionToModel?: boolean }) {
  const id = crypto.randomUUID();
  await addNode({
    node_id: id,
    node_type: 'use_case',
    label: 'A case',
    created_at: opts.createdAt ?? '2026-10-02T00:00:00.000Z',
    metadata: { node_type: 'use_case', submitted_by: '1LoD', lifecycle_stage: 'pre_checked', current_verdict_id: null, tier: 'High', track: 'II' },
  } as RegisterNode);
  const { verdict, graph } = realVerdict(id, opts.declaredModel);
  await append({
    event_id: crypto.randomUUID(), use_case_id: id, event_type: 'verdict_produced',
    occurred_at: '2026-10-02T00:00:01.000Z', actor: '1LoD', payload: { type: 'verdict_produced', verdict },
  } as Parameters<typeof append>[0]);
  if (opts.correctionToModel) {
    await append({
      event_id: crypto.randomUUID(), use_case_id: id, event_type: 'graph_corrected',
      occurred_at: '2026-10-02T00:00:02.000Z', actor: '1LoD',
      payload: {
        type: 'graph_corrected',
        correction: { correction_id: 'c', graph_version_before: 1, graph_version_after: 2, node_id: 'p1', field: 'declared_model_id', original_value: null, corrected_value: 'qwen3:4b', corrected_by: '1LoD', corrected_at: '2026-10-02T00:00:02.000Z' },
      },
    } as unknown as Parameters<typeof append>[0]);
  }
  if (opts.link && opts.declaredModel) await addUseCaseModelLink(id, graph.processing_nodes[0]!, policy());
  return id;
}

async function renderAndWait(id: string) {
  const r = render(<RegisterDetail useCaseId={id} role="2LoD" policy={policy()} onBack={vi.fn()} />);
  await screen.findByText('A case');
  // let the link read settle
  await new Promise((res) => setTimeout(res, 50));
  return r;
}

describe('RegisterDetail — the no-model-recorded line on the register path (UC-11)', () => {
  it('TC-CR7-11d: a case with no uses_model edge shows the line', async () => {
    const id = await seed({});
    const { container } = await renderAndWait(id);
    expect(container.textContent).toContain(LINE);
  });

  it('TC-CR7-11e: a case whose model was linked does NOT show it (BC-005 false case, real addUseCaseModelLink)', async () => {
    const id = await seed({ declaredModel: 'qwen3:4b', link: true });
    const { container } = await renderAndWait(id);
    expect(container.textContent).not.toContain(LINE);
    expect(container.querySelector('.verdict__no-model-named')).toBeNull();
  });

  it('TC-CR7-11f: a case from before model links existed cannot be told apart from "none named" — nothing is claimed', async () => {
    const id = await seed({ createdAt: '2026-07-01T00:00:00.000Z' });
    const { container } = await renderAndWait(id);
    expect(container.textContent).not.toContain(LINE);
    expect(container.querySelector('.verdict__no-model-named')).toBeNull();
  });

  it('TC-CR7-11g: a model named in a later correction (which writes no link) — nothing is claimed', async () => {
    const id = await seed({ correctionToModel: true });
    const { container } = await renderAndWait(id);
    expect(container.textContent).not.toContain(LINE);
    expect(container.querySelector('.verdict__no-model-named')).toBeNull();
  });
});
