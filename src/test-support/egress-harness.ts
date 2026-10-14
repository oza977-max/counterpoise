// R18-C1 deliverable 9 (TC-R18-NF-3-01/-05/-06): a recording harness for everything a page can use to send
// data away - fetch, XMLHttpRequest, navigator.sendBeacon, WebSocket, EventSource, image sources and
// window.open. TEST SUPPORT ONLY: no production file may import it (NF-3-07 checks).
//
// Nothing recorded here ever reaches the network: fetch is answered by the `respond` function the test
// gives (default: a refused connection), and the other channels are replaced by recording stand-ins.

export type EgressChannel = 'fetch' | 'xhr' | 'beacon' | 'websocket' | 'eventsource' | 'image' | 'open';

export interface EgressRecord {
  channel: EgressChannel;
  /** The full address as given. */
  url: string;
  method: string;
  /** Header names (lower-case) to values, where the channel has headers. */
  headers: Record<string, string>;
  /** The body as text ('' when none). */
  body: string;
  /** The fetch options, for the safety-option assertions (fetch only). */
  options?: { redirect?: string; credentials?: string; referrerPolicy?: string; cache?: string };
}

export interface EgressHarness {
  records: EgressRecord[];
  /** Records whose address, headers or body hold `part`. */
  carrying(part: string): EgressRecord[];
  restore(): void;
}

type FetchResponder = (input: string, init: RequestInit | undefined) => Promise<Response>;

function headersOf(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    new Headers(h).forEach((v, k) => {
      out[k] = v;
    });
  } catch {
    /* no usable headers */
  }
  return out;
}

function bodyText(b: unknown): string {
  if (b === undefined || b === null) return '';
  if (typeof b === 'string') return b;
  if (b instanceof URLSearchParams) return b.toString();
  try {
    return JSON.stringify(b);
  } catch {
    return String(b);
  }
}

export function installEgressHarness(respond?: FetchResponder): EgressHarness {
  const records: EgressRecord[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const restoreFns: (() => void)[] = [];

  const replace = (name: string, value: unknown) => {
    saved[name] = g[name];
    g[name] = value;
    restoreFns.push(() => {
      if (saved[name] === undefined) delete g[name];
      else g[name] = saved[name];
    });
  };

  replace('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    records.push({
      channel: 'fetch',
      url,
      method: init?.method ?? 'GET',
      headers: headersOf(init?.headers),
      body: bodyText(init?.body),
      options: { redirect: init?.redirect, credentials: init?.credentials, referrerPolicy: init?.referrerPolicy, cache: init?.cache },
    });
    if (respond) return respond(url, init);
    throw new TypeError('Failed to fetch');
  });

  class RecordingXHR {
    private u = '';
    private m = 'GET';
    private h: Record<string, string> = {};
    open(method: string, url: string) {
      this.m = method;
      this.u = String(url);
    }
    setRequestHeader(k: string, v: string) {
      this.h[k.toLowerCase()] = v;
    }
    send(body?: unknown) {
      records.push({ channel: 'xhr', url: this.u, method: this.m, headers: this.h, body: bodyText(body) });
    }
    abort() {}
    addEventListener() {}
  }
  replace('XMLHttpRequest', RecordingXHR);

  class RecordingSocket {
    constructor(url: string | URL) {
      records.push({ channel: 'websocket', url: String(url), method: 'GET', headers: {}, body: '' });
    }
    send(data: unknown) {
      const last = records[records.length - 1];
      if (last) last.body += bodyText(data);
    }
    close() {}
    addEventListener() {}
  }
  replace('WebSocket', RecordingSocket);

  class RecordingEventSource {
    constructor(url: string | URL) {
      records.push({ channel: 'eventsource', url: String(url), method: 'GET', headers: {}, body: '' });
    }
    close() {}
    addEventListener() {}
  }
  replace('EventSource', RecordingEventSource);

  const nav = navigator as unknown as Record<string, unknown>;
  const savedBeacon = nav.sendBeacon;
  nav.sendBeacon = (url: string, data?: unknown) => {
    records.push({ channel: 'beacon', url: String(url), method: 'POST', headers: {}, body: bodyText(data) });
    return true;
  };
  restoreFns.push(() => {
    if (savedBeacon === undefined) delete nav.sendBeacon;
    else nav.sendBeacon = savedBeacon;
  });

  const imgProto = HTMLImageElement.prototype;
  const srcDesc = Object.getOwnPropertyDescriptor(imgProto, 'src');
  Object.defineProperty(imgProto, 'src', {
    configurable: true,
    get() {
      return this.getAttribute('src') ?? '';
    },
    set(v: string) {
      records.push({ channel: 'image', url: String(v), method: 'GET', headers: {}, body: '' });
      this.setAttribute('src', String(v));
    },
  });
  restoreFns.push(() => {
    if (srcDesc) Object.defineProperty(imgProto, 'src', srcDesc);
  });

  const savedOpen = window.open;
  window.open = ((url?: string | URL) => {
    records.push({ channel: 'open', url: String(url ?? ''), method: 'GET', headers: {}, body: '' });
    return null;
  }) as typeof window.open;
  restoreFns.push(() => {
    window.open = savedOpen;
  });

  return {
    records,
    carrying: (part) =>
      records.filter((r) => r.url.includes(part) || r.body.includes(part) || Object.values(r.headers).some((v) => v.includes(part))),
    restore: () => {
      for (const fn of restoreFns.reverse()) fn();
    },
  };
}
