import type { Chain } from "viem";
/**
 * @minerva/evm
 *
 * viem helpers, address formatting, transaction decoding, chain config.
 * Minerva wallet runtime is Minerva-network-only; external EVM chains stay
 * out until their account-control path is PQ-native.
 */
import {
  concatHex,
  createPublicClient,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  formatEther,
  formatUnits,
  http,
  isAddress,
  keccak256,
  numberToHex,
  parseUnits,
  parseAbi,
  stringToHex,
  toRlp,
  toFunctionSelector,
} from "viem";
import type { Hex } from "@minerva/core";
import {
  createPQAccount as sdkCreatePQAccount,
  createMinervaClient as sdkCreateMinervaClient,
  defaultMinervaRpcUrl as sdkDefaultMinervaRpcUrl,
  deriveMinervaPQAccountAddress as sdkDeriveMinervaPQAccountAddress,
  getAccountReadiness as sdkGetAccountReadiness,
  getAccountSecurityMode as sdkGetAccountSecurityMode,
  getMrvBalance as sdkGetMrvBalance,
  getSmartAccountDeploymentState as sdkGetSmartAccountDeploymentState,
  generateMLDSA65KeyPair as sdkGenerateMLDSA65KeyPair,
  hashMinervaPQTxV1 as sdkHashMinervaPQTxV1,
  minervaDevnet as sdkMinervaDevnet,
  minervaTestnet as sdkMinervaTestnet,
  sendPQTransaction as sdkSendPQTransaction,
  resolvePolicyVersion as sdkResolvePolicyVersion,
  sendRawMinervaPQTxV1 as sdkSendRawMinervaPQTxV1,
  serializeMinervaPQTxV1 as sdkSerializeMinervaPQTxV1,
  signMLDSA65 as sdkSignMLDSA65,
  signPQTransaction as sdkSignPQTransaction,
  signMinervaPQTxV1 as sdkSignMinervaPQTxV1,
  MINERVA_ACCOUNT_FACTORY as SDK_MINERVA_ACCOUNT_FACTORY,
  MINERVA_ACCOUNT_READINESS_REGISTRY as SDK_MINERVA_ACCOUNT_READINESS_REGISTRY,
  MINERVA_MLDSA65_PRECOMPILE as SDK_MINERVA_MLDSA65_PRECOMPILE,
  MINERVA_SECURITY_MODE_REGISTRY as SDK_MINERVA_SECURITY_MODE_REGISTRY,
  MINERVA_TESTNET_EXPLORER_URL as SDK_MINERVA_TESTNET_EXPLORER_URL,
  MINERVA_TESTNET_FAUCET_URL as SDK_MINERVA_TESTNET_FAUCET_URL,
  MINERVA_TESTNET_RPC_URL as SDK_MINERVA_TESTNET_RPC_URL,
  MINERVA_TESTNET_PQ_RELAYER_URL as SDK_MINERVA_TESTNET_PQ_RELAYER_URL,
  ML_DSA_65_PUBLIC_KEY_BYTES,
  ML_DSA_65_SIGNATURE_BYTES,
  MINERVA_PQ_ACCOUNT_DOMAIN as SDK_MINERVA_PQ_ACCOUNT_DOMAIN,
  MINERVA_PQ_TX_CONTEXT as SDK_MINERVA_PQ_TX_CONTEXT,
  MINERVA_PQ_TX_TYPE as SDK_MINERVA_PQ_TX_TYPE,
  MINERVA_PQ_TX_TYPE_HEX as SDK_MINERVA_PQ_TX_TYPE_HEX,
  MINERVA_ZERO_HASH as SDK_MINERVA_ZERO_HASH,
  type CreatePQAccountOptions,
  type MLDSA65KeyPair,
  type MinervaClient,
  type MinervaNetworkConfig,
  type MinervaPQAccessListEntry as SdkMinervaPQAccessListEntry,
  type MinervaPQTxV1SignRequest as SdkMinervaPQTxV1SignRequest,
  type MinervaPQTxV1SignResult as SdkMinervaPQTxV1SignResult,
  type MinervaPQTxV1Signed as SdkMinervaPQTxV1Signed,
  type MinervaPQTxV1Unsigned as SdkMinervaPQTxV1Unsigned,
  type SendPQTransactionRequest,
  type SendPQTransactionResult,
} from "@minerva/sdk";
import {
  enrollMinervaDeviceKey,
  readMinervaDeviceKey,
  readMinervaPQEnrollAuthorization,
  readMinervaPQRevokeAuthorization,
  revokeMinervaDeviceKey,
  sendMinervaNativeCall,
} from "@minerva/sdk";
import { MINERVA_ACCOUNT_CREATION_CODE } from "./system-contracts";
import { getChainDefinition, isKnownChainId, type MinervaChainDefinition } from "./networks";

export {
  MINERVA_ACCOUNT_CREATION_CODE,
} from "./system-contracts";

// The wallet's devnet is the local Minerva devnet (chain 77137); the public
// Minerva testnet is chain 77138 (testnet.minervachain.org).
export const MINERVA_DEVNET_CHAIN_ID = sdkMinervaDevnet.chainId;
export const MINERVA_TESTNET_CHAIN_ID = sdkMinervaTestnet.chainId;
export const MINERVA_DEVNET_RPC_URL = sdkMinervaDevnet.rpcUrls[0] ?? "http://127.0.0.1:18545/rpc";
export const MINERVA_DEVNET_NODE_RPC_URL = sdkMinervaDevnet.rpcUrls[1] ?? "http://127.0.0.1:8545";
export const MINERVA_DEVNET_FAUCET_URL = sdkMinervaDevnet.faucetUrls[0] ?? "http://127.0.0.1:18546";
export const MINERVA_DEVNET_PQ_RELAYER_URL = MINERVA_DEVNET_FAUCET_URL;
export const MINERVA_TESTNET_RPC_URL = SDK_MINERVA_TESTNET_RPC_URL;
export const MINERVA_TESTNET_FAUCET_URL = SDK_MINERVA_TESTNET_FAUCET_URL;
export const MINERVA_TESTNET_EXPLORER_URL = SDK_MINERVA_TESTNET_EXPLORER_URL;
export const MINERVA_TESTNET_PQ_RELAYER_URL = SDK_MINERVA_TESTNET_PQ_RELAYER_URL;
export const MINERVA_DEVNET_INDEXER_URL = "http://127.0.0.1:18549";
export const MINERVA_TESTNET_INDEXER_URL = "https://testnet.minervachain.org/api/indexer";
export const MINERVA_ACCOUNT_FACTORY = SDK_MINERVA_ACCOUNT_FACTORY;
export const MINERVA_ACCOUNT_READINESS_REGISTRY = SDK_MINERVA_ACCOUNT_READINESS_REGISTRY;
export const MINERVA_MLDSA65_PRECOMPILE = SDK_MINERVA_MLDSA65_PRECOMPILE;
export const MINERVA_SECURITY_MODE_REGISTRY = SDK_MINERVA_SECURITY_MODE_REGISTRY;
export const MINERVA_PQ_TX_TYPE = SDK_MINERVA_PQ_TX_TYPE;
export const MINERVA_PQ_TX_TYPE_HEX = SDK_MINERVA_PQ_TX_TYPE_HEX;
export const MINERVA_PQ_TX_CONTEXT = SDK_MINERVA_PQ_TX_CONTEXT;
export const MINERVA_PQ_ACCOUNT_DOMAIN = SDK_MINERVA_PQ_ACCOUNT_DOMAIN;
export const MINERVA_ZERO_HASH = SDK_MINERVA_ZERO_HASH;

export const minervaDevnetNetwork = sdkMinervaDevnet;
export const minervaTestnetNetwork = sdkMinervaTestnet;
export const createMinervaClient = sdkCreateMinervaClient;
export const createPQAccount = sdkCreatePQAccount;
export const signPQTransaction = sdkSignPQTransaction;
export const sendPQTransaction = sdkSendPQTransaction;
export const getMrvBalance = sdkGetMrvBalance;
export const getAccountSecurityMode = sdkGetAccountSecurityMode;
export const getAccountReadiness = sdkGetAccountReadiness;
export const getSmartAccountDeploymentState = sdkGetSmartAccountDeploymentState;
export const generateMLDSA65KeyPair = sdkGenerateMLDSA65KeyPair;
export const signMLDSA65 = sdkSignMLDSA65;

export function signMinervaPQAccountAuthorization(message: Hex | Uint8Array, privateKey: Hex | Uint8Array): Hex {
  return sdkSignMLDSA65(message, privateKey, { context: MINERVA_PQ_ACCOUNT_DOMAIN });
}

export type {
  CreatePQAccountOptions,
  MLDSA65KeyPair,
  MinervaClient,
  MinervaNetworkConfig,
  SendPQTransactionRequest,
  SendPQTransactionResult,
};

function defineViemMinervaChain(config: MinervaNetworkConfig): Chain {
  // Networks announced ahead of launch (the Minerva testnet) have no public URL yet.
  let rpcUrl: string;
  try {
    rpcUrl = sdkDefaultMinervaRpcUrl(config);
  } catch {
    rpcUrl = config.rpcUrls[0] ?? "http://127.0.0.1:8545";
  }
  const explorerUrl = config.blockExplorerUrls[0];
  return defineChain({
    id: config.chainId,
    name: config.name,
    nativeCurrency: config.nativeCurrency,
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
    blockExplorers: explorerUrl
      ? {
          default: {
            name: "Minerva Explorer",
            url: explorerUrl,
          },
        }
      : undefined,
    testnet: config.chainId !== 77139,
  });
}

export const minervaDevnet = defineViemMinervaChain(sdkMinervaDevnet);
export const minervaTestnet = defineViemMinervaChain(sdkMinervaTestnet);

