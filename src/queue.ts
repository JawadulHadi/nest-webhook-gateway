import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { BackoffOptions, backoffMs } from './backoff';

export interface DeliveryJob {
  deliveryId: string;
}

/** handler gets the 1-based attempt number. Throwing asks the queue to retry. */
export type JobHandler = (job: DeliveryJob, attempt: number) => Promise<void>;

export interface JobQueue {
  enqueue(job: DeliveryJob): Promise<void>;
  start(handler: JobHandler): Promise<void>;
  close(): Promise<void>;
}

/** Dependency-free queue for tests and local runs. Jobs are lost on restart. */
export class InMemoryQueue implements JobQueue {
  private jobs: { job: DeliveryJob; attempt: number }[] = [];
  private handler?: JobHandler;
  readonly requestedDelays: number[] = [];

  constructor(private maxAttempts: number, private backoff: BackoffOptions, private autoRun = false) {}

  async enqueue(job: DeliveryJob) {
    this.jobs.push({ job, attempt: 1 });
    if (this.autoRun) setImmediate(() => void this.drain());
  }

  async start(handler: JobHandler) {
    this.handler = handler;
  }

  /** Process everything, including retries. Delays are recorded, not waited on. */
  async drain() {
    while (this.jobs.length && this.handler) {
      const next = this.jobs.shift()!;
      try {
        await this.handler(next.job, next.attempt);
      } catch {
        if (next.attempt < this.maxAttempts) {
          this.requestedDelays.push(backoffMs(next.attempt, this.backoff, () => 0.5));
          this.jobs.push({ job: next.job, attempt: next.attempt + 1 });
        }
      }
    }
  }

  async close() {
    this.jobs = [];
  }
}

/** Production queue on BullMQ + Redis. Retries and delays survive restarts. */
export class BullQueue implements JobQueue {
  private connection: IORedis;
  private queue: Queue;
  private worker?: Worker;

  constructor(
    redisUrl: string,
    private maxAttempts: number,
    private backoff: BackoffOptions,
    private name = 'deliveries',
  ) {
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(name, { connection: this.connection });
  }

  async enqueue(job: DeliveryJob) {
    await this.queue.add('deliver', job, {
      attempts: this.maxAttempts,
      backoff: { type: 'custom' },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  async start(handler: JobHandler) {
    this.worker = new Worker(this.name, async (j) => handler(j.data as DeliveryJob, j.attemptsMade + 1), {
      connection: this.connection,
      concurrency: 5,
      settings: { backoffStrategy: (attemptsMade: number) => backoffMs(attemptsMade, this.backoff) },
    });
  }

  async close() {
    await this.worker?.close();
    await this.queue.close();
    this.connection.disconnect();
  }
}
