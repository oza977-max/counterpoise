import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import RegisterDetail from '../RegisterDetail';
import { loadPolicy } from '../../store/policy';
import { __resetDbsForTests } from '../../store/db';
import { __resetChainStateForTests } from '../../store/audit';
import { importBundle, __resetHandoffSyncStateForTests } from '../../store/handoff';
import { seedCase, DESCRIPTION } from '../../test-support/answer-sources-fixtures';
import type { PolicyFile } from '../../engine/types';

// R18-G, TC-R18-GI-13-03: an old record and a hand-off from before Round 18 claim nothing about pre-filling:
// neither the register detail of a case with no recorded answer sources nor one imported from a bundle that
// predates them says "from your description", "pre-filled" or "confirmed by you", and each shows the description
// exactly as stored. (No App here: its background seeding of the demo portfolio would race the resets.)

const policyRes = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
if (!policyRes.valid) throw new Error('shipped policy invalid');
const POLICY: PolicyFile = policyRes.policy;
const PRE_FILL_CLAIMS = /from your description|pre-filled|confirmed by you/i;

async function renderDetail(id: string, name: string) {
  const view = render(<RegisterDetail useCaseId={id} role="2LoD" policy={POLICY} onBack={() => {}} />);
  await screen.findByRole('heading', { name });
  await screen.findByText(/no break found in the \d+ events present/i);
  return view.container;
}

describe('TC-R18-GI-13-03: an old record and a hand-off from before Round 18 claim nothing about pre-filling', () => {
  it('an old record (no recorded answer sources): none of the three claims, and the description exactly as stored', async () => {
    await __resetDbsForTests();
    __resetChainStateForTests();
    await seedCase('uc-r18g-old', { label: 'Older record G' });
    const c = await renderDetail('uc-r18g-old', 'Older record G');
    expect(c.textContent).not.toMatch(PRE_FILL_CLAIMS);
    expect(c.textContent).toContain(DESCRIPTION);
  });

  it('a hand-off bundle saved before Round 18 (the committed fixture), once imported: the same', async () => {
    const bundle = JSON.parse(readFileSync(resolve(__dirname, '../../../test/fixtures/r18-e-handoff-older-cases.json'), 'utf-8'));
    expect(JSON.stringify(bundle)).not.toContain('answer_sources');
    await __resetDbsForTests();
    __resetChainStateForTests();
    __resetHandoffSyncStateForTests();
    expect((await importBundle(bundle)).outcome).toBe('imported_into_empty');
    for (const [id, name] of [
      ['uc-r18e-fixture-notsure', 'Older case, two Not sure answers (E)'],
      ['uc-r18e-fixture-blank', 'Older case, nothing recorded (E)'],
    ] as const) {
      const c = await renderDetail(id, name);
      expect(c.textContent, name).not.toMatch(PRE_FILL_CLAIMS);
      expect(c.textContent, name).toContain(DESCRIPTION);
      within(document.body).getAllByText(name);
    }
  });

  it('the check can fail: a record that does carry sources makes the claims on the same screen', async () => {
    const { realisticSources } = await import('../../test-support/answer-sources-fixtures');
    await __resetDbsForTests();
    __resetChainStateForTests();
    await seedCase('uc-r18g-new', { label: 'Newer record G', sources: realisticSources() });
    const c = await renderDetail('uc-r18g-new', 'Newer record G');
    expect(c.textContent).toMatch(PRE_FILL_CLAIMS);
  });
});
