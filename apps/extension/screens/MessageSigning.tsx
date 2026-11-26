import { useState } from "react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Row } from "../components/Row";
import { WarningCard } from "../components/WarningCard";
import type { PendingRequestDetails } from "../tabs/request";

function payloadPreview(params?: unknown[]) {
  if (!params?.length) return "No payload";
  const encoded = JSON.stringify(params.length === 1 ? params[0] : params);
  return encoded.length > 180 ? `${encoded.slice(0, 180)}...` : encoded;
}

function isMinervaMethod(method?: string) {
  return method === "minerva_signMessage" || method === "minerva_signTypedData";
}

export function MessageSigning({
  origin,
  request,
  loading,
  error,
  onReject,
  onApprove,
}: {
  type?: string;
  origin?: string;
  appName?: string;
  request?: PendingRequestDetails | null;
  loading?: boolean;
  error?: string | null;
  onReject?: () => void;
  onApprove?: (passcode: string) => void;
}) {
  const [passcode, setPasscode] = useState("");
  const pqNative = isMinervaMethod(request?.method);
  const sessionUnlocked = Boolean(request?.sessionUnlocked);

  return (
    <div className="min-h-screen bg-background text-text font-sans">
      <div className="max-w-md mx-auto p-page py-8 space-y-5">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-page-title font-bold leading-pageTitle">Sign request</h1>
            <Badge label={pqNative ? "PQ Native" : "Blocked"} color={pqNative ? "positive" : "warning"} />
          </div>
          <p className="text-sm text-mv-mist">
            {pqNative
              ? "Minerva Wallet will return an ML-DSA proof for this Minerva-native signing request."
              : "Minerva Wallet does not return fake ECDSA signatures. Use minerva_signMessage or minerva_signTypedData."}
          </p>
        </header>

        {loading ? <WarningCard severity="info" title="Loading request" detail="Reading the dapp signing payload." /> : null}
        {!pqNative ? (
          <WarningCard
            severity="warning"
            title="EOA signature not supported"
            detail="This compatibility method expects a classical EOA signature. Minerva Wallet signs only PQ-native Minerva messages."
          />
        ) : (
          <WarningCard
            severity="info"
            title="PQ message proof"
            detail="The response includes address, chain ID, algorithm, public key commitment, key version, message hash, and ML-DSA signature."
          />
        )}
        {error ? <WarningCard severity="critical" title="Request failed" detail={error} /> : null}

        <Card>
          <Row label="Site" value={request?.hostname ?? origin ?? "Unknown"} />
          <Row label="Method" value={request?.method ?? "personal_sign"} />
          <Row
            label="Account"
            value={
              request?.account
                ? `${request.accountLabel ? `${request.accountLabel} · ` : ""}${request.account.slice(0, 6)}...${request.account.slice(-4)}`
                : "-"
            }
          />
          <Row label="Network" value={`Minerva ${request?.chainIdHex ?? ""}`.trim()} last />
        </Card>

        <Card>
          <div className="text-xs font-mono text-mv-mist break-all">{payloadPreview(request?.params)}</div>
        </Card>

        {sessionUnlocked && pqNative ? (
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
              placeholder={pqNative ? "Enter passcode" : "Not available for EOA methods"}
              disabled={!pqNative}
            />
          </Card>
        )}

        <div className="space-y-3 pt-2">
          <Button
            size="block"
            onClick={() => onApprove?.(passcode)}
            disabled={!pqNative || !request?.connected || (!sessionUnlocked && passcode.length < 8)}
          >
            Sign PQ message
          </Button>
          <Button variant="secondary" size="block" onClick={onReject}>
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}
