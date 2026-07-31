import type { ReactNode } from "react";
import { cn } from "@hrmny/ui";

export function CrmTag({
  children,
  kind,
  className,
}: {
  children: ReactNode;
  kind?: "ochre" | "hot" | "success" | "warn" | "danger" | "info";
  className?: string;
}) {
  return (
    <span className={cn("crm-tag", kind, className)}>{children}</span>
  );
}

export function CrmPageHeader({
  kicker = "Pipeline",
  title,
  description,
  actions,
}: {
  kicker?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="crm-page-header">
      <div>
        <p className="crm-eyebrow">{kicker}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="crm-header-actions">{actions}</div> : null}
    </header>
  );
}

export function CrmBtn({
  children,
  variant = "default",
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost";
}) {
  return (
    <button
      type={type}
      className={cn(
        "crm-btn",
        variant === "primary" && "primary",
        variant === "ghost" && "ghost",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function CrmFilterBar({ children }: { children: ReactNode }) {
  return <div className="crm-filterbar">{children}</div>;
}

export function CrmTableShell({
  children,
  foot,
}: {
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <div className="crm-table-shell">
      <div className="crm-table-scroll">{children}</div>
      {foot ? <div className="crm-table-foot">{foot}</div> : null}
    </div>
  );
}

export function CrmEmpty({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="crm-empty">
      <strong className="block font-display text-lg text-ink">{title}</strong>
      {hint ? <p className="mt-2">{hint}</p> : null}
    </div>
  );
}

export function CompanyCell({
  name,
  subtitle,
  mark,
}: {
  name: string;
  subtitle?: string;
  mark?: string;
}) {
  return (
    <div className="crm-company-cell">
      <span className="crm-company-logo">{mark ?? name.slice(0, 2).toUpperCase()}</span>
      <span>
        <strong>{name}</strong>
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
    </div>
  );
}
