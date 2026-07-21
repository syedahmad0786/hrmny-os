import Link from "next/link";
import type { CSSProperties } from "react";
import { M1_ITEMS, MILESTONES, m1Score } from "@/lib/m1-status";

const STATE_STYLE: Record<string, { bg: string; label: string }> = {
  done: { bg: "#d8f3e3", label: "Done" },
  partial: { bg: "#ffe6c2", label: "Partial" },
  blocked: { bg: "#ffd0cb", label: "Blocked" },
  todo: { bg: "#e8e0d4", label: "Todo" },
};

export default function TeamDeskPage() {
  const m1 = m1Score();

  return (
    <div style={{ position: "relative", zIndex: 1 }}>
      <header
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: "28px 24px 0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: 22,
              letterSpacing: "-0.03em",
            }}
          >
            hrmny <span style={{ color: "var(--ochre)" }}>OS</span>
          </p>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
            Team desk · Creative Harmony
          </p>
          <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 12 }}>
            Live:{" "}
            <a href="https://hrmny-os-desk-hrmnyco.vercel.app" style={{ color: "var(--ochre)" }}>
              hrmny-os-desk-hrmnyco.vercel.app
            </a>
            {" · "}
            <Link href="/crm" style={{ color: "var(--ochre)" }}>
              Open CRM redesign
            </Link>
          </p>
        </div>
        <nav style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/crm" style={navChip}>
            CRM
          </Link>
          <Link href="/#m1" style={navChip}>
            M1 progress
          </Link>
          <Link href="/#roadmap" style={navChip}>
            90-day map
          </Link>
          <Link
            href="/portal"
            style={{
              ...navChip,
              background: "var(--ink)",
              color: "var(--paper)",
              border: "none",
            }}
          >
            Client portal →
          </Link>
        </nav>
      </header>

      <main style={{ maxWidth: 1120, margin: "0 auto", padding: "40px 24px 80px" }}>
        {/* Hero — one composition */}
        <section
          className="scene"
          style={{
            display: "grid",
            gridTemplateColumns: "1.15fr 0.85fr",
            gap: 28,
            alignItems: "stretch",
            minHeight: "min(72vh, 640px)",
          }}
        >
          <div style={{ paddingTop: 24 }}>
            <p
              style={{
                margin: 0,
                textTransform: "uppercase",
                letterSpacing: "0.28em",
                fontSize: 11,
                color: "var(--ochre)",
                fontFamily: "var(--font-display)",
              }}
            >
              Payment spine · Sprint 1
            </p>
            <h1
              style={{
                margin: "14px 0 0",
                fontFamily: "var(--font-display)",
                fontSize: "clamp(40px, 6vw, 64px)",
                lineHeight: 1.02,
                letterSpacing: "-0.04em",
                maxWidth: 560,
              }}
            >
              hrmny
              <br />
              <span style={{ color: "var(--ochre)" }}>build desk</span>
            </h1>
            <p
              style={{
                margin: "18px 0 0",
                maxWidth: 460,
                fontSize: 17,
                lineHeight: 1.55,
                color: "var(--muted)",
              }}
            >
              See where Milestone 1 ($1,500) stands — and what still blocks a
              partner-ready demo.
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
              <Link href="/crm" style={primaryBtn}>
                Open CRM
              </Link>
              <a href="#m1" style={ghostBtn}>
                Open M1 checklist
              </a>
              <Link href="/portal" style={ghostBtn}>
                Preview portal
              </Link>
            </div>
          </div>

          <div className="scene" style={{ display: "flex", alignItems: "center" }}>
            <div
              className="panel-3d float"
              style={{
                width: "100%",
                borderRadius: 28,
                padding: 28,
                background:
                  "linear-gradient(145deg, rgba(10,9,8,0.94), rgba(28,22,16,0.92))",
                color: "var(--paper)",
                boxShadow:
                  "0 40px 80px rgba(10,9,8,0.28), inset 0 1px 0 rgba(255,255,255,0.08)",
                border: "1px solid rgba(228,115,0,0.25)",
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "rgba(232,224,212,0.65)",
                }}
              >
                M1 readiness
              </p>
              <p
                style={{
                  margin: "10px 0 0",
                  fontFamily: "var(--font-display)",
                  fontSize: 64,
                  lineHeight: 1,
                  color: "var(--ochre)",
                }}
              >
                {m1.percent}%
              </p>
              <p style={{ margin: "10px 0 0", color: "rgba(247,244,239,0.75)", fontSize: 14 }}>
                {m1.done} done · {m1.partial} partial · {m1.todo} open
              </p>
              <div
                style={{
                  marginTop: 22,
                  height: 8,
                  borderRadius: 99,
                  background: "rgba(255,255,255,0.08)",
                  overflow: "hidden",
                }}
              >
                <div
                  className="pulse-bar"
                  style={{
                    width: `${m1.percent}%`,
                    height: "100%",
                    borderRadius: 99,
                    background: "linear-gradient(90deg, #c45f00, #e47300, #ffb35c)",
                  }}
                />
              </div>
              <p
                style={{
                  margin: "20px 0 0",
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "rgba(247,244,239,0.7)",
                }}
              >
                {m1.verdict}
              </p>
              <p
                style={{
                  margin: "16px 0 0",
                  display: "inline-block",
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: "rgba(228,115,0,0.15)",
                  color: "#ffb35c",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Payment gate: not claimed yet
              </p>
            </div>
          </div>
        </section>

        {/* Live infra */}
        <section style={{ marginTop: 56 }}>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontFamily: "var(--font-display)",
            }}
          >
            Connections
          </p>
          <div
            style={{
              marginTop: 12,
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            {[
              { name: "Postgres", status: "live" },
              { name: "Supabase", status: "live" },
              { name: "Vercel", status: "live" },
              { name: "Composio", status: "live" },
              { name: "Gmail", status: "live" },
              { name: "Xero", status: "tomorrow" },
              { name: "Apollo", status: "tomorrow" },
              { name: "Hunter", status: "tomorrow" },
            ].map((c) => (
              <span
                key={c.name}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 600,
                  background:
                    c.status === "live"
                      ? "rgba(216, 243, 227, 0.85)"
                      : "rgba(232, 224, 212, 0.9)",
                  border: "1px solid var(--glass-border)",
                  color: "var(--ink)",
                }}
              >
                {c.name}
                <span
                  style={{
                    marginLeft: 6,
                    color: "var(--muted)",
                    fontWeight: 500,
                  }}
                >
                  · {c.status}
                </span>
              </span>
            ))}
          </div>
        </section>

        {/* M1 checklist */}
        <section id="m1" style={{ marginTop: 72 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: 32,
              letterSpacing: "-0.03em",
            }}
          >
            Milestone 1 · Substrate
          </h2>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", maxWidth: 560 }}>
            SOW acceptance: gate + audit, role deny margin, DAM upload, health →
            Chat. Below is honest engineering status — not marketing.
          </p>
          <div
            style={{
              marginTop: 28,
              display: "grid",
              gap: 12,
            }}
          >
            {M1_ITEMS.map((item) => {
              const s = STATE_STYLE[item.state];
              return (
                <div
                  key={item.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 1fr",
                    gap: 16,
                    alignItems: "start",
                    padding: "16px 18px",
                    borderRadius: 16,
                    background: "var(--glass)",
                    border: "1px solid var(--glass-border)",
                    backdropFilter: "blur(10px)",
                  }}
                >
                  <span
                    style={{
                      justifySelf: "start",
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: s.bg,
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {s.label}
                  </span>
                  <div>
                    <p style={{ margin: 0, fontWeight: 600 }}>{item.label}</p>
                    <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
                      {item.note}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 90-day map */}
        <section id="roadmap" style={{ marginTop: 72 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: 32,
              letterSpacing: "-0.03em",
            }}
          >
            90-day payment map
          </h2>
          <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
            Six × $1,500 after deposit. Demo scaffolds exist; live keys unlock the
            rest.
          </p>
          <div
            style={{
              marginTop: 28,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 14,
            }}
          >
            {MILESTONES.map((m) => (
              <Link
                key={m.id}
                href={m.href}
                style={{
                  display: "block",
                  padding: 20,
                  borderRadius: 18,
                  background: "rgba(255,255,255,0.62)",
                  border: "1px solid var(--glass-border)",
                  boxShadow: "0 10px 30px rgba(10,9,8,0.04)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      color: "var(--ochre)",
                      fontSize: 13,
                      letterSpacing: "0.12em",
                    }}
                  >
                    {m.id}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{m.fee}</span>
                </div>
                <p
                  style={{
                    margin: "10px 0 0",
                    fontFamily: "var(--font-display)",
                    fontSize: 22,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {m.title}
                </p>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
                  {m.blurb}
                </p>
                <div
                  style={{
                    marginTop: 16,
                    height: 5,
                    borderRadius: 99,
                    background: "var(--sand)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${m.progress}%`,
                      height: "100%",
                      background: "var(--ochre)",
                      borderRadius: 99,
                    }}
                  />
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section style={{ marginTop: 72 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: 28,
              letterSpacing: "-0.03em",
            }}
          >
            Where we go next
          </h2>
          <ol
            style={{
              margin: "16px 0 0",
              paddingLeft: 20,
              color: "var(--ink)",
              lineHeight: 1.8,
              maxWidth: 640,
            }}
          >
            <li>Finish M1 partner demo script on this desk (SSO or accepted dev personas).</li>
            <li>Wire DAM to Supabase Storage; Google Chat webhook for health.</li>
            <li>Tomorrow: Xero + Apollo + Hunter → flip live modes for M2/M3.</li>
            <li>Keep LinkedIn as copy-draft only (no OAuth — ban risk).</li>
            <li>Deep-link this desk into the full `apps/web` monorepo APIs.</li>
          </ol>
        </section>
      </main>

      <style>{`
        @media (max-width: 860px) {
          main section.scene,
          main > section:first-of-type {
            grid-template-columns: 1fr !important;
            min-height: auto !important;
          }
          .panel-3d { transform: none !important; }
        }
      `}</style>
    </div>
  );
}

const navChip: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 999,
  border: "1px solid var(--glass-border)",
  background: "rgba(255,255,255,0.55)",
  fontSize: 13,
  fontWeight: 500,
};

const primaryBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "12px 18px",
  borderRadius: 12,
  background: "var(--ochre)",
  color: "#fff",
  fontWeight: 600,
  fontSize: 14,
};

const ghostBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "12px 18px",
  borderRadius: 12,
  border: "1px solid var(--glass-border)",
  background: "rgba(255,255,255,0.5)",
  fontWeight: 600,
  fontSize: 14,
};
