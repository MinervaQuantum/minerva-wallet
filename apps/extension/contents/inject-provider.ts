import type { PlasmoCSConfig } from "plasmo";

/**
 * EIP-1193 provider bridge.
 *
 * Requests are posted to the isolated relay, forwarded to the background
 * service worker, then resolved after either a read-only response or a user
 * decision in tabs/request.html.
 *
 * eth_sendTransaction is reviewed by the extension and submitted through the
 * Minerva Account PQ transaction path. The extension must not return mock EOA
 * signatures or raw classical transaction hashes.
 */

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_start",
  world: "MAIN",
};

interface RequestArgs {
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

interface ProviderBridgeResponse {
  source?: string;
  requestId?: string;
  phase?: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

interface ProviderListener {
  event: string;
  listener: (...args: unknown[]) => void;
}

interface JsonRpcPayload {
  id?: string | number | null;
  jsonrpc?: string;
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

type JsonRpcCallback = (
  error: (Error & { code?: number }) | null,
  response?: {
    id?: string | number | null;
    jsonrpc: string;
    result?: unknown;
    error?: {
      code?: number;
      message: string;
    };
  },
) => void;

// Minerva testnet (77138) unless the build pins another supported chain.
const CHAIN_ID = Number(process.env.PLASMO_PUBLIC_MINERVA_CHAIN_ID ?? 77138) || 77138;
const CHAIN_ID_HEX = `0x${CHAIN_ID.toString(16)}`;
const NETWORK_VERSION = String(CHAIN_ID);
const listeners: ProviderListener[] = [];
const providerState = {
  accounts: [] as string[],
  connected: false,
};

function nextRequestId(): string {
  const random = Math.random().toString(16).slice(2);
  return `minerva-${Date.now().toString(16)}-${random}`;
}

function normalizeParams(params: RequestArgs["params"]): unknown[] {
  if (Array.isArray(params)) return params;
  if (params === undefined) return [];
  return [params];
}

function requestThroughRelay(args: RequestArgs): Promise<unknown> {
  const requestId = nextRequestId();

  return new Promise((resolve, reject) => {
    let relayAcknowledged = false;

    const cleanup = () => {
      window.clearTimeout(relayTimeout);
      window.clearTimeout(requestTimeout);
      window.removeEventListener("message", onResponse);
    };

    const relayTimeout = window.setTimeout(() => {
      if (relayAcknowledged) return;
      cleanup();
      const error = new Error(
        "Minerva Wallet extension relay did not respond. Reload the page after installing or updating the extension.",
      ) as Error & { code?: number };
      error.code = 4900;
      reject(error);
    }, 4_000);

    const requestTimeout = window.setTimeout(() => {
      cleanup();
      const error = new Error(`minerva provider: ${args.method} timed out`) as Error & { code?: number };
      error.code = 5000;
      reject(error);
    }, 600_000);

    function onResponse(event: MessageEvent<ProviderBridgeResponse>) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.requestId !== requestId) return;

      if (data?.source === "minerva:provider-status") {
        relayAcknowledged = true;
        window.clearTimeout(relayTimeout);
        if (data.error) {
          cleanup();
          const error = new Error(data.error.message) as Error & { code?: number };
          error.code = data.error.code;
          reject(error);
        }
        return;
      }

      if (data?.source !== "minerva:provider-response") return;

      cleanup();

      if (data.error) {
        const error = new Error(data.error.message) as Error & { code?: number };
        error.code = data.error.code;
        reject(error);
        return;
      }
      resolve(data.result);
    }

    window.addEventListener("message", onResponse);
    window.postMessage(
      {
        source: "minerva:provider",
        kind: "request",
        requestId,
        origin: window.location.origin,
        method: args.method,
        params: normalizeParams(args.params),
      },
      "*",
    );
  });
}

function normalizeAccounts(result: unknown): string[] {
  if (!Array.isArray(result)) return [];
  return result.filter((account): account is string => typeof account === "string" && account.startsWith("0x"));
}

function emit(event: string, ...args: unknown[]) {
  for (const entry of [...listeners]) {
    if (entry.event !== event) continue;
    try {
      entry.listener(...args);
    } catch (error) {
      window.setTimeout(() => {
        throw error;
      });
    }
  }
}

function accountsChanged(nextAccounts: string[]): boolean {
  if (providerState.accounts.length !== nextAccounts.length) return true;
  return providerState.accounts.some((account, index) => account.toLowerCase() !== nextAccounts[index]?.toLowerCase());
}

function setAccounts(accounts: string[], announce = true) {
  const nextAccounts = [...accounts];
  const changed = accountsChanged(nextAccounts);
  providerState.accounts = nextAccounts;
  provider.selectedAddress = nextAccounts[0] ?? null;
  provider._state.accounts = nextAccounts;
  provider._state.isUnlocked = true;
  if (nextAccounts.length > 0) {
    const wasConnected = providerState.connected;
    providerState.connected = true;
    provider._state.isConnected = true;
    if (!wasConnected && announce) emit("connect", { chainId: CHAIN_ID_HEX });
  }
  if (changed && announce) emit("accountsChanged", [...nextAccounts]);
}

function setDisconnected(announce = true) {
  const hadAccounts = providerState.accounts.length > 0;
  const wasConnected = providerState.connected || hadAccounts;
  providerState.accounts = [];
  providerState.connected = false;
  provider.selectedAddress = null;
  provider._state.accounts = [];
  provider._state.isConnected = false;
  if (hadAccounts && announce) emit("accountsChanged", []);
  if (wasConnected && announce) emit("disconnect", { code: 4900, message: "Minerva Wallet disconnected." });
}

async function request(args: RequestArgs): Promise<unknown> {
  const result = await requestThroughRelay(args);
  const method = args.method;

  if (method === "eth_accounts" || method === "eth_requestAccounts") {
    setAccounts(normalizeAccounts(result));
  }
  if (method === "wallet_requestPermissions") {
    try {
      setAccounts(normalizeAccounts(await requestThroughRelay({ method: "eth_accounts" })));
    } catch {
      // Permission approval still succeeded; the next eth_accounts call can hydrate state.
    }
  }
  if (method === "wallet_revokePermissions") {
    setDisconnected();
  }
  if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") {
    provider.chainId = CHAIN_ID_HEX;
    provider.networkVersion = NETWORK_VERSION;
    emit("chainChanged", CHAIN_ID_HEX);
  }

