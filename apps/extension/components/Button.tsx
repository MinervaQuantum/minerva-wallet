import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { colors } from "@minerva/ui-tokens";

type Variant = "primary" | "secondary" | "tertiary" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: Variant;
  size?: "default" | "block";
}

/** Source: Minerva Network — bone-filled primary, outlined secondary,
 *  transparent tertiary, crit-outlined danger. Pill, h-12. */
const containerClass: Record<Variant, string> = {
  primary: "bg-mv-bone text-mv-black hover:bg-mv-bone/90",
  secondary: "bg-transparent border border-mv-line-strong text-mv-bone hover:bg-mv-panel",
  tertiary: "bg-transparent text-mv-mist hover:text-mv-bone",
  danger: "bg-transparent border border-crit text-crit hover:bg-crit/10",
};

const textColor: Record<Variant, CSSProperties["color"]> = {
  primary: colors.background,
  secondary: colors.text,
  tertiary: colors.textMuted,
  danger: colors.crit,
};

export function Button({ children, variant = "primary", size = "default", className = "", style, ...rest }: Props) {
  const widthClass = size === "block" ? "w-full" : "";
  return (
    <button
      className={`h-12 rounded-pill px-8 font-medium transition-colors disabled:opacity-40 ${containerClass[variant]} ${widthClass} ${className}`}
      style={{ color: textColor[variant], ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}
