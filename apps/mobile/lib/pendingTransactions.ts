import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Hex } from "@minerva/core";
import { readMinervaTransactionStatus, type EvmReadConfig } from "@minerva/evm";
import { emitWalletChange } from "@/lib/walletEvents";

const STORAGE_PREFIX = "minerva.wallet.pending.v1";
const MAX_ITEMS = 25;

export type PendingTransactionKind = "transfer" | "speed-up" | "cancel";
export type PendingTransactionState = "pending" | "success" | "failed" | "dropped" | "replaced";

/**
 * Everything needed to rebuild a MinervaPQTxV1 envelope for the same account nonce: the inner
 * call and its PQ authorization (already signed), the native nonce and the fee caps used.
 */
export interface PendingTransaction {
  hash: Hex;
  chainId: number;
  accountAddress: Hex;
  kind: PendingTransactionKind;
  title: string;
  target: Hex;
  valueWei: string;
  data: Hex;
  accountNonce: string;
  signature: Hex;
  nativeTransactionNonce: string;
  gasTipCap: string;
  gasFeeCap: string;
  gas: string;
  submittedAt: string;
  state: PendingTransactionState;
  /** Hash of the transaction this one replaces (speed-up / cancel). */
  replaces?: Hex;
  confirmedBlock?: string;
}

export interface PendingContext {
  chainId: number;
  accountAddress: Hex;
}

function storageKey(context: PendingContext) {
  return `${STORAGE_PREFIX}.${context.chainId}.${context.accountAddress.toLowerCase()}`;
}

export async function listPendingTransactions(context: PendingContext): Promise<PendingTransaction[]> {
  const raw = await AsyncStorage.getItem(storageKey(context));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PendingTransaction[]).filter((item) => typeof item?.hash === "string") : [];
  } catch {
    return [];
  }
}

async function writePending(context: PendingContext, items: PendingTransaction[]): Promise<void> {
  const ordered = [...items].sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt)).slice(0, MAX_ITEMS);
  await AsyncStorage.setItem(storageKey(context), JSON.stringify(ordered));
}

export async function addPendingTransaction(context: PendingContext, item: PendingTransaction): Promise<void> {
  const current = await listPendingTransactions(context);
  await writePending(context, [item, ...current.filter((existing) => existing.hash.toLowerCase() !== item.hash.toLowerCase())]);
  emitWalletChange();
}

export async function updatePendingTransaction(context: PendingContext, hash: Hex, patch: Partial<PendingTransaction>): Promise<void> {
  const current = await listPendingTransactions(context);
  await writePending(
    context,
    current.map((item) => (item.hash.toLowerCase() === hash.toLowerCase() ? { ...item, ...patch } : item)),
  );
}

export async function removePendingTransaction(context: PendingContext, hash: Hex): Promise<void> {
  const current = await listPendingTransactions(context);
  await writePending(
    context,
    current.filter((item) => item.hash.toLowerCase() !== hash.toLowerCase()),
  );
  emitWalletChange();
}

/** Still-open items: pending, or confirmed less than ten minutes ago so the user sees the outcome. */
export function openPendingTransactions(items: readonly PendingTransaction[], now = Date.now()): PendingTransaction[] {
  return items.filter((item) => item.state === "pending" || now - Date.parse(item.submittedAt) < 10 * 60_000);
}

/**
 * Polls the node for every pending item. When one envelope of a replacement chain (same native
 * nonce) is mined, the others are marked "replaced". Returns true when anything changed.
 */
export async function refreshPendingStatuses(context: PendingContext, config: Pick<EvmReadConfig, "chainId" | "rpcUrl">): Promise<boolean> {
  const current = await listPendingTransactions(context);
  const pending = current.filter((item) => item.state === "pending");
  if (pending.length === 0) return false;
  let changed = false;
  const next = [...current];
  for (const item of pending) {
    const status = await readMinervaTransactionStatus(item.hash, config).catch(() => undefined);
    if (!status || status.state === "pending") continue;
    const index = next.findIndex((entry) => entry.hash === item.hash);
    if (index < 0) continue;
    if (status.state === "dropped") {
      // Dropped from the pool: either replaced by a sibling with the same native nonce or evicted.
      const sibling = next.find(
        (entry) => entry.hash !== item.hash && entry.nativeTransactionNonce === item.nativeTransactionNonce && entry.state !== "dropped",
      );
      next[index] = { ...item, state: sibling ? "replaced" : "dropped" };
      changed = true;
      continue;
    }
    next[index] = { ...item, state: status.state, confirmedBlock: status.blockNumber };
    changed = true;
    for (let i = 0; i < next.length; i += 1) {
      const entry = next[i]!;
      if (entry.hash !== item.hash && entry.nativeTransactionNonce === item.nativeTransactionNonce && entry.state === "pending") {
        next[i] = { ...entry, state: "replaced" };
      }
    }
  }
  if (changed) {
    await writePending(context, next);
    emitWalletChange();
  }
  return changed;
}