  return result;
}

function jsonRpcResponse(payload: JsonRpcPayload, result: unknown) {
  return {
    id: payload.id,
    jsonrpc: payload.jsonrpc ?? "2.0",
    result,
  };
}

function jsonRpcErrorResponse(payload: JsonRpcPayload, error: Error & { code?: number }) {
  return {
    id: payload.id,
    jsonrpc: payload.jsonrpc ?? "2.0",
    error: {
      code: error.code,
      message: error.message,
    },
  };
}

const provider = {
  isMinerva: true,
  chainId: CHAIN_ID_HEX,
  networkVersion: NETWORK_VERSION,
  selectedAddress: null as string | null,
  _state: {
    accounts: [] as string[],
    initialized: true,
    isConnected: false,
    isUnlocked: true,
  },
  request,
  isConnected: () => true,
  enable: () => request({ method: "eth_requestAccounts" }),
  send: (
    methodOrPayload: string | JsonRpcPayload,
    paramsOrCallback?: unknown[] | Record<string, unknown> | JsonRpcCallback,
  ) => {
    if (typeof methodOrPayload === "string") {
      return request({
        method: methodOrPayload,
        params: typeof paramsOrCallback === "function" ? [] : paramsOrCallback,
      });
    }

    const payload = methodOrPayload;
    const callback = typeof paramsOrCallback === "function" ? paramsOrCallback : undefined;
    const promise = request({ method: payload.method, params: payload.params });
    if (!callback) return promise.then((result) => jsonRpcResponse(payload, result));

    promise
      .then((result) => callback(null, jsonRpcResponse(payload, result)))
      .catch((error: Error & { code?: number }) => callback(error, jsonRpcErrorResponse(payload, error)));
    return undefined;
  },
  sendAsync: (payload: JsonRpcPayload, callback: JsonRpcCallback) => {
    request({ method: payload.method, params: payload.params })
      .then((result) => callback(null, jsonRpcResponse(payload, result)))
      .catch((error: Error & { code?: number }) => callback(error, jsonRpcErrorResponse(payload, error)));
  },
  on: (event: string, listener: (...args: unknown[]) => void) => {
    listeners.push({ event, listener });
    return provider;
  },
  addListener: (event: string, listener: (...args: unknown[]) => void) => {
    listeners.push({ event, listener });
    return provider;
  },
  once: (event: string, listener: (...args: unknown[]) => void) => {
    const onceListener = (...args: unknown[]) => {
      provider.removeListener(event, onceListener);
      listener(...args);
    };
    listeners.push({ event, listener: onceListener });
    return provider;
  },
  removeListener: (event: string, listener: (...args: unknown[]) => void) => {
    const index = listeners.findIndex((entry) => entry.event === event && entry.listener === listener);
    if (index >= 0) listeners.splice(index, 1);
    return provider;
  },
  off: (event: string, listener: (...args: unknown[]) => void) => {
    provider.removeListener(event, listener);
    return provider;
  },
  removeAllListeners: (event?: string) => {
    if (!event) {
      listeners.splice(0, listeners.length);
      return provider;
    }
    for (let index = listeners.length - 1; index >= 0; index -= 1) {
      if (listeners[index]?.event === event) listeners.splice(index, 1);
    }
    return provider;
  },
};

if (typeof window !== "undefined") {
  const providerInfo = {
    uuid: "13f84186-d9f0-4a60-bb4f-a65d243c1f91",
    name: "Minerva Wallet",
    icon: "data:image/png;base64,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",
    rdns: "build.minerva.wallet",
  };

  function announceProvider() {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info: providerInfo, provider }),
      }),
    );
  }

  Object.defineProperty(window, "minerva", {
    value: provider,
    writable: false,
  });
  if (!("ethereum" in window)) {
    Object.defineProperty(window, "ethereum", {
      value: provider,
      writable: false,
    });
  }
  // Wallet-initiated events relayed by the isolated content script (account switch, revoked grant).
  window.addEventListener("message", (event: MessageEvent<{ source?: string; event?: string; data?: unknown }>) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "minerva:provider-event") return;
    if (data.event === "accountsChanged") {
      const accounts = normalizeAccounts(data.data);
      if (accounts.length === 0 && providerState.accounts.length === 0) return;
      setAccounts(accounts);
      return;
    }
    if (data.event === "disconnect") {
      if (!providerState.connected && providerState.accounts.length === 0) return;
      setDisconnected();
    }
  });

  window.addEventListener("eip6963:requestProvider", announceProvider);
  announceProvider();
  window.setTimeout(() => {
    void request({ method: "eth_accounts" }).catch(() => undefined);
  }, 0);
}
