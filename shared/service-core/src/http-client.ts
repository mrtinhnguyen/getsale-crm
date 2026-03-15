import { Logger } from '@getsale/logger';

export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  name: string;
  /** Number of consecutive 5xx/timeout failures before the circuit opens (default 5) */
  circuitBreakerThreshold?: number;
  /** Time in ms the circuit stays open before allowing a probe request (default 30 000) */
  circuitBreakerResetMs?: number;
}

/** Optional context to forward to downstream services for attribution and tracing */
export interface RequestContext {
  userId?: string;
  organizationId?: string;
  userRole?: string;
  correlationId?: string;
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** When set, adds X-User-Id, X-Organization-Id, X-User-Role, x-correlation-id to the request */
  context?: RequestContext;
}

class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private threshold: number = 5,
    private resetTimeout: number = 30_000,
  ) {}

  getState(): 'closed' | 'open' | 'half-open' {
    return this.state;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) this.state = 'open';
  }

  canExecute(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open' && Date.now() - this.lastFailure > this.resetTimeout) {
      this.state = 'half-open';
      return true;
    }
    return this.state === 'half-open';
  }
}

export class ServiceHttpClient {
  private baseUrl: string;
  private defaultTimeout: number;
  private retries: number;
  private retryDelay: number;
  private name: string;
  private log: Logger;
  private internalAuthSecret: string;
  private circuitBreaker: CircuitBreaker;
  defaultContext?: RequestContext;

  constructor(options: HttpClientOptions, log: Logger) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.defaultTimeout = options.timeoutMs ?? 10_000;
    this.retries = options.retries ?? 2;
    this.retryDelay = options.retryDelayMs ?? 500;
    this.name = options.name;
    this.log = log;
    this.internalAuthSecret = process.env.INTERNAL_AUTH_SECRET?.trim() || '';
    this.circuitBreaker = new CircuitBreaker(
      options.circuitBreakerThreshold ?? 5,
      options.circuitBreakerResetMs ?? 30_000,
    );
  }

  /**
   * Create a client pre-bound to the current request's user/org/correlation context.
   * Calls made through the returned client automatically propagate these headers
   * unless overridden per-call.
   */
  static fromRequest(
    req: { user?: { id?: string; organizationId?: string; role?: string }; correlationId?: string },
    options: HttpClientOptions,
    log: Logger,
  ): ServiceHttpClient {
    const client = new ServiceHttpClient(options, log);
    client.defaultContext = {
      userId: req.user?.id,
      organizationId: req.user?.organizationId,
      userRole: req.user?.role,
      correlationId: req.correlationId,
    };
    return client;
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const method = options.method ?? 'GET';
    const timeout = options.timeoutMs ?? this.defaultTimeout;

    if (!this.circuitBreaker.canExecute()) {
      this.log.warn({
        message: `${this.name} circuit breaker OPEN — request rejected`,
        http_method: method,
        http_path: path,
      });
      throw new ServiceCallError(
        `${this.name} circuit breaker is open — ${method} ${path} rejected`,
        503,
      );
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        const hdrs: Record<string, string> = {
          'Content-Type': 'application/json',
          ...options.headers,
        };
        if (this.internalAuthSecret && !hdrs['x-internal-auth']) {
          hdrs['x-internal-auth'] = this.internalAuthSecret;
        }
        const ctx = options.context ?? this.defaultContext;
        if (ctx) {
          if (ctx.userId) hdrs['x-user-id'] = ctx.userId;
          if (ctx.organizationId) hdrs['x-organization-id'] = ctx.organizationId;
          if (ctx.userRole) hdrs['x-user-role'] = ctx.userRole;
          if (ctx.correlationId) hdrs['x-correlation-id'] = ctx.correlationId;
        }
        const res = await fetch(url, {
          method,
          headers: hdrs,
          body: options.body != null ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          let parsed: unknown;
          try { parsed = JSON.parse(body); } catch { parsed = body; }

          throw new ServiceCallError(
            `${this.name} ${method} ${path} returned ${res.status}`,
            res.status,
            parsed
          );
        }

        const data = await res.json() as T;
        this.circuitBreaker.recordSuccess();
        return data;
      } catch (err: unknown) {
        clearTimeout(timer);
        lastError = err instanceof Error ? err : new Error(String(err));

        if (err instanceof ServiceCallError && err.statusCode >= 400 && err.statusCode < 500) {
          throw err;
        }

        this.circuitBreaker.recordFailure();

        if (attempt < this.retries) {
          if (!this.circuitBreaker.canExecute()) {
            this.log.warn({
              message: `${this.name} circuit breaker tripped during retries — aborting`,
              http_method: method,
              http_path: path,
            });
            break;
          }
          const delay = this.retryDelay * Math.pow(2, attempt);
          this.log.warn({
            message: `${this.name} call failed, retrying`,
            http_method: method,
            http_path: path,
            attempt: attempt + 1,
            delay_ms: delay,
            error: lastError.message,
          });
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    this.log.error({
      message: `${this.name} call failed after ${this.retries + 1} attempts`,
      http_method: method,
      http_path: path,
      circuit_state: this.circuitBreaker.getState(),
      error: lastError?.message,
    });

    throw lastError;
  }

  async get<T = unknown>(path: string, headers?: Record<string, string>, context?: RequestContext): Promise<T> {
    return this.request<T>(path, { method: 'GET', headers, context });
  }

  async post<T = unknown>(path: string, body: unknown, headers?: Record<string, string>, context?: RequestContext): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, headers, context });
  }

  async patch<T = unknown>(path: string, body: unknown, headers?: Record<string, string>, context?: RequestContext): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, headers, context });
  }

  async delete<T = unknown>(path: string, headers?: Record<string, string>, context?: RequestContext): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', headers, context });
  }
}

export class ServiceCallError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = 'ServiceCallError';
  }
}
