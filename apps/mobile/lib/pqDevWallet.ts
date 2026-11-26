import * as Crypto from "expo-crypto";
import { getKeyVault } from "@minerva/keystore";
import {
  deriveMinervaPQAccountAddress,
  generateMLDSA65KeyPair,
  MINERVA_DEVNET_CHAIN_ID,
  MINERVA_TESTNET_CHAIN_ID,
  MINERVA_ZERO_HASH,
  signMinervaPQAccountAuthorization,
  supportedChainId,
  type MLDSA65KeyPair,
} from "@minerva/evm";
import {
  MINERVA_ML_DSA_CONTEXT,
  signMLDSA65,
  deriveMLDSA65PublicKey,
  decryptStringWithPasscode,
  encryptStringWithPasscode,
  type Hex,
  type PasscodeEncryptedPayload,
  verifyMLDSA65,
} from "@minerva/pq-crypto";
import { markRehearsed } from "@/lib/backupState";

const LEGACY_DEV_PQ_KEY_STORAGE_KEY = "minerva.devnet.mldsa65.key.v1";
const LEGACY_RAW_PROFILE_PREFIX = "minerva.wallet.mldsa65.profile.v2";
const ENCRYPTED_PROFILE_PREFIX = "minerva.wallet.mldsa65.profile.encrypted.v1";
const DEV_PQ_BACKUP_FORMAT = "minerva.wallet.pq-wallet-backup.v1";
const DEV_PQ_ENCRYPTED_BACKUP_FORMAT = "minerva.wallet.pq-wallet-backup.encrypted.v1";
const LEGACY_DEV_PQ_BACKUP_FORMAT = "minerva.devnet.pq-wallet-backup.v1";
const LEGACY_DEV_PQ_ENCRYPTED_BACKUP_FORMAT = "minerva.devnet.pq-wallet-backup.encrypted.v1";
const DEV_PQ_RESTORE_VALIDATION_MESSAGE = "0x71756269746f722d6465766e65742d726573746f72652d636865636b";
const DEFAULT_CHAIN_ID = MINERVA_TESTNET_CHAIN_ID;
const SUPPORTED_MINERVA_CHAIN_IDS = [MINERVA_DEVNET_CHAIN_ID, MINERVA_TESTNET_CHAIN_ID] as const;

export interface MinervaDevPQWalletProfile {
  version: 2;
  chainId?: number;
  currentKey: MLDSA65KeyPair;
  deploymentKey?: MLDSA65KeyPair;
  deploymentPublicKey: Hex;
  deploymentSalt?: Hex;
  accountAddress?: Hex;
  currentPublicKeyCommitment?: Hex;
  keyVersion: number;
  lastRotationAt?: string;
  lastRotationTransactionHash?: Hex;
}

export interface MinervaWalletPreview {
  version: 1;
  chainId: number;
  accountAddress: Hex;
  deploymentPublicKey: Hex;
  deploymentSalt: Hex;
  currentPublicKeyCommitment?: Hex;
  keyVersion: number;
  lastRotationAt?: string;
  lastRotationTransactionHash?: Hex;
  updatedAt: string;
}

export type WalletBootState =
  | { status: "no-wallet"; chainId: number }
  | { status: "migrate-required"; chainId: number; preview?: MinervaWalletPreview }
  | { status: "locked"; chainId: number; preview: MinervaWalletPreview }
  | { status: "unlocked"; chainId: number; preview: MinervaWalletPreview }
  | { status: "read-only-ready"; chainId: number; preview: MinervaWalletPreview }
  | { status: "error"; chainId: number; error: string };

export interface MinervaDevPQWalletBackup {
  format: typeof DEV_PQ_BACKUP_FORMAT;
  chainId: number;
  exportedAt: string;
  warning: string;
  profile: MinervaDevPQWalletProfile;
}

export interface MinervaDevPQWalletEncryptedBackup {
  format: typeof DEV_PQ_ENCRYPTED_BACKUP_FORMAT;
  chainId: number;
  exportedAt: string;
  warning: string;
  preview: MinervaDevPQWalletBackupPreview;
  encryption: PasscodeEncryptedPayload;
}

export interface MinervaDevPQWalletBackupPreview {
  encrypted: boolean;
  format: string;
  chainId: number;
  accountAddress?: Hex;
  deploymentPublicKey: Hex;
  currentPublicKeyCommitment?: Hex;
  keyVersion: number;
  lastRotationAt?: string;
}

interface StoredProfileV2 extends Partial<Omit<MinervaDevPQWalletProfile, "version" | "currentKey">> {
  version?: number;
  currentKey?: Partial<MLDSA65KeyPair>;
}

interface EncryptedWalletRecord {
  format: "minerva.wallet.encrypted-profile.v1";
  preview: MinervaWalletPreview;
  encryption: PasscodeEncryptedPayload;
}

