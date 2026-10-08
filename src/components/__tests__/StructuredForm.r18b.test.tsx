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
