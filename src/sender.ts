import { sign } from './signature';

export interface HttpSender {
  /** Resolves on a 2xx response, throws otherwise. */
  send(url: string, body: string, headers: Record<string, string>): Promise<void>;
}

export class FetchSender implements HttpSender {
  constructor(private timeoutMs: number) {}
  async send(url: string, body: string, headers: Record<string, string>) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { method: 'POST', body, headers, signal: ctrl.signal });
      if (!res.ok) throw new Error(`target responded ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function outboundHeaders(secret: string, deliveryId: string, eventId: string, body: string) {
  const ts = Math.floor(Date.now() / 1000);
  return {
    'content-type': 'application/json',
    'x-timestamp': String(ts),
    'x-signature': sign(secret, ts, body),
    'x-delivery-id': deliveryId,
    'x-event-id': eventId, // receivers can dedupe on this too
  };
}