export const SUPPORTED_CHAINS = {
  minervaDevnet,
  minervaTestnet,
} as const;

/** Any chain id known to the runtime registry (built-in Minerva networks plus user-added ones). */
export type SupportedChainId = number;

const viemChainCache = new Map<string, Chain>();

function viemChainFromDefinition(def: MinervaChainDefinition): Chain {
  const key = `${def.chainId}:${def.rpcUrl}:${def.explorerUrl ?? ""}:${def.name}`;
  let chain = viemChainCache.get(key);
  if (!chain) {
    chain = defineChain({
      id: def.chainId,
      name: def.name,
      nativeCurrency: def.nativeCurrency,
      rpcUrls: {
        default: { http: [def.rpcUrl] },
        public: { http: [def.rpcUrl] },
      },
      blockExplorers: def.explorerUrl ? { default: { name: def.minerva ? "Minerva Explorer" : "Explorer", url: def.explorerUrl } } : undefined,
      testnet: def.testnet,
    });
    viemChainCache.set(key, chain);
  }
  return chain;
}

export function chainConfig(chainId: SupportedChainId | number | string): Chain {
  const def = getChainDefinition(chainId);
  if (!def) throw new Error(`Unsupported chain ID ${chainId}`);
  return viemChainFromDefinition(def);
}

export function minervaNetworkConfig(chainId: SupportedChainId | number | string = MINERVA_DEVNET_CHAIN_ID): MinervaNetworkConfig {
  const id = supportedChainId(chainId);
  if (id === MINERVA_TESTNET_CHAIN_ID) return sdkMinervaTestnet;
  if (id === MINERVA_DEVNET_CHAIN_ID) return sdkMinervaDevnet;
  const def = getChainDefinition(id) ?? getChainDefinition(MINERVA_DEVNET_CHAIN_ID)!;
  return {
    ...sdkMinervaTestnet,
    chainId: def.chainId,
    networkId: def.chainId,
    name: def.name,
    shortName: def.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    rpcUrls: [def.rpcUrl],
    faucetUrls: def.faucetUrl ? [def.faucetUrl] : [],
    blockExplorerUrls: def.explorerUrl ? [def.explorerUrl] : [],
    nativeCurrency: def.nativeCurrency,
  };
}

/** Resolves any value to a registered chain id, falling back to the devnet id. */
export function supportedChainId(value?: number | string): SupportedChainId {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (parsed !== undefined && Number.isFinite(parsed) && isKnownChainId(parsed)) return parsed;
  return minervaDevnet.id;
}

export function defaultMinervaRpcUrl(chainId: SupportedChainId | number | string = MINERVA_DEVNET_CHAIN_ID): string {
  return getChainDefinition(supportedChainId(chainId))?.rpcUrl ?? MINERVA_DEVNET_RPC_URL;
}

export function defaultMinervaFaucetUrl(chainId: SupportedChainId | number | string = MINERVA_DEVNET_CHAIN_ID): string {
  return getChainDefinition(supportedChainId(chainId))?.faucetUrl ?? MINERVA_DEVNET_FAUCET_URL;
}

export function defaultMinervaPQRelayerUrl(chainId: SupportedChainId | number | string = MINERVA_DEVNET_CHAIN_ID): string {
  const def = getChainDefinition(supportedChainId(chainId));
  return def?.pqRelayerUrl ?? def?.faucetUrl ?? MINERVA_DEVNET_PQ_RELAYER_URL;
}

export function defaultMinervaIndexerUrl(chainId: SupportedChainId | number | string = MINERVA_DEVNET_CHAIN_ID): string {
  return getChainDefinition(supportedChainId(chainId))?.indexerUrl ?? MINERVA_DEVNET_INDEXER_URL;
}

export function explorerTxUrl(hash: string, chainId: SupportedChainId | number | string = MINERVA_DEVNET_CHAIN_ID): string {
  const config = minervaNetworkConfig(chainId);
  const explorer = config.blockExplorerUrls[0] ?? MINERVA_TESTNET_EXPLORER_URL;
  return `${explorer.replace(/\/$/, "")}/tx/${hash}`;
}

export function explorerAddressUrl(
  address: string,
  chainId: SupportedChainId | number | string = MINERVA_TESTNET_CHAIN_ID,
): string {
  const config = minervaNetworkConfig(chainId);
  const explorer = config.blockExplorerUrls[0] ?? MINERVA_TESTNET_EXPLORER_URL;
  return `${explorer.replace(/\/$/, "")}/address/${getAddress(address)}`;
}

export function explorerProofUrl(
  path: string,
  chainId: SupportedChainId | number | string = MINERVA_TESTNET_CHAIN_ID,
): string {
  const config = minervaNetworkConfig(chainId);
  const explorer = config.blockExplorerUrls[0] ?? MINERVA_TESTNET_EXPLORER_URL;
  const normalizedPath = path.replace(/^\/+/, "");
  return `${explorer.replace(/\/$/, "")}/${normalizedPath.startsWith("proofs/") ? normalizedPath : `proofs/${normalizedPath}`}`;
}

export function formatAddress(address: Hex, lead = 6, trail = 4): string {
  if (!isAddress(address)) return address;
  const checksum = getAddress(address);
  return `${checksum.slice(0, lead)}...${checksum.slice(-trail)}`;
}

export function formatBalanceWei(wei: bigint, decimals = 4): string {
  const ether = formatEther(wei);
  const num = Number(ether);
  if (Number.isNaN(num)) return ether;
  return num.toFixed(decimals);
}

export function formatNativeAmountInput(wei: bigint, decimals = 18, maxDecimals = 6): string {
  const value = formatUnits(wei < 0n ? 0n : wei, decimals);
  const [whole = "0", fraction = ""] = value.split(".");
  const trimmedFraction = fraction.slice(0, maxDecimals).replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

export function formatTokenAmount(amount: bigint, tokenDecimals: number, displayDecimals = 4): string {
  const value = formatUnits(amount, tokenDecimals);
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toFixed(displayDecimals);
}

export function isValidEvmAddress(value: string): value is Hex {
  return isAddress(value);
}

export function normalizeEvmAddress(value: string): Hex {
  if (!isAddress(value)) throw new Error("Expected a valid 0x EVM address.");
  return getAddress(value) as Hex;
}

export function parseNativeAmountToWei(value: string, decimals = 18): bigint {
  const normalized = value.trim().replace(/,/g, "");
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    throw new Error("Amount must be a positive decimal number.");
  }
  const wei = parseUnits(normalized, decimals);
  if (wei <= 0n) throw new Error("Amount must be greater than zero.");
  return wei;
}

export interface EvmReadConfig {
  chainId?: SupportedChainId | number | string;
  rpcUrl?: string;
  faucetUrl?: string;
  pqRelayerUrl?: string;
  indexerUrl?: string;
}

export interface MinervaIndexerTransaction {
  hash: Hex;
  blockNumber?: number | string;
  timestamp?: string;
  from?: Hex;
  to?: Hex;
  value?: string;
  status?: "pending" | "success" | "failed" | string;
  gasUsed?: string;
  effectiveGasPrice?: string;
  tags?: string[];
}

export interface MinervaIndexerEvent {
  id?: string;
  type?: string;
  address?: Hex;
  transactionHash?: Hex;
  blockNumber?: number | string;
  timestamp?: string;
  tags?: string[];
  decoded?: Record<string, unknown>;
}

export interface MinervaIndexedAddressActivity {
  address: Hex;
  indexedAt?: string;
  transactions?: MinervaIndexerTransaction[];
  events?: MinervaIndexerEvent[];
}

export interface MinervaSmartAccountDeploymentState {
  address: Hex;
  deployed: boolean;
  code?: Hex;
}

export interface MinervaAccountReadiness {
  address: Hex;
  accountType: string;
  securityMode: string;
  registryMode?: number;
  readiness?: {
    isMinervaAccount: boolean;
    securityMode: number;
    pqPublicKeyCommitment: Hex;
    lastKeyRotation: string;
    updatedAt: string;
  };
  pqRequired: boolean;
  ecdsaControl: boolean;
}

export interface MinervaAccountSecurityMode {
  address: Hex;
  mode: string;
  registryMode?: number;
  claim: string;
}

export interface MinervaFaucetReceipt {
  ok: boolean;
  address: Hex;
  hash: Hex;
  amountWei: string;
  createdAt: string;
  blockNumber?: string;
  signerMode?: "PQ Native";
  rawTransactionType?: "MinervaPQTxV1";
  deploymentTransactionHash?: Hex;
  deploymentBlockNumber?: string;
  deployed?: boolean;
  accountFactory?: Hex;
  explorerUrl?: string;
}

export interface MinervaDevPQAccount {
  ok: boolean;
  chainId: number;
  accountAddress: Hex;
  deployed: boolean;
  nonce: string;
  balanceWei: string;
  balanceMrv: string;
  publicKey: Hex;
  publicKeyCommitment: Hex;
  nativeTransactionNonce?: string;
  smartAccountNonce?: string;
  signerMode?: "PQ Native";
  rawTransactionType?: "MinervaPQTxV1";
  relayerAddress?: Hex;
  relayerBalanceWei?: string;
  latestBlock: string;
  salt: Hex;
}

export interface MinervaDevPQDeployReceipt {
  accountAddress: Hex;
  deployed: boolean;
  transactionHash?: Hex;
  faucetTransactionHash?: Hex;
  deploymentBlockNumber?: string;
}

export interface MinervaDevPQTransferReceipt {
  ok: boolean;
  accountAddress: Hex;
  target: Hex;
  valueWei: string;
  data: Hex;
  nonce: string;
  transactionHash: Hex;
  blockNumber: string;
  status: string;
  deploymentTransactionHash?: Hex;
  signerMode?: "PQ Native";
  rawTransactionType?: "MinervaPQTxV1";
  /** Native envelope nonce, fee caps and gas limit used; needed to speed up or cancel. */
  nativeTransactionNonce?: string;
  gasTipCap?: string;
  gasFeeCap?: string;
  gas?: string;
}

