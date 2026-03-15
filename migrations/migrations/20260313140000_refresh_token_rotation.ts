import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('refresh_tokens', (table) => {
    table.uuid('family_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.boolean('used').notNullable().defaultTo(false);
    table.index('family_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('refresh_tokens', (table) => {
    table.dropIndex('family_id');
    table.dropColumn('used');
    table.dropColumn('family_id');
  });
}
