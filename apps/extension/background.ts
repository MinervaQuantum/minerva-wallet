/**
 * Background service worker.
 *
 * Hosts the request-modal opener: when a content-script relay forwards a
 * provider event, this opens tabs/request.html?type=... in a popup-shaped
 * window so the user sees the matching modal screen.
 *
 * Minerva is PQ-native only: eth_sendTransaction requests are reviewed here
 * and submitted as Minerva Account MinervaPQTxV1 executions, never as raw EOA
 * transactions.
 */

import {
  MINERVA_TESTNET_CHAIN_ID,
  defaultMinervaRpcUrl,
  signMLDSA65,
  supportedChainId,
} from "@minerva/evm";
import { getAddress, isHex, keccak256, stringToHex, type Hex } from "viem";
import {
  EXTENSION_ACCOUNTS_STORAGE_KEY,
  accountAddressOfRecord,
  createExtensionWalletProfile,
  getActiveExtensionAccount,
  listExtensionAccounts,
  setActiveExtensionAccount,
  unlockExtensionWalletProfile,
  type ExtensionAccountsRegistry,
  type ExtensionAccountSummary,
} from "./lib/extensionWalletVault";
import { sendExtensionDappTransaction } from "./lib/extensionWalletRuntime";
import { AUTO_LOCK_ALARM, clearUnlockedSession, readUnlockedSession } from "./lib/extensionSession";

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const CHAIN_ID = supportedChainId(env?.PLASMO_PUBLIC_MINERVA_CHAIN_ID ?? MINERVA_TESTNET_CHAIN_ID);
const CHAIN_ID_HEX = `0x${CHAIN_ID.toString(16)}`;
const RPC_URL = env?.PLASMO_PUBLIC_MINERVA_RPC_URL ?? defaultMinervaRpcUrl(CHAIN_ID);
const CONNECTIONS_KEY = "minerva:connections";
const PENDING_PROVIDER_REQUESTS_KEY = "minerva:provider-pending.v1";
const PROVIDER_RESPONSES_KEY = "minerva:provider-responses.v1";
const PROVIDER_DIAGNOSTICS_KEY = "minerva:provider-diagnostics.v1";
const REQUEST_TTL_MS = 10 * 60 * 1000;

type RequestType = "connect" | "tx" | "sign";
type Decision = "approve" | "limited" | "reject";

interface ProviderRequestMessage {
  kind: "minerva:provider-request";
  requestId: string;
  origin: string;
  method: string;
  params?: unknown[];
  tabId?: number;
  frameId?: number;
}

interface ResolveRequestMessage {
  kind: "minerva:resolve-request";
  requestId: string;
  decision: Decision;
  passcode?: string;
  /** Accounts the user chose to connect (connect requests). Defaults to the active account. */
  accountIds?: string[];
}

/** One origin's permission grant. `accountIds` lists the wallet accounts the site may see. */
interface StoredConnection {
  origin: string;
  hostname: string;
  connectedAt: number;
  lastUsedAt?: number;
  permissions: string[];
  compatibilityMode: boolean;
  accountIds: string[];
}

interface PendingRequestAccount {
  id: string;
  label: string;
  address?: string;
  active: boolean;
  connected: boolean;
}

interface ProviderResponse {
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

interface PendingRequest {
  requestId: string;
  method: string;
  origin: string;
  params?: unknown[];
  createdAt: number;
  expiresAt: number;
  tabId?: number;
  frameId?: number;
  respond?: (response: ProviderResponse) => void | Promise<void>;
}

interface StoredProviderResponse {
  response: ProviderResponse;
  createdAt: number;
  expiresAt: number;
}

interface ProviderDiagnostic {
  id: string;
  at: number;
  event: string;
  requestId?: string;
  origin?: string;
  method?: string;
  detail?: string;
  extensionVersion: string;
}

interface ParsedTransactionRequest {
  from?: Hex;
  to: Hex;
  valueWei: string;
  data: Hex;
}

interface MinervaMessageProof {
  address: string;
  chainId: number;
  algorithm: "ML-DSA-65";
  publicKeyCommitment: Hex;
  keyVersion: number;
  messageHash: Hex;
  signature: Hex;
}

interface PendingRequestDetails {
  requestId: string;
  type: RequestType;
  method: string;
  origin: string;
  hostname: string;
  chainId: number;
  chainIdHex: string;
  account?: string;
  accountLabel?: string;
  /** True when the site holds a grant for the active account. */
  connected: boolean;
  /** True when the site holds a grant for any account. */
  siteConnected: boolean;
  permissions: string[];
  params?: unknown[];
  transaction?: ParsedTransactionRequest;
  parseError?: string;
  /** Wallet accounts the user can pick from on the connect screen. */
  accounts: PendingRequestAccount[];
  /** True when an unlocked session exists, so no passcode prompt is needed. */
  sessionUnlocked: boolean;
}

const MAIN_WORLD_PROVIDER_SCRIPT_ID = "contentsInjectProvider";
const pendingRequests = new Map<string, PendingRequest>();
const approvalWindowIds = new Map<string, number>();

function hostnameFromOrigin(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

function providerError(code: number, message: string): ProviderResponse {
  return { error: { code, message } };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Minerva request failed.";
}

function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "unknown";
  }
}

