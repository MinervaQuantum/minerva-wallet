import { keccak256, type Hex } from "viem";
import {
  decryptStringWithPasscode,
  encryptStringWithPasscode,
  verifyMLDSA65,
  type PasscodeEncryptedPayload,
} from "@minerva/pq-crypto";
import {
  deriveMinervaPQAccountAddress,
  generateMLDSA65KeyPair,
  MINERVA_TESTNET_CHAIN_ID,
  MINERVA_ZERO_HASH,
  readMinervaDevPQAccount,
  signMinervaPQAccountAuthorization,
  type MLDSA65KeyPair,
  type MinervaDevPQAccount,
  readMinervaTransactionStatus,
} from "@minerva/evm";

/** Legacy single-profile record. Migrated into the account registry on first load. */
export const EXTENSION_WALLET_STORAGE_KEY = "minerva.extension.pq-wallet.encrypted.v1";
/** Account registry: every encrypted ML-DSA profile this extension holds, plus the active one. */
export const EXTENSION_ACCOUNTS_STORAGE_KEY = "minerva.extension.accounts.v1";
export const EXTENSION_TOKENS_KEY_PREFIX = "minerva.extension.tokens.v1";
const EXTENSION_WALLET_HISTORY_KEY = "minerva.extension.activity.v1";
const EXTENSION_CONNECTIONS_KEY = "minerva:connections";
const EXTENSION_PENDING_PROVIDER_REQUESTS_KEY = "minerva:provider-pending.v1";
const EXTENSION_PROVIDER_RESPONSES_KEY = "minerva:provider-responses.v1";
const EXTENSION_PROVIDER_DIAGNOSTICS_KEY = "minerva:provider-diagnostics.v1";
const EXTENSION_BACKUP_FORMAT = "minerva.extension.pq-wallet-backup.encrypted.v1";
const RESTORE_VALIDATION_MESSAGE = "0x71756269746f722d657874656e73696f6e2d726573746f72652d636865636b" as const;

export interface ExtensionPQWalletProfile {
  version: 1;
  chainId: number;
  currentKey: MLDSA65KeyPair;
  deploymentKey: MLDSA65KeyPair;
  deploymentPublicKey: Hex;
  deploymentSalt: Hex;
  accountAddress?: Hex;
  currentPublicKeyCommitment?: Hex;
  keyVersion: number;
  lastRotationAt?: string;
  lastRotationTransactionHash?: Hex;
}

export interface ExtensionPQWalletPreview {
  chainId: number;
  accountAddress?: Hex;
  deploymentPublicKey: Hex;
  deploymentSalt: Hex;
  currentPublicKeyCommitment?: Hex;
  keyVersion: number;
  lastRotationAt?: string;
  updatedAt: string;
}

export interface ExtensionEncryptedWalletRecord {
  format: typeof EXTENSION_BACKUP_FORMAT;
  createdAt: string;
  updatedAt: string;
  warning: string;
  preview: ExtensionPQWalletPreview;
  encryption: PasscodeEncryptedPayload;
}

/** One account in the registry: its label and ordering plus the passcode-encrypted profile. */
export interface ExtensionAccountRecord {
  id: string;
  label: string;
  hidden: boolean;
  order: number;
  createdAt: string;
  record: ExtensionEncryptedWalletRecord;
}

export interface ExtensionAccountsRegistry {
  version: 1;
  accounts: ExtensionAccountRecord[];
  activeId: string;
}

/** Non-secret view of an account for lists and the background worker. */
export interface ExtensionAccountSummary {
  id: string;
  label: string;
  hidden: boolean;
  order: number;
  createdAt: string;
  chainId: number;
  address?: Hex;
  deploymentPublicKey: Hex;
  keyVersion: number;
  active: boolean;
}

export interface ExtensionActivityItem {
  id: string;
  type: "receive" | "send" | "security";
  title: string;
  detail: string;
  hash?: Hex;
  status: "pending" | "success" | "failed";
  occurredAt: string;
  /** Minerva Account the entry belongs to; legacy entries have none and show for every account. */
  account?: Hex;
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function newAccountId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (items) => resolve(items[key] as T | undefined));
  });
}