/**
 * Account slots. One keyring holds several ML-DSA profiles ("accounts"); each lives in its own
 * slot. Profiles are chain-agnostic: the same key derives the same CREATE2 address on every
 * Minerva network, so a slot is NOT keyed by chain id. The legacy per-chain storage keys are
 * read once and migrated into the primary slot.
 */
export const PRIMARY_WALLET_SLOT = "primary";
const SLOT_INDEX_KEY = "minerva.wallet.slots.v1";
let activeSlot = PRIMARY_WALLET_SLOT;

const unlockedProfiles = new Map<string, MinervaDevPQWalletProfile>();
const unlockedPasscodes = new Map<string, string>();

export function getActiveWalletSlot(): string {
  return activeSlot;
}

/** Points every profile read/write at `slot`. Unlocked state is per slot and is kept. */
export function setActiveWalletSlot(slot: string): void {
  activeSlot = slot || PRIMARY_WALLET_SLOT;
}

function slotProfileKey(slot = activeSlot) {
  return `${ENCRYPTED_PROFILE_PREFIX}.slot.${slot}`;
}

async function readSlotIndex(): Promise<string[]> {
  try {
    const raw = await getKeyVault().getItem(SLOT_INDEX_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

async function rememberSlot(slot: string) {
  const slots = await readSlotIndex();
  if (!slots.includes(slot)) await getKeyVault().setItem(SLOT_INDEX_KEY, JSON.stringify([...slots, slot]));
}

async function forgetSlot(slot: string) {
  const slots = await readSlotIndex();
  await getKeyVault().setItem(SLOT_INDEX_KEY, JSON.stringify(slots.filter((s) => s !== slot)));
}

export async function listWalletSlots(): Promise<string[]> {
  const slots = await readSlotIndex();
  if (slots.length > 0) return slots;
  return (await readEncryptedRecord()) ? [PRIMARY_WALLET_SLOT] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeChainId(chainId = DEFAULT_CHAIN_ID): number {
  return supportedChainId(chainId);
}

function rawProfileKey(chainId = DEFAULT_CHAIN_ID) {
  return `${LEGACY_RAW_PROFILE_PREFIX}.${normalizeChainId(chainId)}`;
}

function encryptedProfileKey(chainId = DEFAULT_CHAIN_ID) {
  return `${ENCRYPTED_PROFILE_PREFIX}.${normalizeChainId(chainId)}`;
}

function encryptedProfileAad(chainId = DEFAULT_CHAIN_ID) {
  return `minerva.wallet.encrypted-profile.v1:${normalizeChainId(chainId)}:mldsa65`;
}

function encryptedBackupAad(chainId = DEFAULT_CHAIN_ID, format = DEV_PQ_ENCRYPTED_BACKUP_FORMAT) {
  return `${format}:${normalizeChainId(chainId)}:pq-wallet-profile`;
}

function assertPasscode(passcode: string) {
  if (passcode.length < 8) throw new Error("Wallet passcode must be at least 8 characters.");
}

function assertHex(value: unknown): value is Hex {
  return typeof value === "string" && value.startsWith("0x");
}

function parseKey(value: Partial<MLDSA65KeyPair> | undefined): MLDSA65KeyPair | undefined {
  if (!assertHex(value?.privateKey)) return undefined;
  const derivedPublicKey = deriveMLDSA65PublicKey(value.privateKey);
  if (assertHex(value.publicKey) && value.publicKey.toLowerCase() !== derivedPublicKey.toLowerCase()) {
    throw new Error("Stored PQ public key does not match the private key.");
  }
  return {
    publicKey: derivedPublicKey,
    privateKey: value.privateKey,
  };
}

function normalizeProfile(
  value: StoredProfileV2,
  currentKey: MLDSA65KeyPair,
  chainId = DEFAULT_CHAIN_ID,
): MinervaDevPQWalletProfile {
  const parsedDeploymentKey = parseKey(value.deploymentKey);
  const deploymentPublicKey = assertHex(value.deploymentPublicKey)
    ? value.deploymentPublicKey
    : parsedDeploymentKey?.publicKey ?? currentKey.publicKey;
  const deploymentKey =
    parsedDeploymentKey ??
    (deploymentPublicKey.toLowerCase() === currentKey.publicKey.toLowerCase() ? currentKey : undefined);

  if (deploymentKey && deploymentKey.publicKey.toLowerCase() !== deploymentPublicKey.toLowerCase()) {
    throw new Error("Stored deployment key does not match the deployment public key.");
  }

  const normalizedChainId = normalizeChainId(value.chainId ?? chainId);
  const deploymentSalt = assertHex(value.deploymentSalt) ? value.deploymentSalt : MINERVA_ZERO_HASH;
  const derivedAddress = deriveMinervaPQAccountAddress(deploymentPublicKey, deploymentSalt);

  return {
    version: 2,
    chainId: normalizedChainId,
    currentKey,
    deploymentKey,
    deploymentPublicKey,
    deploymentSalt,
    accountAddress: assertHex(value.accountAddress) ? value.accountAddress : derivedAddress,
    currentPublicKeyCommitment: assertHex(value.currentPublicKeyCommitment) ? value.currentPublicKeyCommitment : undefined,
    keyVersion: typeof value.keyVersion === "number" && value.keyVersion > 0 ? value.keyVersion : 1,
    lastRotationAt: typeof value.lastRotationAt === "string" ? value.lastRotationAt : undefined,
    lastRotationTransactionHash: assertHex(value.lastRotationTransactionHash) ? value.lastRotationTransactionHash : undefined,
  };
}

function parseStoredProfile(value: string | null, chainId = DEFAULT_CHAIN_ID): MinervaDevPQWalletProfile | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as StoredProfileV2 & Partial<MLDSA65KeyPair>;
  const currentKey = parseKey(parsed.currentKey) ?? parseKey(parsed);
  return currentKey ? normalizeProfile(parsed, currentKey, chainId) : undefined;
}

function parseProfileObject(value: unknown, chainId = DEFAULT_CHAIN_ID): MinervaDevPQWalletProfile {
  if (!isRecord(value)) throw new Error("Backup profile is missing or invalid.");
  const parsed = value as StoredProfileV2 & Partial<MLDSA65KeyPair>;
  const currentKey = parseKey(parsed.currentKey) ?? parseKey(parsed);
  if (!currentKey) throw new Error("Backup does not contain a valid ML-DSA private key.");
  const signature = signMinervaPQAccountAuthorization(DEV_PQ_RESTORE_VALIDATION_MESSAGE, currentKey.privateKey);
  if (!verifyMLDSA65(signature, DEV_PQ_RESTORE_VALIDATION_MESSAGE, currentKey.publicKey)) {
    throw new Error("Backup ML-DSA key could not sign a validation message.");
  }
  return normalizeProfile(parsed, currentKey, chainId);
}

function profileWithAddress(profile: MinervaDevPQWalletProfile, chainId = DEFAULT_CHAIN_ID): MinervaDevPQWalletProfile {
  const normalizedChainId = normalizeChainId(profile.chainId ?? chainId);
  const deploymentSalt = profile.deploymentSalt ?? MINERVA_ZERO_HASH;
  const accountAddress = profile.accountAddress ?? deriveMinervaPQAccountAddress(profile.deploymentPublicKey, deploymentSalt);
  return {
    ...profile,
    chainId: normalizedChainId,
    deploymentSalt,
    accountAddress,
  };
}

function previewFromProfile(profile: MinervaDevPQWalletProfile, updatedAt = new Date().toISOString()): MinervaWalletPreview {
  const normalized = profileWithAddress(profile, profile.chainId);
  return {
    version: 1,
    chainId: normalizeChainId(normalized.chainId),
    accountAddress: normalized.accountAddress!,
    deploymentPublicKey: normalized.deploymentPublicKey,
    deploymentSalt: normalized.deploymentSalt ?? MINERVA_ZERO_HASH,
    currentPublicKeyCommitment: normalized.currentPublicKeyCommitment,
    keyVersion: normalized.keyVersion,
    lastRotationAt: normalized.lastRotationAt,
    lastRotationTransactionHash: normalized.lastRotationTransactionHash,
    updatedAt,
  };
}

function backupPreviewFromProfile(
  profile: MinervaDevPQWalletProfile,
  format: string,
  encrypted: boolean,
): MinervaDevPQWalletBackupPreview {
  const preview = previewFromProfile(profile);
  return {
    encrypted,
    format,
    chainId: preview.chainId,
    accountAddress: preview.accountAddress,
    deploymentPublicKey: preview.deploymentPublicKey,
    currentPublicKeyCommitment: preview.currentPublicKeyCommitment,
    keyVersion: preview.keyVersion,
    lastRotationAt: preview.lastRotationAt,
  };
}

function parseEncryptedRecord(value: string | null): EncryptedWalletRecord | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as EncryptedWalletRecord;
  if (parsed.format !== "minerva.wallet.encrypted-profile.v1" || !parsed.preview || !parsed.encryption) {
    throw new Error("Stored Minerva Wallet profile is not a supported encrypted profile.");
  }
  return parsed;
}

async function readRawProfile(chainId = DEFAULT_CHAIN_ID): Promise<MinervaDevPQWalletProfile | undefined> {
  if (activeSlot !== PRIMARY_WALLET_SLOT) return undefined;
  const vault = getKeyVault();
  const candidates = [normalizeChainId(chainId), ...SUPPORTED_MINERVA_CHAIN_IDS.filter((id) => id !== normalizeChainId(chainId))];
  for (const id of candidates) {
    const parsed = parseStoredProfile(await vault.getItem(rawProfileKey(id)), id);
    if (parsed) return parsed;
  }
  return parseStoredProfile(await vault.getItem(LEGACY_DEV_PQ_KEY_STORAGE_KEY), normalizeChainId(chainId));
}

async function writeRawProfile(profile: MinervaDevPQWalletProfile, chainId = profile.chainId ?? DEFAULT_CHAIN_ID) {
  const normalized = profileWithAddress(profile, chainId);
  await getKeyVault().setItem(rawProfileKey(normalized.chainId), JSON.stringify(normalized));
}

async function readEncryptedRecord(chainId = DEFAULT_CHAIN_ID, slot = activeSlot): Promise<EncryptedWalletRecord | undefined> {
  const vault = getKeyVault();
  const current = parseEncryptedRecord(await vault.getItem(slotProfileKey(slot)));
  if (current || slot !== PRIMARY_WALLET_SLOT) return current;
  // Legacy per-chain record: migrate the first one found into the primary slot.
  const candidates = [normalizeChainId(chainId), ...SUPPORTED_MINERVA_CHAIN_IDS.filter((id) => id !== normalizeChainId(chainId))];
  for (const id of candidates) {
    const legacyKey = encryptedProfileKey(id);
    const legacy = parseEncryptedRecord(await vault.getItem(legacyKey));
    if (legacy) {
      await vault.setItem(slotProfileKey(PRIMARY_WALLET_SLOT), JSON.stringify(legacy));
      await rememberSlot(PRIMARY_WALLET_SLOT);
      await vault.deleteItem(legacyKey).catch(() => undefined);
      return legacy;
    }
  }
  return undefined;
}

async function writeEncryptedProfile(
  profile: MinervaDevPQWalletProfile,
  passcode: string,
  chainId = profile.chainId ?? DEFAULT_CHAIN_ID,
  slot = activeSlot,
): Promise<MinervaDevPQWalletProfile> {
  assertPasscode(passcode);
  const normalized = profileWithAddress(profile, chainId);
  const preview = previewFromProfile(normalized);
  const record: EncryptedWalletRecord = {
    format: "minerva.wallet.encrypted-profile.v1",
    preview,
    encryption: await encryptStringWithPasscode(JSON.stringify(normalized), passcode, {
      salt: await Crypto.getRandomBytesAsync(16),
      nonce: await Crypto.getRandomBytesAsync(12),
      aad: encryptedProfileAad(preview.chainId),
    }),
  };
  await getKeyVault().setItem(slotProfileKey(slot), JSON.stringify(record));
  await rememberSlot(slot);
  unlockedProfiles.set(slot, normalized);
  unlockedPasscodes.set(slot, passcode);
  return normalized;
}

async function updateStoredProfile(profile: MinervaDevPQWalletProfile): Promise<MinervaDevPQWalletProfile> {
  const chainId = normalizeChainId(profile.chainId);
  const passcode = unlockedPasscodes.get(activeSlot);
  if (passcode) return writeEncryptedProfile(profile, passcode, chainId);
  if (await readEncryptedRecord(chainId)) {
    throw new Error("Unlock Minerva Wallet before changing the encrypted profile.");
  }
  await writeRawProfile(profile, chainId);
  return profileWithAddress(profile, chainId);
}

function parsePlainBackupRecord(parsed: Record<string, unknown>, expectedChainId = DEFAULT_CHAIN_ID): MinervaDevPQWalletProfile {
  if (!isRecord(parsed)) throw new Error("Backup JSON must be an object.");
  if ("format" in parsed) {
    if (parsed.format !== DEV_PQ_BACKUP_FORMAT && parsed.format !== LEGACY_DEV_PQ_BACKUP_FORMAT) {
      throw new Error("Backup format is not supported.");
    }
    const backupChainId = normalizeChainId(typeof parsed.chainId === "number" ? parsed.chainId : expectedChainId);
    return parseProfileObject(parsed.profile, backupChainId);
  }
  return parseProfileObject(parsed, expectedChainId);
}

async function parseBackupPayload(
  encoded: string,
  passcode?: string,
  expectedChainId = DEFAULT_CHAIN_ID,
): Promise<MinervaDevPQWalletProfile> {
  const parsed = JSON.parse(encoded) as unknown;
  if (!isRecord(parsed)) throw new Error("Backup JSON must be an object.");
  if (parsed.format === DEV_PQ_ENCRYPTED_BACKUP_FORMAT || parsed.format === LEGACY_DEV_PQ_ENCRYPTED_BACKUP_FORMAT) {
    const backupChainId = normalizeChainId(typeof parsed.chainId === "number" ? parsed.chainId : expectedChainId);
    if (!passcode) throw new Error("Encrypted backup requires a passcode.");
    const plaintext = await decryptStringWithPasscode(parsed.encryption as PasscodeEncryptedPayload, passcode, {
      aad: encryptedBackupAad(backupChainId, parsed.format),
    });
    return parseProfileObject(JSON.parse(plaintext), backupChainId);
  }
  return parsePlainBackupRecord(parsed, expectedChainId);
}

export async function generateMinervaDevPQKey(): Promise<MLDSA65KeyPair> {
  return generateMLDSA65KeyPair(await Crypto.getRandomBytesAsync(32));
}

export async function getWalletPreview(chainId = DEFAULT_CHAIN_ID): Promise<MinervaWalletPreview | undefined> {
  const normalizedChainId = normalizeChainId(chainId);
  const record = await readEncryptedRecord(normalizedChainId);
  if (record) return record.preview;
  const raw = await readRawProfile(normalizedChainId);
  return raw ? previewFromProfile(raw) : undefined;
}

export async function hasWalletProfile(chainId = DEFAULT_CHAIN_ID): Promise<boolean> {
  return Boolean(await getWalletPreview(chainId));
}

export async function getWalletBootState(chainId = DEFAULT_CHAIN_ID): Promise<WalletBootState> {
  const normalizedChainId = normalizeChainId(chainId);
  try {
    const encrypted = await readEncryptedRecord(normalizedChainId);
    if (encrypted) {
      return unlockedProfiles.has(activeSlot)
        ? { status: "unlocked", chainId: normalizedChainId, preview: { ...encrypted.preview, chainId: normalizedChainId } }
        : { status: "read-only-ready", chainId: normalizedChainId, preview: { ...encrypted.preview, chainId: normalizedChainId } };
    }
    const raw = await readRawProfile(normalizedChainId);
    if (raw) return { status: "migrate-required", chainId: normalizedChainId, preview: previewFromProfile(raw) };
    return { status: "no-wallet", chainId: normalizedChainId };
  } catch (error) {
    return {
      status: "error",
      chainId: normalizedChainId,
      error: error instanceof Error ? error.message : "Could not read Minerva Wallet profile.",
    };
  }
}

function bootStateHasProfile(state: WalletBootState): boolean {
  return state.status !== "no-wallet" && state.status !== "error";
}

/** Profiles are chain-agnostic, so this is the boot state of the active slot on `chainId`. */
export async function getWalletBootStateForAnyChain(chainId = DEFAULT_CHAIN_ID): Promise<WalletBootState> {
  return getWalletBootState(chainId);
}

export function walletBootStateHasProfile(state: WalletBootState): boolean {
  return bootStateHasProfile(state);
}

export function isWalletUnlocked(_chainId = DEFAULT_CHAIN_ID): boolean {
  return unlockedProfiles.has(activeSlot);
}

export function getUnlockedWalletProfile(chainId = DEFAULT_CHAIN_ID): MinervaDevPQWalletProfile | undefined {
  const profile = unlockedProfiles.get(activeSlot);
  return profile ? { ...profile, chainId: normalizeChainId(chainId) } : undefined;
}

/** The passcode of the unlocked session, so the app can add accounts without prompting again. */
export function getUnlockedWalletPasscode(): string | undefined {
  return unlockedPasscodes.get(activeSlot);
}

/** Locks every slot; chain-specific locking has no meaning with chain-agnostic profiles. */
export function lockWalletProfile(_chainId: number | "all" = DEFAULT_CHAIN_ID): void {
  unlockedProfiles.clear();
  unlockedPasscodes.clear();
}

export function requireUnlockedWalletProfile(chainId = DEFAULT_CHAIN_ID): MinervaDevPQWalletProfile {
  const profile = getUnlockedWalletProfile(chainId);
  if (!profile) throw new Error("Unlock Minerva Wallet before signing or changing account security.");
  return profile;
}

export async function createEncryptedWalletProfile(
  passcode: string,
  chainId = DEFAULT_CHAIN_ID,
): Promise<MinervaDevPQWalletProfile> {
  const normalizedChainId = normalizeChainId(chainId);
  const generated = await generateMinervaDevPQKey();
  const profile: MinervaDevPQWalletProfile = {
    version: 2,
    chainId: normalizedChainId,
    currentKey: generated,
    deploymentKey: generated,
    deploymentPublicKey: generated.publicKey,
    deploymentSalt: MINERVA_ZERO_HASH,
    accountAddress: deriveMinervaPQAccountAddress(generated.publicKey, MINERVA_ZERO_HASH),
    keyVersion: 1,
  };
  await writeEncryptedProfile(profile, passcode, normalizedChainId);
  await getKeyVault().deleteItem(rawProfileKey(normalizedChainId)).catch(() => undefined);
  if (normalizedChainId === MINERVA_DEVNET_CHAIN_ID) {
    await getKeyVault().deleteItem(LEGACY_DEV_PQ_KEY_STORAGE_KEY).catch(() => undefined);
  }
  return profile;
}

export async function unlockWalletProfile(passcode: string, chainId = DEFAULT_CHAIN_ID): Promise<MinervaDevPQWalletProfile> {
  assertPasscode(passcode);
  const normalizedChainId = normalizeChainId(chainId);
  const record = await readEncryptedRecord(normalizedChainId);
  if (!record) throw new Error("No encrypted Minerva Wallet profile found.");
  const plaintext = await decryptStringWithPasscode(record.encryption, passcode, {
    aad: encryptedProfileAad(record.preview.chainId),
  });
  const profile = profileWithAddress(parseProfileObject(JSON.parse(plaintext), normalizedChainId), normalizedChainId);
  unlockedProfiles.set(activeSlot, profile);
  unlockedPasscodes.set(activeSlot, passcode);
  return profile;
}

// ------------------------------------------------------------ multi-account slots

function newSlotId(): string {
  const bytes = Crypto.getRandomBytes(8);
  return `acct-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Creates a fresh ML-DSA profile in a new slot without changing the active slot. */
export async function createWalletProfileInNewSlot(
  passcode: string,
  chainId = DEFAULT_CHAIN_ID,
): Promise<{ slot: string; preview: MinervaWalletPreview }> {
  const normalizedChainId = normalizeChainId(chainId);
  const generated = await generateMinervaDevPQKey();
  const profile: MinervaDevPQWalletProfile = {
    version: 2,
    chainId: normalizedChainId,
    currentKey: generated,
    deploymentKey: generated,
    deploymentPublicKey: generated.publicKey,
    deploymentSalt: MINERVA_ZERO_HASH,
    accountAddress: deriveMinervaPQAccountAddress(generated.publicKey, MINERVA_ZERO_HASH),
    keyVersion: 1,
  };
  const slot = newSlotId();
  const written = await writeEncryptedProfile(profile, passcode, normalizedChainId, slot);
  return { slot, preview: previewFromProfile(written) };
}

/** Restores a Recovery Kit into a new slot (re-encrypted under the wallet passcode). */
export async function importBackupIntoNewSlot(
  encoded: string,
  kitPasscode: string | undefined,
  walletPasscode: string,
  chainId = DEFAULT_CHAIN_ID,
): Promise<{ slot: string; preview: MinervaWalletPreview }> {
  const profile = await parseBackupPayload(encoded, kitPasscode, chainId);
  const slot = newSlotId();
  const written = await writeEncryptedProfile(profile, walletPasscode, profile.chainId ?? chainId, slot);
  return { slot, preview: previewFromProfile(written) };
}

export async function readWalletSlotPreview(slot: string): Promise<MinervaWalletPreview | undefined> {
  return (await readEncryptedRecord(DEFAULT_CHAIN_ID, slot))?.preview;
}

/** Makes `slot` active and, when the previous slot was unlocked with the same passcode, unlocks it too. */
export async function switchWalletSlot(slot: string, chainId = DEFAULT_CHAIN_ID): Promise<WalletBootState> {
  const previousPasscode = unlockedPasscodes.get(activeSlot);
  setActiveWalletSlot(slot);
  if (previousPasscode && !unlockedProfiles.has(slot)) {
    await unlockWalletProfile(previousPasscode, chainId).catch(() => undefined);
  }
  return getWalletBootState(chainId);
}

export async function deleteWalletSlot(slot: string): Promise<void> {
  await getKeyVault().deleteItem(slotProfileKey(slot)).catch(() => undefined);
  await forgetSlot(slot);
  unlockedProfiles.delete(slot);
  unlockedPasscodes.delete(slot);
  if (activeSlot === slot) activeSlot = PRIMARY_WALLET_SLOT;
}

export async function migrateLegacyWalletProfile(
  passcode: string,
  chainId = DEFAULT_CHAIN_ID,
): Promise<MinervaDevPQWalletProfile> {
  assertPasscode(passcode);
  const normalizedChainId = normalizeChainId(chainId);
  const raw = await readRawProfile(normalizedChainId);
  if (!raw) throw new Error("No legacy Minerva Wallet profile found.");
  const migrated = await writeEncryptedProfile(profileWithAddress(raw, normalizedChainId), passcode, normalizedChainId);
  await getKeyVault().deleteItem(rawProfileKey(normalizedChainId)).catch(() => undefined);
  if (normalizedChainId === MINERVA_DEVNET_CHAIN_ID) {
    await getKeyVault().deleteItem(LEGACY_DEV_PQ_KEY_STORAGE_KEY).catch(() => undefined);
  }
  return migrated;
}

export async function loadOrCreateMinervaDevPQProfile(chainId = DEFAULT_CHAIN_ID): Promise<MinervaDevPQWalletProfile> {
  const normalizedChainId = normalizeChainId(chainId);
  const unlocked = getUnlockedWalletProfile(normalizedChainId);
  if (unlocked) return unlocked;
  const raw = await readRawProfile(normalizedChainId);
  if (raw) return raw;

  const generated = await generateMinervaDevPQKey();
  const profile: MinervaDevPQWalletProfile = {
    version: 2,
    chainId: normalizedChainId,
    currentKey: generated,
    deploymentKey: generated,
    deploymentPublicKey: generated.publicKey,
    deploymentSalt: MINERVA_ZERO_HASH,
    accountAddress: deriveMinervaPQAccountAddress(generated.publicKey, MINERVA_ZERO_HASH),
    keyVersion: 1,
  };
  await writeRawProfile(profile, normalizedChainId);
  return profile;
}

export async function rememberMinervaDevPQDeployment(
  metadata: Pick<MinervaDevPQWalletProfile, "accountAddress"> &
    Partial<Pick<MinervaDevPQWalletProfile, "chainId" | "deploymentPublicKey" | "deploymentSalt" | "currentPublicKeyCommitment">>,
): Promise<MinervaDevPQWalletProfile> {
  const chainId = normalizeChainId(metadata.chainId ?? DEFAULT_CHAIN_ID);
  const profile = unlockedProfiles.get(activeSlot) ?? (await readRawProfile(chainId));
  if (!profile) throw new Error("No Minerva Wallet profile found for deployment metadata.");
  const nextProfile: MinervaDevPQWalletProfile = {
    ...profile,
    chainId,
    accountAddress: metadata.accountAddress,
    deploymentPublicKey: metadata.deploymentPublicKey ?? profile.deploymentPublicKey,
    deploymentSalt: metadata.deploymentSalt ?? profile.deploymentSalt ?? MINERVA_ZERO_HASH,
    currentPublicKeyCommitment: metadata.currentPublicKeyCommitment ?? profile.currentPublicKeyCommitment,
  };
  return updateStoredProfile(nextProfile);
}

export async function rotateStoredMinervaDevPQKey(
  nextKey: MLDSA65KeyPair,
  metadata: Pick<MinervaDevPQWalletProfile, "accountAddress"> &
    Partial<
      Pick<
        MinervaDevPQWalletProfile,
        "chainId" | "deploymentPublicKey" | "deploymentSalt" | "currentPublicKeyCommitment" | "lastRotationTransactionHash"
      >
    >,
): Promise<MinervaDevPQWalletProfile> {
  const chainId = normalizeChainId(metadata.chainId ?? DEFAULT_CHAIN_ID);
  const profile = requireUnlockedWalletProfile(chainId);
  const nextProfile: MinervaDevPQWalletProfile = {
    ...profile,
    chainId,
    currentKey: nextKey,
    accountAddress: metadata.accountAddress,
    deploymentPublicKey: metadata.deploymentPublicKey ?? profile.deploymentPublicKey,
    deploymentSalt: metadata.deploymentSalt ?? profile.deploymentSalt ?? MINERVA_ZERO_HASH,
    currentPublicKeyCommitment: metadata.currentPublicKeyCommitment,
    keyVersion: profile.keyVersion + 1,
    lastRotationAt: new Date().toISOString(),
    lastRotationTransactionHash: metadata.lastRotationTransactionHash,
  };
  return updateStoredProfile(nextProfile);
}

export async function exportMinervaDevPQBackup(chainId = DEFAULT_CHAIN_ID): Promise<string> {
  const normalizedChainId = normalizeChainId(chainId);
  const profile = requireUnlockedWalletProfile(normalizedChainId);
  const backup: MinervaDevPQWalletBackup = {
    format: DEV_PQ_BACKUP_FORMAT,
    chainId: normalizedChainId,
    exportedAt: new Date().toISOString(),
    warning: "UNENCRYPTED MINERVA WALLET BACKUP. Anyone with this JSON can control this Minerva Account.",
    profile,
  };
  return JSON.stringify(backup, null, 2);
}

export async function exportMinervaDevPQEncryptedBackup(passcode: string, chainId = DEFAULT_CHAIN_ID): Promise<string> {
  const normalizedChainId = normalizeChainId(chainId);
  const profile = requireUnlockedWalletProfile(normalizedChainId);
  const backup: MinervaDevPQWalletEncryptedBackup = {
    format: DEV_PQ_ENCRYPTED_BACKUP_FORMAT,
    chainId: normalizedChainId,
    exportedAt: new Date().toISOString(),
    warning: "PASSCODE-ENCRYPTED MINERVA WALLET BACKUP. The passcode cannot be recovered if forgotten.",
    preview: backupPreviewFromProfile(profile, DEV_PQ_ENCRYPTED_BACKUP_FORMAT, true),
    encryption: await encryptStringWithPasscode(JSON.stringify(profile), passcode, {
      salt: await Crypto.getRandomBytesAsync(16),
      nonce: await Crypto.getRandomBytesAsync(12),
      aad: encryptedBackupAad(normalizedChainId),
    }),
  };
  return JSON.stringify(backup, null, 2);
}

export async function inspectMinervaDevPQBackup(
  encoded: string,
  passcode?: string,
  chainId = DEFAULT_CHAIN_ID,
): Promise<MinervaDevPQWalletBackupPreview> {
  const profile = await parseBackupPayload(encoded, passcode, chainId);
  const parsed = JSON.parse(encoded) as Record<string, unknown>;
  const format = typeof parsed.format === "string" ? parsed.format : DEV_PQ_BACKUP_FORMAT;
  return backupPreviewFromProfile(
    profile,
    format,
    format === DEV_PQ_ENCRYPTED_BACKUP_FORMAT || format === LEGACY_DEV_PQ_ENCRYPTED_BACKUP_FORMAT,
  );
}

export async function restoreMinervaDevPQBackup(
  encoded: string,
  passcode?: string,
  chainId = DEFAULT_CHAIN_ID,
): Promise<MinervaDevPQWalletProfile> {
  if (!passcode) throw new Error("Restore requires a new wallet passcode.");
  const profile = await parseBackupPayload(encoded, passcode, chainId);
  return writeEncryptedProfile(profile, passcode, profile.chainId ?? chainId);
}

export async function loadOrCreateMinervaDevPQKey(chainId = DEFAULT_CHAIN_ID): Promise<MLDSA65KeyPair> {
  return requireUnlockedWalletProfile(chainId).currentKey;
}

/** Deletes the active slot ("all": every slot, every legacy key). */
export async function wipeWalletProfile(chainId: number | "all" = DEFAULT_CHAIN_ID): Promise<void> {
  const vault = getKeyVault();
  if (chainId === "all") {
    for (const slot of await listWalletSlots()) await deleteWalletSlot(slot);
    await vault.deleteItem(slotProfileKey(PRIMARY_WALLET_SLOT)).catch(() => undefined);
    await vault.deleteItem(SLOT_INDEX_KEY).catch(() => undefined);
    for (const id of SUPPORTED_MINERVA_CHAIN_IDS) {
      await vault.deleteItem(encryptedProfileKey(id)).catch(() => undefined);
      await vault.deleteItem(rawProfileKey(id)).catch(() => undefined);
    }
    await vault.deleteItem(LEGACY_DEV_PQ_KEY_STORAGE_KEY).catch(() => undefined);
    unlockedProfiles.clear();
    unlockedPasscodes.clear();
    activeSlot = PRIMARY_WALLET_SLOT;
    return;
  }
  await deleteWalletSlot(activeSlot);
}

/**
 * Hard reset: permanently deletes the on-device ML-DSA profile for every
 * supported chain plus the legacy key. This is irreversible — the only
 * recovery afterwards is restoring an exported backup.
 */
export async function resetMinervaWallet(): Promise<void> {
  await wipeWalletProfile("all");
}

export interface RecoveryRehearsalResult {
  ok: boolean;
  backupFormat: string;
  keyVersion: number;
  accountAddress?: Hex;
  checkedAt: string;
  detail: string;
}

/**
 * Recovery rehearsal: export the encrypted Recovery Kit with `passcode`, decrypt it again the way
 * a fresh device would, and prove the restored key is the live control key by signing a
 * challenge with the restored private key and verifying it under the active public key. Nothing
 * is written to the wallet profile.
 */
export async function rehearseMinervaDevPQRecovery(
  passcode: string,
  chainId = DEFAULT_CHAIN_ID,
): Promise<RecoveryRehearsalResult> {
  const live = requireUnlockedWalletProfile(chainId);
  const encoded = await exportMinervaDevPQEncryptedBackup(passcode, chainId);
  const restored = await parseBackupPayload(encoded, passcode, chainId);
  const parsed = JSON.parse(encoded) as Record<string, unknown>;
  const backupFormat = typeof parsed.format === "string" ? parsed.format : "unknown";
  const checkedAt = new Date().toISOString();
  const base = { backupFormat, keyVersion: restored.keyVersion, accountAddress: restored.accountAddress, checkedAt };

  if (restored.currentKey.publicKey.toLowerCase() !== live.currentKey.publicKey.toLowerCase()) {
    return { ...base, ok: false, detail: "The Recovery Kit holds a different control key than the one in use. Export a fresh kit." };
  }
  if (restored.deploymentPublicKey.toLowerCase() !== live.deploymentPublicKey.toLowerCase()) {
    return { ...base, ok: false, detail: "The Recovery Kit does not carry this account's deployment key, so it cannot restore the address." };
  }
  const challenge = new TextEncoder().encode(`MINERVA_RECOVERY_REHEARSAL:${chainId}:${checkedAt}`);
  const signature = signMLDSA65(challenge, restored.currentKey.privateKey, { context: MINERVA_ML_DSA_CONTEXT });
  if (!verifyMLDSA65(signature, challenge, live.currentKey.publicKey, { context: MINERVA_ML_DSA_CONTEXT })) {
    return { ...base, ok: false, detail: "The restored key could not produce a valid ML-DSA signature." };
  }
  await markRehearsed(chainId);
  return {
    ...base,
    ok: true,
    detail: `The kit decrypts and signs: ML-DSA key v${restored.keyVersion} for ${restored.accountAddress ?? "this account"} (format ${backupFormat}).`,
  };
}

