import { View } from "react-native";
import { router } from "expo-router";
import { Repeat } from "lucide-react-native";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Row } from "@/components/Row";
import { Button } from "@/components/Button";
import { WarningCard } from "@/components/WarningCard";
import { useAccountSnapshot } from "@/hooks/useAccountSnapshot";
import { colors } from "@minerva/ui-tokens";

const BRIDGE_SYSTEM_CONTRACTS = [
  { label: "Message registry", value: "not deployed" },
  { label: "Guardian verifier", value: "not deployed" },
  { label: "Native bridge vault", value: "not deployed" },
];

/** Honest state: the bridge contracts are built and tested but not deployed on this
 *  testnet, and there is no wallet-ready bridge service yet. */
export default function Bridge() {
  const snapshot = useAccountSnapshot();

  return (
    <PageContainer>
      <PageHeader title="Bridge" showBack centerTitle />

      <View className="gap-5">
        <View className="items-center gap-3 py-6">
          <View className="w-16 h-16 rounded-pill bg-mv-panel border border-mv-line items-center justify-center">
            <Repeat size={26} color={colors.text} />
          </View>
          <Text variant="title" weight="semibold" className="text-center">
            Bridge — coming soon
          </Text>
          <Text variant="body" muted className="text-center">
            {snapshot.chainName} has bridge system contracts reserved, but Minerva Wallet does not have a
            wallet bridge API yet. Routes, fees, amount out, confirmations, refunds, and progress stay hidden
            until they can be sourced live.
          </Text>
        </View>

        <Card>
          <Text variant="label" muted className="mb-2">
            Network readiness
          </Text>
          {BRIDGE_SYSTEM_CONTRACTS.map((item, index) => (
            <Row
              key={item.label}
              label={item.label}
              value={item.value}
              showChevron={false}
              last={index === BRIDGE_SYSTEM_CONTRACTS.length - 1}
            />
          ))}
        </Card>

        <Card>
          <Text variant="label" muted className="mb-2">
            Wallet bridge API
          </Text>
          <Row label="Routes" value="Coming soon" showChevron={false} />
          <Row label="Fees / amount out" value="Unavailable" showChevron={false} />
          <Row label="Refunds" value="Unavailable" showChevron={false} last />
        </Card>

        <WarningCard
          severity="info"
          title="Why this is empty"
          detail="Bridge actions are disabled until a real bridge API is available. No mock liquidity, fees, confirmations, or refunds are displayed."
        />

        <View className="items-center">
          <Button variant="secondary" onPress={() => router.replace("/(tabs)/home")}>
            Back to Home
          </Button>
        </View>
      </View>
    </PageContainer>
  );
}
