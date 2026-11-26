/**
 * Wallet-side handler for EIP-1193 requests, shared by the in-app browser and WalletConnect.
 *
 * Read-only methods are answered immediately (from wallet state or the active RPC); anything that
 * needs a decision creates a request in `requestBridge` and navigates to the matching review screen,
 * then awaits the user's answer. Errors are `ProviderRpcError`s with EIP-1193 codes.
 */
import { router } from "expo-router";
import type { Hex } from "@minerva/core";
import { getChainDefinition, isValidEvmAddress } from "@minerva/evm";
import { createDappRequest, DappRequestRejectedError, type DappRequestMeta } from "./requestBridge";
import { getDappSession, removeDappSession, saveDappSession, sessionAccountsFor, touchDappSession, type DappSession } from "./sessions";
import { invalidParams, ProviderRpcError, PROVIDER_ERROR_CODES, toProviderError, unauthorized, unknownChain, unsupportedMethod, userRejected } from "./errors";
import { isHex, quantityToBigInt, sameAddress, toQuantityHex } from "./hashing";
import { isMessageSigningMethod, isTypedDataMethod, type MinervaMessageProof } from "./signing";
import type { DappWalletContext } from "./walletContext";

export const READ_ONLY_RPC_METHODS = new Set([
  "eth_call",
  "eth_estimateGas",
  "eth_getBalance",
  "eth_blockNumber",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getCode",
  "eth_gasPrice",
  "eth_feeHistory",
  "eth_getLogs",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionCount",
  "eth_getStorageAt",
  "eth_maxPriorityFeePerGas",
  "eth_syncing",
  "eth_protocolVersion",
  "web3_sha3",
]);

/** Methods a WalletConnect session namespace advertises. */
export const WALLET_METHODS = [
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData",
  "eth_signTypedData_v4",
  "minerva_signMessage",
  "minerva_signTypedData",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
  "wallet_getPermissions",
  "wallet_requestPermissions",
  "wallet_revokePermissions",
  ...READ_ONLY_RPC_METHODS,
];

export const WALLET_EVENTS = ["accountsChanged", "chainChanged", "connect", "disconnect"];

export interface ConnectRequestPayload extends Record<string, unknown> {
  accounts: string[];
  chainId: number;
}
export interface ConnectRequestResult {
  accounts: string[];
}

export interface SignRequestPayload extends Record<string, unknown> {
  method: string;
  params: unknown[];
  account: string;
  chainId: number;
}

export interface SendTransactionRequestPayload extends Record<string, unknown> {
  target: Hex;
  valueWei: string;
  data: Hex;
  from?: Hex;
  chainId: number;
}

export interface ProviderHandlerOptions {
  /**
   * WalletConnect sessions are approved through WalletKit, not `sessions.ts`; pass `true` so the
   * handler treats the peer as connected without a browser session record.
   */
  implicitlyConnected?: boolean;
  /** Chain the peer addressed (WalletConnect `eip155:<id>`); mismatches with the wallet are rejected. */
  requestedChainId?: number;
}

const inflight = new Map<string, Promise<unknown>>();

function dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = factory().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

export function chainIdToHex(chainId: number): Hex {
  return toQuantityHex(chainId);
}

