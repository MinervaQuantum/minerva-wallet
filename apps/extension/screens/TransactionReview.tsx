import { useMemo, useState } from "react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Row } from "../components/Row";
import { WarningCard } from "../components/WarningCard";
import type { PendingRequestDetails } from "../tabs/request";
import { buildTransactionReview } from "@minerva/evm";

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "-";
}

function formatMrv(valueWei?: string) {
  if (!valueWei) return "0 MRV";
  try {
    const wei = BigInt(valueWei);
    const whole = wei / 10n ** 18n;
    const fraction = wei % 10n ** 18n;
    if (fraction === 0n) return `${whole.toString()} MRV`;
    const fractionText = fraction.toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
    return `${whole.toString()}.${fractionText || "0"} MRV`;
  } catch {
    return `${valueWei} wei`;
  }
}

function dataLabel(data?: string) {
  if (!data || data === "0x") return "None";
  return `${data.slice(0, 10)}...${data.slice(-8)}`;
}

export function TransactionReview({
  origin,
  request,
  loading,
  error,
  onReject,
  onApprove,
}: {
  origin?: string;
  request?: PendingRequestDetails | null;
  loading?: boolean;
  error?: string | null;
  onReject?: () => void;
  onApprove?: (passcode: string) => void;
}) {
  const [passcode, setPasscode] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const tx = request?.transaction;
  const hasCalldata = Boolean(tx?.data && tx.data !== "0x");
  const sessionUnlocked = Boolean(request?.sessionUnlocked);

  const review = useMemo(
    () =>
      buildTransactionReview({
        target: tx?.to as `0x${string}` | undefined,
        valueWei: (() => {
          try {
            return BigInt(tx?.valueWei ?? "0");
          } catch {
            return 0n;
          }
        })(),
        data: tx?.data as `0x${string}` | undefined,
        nativeSymbol: "MRV",
        requestingApp: { name: request?.hostname ?? origin ?? "Unknown site", verified: Boolean(request?.connected) },
        knownAddresses: request?.account ? [request.account as `0x${string}`] : [],
      }),
    [origin, request, tx],
  );
  const criticalWarnings = review.warnings.filter((w) => w.severity === "critical");
  const canApprove = Boolean(
    tx &&
      request?.account &&
      request.connected &&
      (sessionUnlocked || passcode.length >= 8) &&
      !request.parseError &&
      (criticalWarnings.length === 0 || acknowledged),
  );
  const balanceChange =
    review.balanceChanges.length === 0
      ? "None"
      : review.balanceChanges.map((c) => `${c.deltaWei < 0n ? "-" : "+"}${formatMrv((c.deltaWei < 0n ? -c.deltaWei : c.deltaWei).toString())}`).join(", ");

  const warning = useMemo(() => {
    if (request?.parseError) return request.parseError;
    if (!request?.account) return "Create or restore a Minerva Wallet profile before approving transactions.";
    if (!request?.connected) {
      return request.siteConnected
        ? "This site is not connected to the active account. Switch accounts or connect this one first."
        : "Connect this site before approving transactions.";
    }
    if (tx?.from && tx.from.toLowerCase() !== request.account.toLowerCase()) {
      return "The requested from address does not match your active Minerva Account.";
    }
    if (hasCalldata) return "This request includes contract calldata. Only approve if you trust this site and understand the action.";
    return null;
  }, [hasCalldata, request, tx]);

  return (
    <div className="min-h-screen bg-background text-text font-sans">
      <div className="max-w-md mx-auto p-page py-8 space-y-5">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-page-title font-bold leading-pageTitle">Review transaction</h1>
            <Badge label="PQ Native" color="positive" />
          </div>
          <p className="text-sm text-mv-mist">
            Minerva Wallet will sign this as a MinervaPQTxV1 smart-account execution, not as an EOA transaction.
          </p>
        </header>

        {loading ? <WarningCard severity="info" title="Loading request" detail="Reading the dapp transaction payload." /> : null}
        {warning ? <WarningCard severity="warning" title="Review carefully" detail={warning} /> : null}
        {error ? <WarningCard severity="critical" title="Could not sign" detail={error} /> : null}

        <Card>
          <Row label="Site" value={request?.hostname ?? origin ?? "Unknown"} />
          <Row label="Method" value={request?.method ?? "eth_sendTransaction"} />
          <Row
            label="From"
            value={`${request?.accountLabel ? `${request.accountLabel} · ` : ""}${shortAddress(tx?.from ?? request?.account)}`}
          />
          <Row label="To" value={shortAddress(tx?.to)} />
          <Row label="Amount" value={formatMrv(tx?.valueWei)} />
          <Row label="Calldata" value={dataLabel(tx?.data)} />
          <Row label="Contract call" value={review.call ? `${review.call.name}: ${review.call.summary}` : "None"} />
          <Row label="Balance change" value={balanceChange} />
          <Row label="Approval" value={review.approval ? (review.approval.unlimited ? `Unlimited for ${shortAddress(review.approval.spender)}` : `${review.approval.amountWei.toString()} for ${shortAddress(review.approval.spender)}`) : "None"} />
          <Row label="Requesting app" value={review.requestingApp} />
          <Row label="Simulation" value={review.simulation.label} />
          <Row label="Network" value={`Minerva ${request?.chainIdHex ?? ""}`.trim()} last />
        </Card>
        <p className="text-xs text-mv-mist">{review.disclaimer}</p>
        {review.warnings.map((w) => (
          <WarningCard
            key={w.id}
            severity={w.severity === "critical" ? "critical" : w.severity === "warning" ? "warning" : "info"}
            title={w.title}
            detail={w.detail}
          />
        ))}
        {criticalWarnings.length > 0 ? (
          <label className="flex items-start gap-3 rounded-lg border border-mv-line bg-mv-panel px-4 py-3 text-sm text-mv-bone">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-mv-bone"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>I understand the warning above and want to send this transaction anyway.</span>
          </label>
        ) : null}

        {hasCalldata ? (
          <Card>
            <div className="text-xs font-mono text-mv-mist break-all">{tx?.data}</div>
          </Card>
        ) : null}

        {sessionUnlocked ? (
          <WarningCard
            severity="info"
            title="Wallet is unlocked"
            detail="The unlocked session signs this request. Lock the wallet from the popup to require the passcode again."
          />
        ) : (
          <Card>
            <label className="text-xs font-mono uppercase tracking-[0.22em] text-mv-mist" htmlFor="minerva-passcode">
              Wallet passcode
            </label>
            <input
              id="minerva-passcode"
              type="password"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              className="mt-3 h-12 w-full rounded-md border border-mv-line bg-mv-black px-4 text-mv-bone outline-none focus:border-mv-bone"
              placeholder="Enter passcode"
              autoFocus
            />
          </Card>
        )}

        <div className="space-y-3 pt-2">
          <Button size="block" onClick={() => onApprove?.(passcode)} disabled={!canApprove}>
            Sign and send
          </Button>
          <Button variant="secondary" size="block" onClick={onReject}>
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}
