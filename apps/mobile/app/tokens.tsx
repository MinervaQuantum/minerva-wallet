import { useState } from "react";
import { Pressable, View } from "react-native";
import { router, type Href } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { WarningCard } from "@/components/WarningCard";
import { useAccountSnapshot } from "@/hooks/useAccountSnapshot";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import { addCustomToken, removeTrackedToken, setTokenHidden } from "@/lib/tokens";
import { formatTokenUnits } from "@minerva/evm";

/** Token list management: add by contract address, hide, remove. Discovery comes from the indexer. */
export default function Tokens() {
  const snapshot = useAccountSnapshot();
  const balances = useTokenBalances({
    chainId: snapshot.chainId,
    rpcUrl: snapshot.rpcUrl,
    indexerUrl: snapshot.indexerUrl,
    address: snapshot.activeAddress,
    enabled: snapshot.accountReady,
  });
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const add = async () => {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      const token = await addCustomToken(snapshot.chainId, address, { chainId: snapshot.chainId, rpcUrl: snapshot.rpcUrl });
      setNote(`Added ${token.symbol} (${token.name})`);
      setAddress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add token");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader title="Tokens" showBack centerTitle />
      <View className="gap-5">
        <Card>
          <Text variant="label" muted className="mb-3">
            Add token
          </Text>
          <View className="gap-3">
            <Input label="Contract address" placeholder="0x…" value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} />
            <Button size="block" onPress={add} disabled={busy || address.trim().length === 0}>
              {busy ? "Reading contract…" : `Add on ${snapshot.chainName}`}
            </Button>
          </View>
          <Text variant="caption" muted className="mt-3">
            The wallet reads name, symbol and decimals from the contract. Tokens that moved to or from your
            account are added automatically from the public indexer.
          </Text>
        </Card>

        {note ? <WarningCard severity="info" title={note} /> : null}
        {error ? <WarningCard severity="warning" title="Could not add token" detail={error} /> : null}

        <View className="gap-3">
          <Text variant="label" muted>
            Tracked on {snapshot.chainName}
          </Text>
          {balances.tokens.length === 0 ? (
            <Card>
              <Text variant="body" muted>
                {balances.status === "loading" ? "Looking for tokens…" : "No ERC-20 tokens tracked yet."}
              </Text>
            </Card>
          ) : (
            balances.tokens.map((token) => (
              <Pressable key={token.address} onPress={() => router.push({ pathname: "/token-detail", params: { address: token.address } } as Href)}>
                <Card>
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 pr-3">
                      <View className="flex-row items-center gap-2">
                        <Text variant="body-lg" weight="semibold">
                          {token.symbol}
                        </Text>
                        {token.hidden ? <Badge label="Hidden" /> : null}
                        {token.source === "discovered" ? <Badge label="Discovered" /> : null}
                      </View>
                      <Text variant="caption" muted className="mt-0.5" numberOfLines={1}>
                        {token.name} · {token.address.slice(0, 8)}…{token.address.slice(-6)}
                      </Text>
                    </View>
                    <Text variant="body" weight="medium">
                      {token.error ? "—" : formatTokenUnits(token.balance, token.decimals)}
                    </Text>
                  </View>
                  <View className="flex-row gap-2 mt-3">
                    <Button variant="secondary" className="flex-1 px-2" onPress={() => setTokenHidden(snapshot.chainId, token.address, !token.hidden)}>
                      {token.hidden ? "Show" : "Hide"}
                    </Button>
                    <Button variant="secondary" className="flex-1 px-2" onPress={() => removeTrackedToken(snapshot.chainId, token.address)}>
                      Remove
                    </Button>
                  </View>
                </Card>
              </Pressable>
            ))
          )}
        </View>
      </View>
    </PageContainer>
  );
}
