import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import * as resetStore from '../../store/reset';

// EBT exception (owner-accepted, code review 006/008): fault injection — a blocked database delete
// cannot be produced on demand, so the incomplete outcome is injected; what is under test is that the
// header follows the role the message says was cleared.
vi.mock('../../store/reset', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/reset')>();
  return { ...actual, clearAllLocalData: vi.fn(actual.clearAllLocalData) };
});

describe('App — CR9-13: an incomplete Clear all data resets the header role', () => {
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

  it('TC-CR9-13: role 2LoD, Clear all data resolves incomplete — the selector shows 1LoD and the message says the role was cleared', async () => {
    vi.mocked(resetStore.clearAllLocalData).mockImplementationOnce(async () => {
      localStorage.removeItem('aigate:role'); // what the real function does before the delete is blocked
      return { complete: false, incomplete: ['aigate-audit (blocked)'] };
    });
    const user = userEvent.setup();
    render(<App />);
    const selector = screen.getByLabelText(/viewing as/i) as HTMLSelectElement;
    await user.selectOptions(selector, '2LoD');
    expect(selector.value).toBe('2LoD');
    await user.click(screen.getByText(/demo data/i));
    await user.click(screen.getByRole('button', { name: /clear all data and start over/i }));
    await user.click(screen.getByRole('button', { name: /yes, delete everything/i }));
    const msg = await screen.findByText(/not everything could be deleted/i);
    expect(msg.textContent).toMatch(/selected role/i);
    expect((screen.getByLabelText(/viewing as/i) as HTMLSelectElement).value).toBe('1LoD');
    // the reset did not write the role key back
    expect(localStorage.getItem('aigate:role')).toBeNull();
  });

  it('TC-CR9-13-1: on the reviewer-only screen the incomplete reset falls back to intake', async () => {
    vi.mocked(resetStore.clearAllLocalData).mockImplementationOnce(async () => {
      localStorage.removeItem('aigate:role');
      return { complete: false, incomplete: ['aigate-register (blocked)'] };
    });
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText(/viewing as/i), '2LoD');
    await user.click(screen.getByText(/rule challenges/i));
    expect(await screen.findByText(/rule-improvement queue/i)).toBeInTheDocument();
    await user.click(screen.getByText(/demo data/i));
    await user.click(screen.getByRole('button', { name: /clear all data and start over/i }));
    await user.click(screen.getByRole('button', { name: /yes, delete everything/i }));
    await screen.findByText(/not everything could be deleted/i);
    expect(screen.queryByText(/rule-improvement queue/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/rule challenges/i)).not.toBeInTheDocument();
  });
});
