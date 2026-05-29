import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import { env } from './config/env.js';
import { MAX_FILE_SIZE_BYTES } from './config/constants.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/errorHandler.js';
import v1Routes from './routes/v1/index.js';
import healthRoutes from './routes/internal/health.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      transport: env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  // CORS
  await app.register(cors, {
    origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  });

  // Multipart (file uploads)
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  });

  // Rate limiting
  await app.register(rateLimit, {
    global: false, // per-route configuration
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: 'Too many requests' },
    }),
  });

  // Auth plugin
  await app.register(authPlugin);

  // Error handler
  await app.register(errorHandlerPlugin);

  // Routes
  await app.register(healthRoutes);
  await app.register(v1Routes, { prefix: '/v1' });

  return app;
}
