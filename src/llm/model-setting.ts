import { z } from 'zod';
import type { ModelPlace, ModelTestResult } from '../engine/prefill-types';

// R18-B (specs/intake-flow.md §27.8, ADR-IF-R18-6). The ONE declared model
// setting: where the model runs (this computer / the firm's server / Ollama's
// cloud through the Ollama app), the address, the model. Validated by place at
// save and again before every send (C1 calls validateModelSetting on its
// snapshot); read back through zod; written only by updateModelSetting. There
// is no field for a key or token, by design (PS-5).
//
// Boundary: this file may read and write localStorage and (for the explicit
// "Find models" press only) call fetch. It never imports src/components, so the
// words shown to a person (refusal sentences, labels) live in plain-copy.ts and
// are chosen by the component from the reasons returned here.

export const MODEL_SETTING_KEY = 'aigate:model-setting';
export const MODEL_TEST_RESULTS_KEY = 'aigate:model-test-results';
export const MODEL_SETTING_CHANGED_EVENT = 'aigate:model-setting-changed';

const OLD_URL_KEY = 'aigate:local-llm-url';
const OLD_MODEL_KEY = 'aigate:local-llm-model';

export const MODEL_PLACES: readonly ModelPlace[] = ['this-computer', 'firm-server', 'ollama-cloud'];

export const MAX_MODEL_CHARS = 100;
export const MAX_URL_CHARS = 500;
export const MAX_HOST_CHARS = 253;
export const MAX_TEST_RESULTS = 20;
/** The size of the test corpus: only a run of every case, not stopped, makes a model tested. */
export const CORPUS_CASE_COUNT = 31;
const LIST_TIMEOUT_MS = 4000;
const LIST_MAX_BODY_CHARS = 1_000_000;
const LIST_MAX_NAMES = 200;

export interface ModelSetting {
  version: 1;
  place: ModelPlace;
  /** origin + optional path, as validated (no trailing slash). */
  url: string;
  model: string;
  mode?: 'format' | 'tool';
}

/** Why a setting or an address was refused. The sentence for each is in plain-copy.ts. */
export type ValidationReason =
  | 'no-place'
  | 'address-missing'
  | 'address-invalid'
  | 'address-credentials'
  | 'address-too-long'
  | 'address-characters'
  | 'not-this-computer'
  | 'cloud-needs-app'
  | 'model-missing'
  | 'model-too-long'
  | 'model-characters'
  | 'cloud-model-elsewhere'
  | 'cloud-needs-tag'
  | 'storage-unavailable';

export type AddressResult = { ok: true; url: string } | { ok: false; reason: ValidationReason };
export type SettingResult =
  | { ok: true; setting: { place: ModelPlace; url: string; model: string } }
  | { ok: false; reason: ValidationReason };

// Control, format, private-use, surrogate and unassigned code points (Cc Cf Co Cs Cn).
const HIDDEN_CHARS = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}]/u;

function isPlace(p: unknown): p is ModelPlace {
  return typeof p === 'string' && (MODEL_PLACES as readonly string[]).includes(p);
}

/** True when the PARSED hostname is exactly localhost, 127.0.0.1 or [::1]. Never a prefix, suffix or substring. */
export function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

/** A model name ending :cloud or -cloud, matched without regard to case. */
export function isCloudTagged(model: string): boolean {
  return /[:-]cloud$/i.test(model);
}

/** Scheme, host and port of an address, or null when it does not parse. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** The address-only half of validation (scheme, credentials, bounds, the loopback rule for the two Ollama places). */
export function validateAddress(place: ModelPlace | '' | undefined, rawUrl: string): AddressResult {
  if (!isPlace(place)) return { ok: false, reason: 'no-place' };
  const url = rawUrl.trim();
  if (url === '') return { ok: false, reason: 'address-missing' };
  if (url.length > MAX_URL_CHARS) return { ok: false, reason: 'address-too-long' };
  // Checked on the raw text: the URL parser silently drops tabs and newlines.
  if (HIDDEN_CHARS.test(url)) return { ok: false, reason: 'address-characters' };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'address-invalid' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, reason: 'address-invalid' };
  // Requests are built as url + '/api/tags' and '/api/chat': a query or fragment would send them to the wrong path.
  if (url.includes('?') || url.includes('#')) return { ok: false, reason: 'address-invalid' };
  if (parsed.username !== '' || parsed.password !== '') return { ok: false, reason: 'address-credentials' };
  if (parsed.hostname.length > MAX_HOST_CHARS) return { ok: false, reason: 'address-too-long' };
  if (place === 'this-computer' && !isLoopback(url)) return { ok: false, reason: 'not-this-computer' };
  if (place === 'ollama-cloud' && !isLoopback(url)) return { ok: false, reason: 'cloud-needs-app' };
  return { ok: true, url: url.replace(/\/+$/, '') };
}

