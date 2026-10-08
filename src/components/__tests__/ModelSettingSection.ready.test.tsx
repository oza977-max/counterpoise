import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ModelSettingSection from '../ModelSettingSection';
import { R18_COPY } from '../plain-copy';
import type { ModelSnapshot } from '../useModelSetting';

// R18-B fix: the Forget control waits for the first read of storage (no layout jump).
let snap: ModelSnapshot;
vi.mock('../useModelSetting', () => ({ useModelSetting: () => snap }));

const setting = { version: 1 as const, place: 'this-computer' as const, url: 'http://localhost:11434', model: 'qwen3:4b' };

describe('Forget control readiness', () => {
  it('is absent until the snapshot is ready, then offered', () => {
    snap = { ready: false, state: { kind: 'valid', setting }, keyStored: false, results: [] };
    const { rerender } = render(<ModelSettingSection />);
    expect(screen.queryByRole('button', { name: R18_COPY.FORGET_SETTING_LABEL, hidden: true })).not.toBeInTheDocument();
    snap = { ...snap, ready: true };
    rerender(<ModelSettingSection />);
    expect(screen.getByRole('button', { name: R18_COPY.FORGET_SETTING_LABEL, hidden: true })).toBeInTheDocument();
  });
});
