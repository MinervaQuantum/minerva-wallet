import { Text as RNText, TextProps, TextStyle } from "react-native";
import { typography } from "@minerva/ui-tokens";

type Variant = "page-title" | "section" | "title" | "body-lg" | "body" | "caption" | "label" | "mono";

interface Props extends TextProps {
  variant?: Variant;
  muted?: boolean;
  weight?: "regular" | "medium" | "semibold" | "bold";
}

/** Source: Minerva Network @theme — display=Space Grotesk, body=Inter, mono=JetBrains Mono.
 *  mv-label (variant="label") = mono, uppercase, 0.22em tracking. */
const variantClass: Record<Variant, string> = {
  "page-title": "text-page-title font-display",
  section: "text-section font-display",
  title: "text-title font-display",
  "body-lg": "text-body-lg",
  body: "text-body",
  caption: "text-caption",
  label: "text-caption font-mono uppercase",
  mono: "text-body font-mono",
};

const variantStyle: Partial<Record<Variant, TextStyle>> = {
  "page-title": { letterSpacing: typography.letterSpacing.tight, lineHeight: typography.lineHeight.pageTitle },
  section: { letterSpacing: typography.letterSpacing.tight, lineHeight: typography.lineHeight.title },
  title: { lineHeight: typography.lineHeight.title },
  body: { lineHeight: typography.lineHeight.body },
  "body-lg": { lineHeight: typography.lineHeight.body },
  label: { letterSpacing: typography.letterSpacing.label },
};

const weightClass: Record<NonNullable<Props["weight"]>, string> = {
  regular: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
};

const explicitTextColorPattern =
  /\btext-(?:mv-black|mv-ink|mv-panel|mv-bone|mv-mist|mv-line|mv-line-strong|mv-spark|warn|crit|background|surface|surface-strong|primary|primary-pressed|text|text-muted|divider)\b/;

export function Text({ variant = "body", muted, weight, className, style, ...rest }: Props) {
  const colorClass = className && explicitTextColorPattern.test(className) ? "" : muted ? "text-mv-mist" : "text-mv-bone";
  const cls = [
    variantClass[variant],
    colorClass,
    weight ? weightClass[weight] : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return <RNText className={cls} style={[variantStyle[variant], style]} {...rest} />;
}
