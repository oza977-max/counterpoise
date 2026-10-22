import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAllForExport, verifyChain, __resetChainStateForTests } from './audit';
import { __resetDbsForTests } from './db';
import { exportBundle, importBundle, __resetHandoffSyncStateForTests } from './handoff';
import { seedCase, realisticSources, cloudSources, typedOnlySources } from '../test-support/answer-sources-fixtures';

// R18-D1: two committed hand-off files, so a person (or the main session) can walk the import screen with
// something real.
//   test/fixtures/r18-d1-handoff-with-sources.json    three cases carrying answer_sources (§27.13)
//   test/fixtures/r18-d1-handoff-before-round-18.json one case in the shape every earlier build exported
// Both are real sealed bundles made by exportBundle() from the hand-made records of
// src/test-support/answer-sources-fixtures.ts. They are regenerated only on purpose:
//   R18_D1_WRITE_FIXTURES=1 npm test -- src/store/handoff.r18d1.fixture.test.ts
// Every other run only reads them back and imports them.

const DIR = resolve(__dirname, '../../test/fixtures');
const WITH = resolve(DIR, 'r18-d1-handoff-with-sources.json');
const BEFORE = resolve(DIR, 'r18-d1-handoff-before-round-18.json');

async function freshMachine() {
  await __resetDbsForTests();
  __resetChainStateForTests();
  __resetHandoffSyncStateForTests();
}

describe('R18-D1 committed hand-off fixtures', () => {
  it('(regenerate only on purpose) writes the two files', async () => {
    if (process.env.R18_D1_WRITE_FIXTURES !== '1') return;
    await freshMachine();
    await seedCase('uc-r18d1-sample-local', { label: 'Client email assistant (read on this computer)', sources: realisticSources() });
    await seedCase('uc-r18d1-sample-cloud', { label: 'Ticket volume summary (read by Ollama cloud)', sources: cloudSources() });
    await seedCase('uc-r18d1-sample-typed', { label: 'Ticket volume report (all typed by hand)', sources: typedOnlySources() });
    writeFileSync(WITH, JSON.stringify(await exportBundle('0.17.0-r18-d1-fixture'), null, 2) + '\n');
    await freshMachine();
    await seedCase('uc-r18d1-sample-before', { label: 'Older case (exported before Round 18)' });
    writeFileSync(BEFORE, JSON.stringify(await exportBundle('0.17.0-r18-d1-fixture'), null, 2) + '\n');
  });

  it('TC-R18-GI-5-02d1fx: the committed bundle with sources imports into an empty register, sources intact, chain verified', async () => {
    const bundle = JSON.parse(readFileSync(WITH, 'utf-8'));
    await freshMachine();
    const result = await importBundle(bundle);
    expect(result.outcome).toBe('imported_into_empty');
    const confirmed = (await getAllForExport()).filter((e) => e.payload.type === 'graph_confirmed');
    expect(confirmed).toHaveLength(3);
    expect(JSON.stringify(confirmed.map((e) => e.payload))).toContain('"gemma4:cloud"');
    expect((await verifyChain()).ok).toBe(true);
  });

  it('TC-R18-GI-5-03d1fx: the committed bundle exported before this round imports unchanged and carries no source', async () => {
    const bundle = JSON.parse(readFileSync(BEFORE, 'utf-8'));
    expect(bundle.format_version).toBe(1);
    expect(JSON.stringify(bundle)).not.toContain('answer_sources');
    await freshMachine();
    expect((await importBundle(bundle)).outcome).toBe('imported_into_empty');
    expect((await verifyChain()).ok).toBe(true);
  });
});
