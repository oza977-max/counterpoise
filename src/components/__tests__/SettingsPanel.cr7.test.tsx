import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPanel from '../SettingsPanel';
import * as resetStore from '../../store/reset';

// EBT exception (owner-accepted, code review 006/008): fault injection — a blocked database delete cannot be produced on demand; the real clearAllLocalData is wrapped.
vi.mock('../../store/reset', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/reset')>();
  return { ...actual, clearAllLocalData: vi.fn(actual.clearAllLocalData) };
});
import { saveDraft, loadDraft, updateFormDraft, loadFormDraft } from '../intake-draft';
import type { IntakeState } from '../intake-state';

describe('SettingsPanel — Clear all data (CR7-15)', () => {
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

  it('TC-CR7-15-1: clears the saved intake drafts (all three keys) and the hand-off marker, then reloads', async () => {
    // the app's own writers produce the drafts (BC-003)
    saveDraft({ step: 'description_entry', description: 'a half-written description' } as IntakeState);
    updateFormDraft({ answerState: { '1': { value: 'half-typed', source: { kind: 'typed' } } } });
    sessionStorage.setItem('aigate:intake-form-draft', '{"legacy":true}');
    localStorage.setItem('aigate-handoff-last-synced-tip', 'abc');
    expect(loadDraft()).not.toBeNull();
    expect(loadFormDraft()).not.toBeNull();

    const user = userEvent.setup();
    render(<SettingsPanel />);
    await user.click(screen.getByText(/demo data/i));
    await user.click(screen.getByRole('button', { name: /clear all data and start over/i }));
    await user.click(screen.getByRole('button', { name: /yes, delete everything/i }));

    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(loadDraft()).toBeNull();
    expect(loadFormDraft()).toBeNull();
    expect(sessionStorage.getItem('aigate:intake-form-draft')).toBeNull();
    expect(localStorage.getItem('aigate-handoff-last-synced-tip')).toBeNull();
  });

  it('TC-CR7-15-2: the confirmation says exactly what is cleared and what is kept (BC-005)', async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);
    await user.click(screen.getByText(/demo data/i));
    await user.click(screen.getByRole('button', { name: /clear all data and start over/i }));
    const warning = screen.getByRole('alert');
    expect(warning.textContent).toMatch(/unsaved intake draft/i);
    expect(warning.textContent).toMatch(/hand-off/i);
    // what survives is named, not implied
    expect(warning.textContent).toMatch(/welcome panel will show again/i);
    expect(warning.textContent).toMatch(/model settings/i);
    expect(warning.textContent).toMatch(/appetite framework you saved/i);
  });

  it('TC-CR7-15-3: an incomplete reset clears the drafts too, and its message says exactly what was and was not cleared', async () => {
    vi.mocked(resetStore.clearAllLocalData).mockResolvedValueOnce({ complete: false, incomplete: ['aigate-audit (blocked)'] });
    saveDraft({ step: 'description_entry', description: 'a half-written description' } as IntakeState);
    updateFormDraft({ answerState: { '1': { value: 'half-typed', source: { kind: 'typed' } } } });
    const user = userEvent.setup();
    render(<SettingsPanel />);
    await user.click(screen.getByText(/demo data/i));
    await user.click(screen.getByRole('button', { name: /clear all data and start over/i }));
    await user.click(screen.getByRole('button', { name: /yes, delete everything/i }));
    const msg = await screen.findByText(/not everything could be deleted/i);
    // CR9-14 (amended): plain name, no database id
    expect(msg.textContent).toMatch(/your audit trail/);
    expect(msg.textContent).not.toMatch(/aigate-/);
    expect(msg.textContent).toMatch(/intake drafts.*cleared/i);
    expect(loadDraft()).toBeNull();
    expect(loadFormDraft()).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });
});
