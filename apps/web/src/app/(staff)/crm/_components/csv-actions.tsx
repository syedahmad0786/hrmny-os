"use client";

import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { CrmBtn } from "@/components/crm/ui";
import { csvToObjects } from "@/lib/csv-parse";

const MAX_IMPORT_ROWS = 5000;

type ImportSummary = {
  created: number;
  skipped: number;
  errors: { row: number; message: string }[];
};

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** W5 CSV export/import. Import is companies/contacts only (no deals import API). */
export function CsvActions({
  kind,
}: {
  kind: "companies" | "contacts" | "deals";
}) {
  const utils = trpc.useUtils();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportCompanies = trpc.crm.export.companies.useQuery(undefined, {
    enabled: false,
  });
  const exportContacts = trpc.crm.export.contacts.useQuery(undefined, {
    enabled: false,
  });
  const exportDeals = trpc.crm.export.deals.useQuery(undefined, {
    enabled: false,
  });
  const importCompanies = trpc.crm.import.companies.useMutation();
  const importContacts = trpc.crm.import.contacts.useMutation();

  const doExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const query =
        kind === "companies"
          ? exportCompanies
          : kind === "contacts"
            ? exportContacts
            : exportDeals;
      const res = await query.refetch();
      if (res.error) throw res.error;
      if (typeof res.data !== "string") throw new Error("Empty export");
      downloadCsv(res.data, `crm-${kind}.csv`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const doImport = async (file: File) => {
    setImporting(true);
    setError(null);
    setSummary(null);
    try {
      const rows = csvToObjects(await file.text());
      if (rows.length === 0) throw new Error("No data rows found in CSV");
      if (rows.length > MAX_IMPORT_ROWS) {
        throw new Error(
          `CSV has ${rows.length} rows; maximum is ${MAX_IMPORT_ROWS}`,
        );
      }
      const result =
        kind === "companies"
          ? await importCompanies.mutateAsync({ rows })
          : await importContacts.mutateAsync({ rows });
      setSummary(result);
      await utils.crm.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <CrmBtn disabled={exporting} onClick={() => void doExport()}>
        {exporting ? "Exporting…" : `Export ${kind} CSV`}
      </CrmBtn>
      {kind !== "deals" ? (
        <>
          <CrmBtn
            disabled={importing}
            onClick={() => fileRef.current?.click()}
          >
            {importing ? "Importing…" : "Import CSV"}
          </CrmBtn>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            aria-label={`Import ${kind} CSV file`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void doImport(file);
            }}
          />
        </>
      ) : null}
      {error ? (
        <small className="text-[10px] font-bold text-[var(--danger)]" role="alert">
          {error}
        </small>
      ) : null}
      {summary ? (
        <small className="text-[10px] text-[var(--muted)]">
          Imported: {summary.created} created · {summary.skipped} skipped ·{" "}
          {summary.errors.length} errors
          {summary.errors.length > 0
            ? ` (row ${summary.errors[0]!.row + 1}: ${summary.errors[0]!.message}${
                summary.errors.length > 1 ? "; …" : ""
              })`
            : ""}
        </small>
      ) : null}
    </div>
  );
}
