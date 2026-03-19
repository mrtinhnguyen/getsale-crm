import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('campaign_participants', (table) => {
    table.integer('enqueue_order').notNullable().defaultTo(0);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('campaign_participants', (table) => {
    table.dropColumn('enqueue_order');
  });
}