async function recordProviderDiagnostic(
  event: string,
  details: Partial<Omit<ProviderDiagnostic, "id" | "at" | "event" | "extensionVersion">> = {},
): Promise<void> {
  try {
    const entry: ProviderDiagnostic = {
      id: `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`,
      at: nowMs(),
      event,
      extensionVersion: extensionVersion(),
      ...details,
    };
    const current = await new Promise<ProviderDiagnostic[]>((resolve) => {
      chrome.storage.local.get(PROVIDER_DIAGNOSTICS_KEY, (items) => {
        resolve((items[PROVIDER_DIAGNOSTICS_KEY] as ProviderDiagnostic[] | undefined) ?? []);
      });
    });
    await chrome.storage.local.set({ [PROVIDER_DIAGNOSTICS_KEY]: [entry, ...current].slice(0, 60) });
  } catch {
    // Diagnostics must never block provider requests.
  }
}

function requestTypeForMethod(method: string): RequestType | null {
  if (method === "eth_requestAccounts" || method === "wallet_requestPermissions") return "connect";
  if (method === "eth_sendTransaction") return "tx";
  if (
    method === "minerva_signMessage" ||
    method === "minerva_signTypedData" ||
    method === "eth_sign" ||
    method === "personal_sign" ||
    method === "eth_signTypedData" ||
    method === "eth_signTypedData_v4"
  ) {
    return "sign";
  }
  return null;
}

function isMinervaMessageSigningMethod(method: string): boolean {
  return method === "minerva_signMessage" || method === "minerva_signTypedData";
}

function isLegacyMessageSigningMethod(method: string): boolean {
  return (
    method === "eth_sign" ||
    method === "personal_sign" ||
    method === "eth_signTypedData" ||
    method === "eth_signTypedData_v4"
  );
}

function isRpcPassthroughMethod(method: string): boolean {
  return [
    "eth_blockNumber",
    "eth_call",
    "eth_estimateGas",
    "eth_feeHistory",
    "eth_gasPrice",
    "eth_getBalance",
    "eth_getBlockByHash",
    "eth_getBlockByNumber",
    "eth_getCode",
    "eth_getLogs",
    "eth_getStorageAt",
    "eth_getTransactionByHash",
    "eth_getTransactionCount",
    "eth_getTransactionReceipt",
  ].includes(method);
}

function nowMs() {
  return Date.now();
}

function isExpired(expiresAt?: number): boolean {
  return typeof expiresAt === "number" && expiresAt <= nowMs();
}

async function getPendingProviderRequests(): Promise<Record<string, PendingRequest>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(PENDING_PROVIDER_REQUESTS_KEY, (items) => {
      const raw = (items[PENDING_PROVIDER_REQUESTS_KEY] as Record<string, PendingRequest> | undefined) ?? {};
      const active = Object.fromEntries(Object.entries(raw).filter(([, request]) => !isExpired(request.expiresAt)));
      if (Object.keys(active).length !== Object.keys(raw).length) {
        void chrome.storage.local.set({ [PENDING_PROVIDER_REQUESTS_KEY]: active });
      }
      resolve(active);
    });
  });
}

async function savePendingProviderRequest(request: PendingRequest): Promise<void> {
  const requests = await getPendingProviderRequests();
  const { respond: _respond, ...stored } = request;
  requests[request.requestId] = stored;
  await chrome.storage.local.set({ [PENDING_PROVIDER_REQUESTS_KEY]: requests });
}

async function readPendingProviderRequest(requestId: string): Promise<PendingRequest | undefined> {
  const request = (await getPendingProviderRequests())[requestId];
  if (!request || isExpired(request.expiresAt)) return undefined;
  return request;
}

async function deletePendingProviderRequest(requestId: string): Promise<void> {
  const requests = await getPendingProviderRequests();
  delete requests[requestId];
  await chrome.storage.local.set({ [PENDING_PROVIDER_REQUESTS_KEY]: requests });
}

async function getStoredProviderResponses(): Promise<Record<string, StoredProviderResponse>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(PROVIDER_RESPONSES_KEY, (items) => {
      const raw = (items[PROVIDER_RESPONSES_KEY] as Record<string, StoredProviderResponse> | undefined) ?? {};
      const active = Object.fromEntries(Object.entries(raw).filter(([, entry]) => !isExpired(entry.expiresAt)));
      if (Object.keys(active).length !== Object.keys(raw).length) {
        void chrome.storage.local.set({ [PROVIDER_RESPONSES_KEY]: active });
      }
      resolve(active);
    });
  });
}

async function storeProviderResponse(requestId: string, response: ProviderResponse): Promise<void> {
  const responses = await getStoredProviderResponses();
  responses[requestId] = {
    response,
    createdAt: nowMs(),
    expiresAt: nowMs() + REQUEST_TTL_MS,
  };
  await chrome.storage.local.set({ [PROVIDER_RESPONSES_KEY]: responses });
}

async function readProviderResponse(requestId: string): Promise<StoredProviderResponse | undefined> {
  const response = (await getStoredProviderResponses())[requestId];
  if (!response || isExpired(response.expiresAt)) return undefined;
  return response;
}

async function readRawConnections(): Promise<Record<string, StoredConnection>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(CONNECTIONS_KEY, (items) => {
      resolve((items[CONNECTIONS_KEY] as Record<string, StoredConnection> | undefined) ?? {});
    });
  });
}

/**
 * Connections with `accountIds` normalised. Grants recorded before accounts were tracked
 * belonged to the only account that existed, so they are attached to the active account.
 */
async function getConnections(): Promise<Record<string, StoredConnection>> {
  const raw = await readRawConnections();
  let changed = false;
  let activeId: string | undefined;
  for (const [origin, connection] of Object.entries(raw)) {
    if (Array.isArray(connection.accountIds)) continue;
    activeId ??= (await getActiveExtensionAccount())?.id;
    raw[origin] = { ...connection, accountIds: activeId ? [activeId] : [] };
    changed = true;
  }
  if (changed) await chrome.storage.local.set({ [CONNECTIONS_KEY]: raw });
  return raw;
}

