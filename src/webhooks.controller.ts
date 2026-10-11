import {
  BadRequestException, Controller, HttpCode, Inject, Param, Post, RawBodyRequest, Req, Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Config } from './config';
import { DeliveryService } from './delivery.service';
import { verify } from './signature';
import { IdempotencyStore } from './stores';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    @Inject('CONFIG') private config: Config,
    @Inject('IDEMPOTENCY') private idem: IdempotencyStore,
    private deliveries: DeliveryService,
  ) {}

  @Post(':source')
  @HttpCode(202)
  async receive(
    @Param('source') source: string,
    @Req() req: RawBodyRequest<Request>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const secret = Object.prototype.hasOwnProperty.call(this.config.signingSecrets, source)
      ? this.config.signingSecrets[source]
      : undefined;
    const raw = req.rawBody;
    // Same 401 for unknown source and bad signature, so sources cannot be enumerated.
    if (!secret || !raw) throw new UnauthorizedException('invalid signature');
    const result = verify({
      secret, body: raw, toleranceSeconds: this.config.toleranceSeconds,
      signature: req.header('x-signature'), timestamp: req.header('x-timestamp'),
    });
    if (result !== 'ok') throw new UnauthorizedException(`invalid signature (${result})`);

    const eventId = req.header('x-event-id');
    if (!eventId || eventId.length > 200) throw new BadRequestException('x-event-id header required');
    try {
      JSON.parse(raw.toString('utf8'));
    } catch {
      throw new BadRequestException('body must be valid JSON');
    }

    if (!(await this.idem.claim(`${source}:${eventId}`))) {
      res.status(200);
      return { duplicate: true, eventId };
    }
    const created = await this.deliveries.fanOut(source, eventId, raw.toString('utf8'));
    return { duplicate: false, eventId, deliveries: created.map((d) => d.id) };
  }
}
