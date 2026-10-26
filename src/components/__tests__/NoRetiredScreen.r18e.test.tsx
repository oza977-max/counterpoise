import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { createFakeModel } from '../../llm/test-utils';
import { updateModelSetting } from '../../llm/model-setting';
import { seedCase, DESCRIPTION } from '../../test-support/answer-sources-fixtures';
import { DUP_CHECK_WAIT, SLOW_FLOW_MS, fillText, pressNext } from './fillText';
import { answerFormExceptFiveAndEleven, confirmAndReachVerdict, typeFiveAndEleven } from './r18d2Flow';
import { NOT_SURE_4_AND_9, RETIRED_TITLE } from './olderCaseFlow';

// R18-E, TC-R18-GI-10-01: the retired card review is nowhere in the build. A model is connected (the route that used
// to lead to it), and the walk goes through every screen: the workspace, the register, the framework, the rule
// challenges, About, describing, reading, the form, the confirmation, the result, correcting from the
// result, the register's detail and its "Correct this check". The title is checked after every move, and so is the
// stand-in for "a screen that shows a case's questions is the form": the question text is the form's.

const REPLY = JSON.stringify({ answers: [] });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('R18-E: no retired screen is reachable', () => {
  it(
    'TC-R18-GI-10-01: with a model connected, no screen on any route shows the card review title, and every screen with the case\'s questions is the form',
    async () => {
      const fake = createFakeModel({ kind: 'honours-format', reply: REPLY });
      vi.stubGlobal('fetch', fake.fetch);
      expect(updateModelSetting({ place: 'this-computer', url: 'http://localhost:11434', model: 'alpha:7b' }).ok).toBe(true);
      await seedCase('uc-r18e-walk', { label: 'Older walk E', description: `${DESCRIPTION} [walk]`, assumptions: NOT_SURE_4_AND_9() });
      const user = userEvent.setup({ delay: null });
      const clear = () => expect(screen.queryByText(RETIRED_TITLE)).not.toBeInTheDocument();
      const FORM = /new pre-check — tell us about the ai you want to use/i;
      render(<App />);
      clear();

      // The side screens.
      for (const name of ['▤ Register', '§ Appetite framework', '? About']) {
        await user.click(screen.getByText(name));
        clear();
      }
      // The reviewer's queue (only the second line has it), then back to the submitter.
      await user.selectOptions(screen.getByLabelText(/viewing as/i), '2LoD');
      await user.click(screen.getByText('⚑ Rule challenges'));
      clear();
      await user.selectOptions(screen.getByLabelText(/viewing as/i), '1LoD');
      await user.click(screen.getByText('+ New pre-check'));
      clear();

      // Describe, read, the form, the confirmation, the result.
      await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), 'It reads client names. Our UK team will use it every morning.');
      await pressNext(user);
      clear();
      await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
      await screen.findByText(FORM, undefined, DUP_CHECK_WAIT);
      clear();
      await answerFormExceptFiveAndEleven(user, 'Walk tool');
      await typeFiveAndEleven(user);
      await user.click(screen.getByRole('button', { name: /^continue$/i }));
      await screen.findByText(/here.s what we understood/i);
      clear();
      await confirmAndReachVerdict(user);
      clear();

      // Correct from the result: the form, not a card review.
      await user.click(document.querySelector<HTMLButtonElement>('.verdict__first-correct')!);
      await screen.findByText(/you.re correcting your earlier answers/i);
      expect(screen.getByLabelText(/what do you want to call it/i)).toBeInTheDocument();
      clear();

      // The register's detail and "Correct this check" on an older case: the form again.
      await user.click(screen.getByText('▤ Register'));
      await user.click(await screen.findByText('Older walk E'));
      clear();
      await user.click(await screen.findByRole('button', { name: /^correct this check$/i }));
      await screen.findByText(FORM, undefined, DUP_CHECK_WAIT);
      expect(screen.getByLabelText(/what do you want to call it/i)).toBeInTheDocument();
      clear();

      await user.click(screen.getByText('+ New pre-check'));
      clear();
      expect(document.body.textContent).not.toMatch(/graph review|review extracted graph/i);
    },
    SLOW_FLOW_MS * 3,
  );
});