async function currentAccount(): Promise<ExtensionAccountSummary | undefined> {
  return getActiveExtensionAccount();
}

async function currentAccountAddress(): Promise<string | undefined> {
  if (env?.PLASMO_PUBLIC_MINERVA_ACCOUNT_ADDRESS?.startsWith("0x")) {
    return env.PLASMO_PUBLIC_MINERVA_ACCOUNT_ADDRESS;
  }
  return (await currentAccount())?.address;
}

async function getOrCreateAccountAddress(passcode?: string): Promise<string | undefined> {
  const current = await currentAccountAddress();
  if (current) return current;
  if (!passcode) return undefined;
  await createExtensionWalletProfile(passcode);
  return currentAccountAddress();
}

/** True when `origin` holds a grant that covers the active account. */
function connectionCoversAccount(connection: StoredConnection | undefined, accountId: string | undefined): boolean {
  return Boolean(connection && accountId && connection.accountIds.includes(accountId));
}

/**
 * Accounts a site may see right now. MetaMask semantics: the active account when the site
 * is connected to it, otherwise nothing (even if other accounts are connected).
 */
async function connectedAccountResult(origin: string): Promise<string[]> {
  const connection = await touchConnection(origin);
  if (!connection) return [];
  const account = await currentAccount();
  if (!connectionCoversAccount(connection, account?.id)) return [];
  const address = (await currentAccountAddress()) ?? account?.address;
  return address ? [address] : [];
}

async function permissionsResult(origin: string): Promise<unknown[]> {
  const connection = await touchConnection(origin);
  if (!connection) return [];
  const account = await currentAccount();
  if (!connectionCoversAccount(connection, account?.id)) return [];
  const address = (await currentAccountAddress()) ?? account?.address;
  return [
    {
      parentCapability: "eth_accounts",
      invoker: origin,
      caveats: address
        ? [
            {
              type: "restrictReturnedAccounts",
              value: [address],
            },
          ]
        : [],
      date: Date.now(),
    },
  ];
}

async function readConnection(origin: string): Promise<StoredConnection | undefined> {
  return (await getConnections())[origin];
}

/** Grants `accountIds` to `origin` (merged with any accounts already connected). */
async function setConnection(origin: string, permissions: string[], accountIds: string[]) {
  const connections = await getConnections();
  const existing = connections[origin];
  const merged = [...new Set([...(existing?.accountIds ?? []), ...accountIds])];
  connections[origin] = {
    origin,
    hostname: hostnameFromOrigin(origin),
    connectedAt: existing?.connectedAt ?? Date.now(),
    lastUsedAt: Date.now(),
    permissions,
    compatibilityMode: permissions.includes("limited"),
    accountIds: merged,
  };
  await chrome.storage.local.set({ [CONNECTIONS_KEY]: connections });
}

async function touchConnection(origin: string): Promise<StoredConnection | undefined> {
  const connections = await getConnections();
  const connection = connections[origin];
  if (!connection) return undefined;
  connections[origin] = { ...connection, lastUsedAt: Date.now() };
  await chrome.storage.local.set({ [CONNECTIONS_KEY]: connections });
  return connections[origin];
}

async function disconnectOrigin(origin: string, announce = true) {
  const connections = await getConnections();
  const existed = Boolean(connections[origin]);
  delete connections[origin];
  await chrome.storage.local.set({ [CONNECTIONS_KEY]: connections });
  if (existed && announce) {
    await emitProviderEvent(origin, "accountsChanged", []);
    await emitProviderEvent(origin, "disconnect", { code: 4900, message: "Minerva Wallet disconnected." });
  }
}

/** Revokes one account from a site; the site is disconnected once no account remains. */
async function revokeAccountFromOrigin(origin: string, accountId: string) {
  const connections = await getConnections();
  const connection = connections[origin];
  if (!connection) return;
  const remaining = connection.accountIds.filter((id) => id !== accountId);
  if (remaining.length === 0) {
    await disconnectOrigin(origin);
    return;
  }
  connections[origin] = { ...connection, accountIds: remaining };
  await chrome.storage.local.set({ [CONNECTIONS_KEY]: connections });
  await emitProviderEvent(origin, "accountsChanged", await connectedAccountResult(origin));
}

/** Drops grants for accounts that no longer exist in the wallet. */
async function pruneConnectionsForAccounts(existingIds: Set<string>) {
  const connections = await getConnections();
  const removedOrigins: string[] = [];
  const changedOrigins: string[] = [];
  for (const [origin, connection] of Object.entries(connections)) {
    const remaining = connection.accountIds.filter((id) => existingIds.has(id));
    if (remaining.length === connection.accountIds.length) continue;
    if (remaining.length === 0) {
      delete connections[origin];
      removedOrigins.push(origin);
    } else {
      connections[origin] = { ...connection, accountIds: remaining };
      changedOrigins.push(origin);
    }
  }
  if (removedOrigins.length === 0 && changedOrigins.length === 0) return;
  await chrome.storage.local.set({ [CONNECTIONS_KEY]: connections });
  for (const origin of removedOrigins) {
    await emitProviderEvent(origin, "accountsChanged", []);
    await emitProviderEvent(origin, "disconnect", { code: 4900, message: "Minerva Wallet disconnected." });
  }
  for (const origin of changedOrigins) {
    await emitProviderEvent(origin, "accountsChanged", await connectedAccountResult(origin));
  }
}

async function hasConnection(origin: string): Promise<boolean> {
  return Boolean(await touchConnection(origin));
}

