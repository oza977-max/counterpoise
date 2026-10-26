import { describe, it, expect, vi } from 'vitest';
import { clearAllLocalData } from './reset';

const ev = (id: string) => ({
  event_id: id,
  use_case_id: 'uc-cr7-20',
  event_type: 'use_case_created' as const,
  occurred_at: new Date().toISOString(),
  actor: 'u',
  payload: { type: 'use_case_created' as const, description: 'x', intake_method: 'llm' as const },
});

describe('clearAllLocalData (CR7-20, CR7-15)', () => {
  it("TC-CR7-20a: reset succeeds when this tab's own database connections are open", async () => {
    vi.resetModules();
    const audit = await import('./audit');
    const register = await import('./register');
    await audit.append(ev('cr7-20a-1')); // opens and caches the audit handle
    await register.getUseCases('all'); // opens and caches the register handle
    const result = await clearAllLocalData();
    expect(result.incomplete).toEqual([]);
    expect(result.complete).toBe(true);
    // and the data really is gone
    expect(await audit.getAllForExport()).toEqual([]);
  });

  it("TC-CR7-20b: a write after another instance's reset reopens the database instead of throwing", async () => {
    vi.resetModules();
    const A = await import('./audit');
    await A.append(ev('cr7-20b-1'));
    vi.resetModules();
    const resetB = await import('./reset');
    const outcome = await resetB.clearAllLocalData(); // "another tab"
    expect(outcome.complete).toBe(true);
    await expect(A.append(ev('cr7-20b-2'))).resolves.toBeUndefined();
    const all = await A.getAllForExport();
    expect(all.map((e) => e.event_id)).toEqual(['cr7-20b-2']);
    expect((await A.verifyChain()).ok).toBe(true);
  });

  it('TC-CR7-15-4: clears the hand-off sync marker and the welcome flag, keeps the policy and model settings', async () => {
    localStorage.setItem('aigate-handoff-last-synced-tip', 'abc');
    localStorage.setItem('aigate:welcome-dismissed', '1');
    localStorage.setItem('aigate:role', '2LoD');
    localStorage.setItem('aigate:policy-yaml', 'version: "x"');
    // R18-B: the model setting (one key) and its saved test results replace the two old local-model keys.
    localStorage.setItem('aigate:model-setting', '{"version":1}');
    localStorage.setItem('aigate:model-test-results', '{"version":1,"results":[]}');
    await clearAllLocalData();
    expect(localStorage.getItem('aigate-handoff-last-synced-tip')).toBeNull();
    expect(localStorage.getItem('aigate:welcome-dismissed')).toBeNull();
    expect(localStorage.getItem('aigate:role')).toBeNull();
    expect(localStorage.getItem('aigate:policy-yaml')).toBe('version: "x"');
    expect(localStorage.getItem('aigate:model-setting')).toBe('{"version":1}');
    expect(localStorage.getItem('aigate:model-test-results')).toBe('{"version":1,"results":[]}');
  });
});
