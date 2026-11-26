import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Hex } from "@minerva/core";
import {
  KNOWN_NFT_COLLECTIONS,
  discoverIndexedAssets,
  filterOwnedTokenIds,
  isValidEvmAddress,
  normalizeEvmAddress,
  readErc721OwnedTokenIds,
  readNftCollection,
  readNftMetadata,
  readTokenUri,
  type EvmReadConfig,
  type NftCollection,
  type NftItem,
} from "@minerva/evm";
import { emitWalletChange } from "@/lib/walletEvents";

const STORAGE_PREFIX = "minerva.wallet.nft-collections.v1";
const MAX_ITEMS_PER_COLLECTION = 24;

export interface TrackedCollection extends NftCollection {
  chainId: number;
  source: "custom" | "discovered";
  addedAt: string;
}

function storageKey(chainId: number) {
  return `${STORAGE_PREFIX}.${chainId}`;
}

function defaultCollections(chainId: number): TrackedCollection[] {
  return (KNOWN_NFT_COLLECTIONS[chainId] ?? []).map((c) => ({ ...c, chainId, source: "discovered" as const, addedAt: "2026-11-07T00:00:00.000Z" }));
}

export async function listTrackedCollections(chainId: number): Promise<TrackedCollection[]> {
  const raw = await AsyncStorage.getItem(storageKey(chainId));
  if (!raw) {
    const defaults = defaultCollections(chainId);
    if (defaults.length > 0) await writeCollections(chainId, defaults);
    return defaults;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TrackedCollection[]).filter((c) => typeof c?.address === "string") : [];
  } catch {
    return [];
  }
}

async function writeCollections(chainId: number, collections: TrackedCollection[]) {
  const deduped = new Map<string, TrackedCollection>();
  for (const c of collections) deduped.set(c.address.toLowerCase(), c);
  await AsyncStorage.setItem(storageKey(chainId), JSON.stringify([...deduped.values()]));
}

export async function addCollection(chainId: number, address: string, config: EvmReadConfig): Promise<TrackedCollection> {
  if (!isValidEvmAddress(address.trim())) throw new Error("Enter a valid collection contract address.");
  const normalized = normalizeEvmAddress(address.trim()) as Hex;
  const collection = await readNftCollection(normalized, { ...config, chainId });
  const current = await listTrackedCollections(chainId);
  const tracked: TrackedCollection = { ...collection, chainId, source: "custom", addedAt: new Date().toISOString() };
  await writeCollections(chainId, [...current.filter((c) => c.address.toLowerCase() !== normalized.toLowerCase()), tracked]);
  emitWalletChange();
  return tracked;
}

export async function removeCollection(chainId: number, address: Hex): Promise<void> {
  const current = await listTrackedCollections(chainId);
  await writeCollections(
    chainId,
    current.filter((c) => c.address.toLowerCase() !== address.toLowerCase()),
  );
  emitWalletChange();
}

/** Candidate token ids per collection, remembered from indexer transfers for the session. */
const candidateIds = new Map<string, string[]>();

function candidateKey(chainId: number, collection: Hex) {
  return `${chainId}:${collection.toLowerCase()}`;
}

/** Adds collections the indexer has seen moving items to or from `owner`; remembers their token ids. */
export async function discoverCollections(chainId: number, owner: Hex, indexerUrl: string | undefined, config: EvmReadConfig): Promise<TrackedCollection[]> {
  const current = await listTrackedCollections(chainId);
  if (!indexerUrl) return current;
  let assets;
  try {
    assets = await discoverIndexedAssets(owner, indexerUrl);
  } catch {
    return current;
  }
  const seen = [...assets.erc721, ...assets.erc1155];
  for (const asset of seen) {
    if (asset.tokenIds?.length) candidateIds.set(candidateKey(chainId, asset.contract), asset.tokenIds);
  }
  const known = new Set(current.map((c) => c.address.toLowerCase()));
  const additions: TrackedCollection[] = [];
  for (const asset of seen) {
    if (known.has(asset.contract.toLowerCase())) continue;
    try {
      const collection = await readNftCollection(asset.contract, { ...config, chainId });
      additions.push({ ...collection, chainId, source: "discovered", addedAt: new Date().toISOString() });
    } catch {
      // unreadable contract; skip
    }
  }
  if (additions.length === 0) return current;
  const next = [...current, ...additions];
  await writeCollections(chainId, next);
  emitWalletChange();
  return next;
}

/** Items the owner currently holds across the tracked collections, with metadata when reachable. */
export async function loadOwnedItems(
  chainId: number,
  owner: Hex,
  collections: readonly TrackedCollection[],
  config: EvmReadConfig,
): Promise<NftItem[]> {
  const items: NftItem[] = [];
  for (const collection of collections) {
    const readConfig = { ...config, chainId };
    let ids: string[] = [];
    if (collection.standard === "erc721") {
      ids = await readErc721OwnedTokenIds(collection.address, owner, readConfig, MAX_ITEMS_PER_COLLECTION).catch(() => []);
    }
    const candidates = candidateIds.get(candidateKey(chainId, collection.address)) ?? [];
    const union = [...new Set([...ids, ...candidates])].slice(-MAX_ITEMS_PER_COLLECTION);
    if (union.length === 0) continue;
    const owned = await filterOwnedTokenIds(collection.address, collection.standard, owner, union, readConfig).catch(() => []);
    const enriched = await Promise.all(
      owned.map(async ({ tokenId, amount }) => {
        const tokenUri = await readTokenUri(collection.address, collection.standard, tokenId, readConfig);
        const metadata = await readNftMetadata(tokenUri);
        const item: NftItem = {
          collection: collection.address,
          standard: collection.standard,
          tokenId,
          amount: amount.toString(),
          name: metadata?.name ?? `${collection.name} #${tokenId}`,
          description: metadata?.description,
          image: metadata?.image,
          tokenUri,
        };
        return item;
      }),
    );
    items.push(...enriched);
  }
  return items;
}
