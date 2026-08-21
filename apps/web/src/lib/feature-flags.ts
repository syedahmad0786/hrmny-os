/**
 * Runtime feature flags for the minimal daily OS cut.
 * Client components only see NEXT_PUBLIC_* — keep demo resets opt-in.
 */

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw =
    process.env[`NEXT_PUBLIC_${name}`] ??
    process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const v = raw.toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return defaultValue;
}

/** Show milestone demo reset buttons (default off). */
export function showDemoResets(): boolean {
  return envFlag("FEATURE_SHOW_DEMO_RESETS", false);
}

export function showBenefits(): boolean {
  return envFlag("FEATURE_SHOW_BENEFITS", false);
}

export function showWorkplace(): boolean {
  return envFlag("FEATURE_SHOW_WORKPLACE", false);
}

export function showDigitalCards(): boolean {
  return envFlag("FEATURE_SHOW_DIGITAL_CARDS", false);
}

export function showEss(): boolean {
  return envFlag("FEATURE_SHOW_ESS", false);
}

export function minimalHrEnabled(): boolean {
  return envFlag("FEATURE_MINIMAL_HR", true);
}
