import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import {
  EXTENSION_ACCOUNTS_STORAGE_KEY,
  addExtensionAccount,
  createExtensionWalletProfile,
  exportExtensionRecoveryKit,
  importExtensionAccountFromKit,
  listExtensionAccounts,
  loadExtensionAccounts,
  moveExtensionAccount,
  readExtensionActivity,
  removeExtensionAccount,
  renameExtensionAccount,
  restoreExtensionWalletProfile,
  setActiveExtensionAccount,
  setExtensionAccountHidden,
  unlockExtensionWalletProfile,
  wipeExtensionWallet,
  type ExtensionAccountSummary,
  type ExtensionActivityItem,
  type ExtensionPQWalletProfile,
} from "./extensionWalletVault";
import {
  readExtensionWalletSnapshot,
  requestExtensionFaucet,
  rotateExtensionPQKey,
  sendExtensionDeviceCall,
  sendExtensionMrv,
  sendExtensionToken,
  type ExtensionWalletSnapshot,
} from "./extensionWalletRuntime";
import {
  EXTENSION_AUTO_LOCK_KEY,
  EXTENSION_SESSION_KEY,
  clearUnlockedSession,
  readAutoLockMinutes,
  readUnlockedSession,
  startUnlockedSession,
  touchUnlockedSession,
  writeAutoLockMinutes,
} from "./extensionSession";
import {
  addCustomToken,
  discoverTrackedTokens,
  readTrackedTokenBalances,
  removeTrackedToken,
  setTrackedTokenHidden,
  type TrackedToken,
  type TrackedTokenBalance,
} from "./extensionTokens";

export type WalletStatus = "loading" | "no-wallet" | "locked" | "unlocked";