/** True when the site is connected to the active account specifically. */
async function hasConnectionForActiveAccount(origin: string): Promise<boolean> {
  const connection = await touchConnection(origin);
  if (!connection) return false;
  return connectionCoversAccount(connection, (await currentAccount())?.id);
}

function tabsForOrigin(origin: string): Promise<number[]> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({}, (tabs) => {
        if (chrome.runtime.lastError) {
          resolve([]);
          return;
        }
        const ids: number[] = [];
        for (const tab of tabs) {
          if (tab.id === undefined || !tab.url) continue;
          try {
            if (new URL(tab.url).origin === origin) ids.push(tab.id);
          } catch {
            // Non-http tab.
          }
        }
        resolve(ids);
      });
    } catch {
      resolve([]);
    }
  });
}

/** Pushes an EIP-1193 event to every open tab of `origin` through the content relay. */
async function emitProviderEvent(origin: string, event: "accountsChanged" | "disconnect", data: unknown): Promise<void> {
  const tabIds = await tabsForOrigin(origin);
  for (const tabId of tabIds) {
    try {
      chrome.tabs.sendMessage(tabId, { source: "minerva:provider-event", event, data }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // The tab may have no relay (chrome:// pages, closed tabs).
    }
  }
  if (tabIds.length > 0) {
    void recordProviderDiagnostic(`event:${event}`, { origin, detail: `tabs:${tabIds.length}` });
  }
}

/** After the active account changes, every connected site learns which account it may see now. */
async function announceActiveAccountChange(): Promise<void> {
  const connections = await getConnections();
  for (const origin of Object.keys(connections)) {
    await emitProviderEvent(origin, "accountsChanged", await connectedAccountResult(origin));
  }
}

async function rpcPassthrough(method: string, params: unknown[] = []): Promise<ProviderResponse> {
  try {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const payload = (await response.json()) as { result?: unknown; error?: { code?: number; message?: string } };
    if (payload.error) {
      return providerError(payload.error.code ?? -32000, payload.error.message ?? `${method} failed`);
    }
    return { result: payload.result };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "RPC request failed";
    return providerError(4900, `Minerva RPC unavailable at ${RPC_URL}: ${detail}`);
  }
}

async function openRequestWindow(
  type: RequestType,
  request: ProviderRequestMessage,
  respond: (response: ProviderResponse) => void | Promise<void>,
) {
  const createdAt = nowMs();
  const pending: PendingRequest = {
    requestId: request.requestId,
    method: request.method,
    origin: request.origin,
    params: request.params,
    createdAt,
    expiresAt: createdAt + REQUEST_TTL_MS,
    tabId: request.tabId,
    frameId: request.frameId,
    respond,
  };
  pendingRequests.set(request.requestId, pending);
  await savePendingProviderRequest(pending);
  await recordProviderDiagnostic("request:pending", {
    requestId: request.requestId,
    origin: request.origin,
    method: request.method,
  });

  const params = new URLSearchParams({
    type,
    requestId: request.requestId,
    origin: request.origin,
    method: request.method,
  });
  const url = chrome.runtime.getURL(`tabs/request.html?${params.toString()}`);

  const completeOpenFailure = (detail: string) => {
    void completePendingRequest(request.requestId, providerError(5000, detail));
  };

  const openFallbackTab = (reason: string) => {
    void recordProviderDiagnostic("approval:popup-fallback", {
      requestId: request.requestId,
      origin: request.origin,
      method: request.method,
      detail: reason,
    });
    chrome.tabs.create({ url, active: true }, (tab) => {
      if (chrome.runtime.lastError) {
        const detail = chrome.runtime.lastError.message ?? "Could not open Minerva review tab.";
        void recordProviderDiagnostic("approval:tab-open-failed", {
          requestId: request.requestId,
          origin: request.origin,
          method: request.method,
          detail,
        });
        completeOpenFailure(detail);
        return;
      }
      if (tab?.id === undefined) {
        const detail = "Chrome did not return a Minerva Wallet approval tab.";
        void recordProviderDiagnostic("approval:tab-open-empty", {
          requestId: request.requestId,
          origin: request.origin,
          method: request.method,
          detail,
        });
        completeOpenFailure(detail);
        return;
      }
      void recordProviderDiagnostic("approval:open-tab", {
        requestId: request.requestId,
        origin: request.origin,
        method: request.method,
        detail: `tab:${tab.id}`,
      });
    });
  };

  chrome.windows.create({ url, type: "popup", width: 420, height: 720, focused: true }, (createdWindow) => {
    if (chrome.runtime.lastError) {
      const detail = chrome.runtime.lastError.message ?? "Could not open Minerva review window.";
      void recordProviderDiagnostic("approval:open-failed", {
        requestId: request.requestId,
        origin: request.origin,
        method: request.method,
        detail,
      });
      openFallbackTab(detail);
      return;
    }
    if (createdWindow?.id === undefined) {
      const detail = "Chrome did not return a Minerva Wallet approval window.";
      void recordProviderDiagnostic("approval:open-empty", {
        requestId: request.requestId,
        origin: request.origin,
        method: request.method,
        detail,
      });
      openFallbackTab(detail);
      return;
    }
    approvalWindowIds.set(request.requestId, createdWindow.id);
    void recordProviderDiagnostic("approval:open", {
      requestId: request.requestId,
      origin: request.origin,
      method: request.method,
      detail: `window:${createdWindow.id}`,
    });
  });
}

async function ensureRequestWindow(requestId: string): Promise<{ ok: boolean; error?: string }> {
  const pending = pendingRequests.get(requestId) ?? (await readPendingProviderRequest(requestId));
  if (!pending) return { ok: false, error: "Minerva request expired." };
  const type = requestTypeForMethod(pending.method);
  if (!type) return { ok: false, error: `Minerva provider does not support ${pending.method}.` };

  const params = new URLSearchParams({
    type,
    requestId: pending.requestId,
    origin: pending.origin,
    method: pending.method,
  });
  const url = chrome.runtime.getURL(`tabs/request.html?${params.toString()}`);

  const openNewWindow = () => {
    chrome.windows.create({ url, type: "popup", width: 420, height: 720, focused: true }, (createdWindow) => {
      if (chrome.runtime.lastError) {
        const detail = chrome.runtime.lastError.message ?? "Could not open Minerva Wallet approval window.";
        void recordProviderDiagnostic("approval:ensure-open-failed", {
          requestId: pending.requestId,
          origin: pending.origin,
          method: pending.method,
          detail,
        });
        void completePendingRequest(pending.requestId, providerError(5000, detail));
        return;
      }
      if (createdWindow?.id === undefined) {
        const detail = "Chrome did not return a Minerva Wallet approval window.";
        void recordProviderDiagnostic("approval:ensure-open-empty", {
          requestId: pending.requestId,
          origin: pending.origin,
          method: pending.method,
          detail,
        });
        void completePendingRequest(pending.requestId, providerError(5000, detail));
        return;
      }
      approvalWindowIds.set(pending.requestId, createdWindow.id);
      void recordProviderDiagnostic("approval:ensure-open", {
        requestId: pending.requestId,
        origin: pending.origin,
        method: pending.method,
        detail: `window:${createdWindow.id}`,
      });
    });
  };

  const existingWindowId = approvalWindowIds.get(requestId);
  if (existingWindowId !== undefined) {
    chrome.windows.update(existingWindowId, { focused: true }, (window) => {
      if (chrome.runtime.lastError || !window) {
        approvalWindowIds.delete(requestId);
        openNewWindow();
        return;
      }
      void recordProviderDiagnostic("approval:ensure-focus", {
        requestId: pending.requestId,
        origin: pending.origin,
        method: pending.method,
        detail: `window:${existingWindowId}`,
      });
    });
    return { ok: true };
  }

  openNewWindow();
  return { ok: true };
}

function quantityToBigInt(value: unknown, fallback = 0n): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return value.startsWith("0x") ? BigInt(value) : BigInt(value);
  } catch {
    throw new Error(`Invalid transaction value: ${value}`);
  }
}

