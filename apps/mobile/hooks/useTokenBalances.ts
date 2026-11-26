import { useCallback, useEffect, useState } from "react";
import type { Hex } from "@minerva/core";
import { discoverTokens, listTrackedTokens, readTrackedTokenBalances, type TrackedTokenBalance } from "@/lib/tokens";
import { onWalletChange } from "@/lib/walletEvents";

export interface TokenBalancesState {
  status: "idle" | "loading" | "ready" | "error";
  tokens: TrackedTokenBalance[];
  /** Tokens the user has not hidden. */
  visible: TrackedTokenBalance[];
  error?: string;
  refresh: () => void;
}

/** ERC-20 balances for one account on one chain: tracked tokens plus indexer discoveries. */
export function useTokenBalances(args: { chainId: number; rpcUrl?: string; indexerUrl?: string; address?: Hex; enabled?: boolean }): TokenBalancesState {
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<TokenBalancesState["status"]>("idle");
  const [tokens, setTokens] = useState<TrackedTokenBalance[]>([]);
  const [error, setError] = useState<string | undefined>();
  const enabled = args.enabled ?? true;

  useEffect(() => onWalletChange(() => setReloadKey((key) => key + 1)), []);

  useEffect(() => {
    if (!enabled || !args.address) {
      setTokens([]);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    const config = { chainId: args.chainId, rpcUrl: args.rpcUrl };
    const owner = args.address;
    (async () => {
      const tracked = await discoverTokens(args.chainId, owner, args.indexerUrl, config).catch(() => listTrackedTokens(args.chainId));
      const balances = await readTrackedTokenBalances(tracked, owner, config);
      if (cancelled) return;
      setTokens(balances);
      setError(undefined);
      setStatus("ready");
    })().catch((e: unknown) => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : "Token balances unavailable");
      setStatus("error");
    });
    return () => {
      cancelled = true;
    };
  }, [args.address, args.chainId, args.indexerUrl, args.rpcUrl, enabled, reloadKey]);

  const refresh = useCallback(() => setReloadKey((key) => key + 1), []);

  return { status, tokens, visible: tokens.filter((t) => !t.hidden), error, refresh };
}