export interface ExtensionWalletState {
  status: WalletStatus;
  busy: boolean;
  error: string | null;
  snapshot: ExtensionWalletSnapshot | null;
  /** This extension's current ML-DSA public key: paste it into the phone's Device keys screen to enrol it. */
  devicePublicKey: string | null;
  activity: ExtensionActivityItem[];
  /** Every account, hidden ones included, in display order. */
  accounts: ExtensionAccountSummary[];
  activeAccount: ExtensionAccountSummary | null;
  /** Tracked ERC-20 tokens on the active account's chain with live balances. */
  tokens: TrackedTokenBalance[];
  autoLockMinutes: number;
  createWallet: (passcode: string) => Promise<void>;
  unlock: (passcode: string) => Promise<void>;
  restore: (encoded: string, passcode: string) => Promise<void>;
  lock: () => Promise<void>;
  refresh: () => Promise<void>;
  faucet: () => Promise<void>;
  send: (args: { recipient: string; amount: string }) => Promise<void>;
  sendToken: (args: { token: TrackedToken; recipient: string; amount: string }) => Promise<void>;
  /** Spend from an account that enrolled this key as a device key. */
  sendAsDevice: (args: { accountAddress: string; recipient: string; amount: string }) => Promise<void>;
  rotate: () => Promise<void>;
  exportKit: (accountId?: string) => Promise<string>;
  wipe: () => Promise<void>;
  clearError: () => void;
  // Accounts
  switchAccount: (id: string) => Promise<void>;
  addAccount: (label?: string) => Promise<void>;
  importAccount: (encoded: string, kitPasscode: string, label?: string) => Promise<void>;
  renameAccount: (id: string, label: string) => Promise<void>;
  setAccountHidden: (id: string, hidden: boolean) => Promise<void>;
  moveAccount: (id: string, direction: -1 | 1) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  // Tokens
  addToken: (address: string) => Promise<void>;
  setTokenHidden: (address: Hex, hidden: boolean) => Promise<void>;
  removeToken: (address: Hex) => Promise<void>;
  discoverTokens: () => Promise<number>;
  // Auto-lock
  setAutoLockMinutes: (minutes: number) => Promise<void>;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

/**
 * Standalone-signer state machine for the popup and options surfaces.
 *
 * The decrypted profile is held in a ref for the unlocked session. The passcode is held in a
 * ref too and mirrored into chrome.storage.session (memory-only) so reopening the popup within
 * the auto-lock window does not ask for it again; it is never written to chrome.storage.local.
 */
export function useExtensionWallet(): ExtensionWalletState {
  const [status, setStatus] = useState<WalletStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ExtensionWalletSnapshot | null>(null);
  const [activity, setActivity] = useState<ExtensionActivityItem[]>([]);
  const [accounts, setAccounts] = useState<ExtensionAccountSummary[]>([]);
  const [tokens, setTokens] = useState<TrackedTokenBalance[]>([]);
  const [autoLockMinutes, setAutoLockState] = useState(15);

  const profileRef = useRef<ExtensionPQWalletProfile | null>(null);
  const passcodeRef = useRef<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const statusRef = useRef<WalletStatus>("loading");
  /** True while this hook is itself changing the active account; the storage listener then stays quiet. */
  const mutatingAccountsRef = useRef(false);
  statusRef.current = status;

  const refreshAccounts = useCallback(async () => {
    const list = await listExtensionAccounts();
    setAccounts(list);
    activeIdRef.current = list.find((a) => a.active)?.id ?? null;
    return list;
  }, []);

  /** Live reads for the unlocked profile: chain snapshot, token balances, activity. */
  const loadLiveState = useCallback(async (profile: ExtensionPQWalletProfile, passcode: string) => {
    const { profile: saved, snapshot: snap } = await readExtensionWalletSnapshot(profile, passcode);
    profileRef.current = saved;
    setSnapshot(snap);
    setActivity(await readExtensionActivity(snap.address, snap.chainId));
    try {
      setTokens(await readTrackedTokenBalances(snap.chainId, snap.address));
    } catch {
      // Token reads are best effort; the native balance is already shown.
    }
    await refreshAccounts();
  }, [refreshAccounts]);

  const enterUnlocked = useCallback(
    async (profile: ExtensionPQWalletProfile, passcode: string, persistSession: boolean) => {
      profileRef.current = profile;
      passcodeRef.current = passcode;
      setSnapshot(null);
      setTokens([]);
      setActivity(await readExtensionActivity(profile.accountAddress));
      setStatus("unlocked");
      if (persistSession) await startUnlockedSession(passcode);
      try {
        await loadLiveState(profile, passcode);
      } catch (e) {
        setError(messageOf(e));
      }
    },
    [loadLiveState],
  );

  const resetToLocked = useCallback((next: "locked" | "no-wallet") => {
    profileRef.current = null;
    passcodeRef.current = null;
    setSnapshot(null);
    setTokens([]);
    setActivity([]);
    setError(null);
    setStatus(next);
  }, []);

  // Initial load: migrate / read accounts, then resume the session when one is still open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAutoLockState(await readAutoLockMinutes());
      const registry = await loadExtensionAccounts();
      if (cancelled) return;
      if (!registry) {
        setAccounts([]);
        setStatus("no-wallet");
        return;
      }
      await refreshAccounts();
      const session = await readUnlockedSession();
      if (cancelled) return;
      if (session) {
        try {
          const profile = await unlockExtensionWalletProfile(session.passcode);
          if (cancelled) return;
          await touchUnlockedSession();
          await enterUnlocked(profile, session.passcode, false);
          return;
        } catch {
          await clearUnlockedSession();
        }
      }
      if (!cancelled) setStatus("locked");
    })().catch(() => {
      if (!cancelled) setStatus("no-wallet");
    });
    return () => {
      cancelled = true;
    };
  }, [enterUnlocked, refreshAccounts]);

  // React to changes made by other surfaces (options page, background auto-lock alarm).
  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session" && changes[EXTENSION_SESSION_KEY] && changes[EXTENSION_SESSION_KEY].newValue === undefined) {
        if (statusRef.current === "unlocked") resetToLocked("locked");
        return;
      }
      if (area !== "local") return;
      if (changes[EXTENSION_AUTO_LOCK_KEY]) {
        const value = changes[EXTENSION_AUTO_LOCK_KEY].newValue;
        if (typeof value === "number") setAutoLockState(value);
      }
      if (changes[EXTENSION_ACCOUNTS_STORAGE_KEY]) {
        const next = changes[EXTENSION_ACCOUNTS_STORAGE_KEY].newValue as { activeId?: string } | undefined;
        if (!next) {
          if (statusRef.current !== "no-wallet") resetToLocked("no-wallet");
          setAccounts([]);
          return;
        }
        void refreshAccounts().then(async () => {
          const passcode = passcodeRef.current;
          if (mutatingAccountsRef.current || statusRef.current !== "unlocked" || !passcode) return;
          const current = profileRef.current;
          const active = await listExtensionAccounts().then((list) => list.find((a) => a.active));
          if (!active || !current) return;
          if (active.deploymentPublicKey.toLowerCase() === current.deploymentPublicKey.toLowerCase()) return;
          try {
            const profile = await unlockExtensionWalletProfile(passcode, active.id);
            await enterUnlocked(profile, passcode, false);
          } catch (e) {
            setError(messageOf(e));
          }
        });
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [enterUnlocked, refreshAccounts, resetToLocked]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      void touchUnlockedSession();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const requireSession = () => {
    const profile = profileRef.current;
    const passcode = passcodeRef.current;
    if (!profile || !passcode) throw new Error("Wallet is locked. Unlock to continue.");
    return { profile, passcode };
  };

  const reloadLive = useCallback(async () => {
    const { profile, passcode } = requireSession();
    await loadLiveState(profile, passcode);
  }, [loadLiveState]);

  const createWallet = useCallback(
    (passcode: string) =>
      run(async () => {
        const profile = await createExtensionWalletProfile(passcode);
        await enterUnlocked(profile, passcode, true);
      }),
    [run, enterUnlocked],
  );

  const unlock = useCallback(
    (passcode: string) =>
      run(async () => {
        const profile = await unlockExtensionWalletProfile(passcode);
        await enterUnlocked(profile, passcode, true);
      }),
    [run, enterUnlocked],
  );

  const restore = useCallback(
    (encoded: string, passcode: string) =>
      run(async () => {
        const profile = await restoreExtensionWalletProfile(encoded, passcode);
        await enterUnlocked(profile, passcode, true);
      }),
    [run, enterUnlocked],
  );

  const lock = useCallback(async () => {
    await clearUnlockedSession();
    resetToLocked("locked");
  }, [resetToLocked]);

  const refresh = useCallback(() => run(reloadLive), [run, reloadLive]);

  const faucet = useCallback(
    () =>
      run(async () => {
        const { profile, passcode } = requireSession();
        await requestExtensionFaucet(profile, passcode);
        await reloadLive();
      }),
    [run, reloadLive],
  );

  const send = useCallback(
    (args: { recipient: string; amount: string }) =>
      run(async () => {
        const { profile, passcode } = requireSession();
        await sendExtensionMrv(profile, passcode, args);
        await reloadLive();
      }),
    [run, reloadLive],
  );

  const sendToken = useCallback(
    (args: { token: TrackedToken; recipient: string; amount: string }) =>
      run(async () => {
        const { profile, passcode } = requireSession();
        await sendExtensionToken(profile, passcode, args);
        await reloadLive();
      }),
    [run, reloadLive],
  );

  const sendAsDevice = useCallback(
    (args: { accountAddress: string; recipient: string; amount: string }) =>
      run(async () => {
        const { profile } = requireSession();
        await sendExtensionDeviceCall(profile, { accountAddress: args.accountAddress as Hex, recipient: args.recipient, amount: args.amount });
        setActivity(await readExtensionActivity(profile.accountAddress));
      }),
    [run],
  );

  const rotate = useCallback(
    () =>
      run(async () => {
        const { profile, passcode } = requireSession();
        const { profile: nextProfile } = await rotateExtensionPQKey(profile, passcode);
        profileRef.current = nextProfile;
        await loadLiveState(nextProfile, passcode);
      }),
    [run, loadLiveState],
  );

  const exportKit = useCallback(async (accountId?: string) => {
    requireSession();
    return exportExtensionRecoveryKit(accountId);
  }, []);

  const wipe = useCallback(
    () =>
      run(async () => {
        await clearUnlockedSession();
        // Tell connected sites first, while the grants still exist to be read.
        await new Promise<void>((resolve) => {
          try {
            chrome.runtime.sendMessage({ kind: "minerva:disconnect-all" }, () => {
              void chrome.runtime.lastError;
              resolve();
            });
          } catch {
            resolve();
          }
        });
        await wipeExtensionWallet();
        setAccounts([]);
        resetToLocked("no-wallet");
      }),
    [run, resetToLocked],
  );

  // ---------------------------------------------------------------- accounts

  /** Runs an account mutation with the storage listener muted, then loads the resulting active profile. */
  const mutateAccounts = useCallback(
    (fn: (passcode: string) => Promise<{ profile: ExtensionPQWalletProfile; id: string } | undefined>) =>
      run(async () => {
        const { passcode } = requireSession();
        mutatingAccountsRef.current = true;
        try {
          const result = await fn(passcode);
          if (!result) return;
          activeIdRef.current = result.id;
          await enterUnlocked(result.profile, passcode, false);
        } finally {
          mutatingAccountsRef.current = false;
        }
      }),
    [run, enterUnlocked],
  );

  const switchAccount = useCallback(
    (id: string) =>
      mutateAccounts(async (passcode) => {
        if (id === activeIdRef.current) return undefined;
        const profile = await unlockExtensionWalletProfile(passcode, id);
        await setActiveExtensionAccount(id);
        return { profile, id };
      }),
    [mutateAccounts],
  );

  const addAccount = useCallback(
    (label?: string) =>
      mutateAccounts(async (passcode) => {
        const { profile, account } = await addExtensionAccount(passcode, label);
        return { profile, id: account.id };
      }),
    [mutateAccounts],
  );

  const importAccount = useCallback(
    (encoded: string, kitPasscode: string, label?: string) =>
      mutateAccounts(async (passcode) => {
        const { profile, account } = await importExtensionAccountFromKit(encoded, kitPasscode, passcode, label);
        return { profile, id: account.id };
      }),
    [mutateAccounts],
  );

  const renameAccount = useCallback(
    (id: string, label: string) =>
      run(async () => {
        await renameExtensionAccount(id, label);
        await refreshAccounts();
      }),
    [run, refreshAccounts],
  );

  const setAccountHidden = useCallback(
    (id: string, hidden: boolean) =>
      mutateAccounts(async (passcode) => {
        await setExtensionAccountHidden(id, hidden);
        const list = await refreshAccounts();
        const active = list.find((a) => a.active);
        if (!active || active.id === profileRefAccountId(profileRef.current, list)) return undefined;
        return { profile: await unlockExtensionWalletProfile(passcode, active.id), id: active.id };
      }),
    [mutateAccounts, refreshAccounts],
  );

  const moveAccount = useCallback(
    (id: string, direction: -1 | 1) =>
      run(async () => {
        await moveExtensionAccount(id, direction);
        await refreshAccounts();
      }),
    [run, refreshAccounts],
  );

  const removeAccount = useCallback(
    (id: string) =>
      mutateAccounts(async (passcode) => {
        const list = await removeExtensionAccount(id);
        setAccounts(list);
        const active = list.find((a) => a.active);
        activeIdRef.current = active?.id ?? null;
        if (!active || active.id === profileRefAccountId(profileRef.current, list)) return undefined;
        return { profile: await unlockExtensionWalletProfile(passcode, active.id), id: active.id };
      }),
    [mutateAccounts],
  );

  // ---------------------------------------------------------------- tokens

  const addToken = useCallback(
    (address: string) =>
      run(async () => {
        const { profile } = requireSession();
        await addCustomToken(profile.chainId, address);
        await reloadLive();
      }),
    [run, reloadLive],
  );

  const setTokenHidden = useCallback(
    (address: Hex, hidden: boolean) =>
      run(async () => {
        const { profile } = requireSession();
        await setTrackedTokenHidden(profile.chainId, address, hidden);
        setTokens((current) => current.map((t) => (t.address.toLowerCase() === address.toLowerCase() ? { ...t, hidden } : t)));
      }),
    [run],
  );

  const removeToken = useCallback(
    (address: Hex) =>
      run(async () => {
        const { profile } = requireSession();
        await removeTrackedToken(profile.chainId, address);
        setTokens((current) => current.filter((t) => t.address.toLowerCase() !== address.toLowerCase()));
      }),
    [run],
  );

  const discoverTokens = useCallback(async () => {
    let added = 0;
    await run(async () => {
      const { profile } = requireSession();
      const owner = profile.accountAddress ?? snapshot?.address;
      if (!owner) throw new Error("The account address is not known yet. Refresh and try again.");
      added = (await discoverTrackedTokens(profile.chainId, owner)).length;
      await reloadLive();
    });
    return added;
  }, [run, reloadLive, snapshot?.address]);

  // ---------------------------------------------------------------- auto-lock

  const setAutoLockMinutes = useCallback(
    async (minutes: number) => {
      try {
        await writeAutoLockMinutes(minutes);
        setAutoLockState(minutes);
      } catch (e) {
        setError(messageOf(e));
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    status,
    busy,
    error,
    snapshot,
    devicePublicKey: status === "unlocked" ? (profileRef.current?.currentKey.publicKey ?? null) : null,
    activity,
    accounts,
    activeAccount: accounts.find((a) => a.active) ?? null,
    tokens,
    autoLockMinutes,
    createWallet,
    unlock,
    restore,
    lock,
    refresh,
    faucet,
    send,
    sendToken,
    sendAsDevice,
    rotate,
    exportKit,
    wipe,
    clearError,
    switchAccount,
    addAccount,
    importAccount,
    renameAccount,
    setAccountHidden,
    moveAccount,
    removeAccount,
    addToken,
    setTokenHidden,
    removeToken,
    discoverTokens,
    setAutoLockMinutes,
  };
}

/** Id of the account whose profile is currently decrypted, matched by deployment key. */
function profileRefAccountId(profile: ExtensionPQWalletProfile | null, list: ExtensionAccountSummary[]): string | null {
  if (!profile) return null;
  return list.find((a) => a.deploymentPublicKey.toLowerCase() === profile.deploymentPublicKey.toLowerCase())?.id ?? null;
}