function parseChainIdParam(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    try {
      const parsed = Number(quantityToBigInt(value));
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function permissionsFor(origin: string, accounts: string[]): unknown[] {
  if (accounts.length === 0) return [];
  return [
    {
      id: `minerva-${origin}`,
      parentCapability: "eth_accounts",
      invoker: origin,
      caveats: [{ type: "restrictReturnedAccounts", value: accounts }],
      date: Date.now(),
    },
  ];
}

async function connectedAccounts(ctx: DappWalletContext, meta: DappRequestMeta, options: ProviderHandlerOptions): Promise<{ accounts: string[]; session?: DappSession }> {
  if (options.implicitlyConnected) {
    return { accounts: ctx.activeAddress ? [ctx.activeAddress.toLowerCase()] : [] };
  }
  const session = await getDappSession(meta.origin);
  return { accounts: sessionAccountsFor(session, ctx.activeAddress), session };
}

function navigate(pathname: string, params: Record<string, string>): void {
  // The review screens are registered in app/_layout.tsx; `router.push` accepts the pathname string.
  router.push({ pathname: pathname as never, params });
}

async function requestConnection(ctx: DappWalletContext, meta: DappRequestMeta): Promise<string[]> {
  if (!ctx.activeAddress) {
    throw unauthorized(ctx.walletStatus === "no-wallet" ? "Create or import a Minerva Account before connecting." : "No active account is available.");
  }
  const active = ctx.activeAddress.toLowerCase();
  return dedupe(`${meta.origin}:connect`, async () => {
    const { request, promise } = createDappRequest<ConnectRequestResult, ConnectRequestPayload>("connect", meta, {
      accounts: [active],
      chainId: ctx.chainId,
    });
    navigate("/dapp-connection", { requestId: request.id });
    let result: ConnectRequestResult;
    try {
      result = await promise;
    } catch (error) {
      throw rejectedToProviderError(error);
    }
    const accounts = (result?.accounts ?? [active]).map((a) => a.toLowerCase());
    if (meta.source === "browser") {
      const existing = await getDappSession(meta.origin);
      const merged = Array.from(new Set([...(existing?.accounts ?? []), ...accounts]));
      await saveDappSession({ origin: meta.origin, accounts: merged, chainId: ctx.chainId, name: meta.name, iconUrl: meta.iconUrl });
    }
    return accounts;
  });
}

function rejectedToProviderError(error: unknown): ProviderRpcError {
  if (error instanceof DappRequestRejectedError) return new ProviderRpcError(error.code, error.message);
  return toProviderError(error);
}

function assertCanSign(ctx: DappWalletContext, accounts: string[]): string {
  if (ctx.isWatchOnly) throw unauthorized("This is a watch-only account. Switch to a Minerva Account with keys to sign.");
  if (!ctx.activeAddress) throw unauthorized("No active account is available.");
  const active = ctx.activeAddress.toLowerCase();
  if (!accounts.includes(active)) throw unauthorized("Connect this site to Minerva Wallet before signing.");
  return active;
}

export interface ParsedTransactionRequest {
  from?: Hex;
  to: Hex;
  valueWei: string;
  data: Hex;
}

export function parseTransactionRequest(params: unknown[], account: string): ParsedTransactionRequest {
  const tx = params[0] as Record<string, unknown> | undefined;
  if (!tx || typeof tx !== "object") throw invalidParams("Missing eth_sendTransaction payload.");
  if (typeof tx.to !== "string" || !isValidEvmAddress(tx.to)) {
    throw unsupportedMethod("contract deployment transactions", "eth_sendTransaction needs a `to` address.");
  }
  const from = typeof tx.from === "string" && isValidEvmAddress(tx.from) ? (tx.from as Hex) : undefined;
  if (from && !sameAddress(from, account)) {
    throw unauthorized(`This transaction is for ${from.slice(0, 6)}...${from.slice(-4)}, not your active Minerva Account.`);
  }
  let valueWei: string;
  try {
    valueWei = quantityToBigInt(tx.value).toString();
  } catch {
    throw invalidParams("Invalid transaction value.");
  }
  const rawData = tx.data ?? tx.input;
  let data: Hex = "0x";
  if (rawData !== undefined && rawData !== null && rawData !== "") {
    if (!isHex(rawData) || rawData.length % 2 !== 0) throw invalidParams("Transaction data must be even-length hex.");
    data = rawData;
  }
  return { from, to: tx.to as Hex, valueWei, data };
}

export async function fetchRpc(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!response.ok) throw new ProviderRpcError(PROVIDER_ERROR_CODES.internal, `RPC ${method} failed with HTTP ${response.status}.`);
  const body = (await response.json()) as { result?: unknown; error?: { code?: number; message?: string; data?: unknown } };
  if (body.error) {
    throw new ProviderRpcError(typeof body.error.code === "number" ? body.error.code : PROVIDER_ERROR_CODES.internal, body.error.message ?? `RPC ${method} failed.`, body.error.data);
  }
  return body.result ?? null;
}

/**
 * Handles one provider request. `meta` identifies the requesting app; `ctx` is the wallet state at
 * the time of the request. Resolves with the JSON-RPC result or rejects with a ProviderRpcError.
 */
export async function handleProviderRequest(
  ctx: DappWalletContext,
  meta: DappRequestMeta,
  method: string,
  params: unknown[] = [],
  options: ProviderHandlerOptions = {},
): Promise<unknown> {
  try {
    return await dispatch(ctx, meta, method, params, options);
  } catch (error) {
    throw rejectedToProviderError(error);
  }
}

async function dispatch(ctx: DappWalletContext, meta: DappRequestMeta, method: string, params: unknown[], options: ProviderHandlerOptions): Promise<unknown> {
  if (options.requestedChainId !== undefined && options.requestedChainId !== ctx.chainId) {
    if (!getChainDefinition(options.requestedChainId)) throw unknownChain(String(options.requestedChainId));
    // The peer addressed another registered chain; the handler does not silently switch for it.
    if (method !== "wallet_switchEthereumChain" && method !== "eth_chainId" && method !== "net_version") {
      throw new ProviderRpcError(
        PROVIDER_ERROR_CODES.chainDisconnected,
        `Minerva Wallet is on chain ${ctx.chainId}, but the request targets chain ${options.requestedChainId}. Switch networks first.`,
      );
    }
  }

  switch (method) {
    case "eth_chainId":
      return chainIdToHex(ctx.chainId);
    case "net_version":
      return String(ctx.chainId);
    case "web3_clientVersion":
      return "MinervaWallet/mobile";

    case "eth_accounts": {
      const { accounts, session } = await connectedAccounts(ctx, meta, options);
      if (session && accounts.length > 0) void touchDappSession(meta.origin).catch(() => undefined);
      return accounts;
    }
    case "eth_coinbase": {
      const { accounts } = await connectedAccounts(ctx, meta, options);
      return accounts[0] ?? null;
    }

    case "eth_requestAccounts": {
      const { accounts } = await connectedAccounts(ctx, meta, options);
      if (accounts.length > 0) {
        void touchDappSession(meta.origin).catch(() => undefined);
        return accounts;
      }
      return requestConnection(ctx, meta);
    }

    case "wallet_getPermissions": {
      const { accounts } = await connectedAccounts(ctx, meta, options);
      return permissionsFor(meta.origin, accounts);
    }
    case "wallet_requestPermissions": {
      const requested = params[0] as Record<string, unknown> | undefined;
      if (requested && typeof requested === "object" && !("eth_accounts" in requested)) {
        throw unsupportedMethod("wallet_requestPermissions", "Only eth_accounts can be requested.");
      }
      const { accounts } = await connectedAccounts(ctx, meta, options);
      const granted = accounts.length > 0 ? accounts : await requestConnection(ctx, meta);
      return permissionsFor(meta.origin, granted);
    }
    case "wallet_revokePermissions": {
      if (!options.implicitlyConnected) await removeDappSession(meta.origin);
      return null;
    }

    case "wallet_switchEthereumChain": {
      const target = parseChainIdParam((params[0] as { chainId?: unknown } | undefined)?.chainId);
      if (target === undefined) throw invalidParams("wallet_switchEthereumChain needs { chainId }.");
      const definition = getChainDefinition(target);
      if (!definition) throw unknownChain(chainIdToHex(target));
      if (!definition.launched) throw unknownChain(`${chainIdToHex(target)} (${definition.name} is not live yet)`);
      if (target !== ctx.chainId) {
        await ctx.setChain(target);
        if (!options.implicitlyConnected) void touchDappSession(meta.origin, target).catch(() => undefined);
      }
      return null;
    }
    case "wallet_addEthereumChain":
      throw unsupportedMethod("wallet_addEthereumChain", "Add the network yourself under Settings → Networks, then ask the site to switch to it.");

    case "eth_sign":
      throw unsupportedMethod("eth_sign", "Use personal_sign or eth_signTypedData_v4.");

    case "eth_sendTransaction": {
      const { accounts } = await connectedAccounts(ctx, meta, options);
      const account = assertCanSign(ctx, accounts);
      const parsed = parseTransactionRequest(params, account);
      const { request, promise } = createDappRequest<string, SendTransactionRequestPayload>("send-transaction", meta, {
        target: parsed.to,
        valueWei: parsed.valueWei,
        data: parsed.data,
        from: parsed.from,
        chainId: ctx.chainId,
      });
      navigate("/transaction-review", {
        requestId: request.id,
        target: parsed.to,
        valueWei: parsed.valueWei,
        data: parsed.data,
        origin: meta.origin,
        appName: meta.name ?? meta.origin,
      });
      const hash = await promise;
      if (typeof hash !== "string" || !isHex(hash)) throw new ProviderRpcError(PROVIDER_ERROR_CODES.internal, "The transaction did not return a hash.");
      void touchDappSession(meta.origin).catch(() => undefined);
      return hash;
    }

    default:
      break;
  }

  if (isMessageSigningMethod(method)) {
    const { accounts } = await connectedAccounts(ctx, meta, options);
    const account = assertCanSign(ctx, accounts);
    const kind = isTypedDataMethod(method) ? "sign-typed-data" : "sign-message";
    const { request, promise } = createDappRequest<MinervaMessageProof, SignRequestPayload>(kind, meta, {
      method,
      params,
      account,
      chainId: ctx.chainId,
    });
    navigate("/message-signing-review", { requestId: request.id });
    const proof = await promise;
    void touchDappSession(meta.origin).catch(() => undefined);
    return proof;
  }

  if (READ_ONLY_RPC_METHODS.has(method)) {
    return fetchRpc(ctx.rpcUrl, method, params);
  }

  throw unsupportedMethod(method);
}

export { userRejected };
