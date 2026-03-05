import { createServiceApp } from '@getsale/service-core';
import { membersRouter } from './routes/members';
import { invitesRouter, inviteLinksRouter } from './routes/invites';
import { clientsRouter } from './routes/clients';

async function main() {
  const ctx = await createServiceApp({
    name: 'team-service',
    port: 3011,
    cors: true,
  });

  const { pool, rabbitmq, log } = ctx;
  const deps = { pool, rabbitmq, log };

  ctx.mount('/api/team/members', membersRouter(deps));
  ctx.mount('/api/team/invitations', invitesRouter({ pool, log }));
  ctx.mount('/api/team/invite-links', inviteLinksRouter({ pool, log }));
  ctx.mount('/api/team/clients', clientsRouter({ pool, log }));

  ctx.start();
}

main().catch((err) => {
  console.error('Fatal: Team service failed to start:', err);
  process.exit(1);
});