export interface MinervaDevPQAuthorization {
  accountAddress: Hex;
  target: Hex;
  valueWei: string;
  data: Hex;
  nonce: string;
  message: Hex;
}

export interface MinervaDevPQRotationAuthorization {
  accountAddress: Hex;
  newPublicKey: Hex;
  nonce: string;
  message: Hex;
}

export interface MinervaDevPQRotationReceipt {
  ok: boolean;
  accountAddress: Hex;
  newPublicKey: Hex;
  newPublicKeyCommitment: Hex;
  nonce: string;
  transactionHash: Hex;
  blockNumber: string;
  status: string;
  deploymentTransactionHash?: Hex;
  signerMode?: "PQ Native";
  rawTransactionType?: "MinervaPQTxV1";
}

export interface MinervaDevPQRawSubmitReceipt {
  ok: boolean;
  network?: string;
  chainId?: number;
  transactionHash: Hex;
  blockNumber?: string;
  status: string;
  signerMode?: "PQ Native";
  rawTransactionType?: "MinervaPQTxV1";
}

export interface AccountReadSnapshot {
  address: Hex;
  chainId: SupportedChainId;
  balanceWei: bigint;
  deployed: boolean;
  latestBlock: bigint;
  chainName: string;
  nativeCurrencySymbol: string;
  code?: Hex;
  rpcUrl?: string;
  mrv?: {
    deployment?: MinervaSmartAccountDeploymentState;
    readiness?: MinervaAccountReadiness;
    securityMode?: MinervaAccountSecurityMode;
  };
}

interface EvmPublicClient {
  getBalance: (args: { address: Hex }) => Promise<bigint>;
  getCode: (args: { address: Hex }) => Promise<Hex | undefined>;
  getBlockNumber: () => Promise<bigint>;
}

const minervaAccountAbi = parseAbi([
  "function nonce() view returns (uint256)",
  "function executeMessage(uint256 expectedNonce,address target,uint256 value,bytes data) view returns (bytes)",
  "function executePQ(address target,uint256 value,bytes data,uint256 expectedNonce,bytes signature) returns (bytes)",
  "function rotateMessage(uint256 expectedNonce,bytes newPQPublicKey) view returns (bytes)",
  "function rotatePQKey(bytes newPQPublicKey,uint256 expectedNonce,bytes signature)",
]);

// MinervaPQTxV1 encoding lives in @minerva/pq-native-tx (re-exported by @minerva/sdk); the
// wallet no longer carries its own copy. After a key rotation the transaction must name the
// account explicitly and carry the registry's policy version; the SDK dev flows do this.
export type MinervaPQNumberish = bigint | number | string;
export type MinervaPQAccessListEntry = SdkMinervaPQAccessListEntry;
export type MinervaPQTxV1Unsigned = SdkMinervaPQTxV1Unsigned;
export type MinervaPQTxV1Signed = SdkMinervaPQTxV1Signed;
export type MinervaPQTxV1SignRequest = SdkMinervaPQTxV1SignRequest;
export type MinervaPQTxV1SignResult = SdkMinervaPQTxV1SignResult;
export type MinervaPQTxV1SubmitMethod = "minerva_sendRawPQTransaction" | "minerva_sendRawPQTransaction" | "eth_sendRawTransaction";

function assertHexBytes(value: Hex, label: string, expectedBytes?: number): Hex {
  if (!/^0x[0-9a-fA-F]*$/.test(value)) throw new Error(`${label} must be 0x-prefixed hex`);
  const byteLength = (value.length - 2) / 2;
  if (!Number.isInteger(byteLength)) throw new Error(`${label} must have an even number of hex characters`);
  if (expectedBytes !== undefined && byteLength !== expectedBytes) {
    throw new Error(`${label} must be ${expectedBytes} bytes, got ${byteLength}`);
  }
  return value.toLowerCase() as Hex;
}

function quantityToBigInt(value: MinervaPQNumberish | undefined, label: string): bigint {
  if (value === undefined) return 0n;
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`${label} must be non-negative`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]+$/.test(trimmed) || /^[0-9]+$/.test(trimmed)) return BigInt(trimmed);
  throw new Error(`${label} must be a bigint, safe integer, decimal string, or hex quantity`);
}

export function deriveMinervaPQAccountAddress(publicKey: Hex, factorySalt: Hex = MINERVA_ZERO_HASH): Hex {
  return sdkDeriveMinervaPQAccountAddress(publicKey, factorySalt) as Hex;
}

export function hashMinervaPQTxV1(tx: MinervaPQTxV1Unsigned): Hex {
  return sdkHashMinervaPQTxV1(tx) as Hex;
}

export function serializeMinervaPQTxV1(tx: MinervaPQTxV1Signed): Hex {
  return sdkSerializeMinervaPQTxV1(tx) as Hex;
}

export function signMinervaPQTxV1(tx: MinervaPQTxV1SignRequest): MinervaPQTxV1SignResult {
  return sdkSignMinervaPQTxV1(tx);
}

export function createEvmPublicClient(config: EvmReadConfig = {}): EvmPublicClient {
  const chainId = supportedChainId(config.chainId);
  return createPublicClient({
    chain: chainConfig(chainId),
    transport: http(config.rpcUrl ?? defaultMinervaRpcUrl(chainId)),
  }) as unknown as EvmPublicClient;
}

export function isMinervaDevnet(chainId?: number | string): boolean {
  return Number(chainId) === MINERVA_DEVNET_CHAIN_ID;
}

export function isMinervaNetwork(chainId?: number | string): boolean {
  return getChainDefinition(chainId)?.minerva ?? false;
}

function rpcUrlForConfig(config: EvmReadConfig): string | undefined {
  if (config.rpcUrl) return config.rpcUrl;
  const chainId = supportedChainId(config.chainId);
  return chainConfig(chainId).rpcUrls.default.http[0];
}

async function jsonRpc<T>(config: EvmReadConfig, method: string, params: unknown[] = []): Promise<T> {
  const rpcUrl = rpcUrlForConfig(config);
  if (!rpcUrl) throw new Error(`No RPC URL configured for ${method}`);

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = (await response.json()) as { result?: T; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? `${method} failed`);
  return payload.result as T;
}

async function optionalJsonRpc<T>(config: EvmReadConfig, method: string, params: unknown[] = []): Promise<T | undefined> {
  try {
    return await jsonRpc<T>(config, method, params);
  } catch {
    return undefined;
  }
}

export async function sendRawMinervaPQTxV1(
  rawTransaction: Hex,
  config: EvmReadConfig = {},
  method: MinervaPQTxV1SubmitMethod = "minerva_sendRawPQTransaction",
): Promise<Hex> {
  const rpcUrl = rpcUrlForConfig(config);
  if (!rpcUrl) throw new Error(`No RPC URL configured for ${method}`);
  return sdkSendRawMinervaPQTxV1(assertHexBytes(rawTransaction, "rawTransaction"), { rpcUrl }, method) as Promise<Hex>;
}

export async function readNativeBalance(address: Hex, config: EvmReadConfig = {}): Promise<bigint> {
  const client = createEvmPublicClient(config);
  return client.getBalance({ address: getAddress(address) });
}

export interface MinervaSimulationRequest {
  from: Hex;
  to: Hex;
  valueWei: bigint;
  data?: Hex;
}

export interface MinervaSimulationResult {
  /** True when the node accepted the call (eth_call did not revert). */
  willSucceed: boolean;
  /** Decoded revert reason / node error when `willSucceed` is false. */
  revertReason?: string;
  /** Real gas units from eth_estimateGas (undefined if the call reverts). */
  gasEstimate?: bigint;
  /** Real gas price from eth_gasPrice. */
  gasPriceWei?: bigint;
  /** gasEstimate × gasPriceWei. */
  maxFeeWei?: bigint;
  /** valueWei + maxFeeWei — total native leaving `from`. */
  totalOutWei: bigint;
  /** Sender native balance before the transfer (real eth_getBalance). */
  senderBalanceBeforeWei: bigint;
  /** Projected sender balance after value + fee. */
  senderBalanceAfterWei: bigint;
  /** True when projected balance would go negative. */
  insufficientFunds: boolean;
}

function decodeHexQuantity(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !value.startsWith("0x")) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

/**
 * Real pre-flight simulation of a native MRV transfer. Performs:
 *  - eth_getBalance (sender, before)
 *  - eth_estimateGas (real gas units; a revert here is the node's real signal)
 *  - eth_call (catches reverts with the node's reason string)
 *  - eth_gasPrice (real fee math)
 * No mock data — every field comes from the configured RPC.
 */
