import express, { Express, Router } from 'express';
import cors from 'cors';
import { Pool, PoolConfig } from 'pg';
import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';
import { RabbitMQClient } from '@getsale/utils';
import { createLogger, Logger } from '@getsale/logger';
import {
  correlationId,
  extractUser,
  requestLogger,
  errorHandler,
} from './middleware';

// ─── Service configuration ───────────────────────────────────────────────

export interface ServiceConfig {
  name: string;
  port?: number;

  /** Skip DB pool creation (e.g. for websocket-service, api-gateway) */
  skipDb?: boolean;
  /** Skip RabbitMQ connection */
  skipRabbitMQ?: boolean;
  /** Skip extractUser middleware (e.g. auth-service that verifies JWT directly) */
  skipUserExtract?: boolean;
  /** Enable CORS (default: false) */
  cors?: boolean;
  /** Extra pool config overrides */
  poolConfig?: Partial<PoolConfig>;
}

export interface ServiceContext {
  app: Express;
  pool: Pool;
  rabbitmq: RabbitMQClient;
  log: Logger;
  registry: Registry;
  metrics: ServiceMetrics;

  /** Mount routes under a prefix. Applies errorHandler after all routes. */
  mount(prefix: string, router: Router): void;

  /** Start listening. Call after all routes are mounted. */
  start(): void;
}

export interface ServiceMetrics {
  httpRequestDuration: Histogram;
  httpRequestsTotal: Counter;
}

// ─── Factory ─────────────────────────────────────────────────────────────

export async function createServiceApp(config: ServiceConfig): Promise<ServiceContext> {
  const port = config.port ?? parseInt(process.env.PORT || '3000', 10);
  const log = createLogger(config.name);

  // Express setup
  const app = express();
  if (config.cors) {
    app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
  }
  app.use(express.json({ limit: '5mb' }));
  app.use(correlationId());
  if (!config.skipUserExtract) {
    app.use(extractUser());
  }

  // Prometheus
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'path', 'status'],
    registers: [registry],
  });

  const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'path', 'status'],
    registers: [registry],
  });

  // Request logging + metrics
  app.use(requestLogger(log));
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
      const labels = {
        method: req.method,
        path: normalizePath(req.route?.path || req.path),
        status: String(res.statusCode),
      };
      httpRequestDuration.observe(labels, durationSec);
      httpRequestsTotal.inc(labels);
    });
    next();
  });

  // DB pool
  let pool: Pool;
  if (config.skipDb) {
    pool = null as unknown as Pool;
  } else {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ||
        `postgresql://postgres:${process.env.POSTGRES_PASSWORD || 'postgres_dev'}@localhost:5432/postgres`,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ...config.poolConfig,
    });
  }

  // RabbitMQ
  const rabbitmq = new RabbitMQClient(
    process.env.RABBITMQ_URL || 'amqp://getsale:getsale_dev@localhost:5672'
  );
  if (!config.skipRabbitMQ) {
    try {
      await rabbitmq.connect();
      log.info({ message: 'RabbitMQ connected' });
    } catch (error) {
      log.warn({
        message: 'RabbitMQ connection failed, continuing without events',
        error: String(error),
      });
    }
  }

  // Health check
  app.get('/health', async (_req, res) => {
    const checks: Record<string, string> = {};

    if (!config.skipDb) {
      try {
        await pool.query('SELECT 1');
        checks.db = 'ok';
      } catch {
        checks.db = 'error';
      }
    }

    if (!config.skipRabbitMQ) {
      checks.rabbitmq = rabbitmq.isConnected() ? 'ok' : 'disconnected';
    }

    const allOk = Object.values(checks).every((v) => v === 'ok');
    res.status(allOk ? 200 : 503).json({
      status: allOk ? 'ok' : 'degraded',
      service: config.name,
      checks,
    });
  });

  // Metrics endpoint
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });

  const context: ServiceContext = {
    app,
    pool,
    rabbitmq,
    log,
    registry,
    metrics: { httpRequestDuration, httpRequestsTotal },

    mount(prefix: string, router: Router) {
      app.use(prefix, router);
    },

    start() {
      app.use(errorHandler(log));

      app.listen(port, () => {
        log.info({ message: `${config.name} running on port ${port}` });
      });
    },
  };

  return context;
}

/** Collapse path params to `:param` for metric label cardinality control */
function normalizePath(path: string): string {
  return path.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id');
}
