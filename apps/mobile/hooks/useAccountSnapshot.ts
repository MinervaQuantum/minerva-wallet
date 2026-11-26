import { useCallback, useEffect, useMemo, useState } from "react";
import type { Hex, MinervaAccount, SecurityMode } from "@minerva/core";
import {
  bumpMinervaFeeCaps,
  deployMinervaDevPQAccount,
  defaultMinervaFaucetUrl,
  defaultMinervaIndexerUrl,
  defaultMinervaPQRelayerUrl,
  defaultMinervaRpcUrl,
  estimateMinervaFeeOptions,
  explorerTxUrl,
  formatBalanceWei,
  getChainDefinition,
  isMinervaNetwork,
  MINERVA_TESTNET_CHAIN_ID,
  MINERVA_ZERO_HASH,
  readAccountSnapshot,
  readMinervaAccountActivity,
  readMinervaDevPQAccount,
  readMinervaDevPQRotateAuthorization,
  readMinervaDevPQTransferAuthorization,
  requestMinervaDevnetFaucet,
  sendMinervaDevPQKeyRotation,
  sendMinervaDevPQTransfer,
  signMinervaPQAccountAuthorization,
  simulateMinervaTransfer,
  supportedChainId,
  type AccountReadSnapshot,
  type MinervaDevPQAccount,
  type MinervaDevPQDeployReceipt,
  type MinervaDevPQRotationReceipt,
  type MinervaDevPQTransferReceipt,
  type MinervaFaucetReceipt,
  type MinervaFeeCaps,
  type MinervaFeeOption,
} from "@minerva/evm";
import type { ActivityItem, TokenItem } from "@/lib/runtimeTypes";
import {
  generateMinervaDevPQKey,
  getUnlockedWalletProfile,
  getWalletBootStateForAnyChain,
  getWalletPreview,
  rememberMinervaDevPQDeployment,
  requireUnlockedWalletProfile,
  rotateStoredMinervaDevPQKey,
  type MinervaDevPQWalletProfile,
  type MinervaWalletPreview,
  type WalletBootState,
} from "@/lib/pqDevWallet";
import {
  minervaDevnetPQNativeGasKey,
  sendMinervaDevnetWalletPQTransfer,
} from "@/lib/mrvDevnetWalletFlow";
import { configuredMinervaChainId, readPublicEnv } from "@/lib/runtimeConfig";
import {
  indexedActivityItems,
  mergeWalletActivity,
  readWalletActivity,
  recordWalletActivity,
  type WalletActivityItem,
} from "@/lib/walletActivity";
import { getSelectedChainId, setSelectedChainId, type SelectableChainId } from "@/lib/networkPreference";
import { getActiveAccount, type WalletAccountRecord } from "@/lib/accounts";
import { onWalletChange } from "@/lib/walletEvents";
import {
  addPendingTransaction,
  listPendingTransactions,
  openPendingTransactions,
  refreshPendingStatuses,
  type PendingTransaction,
} from "@/lib/pendingTransactions";

type SnapshotStatus = "loading" | "live" | "fallback";
type FaucetStatus = "idle" | "requesting" | "success" | "error";
type PQActionStatus = "idle" | "requesting" | "success" | "error";
type RuntimeWalletStatus = WalletBootState["status"] | "watch-only";

const PLACEHOLDER_ADDRESS = "0x0000000000000000000000000000000000000000" as Hex;

interface SnapshotState {
  status: SnapshotStatus;
  walletStatus: RuntimeWalletStatus;
  walletPreview?: MinervaWalletPreview;
  activeAccount?: WalletAccountRecord;
  faucetStatus: FaucetStatus;
  deployStatus: PQActionStatus;
  pqTxStatus: PQActionStatus;
  pqRotateStatus: PQActionStatus;
  account: MinervaAccount;
  accountReady: boolean;
  activeAddress?: Hex;
  balanceWei?: bigint;
  balanceNative: string;
  balanceLabel: string;
  balanceUsd: string;
  tokens: TokenItem[];
  activity: (WalletActivityItem | ActivityItem)[];
  pending: PendingTransaction[];
  chainName: string;
  nativeCurrencySymbol: string;
  deploymentLabel: string;
  readinessLabel: string;
  latestBlock?: string;
  rpcUrl?: string;
  pqAccount?: MinervaDevPQAccount;
  pqProfile?: MinervaDevPQWalletProfile;
  pqCurrentPublicKeyCommitment?: Hex;
  error?: string;
  faucetError?: string;
  faucetReceipt?: MinervaFaucetReceipt;
  deployError?: string;
  deployReceipt?: MinervaDevPQDeployReceipt;
  pqTxError?: string;
  pqTxReceipt?: MinervaDevPQTransferReceipt;
  pqRotateError?: string;
  pqRotateReceipt?: MinervaDevPQRotationReceipt;
}

