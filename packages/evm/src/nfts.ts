/**
 * ERC-721 / ERC-1155 reads, metadata resolution and transfer calldata.
 */
import { createPublicClient, encodeFunctionData, getAddress, http, parseAbi, type Hex } from "viem";
import { chainConfig, supportedChainId, type EvmReadConfig } from "./index";

export const ERC721_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function transferFrom(address from, address to, uint256 tokenId)",
]);

export const ERC1155_ABI = parseAbi([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])",
  "function uri(uint256 id) view returns (string)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
]);

export const ERC721_INTERFACE_ID = "0x80ac58cd" as const;
export const ERC721_ENUMERABLE_INTERFACE_ID = "0x780e9d63" as const;
export const ERC1155_INTERFACE_ID = "0xd9b67a26" as const;

export type NftStandard = "erc721" | "erc1155";

export interface NftCollection {
  address: Hex;
  standard: NftStandard;
  name: string;
  symbol: string;
}

export interface NftItem {
  collection: Hex;
  standard: NftStandard;
  tokenId: string;
  /** ERC-1155 balance; always "1" for ERC-721. */
  amount: string;
  name?: string;
  description?: string;
  image?: string;
  tokenUri?: string;
}

function publicClient(config: EvmReadConfig) {
  const chainId = supportedChainId(config.chainId);
  const chain = chainConfig(chainId);
  return createPublicClient({ chain, transport: http(config.rpcUrl ?? chain.rpcUrls.default.http[0]) });
}

export async function detectNftStandard(address: Hex, config: EvmReadConfig = {}): Promise<NftStandard | undefined> {
  const client = publicClient(config);
  const contract = getAddress(address) as Hex;
  const code = await client.getCode({ address: contract });
  if (!code || code === "0x") throw new Error("No contract at this address on the selected network.");
  const supports = async (id: Hex) =>
    client.readContract({ address: contract, abi: ERC721_ABI, functionName: "supportsInterface", args: [id] }).catch(() => false);
  if (await supports(ERC1155_INTERFACE_ID)) return "erc1155";
  if (await supports(ERC721_INTERFACE_ID)) return "erc721";
  // Tokens without ERC-165: assume 721 when ownerOf(0/1) answers.
  const ownerOfAnswers = await client
    .readContract({ address: contract, abi: ERC721_ABI, functionName: "ownerOf", args: [1n] })
    .then(() => true)
    .catch((error: unknown) => !/function.*not found|reverted/i.test(error instanceof Error ? error.message : ""));
  return ownerOfAnswers ? "erc721" : undefined;
}

export async function readNftCollection(address: Hex, config: EvmReadConfig = {}): Promise<NftCollection> {
  const standard = await detectNftStandard(address, config);
  if (!standard) throw new Error("Contract is neither ERC-721 nor ERC-1155.");
  const client = publicClient(config);
  const contract = getAddress(address) as Hex;
  const [name, symbol] = await Promise.all([
    client.readContract({ address: contract, abi: ERC721_ABI, functionName: "name" }).catch(() => ""),
    client.readContract({ address: contract, abi: ERC721_ABI, functionName: "symbol" }).catch(() => ""),
  ]);
  return { address: contract, standard, name: name || "Collection", symbol: symbol || "" };
}

/** Owned ERC-721 ids via ERC-721Enumerable; empty when the collection is not enumerable. */
export async function readErc721OwnedTokenIds(collection: Hex, owner: Hex, config: EvmReadConfig = {}, limit = 50): Promise<string[]> {
  const client = publicClient(config);
  const contract = getAddress(collection) as Hex;
  const account = getAddress(owner) as Hex;
  const balance = await client.readContract({ address: contract, abi: ERC721_ABI, functionName: "balanceOf", args: [account] });
  const count = Number(balance > BigInt(limit) ? BigInt(limit) : balance);
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    try {
      const id = await client.readContract({
        address: contract,
        abi: ERC721_ABI,
        functionName: "tokenOfOwnerByIndex",
        args: [account, BigInt(index)],
      });
      ids.push(id.toString());
    } catch {
      break;
    }
  }
  return ids;
}

/** Confirms which candidate ids the owner still holds (ERC-721 ownerOf / ERC-1155 balanceOf). */
export async function filterOwnedTokenIds(
  collection: Hex,
  standard: NftStandard,
  owner: Hex,
  candidateIds: readonly string[],
  config: EvmReadConfig = {},
): Promise<Array<{ tokenId: string; amount: bigint }>> {
  const client = publicClient(config);
  const contract = getAddress(collection) as Hex;
  const account = getAddress(owner) as Hex;
  const ids = [...new Set(candidateIds)];
  if (standard === "erc1155") {
    const balances = await client.readContract({
      address: contract,
      abi: ERC1155_ABI,
      functionName: "balanceOfBatch",
      args: [ids.map(() => account), ids.map((id) => BigInt(id))],
    });
    return ids.map((tokenId, index) => ({ tokenId, amount: balances[index] ?? 0n })).filter((item) => item.amount > 0n);
  }
  const owners = await Promise.allSettled(
    ids.map((id) => client.readContract({ address: contract, abi: ERC721_ABI, functionName: "ownerOf", args: [BigInt(id)] })),
  );
  return ids
    .filter((_, index) => {
      const result = owners[index];
      return result !== undefined && result.status === "fulfilled" && result.value.toLowerCase() === account.toLowerCase();
    })
    .map((tokenId) => ({ tokenId, amount: 1n }));
}

