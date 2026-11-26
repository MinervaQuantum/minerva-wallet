import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import type { Hex } from "@minerva/core";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Text } from "@/components/Text";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Row } from "@/components/Row";
import { WarningCard } from "@/components/WarningCard";
import { colors } from "@minerva/ui-tokens";
import {
  buildTransactionReview,
  createEvmPublicClient,
  formatBalanceWei,
  formatTokenUnits,
  isValidEvmAddress,
  parseNativeAmountToWei,
  type MinervaFeeCaps,
  type MinervaFeeLevel,
  type MinervaFeeOption,
  type MinervaSimulationResult,
} from "@minerva/evm";
import { useAccountSnapshot } from "@/hooks/useAccountSnapshot";
import { listContacts, type Contact } from "@/lib/addressBook";
import { getDappRequest, isDappRequestOpen, rejectDappRequest, resolveDappRequest } from "@/lib/dapp/requestBridge";

type FeeChoice = MinervaFeeLevel | "custom";

function isHexData(value: string | undefined): value is Hex {
  return typeof value === "string" && /^0x([0-9a-fA-F]{2})*$/.test(value);
}

/**
 * Review before signing. Everything shown is derived from the live chain (eth_estimateGas,
 * eth_call, eth_gasPrice, eth_getCode) and from the decoded calldata; nothing is mocked. The
 * same screen serves wallet-initiated sends, token transfers and dapp requests (requestId).
 */
