import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { createFakeModel } from '../../llm/test-utils';
import type { RecordedRequest } from '../../llm/test-utils';
import { updateModelSetting } from '../../llm/model-setting';
import { loadCorpus } from '../../llm/model-test';
import { fillText } from './fillText';

// TC-R18-GI-12-04: while the test runs, the person has an unsent description in the box. The test's only
// input is the project's corpus: no request carries a word of the draft, and the draft is still there after.

const corpus = loadCorpus()!;
const DRAFT = 'Secret plan for Project Falcon.';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('R18-F: the test never sends what is being typed', () => {
  it(
    'TC-R18-GI-12-04: 31 requests, each only a corpus case; none holds the unsent draft, which is still in its box afterwards',
    async () => {
      const fake = createFakeModel({
        kind: 'custom',
        handle: (request: RecordedRequest) => {
          const messages = (request.json?.messages ?? []) as { role: string; content: string }[];
          const content = messages.find((m) => m.role === 'user')?.content ?? '';
          const c = corpus.cases.find((x) => content.includes(x.prose))!;
          return { kind: 'content', content: JSON.stringify({ answers: [{ question: '9', values: [{ option: 'yes', quote: c.prose.split(' ').slice(0, 3).join(' ') }] }] }) };
        },
      });
      vi.stubGlobal('fetch', fake.fetch);
      expect(updateModelSetting({ place: 'this-computer', url: 'http://localhost:11434', model: 'alpha:7b' }).ok).toBe(true);
      const user = userEvent.setup({ delay: null });
      render(<App />);
      const box = screen.getByLabelText(/what ai tool do you want to use/i);
      await fillText(user, box, DRAFT);

      await user.click(screen.getByText(/the model that reads your description/i));
      const region = screen.getByRole('region', { name: 'Test it' });
      await user.click(within(region).getByRole('button', { name: 'Test it' }));
      await within(region).findByText(/Reached the right verdict in \d+ of 31 cases/, {}, { timeout: 20000 });

      expect(fake.requests).toHaveLength(31);
      for (const r of fake.requests) {
        expect(r.body).not.toContain('Falcon');
        expect(r.body).not.toContain('Secret plan');
      }
      expect(screen.getByLabelText(/what ai tool do you want to use/i)).toHaveValue(DRAFT);
    },
    40000,
  );
});
