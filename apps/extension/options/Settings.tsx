import { useEffect, useState } from "react";
import { Card } from "../components/Card";
import { Row } from "../components/Row";
import { WarningCard } from "../components/WarningCard";
import {
  AUTO_LOCK_OPTIONS,
  EXTENSION_AUTO_LOCK_KEY,
  readAutoLockMinutes,
  readUnlockedSession,
  writeAutoLockMinutes,
} from "../lib/extensionSession";

function describe(minutes: number): string {
  return AUTO_LOCK_OPTIONS.find((o) => o.minutes === minutes)?.label ?? `${minutes} minutes`;
}

/** Wallet settings. The auto-lock window applies to the unlocked session that the popup keeps in
 *  chrome.storage.session; changing it re-arms the running session immediately. */
export function Settings() {
  const [minutes, setMinutes] = useState<number | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void readAutoLockMinutes().then(setMinutes);
    void readUnlockedSession().then((s) => setSessionOpen(Boolean(s)));
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && typeof changes[EXTENSION_AUTO_LOCK_KEY]?.newValue === "number") {
        setMinutes(changes[EXTENSION_AUTO_LOCK_KEY].newValue as number);
      }
      if (area === "session") void readUnlockedSession().then((s) => setSessionOpen(Boolean(s)));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const update = async (next: number) => {
    setError(null);
    try {
      await writeAutoLockMinutes(next);
      setMinutes(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the setting.");
    }
  };

  return (
    <div className="space-y-4 max-w-xl">
      <header>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-sm text-text-muted mt-1">Session and security preferences for this browser.</p>
      </header>

      {error ? <WarningCard severity="warning" title="Could not save" detail={error} /> : null}

      <Card>
        <div className="text-sm font-semibold text-mv-bone">Auto-lock</div>
        <p className="mt-1 text-xs text-mv-mist">
          How long the wallet stays unlocked after you last used it. While unlocked, reopening the popup and approving
          dapp requests do not ask for the passcode. The passcode is kept only in memory-backed session storage and is
          cleared when the window ends or the browser closes.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {AUTO_LOCK_OPTIONS.map((option) => {
            const active = minutes === option.minutes;
            return (
              <button
                key={option.minutes}
                onClick={() => void update(option.minutes)}
                className={`h-10 rounded-md border px-3 text-sm transition-colors ${
                  active
                    ? "border-mv-bone bg-mv-bone text-mv-black"
                    : "border-mv-line bg-mv-black text-mv-bone hover:border-mv-line-strong"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {minutes === 0 ? (
          <div className="mt-3">
            <WarningCard
              severity="warning"
              title="Never auto-lock"
              detail="The wallet stays unlocked until you press Lock or close the browser. Anyone with access to this browser can sign."
            />
          </div>
        ) : null}
      </Card>

      <Card>
        <Row label="Current window" value={minutes === null ? "…" : describe(minutes)} />
        <Row label="Session" value={sessionOpen ? "Unlocked" : "Locked"} last />
      </Card>
    </div>
  );
}
