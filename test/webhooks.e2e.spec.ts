import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Config } from '../src/config';
import { InMemoryQueue } from '../src/queue';
import { HttpSender } from '../src/sender';
import { sign, verify } from '../src/signature';

class FakeSender implements HttpSender {
  calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  failures = new Map<string, number>(); // url -> remaining failures (Infinity = always)
  async send(url: string, body: string, headers: Record<string, string>) {
    this.calls.push({ url, body, headers });
    const left = this.failures.get(url) ?? 0;
    if (left > 0) {
      this.failures.set(url, left - 1);
      throw new Error('target responded 503');
    }
  }
}

const SECRET = 'whsec_test';
const baseConfig: Config = {
  signingSecrets: { stripe: SECRET },
  targetUrls: ['https://a.example/hook'],
  outboundSecret: 'out_secret',
  adminKey: 'admin-key',
  maxAttempts: 3,
  toleranceSeconds: 300,
  backoff: { baseMs: 1000, capMs: 8000 },
  sendTimeoutMs: 1000,
};

async function setup(overrides: Partial<Config> = {}) {
  const config = { ...baseConfig, ...overrides };
  const sender = new FakeSender();
  const queue = new InMemoryQueue(config.maxAttempts, config.backoff);
  const mod = await Test.createTestingModule({
    imports: [AppModule.register({ config, sender, queue })],
  }).compile();
  const app: INestApplication = mod.createNestApplication({ rawBody: true });
  await app.init();
  return { app, sender, queue, config };
}

function signed(body: string, opts: { secret?: string; ts?: number; eventId?: string | null } = {}) {
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-timestamp': String(ts),
    'x-signature': sign(opts.secret ?? SECRET, ts, body),
  };
  if (opts.eventId !== null) headers['x-event-id'] = opts.eventId ?? 'evt_1';
  return headers;
}

const post = (app: INestApplication, source: string, body: string, headers: Record<string, string>) =>
  request(app.getHttpServer()).post(`/webhooks/${source}`).set(headers).send(body);

describe('webhook gateway', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  afterEach(async () => ctx.app.close());

  it('accepts a signed event, fans out, and signs the outbound delivery', async () => {
    ctx = await setup({ targetUrls: ['https://a.example/hook', 'https://b.example/hook'] });
    const body = '{ "id": "evt_1",  "amount": 5 }'; // odd spacing must survive: signature covers raw bytes
    const res = await post(ctx.app, 'stripe', body, signed(body)).expect(202);
    expect(res.body.duplicate).toBe(false);
    expect(res.body.deliveries).toHaveLength(2);
    await ctx.queue.drain();
    expect(ctx.sender.calls.map((c) => c.url).sort()).toEqual(['https://a.example/hook', 'https://b.example/hook']);
    const call = ctx.sender.calls[0];
    expect(call.body).toBe(body);
    expect(
      verify({
        secret: 'out_secret', body: Buffer.from(call.body), signature: call.headers['x-signature'],
        timestamp: call.headers['x-timestamp'], toleranceSeconds: 300,
      }),
    ).toBe('ok');
    expect(call.headers['x-event-id']).toBe('evt_1');
  });

  it('rejects bad signatures, unknown sources, stale timestamps and tampered bodies with 401', async () => {
    ctx = await setup();
    const body = '{"id":"x"}';
    await post(ctx.app, 'stripe', body, signed(body, { secret: 'wrong' })).expect(401);
    await post(ctx.app, 'github', body, signed(body)).expect(401);
    await post(ctx.app, 'stripe', body, signed(body, { ts: Math.floor(Date.now() / 1000) - 3600 })).expect(401);
    await post(ctx.app, 'stripe', '{"id":"y"}', signed(body)).expect(401);
    await post(ctx.app, '__proto__', body, signed(body)).expect(401);
    await ctx.queue.drain();
    expect(ctx.sender.calls).toHaveLength(0);
  });

  it('validates event id and JSON after the signature check', async () => {
    ctx = await setup();
    const body = '{"id":"x"}';
    await post(ctx.app, 'stripe', body, signed(body, { eventId: null })).expect(400);
    const bad = 'not json';
    await post(ctx.app, 'stripe', bad, signed(bad)).expect(400);
  });

  it('treats a repeated event id as a duplicate and delivers once', async () => {
    ctx = await setup();
    const body = '{"id":"evt_1"}';
    await post(ctx.app, 'stripe', body, signed(body)).expect(202);
    const second = await post(ctx.app, 'stripe', body, signed(body)).expect(200);
    expect(second.body.duplicate).toBe(true);
    await ctx.queue.drain();
    expect(ctx.sender.calls).toHaveLength(1);
  });

  it('retries failed deliveries with exponential backoff, then succeeds', async () => {
    ctx = await setup();
    ctx.sender.failures.set('https://a.example/hook', 2);
    const body = '{"id":"evt_1"}';
    const res = await post(ctx.app, 'stripe', body, signed(body)).expect(202);
    await ctx.queue.drain();
    const d = await request(ctx.app.getHttpServer())
      .get(`/deliveries/${res.body.deliveries[0]}`).set('x-admin-key', 'admin-key').expect(200);
    expect(d.body).toMatchObject({ status: 'delivered', attempts: 3 });
    expect(ctx.queue.requestedDelays).toEqual([750, 1500]); // jitter fixed at 0.5 by the test queue
  });

  it('dead-letters after max attempts and exposes it to admins only', async () => {
    ctx = await setup();
    ctx.sender.failures.set('https://a.example/hook', Infinity);
    const body = '{"id":"evt_1"}';
    await post(ctx.app, 'stripe', body, signed(body)).expect(202);
    await ctx.queue.drain();
    expect(ctx.sender.calls).toHaveLength(3);
    const http = ctx.app.getHttpServer();
    const dead = await request(http).get('/deliveries?status=dead').set('x-admin-key', 'admin-key').expect(200);
    expect(dead.body).toHaveLength(1);
    expect(dead.body[0]).toMatchObject({ status: 'dead', attempts: 3, lastError: 'target responded 503' });
    expect(dead.body[0].payload).toBeUndefined(); // list view omits payloads
    await request(http).get('/deliveries').expect(403);
    await request(http).get('/deliveries').set('x-admin-key', 'nope').expect(403);
  });

  it('one failing target does not block the others', async () => {
    ctx = await setup({ targetUrls: ['https://a.example/hook', 'https://b.example/hook'], maxAttempts: 2 });
    ctx.sender.failures.set('https://a.example/hook', Infinity);
    const body = '{"id":"evt_1"}';
    await post(ctx.app, 'stripe', body, signed(body)).expect(202);
    await ctx.queue.drain();
    const list = await request(ctx.app.getHttpServer()).get('/deliveries').set('x-admin-key', 'admin-key');
    const byUrl = Object.fromEntries(list.body.map((d: any) => [d.targetUrl, d.status]));
    expect(byUrl).toEqual({ 'https://a.example/hook': 'dead', 'https://b.example/hook': 'delivered' });
  });

  it('keeps admin endpoints closed when no ADMIN_KEY is configured', async () => {
    ctx = await setup({ adminKey: '' });
    await request(ctx.app.getHttpServer()).get('/deliveries').set('x-admin-key', '').expect(403);
    await request(ctx.app.getHttpServer()).get('/health').expect(200);
  });
});
