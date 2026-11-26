/**
 * Runtime chain registry.
 *
 * The built-in Minerva networks (devnet, testnet and the reserved mainnet id) are always present.
 * Apps register user-added networks ("custom RPC") at boot; every chain-aware helper in this
 * package resolves ids through this registry, so a custom network behaves like a built-in one.
 */
import {
  MINERVA_TESTNET_EXPLORER_URL,
  MINERVA_TESTNET_FAUCET_URL,
  MINERVA_TESTNET_PQ_RELAYER_URL,
  MINERVA_TESTNET_RPC_URL,
  minervaDevnet as sdkMinervaDevnet,
  minervaTestnet as sdkMinervaTestnet,
  type MinervaNetworkConfig,
} from "@minerva/sdk";

export interface MinervaChainDefinition {
  chainId: number;
  name: string;
  rpcUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  explorerUrl?: string;
  indexerUrl?: string;
  faucetUrl?: string;
  pqRelayerUrl?: string;
  /** True when the chain runs the Minerva PQ account protocol (precompiles and system contracts). */
  minerva: boolean;
  builtIn: boolean;
  /** False for networks announced but not yet serving blocks (the reserved mainnet id). */
  launched: boolean;
  testnet: boolean;
}

export const MINERVA_MAINNET_CHAIN_ID = 77139;
export const MINERVA_MAINNET_RPC_URL = "https://rpc.minervachain.org";

const MRV = { name: "Minerva", symbol: "MRV", decimals: 18 } as const;

function firstUrl(urls: readonly string[] | undefined, fallback?: string): string | undefined {
  return urls?.find((u) => typeof u === "string" && u.length > 0) ?? fallback;
}

function builtInFromSdk(
  config: MinervaNetworkConfig,
  extra: Partial<MinervaChainDefinition> = {},
): MinervaChainDefinition {
  return {
    chainId: config.chainId,
    name: config.name,
    rpcUrl: firstUrl(config.rpcUrls, "http://127.0.0.1:8545")!,
    nativeCurrency: config.nativeCurrency,
    explorerUrl: firstUrl(config.blockExplorerUrls),
    faucetUrl: firstUrl(config.faucetUrls),
    pqRelayerUrl: firstUrl(config.faucetUrls),
    minerva: true,
    builtIn: true,
    launched: true,
    testnet: config.chainId !== MINERVA_MAINNET_CHAIN_ID,
    ...extra,
  };
}

const BUILT_IN: MinervaChainDefinition[] = [
  builtInFromSdk(sdkMinervaDevnet, { indexerUrl: "http://127.0.0.1:18549" }),
  builtInFromSdk(sdkMinervaTestnet, {
    rpcUrl: MINERVA_TESTNET_RPC_URL,
    faucetUrl: MINERVA_TESTNET_FAUCET_URL,
    pqRelayerUrl: MINERVA_TESTNET_PQ_RELAYER_URL,
    indexerUrl: "https://testnet.minervachain.org/api/indexer",
    explorerUrl: firstUrl(sdkMinervaTestnet.blockExplorerUrls, MINERVA_TESTNET_EXPLORER_URL),
  }),
  {
    chainId: MINERVA_MAINNET_CHAIN_ID,
    name: "Minerva Mainnet",
    rpcUrl: MINERVA_MAINNET_RPC_URL,
    nativeCurrency: MRV,
    minerva: true,
    builtIn: true,
    launched: false,
    testnet: false,
  },
];

const registry = new Map<number, MinervaChainDefinition>(BUILT_IN.map((c) => [c.chainId, c]));
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function onChainRegistryChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface CustomChainInput {
  chainId: number;
  name: string;
  rpcUrl: string;
  nativeCurrency?: Partial<MinervaChainDefinition["nativeCurrency"]>;
  explorerUrl?: string;
  indexerUrl?: string;
  faucetUrl?: string;
  pqRelayerUrl?: string;
  minerva?: boolean;
  testnet?: boolean;
}

function assertHttpUrl(value: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(`${label} must use http or https.`);
}

/** Adds or replaces a user-defined network. Built-in ids cannot be overridden except for their RPC URL. */
export function registerChain(input: CustomChainInput): MinervaChainDefinition {
  if (!Number.isInteger(input.chainId) || input.chainId <= 0) throw new Error("Chain id must be a positive integer.");
  assertHttpUrl(input.rpcUrl, "RPC URL");
  if (input.explorerUrl) assertHttpUrl(input.explorerUrl, "Explorer URL");
  if (input.indexerUrl) assertHttpUrl(input.indexerUrl, "Indexer URL");
  const existing = registry.get(input.chainId);
  if (existing?.builtIn) {
    const next: MinervaChainDefinition = { ...existing, rpcUrl: input.rpcUrl };
    registry.set(input.chainId, next);
    notify();
    return next;
  }
  const next: MinervaChainDefinition = {
    chainId: input.chainId,
    name: input.name.trim() || `Chain ${input.chainId}`,
    rpcUrl: input.rpcUrl,
    nativeCurrency: {
      name: input.nativeCurrency?.name ?? input.nativeCurrency?.symbol ?? "Ether",
      symbol: input.nativeCurrency?.symbol ?? "ETH",
      decimals: input.nativeCurrency?.decimals ?? 18,
    },
    explorerUrl: input.explorerUrl,
    indexerUrl: input.indexerUrl,
    faucetUrl: input.faucetUrl,
    pqRelayerUrl: input.pqRelayerUrl,
    minerva: input.minerva ?? false,
    builtIn: false,
    launched: true,
    testnet: input.testnet ?? true,
  };
  registry.set(input.chainId, next);
  notify();
  return next;
}

/** Removes a custom network; restores the default RPC URL of a built-in one. */
export function unregisterChain(chainId: number): void {
  const existing = registry.get(chainId);
  if (!existing) return;
  if (existing.builtIn) {
    const original = BUILT_IN.find((c) => c.chainId === chainId);
    if (original) registry.set(chainId, original);
  } else {
    registry.delete(chainId);
  }
  notify();
}

export function getChainDefinition(chainId: number | string | undefined): MinervaChainDefinition | undefined {
  const parsed = typeof chainId === "string" ? Number(chainId) : chainId;
  return parsed === undefined || !Number.isFinite(parsed) ? undefined : registry.get(parsed);
}

export function isKnownChainId(chainId: number | string | undefined): boolean {
  return getChainDefinition(chainId) !== undefined;
}

export function listChains(): MinervaChainDefinition[] {
  return [...registry.values()].sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || a.chainId - b.chainId);
}

export function builtInChainDefinitions(): MinervaChainDefinition[] {
  return [...BUILT_IN];
}

/** Probes a JSON-RPC endpoint and returns the chain id it reports, or throws with a readable reason. */
export async function probeRpcChainId(rpcUrl: string, timeoutMs = 8000): Promise<number> {
  assertHttpUrl(rpcUrl, "RPC URL");
  const controller = typeof AbortController === "function" ? new AbortController() : undefined;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: controller?.signal,
    });
    if (!response.ok) throw new Error(`RPC answered HTTP ${response.status}`);
    const payload = (await response.json()) as { result?: string; error?: { message?: string } };
    if (payload.error || typeof payload.result !== "string") throw new Error(payload.error?.message ?? "RPC did not return a chain id");
    return Number(BigInt(payload.result));
  } finally {
    clearTimeout(timer);
  }
}
