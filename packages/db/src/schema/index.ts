export * from "./enums";
export * from "./tables";

/**
 * 19. v_client_margin — SQL view (not a Drizzle table).
 * Materialized in migrations as:
 *   CREATE VIEW v_client_margin AS SELECT ...
 * App role must never expose margin columns to AM / portal.
 */
export const V_CLIENT_MARGIN = "v_client_margin" as const;
