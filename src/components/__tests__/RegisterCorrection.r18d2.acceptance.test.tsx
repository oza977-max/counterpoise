import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { createFakeModel } from '../../llm/test-utils';
import { updateModelSetting } from '../../llm/model-setting';
import { getAllForExport } from '../../store/audit';
import type { AuditEvent } from '../../store/types';
import { fillText, DUP_CHECK_WAIT, SLOW_FLOW_MS, pressNext } from './fillText';

// R18-D2 acceptance test (outside-in, written first, committed alone while Red).
// TDD-1 of build/prompts/R18-D2.md: a person describes a case, the model fills three answers, they tick two
// and change the third, and confirm through to a verdict. Then:
//   - the audit trail holds exactly ONE graph_confirmed, and it carries answer_sources;
//   - the register detail shows the D1 lines for this real case;
//   - in the submitter view "Correct this check" reopens the form with every answer restored (ticks kept,
//     quotes shown, no Back);
//   - changing one answer and confirming writes a verdict_corrected that carries the new sources;
//   - in the 2LoD view the action is not there.
// A fake model fetch stands in for the server; a valid this-computer setting is in storage.

const NAME = 'Ledger tidy-up assistant D2';
const DESCRIPTION =
  'It reads client names and account details. Our UK team will use it every morning. Branch staff use what it writes.';
const REPLY = JSON.stringify({
  answers: [
    { question: '5', values: [{ option: 'people', quote: 'client names' }] },
    { question: '11', values: [{ option: 'UK', quote: 'Our UK team' }] },
    { question: '7', values: [{ option: 'other-teams', quote: 'Branch staff' }] },
  ],
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

async function caseEvents(): Promise<AuditEvent[]> {
  const all = await getAllForExport();
  const created = all.find(
    (e) => e.payload.type === 'use_case_created' && e.payload.description === DESCRIPTION,
  );
  if (!created) return [];
  return all.filter((e) => e.use_case_id === created.use_case_id);
}

describe('R18-D2 acceptance: confirm, read it in the register, correct it from the register', () => {
  it(
    'R18-D2 acceptance - a confirmed case writes its sources once, shows in the register, and is corrected from there',
    async () => {
      const fake = createFakeModel({ kind: 'honours-format', reply: REPLY });
      vi.stubGlobal('fetch', fake.fetch);
      expect(updateModelSetting({ place: 'this-computer', url: 'http://localhost:11434', model: 'alpha:7b' }).ok).toBe(true);

      const user = userEvent.setup({ delay: null });
      render(<App />);

      // 1. Describe, read, tick the two answers, change the third, answer the rest by hand, confirm.
      await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), DESCRIPTION);
      await pressNext(user);
      await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
      await screen.findByText(/new pre-check — tell us about the ai you want to use/i, undefined, { timeout: 5000 });

      await user.type(screen.getByLabelText(/what do you want to call it/i), NAME);
      await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
      await user.click(screen.getByRole('radio', { name: /gives a score, ranking, flag, category or forecast/i }));
      await user.click(await screen.findByRole('radio', { name: /fixed, written-down rules/i }));
      await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
      // Question 7 was filled in as "Other teams in the firm"; the person changes it.
      await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
      await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
      await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
      await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
      await user.click(screen.getByRole('radio', { name: /^no$/i }));
      const ticks = screen.getAllByRole('checkbox', { name: /^i've checked this answer/i });
      expect(ticks).toHaveLength(2);
      for (const tick of ticks) await user.click(tick);
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
      await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
      await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });

      // 2. The trail: exactly one graph_confirmed, carrying the sources.
      const first = await caseEvents();
      const confirmed = first.filter((e) => e.payload.type === 'graph_confirmed');
      expect(confirmed).toHaveLength(1);
      const sources = (confirmed[0]!.payload as { answer_sources?: { reads: unknown[]; answers: { question_id: string; origin: string }[] } })
        .answer_sources;
      expect(sources).toBeDefined();
      expect(sources!.reads).toHaveLength(1);
      const origin = (id: string) => sources!.answers.find((a) => a.question_id === id)?.origin;
      expect(origin('5')).toBe('prefilled_confirmed');
      expect(origin('11')).toBe('prefilled_confirmed');
      expect(origin('7')).toBe('prefilled_changed');
      expect(origin('1')).toBe('typed');
      expect(sources!.answers.some((a) => a.question_id === '2')).toBe(false);

      // 3. The register shows the lines for this real case.
      await user.click(screen.getByText('▤ Register'));
      await user.click(await screen.findByText(NAME));
      const region = await screen.findByRole('region', { name: /where each answer came from/i });
      expect(within(region).getByText(/read by alpha:7b/i)).toBeInTheDocument();
      expect(within(region).getByText(/^2 of \d+ answers were filled in by a model and confirmed by you, and 1 was changed by you$/)).toBeInTheDocument();

      // 4. Submitter view: press "Correct this check". The form opens with the answers restored.
      await user.click(screen.getByRole('button', { name: /^correct this check$/i }));
      await screen.findByText(/new pre-check — tell us about the ai you want to use/i, undefined, { timeout: 5000 });
      expect(screen.getByRole('checkbox', { name: /information about people/i })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: /united kingdom/i })).toBeChecked();
      const restoredTicks = screen.getAllByRole('checkbox', { name: /^i've checked this answer/i });
      expect(restoredTicks).toHaveLength(2);
      for (const tick of restoredTicks) expect(tick).toBeChecked();
      expect(screen.getAllByText(/client names/).length).toBeGreaterThan(0);
      expect(screen.getByRole('radio', { name: /^only me or my own team$/i })).toBeChecked();
      expect(screen.getByLabelText(/what do you want to call it/i)).toHaveValue(NAME);
      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
      // No model call was made for opening it.
      expect(fake.requests).toHaveLength(1);

      // 5. Change one answer and confirm: a verdict_corrected carries the new sources.
      await user.click(screen.getAllByRole('radio', { name: /^no$/i })[0]!);
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
      await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
      await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
      const second = await caseEvents();
      expect(second.filter((e) => e.payload.type === 'graph_confirmed')).toHaveLength(1);
      const corrected = second.filter((e) => e.payload.type === 'verdict_corrected');
      expect(corrected).toHaveLength(1);
      const newSources = (corrected[0]!.payload as { answer_sources?: { answers: { question_id: string; origin: string }[] } }).answer_sources;
      expect(newSources).toBeDefined();
      const newOrigin = (id: string) => newSources!.answers.find((a) => a.question_id === id)?.origin;
      expect(newOrigin('5')).toBe('prefilled_confirmed');
      expect(newOrigin('7')).toBe('prefilled_changed');
      expect(newOrigin('1')).toBe('typed');
      expect(fake.requests).toHaveLength(1);

      // 6. The 2LoD reviewer does not see the action.
      await user.selectOptions(screen.getByLabelText(/viewing as/i), '2LoD');
      await user.click(screen.getByText('▤ Register'));
      await user.click(await screen.findByText(NAME));
      await screen.findByRole('region', { name: /where each answer came from/i });
      await waitFor(() => expect(screen.queryByRole('button', { name: /correct this check/i })).not.toBeInTheDocument());
    },
    SLOW_FLOW_MS * 2,
  );
});
