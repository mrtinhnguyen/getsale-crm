import { Counter } from 'prom-client';
import { createServiceApp } from '@getsale/service-core';
import { companiesRouter } from './routes/companies';
import { contactsRouter } from './routes/contacts';
import { dealsRouter } from './routes/deals';
import { notesRouter } from './routes/notes';
import { remindersRouter } from './routes/reminders';
import { analyticsRouter } from './routes/analytics';

async function main() {
  const ctx = await createServiceApp({ name: 'crm-service', port: 3002 });
  const { pool, rabbitmq, log, registry } = ctx;

  const dealCreatedTotal = new Counter({
    name: 'deal_created_total', help: 'Deals created', registers: [registry],
  });
  const dealStageChangedTotal = new Counter({
    name: 'deal_stage_changed_total', help: 'Deal stage transitions', registers: [registry],
  });

  const deps = { pool, rabbitmq, log };

  ctx.mount('/api/crm/companies', companiesRouter(deps));
  ctx.mount('/api/crm/contacts', contactsRouter(deps));
  ctx.mount('/api/crm/deals', dealsRouter({ ...deps, dealCreatedTotal, dealStageChangedTotal }));
  ctx.mount('/api/crm', notesRouter(deps));
  ctx.mount('/api/crm', remindersRouter(deps));
  ctx.mount('/api/crm/analytics', analyticsRouter(deps));

  ctx.start();
}

main().catch((err) => {
  console.error('Fatal: CRM service failed to start:', err);
  process.exit(1);
});