export interface SendPQTransferArgs {
  target?: Hex;
  valueWei?: string | bigint;
  data?: Hex;
  /** Fee caps chosen in the review's fee editor; omitted = the node's live estimate. */
  fee?: MinervaFeeCaps;
  gas?: string | bigint;
  /** Activity title override, e.g. "Sent 12 MTK". */
  title?: string;
  detail?: string;
  asset?: string;
  amountLabel?: string;
}

function explicitConfiguredAccountAddress(): Hex | undefined {
  const configured = readPublicEnv("EXPO_PUBLIC_MINERVA_ACCOUNT_ADDRESS");
  return configured?.startsWith("0x") ? (configured as Hex) : undefined;
}

function configuredChainId() {
  return configuredMinervaChainId();
}

function buildAccount(chainId: number, address: Hex, deployed = false, mode: SecurityMode = "PQ Native", label = "Minerva Account"): MinervaAccount {
  return {
    label,
    address,
    chainId,
    deployed,
    security: {
      mode,
      recovery: mode === "PQ Native" ? "active" : "missing",
      rotationRecommended: false,
      pqLayerEnabled: mode === "PQ Native" || mode === "PQ Ready" || mode === "Hybrid Protected",
    },
  };
}

function securityModeFromReadiness(snapshot: AccountReadSnapshot): SecurityMode {
  const mode = snapshot.mrv?.readiness?.securityMode ?? snapshot.mrv?.securityMode?.mode;
  if (isMinervaNetwork(snapshot.chainId) && !snapshot.deployed) return "PQ Native";
  if (
    mode === "Smart Account Ready" ||
    mode === "Hybrid Protected" ||
    mode === "PQ Ready" ||
    mode === "PQ Native" ||
    mode === "Legacy" ||
    mode === "Compatibility Mode"
  ) {
    return mode;
  }
  return isMinervaNetwork(snapshot.chainId) ? "PQ Native" : "Compatibility Mode";
}

function tokenForNative(snapshot: AccountReadSnapshot, balanceNative: string): TokenItem[] {
  return [
    {
      symbol: snapshot.nativeCurrencySymbol,
      name: snapshot.chainName,
      balance: balanceNative,
      fiatValue: "Live RPC",
    },
  ];
}

function chainDisplayName(chainId: number): string {
  return getChainDefinition(chainId)?.name ?? "Minerva Testnet";
}

function chainSymbol(chainId: number): string {
  return getChainDefinition(chainId)?.nativeCurrency.symbol ?? "MRV";
}

function emptyState(chainId = MINERVA_TESTNET_CHAIN_ID, preview?: MinervaWalletPreview, error?: string, active?: WalletAccountRecord): SnapshotState {
  const address = active?.kind === "watch" ? active.address : preview?.accountAddress ?? explicitConfiguredAccountAddress() ?? PLACEHOLDER_ADDRESS;
  const symbol = chainSymbol(chainId);
  return {
    status: error ? "fallback" : "loading",
    walletStatus: active?.kind === "watch" ? "watch-only" : preview ? "read-only-ready" : "no-wallet",
    walletPreview: preview,
    activeAccount: active,
    faucetStatus: "idle",
    deployStatus: "idle",
    pqTxStatus: "idle",
    pqRotateStatus: "idle",
    account: buildAccount(chainId, address ?? PLACEHOLDER_ADDRESS, false, "PQ Native", active?.label ?? "Minerva Account"),
    accountReady: Boolean(preview || explicitConfiguredAccountAddress() || active?.kind === "watch"),
    activeAddress: address,
    balanceWei: undefined,
    balanceNative: "0.0000",
    balanceLabel: `— ${symbol}`,
    balanceUsd: `— ${symbol}`,
    tokens: [],
    activity: [],
    pending: [],
    chainName: chainDisplayName(chainId),
    nativeCurrencySymbol: symbol,
    deploymentLabel: preview ? "Counterfactual" : active?.kind === "watch" ? "Watch-only" : "No wallet",
    readinessLabel: preview ? "PQ Native Pending Deployment" : active?.kind === "watch" ? "Watch-only" : "No wallet",
    error,
  };
}

