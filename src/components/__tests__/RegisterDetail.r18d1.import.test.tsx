import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import RegisterDetail from '../RegisterDetail';
import { loadPolicy } from '../../store/policy';
import { __resetChainStateForTests } from '../../store/audit';
import { __resetDbsForTests } from '../../store/db';
import { importBundle, __resetHandoffSyncStateForTests } from '../../store/handoff';
import { R18_COPY } from '../plain-copy';
import type { PolicyFile } from '../../engine/types';

// R18-D1: the committed hand-off files, imported into an empty register and opened. What the sender recorded is what the
// reviewer reads (TC-R18-GI-5-02), and a file made before this round opens as it always did (TC-R18-GI-5-03).

const loaded = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
if (!loaded.valid) throw new Error('shipped policy invalid');
const POLICY: PolicyFile = loaded.policy;
const fixture = (name: string) => JSON.parse(readFileSync(resolve(__dirname, `../../../test/fixtures/${name}`), 'utf-8'));

beforeEach(async () => {
  await __resetDbsForTests();
  __resetChainStateForTests();
  __resetHandoffSyncStateForTests();
});

async function openImported(file: string, id: string) {
  expect((await importBundle(fixture(file))).outcome).toBe('imported_into_empty');
  const view = render(<RegisterDetail useCaseId={id} role="2LoD" policy={POLICY} onBack={() => {}} />);
  await screen.findByRole('region', { name: /verdict/i });
  return view;
}

describe('RegisterDetail - an imported case', () => {
  it('TC-R18-GI-5-02d1c: shows the sender\'s model, place, quotes and origins, with none changed in transit', async () => {
    const { container } = await openImported('r18-d1-handoff-with-sources.json', 'uc-r18d1-sample-cloud');
    expect(screen.getByText("read by gemma4:cloud by Ollama's cloud, through the Ollama app on the computer in use")).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: R18_COPY.SOURCES_HEADING })).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(container.textContent).toContain('filled from your description and confirmed by you — “internal ticket volumes” (suggested by gemma4:cloud)');
    expect(container.textContent).toContain('changed by you (from Just me, or a small trial — “a small trial”, suggested by gemma4:cloud)');
    // the import changed no origin: a typed answer is still typed
    expect(rows.filter((r) => /typed by you/.test(r.textContent ?? ''))).toHaveLength(1);
    // provenance is the sender's word, and the screen says what was set up, not what was proven
    expect(container.textContent).toContain(R18_COPY.READ_NOTE);
  });

  it('TC-R18-GI-5-03d1c: a case from a file made before this round shows no source line at all', async () => {
    const { container } = await openImported('r18-d1-handoff-before-round-18.json', 'uc-r18d1-sample-before');
    expect(screen.queryByRole('list', { name: R18_COPY.SOURCES_HEADING })).toBeNull();
    expect(container.querySelector('.register-detail__sources')).toBeNull();
    expect(container.textContent).not.toMatch(/read by|typed by you|suggested by|filled in by a model|from the earlier record/);
  });
});
