const { colors, spacing, radius } = require("@minerva/ui-tokens");

module.exports = {
  content: [
    "./popup.tsx",
    "./options.tsx",
    "./components/**/*.{ts,tsx}",
    "./contents/**/*.{ts,tsx}",
    "./options/**/*.{ts,tsx}",
    "./screens/**/*.{ts,tsx}",
    "./tabs/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Minerva Network brand palette (Phase 4).
        "mv-black": colors.background,
        "mv-ink": colors.ink,
        "mv-panel": colors.panel,
        "mv-bone": colors.text,
        "mv-mist": colors.textMuted,
        "mv-line": colors.line,
        "mv-line-strong": colors.lineStrong,
        "mv-spark": colors.spark,
        warn: colors.warn,
        crit: colors.crit,

        // Legacy aliases for backward compat with screens already shipped.
        background: colors.background,
        surface: colors.panel,
        primary: colors.text,
        text: colors.text,
        "text-muted": colors.textMuted,
        divider: colors.line,
      },
      spacing: {
        page: `${spacing.pageMarginX}px`,
      },
      borderRadius: {
        sm: `${radius.sm}px`,
        md: `${radius.md}px`,
        lg: `${radius.lg}px`,
        xl: `${radius.xl}px`,
        pill: `${radius.pill}px`,
      },
      fontFamily: {
        display: ['"Space Grotesk"', "system-ui", "sans-serif"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
    },
  },
};
