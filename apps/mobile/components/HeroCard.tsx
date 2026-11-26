import { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./Text";

type Tone = "green" | "yellow" | "dark" | "primary";

interface Props {
  title: string;
  subtitle?: string;
  /** Retained for source-compat; Phase 4 renders all tones as mv-panel. */
  tone: Tone;
  children?: ReactNode;
  onPress?: () => void;
}

/** Source: Minerva Network — all hero variants are mv-panel + mv-line, monochrome.
 *  tone="primary" deepens to mv-line-strong for the most-prominent hero on a screen. */
export function HeroCard({ title, subtitle, tone, children, onPress }: Props) {
  const borderClass = tone === "primary" || tone === "green" ? "border-mv-line-strong" : "border-mv-line";
  const className = `rounded-xl p-5 bg-mv-panel border ${borderClass} flex-1 min-h-[140px]`;

  const body = (
    <>
      <Text variant="label" muted>
        {subtitle ?? ""}
      </Text>
      <Text variant="title" weight="medium" className="mt-2">
        {title}
      </Text>
      {children ? <View className="mt-3">{children}</View> : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} className={className}>
        {body}
      </Pressable>
    );
  }
  return <View className={className}>{body}</View>;
}
