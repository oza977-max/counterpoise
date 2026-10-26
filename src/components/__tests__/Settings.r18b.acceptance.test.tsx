import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';

// R18-B acceptance test (outside-in, written first). A person opens Settings,
// chooses "On my firm's server", types an http address and a model, and saves.
// The stored setting records the place; the description screen then shows the
// firm sentence, the unencrypted line and the demonstration notice, and never
// "It never leaves your computer". No fetch is made: Save and the status line
// call no model (specs/intake-flow.md §27.8).

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('R18-B acceptance: the model setting by place', () => {
  it('TC-R18-MS-2-01: a firm-server setting saved in Settings shows the firm sentence, the unencrypted line and the demonstration notice on the description screen', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);

    // Before anything is saved the description screen says no model is connected.
    expect(screen.getByText('No model is connected.')).toBeInTheDocument();

    await user.click(screen.getByText(/the model that reads your description/i));
    await user.click(screen.getByRole('radio', { name: /on my firm's server/i }));
    await user.click(screen.getByLabelText(/address of the model server/i));
    await user.paste('http://ai.example-firm.test:8080');
    await user.click(screen.getByLabelText(/^model name/i));
    await user.paste('alpha:7b');
    await user.click(screen.getByRole('button', { name: /^save/i }));

    // The stored setting records the place.
    const stored = JSON.parse(localStorage.getItem('aigate:model-setting') ?? 'null');
    expect(stored).toMatchObject({
      version: 1,
      place: 'firm-server',
      url: 'http://ai.example-firm.test:8080',
      model: 'alpha:7b',
    });

    // The description screen (still in view beside the sidebar) now says where the text goes.
    const status = screen
      .getAllByRole('status')
      .find((el) => /alpha:7b/.test(el.textContent ?? '') && /your firm's server/.test(el.textContent ?? ''));
    expect(status, 'a status line naming the firm server and the model').toBeDefined();
    expect(status!.textContent).toContain(
      "Your description will be sent to your firm's server at http://ai.example-firm.test:8080 and read by alpha:7b.",
    );
    expect(status!.textContent).toContain(
      "This address isn't encrypted, so your description travels unprotected inside your firm's network.",
    );
    expect(document.body.textContent).toContain(
      'This is a demonstration. Use made-up or public descriptions, not confidential details. A firm should use its own model on its own network.',
    );
    expect(document.body.textContent).not.toMatch(/never leaves your computer/i);
    expect(screen.queryByText('No model is connected.')).not.toBeInTheDocument();
  });
});