function normalizeData(value: unknown): Hex {
  const data = typeof value === "string" && value.length > 0 ? value : "0x";
  if (!isHex(data)) throw new Error("Transaction calldata must be 0x-prefixed hex.");
  return data as Hex;
}

function parseTransactionRequest(params: unknown[] = []): ParsedTransactionRequest {
  const tx = params[0] as Record<string, unknown> | undefined;
  if (!tx || typeof tx !== "object") throw new Error("Missing eth_sendTransaction payload.");
  if (typeof tx.to !== "string" || !tx.to.startsWith("0x")) {
    throw new Error("Contract deployment transactions are not supported by Minerva Wallet yet.");
  }
  const from = typeof tx.from === "string" && tx.from.startsWith("0x") ? (getAddress(tx.from) as Hex) : undefined;
  const to = getAddress(tx.to) as Hex;
  const valueWei = quantityToBigInt(tx.value).toString();
  const data = normalizeData(tx.data ?? tx.input);
  return { from, to, valueWei, data };
}

function messagePayloadFromParams(method: string, params: unknown[] = [], account: string): unknown {
  const [first, second] = params;
  if (typeof first === "string" && first.startsWith("0x") && second !== undefined) {
    if (first.toLowerCase() !== account.toLowerCase()) {
      throw new Error(`This signature request is for ${first.slice(0, 6)}...${first.slice(-4)}, not your active Minerva Account.`);
    }
    return second;
  }
  if (method === "minerva_signTypedData" && second !== undefined) return second;
  return first;
}

function hashMessagePayload(method: string, payload: unknown): Hex {
  if (payload === undefined || payload === null) throw new Error("Missing message payload.");
  if (method === "minerva_signMessage" && typeof payload === "string") {
    const messageHex = isHex(payload) ? (payload as Hex) : stringToHex(payload);
    return keccak256(messageHex);
  }
  const encoded = JSON.stringify(payload);
  if (!encoded) throw new Error("Could not encode message payload.");
  return keccak256(stringToHex(encoded));
}

async function signMinervaMessageProof(
  pending: PendingRequest,
  passcode: string,
  account: string,
): Promise<MinervaMessageProof> {
  const profile = await unlockExtensionWalletProfile(passcode);
  const payload = messagePayloadFromParams(pending.method, pending.params, account);
  const messageHash = hashMessagePayload(pending.method, payload);
  const publicKeyCommitment = profile.currentPublicKeyCommitment ?? keccak256(profile.currentKey.publicKey);
  return {
    address: account,
    chainId: profile.chainId,
    algorithm: "ML-DSA-65",
    publicKeyCommitment,
    keyVersion: profile.keyVersion,
    messageHash,
    signature: signMLDSA65(messageHash, profile.currentKey.privateKey, { context: "MINERVA_MESSAGE_V1" }),
  };
}

