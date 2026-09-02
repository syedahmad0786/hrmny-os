/**
 * Reviewed upstream boundary for the HRMNY QM pilot.
 *
 * This is source authority only. It is not a deployment, provider, security,
 * recovery, or user-acceptance receipt.
 */
export const QM_UPSTREAM_PIN = Object.freeze({
  repository: "https://github.com/yc-software/qm",
  version: "v0.1.5",
  commit: "d931fe963de3ac20b9a7526ea9a4873c0d8ed18e",
  license: "MIT",
  audience: "authenticated-internal-users",
  maturity: "experimental",
} as const);

/**
 * Deliberate HRMNY overlay: QM executes work, while HRMNY remains the source
 * of identity, approval, operational state, and immutable effect receipts.
 */
export const HRMNY_QM_AUTHORITY_BOUNDARY = Object.freeze({
  identityAuthority: "hrmny",
  approvalAuthority: "hrmny",
  operationalAuthority: "hrmny-postgresql",
  executionWorkspace: "qm",
  externalClientAccess: false,
  directExternalEffects: false,
  rawProductionCredentials: false,
} as const);
