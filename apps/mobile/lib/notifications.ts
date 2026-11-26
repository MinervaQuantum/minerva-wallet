/**
 * Local notifications for wallet events, with a background poll of the public indexer.
 *
 * Nothing is pushed from a server: the device asks the indexer for new activity on the active
 * account (every ~15 minutes in the background via expo-background-fetch, and whenever the app
 * comes to the foreground) and raises a local notification for anything it has not seen.
 */
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Hex } from "@minerva/core";
import { defaultMinervaIndexerUrl, formatBalanceWei, readMinervaAccountActivity } from "@minerva/evm";
import { accountAddress, getActiveAccount } from "@/lib/accounts";
import { getSelectedChainId } from "@/lib/networkPreference";
import { configuredMinervaChainId, readPublicEnv } from "@/lib/runtimeConfig";
import { getRehearsalState } from "@/lib/backupState";
import { listPendingTransactions, refreshPendingStatuses } from "@/lib/pendingTransactions";

const SETTINGS_KEY = "minerva.wallet.notifications.v1";
const SEEN_PREFIX = "minerva.wallet.notifications.seen.v1";
export const BACKGROUND_TASK = "minerva-wallet-activity-poll";

export interface NotificationSettings {
  enabled: boolean;
  incoming: boolean;
  confirmations: boolean;
  security: boolean;
}

const DEFAULTS: NotificationSettings = { enabled: false, incoming: true, confirmations: true, security: true };

const native = Platform.OS === "ios" || Platform.OS === "android";

type NotificationsModule = typeof import("expo-notifications");
type BackgroundFetchModule = typeof import("expo-background-fetch");
type TaskManagerModule = typeof import("expo-task-manager");

function loadNotifications(): NotificationsModule | undefined {
  if (!native) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-notifications") as NotificationsModule;
  } catch {
    return undefined;
  }
}

function loadBackground(): { fetch: BackgroundFetchModule; tasks: TaskManagerModule } | undefined {
  if (!native) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fetch = require("expo-background-fetch") as BackgroundFetchModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tasks = require("expo-task-manager") as TaskManagerModule;
    return { fetch, tasks };
  } catch {
    return undefined;
  }
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<NotificationSettings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export async function setNotificationSettings(patch: Partial<NotificationSettings>): Promise<NotificationSettings> {
  const next = { ...(await getNotificationSettings()), ...patch };
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  if (next.enabled) await registerBackgroundPoll();
  else await unregisterBackgroundPoll();
  return next;
}

export type PermissionState = "granted" | "denied" | "undetermined" | "unsupported";

export async function getPermissionState(): Promise<PermissionState> {
  const mod = loadNotifications();
  if (!mod) return "unsupported";
  try {
    const { status } = await mod.getPermissionsAsync();
    return status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined";
  } catch {
    return "unsupported";
  }
}

