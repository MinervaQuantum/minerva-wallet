import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Hex } from "@minerva/core";
import { isValidEvmAddress, normalizeEvmAddress } from "@minerva/evm";
import {
  PRIMARY_WALLET_SLOT,
  createWalletProfileInNewSlot,
  deleteWalletSlot,
  getUnlockedWalletPasscode,
  getWalletPreview,
  importBackupIntoNewSlot,
  readWalletSlotPreview,
  setActiveWalletSlot,
  switchWalletSlot,
} from "@/lib/pqDevWallet";
import { emitWalletChange } from "@/lib/walletEvents";

const STORAGE_KEY = "minerva.wallet.accounts.v1";

export type WalletAccountKind = "pq" | "watch";

export interface WalletAccountRecord {
  id: string;
  kind: WalletAccountKind;
  label: string;
  /** Keyring slot for PQ accounts. */
  slot?: string;
  /** Address for watch-only accounts (PQ accounts derive theirs from the slot preview). */
  address?: Hex;
  hidden: boolean;
  order: number;
  createdAt: string;
}

interface AccountsRegistry {
  version: 1;
  accounts: WalletAccountRecord[];
  activeId: string;
}

let cache: AccountsRegistry | undefined;

function sortAccounts(accounts: WalletAccountRecord[]): WalletAccountRecord[] {
  return [...accounts].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

async function readRegistry(): Promise<AccountsRegistry | undefined> {
  if (cache) return cache;
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as AccountsRegistry;
    if (parsed?.version === 1 && Array.isArray(parsed.accounts)) {
      cache = { ...parsed, accounts: sortAccounts(parsed.accounts) };
      return cache;
    }
  } catch {
    // fall through: corrupt registry is rebuilt below
  }
  return undefined;
}

