import { Counter } from 'prom-client';
import { createServiceApp, ServiceHttpClient } from '@getsale/service-core';
import { pipelinesRouter } from './routes/pipelines';
import { stagesRouter } from './routes/stages';
import { leadsRouter } from './routes/leads';

async function main() {
  const ctx = await createServiceApp({ name: 'pipeline-service', port: 3008 });
  const { pool, rabbitmq, log, registry } = ctx;

  const eventPublishTotal = new Counter({
    name: 'event_publish_total', help: 'Events published to RabbitMQ',
    labelNames: ['event_type'], registers: [registry],
  });
  const eventPublishFailedTotal = new Counter({
    name: 'event_publish_failed_total', help: 'Event publish failures',
    labelNames: ['event_type'], registers: [registry],
  });

  const crmClient = new ServiceHttpClient({
    baseUrl: process.env.CRM_SERVICE_URL || 'http://crm-service:3002',
    name: 'crm-service', timeoutMs: 10_000, retries: 1,
  }, log);

  const deps = { pool, rabbitmq, log };

  ctx.mount('/api/pipeline', pipelinesRouter(deps));
  ctx.mount('/api/pipeline/stages', stagesRouter(deps));
  ctx.mount('/api/pipeline', leadsRouter({ ...deps, eventPublishTotal, eventPublishFailedTotal, crmClient }));

  ctx.start();
}

main().catch((err) => {
  console.error('Fatal: Pipeline service failed to start:', err);
  process.exit(1);
});
