import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Row } from "@/components/Row";
import { Badge } from "@/components/Badge";
import { WarningCard } from "@/components/WarningCard";
import { formatBalanceWei } from "@minerva/evm";
import { useAccountSnapshot } from "@/hooks/useAccountSnapshot";
import {
  enrollDeviceKeyFromWallet,
  forgetDeviceKey,
  listDeviceKeysWithChainState,
  revokeDeviceKeyFromWallet,
  type DeviceKeyView,
} from "@/lib/deviceKeys";

function shortHex(value?: string) {
  if (!value) return "—";
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function scopeLabel(view: DeviceKeyView) {
  const limit = `${formatBalanceWei(BigInt(view.scope.valueLimitWei))} MRV`;
  const window = Number(view.scope.windowSeconds);
  const per = window === 0 ? "in total" : window % 3600 === 0 ? `per ${window / 3600} h` : `per ${window} s`;
  const target = view.scope.targets.length === 0 ? "any target" : `only ${shortHex(view.scope.targets[0])}`;
  return `${limit} ${per}, ${target}`;
}

function statusLabel(view: DeviceKeyView) {
  if (view.chainError) return "Registry unavailable";
  if (!view.chain) return "Checking…";
  if (!view.chain.exists) return "Not in registry";
  if (!view.chain.active) return "Revoked";
  const expiry = Number(view.chain.scope.expiry);
  if (expiry > 0 && expiry * 1000 < Date.now()) return "Expired";
  return `Active · v${view.chain.policyVersion}`;
}

/** Device keys: enrol a scoped ML-DSA key held by another device, watch its spend, revoke it.
 *  Enrolment and revocation are signed by this phone's control key; the node and the account
 *  enforce the scope, not the UI. */
export default function Devices() {
  const snapshot = useAccountSnapshot();
  const accountAddress = snapshot.pqAccount?.accountAddress;
  const salt = snapshot.pqAccount?.salt;
  const [views, setViews] = useState<DeviceKeyView[]>([]);
  const [label, setLabel] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [target, setTarget] = useState("");
  const [limit, setLimit] = useState("0.1");
  const [windowHours, setWindowHours] = useState("24");
  const [expiryDays, setExpiryDays] = useState("30");
  const [busy, setBusy] = useState<"idle" | "enrolling" | "revoking">("idle");
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const reload = useCallback(() => {
    if (!accountAddress) return;
    listDeviceKeysWithChainState(snapshot.chainId, accountAddress, snapshot.rpcUrl)
      .then(setViews)
      .catch(() => undefined);
  }, [accountAddress, snapshot.chainId, snapshot.rpcUrl]);

  useEffect(() => {
    reload();
  }, [reload]);

  const unlocked = snapshot.walletStatus === "unlocked";
  const deployed = Boolean(snapshot.pqAccount?.deployed);
  const canEnrol = unlocked && deployed && Boolean(accountAddress) && busy === "idle";

  const enrol = async () => {
    if (!accountAddress) return;
    setBusy("enrolling");
    setError(undefined);
    setMessage(undefined);
    try {
      const record = await enrollDeviceKeyFromWallet({
        chainId: snapshot.chainId,
        rpcUrl: snapshot.rpcUrl,
        accountAddress,
        salt,
        label,
        devicePublicKey: publicKey,
        target,
        valueLimitMrv: limit,
        windowHours,
        expiryDays,
      });
      setMessage(`Enrolled "${record.label}" (${shortHex(record.commitment)}). The policy version moved on; pending transactions under the old version lapse.`);
      setLabel("");
      setPublicKey("");
      setTarget("");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enrol the device key.");
    } finally {
      setBusy("idle");
    }
  };

  const revoke = async (view: DeviceKeyView) => {
    if (!accountAddress) return;
    setBusy("revoking");
    setError(undefined);
    setMessage(undefined);
    try {
      await revokeDeviceKeyFromWallet({ chainId: snapshot.chainId, rpcUrl: snapshot.rpcUrl, accountAddress, salt, commitment: view.commitment });
      setMessage(`Revoked "${view.label}". A revoked key can never be re-enrolled.`);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke the device key.");
    } finally {
      setBusy("idle");
    }
  };

  const forget = async (view: DeviceKeyView) => {
    await forgetDeviceKey(view.id);
    reload();
  };

  return (
    <PageContainer>
      <PageHeader title="Device keys" showBack centerTitle />

      <View className="gap-5">
        <Text variant="body" muted>
          A device key lets another device spend from this Minerva Account inside a scope you set here. The
          node admits a device key only for calls to the account itself, and the account enforces the
          targets, the value window and the expiry. Only this phone's control key can enrol or revoke.
        </Text>

        {!unlocked ? (
          <WarningCard severity="review" title="Wallet locked" detail="Unlock before enrolling or revoking device keys." />
        ) : !deployed ? (
          <WarningCard severity="review" title="Account not deployed" detail="Deploy the Minerva Account before adding device keys." />
        ) : null}

        <Card>
          <Text variant="label" muted className="mb-2">
            Enrol a device
          </Text>
          <View className="gap-3">
            <Input label="Label" placeholder="e.g. Desktop extension" value={label} onChangeText={setLabel} />
            <Input
              label="Device public key (ML-DSA-65, 0x…)"
              placeholder="Paste the key shown by the other device"
              value={publicKey}
              onChangeText={setPublicKey}
              autoCapitalize="none"
              multiline
            />
            <Input label="Allowed target (optional, one address)" placeholder="0x… or leave empty for any" value={target} onChangeText={setTarget} autoCapitalize="none" />
            <Input label="Spend limit (MRV)" value={limit} onChangeText={setLimit} keyboardType="decimal-pad" />
            <Input label="Window (hours, 0 = lifetime cap)" value={windowHours} onChangeText={setWindowHours} keyboardType="number-pad" />
            <Input label="Expires in (days, 0 = never)" value={expiryDays} onChangeText={setExpiryDays} keyboardType="number-pad" />
          </View>
          <View className="mt-4">
            <Button onPress={enrol} disabled={!canEnrol}>
              {busy === "enrolling" ? "Enrolling…" : "Enrol device key"}
            </Button>
          </View>
        </Card>

        {error ? <WarningCard severity="critical" title="Device keys" detail={error} /> : null}
        {message ? <WarningCard severity="info" title="Done" detail={message} /> : null}

        <Card>
          <View className="flex-row items-center justify-between">
            <Text variant="label" muted>
              Enrolled from this phone
            </Text>
            <Badge label={`${views.filter((v) => v.chain?.active).length} active`} />
          </View>
          {views.length === 0 ? (
            <Text variant="body" muted className="mt-3">
              No device keys yet.
            </Text>
          ) : (
            views.map((view, index) => (
              <View key={view.id} className="mt-4">
                <Row label={view.label} value={statusLabel(view)} showChevron={false} />
                <Row label="Key" value={shortHex(view.commitment)} showChevron={false} />
                <Row label="Scope" value={scopeLabel(view)} showChevron={false} />
                <Row
                  label="Spent this window"
                  value={view.chain ? `${formatBalanceWei(BigInt(view.chain.scope.spentWei))} MRV` : "—"}
                  showChevron={false}
                  last={index === views.length - 1}
                />
                <View className="flex-row gap-3 mt-3">
                  {view.chain?.active ? (
                    <Button className="flex-1" variant="secondary" onPress={() => revoke(view)} disabled={!unlocked || busy !== "idle"}>
                      {busy === "revoking" ? "Revoking…" : "Revoke"}
                    </Button>
                  ) : (
                    <Button className="flex-1" variant="secondary" onPress={() => forget(view)}>
                      Remove from list
                    </Button>
                  )}
                </View>
              </View>
            ))
          )}
        </Card>
      </View>
    </PageContainer>
  );
}
