/**
 * Message signing for dapps, mirroring the browser extension byte for byte.
 *
 * The extension (apps/extension/background.ts: messagePayloadFromParams, hashMessagePayload,
 * signMinervaMessageProof) does not produce EOA signatures. It hashes the payload with keccak-256
 * and signs the hash with the account's ML-DSA-65 key under the "MINERVA_MESSAGE_V1" context,
 * returning a MinervaMessageProof object. This module produces the exact same object so a dapp
 * sees identical results from the extension and from mobile.
 *
 * Hashing rules (identical to the extension):
 *   - plain messages (personal_sign, eth_sign, minerva_signMessage): payload is a string; if it is
 *     hex it is hashed as bytes, otherwise it is UTF-8 encoded first: keccak256(hex | stringToHex(s))
 *   - typed data (eth_signTypedData*, minerva_signTypedData): keccak256(stringToHex(JSON.stringify(payload)))
 *     where payload is exactly what the dapp passed (object or JSON string).
 */
import type { Hex } from "@minerva/core";
import { signMLDSA65 } from "@minerva/evm";
import type { MinervaDevPQWalletProfile } from "@/lib/pqDevWallet";
import { decodeUtf8, hexToBytes, isHex, keccak256, sameAddress, stringToHex } from "./hashing";

export const MINERVA_MESSAGE_CONTEXT = "MINERVA_MESSAGE_V1";

export type MessageSigningMethod =
  | "personal_sign"
  | "eth_sign"
  | "eth_signTypedData"
  | "eth_signTypedData_v3"
  | "eth_signTypedData_v4"
  | "minerva_signMessage"
  | "minerva_signTypedData";

export interface MinervaMessageProof {
  address: string;
  chainId: number;
  algorithm: "ML-DSA-65";
  publicKeyCommitment: Hex;
  keyVersion: number;
  messageHash: Hex;
  signature: Hex;
}

const PLAIN_METHODS = new Set(["personal_sign", "eth_sign", "minerva_signMessage"]);
const TYPED_METHODS = new Set(["eth_signTypedData", "eth_signTypedData_v3", "eth_signTypedData_v4", "minerva_signTypedData"]);

export function isMessageSigningMethod(method: string): method is MessageSigningMethod {
  return PLAIN_METHODS.has(method) || TYPED_METHODS.has(method);
}

export function isTypedDataMethod(method: string): boolean {
  return TYPED_METHODS.has(method);
}

/** The extension's hashing branches key off these two method names; map every alias onto them. */
export function canonicalSigningMethod(method: string): "minerva_signMessage" | "minerva_signTypedData" {
  return TYPED_METHODS.has(method) ? "minerva_signTypedData" : "minerva_signMessage";
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function isAddressLike(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

function mismatchError(address: string): Error {
  return new Error(`This signature request is for ${address.slice(0, 6)}...${address.slice(-4)}, not your active Minerva Account.`);
}

/**
 * Extracts the payload to sign and checks the addressed account.
 *
 * Mirrors the extension's `messagePayloadFromParams` (address-first form) and additionally accepts
 * the standard `personal_sign` order `[message, address]` and legacy `eth_signTypedData` order
 * `[typedData, address]`, which the extension never reaches because it rejects those methods.
 */
export function messagePayloadFromParams(method: string, params: unknown[] = [], account: string): unknown {
  const [first, second] = params;
  const firstIsAddress = isAddressLike(first);
  const secondIsAddress = isAddressLike(second);

  // personal_sign and legacy eth_signTypedData are specified as [payload, address]; only treat the
  // first param as the address when the second clearly is not one (MetaMask-style reversed order).
  const payloadFirstMethod = method === "personal_sign" || method === "eth_signTypedData";
  const addressFirst = payloadFirstMethod ? firstIsAddress && !secondIsAddress : firstIsAddress && second !== undefined;

  if (addressFirst) {
    if (!sameAddress(first as string, account)) throw mismatchError(first as string);
    return second;
  }
  if (secondIsAddress) {
    if (!sameAddress(second as string, account)) throw mismatchError(second as string);
    return first;
  }
  if (method === "minerva_signTypedData" && second !== undefined) return second;
  return first;
}

/** Identical to the extension's `hashMessagePayload`, after method aliasing. */
export function hashMessagePayload(method: string, payload: unknown): Hex {
  if (payload === undefined || payload === null) throw new Error("Missing message payload.");
  if (canonicalSigningMethod(method) === "minerva_signMessage" && typeof payload === "string") {
    const messageHex = isHex(payload) ? payload : stringToHex(payload);
    return keccak256(messageHex);
  }
  const encoded = JSON.stringify(payload);
  if (!encoded) throw new Error("Could not encode message payload.");
  return keccak256(stringToHex(encoded));
}

/** Produces the same MinervaMessageProof as the extension's `signMinervaMessageProof`. */
export function signMinervaMessageProof(
  profile: MinervaDevPQWalletProfile,
  method: string,
  params: unknown[] | undefined,
  account: string,
  fallbackChainId: number,
): MinervaMessageProof {
  const payload = messagePayloadFromParams(method, params ?? [], account);
  const messageHash = hashMessagePayload(method, payload);
  const publicKeyCommitment = profile.currentPublicKeyCommitment ?? keccak256(profile.currentKey.publicKey);
  return {
    address: account,
    chainId: profile.chainId ?? fallbackChainId,
    algorithm: "ML-DSA-65",
    publicKeyCommitment,
    keyVersion: profile.keyVersion,
    messageHash,
    signature: signMLDSA65(messageHash, profile.currentKey.privateKey, { context: MINERVA_MESSAGE_CONTEXT }),
  };
}

// ---------------------------------------------------------------------------------------------
// Decoding for the review screen
// ---------------------------------------------------------------------------------------------

export interface TypedDataView {
  domain: Record<string, unknown>;
  primaryType?: string;
  message: unknown;
  types: Record<string, unknown>;
  prettyJson: string;
}

export interface DecodedMessage {
  kind: "text" | "hex" | "typed-data";
  /** Human-readable form (UTF-8 text, hex fallback, or pretty JSON). */
  display: string;
  /** Raw payload exactly as the dapp sent it (stringified when it was an object). */
  raw: string;
  typedData?: TypedDataView;
  warnings: SigningWarning[];
}

export interface SigningWarning {
  severity: "warning" | "critical" | "review";
  title: string;
  detail: string;
}

function parseTypedData(payload: unknown): Record<string, unknown> | undefined {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload as Record<string, unknown>;
  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const PERMIT_TYPES = ["Permit", "PermitSingle", "PermitBatch", "PermitTransferFrom", "PermitBatchTransferFrom", "PermitDetails", "PermitWitnessTransferFrom"];
const SPENDING_FIELDS = ["spender", "allowance", "allowed", "operator", "approved"];

function collectKeys(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 6 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out, depth + 1);
    return;
  }
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out.add(key);
    collectKeys(inner, out, depth + 1);
  }
}

