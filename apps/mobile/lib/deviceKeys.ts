/**
 * Device keys (Minerva Compatibility Specification 4.6): additional ML-DSA keys the phone's
 * control key enrols with a scope, so another device (extension, desktop) can spend within
 * limits without holding the control key. This module keeps a local registry of what this
 * wallet enrolled and drives enrolment, refresh and revocation through the control key.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Hex } from "@minerva/core";
import {
  defaultMinervaPQRelayerUrl,
  defaultMinervaRpcUrl,
  enrollMinervaDeviceKey,
  isValidEvmAddress,
  normalizeEvmAddress,
  readMinervaDeviceKey,
  readMinervaPQEnrollAuthorization,
  readMinervaPQRevokeAuthorization,
  revokeMinervaDeviceKey,
  signMinervaPQAccountAuthorization,
  type MinervaDeviceKeyState,
} from "@minerva/evm";
import { requireUnlockedWalletProfile } from "@/lib/pqDevWallet";
import { minervaDevnetPQNativeGasKey } from "@/lib/mrvDevnetWalletFlow";
import { readPublicEnv } from "@/lib/runtimeConfig";

const STORAGE_KEY = "minerva.wallet.devicekeys.v1";
export const ML_DSA_65_PUBLIC_KEY_HEX_LENGTH = 2 + 1952 * 2;

export interface DeviceKeyScope {
  /** Allowed targets; empty = any target except the account and the registries. */
  targets: Hex[];
  valueLimitWei: string;
  /** 0 = lifetime cap. */
  windowSeconds: string;
  /** Unix seconds; 0 = no expiry. */
  expiry: string;
}

export interface DeviceKeyRecord {
  id: string;
  chainId: number;
  accountAddress: Hex;
  label: string;
  commitment: Hex;
  publicKey: Hex;
  scope: DeviceKeyScope;
  enrolledAt: number;
  enrolledTx?: Hex;
  revokedAt?: number;
  revokedTx?: Hex;
}

export interface DeviceKeyView extends DeviceKeyRecord {
  chain?: MinervaDeviceKeyState;
  chainError?: string;
}

