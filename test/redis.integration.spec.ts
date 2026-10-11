import IORedis from 'ioredis';
import { BullQueue } from '../src/queue';
import { RedisIdempotencyStore } from '../src/stores';

// Runs only when REDIS_URL is set: `npm run test:redis` (see README for docker compose).
const suite = process.env.REDIS_URL ? describe : describe.skip;

suite('BullMQ + Redis', () => {
  it('retries a failing job with backoff and then succeeds', async () => {
    const queue = new BullQueue(process.env.REDIS_URL!, 3, { baseMs: 20, capMs: 40 }, `t-${Date.now()}`);
    const attempts: number[] = [];
    const done = new Promise<void>((resolve) => {
      void queue.start(async (_job, attempt) => {
        attempts.push(attempt);
        if (attempt < 3) throw new Error('boom');
        resolve();
      });
    });
    await queue.enqueue({ deliveryId: 'd1' });
    await done;
    expect(attempts).toEqual([1, 2, 3]);
    await queue.close();
  }, 15000);

  it('claims idempotency keys atomically', async () => {
    const redis = new IORedis(process.env.REDIS_URL!);
    const store = new RedisIdempotencyStore(redis, 30);
    const key = `k-${Date.now()}`;
    const results = await Promise.all([store.claim(key), store.claim(key), store.claim(key)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    redis.disconnect();
  });
});
