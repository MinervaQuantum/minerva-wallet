/**
 * WalletConnect v2 (Reown WalletKit) integration.
 *
 * Initialised lazily and only when EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID is set; without it every
 * entry point reports "not configured" and nothing is imported, so unconfigured builds (and the
 * web/desktop export) never load the WalletConnect stack. Session proposals open the same
 * /dapp-connection screen as the browser (meta.source = "walletconnect"), and session requests are
 * mapped onto `handleProviderRequest`, so signing and transactions behave identically.
 */
import { router } from "expo-router";
import type { WalletKit as WalletKitClass, WalletKitTypes } from "@reown/walletkit";
import { getChainDefinition, listChains } from "@minerva/evm";
import { readPublicEnv } from "@/lib/runtimeConfig";
import { onWalletChange } from "@/lib/walletEvents";
import { toProviderError } from "./errors";
import { handleProviderRequest, WALLET_EVENTS, WALLET_METHODS, type ConnectRequestPayload, type ConnectRequestResult } from "./providerHandler";
import { createDappRequest, rejectDappRequest, type DappRequestMeta } from "./requestBridge";
import { readDappWalletContext } from "./walletContext";

type WalletKitInstance = InstanceType<typeof WalletKitClass>;

export const WC_ERRORS = {
  userRejected: { code: 5000, message: "User rejected." },
  unsupportedChains: { code: 5100, message: "Unsupported chains." },
  unsupportedMethods: { code: 5101, message: "Unsupported methods." },
  userDisconnected: { code: 6000, message: "User disconnected." },
  sessionSettlementFailed: { code: 7000, message: "Session settlement failed." },
} as const;

export type WalletConnectStatus = "unconfigured" | "idle" | "initialising" | "ready" | "error";

