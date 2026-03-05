---
description: SaaS-specific patterns — multi-tenancy, subscription gating, audit logging, and operational concerns
globs: ["services/*/src/**/*.ts", "shared/*/src/**/*.ts"]
---

# SaaS Patterns

## Multi-Tenancy Data Isolation (CRITICAL)

### Every DB query MUST include `organization_id`

This is the #1 SaaS security rule. A missing `organization_id` filter = data leak between tenants.

```typescript
// BAD — returns ALL tenants' data
const contacts = await pool.query('SELECT * FROM contacts WHERE email = $1', [email]);

// GOOD — scoped to tenant
const contacts = await pool.query(
  'SELECT * FROM contacts WHERE organization_id = $1 AND email = $2',
  [req.user.organizationId, email]
);
```

### RabbitMQ events MUST include `organizationId`
```typescript
rabbitmq.publish('deal.created', {
  organizationId: req.user.organizationId,
  dealId: deal.id,
  // ...
});
```

### Event consumers MUST verify tenant context
```typescript
rabbitmq.subscribe('deal.created', async (msg) => {
  const { organizationId, dealId } = msg;
  if (!organizationId) {
    log.error({ message: 'Missing organizationId in event', event: 'deal.created' });
    return;
  }
  // proceed with organizationId-scoped queries
});
```

## Authorization & RBAC

### Check permissions, not just authentication
```typescript
// BAD — only checks if user is logged in
router.delete('/deals/:id', requireAuth, async (req, res) => { ... });

// GOOD — checks role/permission
router.delete('/deals/:id', requireAuth, requireRole(['admin', 'manager']), async (req, res) => { ... });
```

### Resource ownership verification
```typescript
// Always verify the resource belongs to the user's organization
const deal = await pool.query(
  'SELECT * FROM deals WHERE id = $1 AND organization_id = $2',
  [req.params.id, req.user.organizationId]
);
if (deal.rows.length === 0) {
  throw new AppError(404, 'Deal not found', ErrorCodes.NOT_FOUND);
}
```

## Subscription & Feature Gating

### Check plan limits before operations
```typescript
async function checkLimit(organizationId: string, resource: string, pool: Pool): Promise<void> {
  const org = await getOrganization(organizationId, pool);
  const limits = PLAN_LIMITS[org.subscription_tier];
  const currentCount = await getResourceCount(organizationId, resource, pool);

  if (currentCount >= limits[resource]) {
    throw new AppError(403, `Plan limit reached for ${resource}`, ErrorCodes.PLAN_LIMIT_EXCEEDED);
  }
}
```

### Feature flags by plan tier
```typescript
// Check before enabling premium features
if (!hasPlanFeature(req.user.organizationId, 'ai_assistant')) {
  throw new AppError(403, 'Upgrade your plan to use AI Assistant', ErrorCodes.FEATURE_NOT_AVAILABLE);
}
```

## Audit Logging

### Log all state-changing operations for compliance
```typescript
async function auditLog(pool: Pool, entry: {
  organizationId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
}): Promise<void> {
  await pool.query(
    `INSERT INTO audit_logs (organization_id, user_id, action, entity_type, entity_id, changes, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [entry.organizationId, entry.userId, entry.action, entry.entityType, entry.entityId, JSON.stringify(entry.changes)]
  );
}
```

### What MUST be audit-logged
- User creation, deletion, role changes
- Deal/pipeline state changes
- Data exports
- Settings changes
- Billing/subscription changes
- Login/logout events

## Pagination

### All list endpoints MUST support pagination
```typescript
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);
const offset = Number(req.query.offset) || 0;

const result = await pool.query(
  'SELECT * FROM deals WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
  [orgId, limit, offset]
);
```

### Return total count for UI pagination
```typescript
res.json({
  data: result.rows,
  pagination: { total, limit, offset, hasMore: offset + limit < total }
});
```

## API Versioning

Use URL-based versioning for public/external APIs:
```
/api/v1/deals
/api/v2/deals
```

Internal service-to-service calls can use header-based versioning or stay unversioned.

## Webhook Delivery

### External webhook calls MUST:
- Retry with exponential backoff (3 attempts)
- Include HMAC signature for verification
- Timeout after 10 seconds
- Log delivery status
