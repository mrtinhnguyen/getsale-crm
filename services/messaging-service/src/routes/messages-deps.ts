import type { Pool } from 'pg';
import type { RabbitMQClient } from '@getsale/utils';
import type { Logger } from '@getsale/logger';
import type { ServiceHttpClient } from '@getsale/service-core';

export interface MessagesRouterDeps {
  pool: Pool;
  rabbitmq: RabbitMQClient;
  log: Logger;
  bdAccountsClient: ServiceHttpClient;
}
