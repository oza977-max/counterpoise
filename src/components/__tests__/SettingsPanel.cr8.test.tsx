import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPanel from '../SettingsPanel';
import * as resetStore from '../../store/reset';

// EBT exception (owner-accepted, code review 006/008): fault injection — a
// blocked database delete cannot be produced on demand, so the incomplete
// outcome is injected; the wording under test is the panel's own.
vi.mock('../../store/reset', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/reset')>();
  return { ...actual, clearAllLocalData: vi.fn(actual.clearAllLocalData) };
});

// CR8-16 (BC-005, every surface of one fact): the Clear-all confirmation and
// the "not everything could be deleted" message both state what reset.ts and
// the panel clear — the role, the hand-off record, the welcome flag and the
// unsaved intake drafts — and what is kept.
const CLEARED_LOCAL_STORAGE_KEYS = ['aigate:role', 'aigate:welcome-dismissed', 'aigate-handoff-last-synced-tip'];

async function openConfirmation() {
  const user = userEvent.setup();
  render(<SettingsPanel />);
  await user.click(screen.getByText(/demo data/i));
  await user.click(screen.getByRole('button', { name: /clear all data and start over/i }));
  return user;
}

describe('SettingsPanel — Clear all wording (CR8-16)', () => {
  const reload = vi.fn();
  const realLocation = window.location;
  beforeEach(() => {
    reload.mockClear();
    vi.stubGlobal('location', { ...realLocation, reload });
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('TC-CR8-16a: the confirmation names the role, hand-off record, welcome flag and drafts it clears, and what it keeps', async () => {
    await openConfirmation();
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).toMatch(/your (selected|chosen) role/i);
    expect(text).toMatch(/hand-off/i);
    expect(text).toMatch(/welcome panel will show again/i);
    expect(text).toMatch(/unsaved intake draft/i);
    expect(text).toMatch(/model settings/i);
    expect(text).toMatch(/appetite framework you saved/i);
    // a blocked delete may still complete once the other tabs close
    expect(text).toMatch(/another tab/i);
  });

  it('TC-CR8-16b: the incomplete message names the same cleared items and says a blocked delete may still complete', async () => {
    vi.mocked(resetStore.clearAllLocalData).mockResolvedValueOnce({ complete: false, incomplete: ['aigate-audit (blocked)'] });
    const user = await openConfirmation();
    await user.click(screen.getByRole('button', { name: /yes, delete everything/i }));
    const text = (await screen.findByText(/not everything could be deleted/i)).textContent ?? '';
    // CR9-14 (amended): plain names, never the database id or its outcome word
    expect(text).toMatch(/your audit trail/);
    expect(text).not.toMatch(/aigate-|blocked/);
    expect(text).toMatch(/role/i);
    expect(text).toMatch(/hand-off/i);
    expect(text).toMatch(/welcome/i);
    expect(text).toMatch(/intake drafts/i);
    expect(text).toMatch(/may still (finish|complete)/i);
  });

  it('TC-CR8-16c: the local-storage keys reset.ts clears are exactly the ones the messages name', async () => {
    const actual = await vi.importActual<typeof import('../../store/reset')>('../../store/reset');
    for (const k of CLEARED_LOCAL_STORAGE_KEYS) localStorage.setItem(k, 'x');
    localStorage.setItem('aigate:policy-yaml', 'kept');
    // R18-B: the model setting and its saved test results are kept by Clear all data (NF-3-08, MS-5-04).
    localStorage.setItem('aigate:model-setting', 'kept');
    localStorage.setItem('aigate:model-test-results', 'kept');
    const before = Object.keys(localStorage).sort();
    await actual.clearAllLocalData();
    const removed = before.filter((k) => localStorage.getItem(k) === null).sort();
    expect(removed).toEqual([...CLEARED_LOCAL_STORAGE_KEYS].sort());
  });
});

describe('SettingsPanel — incomplete message names data plainly (CR9-14)', () => {
  const reload = vi.fn();
  const realLocation = window.location;
  beforeEach(() => {
    reload.mockClear();
    vi.stubGlobal('location', { ...realLocation, reload });
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('TC-CR9-14: both databases incomplete — the message names both in plain words and prints no database id', async () => {
    vi.mocked(resetStore.clearAllLocalData).mockResolvedValueOnce({
      complete: false,
      incomplete: ['aigate-register (blocked)', 'aigate-audit (error)', 'aigate-future (blocked)'],
    });
    const user = await openConfirmation();
    await user.click(screen.getByRole('button', { name: /yes, delete everything/i }));
    const text = (await screen.findByText(/not everything could be deleted/i)).textContent ?? '';
    expect(text).toContain('your register of use cases');
    expect(text).toContain('your audit trail');
    expect(text).toContain('some stored data');
    expect(text).not.toMatch(/aigate/);
  });
});
