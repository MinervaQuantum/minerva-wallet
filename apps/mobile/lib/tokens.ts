import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Hex } from "@minerva/core";
import {
  KNOWN_ERC20_TOKENS,
  discoverIndexedAssets,
  isValidEvmAddress,
  normalizeEvmAddress,
  readErc20Balances,
  readErc20Metadata,
  type Erc20Balance,
  type Erc20Metadata,
  type EvmReadConfig,
} from "@minerva/evm";
import { emitWalletChange } from "@/lib/walletEvents";

const STORAGE_PREFIX = "minerva.wallet.tokens.v1";

export interface TrackedToken extends Erc20Metadata {
  chainId: number;
  source: "custom" | "discovered";
  hidden: boolean;
  addedAt: string;
}

export interface TrackedTokenBalance extends TrackedToken {
  balance: bigint;
  error?: string;
}

function storageKey(chainId: number) {
  return `${STORAGE_PREFIX}.${chainId}`;
}

function isTracked(value: unknown): value is TrackedToken {
  const v = value as Partial<TrackedToken>;
  return typeof v?.address === "string" && typeof v.symbol === "string" && typeof v.decimals === "number" && typeof v.chainId === "number";
}

function defaultTokens(chainId: number): TrackedToken[] {
  return (KNOWN_ERC20_TOKENS[chainId] ?? []).map((token) => ({ ...token, chainId, source: "discovered" as const, hidden: false, addedAt: "2026-11-07T00:00:00.000Z" }));
}

/** Tracked tokens for a chain; the built-in list seeds the store on first use. */
export async function listTrackedTokens(chainId: number): Promise<TrackedToken[]> {
  const raw = await AsyncStorage.getItem(storageKey(chainId));
  if (!raw) {
    const defaults = defaultTokens(chainId);
    if (defaults.length > 0) await writeTrackedTokens(chainId, defaults);
    return defaults;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isTracked) : [];
  } catch {
    return [];
  }
}

async function writeTrackedTokens(chainId: number, tokens: TrackedToken[]): Promise<void> {
  const deduped = new Map<string, TrackedToken>();
  for (const token of tokens) deduped.set(token.address.toLowerCase(), token);
  await AsyncStorage.setItem(storageKey(chainId), JSON.stringify([...deduped.values()]));
}

/** Adds a token by contract address after reading its metadata on chain. */
export async function addCustomToken(chainId: number, address: string, config: EvmReadConfig): Promise<TrackedToken> {
  if (!isValidEvmAddress(address.trim())) throw new Error("Enter a valid token contract address.");
  const normalized = normalizeEvmAddress(address.trim()) as Hex;
  const metadata = await readErc20Metadata(normalized, { ...config, chainId });
  const current = await listTrackedTokens(chainId);
  const existing = current.find((t) => t.address.toLowerCase() === normalized.toLowerCase());
  const token: TrackedToken = {
    ...metadata,
    chainId,
    source: existing?.source ?? "custom",
    hidden: false,
    addedAt: existing?.addedAt ?? new Date().toISOString(),
  };
  await writeTrackedTokens(chainId, [...current.filter((t) => t.address.toLowerCase() !== normalized.toLowerCase()), token]);
  emitWalletChange();
  return token;
}

export async function setTokenHidden(chainId: number, address: Hex, hidden: boolean): Promise<void> {
  const current = await listTrackedTokens(chainId);
  await writeTrackedTokens(
    chainId,
    current.map((t) => (t.address.toLowerCase() === address.toLowerCase() ? { ...t, hidden } : t)),
  );
  emitWalletChange();
}

export async function removeTrackedToken(chainId: number, address: Hex): Promise<void> {
  const current = await listTrackedTokens(chainId);
  await writeTrackedTokens(
    chainId,
    current.filter((t) => t.address.toLowerCase() !== address.toLowerCase()),
  );
  emitWalletChange();
}

const discoveryStamp = new Map<string, number>();
const DISCOVERY_INTERVAL_MS = 60_000;

/**
 * Asks the indexer which ERC-20 contracts have ever moved tokens to or from the account and adds
 * the unknown ones. Throttled per account and chain; failures are silent because discovery is a
 * convenience on top of the custom list.
 */
export async function discoverTokens(chainId: number, owner: Hex, indexerUrl: string | undefined, config: EvmReadConfig): Promise<TrackedToken[]> {
  const current = await listTrackedTokens(chainId);
  if (!indexerUrl) return current;
  const key = `${chainId}:${owner.toLowerCase()}`;
  const last = discoveryStamp.get(key) ?? 0;
  if (Date.now() - last < DISCOVERY_INTERVAL_MS) return current;
  discoveryStamp.set(key, Date.now());
  let assets;
  try {
    assets = await discoverIndexedAssets(owner, indexerUrl);
  } catch {
    return current;
  }
  const known = new Set(current.map((t) => t.address.toLowerCase()));
  const additions: TrackedToken[] = [];
  for (const asset of assets.erc20) {
    if (known.has(asset.contract.toLowerCase())) continue;
    try {
      const metadata = await readErc20Metadata(asset.contract, { ...config, chainId });
      additions.push({ ...metadata, chainId, source: "discovered", hidden: false, addedAt: new Date().toISOString() });
    } catch {
      // not a readable ERC-20; skip
    }
  }
  if (additions.length === 0) return current;
  const next = [...current, ...additions];
  await writeTrackedTokens(chainId, next);
  emitWalletChange();
  return next;
}

export async function readTrackedTokenBalances(
  tokens: readonly TrackedToken[],
  owner: Hex,
  config: EvmReadConfig,
): Promise<TrackedTokenBalance[]> {
  if (tokens.length === 0) return [];
  const balances = await readErc20Balances(tokens, owner, config);
  return balances.map((balance: Erc20Balance & { error?: string }, index) => ({ ...tokens[index]!, balance: balance.balance, error: balance.error }));
}
