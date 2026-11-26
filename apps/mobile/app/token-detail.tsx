import { View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Row } from "@/components/Row";
import { Button } from "@/components/Button";
import { HeroCard } from "@/components/HeroCard";
import { WarningCard } from "@/components/WarningCard";
import { useAccountSnapshot } from "@/hooks/useAccountSnapshot";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import { setTokenHidden } from "@/lib/tokens";
import { openExternalUrl } from "@/lib/externalActions";
import { explorerAddressUrl, formatTokenUnits } from "@minerva/evm";

export default function TokenDetail() {
  const snapshot = useAccountSnapshot();
  const params = useLocalSearchParams<{ address?: string }>();
  const balances = useTokenBalances({
    chainId: snapshot.chainId,
    rpcUrl: snapshot.rpcUrl,
    indexerUrl: snapshot.indexerUrl,
    address: snapshot.activeAddress,
    enabled: snapshot.accountReady,
  });
  const token = balances.tokens.find((t) => t.address.toLowerCase() === params.address?.toLowerCase());
  const canSend = snapshot.walletStatus === "unlocked" && Boolean(token) && (token?.balance ?? 0n) > 0n;

  if (!token) {
    return (
      <PageContainer>
        <PageHeader title="Token" showBack centerTitle />
        <WarningCard severity="info" title={balances.status === "loading" ? "Loading token…" : "Token not tracked"} detail="Add it from the Tokens screen." />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader title={token.symbol} showBack centerTitle />
      <View className="gap-5">
        <HeroCard title={`${formatTokenUnits(token.balance, token.decimals)} ${token.symbol}`} subtitle={token.name.toUpperCase()} tone="primary">
          <Text variant="caption" className="text-background opacity-80">
            {snapshot.chainName}
          </Text>
        </HeroCard>

        {token.error ? <WarningCard severity="review" title="Balance unavailable" detail={token.error} /> : null}

        <View className="flex-row gap-3">
          <Button
            className="flex-1"
            disabled={!canSend}
            onPress={() => router.push({ pathname: "/send", params: { token: token.address } } as Href)}
          >
            Send
          </Button>
          <Button className="flex-1" variant="secondary" onPress={() => router.push("/receive")}>
            Receive
          </Button>
        </View>
        {snapshot.walletStatus === "watch-only" ? (
          <WarningCard severity="info" title="Watch-only account" detail="Switch to a key-backed account to send tokens." />
        ) : null}

        <Card>
          <Text variant="label" muted className="mb-2">
            Contract
          </Text>
          <Row label="Address" value={`${token.address.slice(0, 10)}…${token.address.slice(-8)}`} showChevron={false} />
          <Row label="Decimals" value={String(token.decimals)} showChevron={false} />
          <Row label="Source" value={token.source === "custom" ? "Added by you" : "Indexer discovery"} showChevron={false} last />
          <View className="flex-row gap-2 mt-4">
            <Button variant="secondary" className="flex-1 px-2" onPress={() => openExternalUrl(explorerAddressUrl(token.address, snapshot.chainId))}>
              Explorer
            </Button>
            <Button variant="secondary" className="flex-1 px-2" onPress={() => setTokenHidden(snapshot.chainId, token.address, !token.hidden)}>
              {token.hidden ? "Show on Home" : "Hide from Home"}
            </Button>
          </View>
        </Card>
      </View>
    </PageContainer>
  );
}
