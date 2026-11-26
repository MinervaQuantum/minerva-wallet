import { Platform, View } from "react-native";
import { Globe, MonitorDown, Package, ShieldCheck } from "lucide-react-native";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Row } from "@/components/Row";
import { SettingsRow } from "@/components/SettingsRow";
import { Button } from "@/components/Button";
import { useAccountSnapshot } from "@/hooks/useAccountSnapshot";
import { readPublicEnv } from "@/lib/runtimeConfig";
import { openExternalUrl } from "@/lib/externalActions";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import {
  MINERVA_ACCOUNT_FACTORY,
  MINERVA_ACCOUNT_READINESS_REGISTRY,
  MINERVA_MLDSA65_PRECOMPILE,
  MINERVA_SECURITY_MODE_REGISTRY,
  MINERVA_TESTNET_EXPLORER_URL,
  defaultMinervaIndexerUrl,
} from "@minerva/evm";

const VERSION = readPublicEnv("EXPO_PUBLIC_MINERVA_WALLET_VERSION") ?? "0.0.27";
const RELEASES_URL = "https://testnet.minervachain.org/downloads/";
const CHROME_URL = "https://chromewebstore.google.com/detail/cjfhgclheennacdlpbmjopikfiaecmmn";
const SNAP_URL = "https://snapcraft.io/minerva-wallet";
const WINDOWS_URL = "https://apps.microsoft.com/store/detail/minerva-wallet";
const PRIVACY_URL = "https://minervachain.org/privacy";

export default function About() {
  const snapshot = useAccountSnapshot();
  const update = useUpdateCheck();
  const updateDetail =
    update.status === "checking"
      ? "Checking the signed release manifest…"
      : update.status === "error"
        ? `Could not be checked (${update.message})`
        : update.result.updateAvailable
          ? `Update available: ${update.result.latest} (installed ${update.result.current})`
          : `Up to date (${update.result.current})`;
  const indexerUrl = readPublicEnv("EXPO_PUBLIC_MINERVA_INDEXER_URL") ?? defaultMinervaIndexerUrl(snapshot.chainId);

  return (
    <PageContainer>
      <PageHeader title="About" showBack centerTitle />

      <View className="gap-5">
        <Card>
          <Text variant="title" weight="semibold">
            Minerva Wallet
          </Text>
          <Text variant="body" muted className="mt-2">
            PQ-native wallet for Minerva Accounts on Minerva Network.
          </Text>
          <View className="mt-4">
            <Row label="Version" value={VERSION} showChevron={false} />
            <Row label="Build target" value={Platform.OS} showChevron={false} />
            <Row label="Chain" value={`${snapshot.chainName} (${snapshot.chainId})`} showChevron={false} last />
          </View>
        </Card>

        <Card>
          <Text variant="label" muted className="mb-2">
            Network config
          </Text>
          <Row label="RPC" value={snapshot.rpcUrl ?? "Default"} showChevron={false} />
          <Row label="Indexer" value={indexerUrl} showChevron={false} />
          <Row label="Explorer" value={MINERVA_TESTNET_EXPLORER_URL || "Not available yet"} showChevron={false} last />
        </Card>

        <Card>
          <Text variant="label" muted className="mb-2">
            System addresses
          </Text>
          <Row label="ML-DSA-65" value={`${MINERVA_MLDSA65_PRECOMPILE.slice(0, 10)}...${MINERVA_MLDSA65_PRECOMPILE.slice(-4)}`} showChevron={false} />
          <Row label="Security modes" value={`${MINERVA_SECURITY_MODE_REGISTRY.slice(0, 10)}...${MINERVA_SECURITY_MODE_REGISTRY.slice(-4)}`} showChevron={false} />
          <Row label="Readiness" value={`${MINERVA_ACCOUNT_READINESS_REGISTRY.slice(0, 10)}...${MINERVA_ACCOUNT_READINESS_REGISTRY.slice(-4)}`} showChevron={false} />
          <Row label="Account factory" value={`${MINERVA_ACCOUNT_FACTORY.slice(0, 10)}...${MINERVA_ACCOUNT_FACTORY.slice(-4)}`} showChevron={false} last />
        </Card>

        <View>
          <SettingsRow
            Icon={MonitorDown}
            iconColor="green"
            label="Check for updates"
            detail={updateDetail}
            onPress={() => openExternalUrl(RELEASES_URL)}
          />
          <SettingsRow
            Icon={Globe}
            iconColor="gray"
            label="Privacy Policy"
            detail="minervachain.org/privacy"
            onPress={() => openExternalUrl(PRIVACY_URL)}
          />
          <SettingsRow Icon={Package} iconColor="gray" label="Chrome Web Store" detail="Browser extension" onPress={() => openExternalUrl(CHROME_URL)} />
          <SettingsRow Icon={Package} iconColor="gray" label="Snap Store" detail="Ubuntu desktop package" onPress={() => openExternalUrl(SNAP_URL)} />
          <SettingsRow Icon={Package} iconColor="gray" label="Windows Store" detail="Desktop package listing" onPress={() => openExternalUrl(WINDOWS_URL)} />
        </View>

        <Card>
          <View className="flex-row items-start gap-3">
            <ShieldCheck size={20} color="#e1e5fb" />
            <Text variant="caption" muted className="flex-1">
              No crash-reporting SDK is enabled in this build. Debug bundles are local/export-only and must not include
              passcodes, private keys, Recovery Kits, or encrypted vault blobs.
            </Text>
          </View>
          <View className="mt-4">
            <Button variant="secondary" size="block" onPress={() => openExternalUrl(RELEASES_URL)}>
              View releases
            </Button>
          </View>
        </Card>
      </View>
    </PageContainer>
  );
}