export async function simulateMinervaTransfer(
  request: MinervaSimulationRequest,
  config: EvmReadConfig = {},
): Promise<MinervaSimulationResult> {
  const from = getAddress(request.from);
  const to = getAddress(request.to);
  const valueHex = `0x${request.valueWei.toString(16)}` as const;
  const callObject: Record<string, string> = { from, to, value: valueHex };
  if (request.data && request.data !== "0x") callObject.data = request.data;

  const senderBalanceBeforeWei = (await optionalJsonRpc<string>(config, "eth_getBalance", [from, "latest"]).then(
    (v) => decodeHexQuantity(v) ?? 0n,
  )) as bigint;

  let willSucceed = true;
  let revertReason: string | undefined;
  let gasEstimate: bigint | undefined;

  try {
    const gasHex = await jsonRpc<string>(config, "eth_estimateGas", [callObject]);
    gasEstimate = decodeHexQuantity(gasHex);
  } catch (error) {
    willSucceed = false;
    revertReason = error instanceof Error ? error.message : "Transaction would revert";
  }

  if (willSucceed) {
    try {
      await jsonRpc<string>(config, "eth_call", [callObject, "latest"]);
    } catch (error) {
      willSucceed = false;
      revertReason = error instanceof Error ? error.message : "Transaction would revert";
    }
  }

  const gasPriceWei = decodeHexQuantity(await optionalJsonRpc<string>(config, "eth_gasPrice", []));
  const maxFeeWei = gasEstimate !== undefined && gasPriceWei !== undefined ? gasEstimate * gasPriceWei : undefined;
  const totalOutWei = request.valueWei + (maxFeeWei ?? 0n);
  const senderBalanceAfterWei = senderBalanceBeforeWei - totalOutWei;

  return {
    willSucceed,
    revertReason,
    gasEstimate,
    gasPriceWei,
    maxFeeWei,
    totalOutWei,
    senderBalanceBeforeWei,
    senderBalanceAfterWei,
    insufficientFunds: senderBalanceAfterWei < 0n,
  };
}

export async function readAccountDeployment(address: Hex, config: EvmReadConfig = {}): Promise<{ deployed: boolean; code?: Hex }> {
  const client = createEvmPublicClient(config);
  const code = await client.getCode({ address: getAddress(address) });
  return { deployed: Boolean(code && code !== "0x"), code };
}

export async function readAccountSnapshot(address: Hex, config: EvmReadConfig = {}): Promise<AccountReadSnapshot> {
  const normalizedAddress = getAddress(address) as Hex;
  const chainId = supportedChainId(config.chainId);
  const client = createEvmPublicClient({ ...config, chainId });
  const [balanceWei, code, latestBlock] = await Promise.all([
    client.getBalance({ address: normalizedAddress }),
    client.getCode({ address: normalizedAddress }),
    client.getBlockNumber(),
  ]);

  const mrvConfig = { ...config, chainId };
  const mrv = isMinervaNetwork(chainId)
    ? {
        deployment: await optionalJsonRpc<MinervaSmartAccountDeploymentState>(
          mrvConfig,
          "minerva_getSmartAccountDeploymentState",
          [normalizedAddress],
        ),
        readiness: await optionalJsonRpc<MinervaAccountReadiness>(mrvConfig, "minerva_getAccountReadiness", [
          normalizedAddress,
        ]),
        securityMode: await optionalJsonRpc<MinervaAccountSecurityMode>(
          mrvConfig,
          "minerva_getAccountSecurityMode",
          [normalizedAddress],
        ),
      }
    : undefined;
  const chain = chainConfig(chainId);

  return {
    address: normalizedAddress,
    chainId,
    balanceWei,
    deployed: mrv?.deployment?.deployed ?? Boolean(code && code !== "0x"),
    latestBlock,
    chainName: chain.name,
    nativeCurrencySymbol: chain.nativeCurrency.symbol,
    code,
    rpcUrl: config.rpcUrl,
    mrv,
  };
}

function indexerUrlForConfig(config: EvmReadConfig): string {
  return (config.indexerUrl ?? defaultMinervaIndexerUrl(config.chainId)).replace(/\/$/, "");
}

async function indexerFetch<T>(path: string, config: EvmReadConfig = {}): Promise<T> {
  const url = `${indexerUrlForConfig(config)}${path.startsWith("/") ? path : `/${path}`}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "network request failed";
    throw new Error(`Minerva indexer is unreachable at ${url}. Detail: ${detail}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Minerva indexer request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function readMinervaAccountActivity(
  address: Hex,
  config: EvmReadConfig = {},
): Promise<MinervaIndexedAddressActivity> {
  const normalizedAddress = getAddress(address) as Hex;
  const activity = await indexerFetch<MinervaIndexedAddressActivity>(
    `/address/${normalizedAddress}`,
    config,
  );
  return {
    address: normalizedAddress,
    indexedAt: activity.indexedAt,
    transactions: activity.transactions ?? [],
    events: activity.events ?? [],
  };
}

export async function requestMinervaDevnetFaucet(
  address: Hex,
  config: Pick<EvmReadConfig, "chainId" | "faucetUrl"> = {},
  account?: { publicKey?: Hex; salt?: Hex; deployAccount?: boolean },
): Promise<MinervaFaucetReceipt> {
  const faucetUrl = config.faucetUrl ?? defaultMinervaFaucetUrl(config.chainId);
  const response = await fetch(`${faucetUrl}/faucet/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address: getAddress(address),
      publicKey: account?.publicKey,
      salt: account?.salt,
      deployAccount: account?.deployAccount,
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Faucet request failed";
    throw new Error(message);
  }
  return payload as MinervaFaucetReceipt;
}

function pqRelayerUrl(config: Pick<EvmReadConfig, "chainId" | "pqRelayerUrl"> = {}) {
  return config.pqRelayerUrl ?? defaultMinervaPQRelayerUrl(config.chainId);
}

async function pqRelayerFetch<T>(
  path: string,
  config: Pick<EvmReadConfig, "chainId" | "pqRelayerUrl"> = {},
  body?: unknown,
): Promise<T> {
  const url = `${pqRelayerUrl(config)}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "network request failed";
    throw new Error(`PQ relayer is unreachable at ${url}. Start MinervaNetwork node, deploy contracts, and run pnpm pq-relayer:start. Detail: ${detail}`);
  }
  const payload = await response.json();
  if (!response.ok || (payload && typeof payload === "object" && "ok" in payload && payload.ok === false)) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "PQ relayer request failed";
    throw new Error(message);
  }
  return payload as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function getPendingNativeTransactionNonce(
  client: ReturnType<typeof createPublicClient>,
  address: Hex,
): Promise<bigint> {
  return BigInt(await client.getTransactionCount({ address, blockTag: "pending" }));
}

const MIN_PQ_GAS_TIP_CAP_WEI = 1_000_000_000n;
const MIN_PQ_GAS_FEE_CAP_WEI = 2_000_000_000n;
const PQ_REPLACEMENT_RETRY_LIMIT = 2;

function isReplacementUnderpricedError(error: unknown): boolean {
  return /replacement transaction underpriced|transaction underpriced/i.test(errorMessage(error));
}

export interface MinervaFeeCaps {
  gasTipCap: bigint;
  gasFeeCap: bigint;
}

export const DEFAULT_PQ_GAS_LIMIT = 1_500_000n;

export async function readMinervaPQFeeCaps(
  config: Pick<EvmReadConfig, "chainId" | "rpcUrl">,
  attempt = 0,
): Promise<MinervaFeeCaps> {
  const gasPriceWei = decodeHexQuantity(await optionalJsonRpc<string>(config, "eth_gasPrice", []));
  const multiplier = 1n << BigInt(Math.max(0, attempt));
  const baseTipCap = gasPriceWei !== undefined && gasPriceWei > MIN_PQ_GAS_TIP_CAP_WEI ? gasPriceWei : MIN_PQ_GAS_TIP_CAP_WEI;
  const baseFeeCap =
    gasPriceWei !== undefined && gasPriceWei * 2n > MIN_PQ_GAS_FEE_CAP_WEI
      ? gasPriceWei * 2n
      : MIN_PQ_GAS_FEE_CAP_WEI;
  return {
    gasTipCap: baseTipCap * multiplier,
    gasFeeCap: baseFeeCap * multiplier,
  };
}


export type MinervaFeeLevel = "slow" | "normal" | "fast";

export interface MinervaFeeOption extends MinervaFeeCaps {
  level: MinervaFeeLevel;
  /** gas limit × fee cap: the most the envelope can cost. */
  maxCostWei: bigint;
}

const FEE_LEVEL_PERCENT: Record<MinervaFeeLevel, bigint> = { slow: 80n, normal: 100n, fast: 150n };

/** Slow / normal / fast fee caps derived from the live gas price; "normal" is what a plain send uses. */
export async function estimateMinervaFeeOptions(
  config: Pick<EvmReadConfig, "chainId" | "rpcUrl">,
  gas: bigint = DEFAULT_PQ_GAS_LIMIT,
): Promise<MinervaFeeOption[]> {
  const base = await readMinervaPQFeeCaps(config, 0);
  return (Object.keys(FEE_LEVEL_PERCENT) as MinervaFeeLevel[]).map((level) => {
    const percent = FEE_LEVEL_PERCENT[level];
    const gasTipCap = maxBigInt((base.gasTipCap * percent) / 100n, MIN_PQ_GAS_TIP_CAP_WEI);
    const gasFeeCap = maxBigInt((base.gasFeeCap * percent) / 100n, MIN_PQ_GAS_FEE_CAP_WEI, gasTipCap);
    return { level, gasTipCap, gasFeeCap, maxCostWei: gasFeeCap * gas };
  });
}

function maxBigInt(...values: bigint[]): bigint {
  return values.reduce((a, b) => (a > b ? a : b));
}

/** Fee caps that the pool accepts as a replacement for `previous` (at least +10 %; default +15 %). */
export function bumpMinervaFeeCaps(previous: { gasTipCap: bigint | string; gasFeeCap: bigint | string }, percent = 115n): MinervaFeeCaps {
  const tip = BigInt(previous.gasTipCap);
  const fee = BigInt(previous.gasFeeCap);
  const gasTipCap = (tip * percent + 99n) / 100n;
  const gasFeeCap = maxBigInt((fee * percent + 99n) / 100n, gasTipCap);
  return { gasTipCap, gasFeeCap };
}

export interface MinervaTransactionStatus {
  state: "pending" | "success" | "failed" | "dropped";
  blockNumber?: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
}

/** Receipt-based status; "dropped" when the pool no longer knows the hash and no receipt exists. */
export async function readMinervaTransactionStatus(
  hash: Hex,
  config: Pick<EvmReadConfig, "chainId" | "rpcUrl"> = {},
): Promise<MinervaTransactionStatus> {
  const receipt = await optionalJsonRpc<{ status?: string; blockNumber?: string; gasUsed?: string; effectiveGasPrice?: string } | null>(
    config,
    "eth_getTransactionReceipt",
    [hash],
  );
  if (receipt && receipt.blockNumber) {
    const ok = receipt.status === undefined || receipt.status === "0x1";
    return {
      state: ok ? "success" : "failed",
      blockNumber: BigInt(receipt.blockNumber).toString(),
      gasUsed: receipt.gasUsed ? BigInt(receipt.gasUsed).toString() : undefined,
      effectiveGasPrice: receipt.effectiveGasPrice ? BigInt(receipt.effectiveGasPrice).toString() : undefined,
    };
  }
  const tx = await optionalJsonRpc<unknown>(config, "eth_getTransactionByHash", [hash]);
  return { state: tx ? "pending" : "dropped" };
}

export async function waitForMinervaTransaction(
  hash: Hex,
  config: Pick<EvmReadConfig, "chainId" | "rpcUrl"> = {},
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<MinervaTransactionStatus> {
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  let last: MinervaTransactionStatus = { state: "pending" };
  while (Date.now() < deadline) {
    last = await readMinervaTransactionStatus(hash, config);
    if (last.state === "success" || last.state === "failed") return last;
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 2000));
  }
  return last;
}