export async function requestPermission(): Promise<PermissionState> {
  const mod = loadNotifications();
  if (!mod) return "unsupported";
  try {
    const { status } = await mod.requestPermissionsAsync();
    return status === "granted" ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
}

let handlerInstalled = false;

export async function notify(title: string, body: string, data: Record<string, unknown> = {}): Promise<boolean> {
  const mod = loadNotifications();
  if (!mod) return false;
  try {
    if (!handlerInstalled) {
      mod.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
      handlerInstalled = true;
    }
    await mod.scheduleNotificationAsync({ content: { title, body, data }, trigger: null });
    return true;
  } catch {
    return false;
  }
}

async function readSeen(key: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(`${SEEN_PREFIX}.${key}`);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

async function writeSeen(key: string, seen: Set<string>) {
  await AsyncStorage.setItem(`${SEEN_PREFIX}.${key}`, JSON.stringify([...seen].slice(-500)));
}

async function activeContext(): Promise<{ chainId: number; address: Hex } | undefined> {
  const account = await getActiveAccount();
  if (!account) return undefined;
  const address = await accountAddress(account);
  if (!address) return undefined;
  const chainId = (await getSelectedChainId()) ?? configuredMinervaChainId();
  return { chainId, address };
}

/**
 * One poll: new incoming transfers, newly confirmed pending envelopes, and an overdue Recovery Kit
 * rehearsal. Returns the number of notifications raised. Safe to call often; it only notifies once
 * per hash.
 */
export async function checkForNewActivity(options: { silentFirstRun?: boolean } = {}): Promise<number> {
  const settings = await getNotificationSettings();
  if (!settings.enabled) return 0;
  const context = await activeContext();
  if (!context) return 0;
  const indexerUrl = readPublicEnv("EXPO_PUBLIC_MINERVA_INDEXER_URL") ?? defaultMinervaIndexerUrl(context.chainId);
  const seenKey = `${context.chainId}.${context.address.toLowerCase()}`;
  const seen = await readSeen(seenKey);
  const firstRun = seen.size === 0;
  let raised = 0;

  if (settings.incoming) {
    const activity = await readMinervaAccountActivity(context.address, { chainId: context.chainId, indexerUrl }).catch(() => undefined);
    for (const tx of activity?.transactions ?? []) {
      if (!tx.hash || seen.has(tx.hash)) continue;
      seen.add(tx.hash);
      const incoming = tx.to?.toLowerCase() === context.address.toLowerCase() && tx.from?.toLowerCase() !== context.address.toLowerCase();
      if (!incoming || (firstRun && options.silentFirstRun !== false)) continue;
      const value = tx.value !== undefined ? BigInt(tx.value) : 0n;
      if (await notify("Received MRV", `${formatBalanceWei(value)} MRV from ${tx.from?.slice(0, 6)}…${tx.from?.slice(-4)}`, { hash: tx.hash })) raised += 1;
    }
  }

  if (settings.confirmations) {
    const pendingContext = { chainId: context.chainId, accountAddress: context.address };
    const before = await listPendingTransactions(pendingContext);
    const wasPending = new Set(before.filter((item) => item.state === "pending").map((item) => item.hash));
    if (wasPending.size > 0) {
      await refreshPendingStatuses(pendingContext, { chainId: context.chainId }).catch(() => false);
      const after = await listPendingTransactions(pendingContext);
      for (const item of after) {
        if (!wasPending.has(item.hash) || item.state === "pending") continue;
        const key = `confirm:${item.hash}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const label = item.state === "success" ? "confirmed" : item.state === "failed" ? "failed" : item.state;
        if (await notify(`Transaction ${label}`, item.title, { hash: item.hash })) raised += 1;
      }
    }
  }

  if (settings.security) {
    const rehearsal = await getRehearsalState(context.chainId).catch(() => undefined);
    const key = "security:rehearsal-overdue";
    const overdue = rehearsal && "lastRehearsedAt" in rehearsal && typeof rehearsal.lastRehearsedAt === "string"
      ? Date.now() - Date.parse(rehearsal.lastRehearsedAt) > 90 * 24 * 60 * 60_000
      : false;
    if (overdue && !seen.has(key)) {
      seen.add(key);
      if (await notify("Rehearse your Recovery Kit", "It has been more than 90 days since the kit was last verified.", {})) raised += 1;
    }
  }

  await writeSeen(seenKey, seen);
  return raised;
}

let taskDefined = false;

/** Defines the background task once per process; must run at module load on native. */
export function defineBackgroundTask(): void {
  const background = loadBackground();
  if (!background || taskDefined) return;
  taskDefined = true;
  try {
    background.tasks.defineTask(BACKGROUND_TASK, async () => {
      try {
        const raised = await checkForNewActivity();
        return raised > 0 ? background.fetch.BackgroundFetchResult.NewData : background.fetch.BackgroundFetchResult.NoData;
      } catch {
        return background.fetch.BackgroundFetchResult.Failed;
      }
    });
  } catch {
    // Task already defined (hot reload) or unsupported.
  }
}

export async function registerBackgroundPoll(): Promise<boolean> {
  const background = loadBackground();
  if (!background) return false;
  try {
    defineBackgroundTask();
    const registered = await background.tasks.isTaskRegisteredAsync(BACKGROUND_TASK);
    if (!registered) {
      await background.fetch.registerTaskAsync(BACKGROUND_TASK, { minimumInterval: 15 * 60, stopOnTerminate: false, startOnBoot: true });
    }
    return true;
  } catch {
    return false;
  }
}

export async function unregisterBackgroundPoll(): Promise<void> {
  const background = loadBackground();
  if (!background) return;
  try {
    if (await background.tasks.isTaskRegisteredAsync(BACKGROUND_TASK)) await background.fetch.unregisterTaskAsync(BACKGROUND_TASK);
  } catch {
    // nothing to undo
  }
}

let foregroundHooked = false;

/** Call once at app start: defines the task and polls whenever the app becomes active. */
export function initNotifications(): void {
  defineBackgroundTask();
  if (foregroundHooked) return;
  foregroundHooked = true;
  void checkForNewActivity({ silentFirstRun: true }).catch(() => 0);
  AppState.addEventListener("change", (state) => {
    if (state === "active") void checkForNewActivity().catch(() => 0);
  });
}
