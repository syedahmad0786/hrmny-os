import type { BayzatEmployeeRow } from "../types";

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

const ID_KEYS = ["external_id", "employee_id", "id", "bayzat_id"];
const NAME_KEYS = ["display_name", "name", "full_name", "employee_name"];
const EMAIL_KEYS = ["email", "work_email", "email_address"];

function pick(row: Record<string, string>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v) return v;
  }
  return undefined;
}

/** Parse Bayzat-style employee CSV into mirror rows (read-only import). */
export function parseBayzatCsv(csvText: string): BayzatEmployeeRow[] {
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]!).map(normalizeHeader);
  const rows: BayzatEmployeeRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => {
      raw[h] = cells[idx] ?? "";
    });
    const externalId = pick(raw, ID_KEYS);
    const displayName = pick(raw, NAME_KEYS);
    const email = pick(raw, EMAIL_KEYS);
    if (!externalId || !displayName || !email) continue;
    rows.push({
      externalId,
      displayName,
      email,
      department: raw.department || raw.dept || undefined,
      basicSalaryAed: raw.basic_salary || raw.salary || undefined,
      leaveBalanceDays: raw.leave_balance || raw.leave_days || undefined,
      raw,
    });
  }
  return rows;
}
