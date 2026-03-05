---
description: Database migration safety rules for SaaS zero-downtime deployments
globs: ["migrations/**/*.ts", "migrations/**/*.sql"]
---

# Database Migration Rules

## Zero-Downtime Migrations (CRITICAL for SaaS)

Every migration MUST be backwards-compatible with the previous version of the code. Deployments roll out gradually — old and new code run simultaneously.

### Safe Operations
- Adding a new column with a default value or nullable
- Adding a new table
- Adding an index (use `CREATE INDEX CONCURRENTLY` in PostgreSQL)
- Adding a new enum value

### Unsafe Operations (require multi-step migration)
- Renaming a column → add new column, migrate data, drop old in next release
- Removing a column → stop reading it first, drop in next release
- Changing column type → add new column, migrate, drop old
- Adding NOT NULL to existing column → add default first, backfill, then add constraint

## Required Patterns

### Always include UP and DOWN
```typescript
export async function up(knex: Knex): Promise<void> {
  // forward migration
}

export async function down(knex: Knex): Promise<void> {
  // rollback migration
}
```

### Use transactions for data migrations
```typescript
export async function up(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // schema change + data migration in one transaction
  });
}
```

### Index creation — use CONCURRENTLY
```sql
-- BAD: locks the table
CREATE INDEX idx_deals_status ON deals(status);

-- GOOD: non-blocking
CREATE INDEX CONCURRENTLY idx_deals_status ON deals(status);
```

## Naming Convention

```
YYYYMMDDHHMMSS_description.ts
```

Example: `20260305120000_add_subscription_tier_to_organizations.ts`

## Rules

- NEVER modify an existing migration that has been applied
- NEVER delete data without a backup strategy
- Always test migrations on a copy of production data
- Large data migrations should be batched (1000 rows at a time)
- Add indexes for any new foreign key columns
- Always scope tenant data by `organization_id`
