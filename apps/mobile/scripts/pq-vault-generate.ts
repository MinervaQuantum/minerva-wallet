import type { Hex } from "@minerva/core";
import {
  deployMinervaDevPQAccount,
  defaultMinervaFaucetUrl,
  defaultMinervaPQRelayerUrl,
  MINERVA_TESTNET_CHAIN_ID,
  readMinervaDevPQAccount,
} from "@minerva/evm";
import {
  createEphemeralMinervaDevnetWalletProfile,
  minervaDevnetPQDeploymentRequest,
} from "../lib/mrvDevnetWalletFlow";

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  stderr: { write(message: string): void };
  exit(code?: number): never;
};

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function shouldDeploy(): boolean {
  return hasArg("--deploy") || process.env.MINERVA_WALLET_DEPLOY_PQ_VAULT === "1";
}

async function main() {
  const expectedChainId = Number(
    argValue("--chain-id") ?? env("EXPO_PUBLIC_MINERVA_CHAIN_ID", String(MINERVA_TESTNET_CHAIN_ID)),
  );
  const pqRelayerUrl =
    argValue("--pq-relayer-url") ??
    env("EXPO_PUBLIC_MINERVA_PQ_RELAYER_URL", defaultMinervaPQRelayerUrl(expectedChainId));
  const faucetUrl =
    argValue("--faucet-url") ?? env("EXPO_PUBLIC_MINERVA_FAUCET_URL", defaultMinervaFaucetUrl(expectedChainId));
  const deploy = shouldDeploy();
  const profile = createEphemeralMinervaDevnetWalletProfile();
  const request = minervaDevnetPQDeploymentRequest(profile);
  let account = await readMinervaDevPQAccount(request, { chainId: expectedChainId, pqRelayerUrl });

  if (account.chainId !== expectedChainId) {
    throw new Error(`PQ relayer is on chain ${account.chainId}, expected ${expectedChainId}.`);
  }

  const deployReceipt = deploy
    ? await deployMinervaDevPQAccount(request, { chainId: expectedChainId, faucetUrl, pqRelayerUrl })
    : undefined;
  if (deployReceipt) {
    account = await readMinervaDevPQAccount(request, { chainId: expectedChainId, pqRelayerUrl });
  }

  const accountAddress = (deployReceipt?.accountAddress ?? account.accountAddress) as Hex;
  console.log(
    JSON.stringify(
      {
        format: "minerva.wallet.pq-vault-profile.v1",
        warning:
          "PRIVATE TESTNET WALLET MATERIAL. Store this output securely. The ML-DSA private key controls this Minerva Account.",
        chainId: account.chainId,
        pqRelayerUrl,
        faucetUrl,
        accountAddress,
        deployed: deployReceipt?.deployed ?? account.deployed,
        deploymentTransactionHash: deployReceipt?.transactionHash,
        deploymentPublicKey: profile.deploymentPublicKey,
        currentKey: profile.currentKey,
        salt: account.salt,
        publicKeyCommitment: account.publicKeyCommitment,
        env: {
          MINERVA_FAUCET_TREASURY_VAULT: accountAddress,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  process.stderr.write(`[minerva-pq-vault] ${error instanceof Error ? error.message : "vault generation failed"}\n`);
  process.exit(1);
});
