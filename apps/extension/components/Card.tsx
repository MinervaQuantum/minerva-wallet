import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
}

/** Source: Minerva Network — mv-panel with mv-line 1px hairline. */
export function Card({ children, className = "" }: Props) {
  return (
    <div className={`bg-mv-panel border border-mv-line rounded-lg p-4 ${className}`}>{children}</div>
  );
}