export function detectSigningWarnings(view: TypedDataView | undefined, activeChainId: number): SigningWarning[] {
  const warnings: SigningWarning[] = [];
  if (!view) return warnings;
  const typeNames = Object.keys(view.types ?? {});
  const primary = view.primaryType ?? "";
  const permitType = PERMIT_TYPES.find((t) => t === primary) ?? typeNames.find((t) => PERMIT_TYPES.includes(t) || /permit/i.test(t));
  const messageKeys = new Set<string>();
  collectKeys(view.message, messageKeys);
  const spendingKeys = SPENDING_FIELDS.filter((field) => messageKeys.has(field));
  if (permitType || /permit/i.test(primary)) {
    warnings.push({
      severity: "critical",
      title: "Token approval signature",
      detail: `This is a ${permitType ?? primary} message. Signing lets the spender move your tokens without a separate transaction. Only continue if you trust this site.`,
    });
  } else if (spendingKeys.length > 0) {
    warnings.push({
      severity: "warning",
      title: "Spending authority fields",
      detail: `The message contains ${spendingKeys.join(", ")}. It may grant another address control over your assets.`,
    });
  }
  const domainChain = view.domain?.chainId;
  if (domainChain !== undefined && domainChain !== null) {
    let parsed: number | undefined;
    try {
      parsed = Number(BigInt(String(domainChain)));
    } catch {
      parsed = undefined;
    }
    if (parsed !== undefined && parsed !== activeChainId) {
      warnings.push({
        severity: "warning",
        title: "Different chain in domain",
        detail: `The typed data is bound to chain ${parsed}, but your wallet is on chain ${activeChainId}.`,
      });
    }
  }
  if (view.domain && !view.domain.verifyingContract && (permitType || spendingKeys.length > 0)) {
    warnings.push({
      severity: "review",
      title: "No verifying contract",
      detail: "The domain does not name a verifying contract, so the signature could be replayed by any contract that accepts it.",
    });
  }
  return warnings;
}

export function decodeMessageForReview(method: string, payload: unknown, activeChainId: number): DecodedMessage {
  if (canonicalSigningMethod(method) === "minerva_signTypedData") {
    const parsed = parseTypedData(payload);
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload ?? null);
    if (!parsed) {
      return {
        kind: "typed-data",
        display: raw,
        raw,
        warnings: [{ severity: "warning", title: "Unreadable typed data", detail: "The payload is not a valid EIP-712 object. Review the raw payload carefully." }],
      };
    }
    const view: TypedDataView = {
      domain: (parsed.domain as Record<string, unknown>) ?? {},
      primaryType: typeof parsed.primaryType === "string" ? parsed.primaryType : undefined,
      message: parsed.message,
      types: (parsed.types as Record<string, unknown>) ?? {},
      prettyJson: JSON.stringify(parsed, null, 2),
    };
    return { kind: "typed-data", display: view.prettyJson, raw, typedData: view, warnings: detectSigningWarnings(view, activeChainId) };
  }

  if (typeof payload !== "string") {
    const raw = JSON.stringify(payload ?? null);
    return { kind: "hex", display: raw, raw, warnings: [{ severity: "warning", title: "Unexpected payload", detail: "The message is not a string." }] };
  }
  if (isHex(payload)) {
    let text: string | undefined;
    try {
      text = decodeUtf8(hexToBytes(payload));
    } catch {
      text = undefined;
    }
    const printable = text !== undefined && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
    const warnings: SigningWarning[] = [];
    if (!printable) {
      warnings.push({ severity: "warning", title: "Binary message", detail: "The message is raw bytes, not readable text. Do not sign unless the site explained exactly what it is." });
    }
    return { kind: printable ? "text" : "hex", display: printable ? text! : payload, raw: payload, warnings };
  }
  return { kind: "text", display: payload, raw: payload, warnings: [] };
}
