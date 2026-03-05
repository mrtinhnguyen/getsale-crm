import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('leads', (table) => {
    table.decimal('revenue_amount', 14, 2).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('leads', (table) => {
    table.dropColumn('revenue_amount');
  });
}
