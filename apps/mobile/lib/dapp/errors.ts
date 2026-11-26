/**
 * EIP-1193 provider errors. Every failure that crosses back into a page or a WalletConnect
 * peer is one of these, so dapps see the standard codes.
 */
export const PROVIDER_ERROR_CODES = {
  userRejected: 4001,
  unauthorized: 4100,
  unsupportedMethod: 4200,
  disconnected: 4900,
  chainDisconnected: 4901,
  unknownChain: 4902,
  invalidParams: -32602,
  internal: -32603,
} as const;

export class ProviderRpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "ProviderRpcError";
    this.code = code;
    this.data = data;
  }
}

export function userRejected(message = "User rejected the request."): ProviderRpcError {
  return new ProviderRpcError(PROVIDER_ERROR_CODES.userRejected, message);
}

export function unauthorized(message = "The requested method requires a connected, unlocked account."): ProviderRpcError {
  return new ProviderRpcError(PROVIDER_ERROR_CODES.unauthorized, message);
}

export function unsupportedMethod(method: string, hint?: string): ProviderRpcError {
  return new ProviderRpcError(
    PROVIDER_ERROR_CODES.unsupportedMethod,
    `Minerva Wallet does not support ${method}.${hint ? ` ${hint}` : ""}`,
  );
}

export function unknownChain(chainId: string): ProviderRpcError {
  return new ProviderRpcError(
    PROVIDER_ERROR_CODES.unknownChain,
    `Chain ${chainId} is not registered in Minerva Wallet. Add it under Settings → Networks first.`,
  );
}

export function invalidParams(message: string): ProviderRpcError {
  return new ProviderRpcError(PROVIDER_ERROR_CODES.invalidParams, message);
}

/** Normalises any thrown value into a ProviderRpcError, keeping an existing code when present. */
export function toProviderError(error: unknown): ProviderRpcError {
  if (error instanceof ProviderRpcError) return error;
  const code = typeof (error as { code?: unknown })?.code === "number" ? (error as { code: number }).code : undefined;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Request failed.";
  return new ProviderRpcError(code ?? PROVIDER_ERROR_CODES.internal, message);
}
