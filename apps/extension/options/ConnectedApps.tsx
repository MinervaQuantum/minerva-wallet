import { useCallback, useEffect, useState } from "react";
import { summarizePermissions, type Permission } from "@minerva/wallet-policy";
import { Card } from "../components/Card";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { listExtensionAccounts, type ExtensionAccountSummary } from "../lib/extensionWalletVault";

interface StoredConnection {
  origin: string;
  hostname: string;
  connectedAt: number;
  lastUsedAt?: number;
  permissions: string[];
  compatibilityMode: boolean;
  accountIds?: string[];
}

function permissionFromStorage(permission: string): Permission | null {
  if (
    permission === "view-account" ||
    permission === "request-signatures" ||
    permission === "send-transactions" ||
    permission === "request-token-allowance" ||
    permission === "switch-chain"
  ) {
    return permission;
  }
  return null;
}

function permissionSummary(connection: StoredConnection): string {
  return summarizePermissions(
    connection.permissions
      .map(permissionFromStorage)
      .filter((permission): permission is Permission => Boolean(permission))
      .map((permission) => ({ permission })),
  );
}

function shorten(address?: string): string {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";
}

function relativeTime(at?: number): string {
  if (!at) return "never";
  const delta = Date.now() - at;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(at).toLocaleDateString();
}

/** Per-site permissions: which accounts each origin may see, when it last asked, and revocation
 *  per origin or per account. Revocations reach open tabs as accountsChanged / disconnect. */
export function ConnectedApps() {
  const [connections, setConnections] = useState<StoredConnection[]>([]);
  const [accounts, setAccounts] = useState<ExtensionAccountSummary[]>([]);
  const [busyOrigin, setBusyOrigin] = useState<string | null>(null);

  const load = useCallback(() => {
    chrome.runtime.sendMessage({ kind: "minerva:get-connections" }, (response) => {
      if (!response?.ok) return;
      const list = Object.values((response.connections ?? {}) as Record<string, StoredConnection>);
      setConnections(list.sort((a, b) => (b.lastUsedAt ?? b.connectedAt) - (a.lastUsedAt ?? a.connectedAt)));
    });
    void listExtensionAccounts().then(setAccounts).catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    load();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      if (changes["minerva:connections"] || changes["minerva.extension.accounts.v1"]) load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [load]);

  const send = (message: Record<string, unknown>, origin: string) => {
    setBusyOrigin(origin);
    chrome.runtime.sendMessage(message, () => {
      setBusyOrigin(null);
      load();
    });
  };

  const revokeOrigin = (origin: string) => send({ kind: "minerva:disconnect-origin", origin }, origin);
  const revokeAccount = (origin: string, accountId: string) =>
    send({ kind: "minerva:revoke-account", origin, accountId }, origin);

  const accountById = (id: string) => accounts.find((a) => a.id === id);

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-2xl font-bold">Connected apps</h2>
        <p className="text-sm text-text-muted mt-1">
          Every site that may see one of your accounts. A site only ever sees the active account, and only when that
          account is connected to it.
        </p>
      </header>

      <div className="space-y-3">
        {connections.length === 0 ? (
          <Card>
            <p className="text-sm text-text-muted">No dapps are connected yet.</p>
          </Card>
        ) : null}
        {connections.map((c) => {
          const ids = c.accountIds ?? [];
          const busy = busyOrigin === c.origin;
          return (
            <Card key={c.origin}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{c.hostname}</div>
                  <div className="text-xs text-text-muted truncate">{c.origin}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.compatibilityMode ? <Badge label="View only" color="neutral" /> : null}
                  <Badge label={`${ids.length} account${ids.length === 1 ? "" : "s"}`} color="neutral" />
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-text-muted">
                <div>
                  <div className="font-mono uppercase tracking-[0.18em] text-[10px]">Permissions</div>
                  <div className="mt-1 text-mv-bone">{permissionSummary(c)}</div>
                </div>
                <div>
                  <div className="font-mono uppercase tracking-[0.18em] text-[10px]">Last used</div>
                  <div className="mt-1 text-mv-bone" title={new Date(c.lastUsedAt ?? c.connectedAt).toLocaleString()}>
                    {relativeTime(c.lastUsedAt ?? c.connectedAt)}
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted">Connected accounts</div>
                {ids.length === 0 ? (
                  <div className="text-xs text-text-muted">No account is connected to this site any more.</div>
                ) : null}
                {ids.map((id) => {
                  const account = accountById(id);
                  return (
                    <div
                      key={id}
                      className="flex items-center justify-between gap-3 rounded-md border border-mv-line bg-mv-black px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-mv-bone truncate">
                          {account?.label ?? "Removed account"}
                          {account?.active ? <span className="ml-2 text-xs text-mv-mist">active</span> : null}
                          {account?.hidden ? <span className="ml-2 text-xs text-mv-mist">hidden</span> : null}
                        </div>
                        <div className="text-xs font-mono text-mv-mist">{shorten(account?.address)}</div>
                      </div>
                      <button
                        className="text-xs text-crit hover:underline disabled:opacity-40"
                        disabled={busy}
                        onClick={() => revokeAccount(c.origin, id)}
                      >
                        Revoke
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex gap-3">
                <Button variant="danger" disabled={busy} onClick={() => revokeOrigin(c.origin)}>
                  {busy ? "Revoking…" : "Revoke site"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
