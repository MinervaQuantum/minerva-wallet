import { Pressable, View } from "react-native";
import { LucideIcon } from "lucide-react-native";
import { Text } from "./Text";
import { colors } from "@minerva/ui-tokens";

interface Props {
  label: string;
  Icon: LucideIcon;
  onPress?: () => void;
  disabled?: boolean;
}

/** Source: Minerva Network — mv-panel square with mv-line hairline,
 *  mv-bone icon, mv-bone caption below. Pressed state → mv-ink. */
export function IconAction({ label, Icon, onPress, disabled }: Props) {
  return (
    <View className={`items-center gap-2 flex-1 ${disabled ? "opacity-40" : ""}`}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        className="w-14 h-14 rounded-md bg-mv-panel border border-mv-line items-center justify-center active:bg-mv-ink"
      >
        <Icon size={22} color={colors.text} />
      </Pressable>
      <Text variant="caption" weight="medium" className="text-center">
        {label}
      </Text>
    </View>
  );
}
