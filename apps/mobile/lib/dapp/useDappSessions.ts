/**
 * React hooks over the dapp stores: browser sessions, bookmarks and WalletConnect sessions.
 */
import { useCallback, useEffect, useState } from "react";
import { listBookmarks, onBookmarksChange, type Bookmark } from "./bookmarks";
import { listDappSessions, onDappSessionsChange, type DappSession } from "./sessions";
import {
  initWalletConnect,
  isWalletConnectConfigured,
  listWalletConnectSessions,
  onWalletConnectChange,
  walletConnectStatus,
  type WalletConnectSessionSummary,
  type WalletConnectStatus,
} from "./walletconnect";

export function useDappSessions(): { sessions: DappSession[]; reload: () => void } {
  const [sessions, setSessions] = useState<DappSession[]>([]);
  const reload = useCallback(() => {
    listDappSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);
  useEffect(() => {
    reload();
    return onDappSessionsChange(reload);
  }, [reload]);
  return { sessions, reload };
}

export function useBookmarks(): { bookmarks: Bookmark[]; reload: () => void } {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const reload = useCallback(() => {
    listBookmarks()
      .then(setBookmarks)
      .catch(() => setBookmarks([]));
  }, []);
  useEffect(() => {
    reload();
    return onBookmarksChange(reload);
  }, [reload]);
  return { bookmarks, reload };
}

export interface WalletConnectState {
  configured: boolean;
  status: WalletConnectStatus;
  error?: string;
  sessions: WalletConnectSessionSummary[];
  refresh: () => void;
}

/**
 * Starts WalletKit (when configured) so existing sessions keep receiving requests while the Apps
 * tab is mounted, and mirrors its session list into React state.
 */
export function useWalletConnect(autoStart = true): WalletConnectState {
  const configured = isWalletConnectConfigured();
  const [snapshot, setSnapshot] = useState(() => ({ ...walletConnectStatus(), sessions: listWalletConnectSessions() }));

  const refresh = useCallback(() => {
    setSnapshot({ ...walletConnectStatus(), sessions: listWalletConnectSessions() });
  }, []);

  useEffect(() => {
    const unsubscribe = onWalletConnectChange(refresh);
    if (configured && autoStart) {
      void initWalletConnect().finally(refresh);
    } else {
      refresh();
    }
    return unsubscribe;
  }, [autoStart, configured, refresh]);

  return { configured, status: snapshot.status, error: snapshot.error, sessions: snapshot.sessions, refresh };
}
