import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAllForExport, verifyChain, __resetChainStateForTests } from './audit';
import { __resetDbsForTests } from './db';
import { exportBundle, importBundle, __resetHandoffSyncStateForTests } from './handoff';
import { describeAssumptions } from '../components/plain-copy';
import { seedCase } from '../test-support/answer-sources-fixtures';

// R18-E: a committed hand-off file holding two cases saved the way a build BEFORE Round 18 saved them (no
// answer_sources), so the older-case correction can be walked live by importing it:
//   test/fixtures/r18-e-handoff-older-cases.json
//     "Older case, two Not sure answers (E)"      graph_confirmed.assumptions names Questions 4 and 9
//     "Older case, nothing recorded (E)"          graph_confirmed carries no assumptions
// A real sealed bundle made by exportBundle(). Regenerated only on purpose:
//   R18_E_WRITE_FIXTURES=1 npm test -- src/store/handoff.r18e.fixture.test.ts
// Every other run only reads it back and imports it.

const FILE = resolve(__dirname, '../../test/fixtures/r18-e-handoff-older-cases.json');

async function freshMachine() {
  await __resetDbsForTests();
  __resetChainStateForTests();
  __resetHandoffSyncStateForTests();
}

describe('R18-E committed hand-off fixture of older cases', () => {
  it('(regenerate only on purpose) writes the file', async () => {
    if (process.env.R18_E_WRITE_FIXTURES !== '1') return;
    await freshMachine();
    await seedCase('uc-r18e-fixture-notsure', {
      label: 'Older case, two Not sure answers (E)',
      intakeMethod: 'llm',
      assumptions: describeAssumptions([
        { questionId: '4', optionKey: 'not-sure', fields: ['model_type'] },
        { questionId: '9', optionKey: 'not-sure', fields: ['output_reversibility'] },
      ]),
    });
    await seedCase('uc-r18e-fixture-blank', { label: 'Older case, nothing recorded (E)', intakeMethod: 'llm' });
    writeFileSync(FILE, JSON.stringify(await exportBundle('0.17.0-r18-e-fixture'), null, 2) + '\n');
  });

  it('the committed bundle holds older-shaped cases: assumptions on one, no answer_sources anywhere', () => {
    const text = readFileSync(FILE, 'utf-8');
    const bundle = JSON.parse(text);
    expect(bundle.format).toBe('aigate-handoff');
    expect(text).not.toContain('answer_sources');
    const confirmed = bundle.audit_events.filter((e: { event_type: string }) => e.event_type === 'graph_confirmed');
    expect(confirmed).toHaveLength(2);
    const withAssumptions = confirmed.filter((e: { payload: { assumptions?: unknown[] } }) => (e.payload.assumptions ?? []).length > 0);
    expect(withAssumptions).toHaveLength(1);
    expect(withAssumptions[0].payload.assumptions.map((a: { questionId: string }) => a.questionId)).toEqual(['4', '9']);
  });

  it('it imports into an empty register with the chain verified', async () => {
    const bundle = JSON.parse(readFileSync(FILE, 'utf-8'));
    await freshMachine();
    expect((await importBundle(bundle)).outcome).toBe('imported_into_empty');
    expect((await getAllForExport()).filter((e) => e.payload.type === 'verdict_produced')).toHaveLength(2);
    expect((await verifyChain()).ok).toBe(true);
  });

  it('it does NOT merge into a register that already holds other cases (the first-visit sample portfolio does): importBundle reports diverged, so a replace is needed', async () => {
    const bundle = JSON.parse(readFileSync(FILE, 'utf-8'));
    await freshMachine();
    await seedCase('uc-r18e-other-machine', { label: 'A case already here' });
    expect((await importBundle(bundle)).outcome).toBe('diverged');
  });
});
