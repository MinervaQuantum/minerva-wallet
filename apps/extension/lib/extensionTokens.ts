/**
 * ERC-20 tokens tracked per chain in chrome.storage.local. Balances and metadata are always
 * read from the configured RPC; discovery asks the public Minerva indexer which contracts have
 * ever moved tokens to or from the account.
 */
import type { Hex } from "viem";
import {
  defaultMinervaIndexerUrl,
  discoverIndexedAssets,
  isValidEvmAddress,
  normalizeEvmAddress,
  readErc20Balances,
  readErc20Metadata,
  type Erc20Metadata,
} from "@minerva/evm";
import { EXTENSION_TOKENS_KEY_PREFIX } from "./extensionWalletVault";

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
  return `${EXTENSION_TOKENS_KEY_PREFIX}.${chainId}`;
}

function isTracked(value: unknown): value is TrackedToken {
  const token = value as Partial<TrackedToken> | undefined;
  return (
    typeof token?.address === "string" &&
    typeof token.symbol === "string" &&
    typeof token.decimals === "number" &&
    typeof token.chainId === "number"
  );
}

export async function listTrackedTokens(chainId: number): Promise<TrackedToken[]> {
  const key = storageKey(chainId);
  const stored = await new Promise<unknown>((resolve) => chrome.storage.local.get(key, (items) => resolve(items[key])));
  return Array.isArray(stored) ? stored.filter(isTracked) : [];
}

async function writeTrackedTokens(chainId: number, tokens: TrackedToken[]): Promise<void> {
  const deduped = new Map<string, TrackedToken>();
  for (const token of tokens) deduped.set(token.address.toLowerCase(), token);
  await chrome.storage.local.set({ [storageKey(chainId)]: [...deduped.values()] });
}

/** Adds a token by contract address after reading its metadata on chain. */
export async function addCustomToken(chainId: number, address: string): Promise<TrackedToken> {
  const trimmed = address.trim();
  if (!isValidEvmAddress(trimmed)) throw new Error("Enter a valid token contract address.");
  const normalized = normalizeEvmAddress(trimmed) as Hex;
  const metadata = await readErc20Metadata(normalized, { chainId });
  const current = await listTrackedTokens(chainId);
  const existing = current.find((token) => token.address.toLowerCase() === normalized.toLowerCase());
  const token: TrackedToken = {
    ...metadata,
    chainId,
    source: existing?.source ?? "custom",
    hidden: false,
    addedAt: existing?.addedAt ?? new Date().toISOString(),
  };
  await writeTrackedTokens(chainId, [...current.filter((t) => t.address.toLowerCase() !== normalized.toLowerCase()), token]);
  return token;
}

export async function setTrackedTokenHidden(chainId: number, address: Hex, hidden: boolean): Promise<void> {
  const current = await listTrackedTokens(chainId);
  await writeTrackedTokens(
    chainId,
    current.map((token) => (token.address.toLowerCase() === address.toLowerCase() ? { ...token, hidden } : token)),
  );
}

export async function removeTrackedToken(chainId: number, address: Hex): Promise<void> {
  const current = await listTrackedTokens(chainId);
  await writeTrackedTokens(
    chainId,
    current.filter((token) => token.address.toLowerCase() !== address.toLowerCase()),
  );
}

/** Live balances for every tracked token (hidden ones included; callers filter). */
export async function readTrackedTokenBalances(chainId: number, owner: Hex): Promise<TrackedTokenBalance[]> {
  const tokens = await listTrackedTokens(chainId);
  if (tokens.length === 0) return [];
  const balances = await readErc20Balances(tokens, owner, { chainId });
  return tokens.map((token, index) => ({
    ...token,
    balance: balances[index]?.balance ?? 0n,
    error: balances[index]?.error,
  }));
}

/**
 * Asks the indexer which ERC-20 contracts touched `owner`, reads metadata for the new ones and
 * tracks them as "discovered". Returns the newly added tokens. Tokens the user removed earlier
 * are re-added only if the indexer still lists them; hidden ones stay hidden.
 */
export async function discoverTrackedTokens(chainId: number, owner: Hex): Promise<TrackedToken[]> {
  const assets = await discoverIndexedAssets(owner, defaultMinervaIndexerUrl(chainId));
  const current = await listTrackedTokens(chainId);
  const known = new Set(current.map((token) => token.address.toLowerCase()));
  const candidates = assets.erc20.filter((item) => !known.has(item.contract.toLowerCase()));
  if (candidates.length === 0) return [];
  const metadata = await Promise.allSettled(candidates.map((item) => readErc20Metadata(item.contract, { chainId })));
  const added: TrackedToken[] = [];
  metadata.forEach((result) => {
    if (result.status !== "fulfilled") return;
    added.push({ ...result.value, chainId, source: "discovered", hidden: false, addedAt: new Date().toISOString() });
  });
  if (added.length > 0) await writeTrackedTokens(chainId, [...current, ...added]);
  return added;
}