export async function readMinervaDevPQAccount(
  args: { publicKey: Hex; salt?: Hex },
  config: Pick<EvmReadConfig, "chainId" | "pqRelayerUrl"> = {},
): Promise<MinervaDevPQAccount> {
  return pqRelayerFetch<MinervaDevPQAccount>("/pq-dev/account", config, args);
}

export async function deployMinervaDevPQAccount(
  args: { publicKey: Hex; salt?: Hex },
  config: Pick<EvmReadConfig, "chainId" | "pqRelayerUrl" | "faucetUrl"> = {},
): Promise<MinervaDevPQDeployReceipt> {
  const account = await readMinervaDevPQAccount(args, config);
  if (account.deployed) {
    return { accountAddress: account.accountAddress, deployed: true };
  }

  const faucetReceipt = await requestMinervaDevnetFaucet(
    account.accountAddress,
    { chainId: config.chainId, faucetUrl: config.faucetUrl },
    { publicKey: args.publicKey, salt: account.salt, deployAccount: true },
  );
  return {
    accountAddress: account.accountAddress,
    deployed: faucetReceipt.deployed ?? Boolean(faucetReceipt.deploymentTransactionHash),
    transactionHash: faucetReceipt.deploymentTransactionHash,
    faucetTransactionHash: faucetReceipt.hash,
    deploymentBlockNumber: faucetReceipt.deploymentBlockNumber,
  };
}

export async function readMinervaDevPQTransferAuthorization(
  args: { accountAddress: Hex; target: Hex; valueWei: string | bigint; data?: Hex },
  config: Pick<EvmReadConfig, "chainId" | "rpcUrl"> = {},
): Promise<MinervaDevPQAuthorization> {
  const chainId = supportedChainId(config.chainId ?? MINERVA_DEVNET_CHAIN_ID);
  const client = createPublicClient({
    chain: chainConfig(chainId),
    transport: http(config.rpcUrl ?? defaultMinervaRpcUrl(chainId)),
  });
  const accountAddress = getAddress(args.accountAddress) as Hex;
  const target = getAddress(args.target) as Hex;
  const valueWei = BigInt(args.valueWei);
  const data = args.data ?? "0x";
  const nonce = (await client.readContract({
    address: accountAddress,
    abi: minervaAccountAbi,
    functionName: "nonce",
  })) as bigint;
  const message = (await client.readContract({
    address: accountAddress,
    abi: minervaAccountAbi,
    functionName: "executeMessage",
    args: [nonce, target, valueWei, data],
  })) as Hex;

  return {
    accountAddress,
    target,
    valueWei: valueWei.toString(),
    data,
    nonce: nonce.toString(),
    message,
  };
}

export async function submitMinervaDevPQRawTransaction(
  rawTransaction: Hex,
  config: Pick<EvmReadConfig, "chainId" | "rpcUrl" | "pqRelayerUrl"> = {},
): Promise<MinervaDevPQRawSubmitReceipt> {
  const raw = assertHexBytes(rawTransaction, "rawTransaction");
  const chainId = supportedChainId(config.chainId ?? MINERVA_TESTNET_CHAIN_ID);
  const submitViaRpc = async (): Promise<MinervaDevPQRawSubmitReceipt> => {
    const transactionHash = await sendRawMinervaPQTxV1(
      raw,
      { chainId, rpcUrl: config.rpcUrl },
      "minerva_sendRawPQTransaction",
    );
    return {
      ok: true,
      chainId,
      transactionHash,
      blockNumber: "0",
      status: "pending",
      signerMode: "PQ Native",
      rawTransactionType: "MinervaPQTxV1",
    };
  };
  const submitViaRelayer = () =>
    pqRelayerFetch<MinervaDevPQRawSubmitReceipt>("/pq-dev/send-raw", config, {
      rawTransaction: raw,
    });

  if (chainId === MINERVA_TESTNET_CHAIN_ID && !config.pqRelayerUrl) {
    try {
      return await submitViaRpc();
    } catch (rpcError) {
      try {
        return await submitViaRelayer();
      } catch (relayerError) {
        throw new Error(
          `Could not submit MinervaPQTxV1 on Minerva Testnet. RPC minerva_sendRawPQTransaction failed: ${errorMessage(
            rpcError,
          )}; relayer fallback failed: ${errorMessage(relayerError)}`,
        );
      }
    }
  }

  try {
    return await submitViaRelayer();
  } catch (relayerError) {
    try {
      return await submitViaRpc();
    } catch (rpcError) {
      throw new Error(
        `Could not submit MinervaPQTxV1. Relayer failed: ${errorMessage(
          relayerError,
        )}; RPC minerva_sendRawPQTransaction failed: ${errorMessage(rpcError)}`,
      );
    }
  }
}

/**
 * Policy version the node enforces for a native MinervaPQTxV1 envelope sent from `accountAddress`
 * and signed by `publicKey`: 0 while the account is counterfactual (the key and salt derive the
 * address), otherwise the AccountControlRegistry record's version. Throws when the key has been
 * rotated out, so a stale device key fails before anything is submitted.
 */
export async function readMinervaPQPolicyVersion(
  args: { accountAddress: Hex; publicKey: Hex },
  config: Pick<EvmReadConfig, "chainId" | "rpcUrl"> = {},
): Promise<number> {
  const chainId = supportedChainId(config.chainId ?? MINERVA_DEVNET_CHAIN_ID);
  const client = sdkCreateMinervaClient({
    network: minervaNetworkConfig(chainId),
    rpcUrl: config.rpcUrl ?? defaultMinervaRpcUrl(chainId),
  });
  try {
    return await sdkResolvePolicyVersion(client, getAddress(args.accountAddress) as Hex, args.publicKey);
  } catch (error) {
    // Nodes without the Minerva account-control RPC only know policy version 0.
    if (/method not found|does not exist|not available|-32601/i.test(errorMessage(error))) return 0;
    throw error;
  }
}

export async function sendMinervaDevPQTransfer(
  args: {
    accountAddress: Hex;
    target: Hex;
    valueWei: string | bigint;
    data?: Hex;
    nonce: string | bigint;
    signature: Hex;
    publicKey: Hex;
    privateKey: Hex;
    salt?: Hex;
    nativeTransactionNonce?: string | bigint;
    gas?: string | bigint;
    /** Explicit fee caps (fee editor, speed-up, cancel). Retries on "underpriced" still bump them. */
    fee?: { gasTipCap: string | bigint; gasFeeCap: string | bigint };
  },
  config: Pick<EvmReadConfig, "chainId" | "rpcUrl" | "pqRelayerUrl"> = {},
): Promise<MinervaDevPQTransferReceipt> {
  const chainId = supportedChainId(config.chainId ?? MINERVA_DEVNET_CHAIN_ID);
  const client = createPublicClient({
    chain: chainConfig(chainId),
    transport: http(config.rpcUrl ?? defaultMinervaRpcUrl(chainId)),
  });
  const accountAddress = getAddress(args.accountAddress) as Hex;
  const target = getAddress(args.target) as Hex;
  const valueWei = BigInt(args.valueWei);
  const data = assertHexBytes(args.data ?? "0x", "data");
  const salt = assertHexBytes(args.salt ?? MINERVA_ZERO_HASH, "factorySalt", 32);
  const callData = encodeFunctionData({
    abi: minervaAccountAbi,
    functionName: "executePQ",
    args: [target, valueWei, data, BigInt(args.nonce), args.signature],
  });
  const nativeTransactionNonce =
    args.nativeTransactionNonce !== undefined
      ? quantityToBigInt(args.nativeTransactionNonce, "nativeTransactionNonce")
      : await getPendingNativeTransactionNonce(client, accountAddress);
  const policyVersion = await readMinervaPQPolicyVersion(
    { accountAddress, publicKey: args.publicKey },
    { chainId, rpcUrl: config.rpcUrl },
  );
  let receipt: MinervaDevPQRawSubmitReceipt | undefined;
  let submitError: unknown;
  let usedFeeCaps: MinervaFeeCaps | undefined;
  const gasLimit = args.gas !== undefined ? BigInt(args.gas) : DEFAULT_PQ_GAS_LIMIT;
  for (let attempt = 0; attempt <= PQ_REPLACEMENT_RETRY_LIMIT; attempt++) {
    const feeCaps: MinervaFeeCaps = args.fee
      ? {
          gasTipCap: BigInt(args.fee.gasTipCap) * (1n << BigInt(attempt)),
          gasFeeCap: BigInt(args.fee.gasFeeCap) * (1n << BigInt(attempt)),
        }
      : await readMinervaPQFeeCaps({ chainId, rpcUrl: config.rpcUrl }, attempt);
    usedFeeCaps = feeCaps;
    const signed = signMinervaPQTxV1({
      chainId,
      nonce: nativeTransactionNonce,
      gasTipCap: feeCaps.gasTipCap,
      gasFeeCap: feeCaps.gasFeeCap,
      gas: gasLimit,
      account: accountAddress,
      factorySalt: salt,
      to: accountAddress,
      value: 0n,
      data: callData,
      pqPublicKey: args.publicKey,
      pqPrivateKey: args.privateKey,
      policyVersion,
    });
    try {
      receipt = await submitMinervaDevPQRawTransaction(signed.rawTransaction, config);
      break;
    } catch (error) {
      submitError = error;
      if (!isReplacementUnderpricedError(error) || attempt === PQ_REPLACEMENT_RETRY_LIMIT) throw error;
    }
  }
  if (!receipt) throw submitError instanceof Error ? submitError : new Error(errorMessage(submitError));
  return {
    ok: receipt.ok,
    accountAddress,
    target,
    valueWei: valueWei.toString(),
    data,
    nonce: args.nonce.toString(),
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber ?? "0",
    status: receipt.status,
    signerMode: receipt.signerMode,
    rawTransactionType: receipt.rawTransactionType,
    nativeTransactionNonce: nativeTransactionNonce.toString(),
    gasTipCap: usedFeeCaps?.gasTipCap.toString(),
    gasFeeCap: usedFeeCaps?.gasFeeCap.toString(),
    gas: gasLimit.toString(),
  };
}

