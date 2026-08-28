/**
 * Client-side CSV parsing (RFC 4180): quoted fields, "" escapes, commas and
 * newlines inside quotes, CRLF/LF row endings. Serialization lives server-side
 * in src/server/crm/csv.ts.
 */

/** Parse CSV text into rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * Parse CSV with a header row into objects. Empty cells are omitted (not "")
 * so optional zod fields on the server stay absent; blank lines are skipped.
 */
export function csvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const header = rows[0];
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return rows
    .slice(1)
    .filter((cells) => cells.some((c) => c.trim() !== ""))
    .map((cells) => {
      const obj: Record<string, string> = {};
      keys.forEach((key, idx) => {
        const value = cells[idx];
        if (key && value !== undefined && value.trim() !== "") {
          obj[key] = value;
        }
      });
      return obj;
    });
}
