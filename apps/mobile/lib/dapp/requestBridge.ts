/**
 * Promise registry that lets a dapp request (from the in-app browser or WalletConnect) wait for
 * the user's decision on a review screen.
 *
 * Flow: the provider layer calls `createDappRequest`, navigates to the matching screen with
 * `requestId` in its params, and awaits the promise. The screen reads the request with
 * `getDappRequest`, then calls `resolveDappRequest` or `rejectDappRequest`. A screen that unmounts
 * without deciding must reject (the user navigated away).
 */
export type DappRequestKind = "connect" | "sign-message" | "sign-typed-data" | "send-transaction" | "switch-chain" | "add-chain";

export interface DappRequestMeta {
  origin: string;
  /** Human name of the app, when known (page title, WalletConnect metadata). */
  name?: string;
  iconUrl?: string;
  source: "browser" | "walletconnect";
}

export interface DappRequest<TPayload = Record<string, unknown>> {
  id: string;
  kind: DappRequestKind;
  meta: DappRequestMeta;
  payload: TPayload;
  createdAt: string;
}

export class DappRequestRejectedError extends Error {
  code: number;
  constructor(message = "User rejected the request", code = 4001) {
    super(message);
    this.name = "DappRequestRejectedError";
    this.code = code;
  }
}

interface Entry {
  request: DappRequest;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  settled: boolean;
}

const entries = new Map<string, Entry>();

function newId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDappRequest<TResult = unknown, TPayload extends Record<string, unknown> = Record<string, unknown>>(
  kind: DappRequestKind,
  meta: DappRequestMeta,
  payload: TPayload,
): { request: DappRequest<TPayload>; promise: Promise<TResult> } {
  const request: DappRequest<TPayload> = { id: newId(), kind, meta, payload, createdAt: new Date().toISOString() };
  const promise = new Promise<TResult>((resolve, reject) => {
    entries.set(request.id, {
      request: request as DappRequest,
      resolve: resolve as (value: unknown) => void,
      reject,
      settled: false,
    });
  });
  return { request, promise };
}

export function getDappRequest<TPayload = Record<string, unknown>>(id: string | undefined): DappRequest<TPayload> | undefined {
  if (!id) return undefined;
  return entries.get(id)?.request as DappRequest<TPayload> | undefined;
}

export function resolveDappRequest(id: string, result: unknown): void {
  const entry = entries.get(id);
  if (!entry || entry.settled) return;
  entry.settled = true;
  entries.delete(id);
  entry.resolve(result);
}

export function rejectDappRequest(id: string, error: Error = new DappRequestRejectedError()): void {
  const entry = entries.get(id);
  if (!entry || entry.settled) return;
  entry.settled = true;
  entries.delete(id);
  entry.reject(error);
}

export function isDappRequestOpen(id: string | undefined): boolean {
  return Boolean(id && entries.has(id));
}

export function listOpenDappRequests(): DappRequest[] {
  return [...entries.values()].map((entry) => entry.request);
}
