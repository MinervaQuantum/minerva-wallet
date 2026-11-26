import { Pressable, View } from "react-native";
import { router, type Href } from "expo-router";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Image as ImageIcon, ShieldCheck, Repeat, User } from "lucide-react-native";
import { PageContainer } from "@/components/PageContainer";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { IconAction } from "@/components/IconAction";
import { WarningCard } from "@/components/WarningCard";
import { AddressDisplay } from "@/components/AddressDisplay";
import { HeroCard } from "@/components/HeroCard";
import { Row } from "@/components/Row";
import { Button } from "@/components/Button";
import { PendingCard } from "@/components/PendingCard";
import { useAccountSnapshot } from "@/hooks/useAccountSnapshot";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import { readinessScore } from "@minerva/core";
import { formatTokenUnits } from "@minerva/evm";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import { openExternalUrl } from "@/lib/externalActions";
import { colors } from "@minerva/ui-tokens";

/** Live Home — account, balances (native + tracked ERC-20s), pending queue, security. No mock data. */
export default function Home() {
  const snapshot = useAccountSnapshot();
  const update = useUpdateCheck();
  const tokens = useTokenBalances({
    chainId: snapshot.chainId,
    rpcUrl: snapshot.rpcUrl,
    indexerUrl: snapshot.indexerUrl,
    address: snapshot.activeAddress,
    enabled: snapshot.accountReady,
  });
  const { account } = snapshot;
  const score = readinessScore(account.security);
  const live = snapshot.status === "live";
  const loading = snapshot.status === "loading";
  const accountReady = snapshot.accountReady;
  const walletUnlocked = snapshot.walletStatus === "unlocked";
  const watchOnly = snapshot.isWatchOnly;
  const balanceIsZero = (snapshot.balanceWei ?? 0n) === 0n;
  const hasAnyToken = tokens.visible.some((t) => t.balance > 0n);

  return (
    <PageContainer>
      <View className="pt-4 gap-6">
        <View className="flex-row items-center justify-between">
          <Pressable onPress={() => router.push("/(tabs)/accounts")} className="flex-1 pr-3">
            <Text variant="label" muted>
              01 / Account
            </Text>
            <View className="flex-row items-center gap-2 mt-1">
              <Text variant="page-title" weight="medium" numberOfLines={1} className="flex-shrink">
                {account.label}
              </Text>
              <ChevronRight size={18} color={colors.textMuted} />
            </View>
          </Pressable>
          <Pressable
            onPress={() => router.push("/notifications" as Href)}
            className="w-12 h-12 rounded-pill bg-mv-panel border border-mv-line items-center justify-center"
          >
            <User size={22} color={colors.text} />
          </Pressable>
        </View>

        {update.status === "ok" && update.result.updateAvailable ? (
          <Pressable onPress={() => openExternalUrl(update.result.manifest.baseUrl)}>
            <WarningCard
              severity="info"
              title={`Minerva Wallet ${update.result.latest} is available`}
              detail={`Installed ${update.result.current}. Downloads carry SHA256SUMS signed with ML-DSA-65.`}
            />
          </Pressable>
        ) : null}

        <View className="flex-row gap-3">
          <HeroCard title={account.label} subtitle={watchOnly ? "WATCH-ONLY" : "MINERVA ACCOUNT"} tone="primary" onPress={() => router.push("/(tabs)/accounts")}>
            {accountReady ? (
              <AddressDisplay address={account.address} />
            ) : (
              <Text variant="caption" muted>
                Loading account…
              </Text>
            )}
          </HeroCard>
          <HeroCard title={watchOnly ? "—" : `${score}/100`} subtitle="QUANTUM READINESS" tone="dark" onPress={() => router.push("/(tabs)/security")}>
            <Badge label={watchOnly ? "Read-only" : account.security.mode} />
          </HeroCard>
        </View>

        <View className="flex-row items-baseline justify-between">
          <Text variant="label" muted>
            Balance
          </Text>
          <Text variant="section" weight="medium">
            {loading ? "…" : snapshot.balanceLabel}
          </Text>
        </View>

        <PendingCard
          items={snapshot.pending}
          canManage={walletUnlocked}
          onSpeedUp={snapshot.speedUpTransaction}
          onCancel={snapshot.cancelTransaction}
        />

        <Card>
          <Text variant="label" muted className="mb-3">
            Network
          </Text>
          <Row label="Chain" value={snapshot.chainName} onPress={() => router.push("/networks" as Href)} />
          <Row label="Deployment" value={snapshot.deploymentLabel} showChevron={false} />
          <Row label="Readiness" value={snapshot.readinessLabel} showChevron={false} />
          <Row label="Latest block" value={snapshot.latestBlock ?? "—"} showChevron={false} last />
        </Card>

        <View className="flex-row gap-3">
          <IconAction label="Send" Icon={ArrowUpRight} onPress={() => router.push("/send")} disabled={!accountReady || watchOnly} />
          <IconAction label="Receive" Icon={ArrowDownLeft} onPress={() => router.push("/receive")} disabled={!accountReady} />
          <IconAction label="Bridge" Icon={Repeat} onPress={() => router.push("/bridge")} />
          <IconAction label="Secure" Icon={ShieldCheck} onPress={() => router.push("/(tabs)/security")} />
        </View>

        {!live && !loading ? (
          <WarningCard
            severity="review"
            title="Offline — showing last known state"
            detail={snapshot.error ?? "Couldn't reach the Minerva RPC. Check your network or RPC URL."}
          />
        ) : null}
        {watchOnly ? (
          <WarningCard severity="info" title="Watch-only account" detail="Balances and activity are live. Switch to a key-backed account to send or sign." />
        ) : null}
        {accountReady && !walletUnlocked && !watchOnly ? (
          <View className="gap-3">
            <WarningCard
              severity="info"
              title="Wallet locked"
              detail="Balance and address are loaded from the encrypted profile preview. Unlock when you need to sign."
            />
            <Button size="block" variant="secondary" onPress={() => router.push("/unlock")}>
              Unlock Wallet
            </Button>
          </View>
        ) : null}
        {!watchOnly && account.security.recovery !== "active" ? (
          <WarningCard severity="review" title="Recovery not configured" detail="Back up your Minerva Recovery Kit before moving significant funds." />
        ) : null}

        <View>
          <View className="flex-row items-center justify-between mb-3">
            <Text variant="label" muted>
              Tokens
            </Text>
            <Pressable onPress={() => router.push("/tokens" as Href)} hitSlop={8}>
              <Text variant="caption" weight="medium">
                Manage
              </Text>
            </Pressable>
          </View>
          <Card>
            <Row
              label={snapshot.nativeCurrencySymbol}
              detail={snapshot.chainName}
              value={loading ? "…" : snapshot.balanceNative}
              showChevron={false}
              last={tokens.visible.length === 0}
            />
            {tokens.visible.map((token, index) => (
              <Row
                key={token.address}
                label={token.symbol}
                detail={token.name}
                value={token.error ? "—" : formatTokenUnits(token.balance, token.decimals)}
                onPress={() => router.push({ pathname: "/token-detail", params: { address: token.address } } as Href)}
                last={index === tokens.visible.length - 1}
              />
            ))}
          </Card>
          {balanceIsZero && !hasAnyToken && live ? (
            <Text variant="caption" muted className="mt-2">
              Your smart account is ready. Request {snapshot.nativeCurrencySymbol} from the faucet or receive at your Minerva 0x address.
            </Text>
          ) : null}
          {tokens.status === "loading" && tokens.tokens.length === 0 ? (
            <Text variant="caption" muted className="mt-2">
              Looking for tokens…
            </Text>
          ) : null}
        </View>

        <Pressable onPress={() => router.push("/nfts" as Href)}>
          <Card>
            <View className="flex-row items-center gap-3">
              <View className="w-11 h-11 rounded-md bg-mv-ink border border-mv-line items-center justify-center">
                <ImageIcon size={20} color={colors.text} />
              </View>
              <View className="flex-1">
                <Text variant="body-lg" weight="medium">
                  Collectibles
                </Text>
                <Text variant="caption" muted className="mt-0.5">
                  ERC-721 and ERC-1155 items held by this account
                </Text>
              </View>
              <ChevronRight size={20} color={colors.textMuted} />
            </View>
          </Card>
        </Pressable>
      </View>
    </PageContainer>
  );
}