export async function readMinervaDevPQRotateAuthorization(
  args: { accountAddress: Hex; newPublicKey: Hex },
  config: Pick<EvmReadConfig, "chainId" | "rpcUrl"> = {},
): Promise<MinervaDevPQRotationAuthorization> {
  const chainId = supportedChainId(config.chainId ?? MINERVA_DEVNET_CHAIN_ID);
  const client = createPublicClient({
    chain: chainConfig(chainId),
    transport: http(config.rpcUrl ?? defaultMinervaRpcUrl(chainId)),
  });
  const accountAddress = getAddress(args.accountAddress) as Hex;
  const nonce = (await client.readContract({
    address: accountAddress,
    abi: minervaAccountAbi,
    functionName: "nonce",
  })) as bigint;
  const message = (await client.readContract({
    address: accountAddress,
    abi: minervaAccountAbi,
    functionName: "rotateMessage",
    args: [nonce, args.newPublicKey],
  })) as Hex;

  return {
    accountAddress,
    newPublicKey: args.newPublicKey,
    nonce: nonce.toString(),
    message,
  };
}

export async function sendMinervaDevPQKeyRotation(
  args: {
    accountAddress: Hex;
    newPublicKey: Hex;
    nonce: string | bigint;
    signature: Hex;
    publicKey: Hex;
    privateKey: Hex;
    salt?: Hex;
    nativeTransactionNonce?: string | bigint;
    gas?: string | bigint;
  },
  config: Pick<EvmReadConfig, "chainId" | "rpcUrl" | "pqRelayerUrl"> = {},
): Promise<MinervaDevPQRotationReceipt> {
  const chainId = supportedChainId(config.chainId ?? MINERVA_DEVNET_CHAIN_ID);
  const client = createPublicClient({
    chain: chainConfig(chainId),
    transport: http(config.rpcUrl ?? defaultMinervaRpcUrl(chainId)),
  });
  const accountAddress = getAddress(args.accountAddress) as Hex;
  const newPublicKey = assertHexBytes(args.newPublicKey, "newPublicKey", ML_DSA_65_PUBLIC_KEY_BYTES);
  const salt = assertHexBytes(args.salt ?? MINERVA_ZERO_HASH, "factorySalt", 32);
  const callData = encodeFunctionData({
    abi: minervaAccountAbi,
    functionName: "rotatePQKey",
    args: [newPublicKey, BigInt(args.nonce), args.signature],
  });
  const nativeTransactionNonce =
    args.nativeTransactionNonce !== undefined
      ? quantityToBigInt(args.nativeTransactionNonce, "nativeTransactionNonce")
      : await getPendingNativeTransactionNonce(client, accountAddress);
  const policyVersion = await readMinervaPQPolicyVersion(
    { accountAddress, publicKey: args.publicKey },
    { chainId, rpcUrl: config.rpcUrl },
  );
  let receipt: MinervaDevPQRawSubmitReceipt | undefined;
  let submitError: unknown;
  for (let attempt = 0; attempt <= PQ_REPLACEMENT_RETRY_LIMIT; attempt++) {
    const feeCaps = await readMinervaPQFeeCaps({ chainId, rpcUrl: config.rpcUrl }, attempt);
    const signed = signMinervaPQTxV1({
      chainId,
      nonce: nativeTransactionNonce,
      gasTipCap: feeCaps.gasTipCap,
      gasFeeCap: feeCaps.gasFeeCap,
      gas: args.gas ?? "1500000",
      account: accountAddress,
      factorySalt: salt,
      to: accountAddress,
      value: 0n,
      data: callData,
      pqPublicKey: args.publicKey,
      pqPrivateKey: args.privateKey,
      policyVersion,
    });
    try {
      receipt = await submitMinervaDevPQRawTransaction(signed.rawTransaction, config);
      break;
    } catch (error) {
      submitError = error;
      if (!isReplacementUnderpricedError(error) || attempt === PQ_REPLACEMENT_RETRY_LIMIT) throw error;
    }
  }
  if (!receipt) throw submitError instanceof Error ? submitError : new Error(errorMessage(submitError));
  return {
    ok: receipt.ok,
    accountAddress,
    newPublicKey,
    newPublicKeyCommitment: keccak256(newPublicKey),
    nonce: args.nonce.toString(),
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber ?? "0",
    status: receipt.status,
    signerMode: receipt.signerMode,
    rawTransactionType: receipt.rawTransactionType,
  };
}

export type MinervaPQAccount = MinervaDevPQAccount;
export type MinervaPQDeployReceipt = MinervaDevPQDeployReceipt;
export type MinervaPQTransferReceipt = MinervaDevPQTransferReceipt;
export type MinervaPQAuthorization = MinervaDevPQAuthorization;
export type MinervaPQRotationAuthorization = MinervaDevPQRotationAuthorization;
export type MinervaPQRotationReceipt = MinervaDevPQRotationReceipt;
export type MinervaPQRawSubmitReceipt = MinervaDevPQRawSubmitReceipt;

export const requestMinervaFaucet = requestMinervaDevnetFaucet;
export const readMinervaPQAccount = readMinervaDevPQAccount;
export const deployMinervaPQAccount = deployMinervaDevPQAccount;
export const readMinervaPQTransferAuthorization = readMinervaDevPQTransferAuthorization;
export const submitMinervaPQRawTransaction = submitMinervaDevPQRawTransaction;
export const sendMinervaPQTransfer = sendMinervaDevPQTransfer;
export const readMinervaPQRotateAuthorization = readMinervaDevPQRotateAuthorization;
export const rotateMinervaPQKey = sendMinervaDevPQKeyRotation;

export interface MinervaWalletBackendConfig extends EvmReadConfig {}
type SendMinervaPQTransferArgs = Parameters<typeof sendMinervaPQTransfer>[0];
type RotateMinervaPQKeyArgs = Parameters<typeof rotateMinervaPQKey>[0];

export function createMinervaWalletBackend(config: MinervaWalletBackendConfig = {}) {
  const chainId = supportedChainId(config.chainId);
  const network = minervaNetworkConfig(chainId);
  const runtime = {
    chainId,
    rpcUrl: config.rpcUrl ?? defaultMinervaRpcUrl(chainId),
    faucetUrl: config.faucetUrl ?? defaultMinervaFaucetUrl(chainId),
    pqRelayerUrl: config.pqRelayerUrl ?? defaultMinervaPQRelayerUrl(chainId),
    indexerUrl: config.indexerUrl ?? defaultMinervaIndexerUrl(chainId),
  };
  const client = sdkCreateMinervaClient({ network, rpcUrl: runtime.rpcUrl });

  return {
    chainId,
    network,
    client,
    rpcUrl: runtime.rpcUrl,
    faucetUrl: runtime.faucetUrl,
    pqRelayerUrl: runtime.pqRelayerUrl,
    indexerUrl: config.indexerUrl ?? defaultMinervaIndexerUrl(chainId),
    explorerTxUrl: (hash: string) => explorerTxUrl(hash, chainId),
    explorerAddressUrl: (address: string) => explorerAddressUrl(address, chainId),
    explorerProofUrl: (path: string) => explorerProofUrl(path, chainId),
    readAccountSnapshot: (address: Hex) => readAccountSnapshot(address, runtime),
    readAccountActivity: (address: Hex) => readMinervaAccountActivity(address, runtime),
    readPQAccount: (args: { publicKey: Hex; salt?: Hex }) => readMinervaPQAccount(args, runtime),
    requestFaucet: (
      address: Hex,
      account?: { publicKey?: Hex; salt?: Hex; deployAccount?: boolean },
    ) => requestMinervaFaucet(address, runtime, account),
    deployPQAccount: (args: { publicKey: Hex; salt?: Hex }) => deployMinervaPQAccount(args, runtime),
    sendPQTransfer: (args: SendMinervaPQTransferArgs) => sendMinervaPQTransfer(args, runtime),
    rotatePQKey: (args: RotateMinervaPQKeyArgs) => rotateMinervaPQKey(args, runtime),
    // Device keys (Minerva): enrol, read, revoke, and spend through executeNative.
    readDeviceKey: (args: Parameters<typeof readMinervaDeviceKey>[0]) => readMinervaDeviceKey(args, runtime),
    readEnrollAuthorization: (args: Parameters<typeof readMinervaPQEnrollAuthorization>[0]) =>
      readMinervaPQEnrollAuthorization(args, runtime),
    enrollDeviceKey: (args: Parameters<typeof enrollMinervaDeviceKey>[0]) => enrollMinervaDeviceKey(args, runtime),
    readRevokeAuthorization: (args: Parameters<typeof readMinervaPQRevokeAuthorization>[0]) =>
      readMinervaPQRevokeAuthorization(args, runtime),
    revokeDeviceKey: (args: Parameters<typeof revokeMinervaDeviceKey>[0]) => revokeMinervaDeviceKey(args, runtime),
    sendNativeCall: (args: Parameters<typeof sendMinervaNativeCall>[0]) => sendMinervaNativeCall(args, runtime),
  };
}

