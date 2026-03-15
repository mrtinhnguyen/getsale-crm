import { Knex } from 'knex';

/**
 * Enable Row-Level Security (RLS) on all tables with organization_id.
 *
 * Two policies per table:
 *   1. tenant_isolation — allow access only when app.current_org_id matches.
 *   2. bypass_rls       — allow access when the setting is not set (migrations, admin, superuser).
 *
 * SET LOCAL app.current_org_id must be called inside a transaction by the application layer
 * before querying tenant-scoped data. This is a safety net on top of existing WHERE clauses.
 */

const RLS_TABLES = [
  'users',
  'user_profiles',
  'subscriptions',
  'companies',
  'contacts',
  'pipelines',
  'stages',
  'deals',
  'teams',
  'bd_accounts',
  'messages',
  'automation_rules',
  'analytics_metrics',
  'conversion_rates',
  'notes',
  'reminders',
  'campaigns',
  'campaign_templates',
  'organization_members',
  'organization_invite_links',
  'audit_logs',
  'leads',
  'stage_history',
  'conversations',
  'organization_settings',
  'contact_telegram_sources',
  'contact_discovery_tasks',
  'organization_activity',
] as const;

export async function up(knex: Knex): Promise<void> {
  for (const table of RLS_TABLES) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) continue;

    await knex.raw(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);

    await knex.raw(`
      CREATE POLICY tenant_isolation_${table} ON "${table}"
        USING (organization_id = current_setting('app.current_org_id', true)::uuid)
    `);

    await knex.raw(`
      CREATE POLICY bypass_rls_${table} ON "${table}"
        USING (current_setting('app.current_org_id', true) IS NULL)
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const table of RLS_TABLES) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) continue;

    await knex.raw(`DROP POLICY IF EXISTS tenant_isolation_${table} ON "${table}"`);
    await knex.raw(`DROP POLICY IF EXISTS bypass_rls_${table} ON "${table}"`);
    await knex.raw(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
  }
}