function storageSet(key: string, value: unknown): Promise<void> {
  return chrome.storage.local.set({ [key]: value });
}

function storageDelete(key: string): Promise<void> {
  return chrome.storage.local.remove(key);
}

function backupAad(chainId: number) {
  return `${EXTENSION_BACKUP_FORMAT}:${chainId}:pq-extension-wallet`;
}

function previewFromProfile(profile: ExtensionPQWalletProfile): ExtensionPQWalletPreview {
  return {
    chainId: profile.chainId,
    accountAddress: profile.accountAddress,
    deploymentPublicKey: profile.deploymentPublicKey,
    deploymentSalt: profile.deploymentSalt,
    currentPublicKeyCommitment: profile.currentPublicKeyCommitment,
    keyVersion: profile.keyVersion,
    lastRotationAt: profile.lastRotationAt,
    updatedAt: new Date().toISOString(),
  };
}

async function encryptedRecordFromProfile(
  profile: ExtensionPQWalletProfile,
  passcode: string,
  existing?: ExtensionEncryptedWalletRecord,
): Promise<ExtensionEncryptedWalletRecord> {
  const now = new Date().toISOString();
  return {
    format: EXTENSION_BACKUP_FORMAT,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    warning: "PASSCODE-ENCRYPTED MINERVA WALLET BACKUP. The passcode cannot be recovered if forgotten.",
    preview: previewFromProfile(profile),
    encryption: await encryptStringWithPasscode(JSON.stringify(profile), passcode, {
      salt: randomBytes(16),
      nonce: randomBytes(12),
      aad: backupAad(profile.chainId),
    }),
  };
}

function normalizeProfile(value: unknown): ExtensionPQWalletProfile {
  const profile = value as Partial<ExtensionPQWalletProfile>;
  if (!profile.currentKey?.privateKey || !profile.currentKey.publicKey) {
    throw new Error("Recovery Kit is missing the active ML-DSA key.");
  }
  if (!profile.deploymentKey?.privateKey || !profile.deploymentKey.publicKey) {
    throw new Error("Recovery Kit is missing the deployment ML-DSA key.");
  }
  const signature = signMinervaPQAccountAuthorization(RESTORE_VALIDATION_MESSAGE, profile.currentKey.privateKey);
  if (!verifyMLDSA65(signature, RESTORE_VALIDATION_MESSAGE, profile.currentKey.publicKey)) {
    throw new Error("ML-DSA key verification failed.");
  }
  return {
    version: 1,
    chainId: profile.chainId ?? MINERVA_TESTNET_CHAIN_ID,
    currentKey: profile.currentKey,
    deploymentKey: profile.deploymentKey,
    deploymentPublicKey: profile.deploymentPublicKey ?? profile.deploymentKey.publicKey,
    deploymentSalt: profile.deploymentSalt ?? MINERVA_ZERO_HASH,
    accountAddress: profile.accountAddress,
    currentPublicKeyCommitment: profile.currentPublicKeyCommitment,
    keyVersion: profile.keyVersion && profile.keyVersion > 0 ? profile.keyVersion : 1,
    lastRotationAt: profile.lastRotationAt,
    lastRotationTransactionHash: profile.lastRotationTransactionHash,
  };
}

async function decryptRecord(record: ExtensionEncryptedWalletRecord, passcode: string): Promise<ExtensionPQWalletProfile> {
  const plaintext = await decryptStringWithPasscode(record.encryption, passcode, {
    aad: backupAad(record.preview.chainId),
  });
  return normalizeProfile(JSON.parse(plaintext));
}

// ------------------------------------------------------------------ registry

