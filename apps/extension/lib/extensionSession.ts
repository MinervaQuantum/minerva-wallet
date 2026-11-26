/**
 * Unlocked session.
 *
 * The passcode lives ONLY in chrome.storage.session (MV3 memory-only storage that is cleared
 * when the browser exits and is never written to disk) together with an expiry. A chrome.alarms
 * alarm handled by the background worker clears it at expiry; every reader also checks the
 * expiry itself so a missed alarm cannot keep the wallet unlocked.
 */

export const EXTENSION_SESSION_KEY = "minerva.extension.session.v1";
export const EXTENSION_AUTO_LOCK_KEY = "minerva.extension.auto-lock-minutes.v1";
export const AUTO_LOCK_ALARM = "minerva:auto-lock";
export const DEFAULT_AUTO_LOCK_MINUTES = 15;
/** Minutes; 0 means never. */
export const AUTO_LOCK_OPTIONS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 1, label: "1 minute" },
  { minutes: 5, label: "5 minutes" },
  { minutes: 15, label: "15 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 0, label: "Never" },
];

export interface UnlockedSession {
  passcode: string;
  unlockedAt: number;
  /** Epoch ms; null when auto-lock is off. */
  expiresAt: number | null;
}

function sessionArea(): chrome.storage.StorageArea | undefined {
  try {
    return chrome.storage?.session;
  } catch {
    return undefined;
  }
}

function areaGet<T>(area: chrome.storage.StorageArea, key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      area.get(key, (items) => {
        if (chrome.runtime.lastError) {
          resolve(undefined);
          return;
        }
        resolve(items?.[key] as T | undefined);
      });
    } catch {
      resolve(undefined);
    }
  });
}

export async function readAutoLockMinutes(): Promise<number> {
  const stored = await areaGet<number>(chrome.storage.local, EXTENSION_AUTO_LOCK_KEY);
  if (typeof stored === "number" && Number.isFinite(stored) && stored >= 0) return stored;
  return DEFAULT_AUTO_LOCK_MINUTES;
}

/** Persists the auto-lock window and re-arms the current session (if any) with the new window. */
export async function writeAutoLockMinutes(minutes: number): Promise<void> {
  if (!Number.isFinite(minutes) || minutes < 0) throw new Error("Invalid auto-lock window.");
  await chrome.storage.local.set({ [EXTENSION_AUTO_LOCK_KEY]: minutes });
  const session = await readUnlockedSession();
  if (session) await startUnlockedSession(session.passcode, minutes);
}

async function armAutoLockAlarm(expiresAt: number | null): Promise<void> {
  const alarms = chrome.alarms;
  if (!alarms) return;
  try {
    await new Promise<void>((resolve) => alarms.clear(AUTO_LOCK_ALARM, () => resolve()));
    if (expiresAt !== null) alarms.create(AUTO_LOCK_ALARM, { when: expiresAt });
  } catch {
    // Without alarms the expiry check in readUnlockedSession still locks on the next open.
  }
}

/** Stores the passcode for the unlocked window and schedules the auto-lock alarm. */
export async function startUnlockedSession(passcode: string, minutes?: number): Promise<UnlockedSession | undefined> {
  const area = sessionArea();
  if (!area) return undefined;
  const window = minutes ?? (await readAutoLockMinutes());
  const now = Date.now();
  const session: UnlockedSession = {
    passcode,
    unlockedAt: now,
    expiresAt: window > 0 ? now + window * 60_000 : null,
  };
  try {
    await area.set({ [EXTENSION_SESSION_KEY]: session });
  } catch {
    return undefined;
  }
  await armAutoLockAlarm(session.expiresAt);
  return session;
}

/** The live session, or undefined when locked or expired (an expired session is cleared). */
export async function readUnlockedSession(): Promise<UnlockedSession | undefined> {
  const area = sessionArea();
  if (!area) return undefined;
  const session = await areaGet<UnlockedSession>(area, EXTENSION_SESSION_KEY);
  if (!session || typeof session.passcode !== "string") return undefined;
  if (session.expiresAt !== null && session.expiresAt <= Date.now()) {
    await clearUnlockedSession();
    return undefined;
  }
  return session;
}

/** Restarts the inactivity window after user activity (MetaMask-style auto-lock). */
export async function touchUnlockedSession(): Promise<void> {
  const session = await readUnlockedSession();
  if (!session || session.expiresAt === null) return;
  await startUnlockedSession(session.passcode);
}

export async function clearUnlockedSession(): Promise<void> {
  const area = sessionArea();
  if (area) {
    try {
      await area.remove(EXTENSION_SESSION_KEY);
    } catch {
      // Nothing to clear.
    }
  }
  await armAutoLockAlarm(null);
}
