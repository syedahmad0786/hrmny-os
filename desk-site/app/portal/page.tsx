import Link from "next/link";
import type { CSSProperties } from "react";

export default function PortalPage() {
  return (
    <div style={{ position: "relative", zIndex: 1, minHeight: "100vh" }}>
      <header
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "28px 24px 0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: 20,
              letterSpacing: "-0.03em",
            }}
          >
            hrmny <span style={{ color: "var(--ochre)" }}>portal</span>
          </p>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
            Demo Co LLC · Active engagement
          </p>
        </div>
        <Link
          href="/"
          style={{
            fontSize: 13,
            color: "var(--muted)",
            padding: "8px 12px",
            borderRadius: 999,
            border: "1px solid var(--glass-border)",
            background: "rgba(255,255,255,0.5)",
          }}
        >
          ← Team desk
        </Link>
      </header>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px 80px" }}>
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 0.8fr",
            gap: 32,
            alignItems: "end",
            minHeight: "58vh",
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                textTransform: "uppercase",
                letterSpacing: "0.24em",
                fontSize: 11,
                color: "var(--ochre)",
                fontFamily: "var(--font-display)",
              }}
            >
              Client space
            </p>
            <h1
              style={{
                margin: "12px 0 0",
                fontFamily: "var(--font-display)",
                fontSize: "clamp(36px, 5vw, 52px)",
                letterSpacing: "-0.04em",
                lineHeight: 1.05,
                maxWidth: 480,
              }}
            >
              Your work,
              <br />
              in one calm place.
            </h1>
            <p
              style={{
                margin: "16px 0 0",
                maxWidth: 420,
                color: "var(--muted)",
                fontSize: 16,
                lineHeight: 1.55,
              }}
            >
              Approvals, deliveries, and brand assets — without the agency
              noise. No finance. No margin. Just what you need to move forward.
            </p>
          </div>

          <div
            className="panel-3d"
            style={{
              borderRadius: 24,
              padding: 24,
              background:
                "linear-gradient(160deg, rgba(255,255,255,0.75), rgba(247,244,239,0.9))",
              border: "1px solid var(--glass-border)",
              boxShadow: "0 30px 60px rgba(10,9,8,0.1)",
            }}
          >
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Next up</p>
            <p
              style={{
                margin: "8px 0 0",
                fontFamily: "var(--font-display)",
                fontSize: 22,
                letterSpacing: "-0.02em",
              }}
            >
              Approve shoot refs
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--muted)" }}>
              Due in 48h · Creative package v2
            </p>
            <button type="button" style={cta}>
              Review package
            </button>
          </div>
        </section>

        <section
          style={{
            marginTop: 56,
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 14,
          }}
        >
          {[
            { t: "Deliveries", d: "3 in progress · 1 ready" },
            { t: "Approvals", d: "1 waiting on you" },
            { t: "Assets", d: "12 brand files" },
          ].map((c) => (
            <div
              key={c.t}
              style={{
                padding: 20,
                borderRadius: 18,
                background: "rgba(255,255,255,0.55)",
                border: "1px solid var(--glass-border)",
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontFamily: "var(--font-display)",
                  fontSize: 18,
                }}
              >
                {c.t}
              </p>
              <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>
                {c.d}
              </p>
            </div>
          ))}
        </section>

        <p style={{ marginTop: 40, fontSize: 12, color: "var(--muted)" }}>
          Portal preview — finance, payroll, and margin are intentionally absent.
        </p>
      </main>

      <style>{`
        @media (max-width: 800px) {
          main section:first-of-type,
          main section:nth-of-type(2) {
            grid-template-columns: 1fr !important;
          }
          .panel-3d { transform: none !important; }
        }
      `}</style>
    </div>
  );
}

const cta: CSSProperties = {
  marginTop: 20,
  width: "100%",
  border: "none",
  borderRadius: 12,
  padding: "12px 16px",
  background: "var(--ink)",
  color: "var(--paper)",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};
