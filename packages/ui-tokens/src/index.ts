/**
 * @minerva/ui-tokens
 *
 * Single source of truth for visual tokens consumed by:
 * - apps/mobile (NativeWind)
 * - apps/extension (Tailwind)
 *
 * Minerva brand: deep navy surfaces (#06071a) and lavender ink (#e1e5fb) taken from the
 * Minerva mark; hairline-driven, no filled accent colours.
 *
 * Phase 4 supersedes the SWallet-derived palette of Phases 1–3:
 * - dropped `colors.badge.*`, `colors.settingsIcon.*`, `colors.hero.*`,
 *   `colors.warningSoft`, `colors.warningStrong`
 * - replaced with the mv-* palette + a minimal pair of alert hairlines
 *   (`warn`, `crit`) used as 2px accent bars on WarningCard only.
 *
 * Cross-reference: docs/visual-specs.md, network/apps/web/app/globals.css.
 */

export const colors = {
  // Surfaces (dark, from website @theme).
  background: "#06071a", // mv-black — root background (Minerva navy, from the brand mark)
  ink: "#0b0d26", // mv-ink — nested surfaces, inputs, sheets
  panel: "#10132f", // mv-panel — cards, hero containers

  // Text.
  text: "#e1e5fb", // mv-bone — primary text, primary CTA fill (Minerva lavender)
  textMuted: "#8f95c4", // mv-mist — muted text, inactive icons

  // Hairlines.
  line: "rgba(225,229,251,0.10)", // mv-line — default 1px divider
  lineStrong: "rgba(225,229,251,0.22)", // mv-line-strong — emphasized outline
  spark: "#ffffff", // mv-spark — focus ring, selection bg

  // Wallet-only alert hairlines (the website itself has no alerts).
  // Used as 1–2px accent borders / left bars, never as filled backgrounds.
  warn: "#E07A4A",
  crit: "#F25C5C",

  // Legacy aliases retained for backward compatibility with screens that still
  // reference the Phase 1–3 names. Resolved against the new palette.
  surface: "#10132f", // → panel
  surfaceStrong: "#0b0d26", // → ink
  primary: "#e1e5fb", // → bone (primary CTA fill)
  primaryPressed: "#c3c9ef",
  divider: "rgba(225,229,251,0.10)", // → line

  // Legacy sub-objects retained so non-hero screens still compile. All
  // values resolve into the Phase 4 monochrome palette; the screens render
  // visually consistent with the new theme even though they reference old keys.
  badge: {
    positive: "#e1e5fb", // → bone
    review: "#ffffff", // → spark
    warning: "#E07A4A", // → warn
    neutral: "rgba(225,229,251,0.22)", // → line-strong
  },
  hero: {
    green: "#10132f", // → panel
    yellow: "#10132f", // → panel
    dark: "#10132f", // → panel
  },
  warningSoft: "#10132f", // → panel
  warningStrong: "#E07A4A", // → warn
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,

  pageMarginX: 16,
  rowMinHeight: 48,
  rowComfortableHeight: 56,
  iconActionSize: 56,
  settingsIconSize: 44,
  buttonHeight: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
  pill: 999,
  qrFrame: 18,
  heroCard: 16,
} as const;

export const typography = {
  fontFamily: {
    // Resolved to Expo Google Fonts names in apps/mobile/app/_layout.tsx
    // and to CSS @import names in apps/extension/style.css.
    display: "SpaceGrotesk-Medium", // mv-display
    body: "Inter", // mv-body
    bodyMedium: "Inter-Medium",
    mono: "JetBrainsMono", // mv-label / mv-mono

    // Legacy aliases (Phase 1–3 names).
    primary: "Inter",
  },
  size: {
    caption: 11, // mv-label is 0.6875rem = 11px on the website
    body: 14,
    bodyLarge: 16,
    title: 20,
    section: 24,
    pageTitle: 32,
  },
  weight: {
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
  lineHeight: {
    body: 22, // 1.6 × 14 ≈ 22
    title: 28,
    pageTitle: 36, // 0.95 × ~38 (display tight)
  },
  letterSpacing: {
    tight: -0.5, // display, -0.02em on ~32px
    label: 2.4, // mv-label 0.22em on 11px
  },
} as const;

export const elevation = {
  none: { shadowOpacity: 0, elevation: 0 },
  // Cards stay flat — the website uses hairlines, not shadows.
  hairline: {
    shadowColor: "transparent",
    shadowOpacity: 0,
    elevation: 0,
  },
} as const;

export const layout = {
  mobileFrame: { width: 412, height: 892 },
} as const;

// Tab bar — bone-pill active treatment on black.
export const tabBar = {
  height: 72,
  pillWidth: 96,
  pillHeight: 32,
  pillRadius: 999,
  iconSize: 22,
  labelSize: 10,
  activeBackground: colors.text, // mv-bone fill
  activeIconColor: colors.background, // mv-black icon
  activeLabelColor: colors.text, // mv-bone label below pill
  inactiveIconColor: colors.textMuted, // mv-mist
  inactiveLabelColor: colors.textMuted,
  background: colors.background, // mv-black
  borderTopColor: colors.line, // mv-line
} as const;

export const card = {
  padding: 16,
  radius: radius.lg,
  background: colors.panel, // mv-panel
  borderColor: colors.line, // mv-line
  borderWidth: 1,
  hero: {
    radius: radius.heroCard,
    padding: 20,
    background: colors.panel,
    borderColor: colors.lineStrong,
    borderWidth: 1,
  },
} as const;

export const input = {
  height: 52,
  radius: radius.md,
  background: colors.ink, // mv-ink
  borderColor: colors.line, // mv-line
  borderWidth: 1,
  focusBorderColor: colors.lineStrong,
  paddingX: 16,
  textSize: typography.size.bodyLarge,
  placeholderColor: colors.textMuted,
} as const;

export const button = {
  height: 48,
  radius: radius.pill,
  paddingX: 32,
  // Primary = bone fill (the website's selection-bg treatment).
  primaryBackground: colors.text,
  primaryColor: colors.background,
  // Secondary = transparent + 1px line-strong outline.
  secondaryBackground: "transparent",
  secondaryColor: colors.text,
  secondaryBorderColor: colors.lineStrong,
  textSize: typography.size.bodyLarge,
  textWeight: typography.weight.medium,
} as const;

/**
 * Maps Minerva security/state names to badge palette keys.
 * The badge component now resolves all keys to a small monochrome set
 * (positive | review | warning | neutral). Color is implemented by the
 * primitive itself; this map only categorizes.
 */
export type BadgeColor = "positive" | "review" | "warning" | "neutral";

export const badgeColorByState: Record<string, BadgeColor> = {
  "Smart Account Ready": "positive",
  "Hybrid Protected": "positive",
  "PQ Ready": "positive",
  "PQ Native": "positive",
  "Compatibility Mode": "neutral",
  "Legacy Route": "warning",
  Legacy: "warning",
  "External Dependency": "neutral",
  "Recovery Active": "positive",
  "Rotation Recommended": "review",
  "Recovery Missing": "warning",
  Verified: "positive",
  Unverified: "warning",
  Limited: "review",
};

export const tokens = {
  colors,
  spacing,
  radius,
  typography,
  elevation,
  layout,
  tabBar,
  card,
  input,
  button,
  badgeColorByState,
} as const;

export type Tokens = typeof tokens;
