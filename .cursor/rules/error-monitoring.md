---
description: Error monitoring and structured logging standards for production SaaS
globs: ["services/*/src/**/*.ts", "shared/*/src/**/*.ts"]
---

# Error Monitoring & Observability

## Structured Logging

### Every log entry MUST include context
```typescript
log.info({
  message: 'Deal updated',
  organization_id: req.user.organizationId,
  user_id: req.user.id,
  entity_type: 'deal',
  entity_id: dealId,
  correlation_id: req.correlationId,
  action: 'update',
});
```

### Log levels usage
- `error` — unhandled exceptions, integration failures, data corruption
- `warn` — rate limit hit, deprecated API used, retry attempt
- `info` — business events (created, updated, deleted), auth events
- `debug` — detailed flow tracing (disabled in production)

### NEVER log
- Passwords, tokens, API keys
- Full credit card numbers
- Personal data beyond IDs (GDPR)
- Stack traces to client responses (only to internal logs)

## Error Classification

### Operational errors (expected) — handle gracefully
- Validation failures → 400
- Resource not found → 404
- Permission denied → 403
- Rate limited → 429
- External service timeout → 503 with retry

### Programming errors (bugs) — crash and alert
- TypeError, ReferenceError
- Assertion failures
- Unhandled promise rejections

```typescript
process.on('unhandledRejection', (reason) => {
  log.error({ message: 'Unhandled rejection', error: reason });
  // report to error tracking (Sentry, etc.)
});
```

## Correlation IDs

### Every request must carry a correlation ID through the entire chain
```
Client → API Gateway → Service A → Service B → Database
         correlation_id propagated at every step
```

Use `req.correlationId` (set by middleware) in all:
- Log entries
- RabbitMQ event payloads
- Inter-service HTTP calls (as `x-correlation-id` header)

## Metrics to Track

### Business metrics
- Active users per organization
- API calls per tenant (for billing)
- Feature usage by plan tier

### Technical metrics
- Response time p50/p95/p99
- Error rate by endpoint
- Queue depth and processing time
- Database connection pool usage
- Memory and CPU per service
