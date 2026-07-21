import type { GateFn } from "./types";

const registry = new Map<string, GateFn[]>();

export function registerGates(entityType: string, gates: GateFn[]): void {
  registry.set(entityType, gates);
}

export function getGates(entityType: string): GateFn[] {
  return registry.get(entityType) ?? [];
}

export function clearRegistry(): void {
  registry.clear();
}
