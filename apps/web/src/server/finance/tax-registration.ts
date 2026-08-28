export type TaxRegistration = {
  trn: string | null;
  trnStatus: "known" | "unknown_held";
};

/**
 * Resolve the legal tax identifier from configuration without inventing one.
 * Missing configuration deliberately keeps the invoice behind its TRN gate.
 */
export function resolveTaxRegistration(): TaxRegistration {
  const trn = process.env.HRMNY_TAX_REGISTRATION_NUMBER?.trim();
  return trn
    ? { trn, trnStatus: "known" }
    : { trn: null, trnStatus: "unknown_held" };
}
