import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getChainDefinition,
  listChains,
  probeRpcChainId,
  registerChain,
  unregisterChain,
  type CustomChainInput,
  type MinervaChainDefinition,
} from "@minerva/evm";
import { emitWalletChange } from "@/lib/walletEvents";

const STORAGE_KEY = "minerva.wallet.networks.v1";

interface StoredNetworks {
  version: 1;
  custom: CustomChainInput[];
  /** RPC URL overrides for built-in networks, keyed by chain id. */
  rpcOverrides: Record<string, string>;
}

async function readStored(): Promise<StoredNetworks> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredNetworks) : undefined;
    if (parsed?.version === 1) return { version: 1, custom: parsed.custom ?? [], rpcOverrides: parsed.rpcOverrides ?? {} };
  } catch {
    // corrupt store: start clean
  }
  return { version: 1, custom: [], rpcOverrides: {} };
}

async function writeStored(next: StoredNetworks): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

let loaded = false;

/** Registers persisted custom networks and RPC overrides with the chain registry. Call once at boot. */
export async function loadCustomNetworks(): Promise<void> {
  if (loaded) return;
  const stored = await readStored();
  for (const custom of stored.custom) {
    try {
      registerChain(custom);
    } catch {
      // skip a corrupt entry rather than block boot
    }
  }
  for (const [chainId, rpcUrl] of Object.entries(stored.rpcOverrides)) {
    const def = getChainDefinition(chainId);
    if (def?.builtIn) {
      try {
        registerChain({ chainId: def.chainId, name: def.name, rpcUrl });
      } catch {
        // ignore a bad override
      }
    }
  }
  loaded = true;
}

export function listNetworks(): MinervaChainDefinition[] {
  return listChains();
}

export interface NetworkProbe {
  chainId: number;
  latencyMs: number;
}

export async function probeNetwork(rpcUrl: string): Promise<NetworkProbe> {
  const started = Date.now();
  const chainId = await probeRpcChainId(rpcUrl);
  return { chainId, latencyMs: Date.now() - started };
}

/** Adds a custom network after confirming the RPC reports the declared chain id. */
export async function addCustomNetwork(input: CustomChainInput): Promise<MinervaChainDefinition> {
  const probe = await probeNetwork(input.rpcUrl);
  if (probe.chainId !== input.chainId) {
    throw new Error(`The RPC reports chain id ${probe.chainId}, not ${input.chainId}.`);
  }
  const existing = getChainDefinition(input.chainId);
  if (existing?.builtIn) throw new Error(`Chain id ${input.chainId} is a built-in Minerva network. Edit its RPC URL instead.`);
  const def = registerChain(input);
  const stored = await readStored();
  await writeStored({
    ...stored,
    custom: [...stored.custom.filter((c) => c.chainId !== input.chainId), input],
  });
  emitWalletChange();
  return def;
}

export async function removeCustomNetwork(chainId: number): Promise<void> {
  const def = getChainDefinition(chainId);
  if (def?.builtIn) throw new Error("Built-in networks cannot be removed.");
  unregisterChain(chainId);
  const stored = await readStored();
  await writeStored({ ...stored, custom: stored.custom.filter((c) => c.chainId !== chainId) });
  emitWalletChange();
}

/** Overrides (or with `undefined` restores) the RPC URL of a built-in network. */
export async function setBuiltInRpcOverride(chainId: number, rpcUrl: string | undefined): Promise<MinervaChainDefinition> {
  const def = getChainDefinition(chainId);
  if (!def?.builtIn) throw new Error("Only built-in networks take an RPC override.");
  const stored = await readStored();
  const overrides = { ...stored.rpcOverrides };
  if (rpcUrl) {
    const probe = await probeNetwork(rpcUrl);
    if (probe.chainId !== chainId) throw new Error(`The RPC reports chain id ${probe.chainId}, not ${chainId}.`);
    overrides[String(chainId)] = rpcUrl;
    registerChain({ chainId, name: def.name, rpcUrl });
  } else {
    delete overrides[String(chainId)];
    unregisterChain(chainId);
  }
  await writeStored({ ...stored, rpcOverrides: overrides });
  emitWalletChange();
  return getChainDefinition(chainId)!;
}

export async function builtInRpcOverride(chainId: number): Promise<string | undefined> {
  return (await readStored()).rpcOverrides[String(chainId)];
}

export interface NetworkHealth {
  ok: boolean;
  blockNumber?: number;
  latencyMs?: number;
  error?: string;
}

/** Live reachability check: eth_blockNumber with a timeout. */
export async function checkNetworkHealth(def: MinervaChainDefinition, timeoutMs = 6000): Promise<NetworkHealth> {
  const controller = typeof AbortController === "function" ? new AbortController() : undefined;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(def.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      signal: controller?.signal,
    });
    const payload = (await response.json()) as { result?: string; error?: { message?: string } };
    if (typeof payload.result !== "string") return { ok: false, error: payload.error?.message ?? `HTTP ${response.status}` };
    return { ok: true, blockNumber: Number(BigInt(payload.result)), latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
