import { sql } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "./db";
import { featureEnabled } from "./features";
import { writeAudit } from "./m1-persistence";
import { getGoogleWorkspaceAccessToken } from "./trpc/connections-router";
import { isWorkConnectedAppAllowed } from "./work-governance";

const jobSchema = z.object({ submissionId: z.string().uuid() });
const questionsSchema = z.array(
  z.object({
    key: z.string(),
    label: z.string(),
    type: z.string(),
  }),
);
const answersSchema = z.record(z.unknown());
const gmailResponseSchema = z.object({ id: z.string().min(1) });

type ReceiptRow = {
  formId: string;
  projectId: string;
  clientId: string | null;
  senderEmployeeId: string;
  formName: string;
  confirmationMessage: string;
  questions: unknown;
  answers: unknown;
};

function printableAnswer(type: string, value: unknown) {
  if (type === "attachment" && Array.isArray(value))
    return value
      .flatMap((file) =>
        file && typeof file === "object" && "fileName" in file
          ? [String(file.fileName)]
          : [],
      )
      .join(", ");
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (["string", "number"].includes(typeof value)) return String(value);
  return "";
}

export function buildWorkFormReceipt(input: {
  formName: string;
  confirmationMessage: string;
  questions: z.infer<typeof questionsSchema>;
  answers: Record<string, unknown>;
}) {
  const lines = input.questions.flatMap((question) => {
    const value = printableAnswer(question.type, input.answers[question.key]);
    return value ? [`${question.label}: ${value.slice(0, 2_000)}`] : [];
  });
  return [
    input.confirmationMessage,
    "",
    `Submission: ${input.formName}`,
    "",
    ...lines,
  ]
    .join("\n")
    .slice(0, 50_000);
}

export async function sendWorkFormReceipt(input: {
  accessToken: string;
  recipient: string;
  subject: string;
  text: string;
  submissionId: string;
  fetchImpl?: typeof fetch;
}) {
  const recipient = z.string().trim().email().max(254).parse(input.recipient);
  const subject = input.subject
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 200);
  const encodedSubject = Buffer.from(subject, "utf8").toString("base64");
  const message = [
    `To: ${recipient}`,
    `Subject: =?UTF-8?B?${encodedSubject}?=`,
    `Message-ID: <hrmny-form-${input.submissionId}@hrmny.co>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.text,
  ].join("\r\n");
  const response = await (input.fetchImpl ?? fetch)(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        raw: Buffer.from(message, "utf8").toString("base64url"),
      }),
    },
  );
  if (!response.ok)
    throw new Error(`Google Workspace email send failed (${response.status})`);
  return gmailResponseSchema.parse(await response.json());
}

export async function runWorkFormReceiptJob(payload: unknown) {
  const { submissionId } = jobSchema.parse(payload);
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required for form receipts");
  const [row] = await db.execute<ReceiptRow>(sql`
    select submission.work_form_id as "formId",
      form.work_project_id as "projectId", project.client_id as "clientId",
      form.created_by_employee_id as "senderEmployeeId", form.name as "formName",
      form.confirmation_message as "confirmationMessage", form.questions,
      submission.answers
    from public.work_form_submission submission
    join public.work_form form on form.work_form_id = submission.work_form_id
    join public.work_project project
      on project.work_project_id = form.work_project_id
    where submission.work_form_submission_id = ${submissionId}::uuid
  `);
  if (!row) return { sent: false, skipped: "submission_unavailable" };
  const questions = questionsSchema.parse(row.questions);
  const answers = answersSchema.parse(row.answers);
  const recipient = questions
    .filter((question) => question.type === "email")
    .map((question) =>
      z.string().trim().email().max(254).safeParse(answers[question.key]),
    )
    .find((candidate) => candidate.success);
  if (!recipient?.success) return { sent: false, skipped: "no_email" };

  const [alreadySent, roles] = await Promise.all([
    db.execute(sql`
      select 1 from public.audit_event
      where action = 'work.form.receipt.sent'
        and entity_type = 'work_form_submission'
        and entity_id = ${submissionId}::uuid
      limit 1
    `),
    db.execute<{ key: string }>(sql`
      select role.key from public.employee_role membership
      join public.role role on role.role_id = membership.role_id
      where membership.employee_id = ${row.senderEmployeeId}::uuid
    `),
  ]);
  if (alreadySent[0]) return { sent: false, skipped: "already_sent" };
  const subject = {
    userId: row.senderEmployeeId,
    clientId: row.clientId,
    roles: roles.map((role) => role.key),
  };
  const [enabled, gmailAllowed] = await Promise.all([
    Promise.all(
      [
        "work.forms",
        "work.forms.email_receipts",
        "work.integrations.communication",
        "work.integrations.communication.gmail",
      ].map((featureKey) => featureEnabled(featureKey, subject)),
    ),
    isWorkConnectedAppAllowed("gmail"),
  ]);
  if (enabled.some((value) => !value))
    return { sent: false, skipped: "feature_disabled" };
  if (!gmailAllowed) return { sent: false, skipped: "connected_app_blocked" };

  const accessToken = await getGoogleWorkspaceAccessToken(row.senderEmployeeId);
  if (!accessToken)
    throw new Error("Form owner has no active Google Workspace connection");
  const sent = await sendWorkFormReceipt({
    accessToken,
    recipient: recipient.data,
    subject: `${row.formName} submission received`,
    text: buildWorkFormReceipt({
      formName: row.formName,
      confirmationMessage: row.confirmationMessage,
      questions,
      answers,
    }),
    submissionId,
  });
  await writeAudit({
    actorEmployeeId: row.senderEmployeeId,
    action: "work.form.receipt.sent",
    entityType: "work_form_submission",
    entityId: submissionId,
    before: null,
    after: {
      formId: row.formId,
      messageId: sent.id,
      recipientDomain: recipient.data.split("@")[1] ?? null,
    },
    reason: null,
  });
  return { sent: true, messageId: sent.id };
}
