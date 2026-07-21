-- View 19: v_client_margin (derived; no writes)
-- Apply after 0000 migration, before or with RLS.

CREATE OR REPLACE VIEW public.v_client_margin AS
SELECT
  c.client_id,
  c.name AS client_name,
  c.fee,
  c.contract_value,
  s.margin_at_sale_pct,
  d.margin_pct AS deal_margin_pct,
  d.internal_cost AS deal_internal_cost,
  d.quote_value AS deal_quote_value
FROM public.client c
LEFT JOIN public.deal d ON d.deal_id = c.deal_id
LEFT JOIN LATERAL (
  SELECT margin_at_sale_pct
  FROM public.scope
  WHERE client_id = c.client_id
  ORDER BY created_at DESC
  LIMIT 1
) s ON true;
