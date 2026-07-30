import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { cn } from "./cn";

type ButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "ghost";
  }
>;

export function Button({
  children,
  className,
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition",
        variant === "primary" &&
          "bg-[var(--hrmny-ochre)] text-white font-semibold hover:opacity-90",
        variant === "ghost" &&
          "bg-transparent text-[var(--hrmny-ink)] hover:bg-[var(--hrmny-sand)]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
