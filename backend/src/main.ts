import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { AppConfigService } from './config/app-config.service';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { SocketStateService } from './modules/socket/socket-state.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  app.use(cookieParser());

  // CORS for the REST API. The WebSocket gateway configures its own CORS
  // separately in ChatGateway.afterInit(). We mirror the same allow-list so
  // the SPA at FRONTEND_URL can talk to /auth, /conversations, etc.
  const appConfig = app.get(AppConfigService);
  const allowedOrigins = appConfig.allowedOrigins;
  app.enableCors({
    origin: (origin, callback) => {
      // Same-origin / server-to-server requests have no Origin header.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'X-Requested-With',
    ],
    exposedHeaders: ['Content-Length', 'Content-Type'],
    maxAge: 600,
  });
  Logger.log(
    `CORS enabled for origins: ${allowedOrigins.join(', ')}`,
    'Bootstrap',
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);

  // ─── Socket.IO Redis Adapter (Phase 12 — horizontal scaling) ─────────────
  // Must run after app.listen() because ChatGateway.afterInit() sets the
  // server reference on SocketStateService during the listen phase.
  const pubClient = new Redis({
    host: appConfig.redisHost,
    port: appConfig.redisPort,
    password: appConfig.redisPassword,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 2_000,
    retryStrategy: () => null,
  });
  const subClient = pubClient.duplicate();
  pubClient.on('error', (err) => console.error('Redis pubClient error:', err));
  subClient.on('error', (err) => console.error('Redis subClient error:', err));

  const socketStateService = app.get(SocketStateService);
  const io = socketStateService.getServer();

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    Logger.log('Socket.IO Redis adapter configured', 'Bootstrap');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.warn(`Redis adapter disabled: ${msg}`, 'Bootstrap');
    try {
      pubClient.disconnect();
      subClient.disconnect();
    } catch {
      // ignore
    }
  }
}
void bootstrap();
