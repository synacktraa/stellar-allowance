/**
 * Applies SQL migrations in order, once each.
 *
 * Run with:  npm run migrate
 *
 * Each file in ../supabase/migrations is applied inside a transaction and recorded in
 * schema_migrations. A file that has already run is skipped, so the command is safe to repeat
 * and there is never a question of which ones have been applied.
 *
 * Node reads .env.local via --env-file, so there is no dotenv dependency here.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', 'supabase', 'migrations');

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('SUPABASE_DB_URL is not set in web/.env.local');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  // Supabase terminates TLS with a certificate this client does not have in its trust store.
  ssl: { rejectUnauthorized: false },
});

await client.connect();

await client.query(`
  create table if not exists schema_migrations (
    name        text primary key,
    applied_at  timestamptz not null default now()
  )
`);

const { rows } = await client.query('select name from schema_migrations');
const applied = new Set(rows.map((row) => row.name));

const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

let count = 0;
for (const file of files) {
  if (applied.has(file)) {
    console.log(`  skip   ${file}`);
    continue;
  }

  const sql = await readFile(join(migrationsDir, file), 'utf8');
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into schema_migrations (name) values ($1)', [file]);
    await client.query('commit');
    console.log(`  applied ${file}`);
    count += 1;
  } catch (error) {
    await client.query('rollback');
    console.error(`\nFailed on ${file}:\n${error.message}`);
    await client.end();
    process.exit(1);
  }
}

const summary = await client.query(`
  select table_name from information_schema.tables
  where table_schema = 'public' order by table_name
`);

console.log(`\n${count} applied, ${files.length - count} already present`);
console.log(`tables: ${summary.rows.map((r) => r.table_name).join(', ')}`);

await client.end();
