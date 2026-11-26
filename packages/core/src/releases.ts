/**
 * Release manifest published next to the wallet artifacts
 * (https://testnet.minervachain.org/downloads/latest.json) by scripts/publish-wallets.sh.
 * The apps compare their own version against it and point the user at the signed files.
 */
export const RELEASES_INDEX_URL = "https://testnet.minervachain.org/downloads/";
export const LATEST_RELEASE_URL = `${RELEASES_INDEX_URL}latest.json`;

export interface ReleaseFile {
  name: string;
  sha256: string;
  size: number;
}

export interface ReleaseManifest {
  version: string;
  publishedAt: string;
  baseUrl: string;
  files: ReleaseFile[];
  checksums: string;
  signature: string;
  publicKey: string;
}

export interface UpdateCheck {
  current: string;
  latest: string;
  updateAvailable: boolean;
  manifest: ReleaseManifest;
}

/** Numeric comparison of dotted versions; pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10)).map((x) => (Number.isFinite(x) ? x : 0));
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10)).map((x) => (Number.isFinite(x) ? x : 0));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function isManifest(value: unknown): value is ReleaseManifest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.version === "string" && typeof v.baseUrl === "string" && Array.isArray(v.files);
}

type FetchLike = (url: string, init?: { signal?: unknown; cache?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
type AbortControllerLike = { signal: unknown; abort(): void };
const timers = globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void };

function defaultFetch(): FetchLike {
  const f = (globalThis as { fetch?: FetchLike }).fetch;
  if (!f) throw new Error("fetch is not available in this runtime");
  return f;
}

export async function fetchLatestRelease(
  options: { url?: string; fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<ReleaseManifest> {
  const fetchImpl = options.fetchImpl ?? defaultFetch();
  const Ctor = (globalThis as { AbortController?: new () => AbortControllerLike }).AbortController;
  const controller = Ctor ? new Ctor() : undefined;
  const timer = timers.setTimeout(() => controller?.abort(), options.timeoutMs ?? 8000);
  try {
    const response = await fetchImpl(options.url ?? LATEST_RELEASE_URL, { signal: controller?.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`release manifest: HTTP ${response.status}`);
    const payload: unknown = await response.json();
    if (!isManifest(payload)) throw new Error("release manifest: unexpected shape");
    return payload;
  } finally {
    timers.clearTimeout(timer);
  }
}

export async function checkForUpdate(
  current: string,
  options: { url?: string; fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<UpdateCheck> {
  const manifest = await fetchLatestRelease(options);
  return { current, latest: manifest.version, updateAvailable: compareVersions(manifest.version, current) > 0, manifest };
}
