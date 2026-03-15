import Stripe from 'stripe';
import { createServiceApp } from '@getsale/service-core';
import { profileRouter } from './routes/profiles';
import { subscriptionRouter } from './routes/subscription';
import { stripeWebhookRouter } from './routes/stripe-webhook';
import { teamRouter } from './routes/team';

async function main() {
  const ctx = await createServiceApp({ name: 'user-service', port: 3006 });

  const { pool, rabbitmq, log } = ctx;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2023-10-16',
  });

  const deps = { pool, rabbitmq, log };
  ctx.mount('/api/users', profileRouter(deps));
  ctx.mount('/api/users', subscriptionRouter({ ...deps, stripe }));
  ctx.mount('/api/users/stripe-webhook', stripeWebhookRouter({ ...deps, stripe }));
  ctx.mount('/api/users', teamRouter(deps));

  ctx.start();
}

main().catch((err) => {
  console.error('Fatal: User service failed to start:', err);
  process.exit(1);
});
