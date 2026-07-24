import { describe, expect, it } from "vitest";
import {
  isDigitalCardAdmin,
  normalizeCardSlug,
  toPublicDigitalCard,
  type DigitalCardRow,
} from "./digital-cards";

const row: DigitalCardRow = {
  slug: "ayham-homsi",
  display_name: "Ayham Homsi",
  job_title: "Managing Director",
  work_email: "ayham@hrmny.co",
  phone: "+971500000000",
  website: "https://hrmny.co",
  location: "Dubai",
  bio: null,
  photo_url: null,
  linkedin_url: null,
  public_fields: ["displayName", "jobTitle"],
  is_active: true,
  revoked_at: null,
  admin_disabled_at: null,
  company_name: "Creative Harmony",
  accent_color: "#C7702E",
  logo_url: null,
};

describe("digital card privacy", () => {
  it("returns only fields the employee explicitly published", () => {
    expect(toPublicDigitalCard(row)).toEqual({
      slug: "ayham-homsi",
      companyName: "Creative Harmony",
      accentColor: "#C7702E",
      displayName: "Ayham Homsi",
      jobTitle: "Managing Director",
    });
  });

  it("fails closed for revoked cards and validates slugs/admin roles", () => {
    expect(toPublicDigitalCard({ ...row, revoked_at: new Date() })).toBeNull();
    expect(
      toPublicDigitalCard({ ...row, admin_disabled_at: new Date() }),
    ).toBeNull();
    expect(normalizeCardSlug(" Ayham-Homsi ")).toBe("ayham-homsi");
    expect(() => normalizeCardSlug("../ayham")).toThrow("INVALID_CARD_SLUG");
    expect(isDigitalCardAdmin(["hr"])).toBe(true);
    expect(isDigitalCardAdmin(["staff"])).toBe(false);
  });
});