function buildLiveState(
  snapshot: AccountReadSnapshot,
  preview?: MinervaWalletPreview,
  pqAccount?: MinervaDevPQAccount,
  pqProfile?: MinervaDevPQWalletProfile,
  active?: WalletAccountRecord,
): SnapshotState {
  const balanceNative = formatBalanceWei(snapshot.balanceWei);
  const securityMode = securityModeFromReadiness(snapshot);
  const pqCurrentPublicKeyCommitment =
    snapshot.mrv?.readiness?.readiness?.pqPublicKeyCommitment ??
    pqProfile?.currentPublicKeyCommitment ??
    preview?.currentPublicKeyCommitment ??
    pqAccount?.publicKeyCommitment;
  const account = buildAccount(snapshot.chainId, snapshot.address, snapshot.deployed, securityMode, active?.label ?? "Minerva Account");
  const watch = active?.kind === "watch";

  return {
    status: "live",
    walletStatus: watch ? "watch-only" : pqProfile ? "unlocked" : preview ? "read-only-ready" : "no-wallet",
    walletPreview: preview,
    activeAccount: active,
    faucetStatus: "idle",
    deployStatus: "idle",
    pqTxStatus: "idle",
    pqRotateStatus: "idle",
    account,
    accountReady: true,
    activeAddress: snapshot.address,
    balanceWei: snapshot.balanceWei,
    balanceNative,
    balanceLabel: `${balanceNative} ${snapshot.nativeCurrencySymbol}`,
    balanceUsd: `${balanceNative} ${snapshot.nativeCurrencySymbol}`,
    chainName: snapshot.chainName,
    nativeCurrencySymbol: snapshot.nativeCurrencySymbol,
    deploymentLabel: watch ? "Watch-only" : snapshot.deployed ? "Deployed" : "Counterfactual",
    readinessLabel:
      snapshot.mrv?.readiness?.securityMode ??
      snapshot.mrv?.securityMode?.mode ??
      (snapshot.deployed ? "PQ Native" : watch ? "Watch-only" : "PQ Native Pending Deployment"),
    latestBlock: snapshot.latestBlock.toString(),
    rpcUrl: snapshot.rpcUrl,
    pqAccount,
    pqProfile,
    pqCurrentPublicKeyCommitment,
    activity: [],
    pending: [],
    tokens: tokenForNative(snapshot, balanceNative),
  };
}

function deploymentRequestFromPreview(preview: MinervaWalletPreview) {
  return {
    publicKey: preview.deploymentPublicKey,
    salt: preview.deploymentSalt,
  };
}

function mergeActionState(nextState: SnapshotState, current: SnapshotState): SnapshotState {
  return {
    ...nextState,
    faucetStatus: current.faucetStatus === "requesting" ? "idle" : current.faucetStatus,
    faucetReceipt: current.faucetReceipt,
    deployStatus: current.deployStatus === "requesting" ? "idle" : current.deployStatus,
    deployReceipt: current.deployReceipt,
    pqTxStatus: current.pqTxStatus === "requesting" ? "idle" : current.pqTxStatus,
    pqTxReceipt: current.pqTxReceipt,
    pqRotateStatus: current.pqRotateStatus === "requesting" ? "idle" : current.pqRotateStatus,
    pqRotateReceipt: current.pqRotateReceipt,
  };
}

function receiptActivityStatus(status: string): "pending" | "success" | "failed" {
  if (status === "success") return "success";
  if (status === "pending") return "pending";
  return "failed";
}

