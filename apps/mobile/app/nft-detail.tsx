import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { Hex } from "@minerva/core";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Row } from "@/components/Row";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { WarningCard } from "@/components/WarningCard";
import { useAccountSnapshot } from "@/hooks/useAccountSnapshot";
import { listTrackedCollections, type TrackedCollection } from "@/lib/nfts";
import { openExternalUrl } from "@/lib/externalActions";
import {
  encodeErc1155Transfer,
  encodeErc721Transfer,
  explorerAddressUrl,
  isValidEvmAddress,
  normalizeEvmAddress,
  readNftMetadata,
  readTokenUri,
  type NftMetadata,
  type NftStandard,
} from "@minerva/evm";

export default function NftDetail() {
  const snapshot = useAccountSnapshot();
  const params = useLocalSearchParams<{ collection?: string; tokenId?: string; standard?: string }>();
  const collectionAddress = params.collection && isValidEvmAddress(params.collection) ? (params.collection as Hex) : undefined;
  const tokenId = params.tokenId;
  const standard: NftStandard = params.standard === "erc1155" ? "erc1155" : "erc721";
  const [collection, setCollection] = useState<TrackedCollection | undefined>();
  const [metadata, setMetadata] = useState<NftMetadata | undefined>();
  const [tokenUri, setTokenUri] = useState<string | undefined>();
  const [recipient, setRecipient] = useState("");

  useEffect(() => {
    if (!collectionAddress || !tokenId) return;
    let active = true;
    listTrackedCollections(snapshot.chainId).then((list) => {
      if (active) setCollection(list.find((c) => c.address.toLowerCase() === collectionAddress.toLowerCase()));
    });
    readTokenUri(collectionAddress, standard, tokenId, { chainId: snapshot.chainId, rpcUrl: snapshot.rpcUrl })
      .then(async (uri) => {
        if (!active) return;
        setTokenUri(uri);
        setMetadata(await readNftMetadata(uri));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [collectionAddress, snapshot.chainId, snapshot.rpcUrl, standard, tokenId]);

  if (!collectionAddress || !tokenId) {
    return (
      <PageContainer>
        <PageHeader title="Collectible" showBack centerTitle />
        <WarningCard severity="info" title="Missing item" detail="Open a collectible from the gallery." />
      </PageContainer>
    );
  }

  const name = metadata?.name ?? `${collection?.name ?? "Item"} #${tokenId}`;
  const recipientValid = isValidEvmAddress(recipient.trim());
  const canSend = snapshot.walletStatus === "unlocked" && recipientValid && Boolean(snapshot.activeAddress);

  const send = () => {
    if (!snapshot.activeAddress || !recipientValid) return;
    const to = normalizeEvmAddress(recipient.trim()) as Hex;
    const data = standard === "erc1155" ? encodeErc1155Transfer(snapshot.activeAddress, to, tokenId, 1n) : encodeErc721Transfer(snapshot.activeAddress, to, tokenId);
    router.push({
      pathname: "/transaction-review",
      params: {
        target: collectionAddress,
        recipient: to,
        valueWei: "0",
        data,
        amount: "1",
        asset: collection?.symbol || collection?.name || "NFT",
        tokenAddress: collectionAddress,
        tokenSymbol: collection?.symbol || collection?.name || "NFT",
        tokenDecimals: "0",
        tokenUnits: "1",
      },
    });
  };

  return (
    <PageContainer>
      <PageHeader title={name} showBack centerTitle />
      <View className="gap-5">
        <Card className="p-2">
          <View className="aspect-square rounded-md bg-mv-ink border border-mv-line overflow-hidden items-center justify-center">
            {metadata?.image ? (
              <Image source={{ uri: metadata.image }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
            ) : (
              <Text variant="caption" muted>
                {tokenUri ? "Image unavailable" : "No metadata"}
              </Text>
            )}
          </View>
        </Card>

        {metadata?.description ? (
          <Text variant="body" muted>
            {metadata.description}
          </Text>
        ) : null}

        <Card>
          <Text variant="label" muted className="mb-2">
            Details
          </Text>
          <Row label="Collection" value={collection?.name ?? `${collectionAddress.slice(0, 8)}…`} showChevron={false} />
          <Row label="Standard" value={standard.toUpperCase()} showChevron={false} />
          <Row label="Token id" value={tokenId} showChevron={false} />
          <Row label="Contract" value={`${collectionAddress.slice(0, 10)}…${collectionAddress.slice(-8)}`} showChevron={false} last={!metadata?.attributes?.length} />
          {metadata?.attributes?.slice(0, 12).map((attribute, index, all) => (
            <Row
              key={`${attribute.trait_type ?? "trait"}-${index}`}
              label={attribute.trait_type ?? "Trait"}
              value={String(attribute.value ?? "")}
              showChevron={false}
              last={index === all.length - 1}
            />
          ))}
          <View className="mt-4">
            <Button variant="secondary" size="block" onPress={() => openExternalUrl(explorerAddressUrl(collectionAddress, snapshot.chainId))}>
              View contract in explorer
            </Button>
          </View>
        </Card>

        <Card>
          <Text variant="label" muted className="mb-3">
            Send
          </Text>
          <View className="gap-3">
            <Input label="Recipient" placeholder="0x…" value={recipient} onChangeText={setRecipient} autoCapitalize="none" autoCorrect={false} />
            <Button size="block" onPress={send} disabled={!canSend}>
              Review transfer
            </Button>
          </View>
          {snapshot.isWatchOnly ? (
            <Text variant="caption" muted className="mt-2">
              Watch-only accounts cannot send.
            </Text>
          ) : snapshot.walletStatus !== "unlocked" ? (
            <Text variant="caption" muted className="mt-2">
              Unlock the wallet to send.
            </Text>
          ) : null}
        </Card>
      </View>
    </PageContainer>
  );
}