/** The full rule set of §27.8, by place. Pure. */
export function validateModelSetting(input: {
  place: ModelPlace | '' | undefined;
  url: string;
  model: string;
}): SettingResult {
  const address = validateAddress(input.place, input.url);
  if (!address.ok) return address;
  const place = input.place as ModelPlace;
  const model = input.model.trim();
  if (model === '') return { ok: false, reason: 'model-missing' };
  if ([...model].length > MAX_MODEL_CHARS) return { ok: false, reason: 'model-too-long' };
  if (HIDDEN_CHARS.test(model)) return { ok: false, reason: 'model-characters' };
  if (place === 'ollama-cloud' && !isCloudTagged(model)) return { ok: false, reason: 'cloud-needs-tag' };
  if (place !== 'ollama-cloud' && isCloudTagged(model)) return { ok: false, reason: 'cloud-model-elsewhere' };
  return { ok: true, setting: { place, url: address.url, model } };
}

// ---- storage -------------------------------------------------------------

const settingSchema = z
  .object({
    version: z.literal(1),
    place: z.enum(['this-computer', 'firm-server', 'ollama-cloud']),
    url: z.string().max(MAX_URL_CHARS),
    model: z.string().max(400), // validateModelSetting applies the 100-character rule; this only bounds hostile input
    mode: z.enum(['format', 'tool']).optional(),
  })
  .strict();

function getItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function removeItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable — nothing to remove */
  }
}

function announceChange(): void {
  window.dispatchEvent(new CustomEvent(MODEL_SETTING_CHANGED_EVENT));
}

/** The old two-key setting becomes this-computer once; the model only if the old model key exists. */
function migrateOldKeys(): void {
  const oldUrl = getItem(OLD_URL_KEY);
  const oldModel = getItem(OLD_MODEL_KEY);
  if (oldUrl === null && oldModel === null) return;
  if (getItem(MODEL_SETTING_KEY) === null && oldUrl !== null) {
    const candidate = settingSchema.safeParse({
      version: 1,
      place: 'this-computer',
      url: oldUrl.trim().replace(/\/+$/, ''),
      model: (oldModel ?? '').trim(),
    });
    if (candidate.success) {
      try {
        localStorage.setItem(MODEL_SETTING_KEY, JSON.stringify(candidate.data));
      } catch {
        return; // could not store: leave the old keys so nothing is lost
      }
    }
  }
  removeItem(OLD_URL_KEY);
  removeItem(OLD_MODEL_KEY);
}

/** The stored setting, parsed fully before use. Null when absent or unreadable (see modelSettingState to tell which). */
export function readModelSetting(): ModelSetting | null {
  migrateOldKeys();
  const raw = getItem(MODEL_SETTING_KEY);
  if (raw === null) return null;
  try {
    const parsed = settingSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as ModelSetting) : null;
  } catch {
    return null;
  }
}

export type ModelSettingState =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'no-model'; setting: ModelSetting }
  | { kind: 'valid'; setting: ModelSetting };

/** What a screen may say about the stored setting: nothing, "isn't valid", "no model", or a setting that passes every rule. */
export function modelSettingState(): ModelSettingState {
  const setting = readModelSetting();
  if (setting === null) return getItem(MODEL_SETTING_KEY) === null ? { kind: 'none' } : { kind: 'invalid' };
  if (setting.model === '') {
    return validateAddress(setting.place, setting.url).ok ? { kind: 'no-model', setting } : { kind: 'invalid' };
  }
  const checked = validateModelSetting(setting);
  // The stored value must already be in its validated form (no stray spaces, no trailing slash).
  if (!checked.ok || checked.setting.url !== setting.url || checked.setting.model !== setting.model) {
    return { kind: 'invalid' };
  }
  return { kind: 'valid', setting };
}

export type UpdatePatch = {
  place?: ModelPlace | '';
  url?: string;
  model?: string;
  mode?: 'format' | 'tool' | undefined;
};