export function useAccountSnapshot() {
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<SnapshotState>(() => emptyState());
  const [chainOverride, setChainOverride] = useState<number | undefined>();

  // Chain preference: the persisted selection wins over the build's env default.
  useEffect(() => {
    let active = true;
    getSelectedChainId()
      .then((selected) => {
        if (!active) return;
        const envChainId = configuredChainId();
        if (selected !== undefined && selected !== envChainId) setChainOverride(selected);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Any wallet-level change (account switch, token added, network edited, pending update) reloads,
  // and the persisted chain selection is re-read so a switch made elsewhere (WalletConnect) applies.
  useEffect(
    () =>
      onWalletChange(() => {
        getSelectedChainId()
          .then((selected) => {
            const envChainId = configuredChainId();
            setChainOverride(selected !== undefined && selected !== envChainId ? selected : undefined);
          })
          .catch(() => undefined)
          .finally(() => setReloadKey((key) => key + 1));
      }),
    [],
  );

  const config = useMemo(() => {
    const envChainId = configuredChainId();
    if (chainOverride === undefined || chainOverride === envChainId) {
      return {
        chainId: envChainId,
        rpcUrl: readPublicEnv("EXPO_PUBLIC_MINERVA_RPC_URL") ?? defaultMinervaRpcUrl(envChainId),
        faucetUrl: readPublicEnv("EXPO_PUBLIC_MINERVA_FAUCET_URL") ?? defaultMinervaFaucetUrl(envChainId),
        pqRelayerUrl: readPublicEnv("EXPO_PUBLIC_MINERVA_PQ_RELAYER_URL") ?? defaultMinervaPQRelayerUrl(envChainId),
        indexerUrl: readPublicEnv("EXPO_PUBLIC_MINERVA_INDEXER_URL") ?? defaultMinervaIndexerUrl(envChainId),
      };
    }
    const chainId = supportedChainId(chainOverride);
    return {
      chainId,
      rpcUrl: defaultMinervaRpcUrl(chainId),
      faucetUrl: defaultMinervaFaucetUrl(chainId),
      pqRelayerUrl: defaultMinervaPQRelayerUrl(chainId),
      indexerUrl: defaultMinervaIndexerUrl(chainId),
    };
  }, [chainOverride, reloadKey]);

  const refresh = useCallback(() => setReloadKey((key) => key + 1), []);

  const setChain = useCallback(async (chainId: number) => {
    const next = supportedChainId(chainId);
    await setSelectedChainId(next as SelectableChainId);
    setChainOverride(next);
    setReloadKey((key) => key + 1);
  }, []);

  const simulateTransfer = useCallback(
    async (args: { to: Hex; valueWei: bigint; data?: Hex }) => {
      if (!state.activeAddress) throw new Error("No Minerva Account is available.");
      return simulateMinervaTransfer(
        { from: state.activeAddress, to: args.to, valueWei: args.valueWei, data: args.data },
        { chainId: config.chainId, rpcUrl: config.rpcUrl },
      );
    },
    [config.chainId, config.rpcUrl, state.activeAddress],
  );

  const estimateFees = useCallback(
    async (gas?: bigint): Promise<MinervaFeeOption[]> => estimateMinervaFeeOptions({ chainId: config.chainId, rpcUrl: config.rpcUrl }, gas),
    [config.chainId, config.rpcUrl],
  );

  const requestFaucet = useCallback(async () => {
    if (!isMinervaNetwork(config.chainId)) {
      setState((current) => ({
        ...current,
        faucetStatus: "error",
        faucetError: "Faucet is only available on Minerva PQ-native networks.",
      }));
      return;
    }

    setState((current) => ({ ...current, faucetStatus: "requesting", faucetError: undefined }));
    try {
      const preview = await getWalletPreview(config.chainId);
      if (!preview) throw new Error("Create or restore a Minerva Account before requesting faucet funds.");
      const faucetReceipt = await requestMinervaDevnetFaucet(
        preview.accountAddress,
        { chainId: config.chainId, faucetUrl: config.faucetUrl },
        { publicKey: preview.deploymentPublicKey, salt: preview.deploymentSalt, deployAccount: true },
      );
      await rememberMinervaDevPQDeployment({
        chainId: config.chainId,
        accountAddress: preview.accountAddress,
        deploymentPublicKey: preview.deploymentPublicKey,
        deploymentSalt: preview.deploymentSalt,
        currentPublicKeyCommitment: preview.currentPublicKeyCommitment,
      }).catch(() => undefined);
      await recordWalletActivity(
        { chainId: config.chainId, accountAddress: preview.accountAddress },
        {
          type: "receive",
          title: "Faucet funded account",
          detail: `${formatBalanceWei(BigInt(faucetReceipt.amountWei))} MRV`,
          badge: "PQ Native",
          hash: faucetReceipt.hash,
          explorerUrl: explorerTxUrl(faucetReceipt.hash, config.chainId),
          source: "local",
          direction: "received",
          labels: ["Faucet", "Received"],
          to: preview.accountAddress,
          asset: "MRV",
          amountLabel: `${formatBalanceWei(BigInt(faucetReceipt.amountWei))} MRV`,
          security: faucetReceipt.signerMode ?? "PQ Native",
          status: "success",
        },
      );
      setState((current) => ({ ...current, faucetStatus: "success", faucetReceipt }));
      setReloadKey((key) => key + 1);
    } catch (error) {
      setState((current) => ({
        ...current,
        faucetStatus: "error",
        faucetError: error instanceof Error ? error.message : "Faucet request failed.",
      }));
    }
  }, [config.chainId, config.faucetUrl]);

  const deployPQAccount = useCallback(async () => {
    if (!isMinervaNetwork(config.chainId)) {
      setState((current) => ({
        ...current,
        deployStatus: "error",
        deployError: "PQ account deployment is only available on Minerva PQ-native networks.",
      }));
      return;
    }

    setState((current) => ({ ...current, deployStatus: "requesting", deployError: undefined }));
    try {
      const preview = await getWalletPreview(config.chainId);
      if (!preview) throw new Error("Create or restore a Minerva Account before deploying.");
      const deployReceipt = await deployMinervaDevPQAccount(deploymentRequestFromPreview(preview), {
        chainId: config.chainId,
        faucetUrl: config.faucetUrl,
        pqRelayerUrl: config.pqRelayerUrl,
      });
      await rememberMinervaDevPQDeployment({
        chainId: config.chainId,
        accountAddress: deployReceipt.accountAddress,
        deploymentPublicKey: preview.deploymentPublicKey,
        deploymentSalt: preview.deploymentSalt,
      }).catch(() => undefined);
      if (deployReceipt.transactionHash) {
        await recordWalletActivity(
          { chainId: config.chainId, accountAddress: deployReceipt.accountAddress },
          {
            type: "security",
            title: "Minerva Account deployed",
            detail: "Smart account is active onchain",
            badge: "PQ Native",
            hash: deployReceipt.transactionHash,
            explorerUrl: explorerTxUrl(deployReceipt.transactionHash, config.chainId),
            source: "local",
            direction: "unknown",
            labels: ["Account deployed"],
            security: "Account deployment",
            status: "success",
          },
        );
      }
      setState((current) => ({ ...current, deployStatus: "success", deployReceipt }));
      setReloadKey((key) => key + 1);
    } catch (error) {
      setState((current) => ({
        ...current,
        deployStatus: "error",
        deployError: error instanceof Error ? error.message : "PQ account deployment failed.",
      }));
    }
  }, [config.chainId, config.faucetUrl, config.pqRelayerUrl]);

  const sendPQTransfer = useCallback(
    async (args?: SendPQTransferArgs) => {
      if (!isMinervaNetwork(config.chainId)) {
        const pqError = new Error("PQ transfer is only available on Minerva PQ-native networks.");
        setState((current) => ({ ...current, pqTxStatus: "error", pqTxError: pqError.message }));
        throw pqError;
      }
      if (!args?.target || args.valueWei === undefined) {
        const pqError = new Error("Recipient and amount are required before signing.");
        setState((current) => ({ ...current, pqTxStatus: "error", pqTxError: pqError.message }));
        throw pqError;
      }

      setState((current) => ({ ...current, pqTxStatus: "requesting", pqTxError: undefined }));
      try {
        const pqProfile = requireUnlockedWalletProfile(config.chainId);
        const pqAccount = await readMinervaDevPQAccount(
          {
            publicKey: pqProfile.deploymentPublicKey,
            salt: pqProfile.deploymentSalt,
          },
          { chainId: config.chainId, pqRelayerUrl: config.pqRelayerUrl },
        );
        await rememberMinervaDevPQDeployment({
          chainId: config.chainId,
          accountAddress: pqAccount.accountAddress,
          deploymentPublicKey: pqProfile.deploymentPublicKey,
          deploymentSalt: pqAccount.salt,
          currentPublicKeyCommitment: pqProfile.currentPublicKeyCommitment ?? pqAccount.publicKeyCommitment,
        });
        const transfer = await sendMinervaDevnetWalletPQTransfer(
          pqProfile,
          { chainId: config.chainId, rpcUrl: config.rpcUrl, faucetUrl: config.faucetUrl, pqRelayerUrl: config.pqRelayerUrl },
          { target: args.target, valueWei: args.valueWei, data: args.data ?? "0x", fee: args.fee, gas: args.gas },
        );
        const pqTxReceipt = transfer.receipt;
        const valueLabel = `${formatBalanceWei(BigInt(pqTxReceipt.valueWei))} ${chainSymbol(config.chainId)}`;
        const activityStatus = receiptActivityStatus(pqTxReceipt.status);
        const title = args.title ?? (args.data && args.data !== "0x" ? "Contract call" : `Sent ${valueLabel}`);
        await recordWalletActivity(
          { chainId: config.chainId, accountAddress: pqTxReceipt.accountAddress },
          {
            type: "send",
            title,
            detail: args.detail ?? `To ${pqTxReceipt.target.slice(0, 6)}...${pqTxReceipt.target.slice(-4)}`,
            badge: activityStatus === "pending" ? "Pending" : "PQ Native",
            hash: pqTxReceipt.transactionHash,
            explorerUrl: explorerTxUrl(pqTxReceipt.transactionHash, config.chainId),
            source: "local",
            direction: "sent",
            labels: ["Sent"],
            from: pqTxReceipt.accountAddress,
            to: pqTxReceipt.target,
            asset: args.asset ?? chainSymbol(config.chainId),
            amountLabel: args.amountLabel ?? valueLabel,
            fee: `${chainSymbol(config.chainId)} gas`,
            security: pqTxReceipt.signerMode ?? "ML-DSA PQ signature",
            status: activityStatus,
          },
        );
        if (pqTxReceipt.nativeTransactionNonce !== undefined && pqTxReceipt.gasTipCap && pqTxReceipt.gasFeeCap) {
          await addPendingTransaction(
            { chainId: config.chainId, accountAddress: pqTxReceipt.accountAddress },
            {
              hash: pqTxReceipt.transactionHash,
              chainId: config.chainId,
              accountAddress: pqTxReceipt.accountAddress,
              kind: "transfer",
              title,
              target: pqTxReceipt.target,
              valueWei: pqTxReceipt.valueWei,
              data: pqTxReceipt.data,
              accountNonce: transfer.authorization.nonce,
              signature: transfer.signature,
              nativeTransactionNonce: pqTxReceipt.nativeTransactionNonce,
              gasTipCap: pqTxReceipt.gasTipCap,
              gasFeeCap: pqTxReceipt.gasFeeCap,
              gas: pqTxReceipt.gas ?? "1500000",
              submittedAt: new Date().toISOString(),
              state: activityStatus === "pending" ? "pending" : activityStatus,
              confirmedBlock: activityStatus === "pending" ? undefined : pqTxReceipt.blockNumber,
            },
          );
        }
        setState((current) => ({ ...current, pqTxStatus: "success", pqTxReceipt }));
        setReloadKey((key) => key + 1);
        return pqTxReceipt;
      } catch (error) {
        setState((current) => ({
          ...current,
          pqTxStatus: "error",
          pqTxError: error instanceof Error ? error.message : "PQ transfer failed.",
        }));
        throw error;
      }
    },
    [config.chainId, config.faucetUrl, config.pqRelayerUrl, config.rpcUrl],
  );

  /** Re-broadcasts a pending envelope with the same inner call and native nonce at higher fee caps. */
  const speedUpTransaction = useCallback(
    async (hash: Hex) => {
      const pqProfile = requireUnlockedWalletProfile(config.chainId);
      const context = { chainId: config.chainId, accountAddress: pqProfile.accountAddress! };
      const item = (await listPendingTransactions(context)).find((entry) => entry.hash.toLowerCase() === hash.toLowerCase());
      if (!item) throw new Error("Pending transaction not found.");
      if (item.state !== "pending") throw new Error("This transaction is no longer pending.");
      const gasKey = minervaDevnetPQNativeGasKey(pqProfile);
      const fee = bumpMinervaFeeCaps(item);
      const receipt = await sendMinervaDevPQTransfer(
        {
          accountAddress: item.accountAddress,
          target: item.target,
          valueWei: item.valueWei,
          data: item.data,
          nonce: item.accountNonce,
          signature: item.signature,
          publicKey: gasKey.publicKey,
          privateKey: gasKey.privateKey,
          salt: pqProfile.deploymentSalt ?? MINERVA_ZERO_HASH,
          nativeTransactionNonce: item.nativeTransactionNonce,
          gas: item.gas,
          fee,
        },
        { chainId: config.chainId, rpcUrl: config.rpcUrl, pqRelayerUrl: config.pqRelayerUrl },
      );
      await addPendingTransaction(context, {
        ...item,
        hash: receipt.transactionHash,
        kind: "speed-up",
        title: `${item.title} (sped up)`,
        gasTipCap: receipt.gasTipCap ?? fee.gasTipCap.toString(),
        gasFeeCap: receipt.gasFeeCap ?? fee.gasFeeCap.toString(),
        submittedAt: new Date().toISOString(),
        state: receipt.status === "success" ? "success" : receipt.status === "pending" ? "pending" : "failed",
        replaces: item.hash,
      });
      setReloadKey((key) => key + 1);
      return receipt;
    },
    [config.chainId, config.pqRelayerUrl, config.rpcUrl],
  );

  /** Replaces a pending envelope with a zero-value self-call at higher fee caps. */
  const cancelTransaction = useCallback(
    async (hash: Hex) => {
      const pqProfile = requireUnlockedWalletProfile(config.chainId);
      const context = { chainId: config.chainId, accountAddress: pqProfile.accountAddress! };
      const item = (await listPendingTransactions(context)).find((entry) => entry.hash.toLowerCase() === hash.toLowerCase());
      if (!item) throw new Error("Pending transaction not found.");
      if (item.state !== "pending") throw new Error("This transaction is no longer pending.");
      const authorization = await readMinervaDevPQTransferAuthorization(
        { accountAddress: item.accountAddress, target: item.accountAddress, valueWei: 0n, data: "0x" },
        { chainId: config.chainId, rpcUrl: config.rpcUrl },
      );
      if (authorization.nonce !== item.accountNonce) {
        throw new Error("The original transaction was already included; it can no longer be cancelled.");
      }
      const signature = signMinervaPQAccountAuthorization(authorization.message, pqProfile.currentKey.privateKey);
      const gasKey = minervaDevnetPQNativeGasKey(pqProfile);
      const fee = bumpMinervaFeeCaps(item);
      const receipt = await sendMinervaDevPQTransfer(
        {
          accountAddress: item.accountAddress,
          target: item.accountAddress,
          valueWei: 0n,
          data: "0x",
          nonce: authorization.nonce,
          signature,
          publicKey: gasKey.publicKey,
          privateKey: gasKey.privateKey,
          salt: pqProfile.deploymentSalt ?? MINERVA_ZERO_HASH,
          nativeTransactionNonce: item.nativeTransactionNonce,
          gas: item.gas,
          fee,
        },
        { chainId: config.chainId, rpcUrl: config.rpcUrl, pqRelayerUrl: config.pqRelayerUrl },
      );
      await addPendingTransaction(context, {
        ...item,
        hash: receipt.transactionHash,
        kind: "cancel",
        title: `Cancel: ${item.title}`,
        target: item.accountAddress,
        valueWei: "0",
        data: "0x",
        signature,
        gasTipCap: receipt.gasTipCap ?? fee.gasTipCap.toString(),
        gasFeeCap: receipt.gasFeeCap ?? fee.gasFeeCap.toString(),
        submittedAt: new Date().toISOString(),
        state: receipt.status === "success" ? "success" : receipt.status === "pending" ? "pending" : "failed",
        replaces: item.hash,
      });
      setReloadKey((key) => key + 1);
      return receipt;
    },
    [config.chainId, config.pqRelayerUrl, config.rpcUrl],
  );

  const rotatePQKey = useCallback(async () => {
    if (!isMinervaNetwork(config.chainId)) {
      const pqError = new Error("PQ key rotation is only available on Minerva PQ-native networks.");
      setState((current) => ({ ...current, pqRotateStatus: "error", pqRotateError: pqError.message }));
      throw pqError;
    }

    setState((current) => ({ ...current, pqRotateStatus: "requesting", pqRotateError: undefined }));
    try {
      const pqProfile = requireUnlockedWalletProfile(config.chainId);
      const pqAccount = await readMinervaDevPQAccount(
        {
          publicKey: pqProfile.deploymentPublicKey,
          salt: pqProfile.deploymentSalt,
        },
        { chainId: config.chainId, pqRelayerUrl: config.pqRelayerUrl },
      );
      if (!pqAccount.deployed) throw new Error("Deploy the Minerva Account before rotating its PQ key.");

      const nextKey = await generateMinervaDevPQKey();
      const gasKey = minervaDevnetPQNativeGasKey(pqProfile);
      const authorization = await readMinervaDevPQRotateAuthorization(
        { accountAddress: pqAccount.accountAddress, newPublicKey: nextKey.publicKey },
        { chainId: config.chainId, rpcUrl: config.rpcUrl },
      );
      const signature = signMinervaPQAccountAuthorization(authorization.message, pqProfile.currentKey.privateKey);
      const pqRotateReceipt = await sendMinervaDevPQKeyRotation(
        {
          accountAddress: pqAccount.accountAddress,
          newPublicKey: nextKey.publicKey,
          nonce: authorization.nonce,
          signature,
          publicKey: gasKey.publicKey,
          privateKey: gasKey.privateKey,
          salt: pqAccount.salt,
        },
        { chainId: config.chainId, rpcUrl: config.rpcUrl, pqRelayerUrl: config.pqRelayerUrl },
      );
      const nextProfile = await rotateStoredMinervaDevPQKey(nextKey, {
        chainId: config.chainId,
        accountAddress: pqRotateReceipt.accountAddress,
        deploymentPublicKey: pqProfile.deploymentPublicKey,
        deploymentSalt: pqAccount.salt,
        currentPublicKeyCommitment: pqRotateReceipt.newPublicKeyCommitment,
        lastRotationTransactionHash: pqRotateReceipt.transactionHash,
      });
      await recordWalletActivity(
        { chainId: config.chainId, accountAddress: pqRotateReceipt.accountAddress },
        {
          type: "security",
          title: "PQ key rotated",
          detail: `ML-DSA key v${nextProfile.keyVersion} is active`,
          badge: "PQ Native",
          hash: pqRotateReceipt.transactionHash,
          explorerUrl: explorerTxUrl(pqRotateReceipt.transactionHash, config.chainId),
          source: "local",
          direction: "unknown",
          labels: ["PQ key rotated"],
          security: pqRotateReceipt.signerMode ?? "ML-DSA PQ rotation",
          status: pqRotateReceipt.status === "success" ? "success" : "failed",
        },
      );
      setState((current) => ({
        ...current,
        pqRotateStatus: "success",
        pqRotateReceipt,
        pqProfile: nextProfile,
        pqCurrentPublicKeyCommitment: pqRotateReceipt.newPublicKeyCommitment,
      }));
      setReloadKey((key) => key + 1);
      return pqRotateReceipt;
    } catch (error) {
      setState((current) => ({
        ...current,
        pqRotateStatus: "error",
        pqRotateError: error instanceof Error ? error.message : "PQ key rotation failed.",
      }));
      throw error;
    }
  }, [config.chainId, config.pqRelayerUrl, config.rpcUrl]);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, status: "loading", error: undefined }));

    async function readLiveState(): Promise<SnapshotState> {
      const active = await getActiveAccount();

      if (active?.kind === "watch" && active.address) {
        const snapshot = await readAccountSnapshot(active.address, { chainId: config.chainId, rpcUrl: config.rpcUrl });
        const nextState = buildLiveState(snapshot, undefined, undefined, undefined, active);
        const context = { chainId: config.chainId, accountAddress: active.address };
        const indexedActivity = await readMinervaAccountActivity(active.address, { chainId: config.chainId, indexerUrl: config.indexerUrl })
          .then((indexed) => indexedActivityItems(context, indexed))
          .catch(() => []);
        return { ...nextState, activity: mergeWalletActivity([], indexedActivity) };
      }

      const bootState = await getWalletBootStateForAnyChain(config.chainId);
      if (bootState.status === "error") throw new Error(bootState.error);
      const preview = "preview" in bootState ? bootState.preview : undefined;
      const configuredAddress = explicitConfiguredAccountAddress();
      const address = preview?.accountAddress ?? configuredAddress;
      if (!address) throw new Error("No Minerva Account profile found. Create or restore a wallet first.");

      const pqProfile = getUnlockedWalletProfile(config.chainId);
      const pqAccount =
        preview && isMinervaNetwork(config.chainId)
          ? await readMinervaDevPQAccount(deploymentRequestFromPreview(preview), {
              chainId: config.chainId,
              pqRelayerUrl: config.pqRelayerUrl,
            }).catch(() => undefined)
          : undefined;
      if (pqProfile && pqAccount) {
        await rememberMinervaDevPQDeployment({
          chainId: config.chainId,
          accountAddress: pqAccount.accountAddress,
          deploymentPublicKey: pqProfile.deploymentPublicKey,
          deploymentSalt: pqAccount.salt,
          currentPublicKeyCommitment: pqProfile.currentPublicKeyCommitment ?? pqAccount.publicKeyCommitment,
        });
      }
      const snapshot = await readAccountSnapshot(address, { chainId: config.chainId, rpcUrl: config.rpcUrl });
      const nextState = buildLiveState(snapshot, preview, pqAccount, pqProfile, active);
      const context = { chainId: config.chainId, accountAddress: address };
      await refreshPendingStatuses(context, { chainId: config.chainId, rpcUrl: config.rpcUrl }).catch(() => false);
      const [localActivity, indexedActivity, pendingItems] = await Promise.all([
        readWalletActivity(context),
        readMinervaAccountActivity(address, {
          chainId: config.chainId,
          indexerUrl: config.indexerUrl,
        })
          .then((indexed) => indexedActivityItems(context, indexed))
          .catch(() => []),
        listPendingTransactions(context),
      ]);
      return {
        ...nextState,
        walletStatus: bootState.status === "read-only-ready" && pqProfile ? "unlocked" : nextState.walletStatus,
        activity: mergeWalletActivity(localActivity, indexedActivity),
        pending: openPendingTransactions(pendingItems),
      };
    }

    readLiveState()
      .then((nextState) => {
        if (!cancelled) setState((current) => mergeActionState(nextState, current));
      })
      .catch(async (error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "RPC read failed.";
        const [preview, active] = await Promise.all([
          getWalletPreview(config.chainId).catch(() => undefined),
          getActiveAccount().catch(() => undefined),
        ]);
        setState((current) => ({
          ...emptyState(config.chainId, preview, message, active),
          faucetStatus: current.faucetStatus,
          deployStatus: current.deployStatus,
          pqTxStatus: current.pqTxStatus,
          pqRotateStatus: current.pqRotateStatus,
          faucetReceipt: current.faucetReceipt,
          deployReceipt: current.deployReceipt,
          pqTxReceipt: current.pqTxReceipt,
          pqRotateReceipt: current.pqRotateReceipt,
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [config.chainId, config.indexerUrl, config.pqRelayerUrl, config.rpcUrl, reloadKey]);

  // While something is pending, poll its status every few seconds.
  useEffect(() => {
    if (!state.pending.some((item) => item.state === "pending") || !state.activeAddress) return;
    const context = { chainId: config.chainId, accountAddress: state.activeAddress };
    const handle = setInterval(() => {
      void refreshPendingStatuses(context, { chainId: config.chainId, rpcUrl: config.rpcUrl }).catch(() => false);
    }, 4000);
    return () => clearInterval(handle);
  }, [config.chainId, config.rpcUrl, state.activeAddress, state.pending]);

  return {
    ...state,
    refresh,
    requestFaucet,
    deployPQAccount,
    sendPQTransfer,
    speedUpTransaction,
    cancelTransaction,
    rotatePQKey,
    simulateTransfer,
    estimateFees,
    setChain,
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    indexerUrl: config.indexerUrl,
    isMinervaDevnet: isMinervaNetwork(config.chainId),
    isWatchOnly: state.walletStatus === "watch-only",
  };
}
