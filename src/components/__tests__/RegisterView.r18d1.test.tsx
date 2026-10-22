import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps } from 'react';
import RegisterView from '../RegisterView';
import { R18_COPY } from '../plain-copy';
import { __resetChainStateForTests } from '../../store/audit';
import { __resetDbsForTests } from '../../store/db';
import { __resetHandoffSyncStateForTests } from '../../store/handoff';
import { seedCase, realisticSources } from '../../test-support/answer-sources-fixtures';

// R18-D1 (TC-R18-GI-5-08, specs/intake-flow.md §27.13): the hand-off screens say plainly what the file is. The export
// sentence appears only once an export has been made; the import screen always says that where each answer came from
// is self-asserted, and that the chain of checks is not authentication.

function Harness(props: Omit<ComponentProps<typeof RegisterView>, 'selectedId' | 'onSelectRow' | 'onCloseDetail'>) {
  const [sel, setSel] = useState<string | null>(null);
  return <RegisterView {...props} selectedId={sel} onSelectRow={setSel} onCloseDetail={() => setSel(null)} />;
}

const originals = { Blob: globalThis.Blob, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
beforeEach(async () => {
  await __resetDbsForTests();
  __resetChainStateForTests();
  __resetHandoffSyncStateForTests();
  globalThis.Blob = class MockBlob {} as unknown as typeof Blob;
  URL.createObjectURL = (() => 'blob:mock-url') as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
});
afterEach(() => {
  globalThis.Blob = originals.Blob;
  URL.createObjectURL = originals.create;
  URL.revokeObjectURL = originals.revoke;
  vi.restoreAllMocks();
});

describe('RegisterView hand-off - what the file is (TC-R18-GI-5-08)', () => {
  it('TC-R18-GI-5-08: the export screen states what the file holds only after an export; the import screen says provenance is self-asserted', async () => {
    const user = userEvent.setup();
    await seedCase('uc-pre-filled', { sources: realisticSources() });
    render(<Harness role="1LoD" currentPolicyVersion="1.0" />);
    await screen.findByText('Client email drafting assistant');

    // Before any export: the import-side statement is on screen, the export sentence is not.
    expect(screen.getByText(R18_COPY.HANDOFF_IMPORT_PROVENANCE)).toBeInTheDocument();
    expect(R18_COPY.HANDOFF_IMPORT_PROVENANCE).toMatch(/whatever the person who made the file recorded/);
    expect(R18_COPY.HANDOFF_IMPORT_PROVENANCE).toMatch(/do not verify it, or who made the file/);
    expect(screen.queryByText(/This file contains the descriptions and quotes of every case in it\./)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^export hand-off bundle$/i }));
    const msg = await screen.findByText(/Created a hand-off file named/);
    expect(msg).toHaveTextContent('This file contains the descriptions and quotes of every case in it.');
    // the existing honesty about the download is kept
    expect(msg).toHaveTextContent(/Check it's in your downloads folder/);
  });

  it('TC-R18-GI-13-01d1e: the export sentence is absent when the export failed', async () => {
    const user = userEvent.setup();
    await seedCase('uc-fail', { sources: realisticSources() });
    render(<Harness role="1LoD" currentPolicyVersion="1.0" />);
    await screen.findByText('Client email drafting assistant');
    URL.createObjectURL = (() => {
      throw new Error('no downloads here');
    }) as typeof URL.createObjectURL;
    await user.click(screen.getByRole('button', { name: /^export hand-off bundle$/i }));
    await screen.findByText(/Export failed/);
    expect(screen.queryByText(/descriptions and quotes of every case/)).not.toBeInTheDocument();
  });
});
