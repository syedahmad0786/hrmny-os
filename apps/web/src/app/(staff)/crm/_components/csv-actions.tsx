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
  importOnly = false,
}: {
  kind: "companies" | "contacts" | "deals";
  importOnly?: boolean;
}) {
  const utils = trpc.useUtils();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const preview = trpc.crm.import.preview.useMutation();
  const importFields =
    kind === "companies"
      ? ["name", "sector", "market", "website", "linkedinUrl"]
      : [
          "firstName",
          "lastName",
          "email",
          "companyName",
          "companyId",
          "phone",
          "title",
          "linkedinUrl",
        ];
  const mappedRows = () =>
    rawRows.map((row) =>
      Object.fromEntries(
        importFields
          .filter((field) => mapping[field])
          .map((field) => [field, row[mapping[field]!] ?? ""]),
      ),
    );

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
      if (file.size > 4_000_000)
        throw new Error("Use a CSV smaller than 4 MB.");
      const rows = csvToObjects(await file.text());
      if (rows.length === 0) throw new Error("No data rows found in CSV");
      if (rows.length > MAX_IMPORT_ROWS) {
        throw new Error(
          `CSV has ${rows.length} rows; maximum is ${MAX_IMPORT_ROWS}`,
        );
      }
      if (file.size > 4 * 1024 * 1024)
        throw new Error("Choose a CSV smaller than 4 MB.");
      const headers = Object.keys(rows[0]!);
      const aliases: Record<string, string[]> = {
        firstName: ["firstname", "givenname", "first"],
        lastName: ["lastname", "surname", "last"],
        email: ["email", "workemail", "emailaddress"],
        name: ["name", "company", "companyname"],
        companyName: ["company", "companyname", "organization"],
        website: ["website", "domain", "companywebsite"],
        title: ["title", "jobtitle", "role"],
        linkedinUrl: ["linkedinurl", "linkedin", "linkedinprofile"],
      };
      setRawRows(rows);
      setMapping(
        Object.fromEntries(
          importFields.map((field) => [
            field,
            headers.find((header) =>
              (aliases[field] ?? [field.toLowerCase()]).includes(
                header.toLowerCase().replace(/[^a-z]/g, ""),
              ),
            ) ?? "",
          ]),
        ),
      );
      preview.reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!importOnly ? (
        <CrmBtn disabled={exporting} onClick={() => void doExport()}>
          {exporting ? "Exporting…" : `Export ${kind} CSV`}
        </CrmBtn>
      ) : null}
      {kind !== "deals" ? (
        <>
          <CrmBtn disabled={importing} onClick={() => fileRef.current?.click()}>
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
      {rawRows.length ? (
        <div className="w-full rounded-lg border border-sand p-4">
          <h3 className="font-semibold">Map columns · {rawRows.length} rows</h3>
          <p className="my-2 text-sm text-muted">
            Match your file to CRM fields. Existing matches are preserved;
            review their records to make corrections.
          </p>
          <div className="workbook-tools">
            {importFields.map((field) => (
              <label key={field}>
                {field}
                <select
                  aria-label={`Map ${field}`}
                  value={mapping[field] ?? ""}
                  onChange={(event) => {
                    setMapping({ ...mapping, [field]: event.target.value });
                    preview.reset();
                  }}
                >
                  <option value="">Do not import</option>
                  {Object.keys(rawRows[0]!).map((header) => (
                    <option key={header}>{header}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <CrmBtn
            disabled={preview.isPending}
            onClick={() => {
              if (kind !== "deals")
                preview.mutate({ kind, rows: mappedRows() });
            }}
          >
            Preview import
          </CrmBtn>
          <CrmBtn
            onClick={() => {
              setRawRows([]);
              preview.reset();
            }}
          >
            Cancel import
          </CrmBtn>
          {preview.error ? <p role="alert">{preview.error.message}</p> : null}
          {preview.data ? (
            <div className="mt-3">
              <p>
                {preview.data.filter((r) => r.action === "create").length} new ·{" "}
                {preview.data.filter((r) => r.action === "existing").length}{" "}
                existing ·{" "}
                {preview.data.filter((r) => r.action === "invalid").length} need
                correction
              </p>
              <div className="max-h-64 overflow-auto">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Record</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.data.map((row) => (
                      <tr key={row.row}>
                        <td>{row.row + 2}</td>
                        <td>
                          {row.recordId ? (
                            <a
                              href={`/crm/${kind}/${row.recordId}`}
                              className="underline"
                            >
                              {row.name}
                            </a>
                          ) : (
                            row.name
                          )}
                        </td>
                        <td>{row.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <CrmBtn
                variant="primary"
                disabled={
                  importing ||
                  preview.data.some((row) => row.action === "invalid") ||
                  !preview.data.some((row) => row.action === "create")
                }
                onClick={() => {
                  setImporting(true);
                  setError(null);
                  const operation =
                    kind === "companies"
                      ? importCompanies.mutateAsync({ rows: mappedRows() })
                      : importContacts.mutateAsync({ rows: mappedRows() });
                  void operation
                    .then(async (result) => {
                      setSummary(result);
                      setRawRows([]);
                      preview.reset();
                      await utils.crm.invalidate();
                    })
                    .catch((error: unknown) =>
                      setError(
                        error instanceof Error
                          ? error.message
                          : "Import failed.",
                      ),
                    )
                    .finally(() => setImporting(false));
                }}
              >
                {importing ? "Importing…" : "Confirm reviewed import"}
              </CrmBtn>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <small
          className="text-[10px] font-bold text-[var(--danger)]"
          role="alert"
        >
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
