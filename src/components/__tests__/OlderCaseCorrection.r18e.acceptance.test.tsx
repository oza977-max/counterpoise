import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { createFakeModel } from '../../llm/test-utils';
import { describeAssumptions } from '../plain-copy';
import { seedCase, DESCRIPTION } from '../../test-support/answer-sources-fixtures';
import { DUP_CHECK_WAIT, SLOW_FLOW_MS } from './fillText';
import { confirmAndReachVerdict, ofType, sourcesOf, tickAll, trailOf, typeFiveAndEleven } from './r18d2Flow';

// R18-E acceptance test (outside-in, written first, committed alone while Red).
// TDD-1 of build/prompts/R18-E.md. A case saved by a build BEFORE Round 18 has no `answer_sources`: its record is a
// use_case_created, a graph_confirmed whose `assumptions` name two questions as "Not sure", and a verdict_produced.
// The register opens it and its verdict renders. In the submitter view "Correct this check" opens the form with
//   - the description kept;
//   - the two "Not sure" answers restored, marked "from the earlier record", each owing a tick;
//   - every other answer blank and marked "not carried over from the earlier version";
//   - no Back control.
// Answering, ticking and confirming writes exactly ONE verdict_corrected, which carries `answer_sources`. No screen
// anywhere renders the retired card-review title. No model is called.

const LABEL = 'Older case saved before Round 18';
const ID = 'uc-r18e-older';
const RETIRED_TITLE = /check what we read from your description/i;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('R18-E acceptance: an older case is opened from the register and corrected through the form', () => {
  it(
    'R18-E acceptance - an older case keeps its description, restores its Not sure answers for a tick, and corrects once',
    async () => {
      const fake = createFakeModel({ kind: 'honours-format', reply: '{"answers":[]}' });
      vi.stubGlobal('fetch', fake.fetch);
      await seedCase(ID, {
        label: LABEL,
        assumptions: describeAssumptions([
          { questionId: '4', optionKey: 'not-sure', fields: ['model_type'] },
          { questionId: '9', optionKey: 'not-sure', fields: ['output_reversibility'] },
        ]),
      });

      const user = userEvent.setup({ delay: null });
      render(<App />);

      // 1. The register opens the case and its verdict renders.
      await user.click(screen.getByText('▤ Register'));
      await user.click(await screen.findByText(LABEL));
      await screen.findByRole('heading', { name: LABEL });
      await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
      expect(screen.queryByText(RETIRED_TITLE)).not.toBeInTheDocument();

      // 2. Submitter view: "Correct this check" is offered and opens the form.
      await user.click(await screen.findByRole('button', { name: /^correct this check$/i }));
      await screen.findByText(/new pre-check — tell us about the ai you want to use/i, undefined, DUP_CHECK_WAIT);
      expect(screen.queryByText(RETIRED_TITLE)).not.toBeInTheDocument();

      // 3. The description is kept.
      expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue(DESCRIPTION);

      // 4. The two recorded "Not sure" answers are back, marked as from the earlier record, and owe a tick.
      expect(within(screen.getByRole('radiogroup', { name: /what kind of ai is it/i })).getByRole('radio', { name: /^not sure$/i })).toBeChecked();
      expect(within(screen.getByRole('radiogroup', { name: /can the mistake be caught/i })).getByRole('radio', { name: /^not sure$/i })).toBeChecked();
      expect(screen.getAllByText(/^from the earlier record$/i)).toHaveLength(3); // the two Not sure answers and the case name
      const ticks = screen.getAllByRole('checkbox', { name: /^i've checked this answer/i });
      expect(ticks).toHaveLength(3);
      for (const tick of ticks) expect(tick).not.toBeChecked();

      // 5. Every other answer is blank and says it was not carried over.
      expect(screen.getAllByText(/^not carried over from the earlier version$/i).length).toBeGreaterThan(5);
      // the name is restored from the register, unconfirmed (review pass 1); it is not blank
      expect(screen.getByRole('textbox', { name: /what do you want to call it/i })).not.toHaveValue('');
      expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled();

      // 6. A correction has no Back, and opening it asked no model anything.
      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
      expect(fake.requests).toHaveLength(0);

      // 7. Answer the rest by hand, tick the two restored answers, confirm.
      const nameBox = screen.getByRole('textbox', { name: /what do you want to call it/i });
      await user.clear(nameBox);
      await user.type(nameBox, LABEL);
      await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
      await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
      await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
      await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
      await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
      await user.click(within(screen.getByRole('radiogroup', { name: /does it replace something/i })).getByRole('radio', { name: /^no$/i }));
      await user.click(within(screen.getByRole('radiogroup', { name: /can copies of it/i })).getByRole('radio', { name: /^no — it works alone$/i }));
      await user.click(screen.getByRole('checkbox', { name: /nothing beyond what it.s given/i }));
      await typeFiveAndEleven(user);
      await tickAll(user);
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
      expect(screen.queryByText(RETIRED_TITLE)).not.toBeInTheDocument();
      await confirmAndReachVerdict(user);
      expect(screen.queryByText(RETIRED_TITLE)).not.toBeInTheDocument();

      // 8. The trail: the original three events, then exactly one verdict_corrected carrying answer_sources.
      const trail = await trailOf(DESCRIPTION);
      expect(ofType(trail, 'use_case_created')).toHaveLength(1);
      expect(ofType(trail, 'graph_confirmed')).toHaveLength(1);
      const corrected = ofType(trail, 'verdict_corrected');
      expect(corrected).toHaveLength(1);
      const sources = sourcesOf(corrected[0]!);
      expect(sources).toBeDefined();
      const origin = (id: string) => sources!.answers.find((a) => a.question_id === id)?.origin;
      expect(origin('4')).toBe('from_earlier_record');
      expect(origin('9')).toBe('from_earlier_record');
      expect(origin('1')).toBe('typed');
      expect(sources!.reads).toHaveLength(0);
      expect(fake.requests).toHaveLength(0);

      // 9. The 2LoD reviewer is not offered the action on an older case either.
      await user.selectOptions(screen.getByLabelText(/viewing as/i), '2LoD');
      await user.click(screen.getByText('▤ Register'));
      // The reviewer's queue shows what awaits sign-off; this case is not in it, so show them all.
      await user.click(await screen.findByRole('button', { name: /show all/i }));
      await user.click(await screen.findByText(LABEL));
      await screen.findByRole('heading', { name: LABEL });
      await waitFor(() => expect(screen.queryByRole('button', { name: /correct this check/i })).not.toBeInTheDocument());
    },
    SLOW_FLOW_MS * 2,
  );
});
