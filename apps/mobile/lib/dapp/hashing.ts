/**
 * Self-contained keccak-256 and hex helpers for the dapp layer.
 *
 * The mobile app cannot import viem directly (it is only a nested dependency of the shared
 * packages), so the message hashing the browser extension performs with viem's `keccak256`,
 * `stringToHex` and `isHex` is reproduced here. The outputs are byte-for-byte identical; the
 * implementation is verified against the standard keccak test vectors (see scripts in the
 * release notes for this module).
 */
import type { Hex } from "@minerva/core";

const ROUND_CONSTANTS: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// Rotation offsets r[x][y] for the rho step, indexed as ROTATION[x][y].
const ROTATION: number[][] = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

const MASK64 = (1n << 64n) - 1n;
const RATE_BYTES = 136; // 1600 - 2 * 256 bits

function rotl(value: bigint, shift: number): bigint {
  if (shift === 0) return value;
  const s = BigInt(shift);
  return ((value << s) | (value >> (64n - s))) & MASK64;
}

function keccakF(state: bigint[]): void {
  for (let round = 0; round < 24; round += 1) {
    // theta
    const c: bigint[] = new Array<bigint>(5);
    for (let x = 0; x < 5; x += 1) {
      c[x] = state[x]! ^ state[x + 5]! ^ state[x + 10]! ^ state[x + 15]! ^ state[x + 20]!;
    }
    for (let x = 0; x < 5; x += 1) {
      const d = c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1);
      for (let y = 0; y < 5; y += 1) state[x + 5 * y] = state[x + 5 * y]! ^ d;
    }
    // rho + pi
    const b: bigint[] = new Array<bigint>(25);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const nx = y;
        const ny = (2 * x + 3 * y) % 5;
        b[nx + 5 * ny] = rotl(state[x + 5 * y]!, ROTATION[x]![y]!);
      }
    }
    // chi
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = b[x + 5 * y]! ^ (~b[((x + 1) % 5) + 5 * y]! & MASK64 & b[((x + 2) % 5) + 5 * y]!);
      }
    }
    // iota
    state[0] = state[0]! ^ ROUND_CONSTANTS[round]!;
  }
}

function readLane(block: Uint8Array, offset: number): bigint {
  let lane = 0n;
  for (let i = 7; i >= 0; i -= 1) lane = (lane << 8n) | BigInt(block[offset + i] ?? 0);
  return lane;
}

/** keccak-256 of raw bytes (the Ethereum variant, with 0x01 domain padding, not SHA3). */
export function keccak256Bytes(input: Uint8Array): Uint8Array {
  const state: bigint[] = new Array<bigint>(25).fill(0n);
  const paddedLength = (Math.floor(input.length / RATE_BYTES) + 1) * RATE_BYTES;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[paddedLength - 1] = (padded[paddedLength - 1] ?? 0) | 0x80;

  for (let offset = 0; offset < paddedLength; offset += RATE_BYTES) {
    for (let lane = 0; lane < RATE_BYTES / 8; lane += 1) {
      state[lane] = state[lane]! ^ readLane(padded, offset + lane * 8);
    }
    keccakF(state);
  }

  const out = new Uint8Array(32);
  for (let lane = 0; lane < 4; lane += 1) {
    let value = state[lane]!;
    for (let i = 0; i < 8; i += 1) {
      out[lane * 8 + i] = Number(value & 0xffn);
      value >>= 8n;
    }
  }
  return out;
}

export function isHex(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

export function bytesToHex(bytes: Uint8Array): Hex {
  let out = "0x";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out as Hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new Error("Invalid hex payload.");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function encodeUtf8(value: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value);
  // Manual UTF-8 encoding for runtimes without TextEncoder.
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    let code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const low = value.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(bytes);
}

/** Decodes UTF-8 bytes to a string; returns undefined when the bytes are not valid UTF-8 text. */
export function decodeUtf8(bytes: Uint8Array): string | undefined {
  const TextDecoderCtor = (globalThis as { TextDecoder?: new (label?: string, options?: { fatal?: boolean }) => { decode(input: Uint8Array): string } }).TextDecoder;
  if (TextDecoderCtor) {
    try {
      return new TextDecoderCtor("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return undefined;
    }
  }
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i]!;
    let code: number;
    let extra: number;
    if (b0 < 0x80) {
      code = b0;
      extra = 0;
    } else if ((b0 & 0xe0) === 0xc0) {
      code = b0 & 0x1f;
      extra = 1;
    } else if ((b0 & 0xf0) === 0xe0) {
      code = b0 & 0x0f;
      extra = 2;
    } else if ((b0 & 0xf8) === 0xf0) {
      code = b0 & 0x07;
      extra = 3;
    } else return undefined;
    for (let k = 1; k <= extra; k += 1) {
      const next = bytes[i + k];
      if (next === undefined || (next & 0xc0) !== 0x80) return undefined;
      code = (code << 6) | (next & 0x3f);
    }
    i += extra + 1;
    out += String.fromCodePoint(code);
  }
  return out;
}

/** viem's `stringToHex`: UTF-8 encode, then hex. */
export function stringToHex(value: string): Hex {
  return bytesToHex(encodeUtf8(value));
}

/** keccak-256 of a hex string, as viem's `keccak256(hex)`. */
export function keccak256(hex: Hex): Hex {
  return bytesToHex(keccak256Bytes(hexToBytes(hex)));
}

/** Lower-case address equality, tolerant of missing or malformed inputs. */
export function sameAddress(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a && b) && a!.toLowerCase() === b!.toLowerCase();
}

/** Decimal or 0x-quantity to bigint; undefined/null → 0n. */
export function quantityToBigInt(value: unknown): bigint {
  if (value === undefined || value === null || value === "") return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error("Invalid quantity.");
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return BigInt(trimmed);
    if (/^\d+$/.test(trimmed)) return BigInt(trimmed);
  }
  throw new Error("Invalid quantity.");
}

export function toQuantityHex(value: bigint | number): Hex {
  return `0x${BigInt(value).toString(16)}` as Hex;
}
