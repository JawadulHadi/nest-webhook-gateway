import {
  CanActivate, Controller, ExecutionContext, Get, Inject, Injectable, NotFoundException, Param,
  Query, UseGuards,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Config } from './config';
import { DeliveryStatus, DeliveryStore } from './stores';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject('CONFIG') private config: Config) {}
  canActivate(ctx: ExecutionContext): boolean {
    const given = Buffer.from(String(ctx.switchToHttp().getRequest().headers['x-admin-key'] ?? ''));
    const expected = Buffer.from(this.config.adminKey);
    // An empty ADMIN_KEY disables the endpoints instead of leaving them open.
    return expected.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
  }
}

@Controller()
export class DeliveriesController {
  constructor(@Inject('DELIVERY_STORE') private store: DeliveryStore) {}

  @Get()
  index() {
    return {
      name: 'nest-webhook-gateway',
      source: 'https://github.com/JawadulHadi/nest-webhook-gateway',
      endpoints: ['POST /webhooks/:source', 'GET /health', 'GET /deliveries (x-admin-key)'],
    };
  }

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Get('deliveries')
  @UseGuards(AdminGuard)
  list(@Query('status') status?: DeliveryStatus) {
    return this.store.list(status).map(({ payload, ...rest }) => rest);
  }

  @Get('deliveries/:id')
  @UseGuards(AdminGuard)
  get(@Param('id') id: string) {
    const d = this.store.get(id);
    if (!d) throw new NotFoundException();
    return d;
  }
}
