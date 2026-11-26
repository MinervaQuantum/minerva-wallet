/**
 * Dapp browser bookmarks (AsyncStorage) plus the short list of suggested Minerva links shown
 * when the browser opens with no bookmarks.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "minerva.wallet.dapp.bookmarks.v1";

export interface Bookmark {
  url: string;
  title: string;
  addedAt: string;
}

export const SUGGESTED_LINKS: ReadonlyArray<{ url: string; title: string; detail: string }> = [
  { url: "https://minervachain.org", title: "Minerva", detail: "Network home and documentation" },
  { url: "https://testnet.minervachain.org", title: "Minerva Testnet", detail: "Explorer, faucet and testnet tools" },
];

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: Bookmark[] | undefined;

function notify() {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

export function onBookmarksChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function readAll(): Promise<Bookmark[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Bookmark[]) : [];
    cache = Array.isArray(parsed) ? parsed.filter((b) => b && typeof b.url === "string") : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function writeAll(next: Bookmark[]): Promise<void> {
  cache = next;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  notify();
}

/** Normalises user input into an https URL, or returns undefined when it cannot be one. */
export function normalizeBrowserUrl(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  let candidate = trimmed;
  if (/^http:\/\//i.test(candidate)) candidate = `https://${candidate.slice(7)}`;
  else if (!/^https:\/\//i.test(candidate)) {
    if (/\s/.test(candidate) || !candidate.includes(".")) return undefined;
    candidate = `https://${candidate}`;
  }
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") return undefined;
    if (!url.hostname || !url.hostname.includes(".")) {
      if (url.hostname !== "localhost") return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export async function listBookmarks(): Promise<Bookmark[]> {
  return [...(await readAll())];
}

export async function isBookmarked(url: string): Promise<boolean> {
  const key = bookmarkKey(url);
  return (await readAll()).some((b) => bookmarkKey(b.url) === key);
}

function bookmarkKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export async function addBookmark(url: string, title?: string): Promise<Bookmark> {
  const all = await readAll();
  const key = bookmarkKey(url);
  const existing = all.find((b) => bookmarkKey(b.url) === key);
  if (existing) return existing;
  const bookmark: Bookmark = { url, title: title?.trim() || hostOf(url), addedAt: new Date().toISOString() };
  await writeAll([bookmark, ...all]);
  return bookmark;
}

export async function removeBookmark(url: string): Promise<void> {
  const all = await readAll();
  const key = bookmarkKey(url);
  await writeAll(all.filter((b) => bookmarkKey(b.url) !== key));
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
