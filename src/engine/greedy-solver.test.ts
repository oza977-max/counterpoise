import { describe, it, expect } from 'vitest';
import { solvControls } from './greedy-solver';
import type { Control } from './types';

// MARGIN IS TESTED SEPARATELY. Every call below passes a margin of 0 so
// these assertions isolate minimal set-cover. CS-1 margin behaviour lives in
// safety-margin.test.ts. Before HR-14 these calls passed 0.1 and it made no
// difference, because the parameter was ignored.

function control(overrides: Partial<Control> & Pick<Control, 'id' | 'resolves' | 'burden'>): Control {
  return {
    name: overrides.id,
    description: '',
    verification: '',
    ...overrides,
  };
}

describe('solvControls', () => {
  it('returns satisfiable with no controls when nothing tripped', () => {
    const result = solvControls([], [control({ id: 'C1', resolves: ['INV-1'], burden: 1 })], []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.controls).toEqual([]);
  });

  it('picks the single control that covers the most invariants over two narrower ones', () => {
    const library = [
      control({ id: 'C-BOTH', resolves: ['INV-1', 'INV-2'], burden: 2 }),
      control({ id: 'C-ONE', resolves: ['INV-1'], burden: 1 }),
      control({ id: 'C-TWO', resolves: ['INV-2'], burden: 1 }),
    ];
    const result = solvControls(['INV-1', 'INV-2'], library, []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.controls).toEqual(['C-BOTH']);
  });

  it('TC-CS-1-03: tie-breaks equal-coverage candidates by lowest burden', () => {
    const library = [
      control({ id: 'C-HIGH-BURDEN', resolves: ['INV-1'], burden: 5 }),
      control({ id: 'C-LOW-BURDEN', resolves: ['INV-1'], burden: 1 }),
    ];
    const result = solvControls(['INV-1'], library, []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.controls).toEqual(['C-LOW-BURDEN']);
  });

  it('tie-breaks equal-coverage, equal-burden candidates alphabetically by id (determinism)', () => {
    const library = [
      control({ id: 'C-ZEBRA', resolves: ['INV-1'], burden: 2 }),
      control({ id: 'C-ALPHA', resolves: ['INV-1'], burden: 2 }),
    ];
    const result = solvControls(['INV-1'], library, []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.controls).toEqual(['C-ALPHA']);
  });

  it('reports the unsatisfiable invariant when no control resolves it', () => {
    const library = [control({ id: 'C-1', resolves: ['INV-OTHER'], burden: 1 })];
    const result = solvControls(['INV-UNRESOLVED'], library, []);
    expect(result).toEqual({ ok: false, unsatisfiableInvariant: 'INV-UNRESOLVED' });
  });

  it('names the first unsatisfiable invariant deterministically when multiple are unresolved', () => {
    const library: Control[] = [];
    const result = solvControls(['INV-A', 'INV-B'], library, []);
    expect(result).toEqual({ ok: false, unsatisfiableInvariant: 'INV-A' });
  });

  it('an invariant fully covered by an inherited control needs no new controls selected', () => {
    const inheritedLibraryControl = control({ id: 'CTRL-INHERITED', resolves: ['INV-1'], burden: 3 });
    const library = [inheritedLibraryControl, control({ id: 'CTRL-OTHER', resolves: ['INV-1'], burden: 1 })];
    const result = solvControls(['INV-1'], library, ['CTRL-INHERITED']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.controls).toEqual([]);
  });

  it('does not infinite-loop and does not reselect an already-picked control', () => {
    const library = [
      control({ id: 'C-A', resolves: ['INV-1', 'INV-2'], burden: 1 }),
      control({ id: 'C-B', resolves: ['INV-2', 'INV-3'], burden: 1 }),
    ];
    const result = solvControls(['INV-1', 'INV-2', 'INV-3'], library, []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.controls).toEqual(['C-A', 'C-B']);
  });
});
