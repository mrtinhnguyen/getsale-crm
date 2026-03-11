import cookieParser from 'cookie-parser';
import { createServiceApp } from '@getsale/service-core';
import { RedisClient } from '@getsale/utils';
import { authRouter } from './routes/auth';
import { organizationRouter } from './routes/organization';
import { workspacesRouter } from './routes/workspaces';
import { invitesRouter } from './routes/invites';

async function main() {
  const ctx = await createServiceApp({
    name: 'auth-service',
    port: 3001,
    cors: true,
    skipUserExtract: true,
  });

  ctx.app.use(cookieParser());

  const redis = new RedisClient(process.env.REDIS_URL || 'redis://localhost:6379');
  const { pool, rabbitmq, log } = ctx;
  const deps = { pool, rabbitmq, log, redis };

  ctx.mount('/api/auth', authRouter(deps));
  ctx.mount('/api/auth', organizationRouter(deps));
  ctx.mount('/api/auth', workspacesRouter(deps));
  ctx.mount('/api/invite', invitesRouter(deps));

  ctx.start();
}

main().catch((err) => {
  console.error('Fatal: Auth service failed to start:', err);
  process.exit(1);
});
