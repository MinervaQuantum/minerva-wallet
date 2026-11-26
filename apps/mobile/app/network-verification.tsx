import { View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Row } from "@/components/Row";
import { Badge } from "@/components/Badge";
import { WarningCard } from "@/components/WarningCard";
import { useAccountSnapshot } from "@/hooks/useAccountSnapshot";
import { readPublicEnv } from "@/lib/runtimeConfig";
import {
  MINERVA_ACCOUNT_FACTORY,
  MINERVA_ACCOUNT_READINESS_REGISTRY,
  MINERVA_MLDSA65_PRECOMPILE,
  MINERVA_SECURITY_MODE_REGISTRY,
  MINERVA_TESTNET_CHAIN_ID,
  MINERVA_TESTNET_EXPLORER_URL,
  defaultMinervaIndexerUrl,
} from "@minerva/evm";

export default function NetworkVerification() {
  const snapshot = useAccountSnapshot();
  const rpcUrl = snapshot.rpcUrl ?? readPublicEnv("EXPO_PUBLIC_MINERVA_RPC_URL") ?? "Default";
  const indexerUrl = readPublicEnv("EXPO_PUBLIC_MINERVA_INDEXER_URL") ?? defaultMinervaIndexerUrl(snapshot.chainId);
  const chainOk = snapshot.chainId === MINERVA_TESTNET_CHAIN_ID;

  return (
    <PageContainer>
      <PageHeader title="Network verification" showBack centerTitle />

      <View className="gap-5">
        <Card>
          <View className="flex-row items-center justify-between">
            <Text variant="title" weight="semibold">
              Minerva Testnet
            </Text>
            <Badge label={chainOk ? "Verified" : "Review"} />
          </View>
          <View className="mt-4">
            <Row label="Expected chain ID" value={String(MINERVA_TESTNET_CHAIN_ID)} showChevron={false} />
            <Row label="Current chain ID" value={String(snapshot.chainId)} showChevron={false} />
            <Row label="Latest block" value={snapshot.latestBlock ?? "Unavailable"} showChevron={false} last />
          </View>
        </Card>

        {!chainOk ? (
          <WarningCard
            severity="critical"
            title="Wrong network"
            detail={`Production Minerva Wallet builds should use Minerva Testnet chain ID ${MINERVA_TESTNET_CHAIN_ID}.`}
          />
        ) : null}
        {snapshot.status === "fallback" ? (
          <WarningCard
            severity="warning"
            title="RPC state unavailable"
            detail={snapshot.error ?? "The wallet could not verify the network from live RPC."}
          />
        ) : null}

        <Card>
          <Text variant="label" muted className="mb-2">
            Endpoints
          </Text>
          <Row label="RPC" value={rpcUrl} showChevron={false} />
          <Row label="Indexer" value={indexerUrl} showChevron={false} />
          <Row label="Explorer" value={MINERVA_TESTNET_EXPLORER_URL || "Not available yet"} showChevron={false} last />
        </Card>

        <Card>
          <Text variant="label" muted className="mb-2">
            System addresses
          </Text>
          <Row label="ML-DSA-65 precompile" value={MINERVA_MLDSA65_PRECOMPILE} showChevron={false} />
          <Row label="SecurityModeRegistry" value={MINERVA_SECURITY_MODE_REGISTRY} showChevron={false} />
          <Row label="AccountReadinessRegistry" value={MINERVA_ACCOUNT_READINESS_REGISTRY} showChevron={false} />
          <Row label="MinervaAccountFactory" value={MINERVA_ACCOUNT_FACTORY} showChevron={false} last />
        </Card>
      </View>
    </PageContainer>
  );
}