async function getPendingRequestDetails(requestId: string): Promise<PendingRequestDetails | undefined> {
  const pending = pendingRequests.get(requestId) ?? (await readPendingProviderRequest(requestId));
  if (!pending) return undefined;
  const type = requestTypeForMethod(pending.method);
  if (!type) return undefined;
  const active = await currentAccount();
  const account = await currentAccountAddress();
  const connection = await readConnection(pending.origin);
  const accounts = (await listExtensionAccounts())
    .filter((a) => !a.hidden || a.active)
    .map<PendingRequestAccount>((a) => ({
      id: a.id,
      label: a.label,
      address: a.address,
      active: a.active,
      connected: Boolean(connection?.accountIds.includes(a.id)),
    }));
  const details: PendingRequestDetails = {
    requestId,
    type,
    method: pending.method,
    origin: pending.origin,
    hostname: hostnameFromOrigin(pending.origin),
    chainId: CHAIN_ID,
    chainIdHex: CHAIN_ID_HEX,
    account,
    accountLabel: active?.label,
    connected: connectionCoversAccount(connection, active?.id),
    siteConnected: Boolean(connection),
    permissions: connection?.permissions ?? [],
    params: pending.params,
    accounts,
    sessionUnlocked: Boolean(await readUnlockedSession()),
  };
  if (type === "tx") {
    try {
      details.transaction = parseTransactionRequest(pending.params);
    } catch (error) {
      details.parseError = messageOf(error);
    }
  }
  return details;
}

async function handleProviderRequest(message: ProviderRequestMessage, respond: (response: ProviderResponse) => void) {
  void recordProviderDiagnostic("request:received", {
    requestId: message.requestId,
    origin: message.origin,
    method: message.method,
  });

  switch (message.method) {
    case "eth_chainId":
      respond({ result: CHAIN_ID_HEX });
      return;
    case "net_version":
      respond({ result: String(CHAIN_ID) });
      return;
    case "web3_clientVersion":
      respond({ result: `MinervaWallet/${extensionVersion()}` });
      return;
    case "eth_accounts":
      respond({ result: await connectedAccountResult(message.origin) });
      return;
    case "eth_coinbase": {
      const accounts = await connectedAccountResult(message.origin);
      respond({ result: accounts[0] ?? null });
      return;
    }
    case "wallet_getPermissions":
      respond({ result: await permissionsResult(message.origin) });
      return;
    case "wallet_switchEthereumChain": {
      const requested = (message.params?.[0] as { chainId?: string } | undefined)?.chainId;
      if (!requested || requested.toLowerCase() !== CHAIN_ID_HEX.toLowerCase()) {
        respond(providerError(4902, `Minerva Wallet only supports chain ${CHAIN_ID_HEX} in this build.`));
        return;
      }
      respond({ result: null });
      return;
    }
    case "wallet_addEthereumChain": {
      const requested = (message.params?.[0] as { chainId?: string } | undefined)?.chainId;
      if (!requested || requested.toLowerCase() !== CHAIN_ID_HEX.toLowerCase()) {
        respond(providerError(4902, `Unsupported Minerva chain. Expected ${CHAIN_ID_HEX}.`));
        return;
      }
      respond({ result: null });
      return;
    }
    case "wallet_revokePermissions":
      await disconnectOrigin(message.origin);
      respond({ result: null });
      return;
  }

  if (isRpcPassthroughMethod(message.method)) {
    respond(await rpcPassthrough(message.method, message.params ?? []));
    return;
  }

  const type = requestTypeForMethod(message.method);
  if (type) {
    if (type !== "connect" && !(await hasConnectionForActiveAccount(message.origin))) {
      respond(providerError(4100, "Connect this site to the active Minerva Wallet account before signing requests."));
      return;
    }
    if (type === "connect" && (await hasConnectionForActiveAccount(message.origin))) {
      const accounts = await connectedAccountResult(message.origin);
      if (accounts.length > 0) {
        respond({ result: message.method === "wallet_requestPermissions" ? await permissionsResult(message.origin) : accounts });
        return;
      }
    }
    await openRequestWindow(type, message, respond);
    return;
  }

  respond(providerError(-32601, `Minerva provider does not support ${message.method} yet.`));
}

async function completePendingRequest(requestId: string, response: ProviderResponse): Promise<void> {
  const pending = pendingRequests.get(requestId) ?? (await readPendingProviderRequest(requestId));
  pendingRequests.delete(requestId);
  await deletePendingProviderRequest(requestId);
  await storeProviderResponse(requestId, response);
  await recordProviderDiagnostic(response.error ? "request:error" : "request:resolved", {
    requestId,
    origin: pending?.origin,
    method: pending?.method,
    detail: response.error ? `${response.error.code}:${response.error.message}` : "ok",
  });
  if (pending?.respond) {
    try {
      await pending.respond(response);
    } catch {
      // The original content-script port may have disconnected. The relay also
      // polls chrome.storage by request id, so the response is still delivered.
    }
  }
  if (pending?.tabId !== undefined) {
    try {
      const payload = {
        source: "minerva:provider-response",
        requestId,
        result: response.result,
        error: response.error,
      };
      const onDelivered = () => {
        void recordProviderDiagnostic(chrome.runtime.lastError ? "response:tab-delivery-failed" : "response:tab-delivered", {
          requestId,
          origin: pending.origin,
          method: pending.method,
          detail: chrome.runtime.lastError?.message,
        });
      };
      if (pending.frameId !== undefined) {
        chrome.tabs.sendMessage(pending.tabId, payload, { frameId: pending.frameId }, onDelivered);
      } else {
        chrome.tabs.sendMessage(pending.tabId, payload, onDelivered);
      }
    } catch (error) {
      void recordProviderDiagnostic("response:tab-delivery-threw", {
        requestId,
        origin: pending.origin,
        method: pending.method,
        detail: messageOf(error),
      });
    }
  }
}

