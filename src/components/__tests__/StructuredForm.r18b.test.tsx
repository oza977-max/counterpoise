import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StructuredForm, { FREE_TEXT_MAX_CHARS } from '../StructuredForm';
import type { PolicyFile } from '../../engine/types';

// R18-B (specs/intake-flow.md §27.8, §27.13): free-text form answers are limited to 200
// characters in the form, so every typed value fits the record's bounds and this build's own
// export always imports. The description (Question 2) is not an answer and is not limited here.

beforeEach(() => sessionStorage.clear());

const policy = {
  version: '1.0', policy_id: 'T', firm_name: 'T',
  translation_attestation: { attested_by: 'x', role: 'x', date: 'x', raf_version_checked: 'x' },
  hard_lines: [], tracks: [], tiers: [], invariants: [], controls: [], kri_thresholds: {},
  jurisdictions: [{ code: 'UK', name: 'United Kingdom', pack_files: [] }],
  roles: {}, tier_workflow: { Critical: 'x', High: 'x', Medium: 'x', Low: 'x' },
} as unknown as PolicyFile;

describe('the 200-character limit on typed answers', () => {
  it('the limit is 200', () => {
    expect(FREE_TEXT_MAX_CHARS).toBe(200);
  });

  it('Question 1 (the name) stops at 200 characters, and the description box has no such limit', async () => {
    const user = userEvent.setup({ delay: null });
    render(<StructuredForm policy={policy} onSubmit={() => undefined} />);
    const name = screen.getByLabelText(/what do you want to call it/i) as HTMLInputElement;
    expect(name.maxLength).toBe(200);
    await user.click(name);
    await user.paste('n'.repeat(250));
    expect(name.value.length).toBeLessThanOrEqual(200);
    const description = screen.getByLabelText(/describe|what will it do/i, { selector: 'textarea' }) as HTMLTextAreaElement;
    expect(description.maxLength).toBe(-1);
  });
});

describe('R18-B fix: the limit is visible, tied to its field, and applied to restored drafts', () => {
  const FORM_KEY = 'aigate:intake-form-draft:v4';
  const typed = (value: string | string[]) => ({ value, source: { kind: 'typed' } });
  const reach: Record<string, Record<string, ReturnType<typeof typed>>> = {
    '1': {},
    '3supplierName': { '3': typed('supplier-feature'), '3supplier': typed('not-on-list') },
    '3model': { '3': typed('supplier-feature') },
    '8other': { '8': typed('other') },
  };

  it.each(['1', '3supplierName', '3model', '8other'])('question %s: typing stops at 200 and a hint is linked', async (id) => {
    const user = userEvent.setup({ delay: null });
    const draft = { version: 4, answerState: reach[id], lastRead: { fingerprint: '', outcome: 'not-read' } };
    sessionStorage.setItem(FORM_KEY, JSON.stringify(draft));
    render(<StructuredForm policy={policy} onSubmit={() => undefined} />);
    const field = document.getElementById(`pf-${id}`) as HTMLInputElement;
    expect(field).not.toBeNull();
    expect(field).toHaveAccessibleDescription(/Up to 200 characters\./);
    await user.click(field);
    await user.paste('n'.repeat(250));
    expect(field.value.length).toBeLessThanOrEqual(200);
  });

  it.each(['1', '3supplierName', '3model', '8other'])('question %s: a longer answer from an older draft is cut to 200 on load', (id) => {
    const answerState = { ...reach[id], [id]: typed('x'.repeat(450)) };
    sessionStorage.setItem(
      FORM_KEY,
      JSON.stringify({ version: 4, answerState, lastRead: { fingerprint: '', outcome: 'not-read' } }),
    );
    render(<StructuredForm policy={policy} onSubmit={() => undefined} />);
    const field = document.getElementById(`pf-${id}`) as HTMLInputElement;
    expect(field.value).toBe('x'.repeat(200));
  });
});
