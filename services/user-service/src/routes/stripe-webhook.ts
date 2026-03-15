import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import Stripe from 'stripe';
import { Logger } from '@getsale/logger';
import { RabbitMQClient } from '@getsale/utils';
import { EventType } from '@getsale/events';
import { asyncHandler } from '@getsale/service-core';

declare module 'express' {
  interface Request {
    rawBody?: string | Buffer;
  }
}

interface Deps {
  pool: Pool;
  log: Logger;
  rabbitmq: RabbitMQClient;
  stripe: Stripe;
}

type HandlerDeps = Pick<Deps, 'pool' | 'log' | 'rabbitmq'>;

export function stripeWebhookRouter({ pool, log, rabbitmq, stripe }: Deps): Router {
  const router = Router();

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  router.post('/', asyncHandler(async (req: Request, res: Response) => {
    if (!webhookSecret) {
      log.error({ message: 'STRIPE_WEBHOOK_SECRET not configured' });
      return res.status(500).json({ error: 'Webhook not configured' });
    }

    const signature = req.headers['stripe-signature'] as string;
    if (!signature) {
      log.warn({ message: 'Missing stripe-signature header', correlation_id: req.correlationId });
      return res.status(400).json({ error: 'Missing signature' });
    }

    if (!req.rawBody) {
      log.error({ message: 'Raw body not available for webhook verification', correlation_id: req.correlationId });
      return res.status(500).json({ error: 'Raw body unavailable' });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, signature, webhookSecret);
    } catch (err) {
      log.error({ message: 'Webhook signature verification failed', error: String(err), correlation_id: req.correlationId });
      return res.status(400).json({ error: 'Invalid signature' });
    }

    log.info({
      message: 'Stripe webhook received',
      event_type: event.type,
      event_id: event.id,
      correlation_id: req.correlationId,
    });

    const deps: HandlerDeps = { pool, log, rabbitmq };

    try {
      switch (event.type) {
        case 'invoice.payment_succeeded':
          await handlePaymentSucceeded(event.data.object as Stripe.Invoice, deps);
          break;
        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object as Stripe.Invoice, deps);
          break;
        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, deps);
          break;
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, deps);
          break;
        default:
          log.info({ message: 'Unhandled webhook event type', event_type: event.type });
      }
    } catch (err) {
      log.error({ message: 'Error handling webhook event', event_type: event.type, event_id: event.id, error: String(err) });
      return res.status(500).json({ error: 'Handler failed' });
    }

    res.json({ received: true });
  }));

  return router;
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function extractSubscriptionId(ref: string | Stripe.Subscription | null | undefined): string | undefined {
  if (!ref) return undefined;
  return typeof ref === 'string' ? ref : ref.id;
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice, { pool, log, rabbitmq }: HandlerDeps) {
  const stripeSubId = extractSubscriptionId(invoice.subscription);
  if (!stripeSubId) return;

  const periodEnd = invoice.lines?.data?.[0]?.period?.end
    ? new Date(invoice.lines.data[0].period.end * 1000)
    : null;

  const result = await pool.query(
    `UPDATE subscriptions
     SET status = 'active',
         current_period_end = COALESCE($1, current_period_end),
         updated_at = NOW()
     WHERE stripe_subscription_id = $2
     RETURNING id, user_id, organization_id, plan`,
    [periodEnd, stripeSubId],
  );

  if (result.rows.length === 0) {
    log.warn({ message: 'No subscription found for payment succeeded', stripe_subscription_id: stripeSubId });
    return;
  }

  const sub = result.rows[0];
  log.info({ message: 'Payment succeeded — subscription activated', subscription_id: sub.id, user_id: sub.user_id, plan: sub.plan });

  await rabbitmq.publishEvent({
    id: randomUUID(),
    type: EventType.SUBSCRIPTION_UPDATED,
    timestamp: new Date(),
    organizationId: sub.organization_id,
    userId: sub.user_id,
    data: { subscriptionId: sub.id, status: 'active', plan: sub.plan, stripeSubscriptionId: stripeSubId },
  });
}

async function handlePaymentFailed(invoice: Stripe.Invoice, { pool, log, rabbitmq }: HandlerDeps) {
  const stripeSubId = extractSubscriptionId(invoice.subscription);
  if (!stripeSubId) return;

  const result = await pool.query(
    `UPDATE subscriptions
     SET status = 'past_due', updated_at = NOW()
     WHERE stripe_subscription_id = $1
     RETURNING id, user_id, organization_id, plan`,
    [stripeSubId],
  );

  if (result.rows.length === 0) {
    log.warn({ message: 'No subscription found for payment failed', stripe_subscription_id: stripeSubId });
    return;
  }

  const sub = result.rows[0];
  log.info({ message: 'Payment failed — subscription past due', subscription_id: sub.id, user_id: sub.user_id });

  await rabbitmq.publishEvent({
    id: randomUUID(),
    type: EventType.SUBSCRIPTION_UPDATED,
    timestamp: new Date(),
    organizationId: sub.organization_id,
    userId: sub.user_id,
    data: { subscriptionId: sub.id, status: 'past_due', plan: sub.plan, stripeSubscriptionId: stripeSubId },
  });
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription, { pool, log, rabbitmq }: HandlerDeps) {
  const result = await pool.query(
    `UPDATE subscriptions
     SET status = $1,
         current_period_start = $2,
         current_period_end = $3,
         updated_at = NOW()
     WHERE stripe_subscription_id = $4
     RETURNING id, user_id, organization_id, plan`,
    [
      subscription.status,
      new Date(subscription.current_period_start * 1000),
      new Date(subscription.current_period_end * 1000),
      subscription.id,
    ],
  );

  if (result.rows.length === 0) {
    log.warn({ message: 'No subscription found for update', stripe_subscription_id: subscription.id });
    return;
  }

  const sub = result.rows[0];
  log.info({ message: 'Subscription updated', subscription_id: sub.id, subscription_status: subscription.status });

  await rabbitmq.publishEvent({
    id: randomUUID(),
    type: EventType.SUBSCRIPTION_UPDATED,
    timestamp: new Date(),
    organizationId: sub.organization_id,
    userId: sub.user_id,
    data: { subscriptionId: sub.id, status: subscription.status, plan: sub.plan, stripeSubscriptionId: subscription.id },
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription, { pool, log, rabbitmq }: HandlerDeps) {
  const result = await pool.query(
    `UPDATE subscriptions
     SET status = 'cancelled', updated_at = NOW()
     WHERE stripe_subscription_id = $1
     RETURNING id, user_id, organization_id, plan`,
    [subscription.id],
  );

  if (result.rows.length === 0) {
    log.warn({ message: 'No subscription found for deletion', stripe_subscription_id: subscription.id });
    return;
  }

  const sub = result.rows[0];
  log.info({ message: 'Subscription cancelled', subscription_id: sub.id, user_id: sub.user_id });

  await rabbitmq.publishEvent({
    id: randomUUID(),
    type: EventType.SUBSCRIPTION_CANCELLED,
    timestamp: new Date(),
    organizationId: sub.organization_id,
    userId: sub.user_id,
    data: { subscriptionId: sub.id, cancelledAt: new Date() },
  });
}