/**
 * Minerva smart-account integration seam.
 * The final submit path is MinervaPQTxV1, not an EOA, ERC-4337 bundler,
 * or EIP-7702 delegation flow.
 */
export interface SmartAccount {
  address: Hex;
  chainId: SupportedChainId;
  deployed: boolean;
}

export async function getSmartAccount(_owner: Hex, _chainId: SupportedChainId): Promise<SmartAccount> {
  throw new Error("getSmartAccount: pending MinervaPQTxV1 node support.");
}

// Device keys and scoped permissions (Minerva Compatibility Specification 4.6).
export {
  enrollMinervaDeviceKey,
  readMinervaDeviceKey,
  readMinervaPQEnrollAuthorization,
  readMinervaPQRevokeAuthorization,
  revokeMinervaDeviceKey,
  sendMinervaNativeCall,
  type MinervaDeviceCallReceipt,
  type MinervaDeviceKeyReceipt,
  type MinervaDeviceKeyState,
  type MinervaDeviceScope,
  type MinervaDeviceScopeInput,
  type MinervaPQEnrollAuthorization,
  type MinervaPQRevokeAuthorization,
} from "@minerva/sdk";

// ------------------------------------------------------------ transaction review

export const ERC20_APPROVE_SELECTOR = "0x095ea7b3" as const;
export const ERC20_TRANSFER_SELECTOR = "0xa9059cbb" as const;
export const UNLIMITED_APPROVAL_WEI = (1n << 256n) - 1n;

export interface TransactionReviewInput {
  target?: Hex;
  valueWei: bigint;
  data?: Hex;
  nativeSymbol: string;
  simulation?: Pick<MinervaSimulationResult, "willSucceed" | "revertReason" | "maxFeeWei" | "senderBalanceBeforeWei">;
  simulationError?: string;
  /** True when the target has code; undefined when not checked. */
  targetHasCode?: boolean;
  requestingApp?: { name: string; origin?: string; verified?: boolean };
  /** Addresses the user already knows (contacts, own accounts, system contracts). */
  knownAddresses?: readonly Hex[];
  /** The sending account; enables self-send and address-poisoning checks. */
  senderAddress?: Hex;
  /** Saved contacts and recent recipients, used to spot look-alike addresses. */
  contacts?: readonly { label: string; address: Hex }[];
  recentRecipients?: readonly Hex[];
  /** When the target is a token contract the wallet knows, lets the review show token amounts. */
  token?: { symbol: string; decimals: number };
}

export interface TransactionReviewApproval {
  spender: Hex;
  amountWei: bigint;
  unlimited: boolean;
}

export interface TransactionReviewBalanceChange {
  asset: string;
  kind: "value" | "fee" | "token" | "nft";
  deltaWei: bigint;
  /** Decimals of the asset when it is not the 18-decimal native coin. */
  decimals?: number;
  /** Human label, e.g. "−12.5 MTK" or "−1 × #42". */
  label: string;
}

export interface TransactionReviewWarning {
  id: string;
  severity: "info" | "review" | "warning" | "critical";
  title: string;
  detail: string;
}

export interface TransactionReviewCall {
  /** Function name when the selector is known, else the 4-byte selector. */
  name: string;
  /** One-line human summary of what the call does. */
  summary: string;
  known: boolean;
}

export interface TransactionReview {
  action: string;
  /** Decoded contract call, present whenever calldata is attached. */
  call?: TransactionReviewCall;
  balanceChanges: TransactionReviewBalanceChange[];
  approval?: TransactionReviewApproval;
  contractCall: boolean;
  unknownContract: boolean;
  requestingApp: string;
  simulation: { state: "ok" | "reverts" | "unavailable" | "skipped"; label: string; detail?: string };
  warnings: TransactionReviewWarning[];
  disclaimer: string;
}


// ------------------------------------------------------------ recipient risk

export const MINERVA_SYSTEM_ADDRESSES: ReadonlyArray<{ address: Hex; label: string }> = [
  { address: MINERVA_MLDSA65_PRECOMPILE as Hex, label: "ML-DSA-65 precompile" },
  { address: "0x0000000000000000000000000000000000004D01", label: "MINERVA_TX_CONTEXT precompile" },
  { address: MINERVA_SECURITY_MODE_REGISTRY as Hex, label: "SecurityModeRegistry" },
  { address: MINERVA_ACCOUNT_READINESS_REGISTRY as Hex, label: "AccountReadinessRegistry" },
  { address: MINERVA_ACCOUNT_FACTORY as Hex, label: "MinervaAccountFactory" },
  { address: "0x0000000000000000000000000000000000000204", label: "AccountControlRegistry" },
  { address: "0x0000000000000000000000000000000000000205", label: "MinervaMigrationReserve" },
];

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";

export interface RecipientRiskInput {
  recipient: Hex;
  sender?: Hex;
  contacts?: readonly { label: string; address: Hex }[];
  recentRecipients?: readonly Hex[];
  /** True when the recipient has code; undefined when unknown. */
  hasCode?: boolean;
  valueWei?: bigint;
  data?: Hex;
}

function looksAlike(a: string, b: string): boolean {
  if (a === b) return false;
  return a.slice(2, 6) === b.slice(2, 6) && a.slice(-4) === b.slice(-4);
}

/** Warnings about the recipient itself: burn addresses, system contracts, self-sends, look-alikes. */
export function assessRecipientRisk(input: RecipientRiskInput): TransactionReviewWarning[] {
  const warnings: TransactionReviewWarning[] = [];
  const recipient = input.recipient.toLowerCase();
  if (recipient === ZERO_ADDRESS) {
    warnings.push({ id: "zero-address", severity: "critical", title: "Recipient is the zero address", detail: "Funds sent here are destroyed. No one can recover them." });
  } else if (recipient === DEAD_ADDRESS) {
    warnings.push({ id: "burn-address", severity: "warning", title: "Recipient is a burn address", detail: "0x…dEaD has no key. Anything sent here is gone for good." });
  }
  const system = MINERVA_SYSTEM_ADDRESSES.find((entry) => entry.address.toLowerCase() === recipient);
  if (system) {
    warnings.push({ id: "system-contract", severity: "critical", title: `Recipient is ${system.label}`, detail: "Minerva system contracts and precompiles do not hold user funds. A transfer here would be lost or revert." });
  }
  if (input.sender && input.sender.toLowerCase() === recipient) {
    warnings.push({ id: "self-send", severity: "review", title: "Sending to yourself", detail: "The recipient is this account. You will only pay the network fee." });
  }
  const knownPool: Array<{ label: string; address: string }> = [
    ...(input.contacts ?? []).map((c) => ({ label: c.label, address: c.address.toLowerCase() })),
    ...(input.recentRecipients ?? []).map((a) => ({ label: "a recent recipient", address: a.toLowerCase() })),
  ];
  const lookalike = knownPool.find((entry) => looksAlike(entry.address, recipient));
  if (lookalike) {
    warnings.push({ id: "address-poisoning", severity: "critical", title: "Address looks like a known one but differs", detail: `The first and last characters match ${lookalike.label} (${lookalike.address.slice(0, 6)}…${lookalike.address.slice(-4)}) but the middle does not. This is the pattern of address-poisoning scams. Check every character.` });
  }
  const data = input.data ?? "0x";
  if (input.hasCode === true && (input.valueWei ?? 0n) > 0n && data === "0x") {
    warnings.push({ id: "value-to-contract", severity: "review", title: "Recipient is a contract", detail: "You are sending coins to a contract without calldata. Only do this if the contract is meant to receive plain transfers." });
  }
  return warnings;
}

export const TRANSACTION_REVIEW_DISCLAIMER =
  "Simulation is not a guarantee: the chain state when the transaction is included can differ from the preview.";

const KNOWN_SELECTORS: Record<string, { name: string; summary: string }> = {
  [toFunctionSelector("transfer(address,uint256)")]: { name: "transfer", summary: "ERC-20 token transfer" },
  [toFunctionSelector("transferFrom(address,address,uint256)")]: { name: "transferFrom", summary: "ERC-20 transfer on behalf of another address" },
  [toFunctionSelector("approve(address,uint256)")]: { name: "approve", summary: "ERC-20 spending approval" },
  [toFunctionSelector("executePQ(address,uint256,bytes,uint256,bytes)")]: { name: "executePQ", summary: "Minerva account: execute a call with a PQ signature" },
  [toFunctionSelector("rotatePQKey(bytes,uint256,bytes)")]: { name: "rotatePQKey", summary: "Minerva account: rotate the Control Key (policy version increments)" },
  [toFunctionSelector("enrollDeviceKey(bytes,address[],uint128,uint64,uint64,uint256,bytes)")]: { name: "enrollDeviceKey", summary: "Minerva account: enrol a scoped device key" },
  [toFunctionSelector("revokeDeviceKey(bytes32,uint256,bytes)")]: { name: "revokeDeviceKey", summary: "Minerva account: revoke a device key" },
  [toFunctionSelector("executeNative(address,uint256,bytes)")]: { name: "executeNative", summary: "Minerva account: execute a call on the native path" },
};

