import { useState } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Row } from "../components/Row";
import { WarningCard } from "../components/WarningCard";
import { useExtensionWallet } from "../lib/useExtensionWallet";

/** Device key: show this extension's ML-DSA public key for the phone to enrol, and spend from
 *  the phone's account within the scope the phone granted. The node and the account enforce the
 *  scope; the extension only signs the native envelope with its own key. */
export function DeviceKey() {
  const w = useExtensionWallet();
  const [accountAddress, setAccountAddress] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [copied, setCopied] = useState(false);
  const key = w.devicePublicKey;

  const copy = async () => {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-5 max-w-xl">
      <header className="space-y-2">
        <h1 className="text-page-title font-bold leading-pageTitle">Device key</h1>
        <p className="text-sm text-mv-mist">
          Enrol this extension on your phone: open Security, Device keys, and paste the public key below with the
          spend limit, window and allowed target you want. Revoke it from the phone at any time; a revoked key is
          refused by the network itself.
        </p>
      </header>

      {w.status !== "unlocked" ? (
        <WarningCard severity="info" title="Unlock first" detail="Unlock the extension wallet to show its device public key." />
      ) : (
        <Card>
          <Row label="Algorithm" value="ML-DSA-65" />
          <Row label="Public key" value={key ? `${key.slice(0, 18)}... (${(key.length - 2) / 2} bytes)` : "-"} />
          <Row label="Commitment" value={w.snapshot?.publicKeyCommitment ? `${w.snapshot.publicKeyCommitment.slice(0, 18)}...` : "-"} last />
          <div className="mt-3 flex gap-3">
            <Button size="block" variant="secondary" onClick={copy} disabled={!key}>
              {copied ? "Copied" : "Copy public key"}
            </Button>
          </div>
          {key ? <div className="mt-3 text-xs font-mono text-mv-mist break-all max-h-32 overflow-auto">{key}</div> : null}
        </Card>
      )}

      <Card>
        <div className="text-sm font-medium">Spend as a device key</div>
        <p className="mt-1 text-xs text-mv-mist">
          Sends MRV from the phone's Minerva Account through its scope. Over-limit, off-target or revoked
          requests revert or are refused before submission.
        </p>
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-xs font-mono uppercase tracking-[0.22em] text-mv-mist">Phone account address</span>
            <input className="mt-2 h-12 w-full rounded-md border border-mv-line bg-mv-black px-4 text-mv-bone outline-none focus:border-mv-bone" value={accountAddress} onChange={(e) => setAccountAddress(e.target.value)} placeholder="0x..." />
          </label>
          <label className="block">
            <span className="text-xs font-mono uppercase tracking-[0.22em] text-mv-mist">Recipient</span>
            <input className="mt-2 h-12 w-full rounded-md border border-mv-line bg-mv-black px-4 text-mv-bone outline-none focus:border-mv-bone" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x..." />
          </label>
          <label className="block">
            <span className="text-xs font-mono uppercase tracking-[0.22em] text-mv-mist">Amount (MRV)</span>
            <input className="mt-2 h-12 w-full rounded-md border border-mv-line bg-mv-black px-4 text-mv-bone outline-none focus:border-mv-bone" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        </div>
        <div className="mt-4">
          <Button
            size="block"
            disabled={w.status !== "unlocked" || w.busy || !accountAddress || !recipient || !amount}
            onClick={() => void w.sendAsDevice({ accountAddress, recipient, amount })}
          >
            {w.busy ? "Signing..." : "Send within scope"}
          </Button>
        </div>
        {w.error ? <div className="mt-3"><WarningCard severity="critical" title="Device-key spend" detail={w.error} /></div> : null}
      </Card>
    </div>
  );
}
