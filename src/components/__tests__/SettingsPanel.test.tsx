import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPanel from '../SettingsPanel';

describe('SettingsPanel (local-testing-only key storage)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // v0.8.1 (user decision): the vendor-specific key field is gone — one
  // generic model setting remains. R18-B (TC-R18-PS-5-02, TC-R18-MS-3-02) keeps that
  // promise and rewrites the rest for the model-by-place section: the old
  // "frontier models draft better / tested with Qwen" footnote named a model in the
  // Settings copy, which MS-3 forbids; the section now frames itself as optional and
  // says where the description goes.
  it('offers no vendor API key field, and frames the one model setting honestly', async () => {
    const user = userEvent.setup();
    render(<SettingsPanel />);

    await user.click(screen.getByText(/the model that reads your description/i));
    expect(screen.queryByLabelText(/anthropic api key/i)).toBeNull();
    expect(screen.getByLabelText(/address of the model server/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^model name/i)).toBeInTheDocument();
    expect(screen.getByText(/optional\. every result comes from your answers and the firm.s rules, with or without a model/i)).toBeInTheDocument();
    expect(screen.queryByText(/qwen/i)).toBeNull();
    expect(screen.queryByText(/frontier models/i)).toBeNull();
  });
});
