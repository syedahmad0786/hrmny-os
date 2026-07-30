export * from "./types";
export * from "./registry";
export * from "./transition";
export * from "./bootstrap";
export { demoConfirmGate } from "./gates/demo-confirm";
export {
  DEAL_TRANSITIONS,
  DEAL_OVERRIDABLE_GATES,
  MARGIN_FLOOR_PCT,
  MARGIN_TARGET_PCT,
  VENDOR_FEE_DEFAULT_PCT,
  NO_GO_SECTORS,
  scoreBuaf,
  discountAuthorityTier,
  computeQuoteMetrics,
  dealLegalTransitionGate,
  dealBuafGate,
  dealVerifiedEmailGate,
  dealVoiceGate,
  dealMarginFloorGate,
  dealDiscountAuthorityGate,
  dealVendorFeeGate,
  dealWonBeforeHandoverGate,
  type BuafInput,
  type BuafTemperature,
  type QuoteLineInput,
} from "./gates/deal";
export {
  INVOICE_TRANSITIONS,
  invoiceLegalTransitionGate,
  invoiceTrnHoldGate,
  invoiceApproveBeforeIssueGate,
} from "./gates/invoice";
export {
  EMPLOYEE_LIFECYCLE_PHASES,
  EMPLOYEE_TRANSITIONS,
  PHASE_GATE_REQUIREMENTS,
  employeeLegalTransitionGate,
  employeePhaseChecklistGate,
  type EmployeeLifecyclePhase,
} from "./gates/employee";
export {
  PAYROLL_TRANSITIONS,
  payrollLegalTransitionGate,
  payrollSodGate,
} from "./gates/payroll";
export {
  VAT_TRANSITIONS,
  vatLegalTransitionGate,
  vatUnreadDocsGate,
} from "./gates/vat";
export {
  TASK_STATUSES,
  TASK_TRANSITIONS,
  CLIENT_FACING_STATES,
  taskLegalTransitionGate,
  taskQcGate,
  taskDorStartGate,
  taskRevisionBoundaryGate,
  type TaskStatus,
} from "./gates/task";
export {
  DOR_REQUIRED_FIELDS,
  validateDor,
  dorLockBlockedReason,
  type DorField,
  type DorValidation,
} from "./gates/brief";
export {
  T48_HOURS,
  T24_HOURS,
  evaluateShootLock,
  calendarT48ShootLockGate,
  calendarLegalTransitionGate,
  type ShootLockStatus,
} from "./gates/calendar";
export {
  OUTREACH_TRANSITIONS,
  CAMPAIGN_TRANSITIONS,
  PORTAL_ITEM_TRANSITIONS,
  outreachLegalTransitionGate,
  outreachApproveBeforeSendGate,
  campaignLegalTransitionGate,
  campaignApproveBeforePublishGate,
  portalItemLegalTransitionGate,
  portalItemClientApproverGate,
} from "./gates/marketing";
