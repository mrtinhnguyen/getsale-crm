import { createServiceApp } from '@getsale/service-core';
import { RedisClient } from '@getsale/utils';
import { TelegramManager } from './telegram';
import { accountsRouter } from './routes/accounts';
import { authRouter } from './routes/auth';
import { syncRouter } from './routes/sync';
import { messagingRouter } from './routes/messaging';
import { mediaRouter } from './routes/media';

async function main() {
  const ctx = await createServiceApp({ name: 'bd-accounts-service', port: 3007 });
  const { pool, rabbitmq, log } = ctx;

  const redisUrl = process.env.REDIS_URL;
  const redis = redisUrl ? new RedisClient(redisUrl) : null;

  const telegramManager = new TelegramManager(pool, rabbitmq, redis, log);

  process.on('unhandledRejection', (reason: any) => {
    if (reason?.message?.includes('builder.resolve is not a function') ||
        reason?.message?.includes('builder.resolve') ||
        reason?.stack?.includes('builder.resolve')) {
      return;
    }
    if (reason?.message === 'TIMEOUT' || reason?.message?.includes?.('TIMEOUT')) {
      if (reason?.stack?.includes('updates.js')) {
        telegramManager.scheduleReconnectAllAfterTimeout();
        log.warn({ message: 'Update loop TIMEOUT (GramJS), reconnecting clients — expected under load or idle connection' });
      }
      return;
    }
    log.error({ message: 'Unhandled promise rejection', error: String(reason) });
  });

  process.on('uncaughtException', (error: Error) => {
    if (error.message?.includes('builder.resolve is not a function') ||
        error.message?.includes('builder.resolve') ||
        error.stack?.includes('builder.resolve')) {
      return;
    }
    if (error.message === 'TIMEOUT' || error.message?.includes?.('TIMEOUT')) {
      telegramManager.scheduleReconnectAllAfterTimeout();
      log.warn({ message: 'Update loop TIMEOUT (GramJS), reconnecting clients — expected under load or idle connection' });
      return;
    }
    log.error({ message: 'Uncaught exception', error: error.message, stack: error.stack });
  });

  process.on('SIGTERM', async () => {
    log.info({ message: 'SIGTERM received, shutting down gracefully...' });
    await telegramManager.shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    log.info({ message: 'SIGINT received, shutting down gracefully...' });
    await telegramManager.shutdown();
    process.exit(0);
  });

  telegramManager.initializeActiveAccounts().catch((error: unknown) => {
    log.error({ message: 'Failed to initialize active accounts', error: String(error) });
  });

  const deps = { pool, rabbitmq, log, telegramManager };

  // Auth (literal paths) and media (/:id/avatar, /:id/chats/:chatId/avatar) before accounts (/:id)
  ctx.mount('/api/bd-accounts', authRouter(deps));
  ctx.mount('/api/bd-accounts', mediaRouter(deps));
  ctx.mount('/api/bd-accounts', accountsRouter(deps));
  ctx.mount('/api/bd-accounts', syncRouter(deps));
  ctx.mount('/api/bd-accounts', messagingRouter(deps));

  ctx.start();
}

main().catch((err) => {
  console.error('Fatal: bd-accounts-service failed to start:', err);
  process.exit(1);
});
