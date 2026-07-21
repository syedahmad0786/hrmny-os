import type { GateFn } from "../types";

/** Demo gate: blocks transition to `closed` unless payload.confirmed === true */
export const demoConfirmGate: GateFn = async ({ request }) => {
  if (request.to !== "closed") return null;
  if (request.payload?.confirmed === true) return null;
  return {
    gate: "demo.confirm",
    reason: "Transition to closed requires payload.confirmed=true",
  };
};
