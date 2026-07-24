"use client";

import { Button } from "@hrmny/ui";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  DIGITAL_CARD_PUBLIC_FIELDS,
  type DigitalCardPublicField,
} from "@/server/digital-cards";

type MyCardRow = {
  employee_digital_card_id: string | null;
  digital_card_template_id: string | null;
  slug: string | null;
  display_name: string | null;
  job_title: string | null;
  work_email: string | null;
  phone: string | null;
  website: string | null;
  location: string | null;
  bio: string | null;
  photo_url: string | null;
  linkedin_url: string | null;
  public_fields: string[] | null;
  is_active: boolean | null;
  admin_disabled_at: string | null;
  employee_display_name: string;
  employee_job_title: string | null;
  employee_work_email: string;
};

type TemplateRow = {
  digital_card_template_id: string;
  name: string;
  company_name: string;
  accent_color: string;
  is_default: boolean;
  is_active: boolean;
};

type AdminCardRow = {
  employee_digital_card_id: string;
  employee_name: string;
  employee_email: string;
  slug: string;
  is_active: boolean;
  admin_disabled_at: string | null;
};

const FIELD_LABELS: Record<DigitalCardPublicField, string> = {
  displayName: "Name",
  jobTitle: "Job title",
  workEmail: "Work email",
  phone: "Phone",
  website: "Website",
  location: "Location",
  bio: "Bio",
  photoUrl: "Photo",
  linkedinUrl: "LinkedIn",
};

function suggestedSlug(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "my-card"
  );
}