async function resolvePendingRequest(message: ResolveRequestMessage): Promise<{ ok: boolean; error?: string }> {
  const pending = pendingRequests.get(message.requestId) ?? (await readPendingProviderRequest(message.requestId));
  if (!pending) return { ok: false, error: "Minerva request expired. Please try again." };

  if (message.decision === "reject") {
    await completePendingRequest(message.requestId, providerError(4001, "User rejected the Minerva request."));
    return { ok: true };
  }

  // The passcode typed into the review window wins; otherwise the unlocked session supplies it.
  const passcode = message.passcode || (await readUnlockedSession())?.passcode;

  try {
    if (pending.method === "eth_requestAccounts" || pending.method === "wallet_requestPermissions") {
      const account = await getOrCreateAccountAddress(passcode);
      if (!account) {
        throw new Error("Create or restore Minerva Wallet before connecting this site.");
      }
      const active = await currentAccount();
      const known = new Set((await listExtensionAccounts()).map((a) => a.id));
      const chosen = (message.accountIds ?? []).filter((id) => known.has(id));
      const accountIds = chosen.length > 0 ? chosen : active ? [active.id] : [];
      if (accountIds.length === 0) throw new Error("Choose at least one account to connect.");
      // Connecting only other accounts makes the first of them active, so the site sees it.
      if (active && !accountIds.includes(active.id)) {
        await setActiveExtensionAccount(accountIds[0]);
      }
      await setConnection(
        pending.origin,
        message.decision === "limited" ? ["view-account", "limited"] : ["view-account", "request-signatures"],
        accountIds,
      );
      const result =
        pending.method === "wallet_requestPermissions"
          ? await permissionsResult(pending.origin)
          : await connectedAccountResult(pending.origin);
      await completePendingRequest(message.requestId, { result });
      return { ok: true };
    }

    if (pending.method === "eth_sendTransaction") {
      if (!(await hasConnectionForActiveAccount(pending.origin))) {
        throw new Error("Connect this site to the active Minerva Wallet account before signing transactions.");
      }
      if (!passcode) throw new Error("Enter your Minerva Wallet passcode to sign this transaction.");
      const account = await currentAccountAddress();
      if (!account) throw new Error("Unlock Minerva Wallet before signing transactions.");
      const tx = parseTransactionRequest(pending.params);
      if (tx.from && tx.from.toLowerCase() !== account.toLowerCase()) {
        throw new Error(`This request is from ${tx.from.slice(0, 6)}...${tx.from.slice(-4)}, not your active Minerva Account.`);
      }
      const profile = await unlockExtensionWalletProfile(passcode);
      const receipt = await sendExtensionDappTransaction(profile, passcode, {
        target: tx.to,
        valueWei: tx.valueWei,
        data: tx.data,
      });
      await completePendingRequest(message.requestId, { result: receipt.transactionHash });
      return { ok: true };
    }

    if (
      isLegacyMessageSigningMethod(pending.method)
    ) {
      throw new Error(
        "EOA signature not supported. Minerva Wallet only signs PQ-native messages with minerva_signMessage or minerva_signTypedData.",
      );
    }

    if (isMinervaMessageSigningMethod(pending.method)) {
      if (!(await hasConnectionForActiveAccount(pending.origin))) {
        throw new Error("Connect this site to the active Minerva Wallet account before signing messages.");
      }
      if (!passcode) throw new Error("Enter your Minerva Wallet passcode to sign this message.");
      const account = await currentAccountAddress();
      if (!account) throw new Error("Unlock Minerva Wallet before signing messages.");
      const proof = await signMinervaMessageProof(pending, passcode, account);
      await completePendingRequest(message.requestId, { result: proof });
      return { ok: true };
    }

    throw new Error(`Minerva provider does not support ${pending.method} yet.`);
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

function refreshMainWorldProviderAfterUpdate(details: chrome.runtime.InstalledDetails): void {
  if (details.reason !== "update") return;
  chrome.scripting.unregisterContentScripts({ ids: [MAIN_WORLD_PROVIDER_SCRIPT_ID] }, () => {
    if (chrome.runtime.lastError) {
      void recordProviderDiagnostic("provider-registration:refresh-skipped", {
        detail: chrome.runtime.lastError.message,
      });
      return;
    }
    void recordProviderDiagnostic("provider-registration:refresh-reload", {
      detail: `updated:${details.previousVersion ?? "unknown"}->${extensionVersion()}`,
    });
    chrome.runtime.reload();
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  void getPendingProviderRequests();
  void getStoredProviderResponses();
  void recordProviderDiagnostic("extension:installed", { detail: details.reason });
  refreshMainWorldProviderAfterUpdate(details);
  console.log("[minerva] extension installed");
});

chrome.windows.onRemoved.addListener((windowId) => {
  for (const [requestId, approvalWindowId] of approvalWindowIds.entries()) {
    if (approvalWindowId === windowId) approvalWindowIds.delete(requestId);
  }
});

// Auto-lock: the popup arms this alarm when it unlocks; firing clears the session passcode.
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name !== AUTO_LOCK_ALARM) return;
  void clearUnlockedSession().then(() => recordProviderDiagnostic("session:auto-locked"));
});

