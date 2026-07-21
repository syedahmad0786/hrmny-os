import { z } from "zod";

export const TransitionRequestSchema = z.object({
  to: z.string().min(1),
  from: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
  overrideReason: z.string().nullable().optional(),
});

export type TransitionRequest = z.infer<typeof TransitionRequestSchema>;

export type GateBlock = {
  gate: string;
  reason: string;
};

export type TransitionResult =
  | { ok: true; newState: string; auditId: string }
  | {
      ok: false;
      code: "GATE_BLOCKED" | "OVERRIDE_REQUIRED";
      blockedBy?: GateBlock[];
      /** MASTER §12.1 — blocked attempts are audited (actor + attempted from/to). */
      auditId?: string;
    };

export type ActorContext = {
  employeeId: string;
  roles: string[];
  permissions: string[];
};

export type EntitySnapshot = {
  entityType: string;
  entityId: string;
  state: string;
  data: Record<string, unknown>;
};

export type AuditWriter = (event: {
  actorEmployeeId: string;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason?: string | null;
}) => Promise<{ auditId: string }>;

export type EmitHook = (event: {
  name: string;
  payload: Record<string, unknown>;
}) => Promise<void>;

export type GateFn = (ctx: {
  actor: ActorContext;
  entity: EntitySnapshot;
  request: TransitionRequest;
}) => Promise<GateBlock | null>;

export type ApplyFn = (ctx: {
  entity: EntitySnapshot;
  request: TransitionRequest;
}) => Promise<EntitySnapshot>;