function sortAccounts(accounts: ExtensionAccountRecord[]): ExtensionAccountRecord[] {
  return [...accounts].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

function isRegistry(value: unknown): value is ExtensionAccountsRegistry {
  const registry = value as Partial<ExtensionAccountsRegistry> | undefined;
  return (
    registry?.version === 1 &&
    Array.isArray(registry.accounts) &&
    registry.accounts.length > 0 &&
    typeof registry.activeId === "string"
  );
}

function normalizeRegistry(registry: ExtensionAccountsRegistry): ExtensionAccountsRegistry {
  const accounts = sortAccounts(registry.accounts).map((account, index) => ({ ...account, order: index }));
  const activeId = accounts.some((a) => a.id === registry.activeId) ? registry.activeId : accounts[0].id;
  return { version: 1, accounts, activeId };
}

async function writeRegistry(registry: ExtensionAccountsRegistry): Promise<ExtensionAccountsRegistry> {
  const normalized = normalizeRegistry(registry);
  await storageSet(EXTENSION_ACCOUNTS_STORAGE_KEY, normalized);
  return normalized;
}

function accountFromRecord(record: ExtensionEncryptedWalletRecord, label: string, order: number): ExtensionAccountRecord {
  return {
    id: newAccountId(),
    label,
    hidden: false,
    order,
    createdAt: new Date().toISOString(),
    record,
  };
}

/**
 * Loads the account registry. The first load after upgrading from the single-record layout
 * migrates that record into "Account 1" (and removes the legacy key) without user action.
 * Returns undefined when no wallet exists yet.
 */
export async function loadExtensionAccounts(): Promise<ExtensionAccountsRegistry | undefined> {
  const stored = await storageGet<unknown>(EXTENSION_ACCOUNTS_STORAGE_KEY);
  if (isRegistry(stored)) return normalizeRegistry(stored);

  const legacy = await storageGet<ExtensionEncryptedWalletRecord>(EXTENSION_WALLET_STORAGE_KEY);
  if (!legacy || legacy.format !== EXTENSION_BACKUP_FORMAT) return undefined;
  // Deterministic id and timestamp: the popup and the background worker may both migrate at
  // the same moment, and both must produce the identical registry.
  const account: ExtensionAccountRecord = {
    id: `legacy-${legacy.preview.deploymentPublicKey.slice(2, 34).toLowerCase()}`,
    label: "Account 1",
    hidden: false,
    order: 0,
    createdAt: legacy.createdAt ?? legacy.updatedAt ?? new Date().toISOString(),
    record: legacy,
  };
  const registry = await writeRegistry({ version: 1, accounts: [account], activeId: account.id });
  await storageDelete(EXTENSION_WALLET_STORAGE_KEY);
  return registry;
}

async function requireRegistry(): Promise<ExtensionAccountsRegistry> {
  const registry = await loadExtensionAccounts();
  if (!registry) throw new Error("No Minerva Wallet profile exists yet.");
  return registry;
}

function activeAccountOf(registry: ExtensionAccountsRegistry): ExtensionAccountRecord {
  return registry.accounts.find((a) => a.id === registry.activeId) ?? registry.accounts[0];
}

function accountById(registry: ExtensionAccountsRegistry, id: string): ExtensionAccountRecord {
  const account = registry.accounts.find((a) => a.id === id);
  if (!account) throw new Error("That account no longer exists.");
  return account;
}

export function accountAddressOfRecord(record: ExtensionEncryptedWalletRecord): Hex | undefined {
  if (record.preview.accountAddress?.startsWith("0x")) return record.preview.accountAddress;
  if (!record.preview.deploymentPublicKey) return undefined;
  try {
    return deriveMinervaPQAccountAddress(record.preview.deploymentPublicKey, record.preview.deploymentSalt ?? MINERVA_ZERO_HASH);
  } catch {
    return undefined;
  }
}

export function summarizeExtensionAccount(account: ExtensionAccountRecord, activeId: string): ExtensionAccountSummary {
  return {
    id: account.id,
    label: account.label,
    hidden: account.hidden,
    order: account.order,
    createdAt: account.createdAt,
    chainId: account.record.preview.chainId,
    address: accountAddressOfRecord(account.record),
    deploymentPublicKey: account.record.preview.deploymentPublicKey,
    keyVersion: account.record.preview.keyVersion,
    active: account.id === activeId,
  };
}

/** Every account (hidden ones included) in display order. Empty when no wallet exists. */
export async function listExtensionAccounts(): Promise<ExtensionAccountSummary[]> {
  const registry = await loadExtensionAccounts();
  if (!registry) return [];
  return registry.accounts.map((account) => summarizeExtensionAccount(account, registry.activeId));
}

export async function getActiveExtensionAccount(): Promise<ExtensionAccountSummary | undefined> {
  const registry = await loadExtensionAccounts();
  if (!registry) return undefined;
  return summarizeExtensionAccount(activeAccountOf(registry), registry.activeId);
}

export async function getActiveExtensionAccountAddress(): Promise<Hex | undefined> {
  return (await getActiveExtensionAccount())?.address;
}

/** Encrypted record of the active account (or of `accountId`). */
export async function getStoredExtensionWalletRecord(accountId?: string): Promise<ExtensionEncryptedWalletRecord | undefined> {
  const registry = await loadExtensionAccounts();
  if (!registry) return undefined;
  return (accountId ? registry.accounts.find((a) => a.id === accountId) : activeAccountOf(registry))?.record;
}

export async function getStoredExtensionWalletPreview(accountId?: string): Promise<ExtensionPQWalletPreview | undefined> {
  return (await getStoredExtensionWalletRecord(accountId))?.preview;
}

function nextAccountLabel(registry: ExtensionAccountsRegistry | undefined): string {
  const count = registry?.accounts.length ?? 0;
  const taken = new Set((registry?.accounts ?? []).map((a) => a.label.trim().toLowerCase()));
  let n = count + 1;
  while (taken.has(`account ${n}`)) n += 1;
  return `Account ${n}`;
}

function freshProfile(): ExtensionPQWalletProfile {
  const key = generateMLDSA65KeyPair(randomBytes(32));
  return {
    version: 1,
    chainId: MINERVA_TESTNET_CHAIN_ID,
    currentKey: key,
    deploymentKey: key,
    deploymentPublicKey: key.publicKey,
    deploymentSalt: MINERVA_ZERO_HASH,
    currentPublicKeyCommitment: keccak256(key.publicKey),
    keyVersion: 1,
  };
}

function assertPasscode(passcode: string) {
  if (passcode.length < 8) throw new Error("Use at least 8 characters for the wallet passcode.");
}

/** Confirms `passcode` opens the active account; every account shares one passcode. */
async function verifyWalletPasscode(registry: ExtensionAccountsRegistry, passcode: string): Promise<void> {
  try {
    await decryptRecord(activeAccountOf(registry).record, passcode);
  } catch {
    throw new Error("Wrong wallet passcode.");
  }
}

/**
 * Creates the first account of a brand-new wallet. When accounts already exist this behaves
 * like `addExtensionAccount` (the passcode must match the wallet's).
 */
export async function createExtensionWalletProfile(passcode: string, label?: string): Promise<ExtensionPQWalletProfile> {
  assertPasscode(passcode);
  const registry = await loadExtensionAccounts();
  if (registry) return (await addExtensionAccount(passcode, label)).profile;
  const profile = freshProfile();
  const record = await encryptedRecordFromProfile(profile, passcode);
  const account = accountFromRecord(record, label?.trim() || "Account 1", 0);
  await writeRegistry({ version: 1, accounts: [account], activeId: account.id });
  return profile;
}

/** Adds a fresh ML-DSA account, encrypted with the shared passcode, and makes it active. */
export async function addExtensionAccount(
  passcode: string,
  label?: string,
): Promise<{ profile: ExtensionPQWalletProfile; account: ExtensionAccountSummary }> {
  assertPasscode(passcode);
  const registry = await loadExtensionAccounts();
  if (!registry) {
    const profile = await createExtensionWalletProfile(passcode, label);
    const account = (await getActiveExtensionAccount())!;
    return { profile, account };
  }
  await verifyWalletPasscode(registry, passcode);
  const profile = freshProfile();
  const record = await encryptedRecordFromProfile(profile, passcode);
  const account = accountFromRecord(record, label?.trim() || nextAccountLabel(registry), registry.accounts.length);
  const next = await writeRegistry({ ...registry, accounts: [...registry.accounts, account], activeId: account.id });
  return { profile, account: summarizeExtensionAccount(accountById(next, account.id), next.activeId) };
}

/**
 * Imports a Recovery Kit as an additional account. The kit is opened with `kitPasscode` and
 * re-encrypted with the wallet passcode so every account keeps sharing one passcode. A kit for
 * an account that is already present just makes that account active.
 */
export async function importExtensionAccountFromKit(
  encoded: string,
  kitPasscode: string,
  walletPasscode: string,
  label?: string,
): Promise<{ profile: ExtensionPQWalletProfile; account: ExtensionAccountSummary; existing: boolean }> {
  assertPasscode(walletPasscode);
  let kit: ExtensionEncryptedWalletRecord;
  try {
    kit = JSON.parse(encoded) as ExtensionEncryptedWalletRecord;
  } catch {
    throw new Error("Recovery Kit is not valid JSON.");
  }
  if (kit?.format !== EXTENSION_BACKUP_FORMAT) throw new Error("Unsupported Recovery Kit format.");
  const profile = await decryptRecord(kit, kitPasscode);

  const registry = await loadExtensionAccounts();
  if (!registry) {
    const record = await encryptedRecordFromProfile(profile, walletPasscode, kit);
    const account = accountFromRecord(record, label?.trim() || "Account 1", 0);
    const next = await writeRegistry({ version: 1, accounts: [account], activeId: account.id });
    return { profile, account: summarizeExtensionAccount(accountById(next, account.id), next.activeId), existing: false };
  }

  await verifyWalletPasscode(registry, walletPasscode);
  const duplicate = registry.accounts.find(
    (a) => a.record.preview.deploymentPublicKey.toLowerCase() === profile.deploymentPublicKey.toLowerCase(),
  );
  if (duplicate) {
    const next = await writeRegistry({ ...registry, activeId: duplicate.id });
    return { profile: await decryptRecord(duplicate.record, walletPasscode), account: summarizeExtensionAccount(accountById(next, duplicate.id), next.activeId), existing: true };
  }
  const record = await encryptedRecordFromProfile(profile, walletPasscode, kit);
  const account = accountFromRecord(record, label?.trim() || nextAccountLabel(registry), registry.accounts.length);
  const next = await writeRegistry({ ...registry, accounts: [...registry.accounts, account], activeId: account.id });
  return { profile, account: summarizeExtensionAccount(accountById(next, account.id), next.activeId), existing: false };
}

/** Decrypts the active account (or `accountId`) with the shared passcode. */
export async function unlockExtensionWalletProfile(passcode: string, accountId?: string): Promise<ExtensionPQWalletProfile> {
  const record = await getStoredExtensionWalletRecord(accountId);
  if (!record) throw new Error("No Minerva Wallet profile exists yet.");
  return decryptRecord(record, passcode);
}

/**
 * Re-encrypts `profile` into the account it belongs to. The account is matched by its
 * deployment key (stable across PQ key rotations), so a profile is never written into
 * another account even if the active account changed meanwhile.
 */
export async function saveExtensionWalletProfile(
  profile: ExtensionPQWalletProfile,
  passcode: string,
): Promise<ExtensionEncryptedWalletRecord> {
  assertPasscode(passcode);
  const normalized = normalizeProfile(profile);
  const registry = await requireRegistry();
  const index = registry.accounts.findIndex(
    (a) => a.record.preview.deploymentPublicKey.toLowerCase() === normalized.deploymentPublicKey.toLowerCase(),
  );
  if (index < 0) throw new Error("This profile does not belong to any account in the wallet.");
  const existing = registry.accounts[index];
  const record = await encryptedRecordFromProfile(normalized, passcode, existing.record);
  const accounts = [...registry.accounts];
  accounts[index] = { ...existing, record };
  await writeRegistry({ ...registry, accounts });
  return record;
}

export async function setActiveExtensionAccount(id: string): Promise<ExtensionAccountSummary> {
  const registry = await requireRegistry();
  const account = accountById(registry, id);
  const next = await writeRegistry({ ...registry, activeId: account.id });
  return summarizeExtensionAccount(accountById(next, id), next.activeId);
}

export async function renameExtensionAccount(id: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Enter a name for the account.");
  if (trimmed.length > 40) throw new Error("Keep the account name under 40 characters.");
  const registry = await requireRegistry();
  accountById(registry, id);
  await writeRegistry({
    ...registry,
    accounts: registry.accounts.map((a) => (a.id === id ? { ...a, label: trimmed } : a)),
  });
}

/** Hides or shows an account. Hiding the active account switches to the next visible one. */
export async function setExtensionAccountHidden(id: string, hidden: boolean): Promise<void> {
  const registry = await requireRegistry();
  accountById(registry, id);
  let activeId = registry.activeId;
  if (hidden && id === registry.activeId) {
    const fallback = registry.accounts.find((a) => a.id !== id && !a.hidden);
    if (!fallback) throw new Error("Keep at least one visible account.");
    activeId = fallback.id;
  }
  await writeRegistry({
    ...registry,
    activeId,
    accounts: registry.accounts.map((a) => (a.id === id ? { ...a, hidden } : a)),
  });
}

/** Applies a full ordering; ids not listed keep their relative order after the listed ones. */
export async function reorderExtensionAccounts(ids: string[]): Promise<void> {
  const registry = await requireRegistry();
  const position = new Map(ids.map((id, index) => [id, index]));
  const accounts = sortAccounts(registry.accounts).map((a, index) => ({
    ...a,
    order: position.has(a.id) ? position.get(a.id)! : ids.length + index,
  }));
  await writeRegistry({ ...registry, accounts });
}

/** Moves one account up (-1) or down (+1) in the list. */
export async function moveExtensionAccount(id: string, direction: -1 | 1): Promise<void> {
  const registry = await requireRegistry();
  const ordered = sortAccounts(registry.accounts).map((a) => a.id);
  const index = ordered.indexOf(id);
  if (index < 0) throw new Error("That account no longer exists.");
  const target = index + direction;
  if (target < 0 || target >= ordered.length) return;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  await reorderExtensionAccounts(ordered);
}

/**
 * Removes an account's encrypted profile from this browser. Refuses to remove the last one.
 * Export its Recovery Kit first: without it the ML-DSA key cannot be recovered.
 */
export async function removeExtensionAccount(id: string): Promise<ExtensionAccountSummary[]> {
  const registry = await requireRegistry();
  accountById(registry, id);
  if (registry.accounts.length <= 1) throw new Error("The wallet keeps at least one account. Use Wipe wallet to remove everything.");
  const remaining = registry.accounts.filter((a) => a.id !== id);
  const activeId =
    registry.activeId === id ? (remaining.find((a) => !a.hidden) ?? remaining[0]).id : registry.activeId;
  const next = await writeRegistry({ ...registry, accounts: remaining, activeId });
  return next.accounts.map((a) => summarizeExtensionAccount(a, next.activeId));
}

export async function exportExtensionRecoveryKit(accountId?: string): Promise<string> {
  const record = await getStoredExtensionWalletRecord(accountId);
  if (!record) throw new Error("No Recovery Kit is available yet.");
  return JSON.stringify(record, null, 2);
}

/**
 * Restore from the lock screen. With no wallet present the kit becomes "Account 1". With a
 * wallet present the kit is imported as an additional account; the passcode must open both
 * the kit and the wallet (use Add account → Import for a kit with a different passcode).
 */
export async function restoreExtensionWalletProfile(encoded: string, passcode: string): Promise<ExtensionPQWalletProfile> {
  const result = await importExtensionAccountFromKit(encoded, passcode, passcode);
  return result.profile;
}

export async function wipeExtensionWallet(): Promise<void> {
  const all = await new Promise<Record<string, unknown>>((resolve) => chrome.storage.local.get(null, (items) => resolve(items ?? {})));
  const tokenKeys = Object.keys(all).filter((key) => key.startsWith(EXTENSION_TOKENS_KEY_PREFIX));
  await Promise.all([
    storageDelete(EXTENSION_WALLET_STORAGE_KEY),
    storageDelete(EXTENSION_ACCOUNTS_STORAGE_KEY),
    storageDelete(EXTENSION_WALLET_HISTORY_KEY),
    storageDelete(EXTENSION_CONNECTIONS_KEY),
    storageDelete(EXTENSION_PENDING_PROVIDER_REQUESTS_KEY),
    storageDelete(EXTENSION_PROVIDER_RESPONSES_KEY),
    storageDelete(EXTENSION_PROVIDER_DIAGNOSTICS_KEY),
    ...tokenKeys.map((key) => storageDelete(key)),
  ]);
}

export async function rememberExtensionAccount(
  profile: ExtensionPQWalletProfile,
  account: MinervaDevPQAccount,
  passcode: string,
): Promise<ExtensionPQWalletProfile> {
  const next = normalizeProfile({
    ...profile,
    chainId: account.chainId,
    accountAddress: account.accountAddress,
    deploymentSalt: account.salt,
    currentPublicKeyCommitment: profile.currentPublicKeyCommitment ?? account.publicKeyCommitment,
  });
  await saveExtensionWalletProfile(next, passcode);
  return next;
}

export async function readExtensionPQAccount(profile: ExtensionPQWalletProfile): Promise<MinervaDevPQAccount> {
  return readMinervaDevPQAccount({
    publicKey: profile.deploymentPublicKey,
    salt: profile.deploymentSalt,
  }, { chainId: profile.chainId });
}

/** Activity for one account (plus legacy entries recorded before accounts were tracked). */
export async function readExtensionActivity(account?: Hex, chainId?: number): Promise<ExtensionActivityItem[]> {
  let all = (await storageGet<ExtensionActivityItem[]>(EXTENSION_WALLET_HISTORY_KEY)) ?? [];
  if (chainId !== undefined) all = await resolvePendingActivity(all, chainId);
  if (!account) return all;
  const needle = account.toLowerCase();
  return all.filter((item) => !item.account || item.account.toLowerCase() === needle);
}

/** Reads receipts for entries recorded as pending (RPC submissions return before the receipt exists)
 *  and persists the settled status. Best effort: unreachable RPC leaves the entries pending. */
async function resolvePendingActivity(items: ExtensionActivityItem[], chainId: number): Promise<ExtensionActivityItem[]> {
  const pending = items.filter((item) => item.status === "pending" && item.hash).slice(0, 12);
  if (pending.length === 0) return items;
  const settled = new Map<string, ExtensionActivityItem["status"]>();
  await Promise.all(
    pending.map(async (item) => {
      try {
        const status = await readMinervaTransactionStatus(item.hash as Hex, { chainId });
        if (status.state === "success" || status.state === "failed") settled.set(item.id, status.state);
        else if (status.state === "dropped") settled.set(item.id, "failed");
      } catch {
        // keep pending
      }
    }),
  );
  if (settled.size === 0) return items;
  const next = items.map((item) => (settled.has(item.id) ? { ...item, status: settled.get(item.id)! } : item));
  await storageSet(EXTENSION_WALLET_HISTORY_KEY, next);
  return next;
}

export async function recordExtensionActivity(item: Omit<ExtensionActivityItem, "id" | "occurredAt">): Promise<void> {
  const occurredAt = new Date().toISOString();
  const current = await readExtensionActivity();
  const next: ExtensionActivityItem = {
    ...item,
    id: item.hash ?? `${item.type}-${occurredAt}`,
    occurredAt,
  };
  await storageSet(EXTENSION_WALLET_HISTORY_KEY, [next, ...current].slice(0, 120));
}
