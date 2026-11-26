import { useState } from "react";
import { Image, View } from "react-native";
import { Globe, Link2 } from "lucide-react-native";
import { colors } from "@minerva/ui-tokens";
import { Text } from "@/components/Text";
import { Badge } from "@/components/Badge";

interface Props {
  name?: string;
  origin: string;
  iconUrl?: string;
  source: "browser" | "walletconnect";
  compact?: boolean;
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** Requesting-app identity: favicon (or a globe), page/app name, origin and transport badge. */
export function OriginCard({ name, origin, iconUrl, source, compact = false }: Props) {
  const [iconFailed, setIconFailed] = useState(false);
  const host = hostOf(origin);
  const isHttps = origin.startsWith("https://");
  const showIcon = Boolean(iconUrl) && !iconFailed;
  const size = compact ? 36 : 48;
  return (
    <View className={`flex-row items-center ${compact ? "gap-3" : "gap-4"}`}>
      <View
        style={{ width: size, height: size, borderRadius: size / 2 }}
        className="bg-mv-ink border border-mv-line items-center justify-center overflow-hidden"
      >
        {showIcon ? (
          <Image source={{ uri: iconUrl }} style={{ width: size, height: size }} onError={() => setIconFailed(true)} />
        ) : source === "walletconnect" ? (
          <Link2 size={compact ? 16 : 20} color={colors.textMuted} />
        ) : (
          <Globe size={compact ? 16 : 20} color={colors.textMuted} />
        )}
      </View>
      <View className="flex-1 gap-0.5">
        <Text variant={compact ? "body" : "body-lg"} weight="semibold" numberOfLines={1}>
          {name?.trim() || host}
        </Text>
        <Text variant="caption" muted numberOfLines={1}>
          {origin === "walletconnect" ? "Unknown origin" : host}
        </Text>
      </View>
      {!compact ? (
        <Badge
          label={source === "walletconnect" ? "WalletConnect" : isHttps ? "https" : "insecure"}
          color={source === "walletconnect" ? "neutral" : isHttps ? "positive" : "warning"}
        />
      ) : null}
    </View>
  );
}
