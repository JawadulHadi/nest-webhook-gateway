import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Config } from './config';
import { DeliveryJob, JobQueue } from './queue';
import { HttpSender, outboundHeaders } from './sender';
import { Delivery, DeliveryStore } from './stores';

@Injectable()
export class DeliveryService {
  constructor(
    @Inject('CONFIG') private config: Config,
    @Inject('DELIVERY_STORE') private store: DeliveryStore,
    @Inject('QUEUE') private queue: JobQueue,
    @Inject('SENDER') private sender: HttpSender,
  ) {}

  async onModuleInit() {
    await this.queue.start((job, attempt) => this.handle(job, attempt));
  }

  async onModuleDestroy() {
    await this.queue.close();
  }

  async fanOut(source: string, eventId: string, payload: string): Promise<Delivery[]> {
    const created: Delivery[] = [];
    for (const targetUrl of this.config.targetUrls) {
      const now = new Date().toISOString();
      const d: Delivery = {
        id: randomUUID(), source, eventId, targetUrl, payload,
        status: 'pending', attempts: 0, createdAt: now, updatedAt: now,
      };
      this.store.create(d);
      await this.queue.enqueue({ deliveryId: d.id });
      created.push(d);
    }
    return created;
  }

  async handle(job: DeliveryJob, attempt: number): Promise<void> {
    const d = this.store.get(job.deliveryId);
    if (!d || d.status === 'delivered' || d.status === 'dead') return;
    try {
      const headers = outboundHeaders(this.config.outboundSecret, d.id, d.eventId, d.payload);
      await this.sender.send(d.targetUrl, d.payload, headers);
      this.store.update(d.id, { status: 'delivered', attempts: attempt, lastError: undefined });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt >= this.config.maxAttempts) {
        this.store.update(d.id, { status: 'dead', attempts: attempt, lastError: message });
        return; // dead-lettered: stays visible in /deliveries?status=dead
      }
      this.store.update(d.id, { status: 'retrying', attempts: attempt, lastError: message });
      throw err; // tell the queue to retry with backoff
    }
  }
}
