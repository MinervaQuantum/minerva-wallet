import { useEffect, useState } from "react";
import { checkForUpdate, type UpdateCheck } from "@minerva/core";
import { readPublicEnv } from "@/lib/runtimeConfig";

export const APP_VERSION = readPublicEnv("EXPO_PUBLIC_MINERVA_WALLET_VERSION") ?? "0.0.0";

export type UpdateState =
  | { status: "checking" }
  | { status: "ok"; result: UpdateCheck; checkedAt: Date }
  | { status: "error"; message: string; checkedAt: Date };

/** Reads the signed release manifest once per mount; never downloads or installs anything. */
export function useUpdateCheck(enabled = true): UpdateState {
  const [state, setState] = useState<UpdateState>({ status: "checking" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    checkForUpdate(APP_VERSION)
      .then((result) => {
        if (!cancelled) setState({ status: "ok", result, checkedAt: new Date() });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setState({ status: "error", message: error instanceof Error ? error.message : "check failed", checkedAt: new Date() });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}
