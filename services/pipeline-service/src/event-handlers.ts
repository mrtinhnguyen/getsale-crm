import { Pool } from 'pg';
import { RabbitMQClient } from '@getsale/utils';
import { EventType, type Event } from '@getsale/events';
import { Logger } from '@getsale/logger';
import { createDefaultPipelineForOrg } from './default-pipeline';

interface Deps {
  pool: Pool;
  rabbitmq: RabbitMQClient;
  log: Logger;
}

export async function subscribeToOrganizationCreated(deps: Deps): Promise<void> {
  const { pool, rabbitmq, log } = deps;
  await rabbitmq.subscribeToEvents(
    [EventType.ORGANIZATION_CREATED],
    async (event: Event) => {
      const e = event as { organizationId?: string; data?: { organizationId?: string } };
      const organizationId = e.organizationId ?? e.data?.organizationId;
      if (!organizationId || typeof organizationId !== 'string') {
        log.warn({ message: 'ORGANIZATION_CREATED missing organizationId', eventId: event.id });
        return;
      }
      try {
        await createDefaultPipelineForOrg(pool, organizationId);
        log.info({ message: 'Default pipeline created for new organization', organizationId });
      } catch (err) {
        log.error({
          message: 'Failed to create default pipeline for organization',
          organizationId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
    'events',
    'pipeline-service'
  );
}
