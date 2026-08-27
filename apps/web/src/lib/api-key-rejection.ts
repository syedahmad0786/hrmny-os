/** True when the provider said the key is bad — do not persist. */
export function isHardApiKeyRejection(reason: string): boolean {
  const t = reason.toLowerCase();
  return (
    t.includes("too short") ||
    t.includes("401") ||
    t.includes("403") ||
    t.includes("unauthorized") ||
    t.includes("invalid api") ||
    t.includes("invalid key") ||
    t.includes("api key is invalid") ||
    t.includes("forbidden")
  );
}
