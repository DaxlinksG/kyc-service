import type { FastifyInstance } from 'fastify';
import sessionRoutes from './sessions.js';
import documentRoutes from './documents.js';
import selfieRoutes from './selfie.js';
import addressRoutes from './address.js';
import webhookRoutes from './webhooks.js';
import apiKeyRoutes from './apiKeys.js';
import adminRoutes from './admin.js';

export default async function v1Routes(app: FastifyInstance) {
  app.register(sessionRoutes);
  app.register(documentRoutes);
  app.register(selfieRoutes);
  app.register(addressRoutes);
  app.register(webhookRoutes);
  app.register(apiKeyRoutes);
  app.register(adminRoutes);
}
