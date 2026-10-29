import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { ConfiguredSocketIoAdapter } from './common/adapters/configured-socket-io.adapter';
import { parseFrontendOrigins } from './common/config/frontend-origins';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<string>('PORT');
  const frontendUrls = parseFrontendOrigins(
    configService.get<string>('FRONTEND_URLS'),
  );

  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: frontendUrls,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
    credentials: true,
  });
  app.useWebSocketAdapter(new ConfiguredSocketIoAdapter(app, frontendUrls));

  await app.listen(port);
}
void bootstrap();
