export type DeliveryStatus = 'pending' | 'retrying' | 'delivered' | 'dead';

export interface Delivery {
  id: string;
  source: string;
  eventId: string;
  targetUrl: string;
  payload: string;
  status: DeliveryStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryStore {
  create(d: Delivery): void;
  get(id: string): Delivery | undefined;
  update(id: string, patch: Partial<Delivery>): Delivery | undefined;
  list(status?: DeliveryStatus): Delivery[];
}

export class MemoryDeliveryStore implements DeliveryStore {
  private items = new Map<string, Delivery>();
  create(d: Delivery) {
    this.items.set(d.id, d);
  }
  get(id: string) {
    return this.items.get(id);
  }
  update(id: string, patch: Partial<Delivery>) {
    const cur = this.items.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.items.set(id, next);
    return next;
  }
  list(status?: DeliveryStatus) {
    return [...this.items.values()].filter((d) => !status || d.status === status);
  }
}

/** claim() is atomic: it returns true only for the first caller with a given key. */
export interface IdempotencyStore {
  claim(key: string): Promise<boolean>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private seen = new Map<string, number>();
  constructor(private ttlMs = 24 * 3600 * 1000, private now: () => number = Date.now) {}
  async claim(key: string) {
    const t = this.now();
    const exp = this.seen.get(key);
    if (exp !== undefined && exp > t) return false;
    this.seen.set(key, t + this.ttlMs);
    return true;
  }
}

/** Minimal slice of ioredis used here, so tests can fake it. */
export interface RedisLike {
  set(key: string, value: string, mode: 'EX', seconds: number, flag: 'NX'): Promise<string | null>;
}

export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(private redis: RedisLike, private ttlSeconds = 24 * 3600) {}
  async claim(key: string) {
    return (await this.redis.set(`idem:${key}`, '1', 'EX', this.ttlSeconds, 'NX')) === 'OK';
  }
}