export async function readTokenUri(collection: Hex, standard: NftStandard, tokenId: string, config: EvmReadConfig = {}): Promise<string | undefined> {
  const client = publicClient(config);
  const contract = getAddress(collection) as Hex;
  try {
    if (standard === "erc1155") {
      const uri = await client.readContract({ address: contract, abi: ERC1155_ABI, functionName: "uri", args: [BigInt(tokenId)] });
      return uri.replace(/\{id\}/g, BigInt(tokenId).toString(16).padStart(64, "0"));
    }
    return await client.readContract({ address: contract, abi: ERC721_ABI, functionName: "tokenURI", args: [BigInt(tokenId)] });
  } catch {
    return undefined;
  }
}

export const DEFAULT_IPFS_GATEWAY = "https://ipfs.io/ipfs/";

/** Rewrites ipfs:// and ar:// URIs to HTTPS gateways; leaves http(s) and data: URIs untouched. */
export function resolveAssetUri(uri: string | undefined, ipfsGateway = DEFAULT_IPFS_GATEWAY): string | undefined {
  if (!uri) return undefined;
  if (uri.startsWith("ipfs://")) return `${ipfsGateway}${uri.slice("ipfs://".length).replace(/^ipfs\//, "")}`;
  if (uri.startsWith("ar://")) return `https://arweave.net/${uri.slice("ar://".length)}`;
  return uri;
}

export interface NftMetadata {
  name?: string;
  description?: string;
  image?: string;
  attributes?: Array<{ trait_type?: string; value?: unknown }>;
}

function decodeBase64(value: string): string {
  const atobImpl = (globalThis as { atob?: (s: string) => string }).atob;
  if (atobImpl) return atobImpl(value);
  const bufferCtor = (globalThis as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } }).Buffer;
  if (bufferCtor) return bufferCtor.from(value, "base64").toString("utf8");
  throw new Error("No base64 decoder available");
}

/** Fetches and normalises token metadata JSON (http, ipfs or inline data: URIs). */
export async function readNftMetadata(tokenUri: string | undefined, options: { ipfsGateway?: string; timeoutMs?: number } = {}): Promise<NftMetadata | undefined> {
  const resolved = resolveAssetUri(tokenUri, options.ipfsGateway);
  if (!resolved) return undefined;
  let raw: string;
  if (resolved.startsWith("data:")) {
    const comma = resolved.indexOf(",");
    const header = resolved.slice(5, comma);
    const body = resolved.slice(comma + 1);
    raw = header.endsWith(";base64") ? decodeBase64(body) : decodeURIComponent(body);
  } else {
    const controller = typeof AbortController === "function" ? new AbortController() : undefined;
    const timer = setTimeout(() => controller?.abort(), options.timeoutMs ?? 10000);
    try {
      const response = await fetch(resolved, { signal: controller?.signal });
      if (!response.ok) return undefined;
      raw = await response.text();
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    const parsed = JSON.parse(raw) as NftMetadata;
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
      image: resolveAssetUri(typeof parsed.image === "string" ? parsed.image : undefined, options.ipfsGateway),
      attributes: Array.isArray(parsed.attributes) ? parsed.attributes : undefined,
    };
  } catch {
    return undefined;
  }
}

export function encodeErc721Transfer(from: Hex, to: Hex, tokenId: string): Hex {
  return encodeFunctionData({
    abi: ERC721_ABI,
    functionName: "safeTransferFrom",
    args: [getAddress(from) as Hex, getAddress(to) as Hex, BigInt(tokenId)],
  });
}

export function encodeErc1155Transfer(from: Hex, to: Hex, tokenId: string, amount: bigint): Hex {
  return encodeFunctionData({
    abi: ERC1155_ABI,
    functionName: "safeTransferFrom",
    args: [getAddress(from) as Hex, getAddress(to) as Hex, BigInt(tokenId), amount, "0x"],
  });
}

/** Decodes ERC-721 safeTransferFrom/transferFrom(address,address,uint256) calldata. */
export function decodeErc721Transfer(data: Hex): { from: Hex; to: Hex; tokenId: bigint } | undefined {
  if (!/^0x(42842e0e|23b872dd)[0-9a-fA-F]{192}$/.test(data)) return undefined;
  return {
    from: getAddress(`0x${data.slice(34, 74)}`) as Hex,
    to: getAddress(`0x${data.slice(98, 138)}`) as Hex,
    tokenId: BigInt(`0x${data.slice(138, 202)}`),
  };
}
