import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from '../ErrorBoundary';

// CR6-04 (Critical, BC-002). No error boundary existed around the intake
// flow at all — a render-time crash (an incompatible draft shape reaching a
// component that indexes into it, or any other render-time defect) blanked
// the whole screen with no way back except a manual reload that would just
// restore the identical bad draft and crash again. Tested directly against
// a deliberately-throwing child — the standard way to test an error
// boundary (its own behaviour is what's under test, not any one specific
// trigger) — the same "deliberate fault-injection seam" posture this
// codebase already uses for its EBT-labelled test spies.
function Boom(): never {
  throw new Error('deliberate render-time crash for this test');
}

const DRAFT_KEY = 'aigate:intake-draft';
const FORM_DRAFT_KEY = 'aigate:intake-form-draft:v4';

describe('ErrorBoundary (CR6-04, BC-002)', () => {
  it('TC-CR6-04c: a render error below the boundary shows a plain message and a button that clears the saved draft', async () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ step: 'questionnaire', description: 'd' }));
    sessionStorage.setItem(FORM_DRAFT_KEY, JSON.stringify({ version: 4, answerState: {}, lastRead: { fingerprint: '', outcome: 'not-read' } }));
    // React logs the caught error to the console by design (componentDidCatch);
    // silenced here so the test's own output stays readable, not to hide a
    // real failure — the assertions below are what prove the boundary works.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );

      // Honest, plain, and makes no claim about what went wrong — an error
      // boundary cannot know that.
      expect(screen.getByRole('alert')).toBeInTheDocument();
      const fresh = screen.getByRole('button', { name: /start a fresh check/i });
      expect(fresh).toBeInTheDocument();
      expect(sessionStorage.getItem(DRAFT_KEY)).not.toBeNull();

      await userEvent.click(fresh);
      expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
      // CR6-04c strengthened: the guided form's own draft key too (as Start Over).
      expect(sessionStorage.getItem(FORM_DRAFT_KEY)).toBeNull();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('TC-CR6-04d: the crash message makes no claim about the firm record being untouched', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
      const text = screen.getByRole('alert').textContent ?? '';
      expect(text).not.toMatch(/did not touch|untouched|not affected/i);
      expect(text).toMatch(/already saved is on the register/i);
      expect(text).not.toMatch(/approved|rejected/i);
      // Pass 2 (Minor): said once, plainly - not two sentences opening the same way.
      expect((text.match(/something went wrong/gi) ?? []).length).toBe(1);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('renders its children normally when nothing below it throws', () => {
    render(
      <ErrorBoundary>
        <p>Ordinary content</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Ordinary content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