async function writeRegistry(registry: AccountsRegistry): Promise<void> {
  cache = { ...registry, accounts: sortAccounts(registry.accounts) };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Loads the registry, creating it from the existing single profile the first time. Returns an
 * empty registry when no wallet exists yet.
 */
export async function ensureAccountsRegistry(): Promise<AccountsRegistry> {
  const existing = await readRegistry();
  if (existing && existing.accounts.length > 0) {
    const active = existing.accounts.find((a) => a.id === existing.activeId) ?? existing.accounts[0];
    if (active?.kind === "pq" && active.slot) setActiveWalletSlot(active.slot);
    return existing;
  }
  const preview = await getWalletPreview().catch(() => undefined);
  const registry: AccountsRegistry = {
    version: 1,
    accounts: preview
      ? [
          {
            id: "primary",
            kind: "pq",
            label: "Account 1",
            slot: PRIMARY_WALLET_SLOT,
            hidden: false,
            order: 0,
            createdAt: preview.updatedAt ?? new Date().toISOString(),
          },
        ]
      : [],
    activeId: preview ? "primary" : "",
  };
  await writeRegistry(registry);
  return registry;
}

export async function listAccounts(options: { includeHidden?: boolean } = {}): Promise<WalletAccountRecord[]> {
  const registry = await ensureAccountsRegistry();
  return registry.accounts.filter((a) => options.includeHidden || !a.hidden);
}

export async function getActiveAccount(): Promise<WalletAccountRecord | undefined> {
  const registry = await ensureAccountsRegistry();
  const active = registry.accounts.find((a) => a.id === registry.activeId) ?? registry.accounts[0];
  if (active?.kind === "pq" && active.slot) setActiveWalletSlot(active.slot);
  return active;
}

/** Resolves the display address of a record (watch-only: stored; PQ: from the slot preview). */
export async function accountAddress(record: WalletAccountRecord): Promise<Hex | undefined> {
  if (record.kind === "watch") return record.address;
  if (!record.slot) return undefined;
  return (await readWalletSlotPreview(record.slot))?.accountAddress;
}

export async function setActiveAccount(id: string, chainId?: number): Promise<WalletAccountRecord> {
  const registry = await ensureAccountsRegistry();
  const next = registry.accounts.find((a) => a.id === id);
  if (!next) throw new Error("Account not found.");
  if (next.kind === "pq" && next.slot) await switchWalletSlot(next.slot, chainId);
  await writeRegistry({ ...registry, activeId: id });
  emitWalletChange();
  return next;
}

export async function renameAccount(id: string, label: string): Promise<void> {
  const registry = await ensureAccountsRegistry();
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Enter a name.");
  await writeRegistry({ ...registry, accounts: registry.accounts.map((a) => (a.id === id ? { ...a, label: trimmed } : a)) });
  emitWalletChange();
}

export async function setAccountHidden(id: string, hidden: boolean): Promise<void> {
  const registry = await ensureAccountsRegistry();
  if (hidden && registry.activeId === id) throw new Error("Switch to another account before hiding this one.");
  await writeRegistry({ ...registry, accounts: registry.accounts.map((a) => (a.id === id ? { ...a, hidden } : a)) });
  emitWalletChange();
}

export async function moveAccount(id: string, direction: -1 | 1): Promise<void> {
  const registry = await ensureAccountsRegistry();
  const ordered = sortAccounts(registry.accounts);
  const index = ordered.findIndex((a) => a.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ordered.length) return;
  const swapped = [...ordered];
  [swapped[index], swapped[target]] = [swapped[target]!, swapped[index]!];
  await writeRegistry({ ...registry, accounts: swapped.map((a, order) => ({ ...a, order })) });
  emitWalletChange();
}

function nextLabel(accounts: WalletAccountRecord[]): string {
  const used = new Set(accounts.map((a) => a.label));
  let n = accounts.filter((a) => a.kind === "pq").length + 1;
  while (used.has(`Account ${n}`)) n += 1;
  return `Account ${n}`;
}

/** Creates a new ML-DSA account. Uses the unlocked session passcode unless one is given. */
export async function createAccount(options: { label?: string; passcode?: string; chainId?: number } = {}): Promise<WalletAccountRecord> {
  const passcode = options.passcode ?? getUnlockedWalletPasscode();
  if (!passcode) throw new Error("Unlock the wallet before adding an account.");
  const registry = await ensureAccountsRegistry();
  const { slot } = await createWalletProfileInNewSlot(passcode, options.chainId);
  const record: WalletAccountRecord = {
    id: newId(),
    kind: "pq",
    label: options.label?.trim() || nextLabel(registry.accounts),
    slot,
    hidden: false,
    order: registry.accounts.length,
    createdAt: new Date().toISOString(),
  };
  await writeRegistry({ ...registry, accounts: [...registry.accounts, record] });
  emitWalletChange();
  return record;
}

/** Imports a Recovery Kit as an additional account (not replacing the current one). */
export async function importAccountFromKit(options: {
  encoded: string;
  kitPasscode?: string;
  label?: string;
  walletPasscode?: string;
  chainId?: number;
}): Promise<WalletAccountRecord> {
  const passcode = options.walletPasscode ?? getUnlockedWalletPasscode();
  if (!passcode) throw new Error("Unlock the wallet before importing an account.");
  const registry = await ensureAccountsRegistry();
  const { slot, preview } = await importBackupIntoNewSlot(options.encoded, options.kitPasscode, passcode, options.chainId);
  const duplicates = await Promise.all(registry.accounts.map(async (a) => (await accountAddress(a))?.toLowerCase()));
  if (duplicates.includes(preview.accountAddress.toLowerCase())) {
    await deleteWalletSlot(slot);
    throw new Error("This account is already in the wallet.");
  }
  const record: WalletAccountRecord = {
    id: newId(),
    kind: "pq",
    label: options.label?.trim() || nextLabel(registry.accounts),
    slot,
    hidden: false,
    order: registry.accounts.length,
    createdAt: new Date().toISOString(),
  };
  await writeRegistry({ ...registry, accounts: [...registry.accounts, record] });
  emitWalletChange();
  return record;
}

export async function addWatchOnlyAccount(address: string, label?: string): Promise<WalletAccountRecord> {
  if (!isValidEvmAddress(address.trim())) throw new Error("Enter a valid 0x address.");
  const normalized = normalizeEvmAddress(address.trim());
  const registry = await ensureAccountsRegistry();
  const existing = await Promise.all(registry.accounts.map(async (a) => (await accountAddress(a))?.toLowerCase()));
  if (existing.includes(normalized.toLowerCase())) throw new Error("This address is already in the wallet.");
  const record: WalletAccountRecord = {
    id: newId(),
    kind: "watch",
    label: label?.trim() || `Watch ${normalized.slice(0, 6)}…${normalized.slice(-4)}`,
    address: normalized,
    hidden: false,
    order: registry.accounts.length,
    createdAt: new Date().toISOString(),
  };
  await writeRegistry({ ...registry, accounts: [...registry.accounts, record] });
  emitWalletChange();
  return record;
}

/**
 * Removes an account. A PQ account's key material is deleted from the keyring: the caller must
 * have confirmed that a Recovery Kit exists. The last PQ account cannot be removed.
 */
export async function removeAccount(id: string): Promise<void> {
  const registry = await ensureAccountsRegistry();
  const record = registry.accounts.find((a) => a.id === id);
  if (!record) return;
  if (record.kind === "pq") {
    const remainingPq = registry.accounts.filter((a) => a.kind === "pq" && a.id !== id);
    if (remainingPq.length === 0) throw new Error("The wallet needs at least one Minerva Account. Use Wallet reset to remove everything.");
    if (record.slot) await deleteWalletSlot(record.slot);
  }
  const accounts = registry.accounts.filter((a) => a.id !== id).map((a, order) => ({ ...a, order }));
  const activeId = registry.activeId === id ? (accounts.find((a) => a.kind === "pq")?.id ?? accounts[0]?.id ?? "") : registry.activeId;
  await writeRegistry({ ...registry, accounts, activeId });
  if (registry.activeId === id) {
    const next = accounts.find((a) => a.id === activeId);
    if (next?.kind === "pq" && next.slot) await switchWalletSlot(next.slot);
  }
  emitWalletChange();
}

/** Drops the registry (used by wallet reset after the keyring is wiped). */
export async function clearAccountsRegistry(): Promise<void> {
  cache = undefined;
  await AsyncStorage.removeItem(STORAGE_KEY);
}
