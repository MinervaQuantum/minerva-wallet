import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { getChainDefinition } from "@minerva/evm";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Row } from "@/components/Row";
import { Button } from "@/components/Button";
import { WarningCard } from "@/components/WarningCard";
import { AddressDisplay } from "@/components/AddressDisplay";
import { OriginCard } from "@/components/dapp/OriginCard";
import { useAccountSnapshot } from "@/hooks/useAccountSnapshot";
import { getDappRequest, isDappRequestOpen, rejectDappRequest, resolveDappRequest } from "@/lib/dapp/requestBridge";
import type { ConnectRequestPayload } from "@/lib/dapp/providerHandler";

interface ConnectPayload extends ConnectRequestPayload {
  requiredChainIds?: number[];
  optionalChainIds?: number[];
}

/**
 * Connection approval for the in-app browser and WalletConnect. Reads the pending request by
 * `requestId`, shows who is asking and which account they will see, and resolves the request with
 * the approved accounts (the provider layer persists the browser session / approves the WC session).
 */
export default function DappConnection() {
  const params = useLocalSearchParams<{ requestId?: string }>();
  const snapshot = useAccountSnapshot();
  const request = useMemo(() => getDappRequest<ConnectPayload>(params.requestId), [params.requestId]);
  const [decided, setDecided] = useState(false);

  // Leaving without deciding is a rejection.
  useEffect(() => {
    const id = params.requestId;
    return () => {
      if (id && isDappRequestOpen(id)) rejectDappRequest(id);
    };
  }, [params.requestId]);

  const account = request?.payload.accounts[0] ?? snapshot.activeAddress;
  const chainId = request?.payload.chainId ?? snapshot.chainId;
  const chainName = getChainDefinition(chainId)?.name ?? snapshot.chainName;
  const isWalletConnect = request?.meta.source === "walletconnect";
  const requiredChains = request?.payload.requiredChainIds ?? [];
  const insecure = request ? request.meta.source === "browser" && !request.meta.origin.startsWith("https://") : false;
  const canApprove = Boolean(request && account && !decided);

  const finish = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/apps");
  };

  const approve = () => {
    if (!request || !account) return;
    setDecided(true);
    resolveDappRequest(request.id, { accounts: [account.toLowerCase()] });
    finish();
  };

  const reject = () => {
    if (request) rejectDappRequest(request.id);
    setDecided(true);
    finish();
  };

  if (!request) {
    return (
      <PageContainer>
        <PageHeader title="Connect" showBack centerTitle />
        <View className="gap-5">
          <WarningCard
            severity="info"
            title="No pending connection request"
            detail="This screen opens when a site in the dapp browser or a WalletConnect app asks to connect. The request has already been answered or expired."
          />
          <Button variant="secondary" onPress={() => router.replace("/(tabs)/apps")}>
            Open Apps
          </Button>
        </View>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader title="Connect" showBack centerTitle onBack={reject} />

      <View className="gap-5">
        <Card hero>
          <OriginCard name={request.meta.name} origin={request.meta.origin} iconUrl={request.meta.iconUrl} source={request.meta.source} />
          <Text variant="body" muted className="mt-4">
            {isWalletConnect ? "This app wants to connect through WalletConnect." : "This site wants to connect to your wallet."} It will see
            your address and can ask you to approve transactions and sign messages. Every request is reviewed on this device first.
          </Text>
        </Card>

        {insecure ? (
          <WarningCard severity="critical" title="Not an https origin" detail="Connections are only safe over https. Reject this request." />
        ) : null}

        {snapshot.isWatchOnly ? (
          <WarningCard
            severity="warning"
            title="Watch-only account"
            detail="This account has no keys on this device. The site will see the address, but signing and transactions will be refused until you switch to a Minerva Account with keys."
          />
        ) : null}

        <Card>
          <Text variant="label" muted className="mb-2">
            Connect with
          </Text>
          <Row label="Account" value={snapshot.activeAccount?.label ?? "Minerva Account"} showChevron={false} />
          <View className="py-3 border-b border-mv-line">
            {account ? <AddressDisplay address={account as `0x${string}`} full /> : <Text muted>No account available</Text>}
          </View>
          <Row label="Network" value={chainName} showChevron={false} last={requiredChains.length === 0} />
          {requiredChains.length > 0 ? (
            <Row
              label="App requires"
              value={requiredChains.map((id) => getChainDefinition(id)?.name ?? `Chain ${id}`).join(", ")}
              showChevron={false}
              last
            />
          ) : null}
        </Card>

        <Card>
          <Text variant="label" muted className="mb-2">
            Permissions
          </Text>
          <Row label="See your address" detail="eth_accounts" showChevron={false} />
          <Row label="Ask you to approve transactions" detail="Each one is reviewed before it is sent" showChevron={false} />
          <Row label="Ask you to sign messages" detail="Signed as a Minerva ML-DSA-65 proof" showChevron={false} last />
        </Card>

        <View className="gap-3">
          <Button size="block" onPress={approve} disabled={!canApprove || insecure}>
            Connect
          </Button>
          <Button size="block" variant="secondary" onPress={reject}>
            Reject
          </Button>
        </View>
      </View>
    </PageContainer>
  );
}
