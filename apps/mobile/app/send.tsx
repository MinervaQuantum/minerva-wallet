import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import type { Hex } from "@minerva/core";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Row } from "@/components/Row";
import { WarningCard } from "@/components/WarningCard";
import { useAccountSnapshot } from "@/hooks/useAccountSnapshot";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import {
  encodeErc20Transfer,
  formatBalanceWei,
  formatNativeAmountInput,
  formatTokenUnits,
  isValidEvmAddress,
  normalizeEvmAddress,
  parseNativeAmountToWei,
  parseTokenAmount,
  type MinervaSimulationResult,
} from "@minerva/evm";
import { listContacts, type Contact } from "@/lib/addressBook";
import type { TrackedTokenBalance } from "@/lib/tokens";

type Asset = { kind: "native" } | { kind: "token"; token: TrackedTokenBalance };

function tryParseNative(value: string): bigint | undefined {
  try {
    const wei = parseNativeAmountToWei(value);
    return wei > 0n ? wei : undefined;
  } catch {
    return undefined;
  }
}

function tryParseToken(value: string, decimals: number): bigint | undefined {
  try {
    const units = parseTokenAmount(value, decimals);
    return units > 0n ? units : undefined;
  } catch {
    return undefined;
  }
}

/** Send MRV or any tracked ERC-20. Token sends are executePQ calls carrying transfer() calldata. */
export default function Send() {
  const snapshot = useAccountSnapshot();
  const params = useLocalSearchParams<{ recipient?: string; token?: string }>();
  const balances = useTokenBalances({
    chainId: snapshot.chainId,
    rpcUrl: snapshot.rpcUrl,
    indexerUrl: snapshot.indexerUrl,
    address: snapshot.activeAddress,
    enabled: snapshot.accountReady,
  });
  const [asset, setAsset] = useState<Asset>({ kind: "native" });
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [sim, setSim] = useState<MinervaSimulationResult | undefined>();
  const [simulating, setSimulating] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [maxError, setMaxError] = useState<string | undefined>();

  const trimmedRecipient = recipient.trim();
  const recipientValid = isValidEvmAddress(trimmedRecipient);
  const recipientIsInvalid = trimmedRecipient.length > 0 && !recipientValid;
  const token = asset.kind === "token" ? balances.tokens.find((t) => t.address === asset.token.address) ?? asset.token : undefined;
  const symbol = token ? token.symbol : snapshot.nativeCurrencySymbol;
  const parsedUnits = token ? tryParseToken(amount, token.decimals) : tryParseNative(amount);
  const amountIsInvalid = amount.trim().length > 0 && parsedUnits === undefined;
  const availableUnits = token ? token.balance : snapshot.balanceWei;
  const insufficientFunds = parsedUnits !== undefined && availableUnits !== undefined && parsedUnits > availableUnits;
  const accountReady = snapshot.accountReady && snapshot.status === "live";
  const walletUnlocked = snapshot.walletStatus === "unlocked";
  const watchOnly = snapshot.isWatchOnly;

  // Preselect a token when arriving from its detail screen.
  useEffect(() => {
    if (!params.token) return;
    const match = balances.tokens.find((t) => t.address.toLowerCase() === params.token?.toLowerCase());
    if (match) setAsset({ kind: "token", token: match });
  }, [params.token, balances.tokens]);

  const recentRecipients = useMemo(() => {
    const seen = new Set<string>();
    return snapshot.activity
      .filter((item) => item.type === "send" && "to" in item && typeof item.to === "string" && isValidEvmAddress(item.to))
      .map((item) => (item as { to: string }).to)
      .filter((address) => {
        const key = address.toLowerCase();
        if (key === snapshot.activeAddress?.toLowerCase() || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 3);
  }, [snapshot.activeAddress, snapshot.activity]);

  useEffect(() => {
    if (params.recipient && isValidEvmAddress(params.recipient)) setRecipient(params.recipient);
  }, [params.recipient]);

  useEffect(() => {
    let active = true;
    listContacts()
      .then((items) => {
        if (active) setContacts(items.slice(0, 3));
      })
      .catch(() => {
        if (active) setContacts([]);
      });
    return () => {
      active = false;
    };
  }, []);

  // The call the review will sign: a plain value transfer, or transfer() on the token contract.
  const call = useMemo(() => {
    if (!recipientValid || parsedUnits === undefined) return undefined;
    const to = normalizeEvmAddress(trimmedRecipient) as Hex;
    if (token) return { target: token.address, valueWei: 0n, data: encodeErc20Transfer(to, parsedUnits), recipient: to };
    return { target: to, valueWei: parsedUnits, data: "0x" as Hex, recipient: to };
  }, [parsedUnits, recipientValid, token, trimmedRecipient]);

  useEffect(() => {
    if (!call) {
      setSim(undefined);
      return;
    }
    let active = true;
    setSimulating(true);
    const handle = setTimeout(() => {
      snapshot
        .simulateTransfer({ to: call.target, valueWei: call.valueWei, data: call.data })
        .then((result) => {
          if (active) setSim(result);
        })
        .catch(() => {
          if (active) setSim(undefined);
        })
        .finally(() => {
          if (active) setSimulating(false);
        });
    }, 450);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [snapshot, call]);

  const useMaxAmount = async () => {
    setMaxError(undefined);
    if (token) {
      setAmount(formatTokenUnits(token.balance, token.decimals, token.decimals));
      return;
    }
    if (!recipientValid) {
      setMaxError("Enter a valid recipient before using Max so the wallet can estimate a real fee.");
      return;
    }
    if (snapshot.balanceWei === undefined) {
      setMaxError("Balance is unavailable because the RPC read has not completed.");
      return;
    }
    try {
      const estimate = await snapshot.simulateTransfer({ to: normalizeEvmAddress(trimmedRecipient), valueWei: 1n });
      if (estimate.maxFeeWei === undefined) {
        setMaxError("Max needs a live gas price and gas estimate.");
        return;
      }
      const spendableWei = snapshot.balanceWei - estimate.maxFeeWei;
      if (spendableWei <= 0n) {
        setMaxError("Balance is not enough to cover the network fee.");
        return;
      }
      setAmount(formatNativeAmountInput(spendableWei));
    } catch (error) {
      setMaxError(error instanceof Error ? error.message : "Could not calculate Max from live RPC.");
    }
  };

  const wouldRevert = sim ? !sim.willSucceed : false;
  const simInsufficient = sim?.insufficientFunds ?? false;
  const canReview = accountReady && walletUnlocked && !watchOnly && call !== undefined && !insufficientFunds && !wouldRevert && !simInsufficient;

  const availableLabel = token
    ? `${formatTokenUnits(token.balance, token.decimals)} ${token.symbol}`
    : snapshot.balanceLabel;

  return (
    <PageContainer>
      <PageHeader title="Send" eyebrow="03 / Transfer" showBack centerTitle />

      <View className="gap-4">
        <Card>
          <Text variant="caption" muted weight="medium" className="uppercase tracking-wider">
            From
          </Text>
          <Text variant="body-lg" weight="semibold" className="mt-1">
            {snapshot.activeAccount?.label ?? "Minerva Account"}
          </Text>
          <Text variant="caption" muted className="mt-1">
            Available {availableLabel}
          </Text>
        </Card>

        {!accountReady ? (
          <WarningCard severity="info" title="Account is loading" detail="Wait for the live Minerva Account address and balance before preparing a transfer." />
        ) : null}
        {watchOnly ? (
          <WarningCard severity="review" title="Watch-only account" detail="This account has no key on this device. Switch to a key-backed account to send." />
        ) : null}
        {accountReady && !walletUnlocked && !watchOnly ? (
          <WarningCard severity="review" title="Unlock required" detail="Viewing balance works while locked. Unlock before signing a transfer." />
        ) : null}

        <View className="gap-3">
          <View className="gap-1.5">
            <Text variant="label" muted>
              Asset
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Pressable
                onPress={() => setAsset({ kind: "native" })}
                className={`h-10 rounded-pill border px-4 items-center justify-center ${asset.kind === "native" ? "border-mv-line-strong bg-mv-panel" : "border-mv-line"}`}
              >
                <Text variant="caption" weight="medium">
                  {snapshot.nativeCurrencySymbol}
                </Text>
              </Pressable>
              {balances.visible.map((t) => {
                const selected = asset.kind === "token" && asset.token.address === t.address;
                return (
                  <Pressable
                    key={t.address}
                    onPress={() => setAsset({ kind: "token", token: t })}
                    className={`h-10 rounded-pill border px-4 items-center justify-center ${selected ? "border-mv-line-strong bg-mv-panel" : "border-mv-line"}`}
                  >
                    <Text variant="caption" weight="medium">
                      {t.symbol} · {formatTokenUnits(t.balance, t.decimals, 4)}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable onPress={() => router.push("/tokens" as Href)} className="h-10 rounded-pill border border-mv-line px-4 items-center justify-center">
                <Text variant="caption" muted>
                  + Token
                </Text>
              </Pressable>
            </ScrollView>
          </View>
          <Input label="Recipient" placeholder="0x…" value={recipient} onChangeText={setRecipient} autoCapitalize="none" autoCorrect={false} />
          {contacts.length > 0 || recentRecipients.length > 0 ? (
            <View className="gap-2">
              {recentRecipients.length > 0 ? (
                <View className="gap-2">
                  <Text variant="label" muted>
                    Recent recipients
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {recentRecipients.map((address) => (
                      <Pressable key={address} onPress={() => setRecipient(address)} className="h-9 rounded-pill border border-mv-line px-3 items-center justify-center bg-mv-panel">
                        <Text variant="caption" weight="medium">
                          {address.slice(0, 6)}...{address.slice(-4)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
              {contacts.length > 0 ? (
                <View className="gap-2">
                  <Text variant="label" muted>
                    Address book
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {contacts.map((contact) => (
                      <Pressable key={contact.id} onPress={() => setRecipient(contact.address)} className="h-9 rounded-pill border border-mv-line px-3 items-center justify-center bg-mv-panel">
                        <Text variant="caption" weight="medium">
                          {contact.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}
          <Input label={`Amount (${symbol})`} placeholder="0.00" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <View className="flex-row gap-3">
            <Button variant="secondary" className="flex-1" onPress={useMaxAmount} disabled={!accountReady}>
              Max
            </Button>
            <Button variant="secondary" className="flex-1" onPress={() => router.push("/scan-recipient")}>
              Scan QR
            </Button>
          </View>
          <Input label="Network" value={snapshot.chainName} editable={false} />
        </View>

        {recipientIsInvalid ? <WarningCard severity="warning" title="Invalid recipient" detail="Address does not look like a valid 0x address." /> : null}
        {amountIsInvalid ? (
          <WarningCard severity="warning" title="Invalid amount" detail={token ? `Enter a positive amount with at most ${token.decimals} decimals.` : "Enter a positive decimal amount."} />
        ) : null}
        {insufficientFunds ? <WarningCard severity="warning" title="Insufficient funds" detail={`Available ${availableLabel} can't cover this amount.`} /> : null}
        {maxError ? <WarningCard severity="review" title="Max unavailable" detail={maxError} /> : null}

        {canReview || simulating || sim ? (
          <Card>
            <Text variant="caption" muted weight="medium" className="uppercase tracking-wider">
              Fee preview
            </Text>
            <View className="mt-2">
              <Row label="Status" value={simulating ? "Estimating…" : wouldRevert ? "Would revert" : sim ? "OK" : "—"} showChevron={false} />
              <Row
                label="Network fee"
                value={sim?.maxFeeWei !== undefined ? `~${formatBalanceWei(sim.maxFeeWei)} ${snapshot.nativeCurrencySymbol}` : "—"}
                showChevron={false}
              />
              <Row
                label={token ? "Fee paid in" : "Total out"}
                value={token ? snapshot.nativeCurrencySymbol : sim ? `${formatBalanceWei(sim.totalOutWei)} ${snapshot.nativeCurrencySymbol}` : "—"}
                showChevron={false}
                last
              />
            </View>
          </Card>
        ) : null}

        {wouldRevert ? (
          <WarningCard severity="critical" title="Transfer would revert" detail={sim?.revertReason ?? "The node rejected this transfer in simulation."} />
        ) : null}
        {simInsufficient && !insufficientFunds ? (
          <WarningCard severity="warning" title="Value + fee exceeds balance" detail="Lower the amount to leave room for the network fee." />
        ) : null}

        <View className="items-center mt-2">
          {accountReady && !walletUnlocked && !watchOnly ? (
            <View className="mb-3 w-full">
              <Button size="block" variant="secondary" onPress={() => router.push("/unlock")}>
                Unlock Wallet
              </Button>
            </View>
          ) : null}
          <Button
            onPress={() => {
              if (!call || parsedUnits === undefined) return;
              router.push({
                pathname: "/transaction-review",
                params: {
                  target: call.target,
                  recipient: call.recipient,
                  amount,
                  valueWei: call.valueWei.toString(),
                  data: call.data,
                  asset: symbol,
                  ...(token
                    ? { tokenAddress: token.address, tokenSymbol: token.symbol, tokenDecimals: String(token.decimals), tokenUnits: parsedUnits.toString() }
                    : {}),
                },
              });
            }}
            disabled={!canReview}
          >
            Continue to Review
          </Button>
        </View>
      </View>
    </PageContainer>
  );
}