export default function MyCardPage() {
  const utils = trpc.useUtils();
  const session = trpc.auth.session.useQuery();
  const me = trpc.digitalCards.me.get.useQuery();
  const templatesQuery = trpc.digitalCards.templates.useQuery();
  const isAdmin = (session.data?.roles ?? []).some((role) =>
    ["partner", "director", "hr"].includes(role),
  );
  const adminCards = trpc.digitalCards.admin.cards.useQuery(undefined, {
    enabled: isAdmin,
  });
  const adminTemplates = trpc.digitalCards.admin.templates.useQuery(undefined, {
    enabled: isAdmin,
  });
  const save = trpc.digitalCards.me.upsert.useMutation({
    onSuccess: () => void utils.digitalCards.invalidate(),
  });
  const revoke = trpc.digitalCards.me.revoke.useMutation({
    onSuccess: () => void utils.digitalCards.invalidate(),
  });
  const setCardActive = trpc.digitalCards.admin.setCardActive.useMutation({
    onSuccess: () => void utils.digitalCards.admin.cards.invalidate(),
  });
  const upsertTemplate = trpc.digitalCards.admin.upsertTemplate.useMutation({
    onSuccess: () => void utils.digitalCards.invalidate(),
  });
  const setTemplateActive =
    trpc.digitalCards.admin.setTemplateActive.useMutation({
      onSuccess: () => void utils.digitalCards.invalidate(),
    });

  const [loaded, setLoaded] = useState(false);
  const [slug, setSlug] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [workEmail, setWorkEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [location, setLocation] = useState("Dubai, UAE");
  const [bio, setBio] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [publicFields, setPublicFields] = useState<DigitalCardPublicField[]>(
    [],
  );
  const [isActive, setIsActive] = useState(true);
  const [message, setMessage] = useState("");
  const [templateName, setTemplateName] = useState("hrmny card");
  const [companyName, setCompanyName] = useState("Creative Harmony");
  const [accentColor, setAccentColor] = useState("#C7702E");

  const card = me.data as unknown as MyCardRow | null | undefined;
  const templates = (templatesQuery.data ?? []) as unknown as TemplateRow[];
  const allTemplates = (adminTemplates.data ?? []) as unknown as TemplateRow[];
  const cards = (adminCards.data ?? []) as unknown as AdminCardRow[];

  useEffect(() => {
    if (!card || loaded) return;
    const name = card.display_name ?? card.employee_display_name;
    setSlug(card.slug ?? suggestedSlug(name));
    setTemplateId(
      card.digital_card_template_id ??
        templates.find((template) => template.is_default)
          ?.digital_card_template_id ??
        "",
    );
    setDisplayName(name);
    setJobTitle(card.job_title ?? card.employee_job_title ?? "");
    setWorkEmail(card.work_email ?? card.employee_work_email);
    setPhone(card.phone ?? "");
    setWebsite(card.website ?? "");
    setLocation(card.location ?? "Dubai, UAE");
    setBio(card.bio ?? "");
    setPhotoUrl(card.photo_url ?? "");
    setLinkedinUrl(card.linkedin_url ?? "");
    setPublicFields((card.public_fields ?? []) as DigitalCardPublicField[]);
    setIsActive(card.is_active ?? true);
    setLoaded(true);
  }, [card, loaded, templates]);

  function optional(value: string) {
    return value.trim() || undefined;
  }

  async function shareCard() {
    if (!slug) return;
    const url = new URL(`/card/${slug}`, window.location.origin).toString();
    if (navigator.share) await navigator.share({ title: displayName, url });
    else await navigator.clipboard.writeText(url);
    setMessage("Share link ready");
  }

  function togglePublicField(field: DigitalCardPublicField) {
    setPublicFields((current) =>
      current.includes(field)
        ? current.filter((value) => value !== field)
        : [...current, field],
    );
  }

  async function run(work: () => Promise<unknown>, success: string) {
    try {
      await work();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save");
    }
  }

  return (
    <main className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">My digital card</h1>
        <p className="mt-1 text-sm text-muted">
          Choose exactly which details are public, then share one revocable
          link.
        </p>
      </div>

      {card?.admin_disabled_at ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          An administrator disabled this card. Saving changes will not republish
          it.
        </p>
      ) : null}

      <form
        className="grid gap-4 rounded-lg border border-sand bg-white/70 p-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            () =>
              save.mutateAsync({
                slug,
                templateId: templateId || null,
                displayName,
                jobTitle: optional(jobTitle),
                workEmail: optional(workEmail),
                phone: optional(phone),
                website: optional(website),
                location: optional(location),
                bio: optional(bio),
                photoUrl: optional(photoUrl),
                linkedinUrl: optional(linkedinUrl),
                publicFields,
                isActive,
              }),
            "Card saved",
          );
        }}
      >
        <Field label="Public link name">
          <input
            required
            minLength={3}
            maxLength={80}
            pattern="[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            className="input"
          />
        </Field>
        <Field label="Card design">
          <select
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
            className="input"
          >
            <option value="">Standard</option>
            {templates.map((template) => (
              <option
                key={template.digital_card_template_id}
                value={template.digital_card_template_id}
              >
                {template.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name">
          <input
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="input"
          />
        </Field>
        <Field label="Job title">
          <input
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
            className="input"
          />
        </Field>
        <Field label="Work email">
          <input
            type="email"
            value={workEmail}
            onChange={(event) => setWorkEmail(event.target.value)}
            className="input"
          />
        </Field>
        <Field label="Phone">
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="input"
          />
        </Field>
        <Field label="Website (HTTPS)">
          <input
            type="url"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            className="input"
          />
        </Field>
        <Field label="Location">
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            className="input"
          />
        </Field>
        <Field label="Photo URL (HTTPS)">
          <input
            type="url"
            value={photoUrl}
            onChange={(event) => setPhotoUrl(event.target.value)}
            className="input"
          />
        </Field>
        <Field label="LinkedIn URL (HTTPS)">
          <input
            type="url"
            value={linkedinUrl}
            onChange={(event) => setLinkedinUrl(event.target.value)}
            className="input"
          />
        </Field>
        <label className="text-sm md:col-span-2">
          Bio
          <textarea
            maxLength={500}
            rows={3}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            className="input mt-1"
          />
        </label>

        <fieldset className="md:col-span-2">
          <legend className="text-sm font-medium">Public details</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {DIGITAL_CARD_PUBLIC_FIELDS.map((field) => (
              <label key={field} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={publicFields.includes(field)}
                  onChange={() => togglePublicField(field)}
                />
                {FIELD_LABELS[field]}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          Publish this card
        </label>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button type="submit" disabled={save.isPending}>
            Save card
          </Button>
          {card?.employee_digital_card_id ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => void shareCard()}
            >
              Share link
            </Button>
          ) : null}
          {card?.employee_digital_card_id ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                void run(() => revoke.mutateAsync(), "Card revoked")
              }
            >
              Revoke now
            </Button>
          ) : null}
        </div>
      </form>

      {isAdmin ? (
        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-lg border border-sand bg-white/70 p-4">
            <h2 className="font-semibold">Card designs</h2>
            <form
              className="mt-3 grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  () =>
                    upsertTemplate.mutateAsync({
                      name: templateName,
                      companyName,
                      accentColor,
                      isActive: true,
                      isDefault: false,
                    }),
                  "Design created",
                );
              }}
            >
              <input
                aria-label="Design name"
                className="input"
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                required
              />
              <input
                aria-label="Company name"
                className="input"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                required
              />
              <input
                aria-label="Accent color"
                type="color"
                className="h-10 w-full"
                value={accentColor}
                onChange={(event) => setAccentColor(event.target.value)}
              />
              <Button type="submit">Create design</Button>
            </form>
            <ul className="mt-4 space-y-2 text-sm">
              {allTemplates.map((template) => (
                <li
                  key={template.digital_card_template_id}
                  className="flex items-center justify-between border-t border-sand/70 pt-2"
                >
                  <span>
                    {template.name}
                    {template.is_default ? " · default" : ""}
                  </span>
                  <button
                    type="button"
                    className="underline"
                    onClick={() =>
                      void run(
                        () =>
                          setTemplateActive.mutateAsync({
                            templateId: template.digital_card_template_id,
                            active: !template.is_active,
                          }),
                        "Design updated",
                      )
                    }
                  >
                    {template.is_active ? "Disable" : "Enable"}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-sand bg-white/70 p-4">
            <h2 className="font-semibold">Employee cards</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {cards.map((employeeCard) => {
                const active =
                  employeeCard.is_active && !employeeCard.admin_disabled_at;
                return (
                  <li
                    key={employeeCard.employee_digital_card_id}
                    className="flex items-center justify-between border-t border-sand/70 pt-2"
                  >
                    <span>
                      {employeeCard.employee_name}
                      <br />
                      <small className="text-muted">/{employeeCard.slug}</small>
                    </span>
                    <button
                      type="button"
                      className="underline"
                      onClick={() =>
                        void run(
                          () =>
                            setCardActive.mutateAsync({
                              cardId: employeeCard.employee_digital_card_id,
                              active: !active,
                            }),
                          "Card access updated",
                        )
                      }
                    >
                      {active ? "Disable" : "Enable"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : null}

      {message ? (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      ) : null}
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-sm">
      {label}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}