export interface WalletConnectSessionSummary {
  topic: string;
  name: string;
  url: string;
  iconUrl?: string;
  accounts: string[];
  chainIds: number[];
  expiry: number;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let status: WalletConnectStatus = "idle";
let lastError: string | undefined;
let instance: WalletKitInstance | undefined;
let initPromise: Promise<WalletKitInstance | undefined> | undefined;
const proposalRequests = new Map<number, string>();
let lastSeen: { chainId?: number; address?: string } = {};

export function walletConnectProjectId(): string | undefined {
  const value = readPublicEnv("EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID")?.trim();
  return value ? value : undefined;
}

export function isWalletConnectConfigured(): boolean {
  return walletConnectProjectId() !== undefined;
}

export function walletConnectStatus(): { status: WalletConnectStatus; error?: string } {
  if (!isWalletConnectConfigured()) return { status: "unconfigured" };
  return { status, error: lastError };
}

export function onWalletConnectChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

function setStatus(next: WalletConnectStatus, error?: string) {
  status = next;
  lastError = error;
  notify();
}

function parseEip155(chain: string | undefined): number | undefined {
  if (!chain) return undefined;
  const match = /^eip155:(\d+)$/.exec(chain);
  return match ? Number(match[1]) : undefined;
}

function registeredLaunchedChainIds(): number[] {
  return listChains()
    .filter((c) => c.launched)
    .map((c) => c.chainId);
}

function metaFromPeer(metadata: { name?: string; url?: string; icons?: string[] } | undefined): DappRequestMeta {
  const url = metadata?.url && /^https?:\/\//i.test(metadata.url) ? metadata.url : undefined;
  let origin = url ?? "walletconnect";
  try {
    if (url) origin = new URL(url).origin;
  } catch {
    origin = url ?? "walletconnect";
  }
  return { origin, name: metadata?.name || undefined, iconUrl: metadata?.icons?.[0], source: "walletconnect" };
}

export function listWalletConnectSessions(): WalletConnectSessionSummary[] {
  if (!instance) return [];
  try {
    return Object.values(instance.getActiveSessions()).map((session) => {
      const eip155 = session.namespaces?.eip155;
      const accounts = Array.from(new Set((eip155?.accounts ?? []).map((a) => a.split(":")[2] ?? "").filter(Boolean)));
      const chainIds = Array.from(
        new Set((eip155?.chains ?? eip155?.accounts?.map((a) => a.split(":").slice(0, 2).join(":")) ?? []).map(parseEip155).filter((c): c is number => c !== undefined)),
      );
      return {
        topic: session.topic,
        name: session.peer?.metadata?.name || "Unknown app",
        url: session.peer?.metadata?.url || "",
        iconUrl: session.peer?.metadata?.icons?.[0],
        accounts,
        chainIds,
        expiry: session.expiry,
      };
    });
  } catch {
    return [];
  }
}

async function handleSessionProposal(kit: WalletKitInstance, proposal: WalletKitTypes.SessionProposal): Promise<void> {
  const { id, params } = proposal;
  const meta = metaFromPeer(params.proposer?.metadata);
  const required = params.requiredNamespaces ?? {};
  const optional = params.optionalNamespaces ?? {};

  const foreignRequired = Object.keys(required).filter((ns) => ns !== "eip155");
  const registered = registeredLaunchedChainIds();
  const requiredChains = (required.eip155?.chains ?? []).map(parseEip155).filter((c): c is number => c !== undefined);
  const optionalChains = (optional.eip155?.chains ?? []).map(parseEip155).filter((c): c is number => c !== undefined);
  const unsupportedRequired = requiredChains.filter((c) => !registered.includes(c));

  if (foreignRequired.length > 0 || unsupportedRequired.length > 0) {
    await kit.rejectSession({ id, reason: WC_ERRORS.unsupportedChains }).catch(() => undefined);
    notify();
    return;
  }

  const ctx = await readDappWalletContext();
  if (!ctx.activeAddress) {
    await kit.rejectSession({ id, reason: { code: 5000, message: "No Minerva Account is available." } }).catch(() => undefined);
    return;
  }
  const address = ctx.activeAddress.toLowerCase();

  const { request, promise } = createDappRequest<ConnectRequestResult, ConnectRequestPayload>("connect", meta, {
    accounts: [address],
    chainId: ctx.chainId,
    requiredChainIds: requiredChains,
    optionalChainIds: optionalChains,
  } as ConnectRequestPayload);
  proposalRequests.set(id, request.id);
  router.push({ pathname: "/dapp-connection" as never, params: { requestId: request.id } });

  let result: ConnectRequestResult | undefined;
  try {
    result = await promise;
  } catch {
    proposalRequests.delete(id);
    await kit.rejectSession({ id, reason: WC_ERRORS.userRejected }).catch(() => undefined);
    notify();
    return;
  }
  proposalRequests.delete(id);

  const approvedAccounts = (result?.accounts?.length ? result.accounts : [address]).map((a) => a.toLowerCase());
  const chains = Array.from(new Set([ctx.chainId, ...requiredChains, ...optionalChains.filter((c) => registered.includes(c))]));
  const methods = Array.from(new Set([...(required.eip155?.methods ?? []), ...(optional.eip155?.methods ?? []), ...WALLET_METHODS]));
  const events = Array.from(new Set([...(required.eip155?.events ?? []), ...(optional.eip155?.events ?? []), ...WALLET_EVENTS]));
  const namespaces = {
    eip155: {
      chains: chains.map((c) => `eip155:${c}`),
      accounts: chains.flatMap((c) => approvedAccounts.map((a) => `eip155:${c}:${a}`)),
      methods,
      events,
    },
  };
  try {
    await kit.approveSession({ id, namespaces });
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Could not approve the WalletConnect session.";
  }
  notify();
}

async function handleSessionRequest(kit: WalletKitInstance, event: WalletKitTypes.SessionRequest): Promise<void> {
  const { id, topic, params } = event;
  const session = kit.getActiveSessions()[topic];
  const meta = metaFromPeer(session?.peer?.metadata);
  const requestedChainId = parseEip155(params.chainId);
  const ctx = await readDappWalletContext();
  const rpcParams = Array.isArray(params.request.params) ? params.request.params : params.request.params === undefined ? [] : [params.request.params];

  try {
    const result = await handleProviderRequest(ctx, meta, params.request.method, rpcParams, {
      implicitlyConnected: true,
      requestedChainId,
    });
    await kit.respondSessionRequest({ topic, response: { id, jsonrpc: "2.0", result } });
  } catch (error) {
    const providerError = toProviderError(error);
    await kit
      .respondSessionRequest({ topic, response: { id, jsonrpc: "2.0", error: { code: providerError.code, message: providerError.message } } })
      .catch(() => undefined);
  }
  notify();
}

async function broadcastWalletChange(kit: WalletKitInstance): Promise<void> {
  const ctx = await readDappWalletContext().catch(() => undefined);
  if (!ctx) return;
  const address = ctx.activeAddress?.toLowerCase();
  const chainChanged = lastSeen.chainId !== undefined && lastSeen.chainId !== ctx.chainId;
  const accountChanged = lastSeen.address !== undefined && lastSeen.address !== address;
  lastSeen = { chainId: ctx.chainId, address };
  if (!chainChanged && !accountChanged) return;
  for (const session of Object.values(kit.getActiveSessions())) {
    const chainRef = `eip155:${ctx.chainId}`;
    if (chainChanged) {
      void kit.emitSessionEvent({ topic: session.topic, event: { name: "chainChanged", data: ctx.chainId }, chainId: chainRef }).catch(() => undefined);
    }
    if (accountChanged) {
      void kit
        .emitSessionEvent({ topic: session.topic, event: { name: "accountsChanged", data: address ? [address] : [] }, chainId: chainRef })
        .catch(() => undefined);
    }
  }
}

/** Initialises WalletKit once. Resolves undefined when WalletConnect is not configured. */
export function initWalletConnect(): Promise<WalletKitInstance | undefined> {
  const projectId = walletConnectProjectId();
  if (!projectId) {
    status = "unconfigured";
    return Promise.resolve(undefined);
  }
  if (instance) return Promise.resolve(instance);
  if (initPromise) return initPromise;
  setStatus("initialising");
  initPromise = (async () => {
    try {
      const [{ Core }, walletKitModule] = await Promise.all([import("@walletconnect/core"), import("@reown/walletkit")]);
      const WalletKit = walletKitModule.WalletKit ?? walletKitModule.default;
      const core = new Core({ projectId });
      const kit = await WalletKit.init({
        core,
        metadata: {
          name: "Minerva Wallet",
          description: "Post-quantum (ML-DSA-65) smart accounts on the Minerva network.",
          url: "https://minervachain.org",
          icons: ["https://minervachain.org/favicon.ico"],
          redirect: { native: "minerva://" },
        },
      });
      kit.on("session_proposal", (proposal) => {
        void handleSessionProposal(kit, proposal);
      });
      kit.on("session_request", (request) => {
        void handleSessionRequest(kit, request);
      });
      kit.on("session_delete", () => notify());
      kit.on("proposal_expire", ({ id }) => {
        const requestId = proposalRequests.get(id);
        if (requestId) rejectDappRequest(requestId);
        proposalRequests.delete(id);
        notify();
      });
      onWalletChange(() => {
        void broadcastWalletChange(kit);
      });
      const ctx = await readDappWalletContext().catch(() => undefined);
      lastSeen = { chainId: ctx?.chainId, address: ctx?.activeAddress?.toLowerCase() };
      instance = kit;
      setStatus("ready");
      return kit;
    } catch (error) {
      initPromise = undefined;
      setStatus("error", error instanceof Error ? error.message : "WalletConnect could not start.");
      return undefined;
    }
  })();
  return initPromise;
}

export function isWalletConnectUri(value: string): boolean {
  return /^wc:[0-9a-f]+@2\?/i.test(value.trim());
}

export async function pairWalletConnect(uri: string): Promise<void> {
  const trimmed = uri.trim();
  if (!isWalletConnectUri(trimmed)) throw new Error("That is not a WalletConnect v2 URI (it should start with wc: and contain @2).");
  const kit = await initWalletConnect();
  if (!kit) throw new Error(lastError ?? "WalletConnect is not configured in this build.");
  await kit.pair({ uri: trimmed });
}

export async function disconnectWalletConnectSession(topic: string): Promise<void> {
  const kit = await initWalletConnect();
  if (!kit) return;
  await kit.disconnectSession({ topic, reason: WC_ERRORS.userDisconnected });
  notify();
}

/** Registered chains WalletConnect peers may use, for display. */
export function walletConnectChainNames(chainIds: number[]): string {
  return chainIds.map((id) => getChainDefinition(id)?.name ?? `Chain ${id}`).join(", ");
}
