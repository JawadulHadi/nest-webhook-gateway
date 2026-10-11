import { DynamicModule, Module } from '@nestjs/common';
import { Config } from './config';
import { DeliveriesController, AdminGuard } from './deliveries.controller';
import { DeliveryService } from './delivery.service';
import { BullQueue, InMemoryQueue, JobQueue } from './queue';
import { FetchSender, HttpSender } from './sender';
import {
  DeliveryStore, IdempotencyStore, MemoryDeliveryStore, MemoryIdempotencyStore,
  RedisIdempotencyStore,
} from './stores';
import { WebhooksController } from './webhooks.controller';
import IORedis from 'ioredis';

export interface RegisterOptions {
  config: Config;
  queue?: JobQueue;
  sender?: HttpSender;
  deliveryStore?: DeliveryStore;
  idempotency?: IdempotencyStore;
}

@Module({})
export class AppModule {
  static register(opts: RegisterOptions): DynamicModule {
    const { config } = opts;
    const queue =
      opts.queue ??
      (config.redisUrl
        ? new BullQueue(config.redisUrl, config.maxAttempts, config.backoff)
        : new InMemoryQueue(config.maxAttempts, config.backoff, true));
    const idem =
      opts.idempotency ??
      (config.redisUrl
        ? new RedisIdempotencyStore(new IORedis(config.redisUrl))
        : new MemoryIdempotencyStore());
    return {
      module: AppModule,
      controllers: [WebhooksController, DeliveriesController],
      providers: [
        DeliveryService, AdminGuard,
        { provide: 'CONFIG', useValue: config },
        { provide: 'QUEUE', useValue: queue },
        { provide: 'SENDER', useValue: opts.sender ?? new FetchSender(config.sendTimeoutMs) },
        { provide: 'DELIVERY_STORE', useValue: opts.deliveryStore ?? new MemoryDeliveryStore() },
        { provide: 'IDEMPOTENCY', useValue: idem },
      ],
    };
  }
}
