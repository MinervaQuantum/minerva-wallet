import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { WarningCard } from "@/components/WarningCard";
import { useWalletConnect } from "@/lib/dapp/useDappSessions";
import { isWalletConnectUri, pairWalletConnect } from "@/lib/dapp/walletconnect";

async function readClipboard(): Promise<string> {
  if (Platform.OS === "web") {
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) return navigator.clipboard.readText();
    return "";
  }
  return Clipboard.getStringAsync();
}

/** Pair with a WalletConnect v2 dapp by scanning its QR code or pasting the wc: URI. */
export default function WalletConnectPair() {
  const params = useLocalSearchParams<{ uri?: string }>();
  const wc = useWalletConnect(true);
  const [permission, requestPermission] = useCameraPermissions();
  const [uri, setUri] = useState(params.uri ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [paired, setPaired] = useState(false);

  const pair = async (candidate: string) => {
    if (busy) return;
    setError(undefined);
    if (!isWalletConnectUri(candidate)) {
      setError("That is not a WalletConnect v2 URI. It should start with wc: and contain @2.");
      return;
    }
    setBusy(true);
    try {
      await pairWalletConnect(candidate);
      setPaired(true);
      // The dapp's session proposal arrives next and opens /dapp-connection on its own.
      setTimeout(() => {
        if (router.canGoBack()) router.back();
        else router.replace("/(tabs)/apps");
      }, 400);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (params.uri && wc.configured && wc.status === "ready") void pair(params.uri);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.uri, wc.configured, wc.status]);

  const handleScan = ({ data }: BarcodeScanningResult) => {
    if (busy || paired) return;
    if (!isWalletConnectUri(data)) {
      setError("That QR code is not a WalletConnect v2 pairing code.");
      return;
    }
    setUri(data);
    void pair(data);
  };

  const canUseCamera = Platform.OS !== "web" && permission?.granted;

  if (!wc.configured) {
    return (
      <PageContainer>
        <PageHeader title="WalletConnect" showBack centerTitle />
        <View className="gap-5">
          <WarningCard
            severity="info"
            title="WalletConnect is not configured in this build"
            detail="Set EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID (a Reown Cloud project id) at build time to enable pairing. The in-app browser works without it."
          />
          <Button variant="secondary" onPress={() => router.back()}>
            Back
          </Button>
        </View>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader title="WalletConnect" showBack centerTitle />

      <View className="gap-5">
        {wc.status === "error" ? <WarningCard severity="warning" title="WalletConnect could not start" detail={wc.error ?? "Unknown error"} /> : null}
        {wc.status === "initialising" ? <WarningCard severity="info" title="Starting WalletConnect" detail="Connecting to the relay…" /> : null}

        {canUseCamera ? (
          <View className="overflow-hidden rounded-xl border border-mv-line bg-mv-panel aspect-square">
            <CameraView facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={handleScan} style={{ flex: 1 }} />
          </View>
        ) : (
          <Card>
            <Text variant="body-lg" weight="semibold">
              Scan the dapp's QR code
            </Text>
            <Text variant="body" muted className="mt-2">
              {Platform.OS === "web"
                ? "Camera scanning is available in native mobile builds. Paste the wc: URI below instead."
                : permission?.canAskAgain === false
                  ? "Camera permission is blocked in system settings. Paste the wc: URI below."
                  : "Grant camera access to scan the WalletConnect QR code shown by the dapp."}
            </Text>
            {Platform.OS !== "web" && permission?.canAskAgain !== false ? (
              <View className="mt-4">
                <Button onPress={requestPermission}>Allow camera</Button>
              </View>
            ) : null}
          </Card>
        )}

        {error ? <WarningCard severity="warning" title="Pairing failed" detail={error} /> : null}
        {paired ? <WarningCard severity="info" title="Pairing sent" detail="Approve the connection when the app's request appears." /> : null}

        <Card>
          <Input label="Or paste a wc: URI" placeholder="wc:…@2?relay-protocol=irn&symKey=…" value={uri} onChangeText={setUri} autoCapitalize="none" autoCorrect={false} />
          <View className="flex-row gap-3 mt-4">
            <View className="flex-1">
              <Button
                size="block"
                variant="secondary"
                onPress={() => {
                  void readClipboard()
                    .then((text) => {
                      if (text) setUri(text.trim());
                    })
                    .catch(() => undefined);
                }}
              >
                Paste
              </Button>
            </View>
            <View className="flex-1">
              <Button size="block" onPress={() => void pair(uri)} disabled={busy || wc.status !== "ready"}>
                {busy ? "Pairing…" : "Connect"}
              </Button>
            </View>
          </View>
        </Card>

        <Text variant="caption" muted>
          WalletConnect lets desktop and other-device dapps talk to this wallet. Connections and every request are approved here, and signatures
          are Minerva ML-DSA-65 proofs, the same as in the browser extension.
        </Text>
      </View>
    </PageContainer>
  );
}