/** Names the call behind attached calldata when its selector is known (ERC-20, Minerva account). */
export function decodeKnownCall(data: Hex): TransactionReviewCall | undefined {
  if (data === "0x" || data.length < 10) return undefined;
  const selector = data.slice(0, 10).toLowerCase();
  const known = KNOWN_SELECTORS[selector];
  if (known) return { ...known, known: true };
  return { name: selector, summary: "Contract call with an unrecognised selector; verify the target", known: false };
}

/** transfer(address,uint256) → recipient and amount; undefined for anything else. */
function decodeTransferCalldata(data: Hex): { to: Hex; amount: bigint } | undefined {
  if (!/^0xa9059cbb[0-9a-fA-F]{128}$/.test(data)) return undefined;
  return { to: normalizeEvmAddress(`0x${data.slice(34, 74)}`) as Hex, amount: BigInt(`0x${data.slice(74, 138)}`) };
}

/** ERC-721 safeTransferFrom/transferFrom(address,address,uint256) and ERC-1155 safeTransferFrom(...,id,amount,data). */
function decodeNftTransferCalldata(data: Hex): { to: Hex; tokenId: bigint } | undefined {
  if (/^0x(42842e0e|23b872dd)[0-9a-fA-F]{192}$/.test(data)) {
    return { to: normalizeEvmAddress(`0x${data.slice(98, 138)}`) as Hex, tokenId: BigInt(`0x${data.slice(138, 202)}`) };
  }
  if (/^0xf242432a[0-9a-fA-F]{256,}$/.test(data)) {
    return { to: normalizeEvmAddress(`0x${data.slice(98, 138)}`) as Hex, tokenId: BigInt(`0x${data.slice(138, 202)}`) };
  }
  return undefined;
}

function decodeApproval(data: Hex): TransactionReviewApproval | undefined {
  if (!data.toLowerCase().startsWith(ERC20_APPROVE_SELECTOR) || data.length !== 2 + 8 + 64 * 2) return undefined;
  const spender = `0x${data.slice(10 + 24, 10 + 64)}` as Hex;
  const amountWei = BigInt(`0x${data.slice(10 + 64, 10 + 128)}`);
  return { spender: normalizeEvmAddress(spender) as Hex, amountWei, unlimited: amountWei === UNLIMITED_APPROVAL_WEI };
}

/**
 * Builds what a review screen must show before signing (programme Phase 3, "safer transaction
 * review"): balance changes, approvals, the requesting app, unknown-contract flags, the
 * simulation state and the warnings that follow from them. Pure; both apps render it.
 */
export function buildTransactionReview(input: TransactionReviewInput): TransactionReview {
  const data = (input.data ?? "0x") as Hex;
  const contractCall = data !== "0x" && data.length > 2;
  const approval = contractCall ? decodeApproval(data) : undefined;
  const call = contractCall ? decodeKnownCall(data) : undefined;
  const target = input.target ? (normalizeEvmAddress(input.target) as Hex) : undefined;
  const known = (input.knownAddresses ?? []).map((a) => a.toLowerCase());
  const unknownContract = input.targetHasCode === true && target !== undefined && !known.includes(target.toLowerCase());
  const warnings: TransactionReviewWarning[] = [];

  const balanceChanges: TransactionReviewBalanceChange[] = [];
  if (input.valueWei > 0n) {
    balanceChanges.push({ asset: input.nativeSymbol, kind: "value", deltaWei: -input.valueWei, label: `−${formatBalanceWei(input.valueWei)} ${input.nativeSymbol}` });
  }
  const tokenTransfer = contractCall ? decodeTransferCalldata(data) : undefined;
  if (tokenTransfer) {
    const symbol = input.token?.symbol ?? "tokens";
    const decimals = input.token?.decimals;
    const amountLabel = decimals !== undefined ? formatUnits(tokenTransfer.amount, decimals) : tokenTransfer.amount.toString();
    balanceChanges.push({ asset: symbol, kind: "token", deltaWei: -tokenTransfer.amount, decimals, label: `−${amountLabel} ${symbol}` });
  }
  const nftTransfer = contractCall && !tokenTransfer ? decodeNftTransferCalldata(data) : undefined;
  if (nftTransfer) {
    balanceChanges.push({ asset: input.token?.symbol ?? "NFT", kind: "nft", deltaWei: -1n, label: `−1 × #${nftTransfer.tokenId.toString()}${input.token?.symbol ? ` ${input.token.symbol}` : ""}` });
  }
  if (input.simulation?.maxFeeWei !== undefined) {
    balanceChanges.push({ asset: input.nativeSymbol, kind: "fee", deltaWei: -input.simulation.maxFeeWei, label: `−${formatBalanceWei(input.simulation.maxFeeWei)} ${input.nativeSymbol} fee` });
  }
  if (target) {
    warnings.push(
      ...assessRecipientRisk({
        recipient: (tokenTransfer?.to ?? nftTransfer?.to ?? target) as Hex,
        sender: input.senderAddress,
        contacts: input.contacts,
        recentRecipients: input.recentRecipients,
        hasCode: tokenTransfer || nftTransfer ? undefined : input.targetHasCode,
        valueWei: input.valueWei,
        data,
      }),
    );
  }

  let simulation: TransactionReview["simulation"];
  if (input.simulation) {
    if (input.simulation.willSucceed) {
      simulation = { state: "ok", label: contractCall ? "Call succeeds" : `Sends ${formatBalanceWei(input.valueWei)} ${input.nativeSymbol}` };
    } else {
      simulation = { state: "reverts", label: "Would revert", detail: input.simulation.revertReason };
      warnings.push({ id: "simulation-reverts", severity: "critical", title: "Transaction would revert", detail: input.simulation.revertReason ?? "The node rejected this transaction in simulation." });
    }
    const needed = input.valueWei + (input.simulation.maxFeeWei ?? 0n);
    if (input.simulation.senderBalanceBeforeWei < needed) {
      warnings.push({ id: "insufficient-funds", severity: "warning", title: "Insufficient funds", detail: `Balance ${formatBalanceWei(input.simulation.senderBalanceBeforeWei)} ${input.nativeSymbol} cannot cover value plus fee.` });
    }
  } else if (input.simulationError) {
    simulation = { state: "unavailable", label: "Unavailable", detail: input.simulationError };
    warnings.push({ id: "simulation-unavailable", severity: "review", title: "Simulation unavailable", detail: `${input.simulationError}. Review carefully before confirming.` });
  } else {
    simulation = { state: "skipped", label: "Not simulated" };
    warnings.push({ id: "simulation-skipped", severity: "review", title: "Not simulated", detail: "This surface could not preflight the transaction. Check the amount, the target and the calldata yourself." });
  }

  if (approval) {
    warnings.push(
      approval.unlimited
        ? { id: "unlimited-approval", severity: "warning", title: "Unlimited approval", detail: `This lets ${approval.spender} move any amount of this token at any time. Prefer an exact allowance.` }
        : { id: "approval", severity: "review", title: "Token approval", detail: `Allows ${approval.spender} to spend up to ${approval.amountWei.toString()} units of this token.` },
    );
  }
  if (unknownContract) {
    warnings.push({ id: "unknown-contract", severity: "review", title: "Unknown contract", detail: "The target is a contract you have not interacted with before. Make sure the requesting app is the one you expect." });
  } else if (contractCall && !approval) {
    warnings.push({ id: "contract-call", severity: "review", title: "Contract call", detail: "This transaction carries calldata. Review the action the contract will perform." });
  }
  if (input.requestingApp && input.requestingApp.verified === false) {
    warnings.push({ id: "unverified-app", severity: "review", title: "Unverified app", detail: `${input.requestingApp.name} is not a verified app. Confirm the request is yours.` });
  }

  const action = approval
    ? `Approve ${approval.unlimited ? "unlimited" : approval.amountWei.toString()} for ${approval.spender.slice(0, 6)}…${approval.spender.slice(-4)}`
    : tokenTransfer
      ? `Send ${input.token ? formatUnits(tokenTransfer.amount, input.token.decimals) : tokenTransfer.amount.toString()} ${input.token?.symbol ?? "tokens"} to ${tokenTransfer.to.slice(0, 6)}…${tokenTransfer.to.slice(-4)}`
      : nftTransfer
        ? `Send ${input.token?.symbol ?? "NFT"} #${nftTransfer.tokenId.toString()} to ${nftTransfer.to.slice(0, 6)}…${nftTransfer.to.slice(-4)}`
    : contractCall
      ? `Call ${target ? `${target.slice(0, 6)}…${target.slice(-4)}` : "contract"}${input.valueWei > 0n ? ` with ${formatBalanceWei(input.valueWei)} ${input.nativeSymbol}` : ""}`
      : `Send ${formatBalanceWei(input.valueWei)} ${input.nativeSymbol}`;

  return {
    action,
    call,
    balanceChanges,
    approval,
    contractCall,
    unknownContract,
    requestingApp: input.requestingApp ? `${input.requestingApp.name}${input.requestingApp.origin ? ` (${input.requestingApp.origin})` : ""}` : "Minerva Wallet (this device)",
    simulation,
    warnings,
    disclaimer: TRANSACTION_REVIEW_DISCLAIMER,
  };
}

export * from "./networks";
export * from "./tokens";
export * from "./nfts";
