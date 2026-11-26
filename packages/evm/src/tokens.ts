/**
 * ERC-20 reads and calldata builders. Pure viem; no wallet state.
 */
import { createPublicClient, encodeFunctionData, getAddress, hexToString, http, parseAbi, type Hex } from "viem";
import { chainConfig, supportedChainId, type EvmReadConfig } from "./index";

export const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
]);

/** keccak256("Transfer(address,address,uint256)") — shared by ERC-20 and ERC-721. */
export const TRANSFER_EVENT_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

export interface Erc20Metadata {
  address: Hex;
  name: string;
  symbol: string;
  decimals: number;
}

export interface Erc20Balance extends Erc20Metadata {
  balance: bigint;
}

function publicClient(config: EvmReadConfig) {
  const chainId = supportedChainId(config.chainId);
  const chain = chainConfig(chainId);
  return createPublicClient({ chain, transport: http(config.rpcUrl ?? chain.rpcUrls.default.http[0]) });
}

/** Some old tokens return bytes32 for name/symbol; decode both shapes. */
function decodeStringish(value: unknown): string {
  if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]{64}$/.test(value)) return hexToString(value as Hex).replace(/\0+$/, "");
    return value;
  }
  return "";
}

export async function readErc20Metadata(address: Hex, config: EvmReadConfig = {}): Promise<Erc20Metadata> {
  const client = publicClient(config);
  const token = getAddress(address) as Hex;
  const code = await client.getCode({ address: token });
  if (!code || code === "0x") throw new Error("No contract at this address on the selected network.");
  const [name, symbol, decimals] = await Promise.all([
    client.readContract({ address: token, abi: ERC20_ABI, functionName: "name" }).catch(() => ""),
    client.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }).catch(() => ""),
    client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }).catch(() => undefined),
  ]);
  if (decimals === undefined) throw new Error("Contract does not expose decimals(); it is not an ERC-20 token.");
  return {
    address: token,
    name: decodeStringish(name) || "Unknown token",
    symbol: decodeStringish(symbol) || "TOKEN",
    decimals: Number(decimals),
  };
}

export async function readErc20Balance(token: Hex, owner: Hex, config: EvmReadConfig = {}): Promise<bigint> {
  const client = publicClient(config);
  return client.readContract({
    address: getAddress(token) as Hex,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [getAddress(owner) as Hex],
  });
}

/** Balances for many tokens; a token whose read fails reports balance 0n and `error`. */
export async function readErc20Balances(
  tokens: readonly Erc20Metadata[],
  owner: Hex,
  config: EvmReadConfig = {},
): Promise<Array<Erc20Balance & { error?: string }>> {
  const results = await Promise.allSettled(tokens.map((token) => readErc20Balance(token.address, owner, config)));
  return tokens.map((token, index) => {
    const result = results[index];
    if (result && result.status === "fulfilled") return { ...token, balance: result.value };
    const reason = result && result.status === "rejected" ? result.reason : undefined;
    return { ...token, balance: 0n, error: reason instanceof Error ? reason.message : String(reason ?? "unknown error") };
  });
}

export async function readErc20Allowance(token: Hex, owner: Hex, spender: Hex, config: EvmReadConfig = {}): Promise<bigint> {
  const client = publicClient(config);
  return client.readContract({
    address: getAddress(token) as Hex,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [getAddress(owner) as Hex, getAddress(spender) as Hex],
  });
}

export function encodeErc20Transfer(to: Hex, amount: bigint): Hex {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [getAddress(to) as Hex, amount] });
}

export function encodeErc20Approve(spender: Hex, amount: bigint): Hex {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [getAddress(spender) as Hex, amount] });
}

/** Decodes transfer(address,uint256) calldata; undefined for anything else. */
export function decodeErc20Transfer(data: Hex): { to: Hex; amount: bigint } | undefined {
  if (!/^0xa9059cbb[0-9a-fA-F]{128}$/.test(data)) return undefined;
  return { to: getAddress(`0x${data.slice(34, 74)}`) as Hex, amount: BigInt(`0x${data.slice(74, 138)}`) };
}

/** Decodes transferFrom(address,address,uint256) calldata. */
export function decodeErc20TransferFrom(data: Hex): { from: Hex; to: Hex; amount: bigint } | undefined {
  if (!/^0x23b872dd[0-9a-fA-F]{192}$/.test(data)) return undefined;
  return {
    from: getAddress(`0x${data.slice(34, 74)}`) as Hex,
    to: getAddress(`0x${data.slice(98, 138)}`) as Hex,
    amount: BigInt(`0x${data.slice(138, 202)}`),
  };
}

/** Parses a decimal string into token base units. Throws on malformed input. */
export function parseTokenAmount(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === "" || trimmed === ".") throw new Error("Enter a decimal amount.");
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) throw new Error(`This token supports at most ${decimals} decimal places.`);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function formatTokenUnits(amount: bigint, decimals: number, maxFractionDigits = 6): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let fraction = (abs % base).toString().padStart(decimals, "0").slice(0, maxFractionDigits).replace(/0+$/, "");
  if (decimals === 0) fraction = "";
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

// ------------------------------------------------------------------ known assets

/** Tokens the wallet lists by default per chain (testnet assets deployed from the treasury). */
export const KNOWN_ERC20_TOKENS: Record<number, Erc20Metadata[]> = {
  77138: [{ address: "0x411F287585f9aeaCfA1A03A229662e89B2e5B6f1" as Hex, name: "Minerva Test Token", symbol: "MTT", decimals: 18 }],
};

/** NFT collections the wallet tracks by default per chain. */
export const KNOWN_NFT_COLLECTIONS: Record<number, { address: Hex; standard: "erc721" | "erc1155"; name: string; symbol: string }[]> = {
  77138: [{ address: "0xa3cb144C854317C247611dF08B8970792e521956" as Hex, standard: "erc721", name: "Minerva Test Collectible", symbol: "MTC" }],
};

// ------------------------------------------------------------------ indexer discovery

export interface IndexedAssetContract {
  contract: Hex;
  standard: "erc20" | "erc721" | "erc1155";
  transferCount: number;
  lastBlock: number;
  /** Token ids seen moving to or from the address (ERC-721 / ERC-1155 only, most recent last). */
  tokenIds?: string[];
}

export interface IndexedAddressAssets {
  address: Hex;
  erc20: IndexedAssetContract[];
  erc721: IndexedAssetContract[];
  erc1155: IndexedAssetContract[];
  indexedAt?: string;
}

/** Asks the public indexer which token contracts have ever moved assets to or from `owner`. */
export async function discoverIndexedAssets(owner: Hex, indexerUrl: string): Promise<IndexedAddressAssets> {
  const base = indexerUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/address/${getAddress(owner)}/assets`);
  if (!response.ok) throw new Error(`Indexer answered HTTP ${response.status}`);
  const payload = (await response.json()) as Partial<IndexedAddressAssets>;
  const normalize = (items?: IndexedAssetContract[]) =>
    (items ?? [])
      .filter((item) => typeof item?.contract === "string" && /^0x[0-9a-fA-F]{40}$/.test(item.contract))
      .map((item) => ({ ...item, contract: getAddress(item.contract) as Hex }));
  return {
    address: getAddress(owner) as Hex,
    erc20: normalize(payload.erc20),
    erc721: normalize(payload.erc721),
    erc1155: normalize(payload.erc1155),
    indexedAt: payload.indexedAt,
  };
}