export default function TransactionReview() {
  const [advanced, setAdvanced] = useState(false);
  const snapshot = useAccountSnapshot();
  const params = useLocalSearchParams<{
    target?: string;
    recipient?: string;
    amount?: string;
    valueWei?: string;
    asset?: string;
    data?: string;
    tokenAddress?: string;
    tokenSymbol?: string;
    tokenDecimals?: string;
    tokenUnits?: string;
    requestId?: string;
    origin?: string;
    appName?: string;
  }>();

  const dapp = getDappRequest(params.requestId);
  const target = params.target && isValidEvmAddress(params.target) ? (params.target as Hex) : undefined;
  const data: Hex = isHexData(params.data) ? params.data : "0x";
  const contractCall = data !== "0x";
  const token =
    params.tokenSymbol && params.tokenDecimals !== undefined
      ? { symbol: params.tokenSymbol, decimals: Number(params.tokenDecimals), address: params.tokenAddress }
      : undefined;
  let parsedValueWei: bigint | undefined;
  try {
    parsedValueWei = params.valueWei !== undefined ? BigInt(params.valueWei) : undefined;
  } catch {
    parsedValueWei = undefined;
  }
  const nativeSymbol = snapshot.nativeCurrencySymbol;
  const amountLabel = token
    ? `${params.amount ?? (params.tokenUnits ? formatTokenUnits(BigInt(params.tokenUnits), token.decimals) : "—")} ${token.symbol}`
    : params.amount && parsedValueWei !== undefined
      ? `${params.amount} ${params.asset ?? nativeSymbol}`
      : parsedValueWei !== undefined
        ? `${formatBalanceWei(parsedValueWei)} ${nativeSymbol}`
        : `— ${nativeSymbol}`;

  const [sim, setSim] = useState<MinervaSimulationResult | undefined>();
  const [targetHasCode, setTargetHasCode] = useState<boolean | undefined>();
  const [simError, setSimError] = useState<string | undefined>();
  const [simulating, setSimulating] = useState(true);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [feeOptions, setFeeOptions] = useState<MinervaFeeOption[]>([]);
  const [feeChoice, setFeeChoice] = useState<FeeChoice>("normal");
  const [customGwei, setCustomGwei] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();

  const missingRequired = !target || parsedValueWei === undefined || (parsedValueWei <= 0n && !contractCall);

  // A dapp request that is abandoned (back gesture, app switch) must be rejected, not left hanging.
  useEffect(() => {
    const id = params.requestId;
    return () => {
      if (id && isDappRequestOpen(id)) rejectDappRequest(id);
    };
  }, [params.requestId]);

  useEffect(() => {
    listContacts()
      .then(setContacts)
      .catch(() => setContacts([]));
  }, []);

  useEffect(() => {
    if (missingRequired || !target || parsedValueWei === undefined) {
      setSim(undefined);
      setSimError("Missing or invalid transaction details.");
      setSimulating(false);
      return;
    }
    let active = true;
    setSimulating(true);
    snapshot
      .simulateTransfer({ to: target, valueWei: parsedValueWei, data })
      .then((result) => {
        if (active) setSim(result);
      })
      .catch((error: unknown) => {
        if (active) setSimError(error instanceof Error ? error.message : "Simulation unavailable");
      })
      .finally(() => {
        if (active) setSimulating(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.simulateTransfer, target, parsedValueWei, data, missingRequired]);

  useEffect(() => {
    if (!target) return;
    let active = true;
    createEvmPublicClient({ chainId: snapshot.chainId, rpcUrl: snapshot.rpcUrl })
      .getCode({ address: target })
      .then((code) => {
        if (active) setTargetHasCode(Boolean(code && code !== "0x"));
      })
      .catch(() => {
        if (active) setTargetHasCode(undefined);
      });
    return () => {
      active = false;
    };
  }, [snapshot.chainId, snapshot.rpcUrl, target]);

  useEffect(() => {
    let active = true;
    snapshot
      .estimateFees()
      .then((options) => {
        if (active) setFeeOptions(options);
      })
      .catch(() => {
        if (active) setFeeOptions([]);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.estimateFees]);

  const selectedFee: MinervaFeeCaps | undefined = useMemo(() => {
    if (feeChoice === "custom") {
      try {
        const cap = parseNativeAmountToWei(customGwei, 9);
        return cap > 0n ? { gasTipCap: cap, gasFeeCap: cap } : undefined;
      } catch {
        return undefined;
      }
    }
    const option = feeOptions.find((o) => o.level === feeChoice);
    return option ? { gasTipCap: option.gasTipCap, gasFeeCap: option.gasFeeCap } : undefined;
  }, [customGwei, feeChoice, feeOptions]);

  const recentRecipients = useMemo(
    () =>
      snapshot.activity
        .filter((item) => item.type === "send" && "to" in item && typeof item.to === "string" && isValidEvmAddress(item.to))
        .map((item) => (item as { to: string }).to as Hex)
        .slice(0, 10),
    [snapshot.activity],
  );

  const review = buildTransactionReview({
    target,
    valueWei: parsedValueWei ?? 0n,
    data,
    nativeSymbol,
    simulation: sim,
    simulationError: simulating ? undefined : simError,
    targetHasCode,
    knownAddresses: [snapshot.activeAddress, token?.address].filter((a): a is Hex => Boolean(a)),
    senderAddress: snapshot.activeAddress,
    contacts: contacts.map((c) => ({ label: c.label, address: c.address as Hex })),
    recentRecipients,
    token: token ? { symbol: token.symbol, decimals: token.decimals } : undefined,
    requestingApp: dapp ? { name: params.appName ?? dapp.meta.name ?? dapp.meta.origin, origin: dapp.meta.origin, verified: false } : undefined,
  });

  const willRevert = sim ? !sim.willSucceed : false;
  const insufficient = sim?.insufficientFunds ?? false;
  const walletUnlocked = snapshot.walletStatus === "unlocked";
  const watchOnly = snapshot.isWatchOnly;
  const criticalRisks = review.warnings.filter((w) => w.severity === "critical" && w.id !== "simulation-reverts");
  const needsAcknowledgement = criticalRisks.length > 0 && !acknowledged;
  const blockConfirm =
    missingRequired ||
    simulating ||
    willRevert ||
    insufficient ||
    !walletUnlocked ||
    watchOnly ||
    needsAcknowledgement ||
    (feeChoice === "custom" && !selectedFee) ||
    snapshot.pqTxStatus === "requesting";

  const recipientForDisplay = (params.recipient && isValidEvmAddress(params.recipient) ? params.recipient : target) as string | undefined;
  const contractLabel = targetHasCode === undefined ? "Checking" : targetHasCode ? (token ? "Token contract" : review.unknownContract ? "Unknown contract" : "Known contract") : "Wallet address";
  const feeValue =
    selectedFee && sim?.gasEstimate !== undefined
      ? `≤ ${formatBalanceWei(selectedFee.gasFeeCap * sim.gasEstimate)} ${nativeSymbol}`
      : sim?.maxFeeWei !== undefined
        ? `~${formatBalanceWei(sim.maxFeeWei)} ${nativeSymbol}`
        : `${nativeSymbol} gas`;

  const reject = () => {
    if (params.requestId) rejectDappRequest(params.requestId);
    router.back();
  };

  const confirm = async () => {
    if (!target || parsedValueWei === undefined) return;
    setSubmitError(undefined);
    try {
      const receipt = await snapshot.sendPQTransfer({
        target,
        valueWei: parsedValueWei.toString(),
        data,
        fee: selectedFee,
        title: token ? `Sent ${amountLabel}` : dapp ? `${params.appName ?? dapp.meta.origin}: ${review.action}` : contractCall ? review.action : `Sent ${amountLabel}`,
        detail: recipientForDisplay ? `To ${recipientForDisplay.slice(0, 6)}...${recipientForDisplay.slice(-4)}` : undefined,
        asset: token?.symbol ?? params.asset ?? nativeSymbol,
        amountLabel,
      });
      if (params.requestId) {
        resolveDappRequest(params.requestId, receipt.transactionHash);
        router.back();
        return;
      }
      router.replace("/(tabs)/activity");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Transaction failed.");
    }
  };

  return (
    <PageContainer>
      <PageHeader title="Review" showBack centerTitle />

      <View className="gap-5">
        <View className="items-center">
          <Badge label={dapp ? "App request" : snapshot.account.security.mode} />
        </View>
        <Text variant="body" muted className="text-center">
          {dapp
            ? `${params.appName ?? dapp.meta.name ?? dapp.meta.origin} asks ${snapshot.activeAccount?.label ?? "your account"} to sign this on ${snapshot.chainName}.`
            : `This transaction is validated by your Minerva smart account on ${snapshot.chainName}.`}
        </Text>

        <Card>
          <Text variant="caption" muted weight="medium" className="uppercase tracking-wider">
            Action
          </Text>
          <Text variant="body-lg" weight="semibold" className="mt-1">
            {review.action}
          </Text>
          <View className="mt-4">
            <Row label="From" value={snapshot.activeAccount?.label ?? "Minerva Account"} showChevron={false} />
            <Row label="To" value={recipientForDisplay ? `${recipientForDisplay.slice(0, 6)}…${recipientForDisplay.slice(-4)}` : "Missing"} showChevron={false} />
            {token && target ? <Row label="Token contract" value={`${target.slice(0, 6)}…${target.slice(-4)}`} showChevron={false} /> : null}
            <Row label="Amount" value={amountLabel} showChevron={false} />
            <Row label="Network" value={snapshot.chainName} showChevron={false} />
            <Row label="Max fee" value={feeValue} showChevron={false} />
            <Row label="Simulation" value={simulating ? "Simulating…" : review.simulation.label} showChevron={false} />
            <Row label="Balance change" value={review.balanceChanges.length === 0 ? "—" : review.balanceChanges.map((c) => c.label).join(", ")} showChevron={false} />
            <Row label="Contract call" value={review.call ? `${review.call.name}: ${review.call.summary}` : "None"} showChevron={false} />
            <Row label="Approvals" value={review.approval ? (review.approval.unlimited ? "Unlimited" : review.approval.amountWei.toString()) : "None"} showChevron={false} />
            <Row label="Requesting app" value={review.requestingApp} showChevron={false} />
            <Row label="Recipient type" value={contractLabel} showChevron={false} />
            <Row label="Validation" value="ML-DSA PQ signature" showChevron={false} last />
          </View>
          <Text variant="caption" muted className="mt-3">
            {review.disclaimer}
          </Text>
        </Card>

        <Card>
          <Text variant="caption" muted weight="medium" className="uppercase tracking-wider">
            Network fee
          </Text>
          <View className="flex-row gap-2 mt-3">
            {(["slow", "normal", "fast"] as const).map((level) => {
              const option = feeOptions.find((o) => o.level === level);
              const selected = feeChoice === level;
              return (
                <Pressable
                  key={level}
                  onPress={() => setFeeChoice(level)}
                  className={`flex-1 rounded-md border px-2 py-2 items-center ${selected ? "border-mv-line-strong bg-mv-panel" : "border-mv-line"}`}
                >
                  <Text variant="caption" weight="medium" className="capitalize">
                    {level}
                  </Text>
                  <Text variant="caption" muted numberOfLines={1}>
                    {option ? `${formatBalanceWei(option.gasFeeCap * (sim?.gasEstimate ?? 1n), 6)}` : "…"}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setFeeChoice("custom")}
              className={`flex-1 rounded-md border px-2 py-2 items-center ${feeChoice === "custom" ? "border-mv-line-strong bg-mv-panel" : "border-mv-line"}`}
            >
              <Text variant="caption" weight="medium">
                Custom
              </Text>
              <Text variant="caption" muted>
                gwei
              </Text>
            </Pressable>
          </View>
          {feeChoice === "custom" ? (
            <View className="mt-3">
              <Input label="Max fee per gas (gwei)" placeholder="e.g. 2" value={customGwei} onChangeText={setCustomGwei} keyboardType="decimal-pad" />
            </View>
          ) : null}
          <Text variant="caption" muted className="mt-3">
            Fee caps bound what the envelope can pay per gas; the node charges the base fee plus tip, never more than the cap.
          </Text>
        </Card>

        {review.warnings.map((warning) => (
          <WarningCard key={warning.id} severity={warning.severity} title={warning.title} detail={warning.detail} />
        ))}
        {criticalRisks.length > 0 && !willRevert ? (
          <Pressable onPress={() => setAcknowledged((a) => !a)}>
            <Card className={acknowledged ? "border-mv-line-strong" : undefined}>
              <Text variant="body" weight="medium">
                {acknowledged ? "☑" : "☐"} I checked the recipient and accept the risk
              </Text>
            </Card>
          </Pressable>
        ) : null}
        {missingRequired ? (
          <WarningCard severity="critical" title="Missing transaction details" detail="Return to Send and enter a valid recipient and amount before reviewing." />
        ) : null}
        {insufficient ? (
          <WarningCard severity="warning" title="Insufficient funds" detail={`Balance ${formatBalanceWei(sim?.senderBalanceBeforeWei ?? 0n)} ${nativeSymbol} can't cover value + fee.`} />
        ) : null}
        {watchOnly ? (
          <WarningCard severity="review" title="Watch-only account" detail="This account cannot sign. Switch to a key-backed account." />
        ) : !walletUnlocked ? (
          <WarningCard severity="review" title="Unlock required" detail="Unlock Minerva Wallet before signing this PQ transaction." />
        ) : null}
        {submitError || snapshot.pqTxStatus === "error" ? (
          <WarningCard severity="review" title="PQ transaction failed" detail={submitError ?? snapshot.pqTxError ?? "Fund and deploy the Minerva Account before confirming."} />
        ) : null}

        <Pressable onPress={() => setAdvanced((a) => !a)} className="flex-row items-center gap-2 py-2">
          <Text variant="body" weight="medium">
            Advanced details
          </Text>
          {advanced ? <ChevronUp size={16} color={colors.text} /> : <ChevronDown size={16} color={colors.text} />}
        </Pressable>
        {advanced ? (
          <Card>
            <Row label="Account" value={snapshot.accountReady ? snapshot.account.address : "Loading"} showChevron={false} />
            <Row label="Target" value={target ?? "—"} showChevron={false} />
            <Row label="Value (wei)" value={parsedValueWei?.toString() ?? "—"} showChevron={false} />
            <Row label="Calldata" value={data === "0x" ? "none" : `${data.slice(0, 18)}… (${(data.length - 2) / 2} bytes)`} showChevron={false} />
            <Row label="Deployment" value={snapshot.deploymentLabel} showChevron={false} />
            <Row label="Gas estimate" value={sim?.gasEstimate !== undefined ? sim.gasEstimate.toString() : "—"} showChevron={false} />
            <Row label="Gas price" value={sim?.gasPriceWei !== undefined ? `${sim.gasPriceWei.toString()} wei` : "—"} showChevron={false} />
            <Row
              label="Fee caps"
              value={selectedFee ? `tip ${selectedFee.gasTipCap.toString()} / cap ${selectedFee.gasFeeCap.toString()} wei` : "node estimate"}
              showChevron={false}
            />
            <Row label="Total out" value={sim ? `${formatBalanceWei(sim.totalOutWei)} ${nativeSymbol}` : "—"} showChevron={false} />
            <Row label="Precompile" value={snapshot.isMinervaDevnet ? "0x0000…4D00" : "n/a"} showChevron={false} last />
          </Card>
        ) : null}

        <View className="flex-row gap-3">
          <Button variant="secondary" className="flex-1" onPress={reject}>
            Reject
          </Button>
          {!walletUnlocked && !watchOnly ? (
            <Button className="flex-1" onPress={() => router.push("/unlock")}>
              Unlock
            </Button>
          ) : (
            <Button className="flex-1" onPress={confirm} disabled={blockConfirm}>
              {snapshot.pqTxStatus === "requesting" ? "Signing PQ" : simulating ? "Simulating" : "Confirm"}
            </Button>
          )}
        </View>
      </View>
    </PageContainer>
  );
}
