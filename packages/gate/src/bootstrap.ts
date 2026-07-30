import { registerGates } from "./registry";
import {
  dealBuafGate,
  dealDiscountAuthorityGate,
  dealLegalTransitionGate,
  dealMarginFloorGate,
  dealVendorFeeGate,
  dealVerifiedEmailGate,
  dealVoiceGate,
  dealWonBeforeHandoverGate,
} from "./gates/deal";
import { demoConfirmGate } from "./gates/demo-confirm";
import {
  employeeLegalTransitionGate,
  employeePhaseChecklistGate,
} from "./gates/employee";
import {
  invoiceApproveBeforeIssueGate,
  invoiceLegalTransitionGate,
  invoiceTrnHoldGate,
} from "./gates/invoice";
import { payrollLegalTransitionGate, payrollSodGate } from "./gates/payroll";
import { vatLegalTransitionGate, vatUnreadDocsGate } from "./gates/vat";
import {
  calendarLegalTransitionGate,
  calendarT48ShootLockGate,
} from "./gates/calendar";
import {
  taskDorStartGate,
  taskLegalTransitionGate,
  taskQcGate,
  taskRevisionBoundaryGate,
} from "./gates/task";
import {
  outreachLegalTransitionGate,
  outreachApproveBeforeSendGate,
  campaignLegalTransitionGate,
  campaignApproveBeforePublishGate,
  portalItemLegalTransitionGate,
  portalItemClientApproverGate,
} from "./gates/marketing";

/** Register entity gate sets. Call once at process start. */
export function bootstrapGateRegistry(): void {
  registerGates("demo", [demoConfirmGate]);
  registerGates("deal", [
    dealLegalTransitionGate,
    dealBuafGate,
    dealVerifiedEmailGate,
    dealVoiceGate,
    dealMarginFloorGate,
    dealDiscountAuthorityGate,
    dealVendorFeeGate,
    dealWonBeforeHandoverGate,
  ]);
  registerGates("invoice", [
    invoiceLegalTransitionGate,
    invoiceTrnHoldGate,
    invoiceApproveBeforeIssueGate,
  ]);
  registerGates("employee", [
    employeeLegalTransitionGate,
    employeePhaseChecklistGate,
  ]);
  registerGates("payroll_run", [payrollLegalTransitionGate, payrollSodGate]);
  registerGates("vat_period", [vatLegalTransitionGate, vatUnreadDocsGate]);
  registerGates("task", [
    taskLegalTransitionGate,
    taskDorStartGate,
    taskQcGate,
    taskRevisionBoundaryGate,
  ]);
  registerGates("calendar", [
    calendarLegalTransitionGate,
    calendarT48ShootLockGate,
  ]);
  registerGates("outreach", [
    outreachLegalTransitionGate,
    outreachApproveBeforeSendGate,
  ]);
  registerGates("campaign", [
    campaignLegalTransitionGate,
    campaignApproveBeforePublishGate,
  ]);
  registerGates("portal_item", [
    portalItemLegalTransitionGate,
    portalItemClientApproverGate,
  ]);
}
