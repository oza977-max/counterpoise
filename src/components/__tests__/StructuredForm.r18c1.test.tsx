import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import StructuredForm, { buildDynamicOptions } from '../StructuredForm';
import { loadPolicy } from '../../store/policy';
import { QUESTION_WORDS } from '../plain-copy';
import { QUESTION_STRUCTURE, allOptionKeys, buildCatalogue, dynamicEntries, structureFor } from '../../engine/question-structure';
import type { PolicyFile } from '../../engine/types';

// R18-C1 review pass 1 (M9): the engine's question structure and the form still carry two copies of the
// option lists (the form is not refactored in this chunk). This pins them together for the real policy, so
// a policy change or a one-sided edit fails here instead of silently desynchronising the pre-fill catalogue
// from what the person sees.

let policy: PolicyFile;
beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  policy = r.policy;
});
beforeEach(() => sessionStorage.clear());

describe('the form and the engine agree on the dynamic option lists', () => {
  it('Question 3 renders the same option keys, in the same order, as allOptionKeys; the platform texts match the catalogue', () => {
    const { container } = render(<StructuredForm policy={policy} onSubmit={() => undefined} />);
    const radios = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"][name="pf-3"]')];
    const rendered = radios.map((r) => r.value);
    expect(rendered).toEqual(allOptionKeys(structureFor('3')!, policy));
    expect(rendered.some((k) => (policy.platforms ?? []).some((p) => p.id === k))).toBe(true);

    const catalogue = buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy);
    const catalogueQ3 = catalogue.get('3')!;
    expect([...catalogueQ3.options.keys()]).toEqual(rendered);
    const labelText = (input: HTMLInputElement) => input.closest('label')!.textContent ?? '';
    for (const r of radios) expect(labelText(r)).toBe(catalogueQ3.options.get(r.value)!.text);
  });

  it('Question 11 renders the jurisdictions the engine lists, in the same order, with the same words', () => {
    const { container } = render(<StructuredForm policy={policy} onSubmit={() => undefined} />);
    const first = policy.jurisdictions![0]!.name;
    expect(first).toBeTruthy();
    const group = [...container.querySelectorAll('fieldset')].find((f) => !f.querySelector('fieldset') && [...f.querySelectorAll('label')].some((l) => l.textContent === first))!;
    const texts = [...group.querySelectorAll('label')].map((l) => l.textContent ?? '');
    const catalogueQ11 = buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy).get('11')!;
    expect(texts).toEqual([...catalogueQ11.options.values()].map((o) => o.text));
    expect([...catalogueQ11.options.keys()]).toEqual(allOptionKeys(structureFor('11')!, policy));
  });

  it('buildDynamicOptions and dynamicEntries list the same keys, in the same order, with the same words', () => {
    const built = buildDynamicOptions(policy);
    const pairs: [string, { key: string; text: string }[]][] = [
      ['platforms', built.platforms],
      ['suppliers', built.suppliers],
      ['company-assistants', built.companyAssistants],
      ['jurisdictions', built.jurisdictions],
    ];
    for (const [source, options] of pairs) {
      const entries = dynamicEntries(source as Parameters<typeof dynamicEntries>[0], policy);
      expect(options.map((o) => o.key)).toEqual(entries.map((e) => e.key));
      // Where the registry gives a plain name, both use it (the neutral numbered labels are the form's and the words' own).
      entries.forEach((e, i) => {
        if (e.plainName !== undefined) expect(options[i]!.text).toBe(e.plainName);
      });
    }
  });
});
