"use client";

import { Button } from "@hrmny/ui";
import Link from "next/link";
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";

type Scope = "global" | "client" | "role" | "user";

const SOURCE_LABELS = {
  native: "hrmny",
  bayzat: "Bayzat",
  asana: "Asana",
  integration: "Integration",
} as const;

export default function FeatureLabPage() {
  const utils = trpc.useUtils();
  const list = trpc.admin.features.list.useQuery();
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [availability, setAvailability] = useState("all");
  const [scope, setScope] = useState<Scope>("global");
  const [scopeKey, setScopeKey] = useState("global");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const selectedResolution = trpc.admin.features.resolve.useQuery(
    { scopeType: scope, scopeKey },
    { enabled: Boolean(scopeKey) },
  );

  const refresh = async () => {
    await Promise.all([
      utils.admin.features.list.invalidate(),
      utils.admin.features.resolve.invalidate(),
      utils.auth.session.invalidate(),
    ]);
  };
  const setOverride = trpc.admin.features.setOverride.useMutation({
    onSettled: async () => {
      setPendingKey(null);
      await refresh();
    },
  });
  const removeOverride = trpc.admin.features.removeOverride.useMutation({
    onSettled: async () => {
      setPendingKey(null);
      await refresh();
    },
  });

  const targetOptions = useMemo(() => {
    if (!list.data || scope === "global") {
      return [{ key: "global", label: "Everyone" }];
    }
    return scope === "client"
      ? list.data.targets.clients
      : scope === "role"
        ? list.data.targets.roles
        : list.data.targets.users;
  }, [list.data, scope]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (list.data?.catalog ?? []).filter(
      (item) =>
        (source === "all" || item.source === source) &&
        (availability === "all" || item.availability === availability) &&
        (!query ||
          `${item.name} ${item.description} ${item.key} ${item.group}`
            .toLowerCase()
            .includes(query)),
    );
  }, [availability, list.data?.catalog, search, source]);

  const groups = useMemo(
    () =>
      [...new Set(filtered.map((item) => item.group))].sort().map((group) => ({
        group,
        items: filtered.filter((item) => item.group === group),
      })),
    [filtered],
  );

  function selectScope(next: Scope) {
    setScope(next);
    if (next === "global") {
      setScopeKey("global");
      return;
    }
    const options =
      next === "client"
        ? list.data?.targets.clients
        : next === "role"
          ? list.data?.targets.roles
          : list.data?.targets.users;
    setScopeKey(options?.[0]?.key ?? "");
  }

  const error =
    setOverride.error ??
    removeOverride.error ??
    list.error ??
    selectedResolution.error;
  const retry = async () => {
    setOverride.reset();
    removeOverride.reset();
    await Promise.all([list.refetch(), selectedResolution.refetch()]);
  };
  const viewerEnabled = new Set(
    list.data?.resolvedForViewer
      .filter((item) => item.enabled)
      .map((item) => item.key) ?? [],
  );
  const targetEnabled = new Set(
    selectedResolution.data
      ?.filter((item) => item.enabled)
      .map((item) => item.key) ?? [],
  );

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ochre">
            Admin · Feature Lab
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold">
            Shape each client&apos;s portal
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            Every registered capability appears here automatically. Global and
            client switches are hard boundaries; roles and individual users can
            refine access inside those boundaries.
          </p>
        </div>
        <nav
          className="flex flex-wrap gap-2 text-sm"
          aria-label="Admin settings"
        >
          <Link
            className="rounded-full bg-ink px-4 py-2 text-white"
            href="/admin/features"
          >
            Feature Lab
          </Link>
          <Link
            className="rounded-full border border-sand bg-white px-4 py-2"
            href="/admin/work"
          >
            Work admin
          </Link>
          <Link
            className="rounded-full border border-sand bg-white px-4 py-2"
            href="/settings/connections"
          >
            Connections
          </Link>
          <Link
            className="rounded-full border border-sand bg-white px-4 py-2"
            href="/dashboards"
          >
            Dashboards
          </Link>
          <Link
            className="rounded-full border border-sand bg-white px-4 py-2"
            href="/requests"
          >
            Requests
          </Link>
          <Link
            className="rounded-full border border-sand bg-white px-4 py-2"
            href="/approvals"
          >
            Approvals
          </Link>
          <Link
            className="rounded-full border border-sand bg-white px-4 py-2"
            href="/roles"
          >
            Roles
          </Link>
          <Link
            className="rounded-full border border-sand bg-white px-4 py-2"
            href="/settings/ai"
          >
            AI
          </Link>
          <Link
            className="rounded-full border border-sand bg-white px-4 py-2"
            href="/conventions"
          >
            Conventions
          </Link>
          <Link
            className="rounded-full border border-sand bg-white px-4 py-2"
            href="/admin/audit"
          >
            Audit
          </Link>
        </nav>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Registered", list.data?.catalog.length ?? 0],
          [
            "Available now",
            list.data?.catalog.filter((item) => item.availability !== "planned")
              .length ?? 0,
          ],
          [
            "Asana mapped",
            list.data?.catalog.filter((item) => item.source === "asana")
              .length ?? 0,
          ],
          ["On for you", viewerEnabled.size],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border border-sand bg-white/75 p-4"
          >
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
              {label}
            </p>
            <p className="mt-2 font-display text-3xl font-semibold">{value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-sand bg-white/75 p-4">
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
              Control level
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["global", "client", "role", "user"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`rounded-full px-4 py-2 text-sm capitalize ${scope === item ? "bg-ink text-white" : "border border-sand bg-white"}`}
                  onClick={() => selectScope(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <label className="text-sm">
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-muted">
              Applies to
            </span>
            <select
              className="mt-2 w-full rounded-lg border border-sand bg-white px-3 py-2"
              value={scopeKey}
              onChange={(event) => setScopeKey(event.target.value)}
              disabled={scope === "global"}
            >
              {targetOptions.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="grid gap-3 rounded-xl border border-sand bg-white/60 p-4 md:grid-cols-3">
        <input
          className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
          type="search"
          placeholder="Search features"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Feature source"
          className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
          value={source}
          onChange={(event) => setSource(event.target.value)}
        >
          <option value="all">All sources</option>
          <option value="native">hrmny native</option>
          <option value="bayzat">Bayzat</option>
          <option value="asana">Asana</option>
          <option value="integration">Integrations</option>
        </select>
        <select
          aria-label="Feature availability"
          className="rounded-lg border border-sand bg-white px-3 py-2 text-sm"
          value={availability}
          onChange={(event) => setAvailability(event.target.value)}
        >
          <option value="all">All delivery states</option>
          <option value="available">Available</option>
          <option value="beta">Beta</option>
          <option value="planned">Planned</option>
        </select>
      </section>

      {error ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p>{error.message}</p>
          <Button
            className="mt-2"
            type="button"
            variant="ghost"
            onClick={() => void retry()}
          >
            Retry
          </Button>
        </section>
      ) : null}

      {list.isLoading ? (
        <p className="text-sm text-muted">Loading feature catalogue…</p>
      ) : groups.length === 0 ? (
        <p className="rounded-lg border border-sand bg-white/75 p-4 text-sm text-muted">
          No features match these filters.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(({ group, items }) => (
            <section key={group}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-display text-xl font-semibold">{group}</h2>
                <span className="text-xs text-muted">
                  {items.length} features
                </span>
              </div>
              <div className="overflow-hidden rounded-xl border border-sand bg-white/75">
                {items.map((item) => {
                  const explicit = list.data?.overrides.find(
                    (override) =>
                      override.featureKey === item.key &&
                      override.scopeType === scope &&
                      override.scopeKey === scopeKey,
                  );
                  const inherited = targetEnabled.has(item.key);
                  const checked = explicit?.enabled ?? inherited;
                  const locked =
                    item.protected ||
                    item.availability === "planned" ||
                    !scopeKey;
                  return (
                    <div
                      key={item.key}
                      className="grid gap-3 border-b border-sand/70 p-4 last:border-b-0 md:grid-cols-[1fr_auto] md:items-center"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium">{item.name}</h3>
                          <span className="rounded-full bg-sand/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]">
                            {SOURCE_LABELS[item.source]}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${item.availability === "planned" ? "bg-zinc-100 text-zinc-500" : item.availability === "beta" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}
                          >
                            {item.availability}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted">
                          {item.description}
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-muted">
                          {item.key}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 md:justify-end">
                        <span className="min-w-16 text-right text-xs text-muted">
                          {item.protected
                            ? "Essential"
                            : item.availability === "planned"
                              ? "Not built"
                              : explicit
                                ? "Override"
                                : "Inherited"}
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={checked}
                          aria-label={`${checked ? "Disable" : "Enable"} ${item.name}`}
                          disabled={locked || pendingKey === item.key}
                          className={`relative h-7 w-12 rounded-full transition ${checked ? "bg-ochre" : "bg-zinc-300"} disabled:cursor-not-allowed disabled:opacity-45`}
                          onClick={() => {
                            setPendingKey(item.key);
                            setOverride.mutate({
                              featureKey: item.key,
                              scopeType: scope,
                              scopeKey,
                              enabled: !checked,
                              reason: "Feature Lab toggle",
                            });
                          }}
                        >
                          <span
                            className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-6" : "left-1"}`}
                          />
                        </button>
                        {explicit ? (
                          <button
                            type="button"
                            className="text-xs font-medium text-ochre underline"
                            disabled={pendingKey === item.key}
                            onClick={() => {
                              setPendingKey(item.key);
                              removeOverride.mutate({
                                featureKey: item.key,
                                scopeType: scope,
                                scopeKey,
                              });
                            }}
                          >
                            Inherit
                          </button>
                        ) : (
                          <span className="w-11" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
