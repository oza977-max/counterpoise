// R18-C1: what a model server answers, as test data.
//
// PROVISIONAL. R18-C0 (the live-capture spike) has not run, so apart from the HTTP status of the one
// recorded failure these bodies are HAND-MADE guesses at what Ollama (and a firm's server) send. Each
// carries `provisional: true`; C0 replaces them with captures and tightens the matchers in
// src/llm/prefill.ts. The failure SENTENCES are the contract, not these bodies (specs §27.5).
//
// The one thing recorded in the repository: a local server answered "HTTP 500"
// (backtest/model-comparison/2026-10-04-gpt-oss-120b-cloud.json). Its status is real; its body was
// not kept, so `body` below is provisional too.

export interface ServerReply {
  /** true = hand-made, to be replaced by a live capture (R18-C0). */
  provisional: boolean;
  status: number;
  /** The raw response body text. */
  body: string;
  /** Which situation it stands for. */
  situation: string;
}

export const SERVER_REPLIES = {
  http500: {
    provisional: true, // status recorded 2026-10-04; body hand-made
    status: 500,
    body: 'Internal Server Error: stack at line 12',
    situation: 'The server answers with an error status (HTTP 5xx)',
  },
  retired: {
    provisional: true,
    status: 404,
    body: JSON.stringify({ error: "model 'alpha:cloud' has been retired and is no longer available" }),
    situation: 'The model has been retired',
  },
  missing: {
    provisional: true,
    status: 404,
    body: JSON.stringify({ error: "model 'alpha:7b' not found, try pulling it first" }),
    situation: 'The model is not on this computer',
  },
  notIncluded402: {
    provisional: true,
    status: 402,
    body: JSON.stringify({ error: 'this model requires a subscription' }),
    situation: 'The model is not included in the free allowance',
  },
  notIncluded403: {
    provisional: true,
    status: 403,
    body: JSON.stringify({ error: 'upgrade your plan to use this model' }),
    situation: 'The model is not included in the free allowance',
  },
  allowanceUsed: {
    provisional: true,
    status: 429,
    body: JSON.stringify({ error: 'you have reached your usage limit for this model' }),
    situation: 'The free allowance is used up',
  },
  signedOut401: {
    provisional: true,
    status: 401,
    body: JSON.stringify({ error: 'unauthorized' }),
    situation: 'Not signed in to Ollama',
  },
  signedOut403: {
    provisional: true,
    status: 403,
    body: JSON.stringify({ error: 'please sign in to use cloud models' }),
    situation: 'Not signed in to Ollama',
  },
  noTools: {
    provisional: true,
    status: 400,
    body: JSON.stringify({ error: 'registry.ollama.ai/library/alpha:7b does not support tools' }),
    situation: 'A model without tool support (tool mode)',
  },
  hostileBody: {
    provisional: true,
    status: 404,
    body: `{"error":"model 'x' not found <script>alert(1)</script> at /usr/lib/ollama/server.go:412"}`,
    situation: 'A server whose error text must never reach the screen (MS-7-02)',
  },
} as const satisfies Record<string, ServerReply>;

/** The envelope Ollama's POST /api/chat returns with stream:false (hand-made shape; provisional). */
export function chatEnvelope(
  message: { role?: string; content?: string; tool_calls?: unknown[] },
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    model: 'alpha:7b',
    created_at: '2026-10-14T09:00:00.000000Z',
    message: { role: 'assistant', content: '', ...message },
    done: true,
    done_reason: 'stop',
    total_duration: 1234567890,
    ...extra,
  });
}

/** A description and the replies the realistic fixtures of TDD-3 make for it (all provisional). */
export const FIXTURE_DESCRIPTION =
  'Our UK team will use it to summarise internal ticket volumes.\nIt reads no client names.';

const GOOD_ANSWER = {
  answers: [
    { question: '11', values: [{ option: 'UK', quote: 'Our UK team' }] },
    { question: '5', values: [{ option: 'everyday', quote: 'internal ticket volumes' }] },
  ],
};

export const MODEL_CONTENT = {
  provisional: true,
  good: JSON.stringify(GOOD_ANSWER),
  /** Prose around the JSON, as chatty models do. */
  proseAround: `Sure! Here is what I found:\n${JSON.stringify(GOOD_ANSWER)}\nLet me know if you need anything else.`,
  /** Cut off by the token limit. */
  cutOff: '{"answers": [{"question": "11", "values": [{"option": "UK", "quo',
  notJson: 'not json at all',
  emptyObject: '{}',
  noAnswers: '{"answers": []}',
  /** `answers` as an object instead of an array. */
  answersObject: JSON.stringify({ answers: { '11': { values: [{ option: 'UK', quote: 'Our UK team' }] } } }),
  /** A quote that is not in the description. */
  quoteNotThere: JSON.stringify({
    answers: [{ question: '11', values: [{ option: 'UK', quote: 'wholly invented words' }] }],
  }),
  /** Keys that would reach an object prototype if looked up carelessly. */
  prototypeKeys: JSON.stringify({
    answers: [
      { question: '__proto__', values: [{ option: 'toString', quote: 'Our UK team' }] },
      { question: 'constructor', values: [{ option: 'UK', quote: 'Our UK team' }] },
      { question: '11', values: [{ option: '__proto__', quote: 'Our UK team' }] },
    ],
  }),
  /** A quote equal to the whole description. */
  wholeDescription: JSON.stringify({
    answers: [{ question: '11', values: [{ option: 'UK', quote: FIXTURE_DESCRIPTION }] }],
  }),
  /** Latin-looking letters from another script in the quote (Cyrillic О). */
  lookAlike: JSON.stringify({
    answers: [{ question: '11', values: [{ option: 'UK', quote: 'Оur UK team' }] }],
  }),
  /** A 50 KB reply (padding values the verifier will drop). */
  fiftyKb: JSON.stringify({
    answers: [
      { question: '11', values: [{ option: 'UK', quote: 'Our UK team' }] },
      ...Array.from({ length: 700 }, (_, i) => ({
        question: `junk-${i}`,
        values: [{ option: 'x', quote: 'padding padding padding padding padding' }],
      })),
    ],
  }),
};