async function readAll(): Promise<DeviceKeyRecord[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as DeviceKeyRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(records: DeviceKeyRecord[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function sdkConfigFor(chainId: number, rpcUrl?: string) {
  return {
    chainId,
    rpcUrl: rpcUrl ?? readPublicEnv("EXPO_PUBLIC_MINERVA_RPC_URL") ?? defaultMinervaRpcUrl(chainId),
    pqRelayerUrl: readPublicEnv("EXPO_PUBLIC_MINERVA_PQ_RELAYER_URL") ?? defaultMinervaPQRelayerUrl(chainId),
  };
}

export async function listDeviceKeys(chainId: number, accountAddress?: Hex): Promise<DeviceKeyRecord[]> {
  const all = await readAll();
  return all
    .filter((r) => r.chainId === chainId && (!accountAddress || r.accountAddress.toLowerCase() === accountAddress.toLowerCase()))
    .sort((a, b) => b.enrolledAt - a.enrolledAt);
}

/** Local records plus the registry/scope state read from the node. */
export async function listDeviceKeysWithChainState(
  chainId: number,
  accountAddress: Hex,
  rpcUrl?: string,
): Promise<DeviceKeyView[]> {
  const records = await listDeviceKeys(chainId, accountAddress);
  const config = sdkConfigFor(chainId, rpcUrl);
  return Promise.all(
    records.map(async (record) => {
      try {
        const chain = await readMinervaDeviceKey({ accountAddress, commitment: record.commitment }, config);
        return { ...record, chain };
      } catch (error) {
        return { ...record, chainError: error instanceof Error ? error.message : "Could not read the registry." };
      }
    }),
  );
}

/** "1.5" MRV -> wei; rejects anything that is not a plain decimal. */
export function parseMrvToWei(text: string): bigint {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(trimmed)) throw new Error("Enter a MRV amount such as 0.25.");
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
}

export function validateDevicePublicKey(text: string): Hex {
  const trimmed = text.trim();
  if (!/^0x[0-9a-fA-F]+$/.test(trimmed)) throw new Error("The device key must be a 0x hex ML-DSA-65 public key.");
  if (trimmed.length !== ML_DSA_65_PUBLIC_KEY_HEX_LENGTH) {
    throw new Error(`An ML-DSA-65 public key is 1952 bytes (${ML_DSA_65_PUBLIC_KEY_HEX_LENGTH - 2} hex characters).`);
  }
  return trimmed.toLowerCase() as Hex;
}

export async function enrollDeviceKeyFromWallet(args: {
  chainId: number;
  rpcUrl?: string;
  accountAddress: Hex;
  salt?: Hex;
  label: string;
  devicePublicKey: string;
  target?: string;
  valueLimitMrv: string;
  windowHours: string;
  expiryDays: string;
}): Promise<DeviceKeyRecord> {
  const label = args.label.trim();
  if (!label) throw new Error("Give this device a label.");
  const devicePublicKey = validateDevicePublicKey(args.devicePublicKey);
  const targets: Hex[] = [];
  if (args.target && args.target.trim()) {
    if (!isValidEvmAddress(args.target.trim())) throw new Error("The allowed target must be a valid 0x address.");
    targets.push(normalizeEvmAddress(args.target.trim()) as Hex);
  }
  const valueLimitWei = parseMrvToWei(args.valueLimitMrv);
  const windowSeconds = BigInt(Math.max(0, Math.floor(Number(args.windowHours || "0") * 3600)));
  const expiryDays = Number(args.expiryDays || "0");
  const expiry = expiryDays > 0 ? BigInt(Math.floor(Date.now() / 1000) + Math.floor(expiryDays * 86400)) : 0n;
  const scope = { targets, valueLimitWei, windowSeconds, expiry };

  const profile = requireUnlockedWalletProfile(args.chainId);
  const gasKey = minervaDevnetPQNativeGasKey(profile);
  const config = sdkConfigFor(args.chainId, args.rpcUrl);
  const authorization = await readMinervaPQEnrollAuthorization(
    { accountAddress: args.accountAddress, devicePublicKey, scope },
    config,
  );
  const signature = signMinervaPQAccountAuthorization(authorization.message, profile.currentKey.privateKey);
  const receipt = await enrollMinervaDeviceKey(
    {
      accountAddress: args.accountAddress,
      devicePublicKey,
      scope,
      nonce: authorization.nonce,
      signature,
      publicKey: gasKey.publicKey,
      privateKey: gasKey.privateKey,
      salt: args.salt,
    },
    config,
  );
  if (receipt.status !== "success") throw new Error("Device-key enrolment was not mined successfully.");

  const record: DeviceKeyRecord = {
    id: `${Date.now()}-${authorization.commitment.slice(2, 10)}`,
    chainId: args.chainId,
    accountAddress: args.accountAddress,
    label,
    commitment: authorization.commitment,
    publicKey: devicePublicKey,
    scope: {
      targets,
      valueLimitWei: valueLimitWei.toString(),
      windowSeconds: windowSeconds.toString(),
      expiry: expiry.toString(),
    },
    enrolledAt: Date.now(),
    enrolledTx: receipt.transactionHash,
  };
  const all = await readAll();
  await writeAll([record, ...all.filter((r) => !(r.chainId === record.chainId && r.commitment === record.commitment))]);
  return record;
}

export async function revokeDeviceKeyFromWallet(args: {
  chainId: number;
  rpcUrl?: string;
  accountAddress: Hex;
  salt?: Hex;
  commitment: Hex;
}): Promise<DeviceKeyRecord | undefined> {
  const profile = requireUnlockedWalletProfile(args.chainId);
  const gasKey = minervaDevnetPQNativeGasKey(profile);
  const config = sdkConfigFor(args.chainId, args.rpcUrl);
  const authorization = await readMinervaPQRevokeAuthorization(
    { accountAddress: args.accountAddress, commitment: args.commitment },
    config,
  );
  const signature = signMinervaPQAccountAuthorization(authorization.message, profile.currentKey.privateKey);
  const receipt = await revokeMinervaDeviceKey(
    {
      accountAddress: args.accountAddress,
      commitment: args.commitment,
      nonce: authorization.nonce,
      signature,
      publicKey: gasKey.publicKey,
      privateKey: gasKey.privateKey,
      salt: args.salt,
    },
    config,
  );
  if (receipt.status !== "success") throw new Error("Device-key revocation was not mined successfully.");

  const all = await readAll();
  let updated: DeviceKeyRecord | undefined;
  const next = all.map((r) => {
    if (r.chainId !== args.chainId || r.commitment.toLowerCase() !== args.commitment.toLowerCase()) return r;
    updated = { ...r, revokedAt: Date.now(), revokedTx: receipt.transactionHash };
    return updated;
  });
  await writeAll(next);
  return updated;
}

export async function forgetDeviceKey(id: string): Promise<void> {
  const all = await readAll();
  await writeAll(all.filter((r) => r.id !== id));
}
