import { backoffMs } from '../src/backoff';
import { sign, verify } from '../src/signature';
import { MemoryIdempotencyStore, RedisIdempotencyStore } from '../src/stores';

describe('signature', () => {
  const body = Buffer.from('{"a":1}');
  const now = 1_700_000_000;
  const base = { secret: 's3cret', body, toleranceSeconds: 300, nowSeconds: now };

  it('accepts a valid signature', () => {
    const signature = sign('s3cret', now, body);
    expect(verify({ ...base, signature, timestamp: String(now) })).toBe('ok');
  });
  it('rejects a tampered body, wrong secret and malformed headers', () => {
    const signature = sign('s3cret', now, body);
    expect(verify({ ...base, body: Buffer.from('{"a":2}'), signature, timestamp: String(now) })).toBe('bad_signature');
    expect(verify({ ...base, secret: 'other', signature, timestamp: String(now) })).toBe('bad_signature');
    expect(verify({ ...base, signature: undefined, timestamp: String(now) })).toBe('malformed');
    expect(verify({ ...base, signature, timestamp: 'abc' })).toBe('malformed');
  });
  it('rejects replays outside the tolerance window, in both directions', () => {
    const old = now - 301;
    expect(verify({ ...base, signature: sign('s3cret', old, body), timestamp: String(old) })).toBe('stale');
    const future = now + 301;
    expect(verify({ ...base, signature: sign('s3cret', future, body), timestamp: String(future) })).toBe('stale');
  });
  it('binds the timestamp to the signature', () => {
    const signature = sign('s3cret', now, body);
    expect(verify({ ...base, signature, timestamp: String(now + 1) })).toBe('bad_signature');
  });
});

describe('backoffMs', () => {
  const opts = { baseMs: 1000, capMs: 8000 };
  it('doubles per attempt with equal jitter', () => {
    expect(backoffMs(1, opts, () => 0)).toBe(500);
    expect(backoffMs(1, opts, () => 1)).toBe(1000);
    expect(backoffMs(3, opts, () => 0)).toBe(2000);
    expect(backoffMs(3, opts, () => 1)).toBe(4000);
  });
  it('never exceeds the cap', () => {
    expect(backoffMs(20, opts, () => 1)).toBe(8000);
  });
  it('stays within bounds for random jitter', () => {
    for (let i = 0; i < 200; i++) {
      const v = backoffMs(2, opts);
      expect(v).toBeGreaterThanOrEqual(1000);
      expect(v).toBeLessThanOrEqual(2000);
    }
  });
});

describe('idempotency stores', () => {
  it('memory store claims once and expires', async () => {
    let t = 0;
    const store = new MemoryIdempotencyStore(1000, () => t);
    expect(await store.claim('a')).toBe(true);
    expect(await store.claim('a')).toBe(false);
    t = 1001;
    expect(await store.claim('a')).toBe(true);
  });
  it('redis store uses SET NX with a TTL', async () => {
    const calls: unknown[][] = [];
    const seen = new Set<string>();
    const fake = {
      async set(...args: any[]) {
        calls.push(args);
        if (seen.has(args[0])) return null;
        seen.add(args[0]);
        return 'OK';
      },
    };
    const store = new RedisIdempotencyStore(fake as any, 60);
    expect(await store.claim('x')).toBe(true);
    expect(await store.claim('x')).toBe(false);
    expect(calls[0]).toEqual(['idem:x', '1', 'EX', 60, 'NX']);
  });
});
