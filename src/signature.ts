import { createHmac, timingSafeEqual } from 'crypto';

/** Signature covers the timestamp too, so a captured request cannot be replayed later. */
export function sign(secret: string, timestamp: number | string, body: Buffer | string): string {
  const mac = createHmac('sha256', secret);
  mac.update(`${timestamp}.`);
  mac.update(body);
  return `sha256=${mac.digest('hex')}`;
}

export type VerifyResult = 'ok' | 'bad_signature' | 'stale' | 'malformed';

export function verify(opts: {
  secret: string;
  signature: string | undefined;
  timestamp: string | undefined;
  body: Buffer;
  toleranceSeconds: number;
  nowSeconds?: number;
}): VerifyResult {
  const { secret, signature, timestamp, body, toleranceSeconds } = opts;
  if (!signature || !timestamp || !/^\d{1,12}$/.test(timestamp)) return 'malformed';
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > toleranceSeconds) return 'stale';
  const expected = Buffer.from(sign(secret, timestamp, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'bad_signature';
  return 'ok';
}
