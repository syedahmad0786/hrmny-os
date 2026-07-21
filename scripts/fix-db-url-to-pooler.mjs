import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(root, "apps/web/.env.local");
const require = createRequire(join(root, "packages/db/package.json"));
const postgres = require("postgres");

const PROJECT_REF = "klrugedztqxlvyghyzxs";
const POOLER_HOST = "aws-0-ap-southeast-1.pooler.supabase.com";

let text = readFileSync(envPath, "utf8");
const m = text.match(/^\s*DATABASE_URL\s*=\s*(.+)$/m);
if (!m) {
  console.error("NO_DATABASE_URL");
  process.exit(1);
}
let current = m[1].trim().replace(/^['"]|['"]$/g, "");
const parsed = new URL(current);
const password = decodeURIComponent(parsed.password);
if (!password) {
  console.error("NO_PASSWORD");
  process.exit(1);
}

const poolerUrl = `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(password)}@${POOLER_HOST}:6543/postgres`;
const sessionUrl = `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(password)}@${POOLER_HOST}:5432/postgres`;

function upsert(content, key, value) {
  const line = `${key}=${value}`;
  if (new RegExp(`^\\s*${key}\\s*=`, "m").test(content)) {
    return content.replace(new RegExp(`^\\s*${key}\\s*=.*$`, "m"), line);
  }
  return `${content.trimEnd()}\n${line}\n`;
}

text = upsert(text, "DATABASE_URL", poolerUrl);
text = upsert(text, "DIRECT_URL", sessionUrl);
writeFileSync(envPath, text, "utf8");
writeFileSync(join(root, ".env.local"), text, "utf8");

const sql = postgres(poolerUrl, { ssl: "require", max: 1, connect_timeout: 20 });
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
      mode: "pooler_transaction_6543",
      now,
      tables: tables[0].n,
      roles: roles[0].n,
      employees: employees[0].n,
      deals: deals[0].n,
      host: POOLER_HOST,
    }),
  );
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e.message || e) }));
  process.exit(2);
} finally {
  await sql.end({ timeout: 2 });
}