// Account registry changes (switch, remove) made in the popup or options page reach dapps here.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[EXTENSION_ACCOUNTS_STORAGE_KEY]) return;
  const before = changes[EXTENSION_ACCOUNTS_STORAGE_KEY].oldValue as ExtensionAccountsRegistry | undefined;
  const after = changes[EXTENSION_ACCOUNTS_STORAGE_KEY].newValue as ExtensionAccountsRegistry | undefined;
  void (async () => {
    if (!after) {
      // Wallet wiped: every grant is gone already; tell open tabs.
      for (const origin of Object.keys(await readRawConnections())) {
        await emitProviderEvent(origin, "accountsChanged", []);
        await emitProviderEvent(origin, "disconnect", { code: 4900, message: "Minerva Wallet disconnected." });
      }
      return;
    }
    const remaining = new Set(after.accounts.map((a) => a.id));
    if (before && before.accounts.some((a) => !remaining.has(a.id))) {
      await pruneConnectionsForAccounts(remaining);
    }
    const beforeActive = before?.accounts.find((a) => a.id === before.activeId);
    const afterActive = after.accounts.find((a) => a.id === after.activeId);
    const beforeAddress = beforeActive ? accountAddressOfRecord(beforeActive.record) : undefined;
    const afterAddress = afterActive ? accountAddressOfRecord(afterActive.record) : undefined;
    if (before?.activeId !== after.activeId || beforeAddress?.toLowerCase() !== afterAddress?.toLowerCase()) {
      await announceActiveAccountChange();
    }
  })().catch((error) => recordProviderDiagnostic("accounts:change-handler-threw", { detail: messageOf(error) }));
});

function postProviderResponse(
  port: chrome.runtime.Port,
  requestId: string,
  response: ProviderResponse,
  disconnect = true,
) {
  try {
    port.postMessage({
      source: "minerva:provider-response",
      requestId,
      result: response.result,
      error: response.error,
    });
  } finally {
    if (disconnect) {
      setTimeout(() => {
        try {
          port.disconnect();
        } catch {
          // The content relay may already have closed after receiving the response.
        }
      }, 100);
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "minerva:provider") return;
  let activeRequestId: string | undefined;
  let responded = false;

  const respondFromPort = (requestId: string) => async (response: ProviderResponse) => {
    if (responded) return;
    responded = true;
    await storeProviderResponse(requestId, response);
    try {
      postProviderResponse(port, requestId, response);
    } catch {
      // The relay polls the stored response when the live port is gone.
    }
  };

  port.onMessage.addListener((message) => {
    if (message?.kind !== "minerva:provider-request" || !message.requestId) return;
    activeRequestId = message.requestId as string;
    const tabId = port.sender?.tab?.id;
    const frameId = port.sender?.frameId;
    void handleProviderRequest({ ...(message as ProviderRequestMessage), tabId, frameId }, respondFromPort(activeRequestId)).catch(
      async (error) => {
        const detail = messageOf(error);
        await recordProviderDiagnostic("request:handler-threw", {
          requestId: activeRequestId,
          origin: (message as ProviderRequestMessage).origin,
          method: (message as ProviderRequestMessage).method,
          detail,
        });
        await respondFromPort(activeRequestId ?? (message.requestId as string))(providerError(5000, detail));
      },
    );
  });

  port.onDisconnect.addListener(() => {
    if (!responded && activeRequestId) {
      const pending = pendingRequests.get(activeRequestId);
      if (pending) {
        pendingRequests.set(activeRequestId, { ...pending, respond: undefined });
      }
    }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "minerva:ping") {
    sendResponse({ ok: true, build: "shell", version: extensionVersion() });
    return true;
  }
  if (message?.kind === "minerva:open-request") {
    const type = message.type as "connect" | "tx" | "sign";
    const url = chrome.runtime.getURL(`tabs/request.html?type=${type}`);
    chrome.windows.create({ url, type: "popup", width: 420, height: 720 });
    sendResponse({ ok: true });
    return true;
  }
  if (message?.kind === "minerva:provider-request") {
    void handleProviderRequest(message as ProviderRequestMessage, sendResponse).catch(async (error) => {
      const detail = messageOf(error);
      await recordProviderDiagnostic("request:handler-threw", {
        requestId: (message as ProviderRequestMessage).requestId,
        origin: (message as ProviderRequestMessage).origin,
        method: (message as ProviderRequestMessage).method,
        detail,
      });
      sendResponse(providerError(5000, detail));
    });
    return true;
  }
  if (message?.kind === "minerva:resolve-request") {
    void resolvePendingRequest(message as ResolveRequestMessage).then(sendResponse);
    return true;
  }
  if (message?.kind === "minerva:get-pending-request") {
    void getPendingRequestDetails(message.requestId as string).then((request) => {
      sendResponse({ ok: Boolean(request), request, error: request ? undefined : "Minerva request expired." });
    });
    return true;
  }
  if (message?.kind === "minerva:ensure-request-window") {
    void ensureRequestWindow(message.requestId as string).then(sendResponse);
    return true;
  }
  if (message?.kind === "minerva:get-provider-response") {
    void readProviderResponse(message.requestId as string).then((entry) => {
      sendResponse({ ok: Boolean(entry), response: entry?.response });
    });
    return true;
  }
  if (message?.kind === "minerva:get-provider-diagnostics") {
    chrome.storage.local.get(PROVIDER_DIAGNOSTICS_KEY, (items) => {
      sendResponse({ ok: true, diagnostics: items[PROVIDER_DIAGNOSTICS_KEY] ?? [] });
    });
    return true;
  }
  if (message?.kind === "minerva:get-connections") {
    void getConnections().then((connections) => sendResponse({ ok: true, connections }));
    return true;
  }
  if (message?.kind === "minerva:disconnect-origin") {
    void disconnectOrigin(message.origin as string).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message?.kind === "minerva:disconnect-all") {
    void (async () => {
      for (const origin of Object.keys(await readRawConnections())) await disconnectOrigin(origin);
    })().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.kind === "minerva:revoke-account") {
    void revokeAccountFromOrigin(message.origin as string, message.accountId as string).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message?.kind === "minerva:lock") {
    void clearUnlockedSession().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

export {};
