export const DIGITAL_CARD_ADMIN_ROLES = ["partner", "director", "hr"] as const;

export const DIGITAL_CARD_PUBLIC_FIELDS = [
  "displayName",
  "jobTitle",
  "workEmail",
  "phone",
  "website",
  "location",
  "bio",
  "photoUrl",
  "linkedinUrl",
] as const;

export type DigitalCardPublicField =
  (typeof DIGITAL_CARD_PUBLIC_FIELDS)[number];

export function isDigitalCardAdmin(roles: readonly string[]): boolean {
  return roles.some((role) =>
    DIGITAL_CARD_ADMIN_ROLES.some((adminRole) => adminRole === role),
  );
}

export function normalizeCardSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("INVALID_CARD_SLUG");
  }
  return slug;
}

export type DigitalCardRow = {
  slug: string;
  display_name: string | null;
  job_title: string | null;
  work_email: string | null;
  phone: string | null;
  website: string | null;
  location: string | null;
  bio: string | null;
  photo_url: string | null;
  linkedin_url: string | null;
  public_fields: string[];
  is_active: boolean;
  revoked_at: Date | string | null;
  admin_disabled_at: Date | string | null;
  company_name: string | null;
  accent_color: string | null;
  logo_url: string | null;
};

export type PublicDigitalCard = {
  slug: string;
  companyName: string;
  accentColor: string;
  logoUrl?: string;
} & Partial<Record<DigitalCardPublicField, string>>;

const FIELD_COLUMNS: Record<DigitalCardPublicField, keyof DigitalCardRow> = {
  displayName: "display_name",
  jobTitle: "job_title",
  workEmail: "work_email",
  phone: "phone",
  website: "website",
  location: "location",
  bio: "bio",
  photoUrl: "photo_url",
  linkedinUrl: "linkedin_url",
};

export function toPublicDigitalCard(
  row: DigitalCardRow,
): PublicDigitalCard | null {
  if (!row.is_active || row.revoked_at || row.admin_disabled_at) return null;
  const allowed = new Set(row.public_fields);
  const card: PublicDigitalCard = {
    slug: row.slug,
    companyName: row.company_name ?? "Creative Harmony",
    accentColor: row.accent_color ?? "#C7702E",
    ...(row.logo_url ? { logoUrl: row.logo_url } : {}),
  };
  for (const field of DIGITAL_CARD_PUBLIC_FIELDS) {
    const value = row[FIELD_COLUMNS[field]];
    if (allowed.has(field) && typeof value === "string" && value.trim()) {
      card[field] = value.trim();
    }
  }
  return card;
}
