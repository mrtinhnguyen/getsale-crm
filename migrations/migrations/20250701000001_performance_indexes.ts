import { Knex } from 'knex';

/**
 * Performance indexes identified in system audit.
 * Uses CREATE INDEX CONCURRENTLY to avoid locking tables in production.
 * Requires transaction: false because CONCURRENTLY cannot run inside a transaction.
 */
export const config = { transaction: false };

export async function up(knex: Knex): Promise<void> {
  // 1. Composite index on messages for chat listing (most critical query)
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_org_bd_channel
    ON messages (organization_id, bd_account_id, channel_id)
  `);

  // 2. Index on messages for conversation ordering
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_org_channel_date
    ON messages (organization_id, channel, channel_id, (COALESCE(telegram_date, created_at)) DESC)
  `);

  // 3. Index on notes for entity lookup
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notes_entity
    ON notes (entity_type, entity_id)
  `);

  // 4. Index on reminders for entity lookup
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reminders_entity
    ON reminders (entity_type, entity_id)
  `);

  // 5. Index on leads for pipeline kanban view
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_pipeline_stage
    ON leads (organization_id, pipeline_id, stage_id, order_index)
  `);

  // 6. Index on contacts for org-level listing
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_org_created
    ON contacts (organization_id, created_at DESC)
  `);

  // 7. Index on deals for pipeline queries
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_org_pipeline_stage
    ON deals (organization_id, pipeline_id, stage_id)
  `);

  // 8. Index on conversations for chat→conversation lookup
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_org_bd_channel
    ON conversations (organization_id, bd_account_id, channel, channel_id)
  `);

  // 9. Index on campaign_participants for campaign execution
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_campaign_participants_status
    ON campaign_participants (campaign_id, status, next_send_at)
  `);

  // 10. Index on lead_activity_log for timeline
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_activity_lead_created
    ON lead_activity_log (lead_id, created_at DESC)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_messages_org_bd_channel');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_messages_org_channel_date');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_notes_entity');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_reminders_entity');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_leads_pipeline_stage');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_contacts_org_created');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_deals_org_pipeline_stage');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_conversations_org_bd_channel');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_campaign_participants_status');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_lead_activity_lead_created');
}
