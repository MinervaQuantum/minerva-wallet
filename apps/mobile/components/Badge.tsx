import { View } from "react-native";
import { badgeColorByState, colors, type BadgeColor } from "@minerva/ui-tokens";
import { Text } from "./Text";

interface Props {
  label: string;
  color?: BadgeColor;
}

/** Source: Minerva Network — monochrome only.
 *  - positive: mv-bone fill on mv-black text
 *  - review:   mv-spark 1px outline, mv-bone text
 *  - warning:  warn 1px outline, warn text
 *  - neutral:  mv-line-strong 1px outline, mv-mist text */
const containerClass: Record<BadgeColor, string> = {
  positive: "bg-mv-bone",
  review: "bg-transparent border border-mv-spark",
  warning: "bg-transparent border border-warn",
  neutral: "bg-transparent border border-mv-line-strong",
};

const textClass: Record<BadgeColor, string> = {
  positive: "text-mv-black",
  review: "text-mv-bone",
  warning: "text-warn",
  neutral: "text-mv-mist",
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
    <View className={`self-start px-2.5 py-1 rounded-pill ${containerClass[resolved]}`}>
      <Text variant="label" weight="medium" className={textClass[resolved]} style={{ color: textColor[resolved] }}>
        {label}
      </Text>
    </View>
  );
}
