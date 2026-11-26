import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, View } from "react-native";
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
import { addCollection, discoverCollections, listTrackedCollections, loadOwnedItems, removeCollection, type TrackedCollection } from "@/lib/nfts";
import { onWalletChange } from "@/lib/walletEvents";
import type { NftItem } from "@minerva/evm";

/** Collectibles gallery: ERC-721 and ERC-1155 items held by the active account. */
export default function Nfts() {
  const snapshot = useAccountSnapshot();
  const [collections, setCollections] = useState<TrackedCollection[]>([]);
  const [items, setItems] = useState<NftItem[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | undefined>();
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => onWalletChange(() => setReloadKey((k) => k + 1)), []);

  const load = useCallback(async () => {
    if (!snapshot.activeAddress) return;
    setStatus("loading");
    setError(undefined);
    const config = { chainId: snapshot.chainId, rpcUrl: snapshot.rpcUrl };
    try {
      const tracked = await discoverCollections(snapshot.chainId, snapshot.activeAddress, snapshot.indexerUrl, config).catch(() =>
        listTrackedCollections(snapshot.chainId),
      );
      setCollections(tracked);
      setItems(await loadOwnedItems(snapshot.chainId, snapshot.activeAddress, tracked, config));
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load collectibles");
      setStatus("error");
    }
  }, [snapshot.activeAddress, snapshot.chainId, snapshot.indexerUrl, snapshot.rpcUrl]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const add = async () => {
    setBusy(true);
    setNote(undefined);
    setError(undefined);
    try {
      const c = await addCollection(snapshot.chainId, address, { chainId: snapshot.chainId, rpcUrl: snapshot.rpcUrl });
      setNote(`Added ${c.name} (${c.standard.toUpperCase()})`);
      setAddress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add collection");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader title="Collectibles" showBack centerTitle />
      <View className="gap-5">
        {status === "loading" && items.length === 0 ? (
          <Card>
            <Text variant="body" muted>
              Looking for collectibles…
            </Text>
          </Card>
        ) : null}
        {error ? <WarningCard severity="review" title="Collectibles" detail={error} /> : null}
        {note ? <WarningCard severity="info" title={note} /> : null}

        {status === "ready" && items.length === 0 ? (
          <Card>
            <Text variant="body" muted>
              No collectibles found for this account on {snapshot.chainName}. Collections that transferred an item to you
              appear automatically; others can be added below.
            </Text>
          </Card>
        ) : null}

        <View className="flex-row flex-wrap gap-3">
          {items.map((item) => (
            <Pressable
              key={`${item.collection}:${item.tokenId}`}
              style={{ width: "47%" }}
              onPress={() =>
                router.push({
                  pathname: "/nft-detail",
                  params: { collection: item.collection, tokenId: item.tokenId, standard: item.standard },
                } as Href)
              }
            >
              <Card className="p-2">
                <View className="aspect-square rounded-md bg-mv-ink border border-mv-line overflow-hidden items-center justify-center">
                  {item.image ? (
                    <Image source={{ uri: item.image }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                  ) : (
                    <Text variant="caption" muted>
                      No image
                    </Text>
                  )}
                </View>
                <Text variant="body" weight="medium" numberOfLines={1} className="mt-2">
                  {item.name}
                </Text>
                <Text variant="caption" muted numberOfLines={1}>
                  #{item.tokenId}
                  {item.standard === "erc1155" ? ` × ${item.amount}` : ""}
                </Text>
              </Card>
            </Pressable>
          ))}
        </View>

        <Card>
          <Text variant="label" muted className="mb-3">
            Add collection
          </Text>
          <View className="gap-3">
            <Input label="Contract address" placeholder="0x…" value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} />
            <Button size="block" onPress={add} disabled={busy || address.trim().length === 0}>
              {busy ? "Reading contract…" : "Add"}
            </Button>
          </View>
        </Card>

        {collections.length > 0 ? (
          <View className="gap-2">
            <Text variant="label" muted>
              Collections
            </Text>
            {collections.map((c) => (
              <Card key={c.address}>
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 pr-3">
                    <View className="flex-row items-center gap-2">
                      <Text variant="body" weight="medium" numberOfLines={1}>
                        {c.name}
                      </Text>
                      <Badge label={c.standard.toUpperCase()} />
                    </View>
                    <Text variant="caption" muted numberOfLines={1}>
                      {c.address.slice(0, 10)}…{c.address.slice(-8)} · {items.filter((i) => i.collection === c.address).length} held
                    </Text>
                  </View>
                  <Pressable onPress={() => removeCollection(snapshot.chainId, c.address)} hitSlop={8}>
                    <Text variant="caption" weight="medium">
                      Remove
                    </Text>
                  </Pressable>
                </View>
              </Card>
            ))}
          </View>
        ) : null}
      </View>
    </PageContainer>
  );
}
