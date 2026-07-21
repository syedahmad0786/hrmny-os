import { DEAL_OVERRIDABLE_GATES } from "./gates/deal";
import { getGates } from "./registry";
import {
  TransitionRequestSchema,
  type ActorContext,
  type ApplyFn,
  type AuditWriter,
  type EmitHook,
  type EntitySnapshot,
  type GateBlock,
  type TransitionRequest,
  type TransitionResult,
} from "./types";

const OVERRIDABLE_GATES = DEAL_OVERRIDABLE_GATES;

export type TransitionDeps = {
  authorize: (actor: ActorContext, entity: EntitySnapshot, to: string) => Promise<boolean>;
  apply: ApplyFn;
  audit: AuditWriter;
  emit?: EmitHook;
};

async function auditBlocked(
  actor: ActorContext,
  entity: EntitySnapshot,
  request: TransitionRequest,
  code: "GATE_BLOCKED" | "OVERRIDE_REQUIRED",
  blockedBy: GateBlock[],
  deps: TransitionDeps,
): Promise<string> {
  const before = { ...entity.data, state: entity.state };
  const after = {
    attemptedTo: request.to,
    code,
    blockedBy,
  };
  const { auditId } = await deps.audit({
    actorEmployeeId: actor.employeeId,
    action: `${entity.entityType}.transition.blocked`,
    entityType: entity.entityType,
    entityId: entity.entityId,
    before,
    after,
    reason: request.overrideReason ?? blockedBy.map((b) => b.reason).join("; "),
  });
  if (deps.emit) {
    await deps.emit({
      name: `${entity.entityType}.transition_blocked`,
      payload: {
        entityId: entity.entityId,
        from: entity.state,
        to: request.to,
        code,
        auditId,
        blockedBy,
      },
    });
  }
  return auditId;
}

/**
 * Central gate engine pipeline:
 * authorize → validate → apply → audit → emit
 * Blocked / override-required attempts also write an audit row (MASTER §12.1).
 */
export async function transition(
  actor: ActorContext,
  entity: EntitySnapshot,
  rawRequest: TransitionRequest,
  deps: TransitionDeps,
): Promise<TransitionResult> {
  const request = TransitionRequestSchema.parse(rawRequest);

  const allowed = await deps.authorize(actor, entity, request.to);
  if (!allowed) {
    const blockedBy = [
      { gate: "authorize", reason: "Actor lacks permission for transition" },
    ];
    const auditId = await auditBlocked(
      actor,
      entity,
      request,
      "GATE_BLOCKED",
      blockedBy,
      deps,
    );
    return { ok: false, code: "GATE_BLOCKED", blockedBy, auditId };
  }

  if (request.from && request.from !== entity.state) {
    const blockedBy = [
      {
        gate: "validate",
        reason: `Expected state ${request.from}, found ${entity.state}`,
      },
    ];
    const auditId = await auditBlocked(
      actor,
      entity,
      request,
      "GATE_BLOCKED",
      blockedBy,
      deps,
    );
    return { ok: false, code: "GATE_BLOCKED", blockedBy, auditId };
  }

  const blockedBy: GateBlock[] = [];
  for (const gate of getGates(entity.entityType)) {
    const block = await gate({ actor, entity, request });
    if (block) blockedBy.push(block);
  }

  if (blockedBy.length > 0) {
    const allOverridable = blockedBy.every((b) => OVERRIDABLE_GATES.has(b.gate));
    const partnerOverride =
      allOverridable &&
      Boolean(request.overrideReason) &&
      actor.roles.includes("partner");
    if (partnerOverride) {
      // Partner override clears commercial soft-gates; hard gates never reach here.
    } else if (allOverridable) {
      const auditId = await auditBlocked(
        actor,
        entity,
        request,
        "OVERRIDE_REQUIRED",
        blockedBy,
        deps,
      );
      return { ok: false, code: "OVERRIDE_REQUIRED", blockedBy, auditId };
    } else {
      const auditId = await auditBlocked(
        actor,
        entity,
        request,
        "GATE_BLOCKED",
        blockedBy,
        deps,
      );
      return { ok: false, code: "GATE_BLOCKED", blockedBy, auditId };
    }
  }

  const before = { ...entity.data, state: entity.state };
  const next = await deps.apply({ entity, request });
  const after = { ...next.data, state: next.state };

  const { auditId } = await deps.audit({
    actorEmployeeId: actor.employeeId,
    action: `${entity.entityType}.transition`,
    entityType: entity.entityType,
    entityId: entity.entityId,
    before,
    after,
    reason: request.overrideReason ?? null,
  });

  if (deps.emit) {
    await deps.emit({
      name: `${entity.entityType}.transitioned`,
      payload: {
        entityId: entity.entityId,
        from: entity.state,
        to: next.state,
        auditId,
      },
    });
  }

  return { ok: true, newState: next.state, auditId };
}
