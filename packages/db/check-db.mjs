import fs from "node:fs";
import postgres from "postgres";

const envPath = new URL("../../apps/web/.env.local", import.meta.url);
const env = fs.readFileSync(envPath, "utf8");
const m = env.match(/^DATABASE_URL=(.+)$/m);
if (!m) {
  console.log(JSON.stringify({ ok: false, error: "DATABASE_URL missing" }));
  process.exit(1);
}
const url = m[1].trim();
const sql = postgres(url, { prepare: false, connect_timeout: 20, max: 1 });
try {
  const rows = await sql`
    select current_database() as db,
           (select count(*)::int from information_schema.tables
             where table_schema = 'public' and table_type = 'BASE TABLE') as tables
  `;
  const roles = await sql`select count(*)::int as n from role`;
  console.log(
    JSON.stringify({
      ok: true,
      db: rows[0].db,
      tables: rows[0].tables,
      roles: roles[0].n,
    }),
  );
  await sql.end({ timeout: 2 });
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e?.message || e) }));
  process.exit(1);
}
