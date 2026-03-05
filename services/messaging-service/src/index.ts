import { createServiceApp, ServiceHttpClient } from '@getsale/service-core';
import { createLogger } from '@getsale/logger';
import { subscribeToEvents } from './event-handlers';
import { messagesRouter } from './routes/messages';
import { chatsRouter } from './routes/chats';
import { conversationsRouter } from './routes/conversations';

async function main() {
  const ctx = await createServiceApp({
    name: 'messaging-service',
    port: parseInt(process.env.PORT || '3003', 10),
  });
  const { pool, rabbitmq, log, registry } = ctx;

  const bdAccountsClient = new ServiceHttpClient({
    baseUrl: process.env.BD_ACCOUNTS_SERVICE_URL || 'http://bd-accounts-service:3007',
    name: 'bd-accounts-service',
    retries: 0,
  }, log);

  const aiClient = new ServiceHttpClient({
    baseUrl: process.env.AI_SERVICE_URL || 'http://localhost:3005',
    name: 'ai-service',
  }, log);

  try {
    await subscribeToEvents({ pool, rabbitmq, log });
  } catch (error) {
    log.warn({
      message: 'RabbitMQ event subscription failed, service will continue without events',
      error: String(error),
    });
  }

  const messageDeps = { pool, rabbitmq, log, bdAccountsClient };
  const chatDeps = { pool, log };
  const conversationDeps = { pool, log, bdAccountsClient, aiClient, registry };

  ctx.mount('/api/messaging', messagesRouter(messageDeps));
  ctx.mount('/api/messaging', chatsRouter(chatDeps));
  ctx.mount('/api/messaging', conversationsRouter(conversationDeps));

  ctx.start();
}

main().catch((err) => {
  createLogger('messaging-service').error({ message: 'Fatal: messaging-service failed to start', error: String(err) });
  process.exit(1);
});
