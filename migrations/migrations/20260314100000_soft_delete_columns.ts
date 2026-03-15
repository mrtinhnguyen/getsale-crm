import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const tables = ['companies', 'contacts', 'campaigns', 'leads'];
  for (const table of tables) {
    const hasColumn = await knex.schema.hasColumn(table, 'deleted_at');
    if (!hasColumn) {
      await knex.schema.alterTable(table, (t) => {
        t.timestamp('deleted_at').nullable();
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  const tables = ['companies', 'contacts', 'campaigns', 'leads'];
  for (const table of tables) {
    const hasColumn = await knex.schema.hasColumn(table, 'deleted_at');
    if (hasColumn) {
      await knex.schema.alterTable(table, (t) => {
        t.dropColumn('deleted_at');
      });
    }
  }
}
