import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, "packages/db/package.json"));
const postgres = require("postgres");

function loadEnv(path) {
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

loadEnv(join(root, "apps/web/.env.local"));
const url = process.env.DATABASE_URL;
if (!url) {
  console.error(JSON.stringify({ ok: false, error: "NO_DATABASE_URL" }));
  process.exit(1);
}

const sql = postgres(url, { ssl: "require", max: 1, connect_timeout: 20 });
try {
  const [{ now }] = await sql`select now() as now`;
  const tables = await sql`
    select count(*)::int as n
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  `;
  const roles = await sql`select count(*)::int as n from role`;
  const employees = await sql`select count(*)::int as n from employee`;
  const deals = await sql`select count(*)::int as n from deal`;
  console.log(
    JSON.stringify({
      ok: true,
      now,
      tables: tables[0].n,
      roles: roles[0].n,
      employees: employees[0].n,
      deals: deals[0].n,
    }),
  );
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e.message || e) }));
  process.exit(2);
} finally {
  await sql.end({ timeout: 2 });
}
