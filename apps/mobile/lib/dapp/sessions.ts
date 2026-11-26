/**
 * Connected-site registry for the in-app dapp browser.
 *
 * Keyed by origin. A session grants `eth_accounts` for the listed accounts; it is created when the
 * user approves a connect request and removed by Disconnect / wallet_revokePermissions.
 * WalletConnect sessions live in WalletKit's own store and are listed separately.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "minerva.wallet.dapp.sessions.v1";

export interface DappSession {
  origin: string;
  /** Lower-case 0x addresses the site may see. */
  accounts: string[];
  chainId: number;
  connectedAt: string;
  lastUsedAt: string;
  name?: string;
  iconUrl?: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: Record<string, DappSession> | undefined;

function notify() {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // never let one listener break the others
    }
  }
}

export function onDappSessionsChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function readAll(): Promise<Record<string, DappSession>> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, DappSession>) : {};
    cache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    cache = {};
  }
  return cache;
}

async function writeAll(next: Record<string, DappSession>): Promise<void> {
  cache = next;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  notify();
}

export function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

export async function listDappSessions(): Promise<DappSession[]> {
  const all = await readAll();
  return Object.values(all).sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : -1));
}

export async function getDappSession(origin: string): Promise<DappSession | undefined> {
  const all = await readAll();
  return all[normalizeOrigin(origin)];
}

export async function saveDappSession(input: {
  origin: string;
  accounts: string[];
  chainId: number;
  name?: string;
  iconUrl?: string;
}): Promise<DappSession> {
  const all = await readAll();
  const origin = normalizeOrigin(input.origin);
  const now = new Date().toISOString();
  const existing = all[origin];
  const session: DappSession = {
    origin,
    accounts: input.accounts.map((a) => a.toLowerCase()),
    chainId: input.chainId,
    connectedAt: existing?.connectedAt ?? now,
    lastUsedAt: now,
    name: input.name ?? existing?.name,
    iconUrl: input.iconUrl ?? existing?.iconUrl,
  };
  await writeAll({ ...all, [origin]: session });
  return session;
}

export async function touchDappSession(origin: string, chainId?: number): Promise<void> {
  const all = await readAll();
  const key = normalizeOrigin(origin);
  const existing = all[key];
  if (!existing) return;
  await writeAll({
    ...all,
    [key]: { ...existing, lastUsedAt: new Date().toISOString(), chainId: chainId ?? existing.chainId },
  });
}

export async function removeDappSession(origin: string): Promise<void> {
  const all = await readAll();
  const key = normalizeOrigin(origin);
  if (!all[key]) return;
  const next = { ...all };
  delete next[key];
  await writeAll(next);
}

export async function clearDappSessions(): Promise<void> {
  await writeAll({});
}

/** Accounts a site may see right now: the session's accounts filtered to the active address. */
export function sessionAccountsFor(session: DappSession | undefined, activeAddress: string | undefined): string[] {
  if (!session || !activeAddress) return [];
  const active = activeAddress.toLowerCase();
  return session.accounts.includes(active) ? [active] : [];
}
