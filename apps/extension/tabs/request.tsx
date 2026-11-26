import "../style.css";
import { useEffect, useState } from "react";
import { DappConnection } from "../screens/DappConnection";
import { TransactionReview } from "../screens/TransactionReview";
import { MessageSigning } from "../screens/MessageSigning";

type RequestType = "connect" | "tx" | "sign";
type Decision = "approve" | "limited" | "reject";

interface RequestContext {
  type: RequestType;
  requestId?: string;
  origin?: string;
  method?: string;
}

export interface PendingRequestAccount {
  id: string;
  label: string;
  address?: string;
  active: boolean;
  /** Already connected to this origin. */
  connected: boolean;
}

export interface PendingRequestDetails {
  requestId: string;
  type: RequestType;
  method: string;
  origin: string;
  hostname: string;
  chainId: number;
  chainIdHex: string;
  account?: string;
  accountLabel?: string;
  /** The site holds a grant for the active account. */
  connected: boolean;
  /** The site holds a grant for at least one account. */
  siteConnected?: boolean;
  permissions: string[];
  params?: unknown[];
  transaction?: {
    from?: string;
    to: string;
    valueWei: string;
    data: string;
  };
  parseError?: string;
  accounts?: PendingRequestAccount[];
  /** An unlocked session exists; the background signs with it and no passcode prompt is needed. */
  sessionUnlocked?: boolean;
}

function hostnameFromOrigin(origin?: string): string | undefined {
  if (!origin) return undefined;
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

/** Plasmo "tab" entry. Loaded at chrome-extension://<id>/tabs/request.html?type=connect|tx|sign.
 *  The provider only opens approval UI for account connection until MinervaPQTxV1
 *  replaces classical transaction and message signing for Minerva dapp flows. */
export default function Request() {
  const [context, setContext] = useState<RequestContext>({ type: "connect" });
  const [details, setDetails] = useState<PendingRequestDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get("type") as RequestType | null;
    setContext({
      type: t === "connect" || t === "tx" || t === "sign" ? t : "connect",
      requestId: params.get("requestId") ?? undefined,
      origin: params.get("origin") ?? undefined,
      method: params.get("method") ?? undefined,
    });
  }, []);

  useEffect(() => {
    if (!context.requestId) return;
    setLoadingDetails(true);
    chrome.runtime.sendMessage(
      {
        kind: "minerva:get-pending-request",
        requestId: context.requestId,
      },
      (response: { ok?: boolean; request?: PendingRequestDetails; error?: string }) => {
        setLoadingDetails(false);
        if (response?.request) {
          setDetails(response.request);
          setError(null);
          return;
        }
        setError(response?.error ?? "Minerva request expired.");
      },
    );
  }, [context.requestId]);

  const resolve = (decision: Decision, passcode?: string, accountIds?: string[]) => {
    if (!context.requestId) {
      window.close();
      return;
    }
    setError(null);

    chrome.runtime.sendMessage(
      {
        kind: "minerva:resolve-request",
        requestId: context.requestId,
        decision,
        passcode: passcode || undefined,
        accountIds,
      },
      (response: { ok?: boolean; error?: string }) => {
        if (response?.ok) {
          window.close();
          return;
        }
        setError(response?.error ?? "Could not complete the Minerva request.");
      },
    );
  };

  const originHost = hostnameFromOrigin(context.origin);

  if (context.type === "tx") {
    return (
      <TransactionReview
        origin={originHost}
        request={details}
        loading={loadingDetails}
        error={error}
        onReject={() => resolve("reject")}
        onApprove={(passcode) => resolve("approve", passcode)}
      />
    );
  }
  if (context.type === "sign") {
    return (
      <MessageSigning
        origin={originHost}
        request={details}
        loading={loadingDetails}
        error={error}
        onReject={() => resolve("reject")}
        onApprove={(passcode) => resolve("approve", passcode)}
      />
    );
  }
  return (
    <DappConnection
      origin={originHost}
      request={details}
      loading={loadingDetails}
      error={error}
      appName={originHost}
      onReject={() => resolve("reject")}
      onLimited={(passcode, accountIds) => resolve("limited", passcode, accountIds)}
      onConnect={(passcode, accountIds) => resolve("approve", passcode, accountIds)}
    />
  );
}
