import { ReactNode } from "react";
import { View, ViewProps } from "react-native";

interface Props extends ViewProps {
  children: ReactNode;
  /** Hero variant: stronger hairline border + larger radius. */
  hero?: boolean;
}

/** Source: Minerva Network — mv-panel surface with mv-line 1px hairline. Flat (no shadow). */
export function Card({ children, hero = false, className, ...rest }: Props) {
  const base = hero
    ? "bg-mv-panel rounded-xl border border-mv-line-strong p-5"
    : "bg-mv-panel rounded-lg border border-mv-line p-4";
  return (
    <View className={`${base} ${className ?? ""}`} {...rest}>
      {children}
    </View>
  );
}
