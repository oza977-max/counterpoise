import { loadPacks } from './packs';
import type { PackLoadResult } from './packs';

// V2-A. Rule 3: persistence-only. Vite bundles every pack file under
// policy/packs/ as raw YAML at build time — the file system IS the pack
// registry in V1 (no upload UI; packs are versioned in git alongside
// the policy, per the corpus-maintenance model in design-vision).
const files = import.meta.glob('../../policy/packs/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export function getPackSources(): Record<string, string> {
  return files;
}

// GT7 D-1b (CF-5). The one place the app turns pack sources into packs AND
// pack failures. Every screen that evaluates, seeds or shows packs loads
// through this, so a rulebook that fails to load can never be quietly
// dropped by one caller while another keeps checking. `messages` are the
// loader's own `reason` strings, verbatim — nothing here rewords them.
// The caller passes the sources (getPackSources()) so a test can inject a
// broken pack at that one seam.
export interface PackSet extends PackLoadResult {
  messages: string[];
}

export function loadPackSet(sources: Record<string, string>): PackSet {
  const result = loadPacks(sources);
  return { ...result, messages: result.errors.map((e) => e.reason) };
}