/** The only writer of the setting. Re-reads storage, merges the patch, validates the result, writes, announces. */
export function updateModelSetting(
  patch: UpdatePatch,
): { ok: true; setting: ModelSetting } | { ok: false; reason: ValidationReason } {
  const current = readModelSetting();
  const merged = {
    place: 'place' in patch ? patch.place : current?.place,
    url: 'url' in patch ? (patch.url ?? '') : (current?.url ?? ''),
    model: 'model' in patch ? (patch.model ?? '') : (current?.model ?? ''),
  };
  const checked = validateModelSetting(merged);
  if (!checked.ok) return checked;
  const { place, url, model } = checked.setting;
  const changed = !current || current.place !== place || current.url !== url || current.model !== model;
  // A remembered mode belongs to one (place, address, model); a change forgets it.
  const mode = 'mode' in patch ? patch.mode : changed ? undefined : current?.mode;
  const next: ModelSetting = { version: 1, place, url, model, ...(mode ? { mode } : {}) };
  try {
    localStorage.setItem(MODEL_SETTING_KEY, JSON.stringify(next));
  } catch {
    return { ok: false, reason: 'storage-unavailable' };
  }
  announceChange();
  return { ok: true, setting: next };
}

/** Removes the setting and its saved test results. The only way either goes; "Clear all data" keeps both. */
export function forgetModelSetting(): void {
  removeItem(MODEL_SETTING_KEY);
  removeItem(MODEL_TEST_RESULTS_KEY);
  removeItem(OLD_URL_KEY);
  removeItem(OLD_MODEL_KEY);
  announceChange();
}

// ---- test results (read side; R18-F appends) ------------------------------

const resultSchema = z.object({
  model: z.string().max(400),
  place: z.enum(['this-computer', 'firm-server', 'ollama-cloud']),
  host: z.string().max(MAX_HOST_CHARS + 20),
  date: z.string().max(40),
  casesRun: z.number().int().min(0).max(1000),
  stopped: z.boolean(),
  verdictMatches: z.number().int().min(0).max(1000),
  discarded: z.record(z.string(), z.number()),
  perQuestion: z.record(
    z.string(),
    z.object({ right: z.number(), blank: z.number(), wrong: z.number() }),
  ),
});
const resultsSchema = z.object({ version: z.literal(1), results: z.array(resultSchema) });

/** Saved test runs, newest first, validated at read time. Anything unreadable reads as no results. */
export function readTestResults(): ModelTestResult[] {
  const raw = getItem(MODEL_TEST_RESULTS_KEY);
  if (raw === null) return [];
  try {
    const parsed = resultsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data.results.slice(0, MAX_TEST_RESULTS) as ModelTestResult[]) : [];
  } catch {
    return [];
  }
}

export type ModelLabel =
  | { kind: 'untested' }
  | { kind: 'partial'; casesRun: number }
  | { kind: 'tested'; matches: number; date: string };

/** The test label as DATA. A result belongs to one (model, place, host); only a completed run makes a model tested. */
export function modelLabel(
  setting: { model: string; place: ModelPlace; url: string },
  results: readonly ModelTestResult[],
): ModelLabel {
  const host = originOf(setting.url);
  if (host === null) return { kind: 'untested' };
  const mine = results.filter((r) => r.model === setting.model && r.place === setting.place && r.host === host);
  const done = mine.find((r) => !r.stopped && r.casesRun === CORPUS_CASE_COUNT);
  if (done) return { kind: 'tested', matches: done.verdictMatches, date: done.date };
  const partial = mine[0];
  if (partial) return { kind: 'partial', casesRun: partial.casesRun };
  return { kind: 'untested' };
}

// ---- the explicit "Find models" call --------------------------------------

/** GET {url}/api/tags on an explicit press, after the address validates. No body, no case text. [] on any failure. */
export async function listModels(
  setting: { place: ModelPlace; url: string },
  signal?: AbortSignal,
): Promise<string[]> {
  const address = validateAddress(setting.place, setting.url);
  if (!address.ok) return [];
  if (signal?.aborted) return [];
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);
  try {
    const res = await fetch(`${address.url}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const text = await res.text();
    if (text.length > LIST_MAX_BODY_CHARS) return [];
    const body: unknown = JSON.parse(text);
    const models = body !== null && typeof body === 'object' ? (body as { models?: unknown }).models : undefined;
    if (!Array.isArray(models)) return [];
    const names: string[] = [];
    for (const m of models) {
      const name = m !== null && typeof m === 'object' ? (m as { name?: unknown }).name : undefined;
      if (typeof name !== 'string' || name === '' || [...name].length > MAX_MODEL_CHARS) continue;
      if (!names.includes(name)) names.push(name);
      if (names.length >= LIST_MAX_NAMES) break;
    }
    return names;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
