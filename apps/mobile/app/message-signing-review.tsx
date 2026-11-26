import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { getChainDefinition } from "@minerva/evm";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Row } from "@/components/Row";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { WarningCard } from "@/components/WarningCard";
import { AddressDisplay } from "@/components/AddressDisplay";
import { OriginCard } from "@/components/dapp/OriginCard";
import { useAccountSnapshot } from "@/hooks/useAccountSnapshot";
import { requireUnlockedWalletProfile } from "@/lib/pqDevWallet";
import { DappRequestRejectedError, getDappRequest, isDappRequestOpen, rejectDappRequest, resolveDappRequest } from "@/lib/dapp/requestBridge";
import type { SignRequestPayload } from "@/lib/dapp/providerHandler";
import { decodeMessageForReview, isTypedDataMethod, messagePayloadFromParams, signMinervaMessageProof, type DecodedMessage } from "@/lib/dapp/signing";

function stringify(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Signature review for dapp requests (browser + WalletConnect). Shows the requesting origin, the
 * decoded message (UTF-8 text for personal_sign, structured EIP-712 for typed data), permit-style
 * warnings, and signs with the account's ML-DSA-65 key exactly as the browser extension does,
 * returning a MinervaMessageProof to the dapp.
 */
export default function MessageSigningReview() {
  const params = useLocalSearchParams<{ requestId?: string }>();
  const snapshot = useAccountSnapshot();
  const request = useMemo(() => getDappRequest<SignRequestPayload>(params.requestId), [params.requestId]);
  const [showRaw, setShowRaw] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    const id = params.requestId;
    return () => {
      if (id && isDappRequestOpen(id)) rejectDappRequest(id);
    };
  }, [params.requestId]);

  const chainId = request?.payload.chainId ?? snapshot.chainId;
  const chainName = getChainDefinition(chainId)?.name ?? snapshot.chainName;

  const decoded = useMemo<{ message?: DecodedMessage; error?: string }>(() => {
    if (!request) return {};
    try {
      const payload = messagePayloadFromParams(request.payload.method, request.payload.params, request.payload.account);
      return { message: decodeMessageForReview(request.payload.method, payload, chainId) };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : "Could not read the message." };
    }
  }, [request, chainId]);

  const typed = request ? isTypedDataMethod(request.payload.method) : false;
  const accountMismatch = Boolean(request && snapshot.activeAddress && request.payload.account.toLowerCase() !== snapshot.activeAddress.toLowerCase());
  const blocked = Boolean(decoded.error) || snapshot.isWatchOnly || accountMismatch;
  const critical = decoded.message?.warnings.some((w) => w.severity === "critical") ?? false;

  const finish = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/apps");
  };

  const reject = () => {
    if (request) rejectDappRequest(request.id);
    finish();
  };

  const sign = () => {
    if (!request || blocked || signing) return;
    setError(undefined);
    setSigning(true);
    try {
      let profile;
      try {
        profile = requireUnlockedWalletProfile(chainId);
      } catch {
        // The wallet is locked: hand the dapp a retryable 4100 and send the user to unlock. Keeping
        // the request open under the unlock screen would strand it, so it is rejected explicitly.
        setSigning(false);
        rejectDappRequest(request.id, new DappRequestRejectedError("Minerva Wallet is locked. Unlock it and retry the signature request.", 4100));
        router.replace("/unlock");
        return;
      }
      const proof = signMinervaMessageProof(profile, request.payload.method, request.payload.params, request.payload.account, chainId);
      resolveDappRequest(request.id, proof);
      finish();
    } catch (cause) {
      setSigning(false);
      setError(cause instanceof Error ? cause.message : "Signing failed.");
    }
  };

  if (!request) {
    return (
      <PageContainer>
        <PageHeader title="Sign" showBack centerTitle />
        <View className="gap-5">
          <WarningCard
            severity="info"
            title="No signature request"
            detail="This screen opens when a connected app asks for a signature. The request has already been answered or expired."
          />
          <Button variant="secondary" onPress={() => router.replace("/(tabs)/apps")}>
            Open Apps
          </Button>
        </View>
      </PageContainer>
    );
  }

  const view = decoded.message?.typedData;

  return (
    <PageContainer>
      <PageHeader title={typed ? "Sign typed data" : "Sign message"} showBack centerTitle onBack={reject} />

      <View className="gap-5">
        <Card hero>
          <OriginCard name={request.meta.name} origin={request.meta.origin} iconUrl={request.meta.iconUrl} source={request.meta.source} />
          <View className="flex-row items-center gap-2 mt-4">
            <Badge label={request.payload.method} color="neutral" />
            <Badge label="ML-DSA-65 proof" color="review" />
          </View>
        </Card>

        {decoded.error ? <WarningCard severity="critical" title="Request cannot be signed" detail={decoded.error} /> : null}
        {snapshot.isWatchOnly ? (
          <WarningCard severity="critical" title="Watch-only account" detail="This account has no keys on this device, so it cannot sign. Switch to a Minerva Account with keys." />
        ) : null}
        {accountMismatch ? (
          <WarningCard severity="warning" title="Active account changed" detail="The request was made for a different account than the one that is now active. Reject it and let the app ask again." />
        ) : null}
        {decoded.message?.warnings.map((warning, index) => (
          <WarningCard key={`${warning.title}-${index}`} severity={warning.severity} title={warning.title} detail={warning.detail} />
        ))}

        <Card>
          <Text variant="label" muted className="mb-2">
            Message
          </Text>
          {view ? (
            <View className="gap-3">
              <View className="flex-row flex-wrap gap-2">
                {view.primaryType ? <Badge label={`primaryType: ${view.primaryType}`} color={critical ? "warning" : "positive"} /> : null}
                {view.domain?.name ? <Badge label={`domain: ${String(view.domain.name)}`} color="neutral" /> : null}
                {view.domain?.chainId !== undefined ? <Badge label={`chain ${String(view.domain.chainId)}`} color="neutral" /> : null}
              </View>
              {view.domain?.verifyingContract ? (
                <Row label="Verifying contract" value={String(view.domain.verifyingContract)} showChevron={false} />
              ) : null}
              {view.message && typeof view.message === "object" && !Array.isArray(view.message) ? (
                Object.entries(view.message as Record<string, unknown>).map(([key, value], index, all) => (
                  <Row key={key} label={key} value={stringify(value).slice(0, 160)} showChevron={false} last={index === all.length - 1} />
                ))
              ) : (
                <Text variant="mono" className="text-caption">
                  {stringify(view.message)}
                </Text>
              )}
            </View>
          ) : (
            <ScrollView horizontal={false} style={{ maxHeight: 260 }} nestedScrollEnabled>
              <Text variant={decoded.message?.kind === "hex" ? "mono" : "body"} selectable>
                {decoded.message?.display ?? "—"}
              </Text>
            </ScrollView>
          )}
          <Pressable onPress={() => setShowRaw((v) => !v)} className="mt-4">
            <Text variant="label" muted>
              {showRaw ? "Hide raw payload" : "Show raw payload"}
            </Text>
          </Pressable>
          {showRaw ? (
            <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled className="mt-2 bg-mv-ink rounded-md p-3 border border-mv-line">
              <Text variant="mono" selectable className="text-caption">
                {view ? view.prettyJson : decoded.message?.raw ?? ""}
              </Text>
            </ScrollView>
          ) : null}
        </Card>

        <Card>
          <Text variant="label" muted className="mb-2">
            Signing with
          </Text>
          <Row label="Account" value={snapshot.activeAccount?.label ?? "Minerva Account"} showChevron={false} />
          <View className="py-3 border-b border-mv-line">
            <AddressDisplay address={request.payload.account as `0x${string}`} full />
          </View>
          <Row label="Network" value={chainName} showChevron={false} />
          <Row
            label="Result"
            detail="A Minerva message proof: keccak-256 of the message, signed by your ML-DSA-65 key. Not an ECDSA signature."
            showChevron={false}
            last
          />
        </Card>

        {error ? <WarningCard severity="warning" title="Could not sign" detail={error} /> : null}

        <View className="gap-3">
          <Button size="block" variant={critical ? "danger" : "primary"} onPress={sign} disabled={blocked || signing}>
            {signing ? "Signing…" : critical ? "Sign anyway" : "Sign"}
          </Button>
          <Button size="block" variant="secondary" onPress={reject}>
            Reject
          </Button>
        </View>
      </View>
    </PageContainer>
  );
}
