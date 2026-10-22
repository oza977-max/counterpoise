import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import RegisterDetail from '../RegisterDetail';
import { loadPolicy } from '../../store/policy';
import { R18_COPY } from '../plain-copy';
import { seedCase } from '../../test-support/answer-sources-fixtures';
import type { PolicyFile } from '../../engine/types';

// R18-D1 review pass 1, minor 7: "an older case reads as before" proved by comparison, not just by absence. The
// panel is swapped for one that returns null on demand; the old case must render the same DOM either way.

const switches = vi.hoisted(() => ({ nullPanel: false }));
vi.mock('../AnswerSourcesPanel', async () => {
  const actual = await vi.importActual<typeof import('../AnswerSourcesPanel')>('../AnswerSourcesPanel');
  const Real = actual.default;
  return { default: (props: React.ComponentProps<typeof Real>) => (switches.nullPanel ? null : <Real {...props} />) };
});

const loaded = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
if (!loaded.valid) throw new Error('shipped policy invalid');
const POLICY: PolicyFile = loaded.policy;

// React's generated ids differ between renders; the DOM is otherwise compared as it is.
const normalised = (html: string) => html.replace(/:r[0-9a-z]+:/g, ':id:');

async function renderOld(id: string, nullPanel: boolean) {
  switches.nullPanel = nullPanel;
  const view = render(<RegisterDetail useCaseId={id} role="2LoD" policy={POLICY} onBack={() => {}} />);
  await screen.findByRole('heading', { name: 'Client email drafting assistant' });
  const html = normalised(view.container.innerHTML);
  const container = view.container;
  return { html, container };
}

describe('RegisterDetail - an old case reads exactly as before (review pass 1 minor 7)', () => {
  it('a case with no answer_sources renders no sources panel element, and the same DOM as when the panel returns null', async () => {
    await seedCase('uc-old-1', {});
    const withPanel = await renderOld('uc-old-1', false);
    expect(withPanel.container.querySelector('.register-detail__sources')).toBeNull();
    expect(withPanel.container.querySelector('[aria-labelledby]')).toBeNull();
    expect(screen.queryByRole('heading', { name: R18_COPY.SOURCES_HEADING })).toBeNull();
    expect(screen.queryByRole('region', { name: R18_COPY.SOURCES_HEADING })).toBeNull();
    cleanup();

    const withoutPanel = await renderOld('uc-old-1', true);
    expect(withPanel.html).toBe(withoutPanel.html);
  });

  it('the comparison can fail: with sources recorded, the DOM differs from the null-panel render', async () => {
    const { realisticSources } = await import('../../test-support/answer-sources-fixtures');
    await seedCase('uc-new-1', { sources: realisticSources() });
    const withPanel = await renderOld('uc-new-1', false);
    expect(withPanel.container.querySelector('.register-detail__sources')).not.toBeNull();
    cleanup();
    const withoutPanel = await renderOld('uc-new-1', true);
    expect(withPanel.html).not.toBe(withoutPanel.html);
  });
});
