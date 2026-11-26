import { badgeColorByState, colors, type BadgeColor } from "@minerva/ui-tokens";

interface Props {
  label: string;
  color?: BadgeColor;
}

const containerClass: Record<BadgeColor, string> = {
  positive: "bg-mv-bone text-mv-black",
  review: "bg-transparent border border-mv-spark text-mv-bone",
  warning: "bg-transparent border border-warn text-warn",
  neutral: "bg-transparent border border-mv-line-strong text-mv-mist",
};

const textColor: Record<BadgeColor, string> = {
  positive: colors.background,
  review: colors.text,
  warning: colors.warn,
  neutral: colors.textMuted,
};

export function Badge({ label, color }: Props) {
  const resolved = color ?? badgeColorByState[label] ?? "neutral";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-pill text-[11px] font-mono uppercase tracking-[0.22em] font-medium ${containerClass[resolved]}`}
      style={{ color: textColor[resolved] }}
    >
      {label}
    </span>
  );
}
