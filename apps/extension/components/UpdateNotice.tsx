import { useEffect, useState } from "react";
import { checkForUpdate, type UpdateCheck } from "@minerva/core";

function installedVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "0.0.0";
  }
}

/** Shows a one-line notice when the signed release manifest lists a newer extension. */
export function UpdateNotice() {
  const [result, setResult] = useState<UpdateCheck | null>(null);

  useEffect(() => {
    let cancelled = false;
    checkForUpdate(installedVersion())
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!result?.updateAvailable) return null;
  return (
    <a
      href={result.manifest.baseUrl}
      target="_blank"
      rel="noreferrer noopener"
      className="block rounded-md border border-mv-line bg-mv-panel px-3 py-2 text-xs text-mv-bone hover:border-mv-bone"
    >
      Minerva Wallet {result.latest} is available (installed {result.current}). Downloads are signed with ML-DSA-65.
    </a>
  );
}
