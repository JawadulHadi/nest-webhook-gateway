import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configFromEnv } from './config';

async function bootstrap() {
  const config = configFromEnv();
  if (Object.keys(config.signingSecrets).length === 0) {
    throw new Error('SIGNING_SECRETS is empty: set e.g. {"stripe":"whsec_..."}');
  }
  const app = await NestFactory.create(AppModule.register({ config }), { rawBody: true });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}
void bootstrap();
