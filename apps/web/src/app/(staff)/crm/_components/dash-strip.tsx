"use client";

import { trpc } from "@/lib/trpc";
import { formatAed } from "@/components/crm/format";

function Metric({
  label,
  value,
  detail,
  pulse,
}: {
  label: string;
  value: string;
  detail?: string;
  pulse?: boolean;
}) {
  return (
    <div className={`crm-metric${pulse ? " animate-pulse" : ""}`}>
      <span className="crm-metric-label">{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

/** W10 dashboard strip: weighted pipeline, forecast, win/loss — AED, read-only. */
export function DashStrip({
  refetchInterval,
}: { refetchInterval?: number } = {}) {
  const pipeline = trpc.crmForecast.pipeline.useQuery(undefined, {
    refetchInterval,
  });
  const forecast = trpc.crmForecast.forecast.useQuery({}, { refetchInterval });
  const winLoss = trpc.crmForecast.winLoss.useQuery({}, { refetchInterval });

  const error = pipeline.error ?? forecast.error ?? winLoss.error;
  if (error) {
    return (
      <div className="crm-note mb-4" role="alert">
        Forecast unavailable: {error.message}
      </div>
    );
  }

  const loading = pipeline.isLoading || forecast.isLoading || winLoss.isLoading;
  if (loading || !pipeline.data || !forecast.data || !winLoss.data) {
    return (
      <div className="mb-4 grid gap-[11px] md:grid-cols-4">
        {["Weighted pipeline", "Forecast (90d)", "Won (90d)", "Win rate"].map(
          (label) => (
            <Metric key={label} label={label} value="…" pulse />
          ),
        )}
      </div>
    );
  }

  const p = pipeline.data;
  const f = forecast.data;
  const w = winLoss.data;
  const activeStages = p.stages.filter((s) => s.count > 0);
  const maxWeighted = Math.max(...activeStages.map((s) => s.weightedValue), 1);
  const topLost = w.topLostReasons[0];

  return (
    <div className="mb-4">
      <div className="grid gap-[11px] md:grid-cols-4">
        <Metric
          label="Weighted pipeline"
          value={formatAed(p.totals.weightedValue)}
          detail={`${p.totals.count} open · ${formatAed(p.totals.totalValue)} unweighted`}
        />
        <Metric
          label={`Forecast (${f.horizonDays}d)`}
          value={formatAed(f.runRateProjection)}
          detail={`Run rate ${formatAed(f.runRatePerDay)} / day`}
        />
        <Metric
          label={`Won (${f.horizonDays}d)`}
          value={formatAed(f.wonInWindow.value)}
          detail={`${f.wonInWindow.count} deal${f.wonInWindow.count === 1 ? "" : "s"} closed won`}
        />
        <Metric
          label={`Win rate (${w.sinceDays}d)`}
          value={`${Math.round(w.winRate * 100)}%`}
          detail={
            w.won + w.lost === 0
              ? "No closed deals in window"
              : `${w.won} won · ${w.lost} lost${topLost ? ` · top loss: ${topLost.reason}` : ""}`
          }
        />
      </div>

      <div className="crm-metric mt-[11px]" style={{ minHeight: 0 }}>
        <span className="crm-metric-label">Weighted pipeline by stage</span>
        {activeStages.length === 0 ? (
          <p className="mt-3 text-[11px] text-[var(--muted)]">
            No open deals yet — create a deal to start building pipeline.
          </p>
        ) : (
          <div className="mt-3 grid gap-2">
            {activeStages.map((s) => (
              <div
                key={s.stage}
                className="flex items-center gap-3 text-[11px]"
              >
                <span className="w-28 shrink-0 capitalize text-[var(--muted)]">
                  {s.stage.replace(/_/g, " ")}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded bg-[var(--paper-2)]">
                  <span
                    className="block h-full rounded"
                    style={{
                      width: `${Math.max((s.weightedValue / maxWeighted) * 100, 2)}%`,
                      background: "rgba(228, 115, 0, 0.75)",
                    }}
                  />
                </span>
                <span className="w-36 shrink-0 text-right">
                  {formatAed(s.weightedValue)}
                  <span className="text-[var(--muted)]"> · {s.count}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
