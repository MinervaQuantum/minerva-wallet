import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { Activity as ActivityIcon, AppWindow, BookUser, KeyRound, ShieldCheck, Wallet } from "lucide-react-native";
import type { Hex } from "@minerva/core";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { HeroCard } from "@/components/HeroCard";
import { Card } from "@/components/Card";
import { Row } from "@/components/Row";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { SettingsRow } from "@/components/SettingsRow";
import { AddressDisplay } from "@/components/AddressDisplay";
import { Badge } from "@/components/Badge";
import { WarningCard } from "@/components/WarningCard";
import { useAccountSnapshot } from "@/hooks/useAccountSnapshot";
import {
  accountAddress,
  listAccounts,
  moveAccount,
  removeAccount,
  renameAccount,
  setAccountHidden,
  setActiveAccount,
  type WalletAccountRecord,
} from "@/lib/accounts";
import { onWalletChange } from "@/lib/walletEvents";

/** Detail and management of one account: rename, hide, reorder, remove, plus the live data when active. */
export default function AccountDetail() {
  const snapshot = useAccountSnapshot();
  const params = useLocalSearchParams<{ id?: string }>();
  const [record, setRecord] = useState<WalletAccountRecord | undefined>();
  const [address, setAddress] = useState<Hex | undefined>();
  const [count, setCount] = useState(0);
  const [label, setLabel] = useState("");
  const [removeArmed, setRemoveArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    const all = await listAccounts({ includeHidden: true });
    setCount(all.length);
    const found = params.id ? all.find((a) => a.id === params.id) : all.find((a) => a.id === snapshot.activeAccount?.id) ?? all[0];
    setRecord(found);
    if (found) {
      setLabel(found.label);
      setAddress(await accountAddress(found));
    }
  }, [params.id, snapshot.activeAccount?.id]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => onWalletChange(() => void load()), [load]);

  const isActive = Boolean(record && record.id === snapshot.activeAccount?.id);
  const account = snapshot.account;
  const badge = record?.kind === "watch" ? "Watch-only" : isActive ? (account.deployed ? account.security.mode : "Counterfactual") : "ML-DSA account";

  const run = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      await action();
      if (done) setNote(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  if (!record) {
    return (
      <PageContainer>
        <PageHeader title="Account" showBack centerTitle />
        <WarningCard severity="info" title="Account not found" detail="It may have been removed. Go back to the accounts list." />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader title="Account" showBack centerTitle />

      <View className="gap-5">
        <HeroCard title={record.label} subtitle={badge} tone={isActive ? "green" : "dark"}>
          {address ? (
            <AddressDisplay address={address} />
          ) : (
            <Text variant="caption" className="text-background opacity-80">
              Address unavailable
            </Text>
          )}
          {isActive ? (
            <View className="flex-row items-center justify-between mt-4">
              <Text variant="caption" className="text-background opacity-80">
                Balance
              </Text>
              <Text variant="body" weight="semibold" className="text-background">
                {snapshot.balanceLabel}
              </Text>
            </View>
          ) : null}
        </HeroCard>

        {!isActive ? (
          <Button size="block" onPress={() => run(() => setActiveAccount(record.id, snapshot.chainId), "Switched")} disabled={busy}>
            Use this account
          </Button>
        ) : null}

        {isActive && record.kind === "pq" && !account.deployed ? (
          <WarningCard
            severity="info"
            title="Counterfactual address"
            detail="The address is derived and reserved. It deploys on chain on the first PQ action."
          />
        ) : null}

        {note ? <WarningCard severity="info" title={note} /> : null}
        {error ? <WarningCard severity="warning" title="Could not update account" detail={error} /> : null}

        <Card>
          <Text variant="label" muted className="mb-3">
            Manage
          </Text>
          <View className="gap-3">
            <Input label="Name" value={label} onChangeText={setLabel} />
            <Button
              variant="secondary"
              size="block"
              disabled={busy || label.trim() === record.label || label.trim().length === 0}
              onPress={() => run(() => renameAccount(record.id, label), "Renamed")}
            >
              Save name
            </Button>
            <View className="flex-row gap-2">
              <Button variant="secondary" className="flex-1 px-2" disabled={busy || record.order === 0} onPress={() => run(() => moveAccount(record.id, -1))}>
                Move up
              </Button>
              <Button
                variant="secondary"
                className="flex-1 px-2"
                disabled={busy || record.order >= count - 1}
                onPress={() => run(() => moveAccount(record.id, 1))}
              >
                Move down
              </Button>
              <Button
                variant="secondary"
                className="flex-1 px-2"
                disabled={busy || (isActive && !record.hidden)}
                onPress={() => run(() => setAccountHidden(record.id, !record.hidden), record.hidden ? "Shown" : "Hidden")}
              >
                {record.hidden ? "Show" : "Hide"}
              </Button>
            </View>
          </View>
          <View className="mt-4">
            <Row label="Type" value={record.kind === "watch" ? "Watch-only address" : "ML-DSA-65 account"} showChevron={false} />
            <Row label="Added" value={new Date(record.createdAt).toLocaleDateString()} showChevron={false} last />
          </View>
        </Card>

        {isActive && record.kind === "pq" ? (
          <View>
            <SettingsRow Icon={Wallet} label="Balance" detail={snapshot.balanceLabel} onPress={() => router.push("/(tabs)/home")} />
            <SettingsRow
              Icon={Wallet}
              label="Network"
              detail={`${snapshot.chainName} · ${snapshot.nativeCurrencySymbol}`}
              onPress={() => router.push("/networks" as Href)}
            />
            <SettingsRow Icon={ActivityIcon} label="Activity" detail="Transactions and security events" onPress={() => router.push("/(tabs)/activity")} />
            <SettingsRow Icon={AppWindow} label="Connected apps" detail="Browser sessions and WalletConnect" onPress={() => router.push("/(tabs)/apps")} />
            <SettingsRow
              Icon={ShieldCheck}
              label="Security mode"
              detail={account.deployed ? snapshot.readinessLabel : `${snapshot.readinessLabel} · ${snapshot.deploymentLabel}`}
              onPress={() => router.push("/(tabs)/security")}
            />
            <SettingsRow Icon={KeyRound} label="Control Key & recovery" detail="Rotate the ML-DSA key or back up the Recovery Kit" onPress={() => router.push("/recovery")} />
            <SettingsRow Icon={BookUser} label="Address book" detail="Saved contacts with poisoning checks" onPress={() => router.push("/address-book" as Href)} />
          </View>
        ) : null}

        <Card>
          <Text variant="label" muted className="mb-2">
            Remove
          </Text>
          <Text variant="caption" muted className="mb-3">
            {record.kind === "watch"
              ? "Stops following this address. Nothing on chain changes."
              : "Deletes this account's ML-DSA key from this device. Export its Recovery Kit first; without it the funds are unreachable."}
          </Text>
          {removeArmed ? (
            <View className="flex-row gap-3">
              <Button className="flex-1" variant="secondary" disabled={busy} onPress={() => setRemoveArmed(false)}>
                Keep
              </Button>
              <Button
                className="flex-1"
                variant="danger"
                disabled={busy}
                onPress={() =>
                  run(async () => {
                    await removeAccount(record.id);
                    router.back();
                  })
                }
              >
                {busy ? "Removing…" : "Remove"}
              </Button>
            </View>
          ) : (
            <Button variant="danger" disabled={busy} onPress={() => setRemoveArmed(true)}>
              {record.kind === "watch" ? "Stop watching" : "Remove account"}
            </Button>
          )}
        </Card>

        <View className="items-center">
          <Badge label={badge} />
        </View>
      </View>
    </PageContainer>
  );
}
