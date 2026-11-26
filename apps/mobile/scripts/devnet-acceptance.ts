import type { Hex } from "@minerva/core";
import {
  MINERVA_DEVNET_CHAIN_ID,
  defaultMinervaFaucetUrl,
  defaultMinervaPQRelayerUrl,
  defaultMinervaRpcUrl,
} from "@minerva/evm";
import { runMinervaDevnetWalletAcceptance } from "../lib/mrvDevnetWalletFlow";

declare const process: {
  env: Record<string, string | undefined>;
  stderr: { write(message: string): void };
  exit(code?: number): never;
};

function env(name: string, fallback: string) {
  return process.env[name] ?? fallback;
}

async function main() {
  const chainId = Number(env("EXPO_PUBLIC_MINERVA_CHAIN_ID", String(MINERVA_DEVNET_CHAIN_ID)));
  const result = await runMinervaDevnetWalletAcceptance({
    chainId,
    rpcUrl: env("EXPO_PUBLIC_MINERVA_RPC_URL", defaultMinervaRpcUrl(chainId)),
    faucetUrl: env("EXPO_PUBLIC_MINERVA_FAUCET_URL", defaultMinervaFaucetUrl(chainId)),
    pqRelayerUrl: env("EXPO_PUBLIC_MINERVA_PQ_RELAYER_URL", defaultMinervaPQRelayerUrl(chainId)),
    target: env("MINERVA_MOBILE_ACCEPTANCE_TARGET", "0x000000000000000000000000000000000000dEaD") as Hex,
    valueWei: env("MINERVA_MOBILE_ACCEPTANCE_VALUE_WEI", "77777"),
  });

  console.log(`[minerva-mobile-acceptance] account ${result.accountAddress}`);
  console.log(`[minerva-mobile-acceptance] chain ${result.finalDisplay.chainName} (${result.finalDisplay.chainId})`);
  console.log(`[minerva-mobile-acceptance] balance ${result.finalDisplay.balanceLabel}`);
  console.log(
    `[minerva-mobile-acceptance] deployment ${result.finalDisplay.deploymentLabel} · ${result.finalDisplay.readinessLabel}`,
  );
  console.log(`[minerva-mobile-acceptance] faucet tx ${result.faucetReceipt.hash}`);
  console.log(
    `[minerva-mobile-acceptance] deploy tx ${result.deployReceipt.transactionHash ?? "already deployed"}`,
  );
  console.log(`[minerva-mobile-acceptance] pq transfer tx ${result.transfer.receipt.transactionHash}`);
  console.log(`[minerva-mobile-acceptance] nonce ${result.finalAccount.nonce}`);
  console.log(`[minerva-mobile-acceptance] target delta ${result.targetDeltaWei.toString()} wei`);
  console.log("[minerva-mobile-acceptance] ok");
}

main().catch((error) => {
  process.stderr.write(
    `[minerva-mobile-acceptance] ${error instanceof Error ? error.message : "mobile acceptance failed"}\n`,
  );
  process.exit(1);
});
