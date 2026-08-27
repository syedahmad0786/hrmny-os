import type { ApiKeyToolkit } from "./resolve-keys";

/**
 * Process-local API keys for AUTH_MODE=dev / preview without DATABASE_URL.
 * Survives across tRPC calls in the same Node process. Does not survive a
 * Vercel cold start — production must use Vault.
 */
const keys = new Map<string, string>();

export function saveMemoryApiKey(toolkit: ApiKeyToolkit, apiKey: string): void {
  keys.set(toolkit, apiKey.trim());
}

export function getMemoryApiKey(toolkit: string): string | null {
  const value = keys.get(toolkit)?.trim();
  return value ? value : null;
}

export function clearMemoryApiKeys(): void {
  keys.clear();
}

export function hasMemoryApiKey(toolkit: string): boolean {
  return Boolean(getMemoryApiKey(toolkit));
}
