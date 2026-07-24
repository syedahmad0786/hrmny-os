"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

type Answers = Record<string, unknown>;

function fileAnswer(file: File) {
  return new Promise<{
    fileName: string;
    contentType: string;
    contentBase64: string;
  }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () =>
      resolve({
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        contentBase64: String(reader.result).split(",")[1] ?? "",
      });
    reader.readAsDataURL(file);
  });
}

export default function PublicFormPage() {
  const { formId } = useParams<{ formId: string }>();
  const form = trpc.work.forms.publicView.useQuery(
    { formId },
    { retry: false },
  );
  const submit = trpc.work.forms.publicSubmit.useMutation();
  const [answers, setAnswers] = useState<Answers>({});
  const [fileError, setFileError] = useState<string | null>(null);

  if (form.isLoading)
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <p className="text-sm text-muted">Loading form…</p>
      </main>
    );
  if (!form.data || form.error)
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <section className="max-w-md rounded-2xl border border-sand bg-white p-8 text-center shadow-sm">
          <h1 className="font-display text-2xl font-semibold">
            Form unavailable
          </h1>
          <p className="mt-2 text-sm text-muted">
            This form is private, paused, or no longer exists.
          </p>
        </section>
      </main>
    );
  if (submit.data)
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <section className="max-w-lg rounded-2xl border border-sand bg-white p-8 text-center shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-ochre">
            Received
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold">
            Thank you
          </h1>
          <p className="mt-3 text-sm text-muted">{submit.data.message}</p>
          <button
            className="mt-6 rounded-lg border border-sand px-4 py-2 text-sm"
            onClick={() => {
              submit.reset();
              setAnswers({});
            }}
          >
            Send another response
          </button>
        </section>
      </main>
    );

  return (
    <main className="min-h-screen px-4 py-10 sm:px-6">
      <section className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-sand bg-white shadow-sm">
        <header className="border-b border-sand bg-cream/60 p-6 sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-ochre">
            hrmny request form
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold">
            {form.data.name}
          </h1>
          {form.data.description ? (
            <p className="mt-3 text-sm text-muted">{form.data.description}</p>
          ) : null}
        </header>
        <form
          className="space-y-5 p-6 sm:p-8"
          onSubmit={(event) => {
            event.preventDefault();
            if (!fileError) submit.mutate({ formId, answers });
          }}
        >
          {form.data.questions.map((question) => {
            if (
              question.showWhen &&
              answers[question.showWhen.key] !== question.showWhen.equals
            )
              return null;
            const label = (
              <span className="mb-1.5 block text-sm font-semibold">
                {question.label}
                {question.required ? " *" : ""}
              </span>
            );
            if (question.type === "checkbox")
              return (
                <label key={question.key} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={answers[question.key] === true}
                    required={question.required}
                    onChange={(event) =>
                      setAnswers((current) => ({
                        ...current,
                        [question.key]: event.target.checked,
                      }))
                    }
                  />
                  <span className="text-sm font-semibold">
                    {question.label}
                  </span>
                </label>
              );
            if (question.type === "attachment")
              return (
                <label key={question.key} className="block">
                  {label}
                  <input
                    className="block w-full rounded-lg border border-sand px-3 py-2 text-sm"
                    type="file"
                    multiple={question.multiple}
                    required={question.required}
                    onChange={async (event) => {
                      const files = [...(event.target.files ?? [])];
                      const total = files.reduce(
                        (sum, file) => sum + file.size,
                        0,
                      );
                      if (
                        files.some((file) => file.size > 10_000_000) ||
                        total > 25_000_000 ||
                        files.length > 10
                      ) {
                        setFileError(
                          "Files are limited to 10 MB each, 10 files, and 25 MB total.",
                        );
                        return;
                      }
                      setFileError(null);
                      const encoded = await Promise.all(files.map(fileAnswer));
                      setAnswers((current) => ({
                        ...current,
                        [question.key]: encoded,
                      }));
                    }}
                  />
                </label>
              );
            if (question.type === "single_select")
              return (
                <label key={question.key} className="block">
                  {label}
                  <select
                    className="w-full rounded-lg border border-sand px-3 py-2"
                    required={question.required}
                    value={String(answers[question.key] ?? "")}
                    onChange={(event) =>
                      setAnswers((current) => ({
                        ...current,
                        [question.key]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Choose…</option>
                    {question.options.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </label>
              );
            if (question.type === "multi_select")
              return (
                <label key={question.key} className="block">
                  {label}
                  <select
                    className="min-h-28 w-full rounded-lg border border-sand px-3 py-2"
                    multiple
                    required={question.required}
                    value={
                      (answers[question.key] as string[] | undefined) ?? []
                    }
                    onChange={(event) =>
                      setAnswers((current) => ({
                        ...current,
                        [question.key]: [...event.target.selectedOptions].map(
                          (option) => option.value,
                        ),
                      }))
                    }
                  >
                    {question.options.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </label>
              );
            const textarea = question.type === "textarea";
            const className = `w-full rounded-lg border border-sand px-3 py-2 ${textarea ? "min-h-28" : ""}`;
            return (
              <label key={question.key} className="block">
                {label}
                {textarea ? (
                  <textarea
                    className={className}
                    required={question.required}
                    value={String(answers[question.key] ?? "")}
                    onChange={(event) =>
                      setAnswers((current) => ({
                        ...current,
                        [question.key]: event.target.value,
                      }))
                    }
                  />
                ) : (
                  <input
                    className={className}
                    type={
                      question.type === "number"
                        ? "number"
                        : question.type === "date"
                          ? "date"
                          : "text"
                    }
                    required={question.required}
                    value={String(answers[question.key] ?? "")}
                    onChange={(event) =>
                      setAnswers((current) => ({
                        ...current,
                        [question.key]:
                          question.type === "number"
                            ? event.target.value === ""
                              ? undefined
                              : Number(event.target.value)
                            : event.target.value,
                      }))
                    }
                  />
                )}
              </label>
            );
          })}
          {fileError ? (
            <p className="text-sm text-red-700" role="alert">
              {fileError}
            </p>
          ) : null}
          {submit.error ? (
            <p className="text-sm text-red-700" role="alert">
              {submit.error.message}
            </p>
          ) : null}
          <button
            className="w-full rounded-lg bg-ink px-4 py-3 font-semibold text-white disabled:opacity-50"
            disabled={submit.isPending || Boolean(fileError)}
          >
            {submit.isPending ? "Sending…" : "Submit request"}
          </button>
          <p className="text-center text-xs text-muted">
            Submitted securely to hrmny OS.
          </p>
        </form>
      </section>
    </main>
  );
}
