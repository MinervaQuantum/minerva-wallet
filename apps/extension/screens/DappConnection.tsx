import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Row } from "../components/Row";
import { WarningCard } from "../components/WarningCard";
import type { PendingRequestDetails } from "../tabs/request";
import { useEffect, useMemo, useState } from "react";

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "No wallet";
}

export function DappConnection({
  origin,
  appName,
  request,
  loading,
  error,
  onReject,
  onLimited,
  onConnect,
}: {
  origin?: string;
  appName?: string;
  request?: PendingRequestDetails | null;
  loading?: boolean;
  error?: string | null;
  verified?: boolean;
  onReject?: () => void;
  onLimited?: (passcode?: string, accountIds?: string[]) => void;
  onConnect?: (passcode?: string, accountIds?: string[]) => void;
}) {
  const [passcode, setPasscode] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const close = onReject ?? (() => window.close());
  const host = request?.hostname ?? origin ?? appName ?? "Unknown site";
  const account = request?.account;
  const accounts = useMemo(() => request?.accounts ?? [], [request?.accounts]);
  const isCreating = !account && !loading && Boolean(request);
  const multi = accounts.length > 1;

  useEffect(() => {
    if (accounts.length === 0) return;
    setSelected(accounts.filter((a) => a.active).map((a) => a.id));
  }, [accounts]);

  const canConnect = !loading && Boolean(request) && (isCreating ? passcode.length >= 8 : selected.length > 0 || !multi);
  const passcodeHelper = passcode.length >= 8
    ? "Ready to create your encrypted extension account."
    : `${Math.max(0, 8 - passcode.length)} more character${8 - passcode.length === 1 ? "" : "s"} needed.`;
  const accountValue = loading
    ? "Loading..."
    : account
      ? `${request?.accountLabel ? `${request.accountLabel} · ` : ""}${shortAddress(account)}`
      : "Will be created after approval";

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  const chosen = multi ? selected : undefined;

  const connect = () => {
    if (!canConnect) return;
    onConnect?.(isCreating ? passcode : undefined, chosen);
  };

  const connectLimited = () => {
    if (!canConnect) return;
    onLimited?.(isCreating ? passcode : undefined, chosen);
  };

  return (
    <div className="min-h-screen bg-background text-text font-sans">
      <div className="max-w-md mx-auto p-page py-8 space-y-5">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-page-title font-bold leading-pageTitle">Connect request</h1>
            <Badge
              label={request?.connected ? "Connected" : request?.siteConnected ? "New account" : "Review"}
              color={request?.connected ? "positive" : "neutral"}
            />
          </div>
          <p className="text-sm text-mv-mist">
            {request?.siteConnected && !request.connected
              ? "This site is connected to another account. Approve to let it see the account selected below."
              : "Allow this site to view your Minerva Account address on Minerva Testnet."}
          </p>
        </header>

        {error ? <WarningCard severity="warning" title="Request needs attention" detail={error} /> : null}
        {isCreating ? (
          <WarningCard
            severity="warning"
            title="No Minerva Account found"
            detail="Enter a new passcode to create this extension's standalone Minerva Account, or restore an existing Recovery Kit from the extension popup."
          />
        ) : null}

        <Card>
          <Row label="Site" value={host} />
          <Row label="Requested method" value={request?.method ?? "eth_requestAccounts"} />
          <Row label="Network" value={`Minerva ${request?.chainIdHex ?? ""}`.trim()} />
          <Row label="Account" value={accountValue} last />
        </Card>

        {multi ? (
          <Card>
            <div className="text-sm font-semibold text-mv-bone">Accounts to connect</div>
            <p className="mt-1 text-xs text-mv-mist">
              The site sees only the active account. Connecting another account makes it active.
            </p>
            <div className="mt-3 space-y-2">
              {accounts.map((a) => (
                <label
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-mv-line bg-mv-black px-3 py-2 cursor-pointer hover:border-mv-line-strong"
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      className="accent-current"
                      checked={selected.includes(a.id)}
                      onChange={() => toggle(a.id)}
                    />
                    <span>
                      <span className="block text-sm text-mv-bone">{a.label}</span>
                      <span className="block text-xs font-mono text-mv-mist">{shortAddress(a.address)}</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {a.active ? <Badge label="Active" color="positive" /> : null}
                    {a.connected ? <Badge label="Connected" color="neutral" /> : null}
                  </span>
                </label>
              ))}
            </div>
          </Card>
        ) : null}

        <Card>
          <div className="text-sm font-semibold text-mv-bone">Permissions</div>
          <div className="mt-3 space-y-2 text-xs text-mv-mist">
            <div>View your Minerva Account address.</div>
            <div>Ask for transaction approval later. Every transaction still requires approval.</div>
          </div>
        </Card>

        {isCreating ? (
          <Card>
            <label className="text-xs font-mono uppercase tracking-[0.22em] text-mv-mist" htmlFor="minerva-create-passcode">
              New wallet passcode
            </label>
            <input
              id="minerva-create-passcode"
              type="password"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") connect();
              }}
              className="mt-3 h-12 w-full rounded-md border border-mv-line bg-mv-black px-4 text-mv-bone outline-none focus:border-mv-bone"
              placeholder="At least 8 characters"
              minLength={8}
              autoFocus
            />
            <div className="mt-3 flex items-center justify-between gap-3 text-xs">
              <span className={passcode.length >= 8 ? "text-mv-bone" : "text-warn"}>{passcodeHelper}</span>
              <span className="font-mono text-mv-mist">{Math.min(passcode.length, 8)}/8</span>
            </div>
            <p className="mt-2 text-xs text-mv-mist">
              The ML-DSA key is encrypted locally in this browser extension. Plaintext keys are not stored.
            </p>
          </Card>
        ) : null}

        <div className="space-y-3 pt-2">
          <Button size="block" onClick={connect} disabled={!canConnect}>
            {isCreating && !canConnect ? "Enter passcode to create" : isCreating ? "Create and connect" : "Connect"}
          </Button>
          <Button
            variant="secondary"
            size="block"
            onClick={connectLimited}
            disabled={!canConnect}
          >
            {isCreating ? "Create view-only" : "Connect view-only"}
          </Button>
          <Button variant="tertiary" size="block" onClick={close}>
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}
