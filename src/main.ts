import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configFromEnv } from './config';

// Public on purpose: the Vercel demo has no real senders, so its secret protects nothing.
export const VERCEL_DEMO_SECRETS = { demo: 'public-demo-secret' };

async function bootstrap() {
  const config = configFromEnv();
  if (Object.keys(config.signingSecrets).length === 0 && process.env.VERCEL) {
    config.signingSecrets = VERCEL_DEMO_SECRETS;
    console.warn('SIGNING_SECRETS unset on Vercel: using the public demo secret for source "demo"');
  }
  if (Object.keys(config.signingSecrets).length === 0) {
    throw new Error('SIGNING_SECRETS is empty: set e.g. {"stripe":"whsec_..."}');
  }
  const app = await NestFactory.create(AppModule.register({ config }), { rawBody: true });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}
void bootstrap();
