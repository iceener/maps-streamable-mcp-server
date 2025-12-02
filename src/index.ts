import { serve } from '@hono/node-server';
import { config } from './config/env.js';
import { stopContextCleanup } from './core/context.js';
import { buildHttpApp } from './http/app.js';
import { MemorySessionStore } from './shared/storage/memory.js';
import { initializeStorage } from './shared/storage/singleton.js';
import { logger } from './utils/logger.js';

let sessionStore: MemorySessionStore | null = null;

async function main(): Promise<void> {
  try {
    // Initialize session storage
    sessionStore = new MemorySessionStore();
    initializeStorage(sessionStore);

    const app = buildHttpApp();
    serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST });

    await logger.info('server', {
      message: `MCP server started on http://${config.HOST}:${config.PORT}`,
      environment: config.NODE_ENV,
      authEnabled: config.AUTH_ENABLED,
      authStrategy: config.AUTH_STRATEGY,
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    await logger.error('server', {
      message: 'Server startup failed',
      error: (error as Error).message,
    });
    process.exit(1);
  }
}

function gracefulShutdown(signal: string): void {
  void logger.info('server', { message: `Received ${signal}, shutting down` });

  stopContextCleanup();

  if (sessionStore) {
    sessionStore.stopCleanup();
  }

  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

void main();
