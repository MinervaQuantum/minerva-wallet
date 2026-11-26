import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";
import { Check, Eye, Plus } from "lucide-react-native";
import type { Hex } from "@minerva/core";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { WarningCard } from "@/components/WarningCard";
import { useAccountSnapshot } from "@/hooks/useAccountSnapshot";
import { accountAddress, listAccounts, setActiveAccount, type WalletAccountRecord } from "@/lib/accounts";
import { onWalletChange } from "@/lib/walletEvents";
import { colors } from "@minerva/ui-tokens";

interface Row extends WalletAccountRecord {
  resolvedAddress?: Hex;
}

/** Every account in the keyring: ML-DSA accounts in their own slots plus watch-only addresses. */
export default function Accounts() {
  const snapshot = useAccountSnapshot();
  const [rows, setRows] = useState<Row[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [switching, setSwitching] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    const accounts = await listAccounts({ includeHidden: true });
    const resolved = await Promise.all(accounts.map(async (a) => ({ ...a, resolvedAddress: await accountAddress(a) })));
    setRows(resolved);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => onWalletChange(() => void load()), [load]);

  const activeId = snapshot.activeAccount?.id;
  const visible = rows.filter((r) => showHidden || !r.hidden);
  const hiddenCount = rows.filter((r) => r.hidden).length;

  const switchTo = async (id: string) => {
    if (id === activeId) return;
    setSwitching(id);
    setError(undefined);
    try {
      await setActiveAccount(id, snapshot.chainId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not switch account");
    } finally {
      setSwitching(undefined);
    }
  };

  return (
    <PageContainer>
      <PageHeader title="Accounts" />

      <View className="gap-5">
        <Text variant="body" muted>
          Accounts share one passcode. Each ML-DSA account has its own key and address; watch-only
          addresses show balances and activity but cannot sign.
        </Text>

        {error ? <WarningCard severity="review" title="Account switch failed" detail={error} /> : null}

        <View className="gap-3">
          {visible.map((row) => {
            const active = row.id === activeId;
            const address = row.resolvedAddress;
            return (
              <Pressable key={row.id} onPress={() => switchTo(row.id)} disabled={switching !== undefined}>
                <Card className={active ? "border-mv-line-strong" : undefined}>
                  <View className="flex-row items-center gap-3">
                    <View className="w-9 h-9 rounded-pill border border-mv-line items-center justify-center bg-mv-ink">
                      {active ? <Check size={16} color={colors.text} /> : row.kind === "watch" ? <Eye size={16} color={colors.textMuted} /> : null}
                    </View>
                    <View className="flex-1">
                      <View className="flex-row items-center gap-2">
                        <Text variant="body-lg" weight="semibold" numberOfLines={1} className="flex-shrink">
                          {row.label}
                        </Text>
                        {row.kind === "watch" ? <Badge label="Watch-only" /> : null}
                        {row.hidden ? <Badge label="Hidden" /> : null}
                      </View>
                      <Text variant="caption" muted className="mt-0.5">
                        {address ? `${address.slice(0, 8)}…${address.slice(-6)}` : "Address unavailable"}
                      </Text>
                      {active ? (
                        <Text variant="caption" muted className="mt-1">
                          {snapshot.status === "loading" ? "Loading balance…" : `${snapshot.balanceLabel} · ${snapshot.chainName}`}
                        </Text>
                      ) : null}
                    </View>
                    <Pressable
                      hitSlop={8}
                      onPress={() => router.push({ pathname: "/account-detail", params: { id: row.id } } as Href)}
                      className="h-9 rounded-pill border border-mv-line px-3 items-center justify-center"
                    >
                      <Text variant="caption" weight="medium">
                        {switching === row.id ? "…" : "Manage"}
                      </Text>
                    </Pressable>
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>

        {rows.length === 0 ? (
          <WarningCard severity="info" title="No accounts yet" detail="Create a wallet from onboarding, then add more accounts here." />
        ) : null}

        <View className="flex-row gap-3">
          <Button className="flex-1" onPress={() => router.push("/add-account" as Href)}>
            <View className="flex-row items-center gap-2">
              <Plus size={16} color={colors.background} />
              <Text variant="body-lg" weight="medium" style={{ color: colors.background }}>
                Add account
              </Text>
            </View>
          </Button>
          {hiddenCount > 0 ? (
            <Button variant="secondary" className="flex-1" onPress={() => setShowHidden((v) => !v)}>
              {showHidden ? "Hide hidden" : `Show hidden (${hiddenCount})`}
            </Button>
          ) : null}
        </View>
      </View>
    </PageContainer>
  );
}
