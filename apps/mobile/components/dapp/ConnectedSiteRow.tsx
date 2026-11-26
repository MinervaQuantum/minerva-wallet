import { Pressable, View } from "react-native";
import { Unplug } from "lucide-react-native";
import { colors } from "@minerva/ui-tokens";
import { Text } from "@/components/Text";
import { OriginCard } from "./OriginCard";

interface Props {
  name?: string;
  origin: string;
  iconUrl?: string;
  source: "browser" | "walletconnect";
  detail?: string;
  onPress?: () => void;
  onDisconnect: () => void;
  last?: boolean;
}

/** One connected site / WalletConnect session with a disconnect action. */
export function ConnectedSiteRow({ name, origin, iconUrl, source, detail, onPress, onDisconnect, last = false }: Props) {
  const body = (
    <View className={`flex-row items-center py-3 ${last ? "" : "border-b border-mv-line"}`}>
      <View className="flex-1">
        <OriginCard name={name} origin={origin} iconUrl={iconUrl} source={source} compact />
        {detail ? (
          <Text variant="caption" muted className="mt-1 ml-12">
            {detail}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={onDisconnect}
        accessibilityLabel={`Disconnect ${name ?? origin}`}
        className="w-10 h-10 items-center justify-center rounded-pill border border-mv-line ml-2"
      >
        <Unplug size={16} color={colors.textMuted} />
      </Pressable>
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}
