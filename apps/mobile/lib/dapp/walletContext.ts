/**
 * Wallet state for dapp requests that arrive outside a React component (WalletConnect events).
 *
 * Screens use `useAccountSnapshot()`; this module reads the same persisted sources (selected chain,
 * active account registry, keyring boot state) so the WalletConnect handler sees exactly what the
 * UI shows. Screens that own a snapshot can also publish it here so the two never diverge while a
 * screen is mounted.
 */
import type { Hex } from "@minerva/core";
import { defaultMinervaRpcUrl, getChainDefinition, supportedChainId } from "@minerva/evm";
import { accountAddress, getActiveAccount } from "@/lib/accounts";
import { getSelectedChainId, setSelectedChainId, type SelectableChainId } from "@/lib/networkPreference";
import { getUnlockedWalletProfile, getWalletBootStateForAnyChain } from "@/lib/pqDevWallet";
import { configuredMinervaChainId, readPublicEnv } from "@/lib/runtimeConfig";
import { emitWalletChange } from "@/lib/walletEvents";

export type DappWalletStatus = "unlocked" | "read-only-ready" | "watch-only" | "locked" | "no-wallet" | "migrate-required" | "error";

export interface DappWalletContext {
  chainId: number;
  rpcUrl: string;
  activeAddress?: Hex;
  walletStatus: DappWalletStatus;
  isWatchOnly: boolean;
  /** Switches the wallet's selected chain (persisted; screens reload through wallet events). */
  setChain: (chainId: number) => Promise<void>;
}

type PublishedContext = Omit<DappWalletContext, "setChain"> & { setChain?: DappWalletContext["setChain"] };

let published: PublishedContext | undefined;

/**
 * Called by screens that own a `useAccountSnapshot()` so background handlers (WalletConnect) reuse the
 * mounted screen's `setChain`, which updates that screen's React state as well as the persisted choice.
 */
export function publishDappWalletContext(context: PublishedContext): void {
  published = context;
}

export function clearPublishedDappWalletContext(): void {
  published = undefined;
}

export function rpcUrlForChain(chainId: number): string {
  const envChainId = configuredMinervaChainId();
  if (chainId === envChainId) {
    const override = readPublicEnv("EXPO_PUBLIC_MINERVA_RPC_URL");
    if (override) return override;
  }
  return getChainDefinition(chainId)?.rpcUrl ?? defaultMinervaRpcUrl(chainId);
}

export async function switchSelectedChain(chainId: number): Promise<void> {
  const next = supportedChainId(chainId);
  await setSelectedChainId(next as SelectableChainId);
  if (published) published = { ...published, chainId: next, rpcUrl: rpcUrlForChain(next) };
  emitWalletChange();
}

export async function readDappWalletContext(): Promise<DappWalletContext> {
  const selected = await getSelectedChainId().catch(() => undefined);
  const chainId = supportedChainId(selected ?? configuredMinervaChainId());
  const rpcUrl = rpcUrlForChain(chainId);

  const active = await getActiveAccount().catch(() => undefined);
  const address = active ? await accountAddress(active).catch(() => undefined) : undefined;

  let walletStatus: DappWalletStatus;
  if (active?.kind === "watch") {
    walletStatus = "watch-only";
  } else {
    const boot = await getWalletBootStateForAnyChain(chainId).catch(() => ({ status: "error" as const }));
    walletStatus = boot.status === "read-only-ready" && getUnlockedWalletProfile(chainId) ? "unlocked" : boot.status;
  }

  const setChain = published?.setChain ?? switchSelectedChain;
  return { chainId, rpcUrl, activeAddress: address, walletStatus, isWatchOnly: walletStatus === "watch-only", setChain };
}
