import { useState } from "react";
import { TextInput, TextInputProps, View } from "react-native";
import { Text } from "./Text";
import { colors } from "@minerva/ui-tokens";

interface Props extends TextInputProps {
  label?: string;
}

/** Source: Minerva Network — mv-ink filled input with mv-line 1px hairline,
 *  mv-bone text, mv-mist placeholder. Focus deepens border to mv-line-strong. */
export function Input({ label, className, onFocus, onBlur, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <View className="gap-1.5">
      {label ? (
        <Text variant="label" muted>
          {label}
        </Text>
      ) : null}
      <TextInput
        className={`h-14 px-4 bg-mv-ink rounded-md border text-body-lg text-mv-bone ${focused ? "border-mv-line-strong" : "border-mv-line"} ${className ?? ""}`}
        placeholderTextColor={colors.textMuted}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...rest}
      />
    </View>
  );
}
