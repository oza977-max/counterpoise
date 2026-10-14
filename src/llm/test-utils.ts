// R18-C1 (specs/intake-flow.md §27.5): a fake model server for tests. TEST SUPPORT ONLY — no production
// file may import this (NF-3-07 checks). It stands in for `fetch`, never for the real network; install it
// with vi.stubGlobal('fetch', fake.fetch).
//
// Behaviour copied from a real fetch where it matters to the contract: it REJECTS when its `signal`
// aborts (the spec says the test fake must), it refuses a redirect when asked for redirect:'error'
// (a browser raises a TypeError), and it records every request it receives.

import { chatEnvelope, MODEL_CONTENT, SERVER_REPLIES, type ServerReply } from './__fixtures__/server-replies';

export interface RecordedRequest {
  /** The address as given to fetch. */
  url: string;
  method: string;
  headers: Record<string, string>;
  /** The body text exactly as sent. */
  body: string;
  /** The body parsed, or null when it is not JSON. */
  json: Record<string, unknown> | null;
  /** 'format' (a `format` key), 'tool' (a `tools` key and no `format`), or 'other'. */
  mode: 'format' | 'tool' | 'other';
  signal: AbortSignal | undefined;
  /** The options the call used, for the safety-option assertions. */
  options: { redirect?: string; credentials?: string; referrerPolicy?: string; cache?: string };
  /** Whether the previous request's signal was already aborted when this one arrived (null for the first). */
  previousAbortedOnArrival: boolean | null;
}

/** What the server does. */
export type FakeBehaviour =
  /** Honours `format`: strict JSON in content for a format request; a tool call for a tool request. */
  | { kind: 'honours-format'; reply?: string }
  /** Ignores `format`: plain prose for a format request, the tool call for a tool request. */
  | { kind: 'ignores-format'; reply?: string }
  /** Answers every request with the same (possibly broken) content, in either mode. */
  | { kind: 'content'; content: string }
  /** A tool request returns these arguments; a format request returns prose. */
  | { kind: 'tool-arguments'; arguments: unknown }
  /** Never answers; only rejects when aborted. */
  | { kind: 'never' }
  /** Refuses the connection: fetch rejects with a TypeError, as a browser does for refused/unreachable/blocked. */
  | { kind: 'refused' }
  /** Answers 307 with a Location elsewhere; with redirect:'error' fetch rejects instead. */
  | { kind: 'redirect'; location: string }
  /** Answers after `ms` on whatever clock setTimeout is using (use fake timers). */
  | { kind: 'slow'; ms: number; then: FakeBehaviour }
  /** Fails with a recorded/provisional server reply. */
  | { kind: 'http'; reply: ServerReply }
  /** A reply cut off by the token limit (done_reason 'length'). */
  | { kind: 'length' }
  /** Decide per request. */
  | { kind: 'custom'; handle: (request: RecordedRequest, index: number) => FakeBehaviour };

export interface FakeModel {
  fetch: typeof fetch;
  requests: RecordedRequest[];
}

const DEFAULT_REPLY = MODEL_CONTENT.good;

function abortError(signal: AbortSignal): unknown {
  return signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted.', 'AbortError');
}

/** Resolves with `work`, but rejects as soon as `signal` aborts. */
function whileNotAborted<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  if (!signal) return work();
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    work().then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

const json200 = (text: string) => new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } });

function toolCall(args: unknown): string {
  return chatEnvelope({ content: '', tool_calls: [{ function: { name: 'fill_form', arguments: args } }] });
}

async function answer(b: FakeBehaviour, req: RecordedRequest, index: number): Promise<Response> {
  switch (b.kind) {
    case 'honours-format': {
      const reply = b.reply ?? DEFAULT_REPLY;
      return req.mode === 'tool'
        ? json200(toolCall(JSON.parse(reply)))
        : json200(chatEnvelope({ content: reply }));
    }
    case 'ignores-format': {
      const reply = b.reply ?? DEFAULT_REPLY;
      return req.mode === 'tool'
        ? json200(toolCall(JSON.parse(reply)))
        : json200(chatEnvelope({ content: 'Sure, here is what I found in your description.' }));
    }
    case 'content':
      return json200(chatEnvelope({ content: b.content }));
    case 'tool-arguments':
      return req.mode === 'tool'
        ? json200(toolCall(b.arguments))
        : json200(chatEnvelope({ content: 'Sure, here is what I found in your description.' }));
    case 'never':
      return new Promise<Response>(() => undefined);
    case 'refused':
      throw new TypeError('Failed to fetch');
    case 'redirect':
      if (req.options.redirect === 'error') throw new TypeError('Failed to fetch');
      return new Response(null, { status: 307, headers: { Location: b.location } });
    case 'slow':
      await new Promise<void>((r) => setTimeout(r, b.ms));
      return answer(b.then, req, index);
    case 'http':
      return new Response(b.reply.body, { status: b.reply.status });
    case 'length':
      return json200(chatEnvelope({ content: '{"answers": [' }, { done_reason: 'length' }));
    case 'custom':
      return answer(b.handle(req, index), req, index);
  }
}

/** A fake `fetch` standing in for the model server. Every call is recorded. */
export function createFakeModel(behaviour: FakeBehaviour): FakeModel {
  const requests: RecordedRequest[] = [];
  const fake = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === 'string' ? init.body : '';
    let parsed: Record<string, unknown> | null = null;
    try {
      const p: unknown = JSON.parse(body);
      parsed = p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const prev = requests[requests.length - 1];
    const request: RecordedRequest = {
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? 'GET',
      headers,
      body,
      json: parsed,
      mode: parsed ? (parsed.format !== undefined ? 'format' : parsed.tools !== undefined ? 'tool' : 'other') : 'other',
      signal: init?.signal ?? undefined,
      options: {
        redirect: init?.redirect,
        credentials: init?.credentials,
        referrerPolicy: init?.referrerPolicy,
        cache: init?.cache,
      },
      previousAbortedOnArrival: prev ? (prev.signal?.aborted ?? false) : null,
    };
    const index = requests.length;
    requests.push(request);
    return whileNotAborted(request.signal, () => answer(behaviour, request, index));
  };
  return { fetch: fake as typeof fetch, requests };
}

export { SERVER_REPLIES, MODEL_CONTENT, chatEnvelope };
