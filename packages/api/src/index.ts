import { buildApp } from './app.js';
import { runMigrations } from './db/migrate.js';
import { startQueue } from './workers/queue.js';
import { registerAllProcessors } from './workers/processor.js';
import { env } from './config/env.js';
import { mkdirSync } from 'fs';

async function main() {
  // Ensure storage directory exists
  mkdirSync(env.STORAGE_PATH, { recursive: true });

  // Run DB migrations
  runMigrations();

  // Register job processors
  registerAllProcessors();

  // Start job queue
  startQueue();

  // Build and start server
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`KYC API running on http://${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
  }
}

main();
