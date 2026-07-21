import type { HTMLAttributes, PropsWithChildren } from "react";
import { cn } from "./cn";

export function Card({
  children,
  className,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--hrmny-sand)] bg-white/70 p-5 shadow-[0_1px_0_rgba(10,9,8,0.04)] backdrop-blur",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
