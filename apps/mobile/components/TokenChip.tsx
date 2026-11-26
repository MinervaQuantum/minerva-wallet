import { Pressable, View } from "react-native";
import { Text } from "./Text";

interface Props {
  symbol: string;
  name: string;
  balance: string;
  fiatValue: string;
  /** Phase 4 ignores tone; retained for source-compat. */
  tone?: "purple" | "blue" | "orange" | "green";
  onPress?: () => void;
}

/** Source: Minerva Network — mv-panel card with mv-line hairline.
 *  Logo placeholder is a mv-line-strong filled circle with the first letter in mv-bone. */
export function TokenChip({ symbol, name, balance, fiatValue, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      className="bg-mv-panel rounded-lg border border-mv-line p-4 w-36"
    >
      <View className="flex-row items-center gap-2">
        <View className="w-7 h-7 rounded-pill bg-mv-line-strong items-center justify-center">
          <Text variant="caption" weight="medium" className="text-mv-bone">
            {symbol.slice(0, 1)}
          </Text>
        </View>
        <Text variant="body" weight="medium">
          {balance}
        </Text>
      </View>
      <Text variant="body" weight="medium" className="mt-2" numberOfLines={1}>
        {name}
      </Text>
      <Text variant="caption" muted className="mt-0.5">
        {fiatValue}
      </Text>
    </Pressable>
  );
}
