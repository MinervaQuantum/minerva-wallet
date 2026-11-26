import type { Hex } from "@minerva/core";
import {
  MINERVA_DEVNET_CHAIN_ID,
  defaultMinervaPQRelayerUrl,
  defaultMinervaRpcUrl,
  sendMinervaDevPQTransfer,
} from "@minerva/evm";

declare const process: {
  argv: string[];
  stderr: { write(message: string): void };
  exit(code?: number): never;
};

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireArg(name: string): string {
  const value = argValue(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const chainId = Number(argValue("--chain-id") ?? MINERVA_DEVNET_CHAIN_ID);
  const receipt = await sendMinervaDevPQTransfer(
    {
      accountAddress: requireArg("--account") as Hex,
      publicKey: requireArg("--public-key") as Hex,
      privateKey: requireArg("--private-key") as Hex,
      salt: requireArg("--salt") as Hex,
      target: requireArg("--target") as Hex,
      valueWei: requireArg("--value-wei"),
      data: (argValue("--data") ?? "0x") as Hex,
      nonce: requireArg("--nonce"),
      signature: requireArg("--signature") as Hex,
    },
    {
      chainId,
      rpcUrl: argValue("--rpc-url") ?? defaultMinervaRpcUrl(chainId),
      pqRelayerUrl: argValue("--pq-relayer-url") ?? defaultMinervaPQRelayerUrl(chainId),
    },
  );

  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((error) => {
  process.stderr.write(`[minerva-submit-pq-transfer] ${error instanceof Error ? error.message : "submit failed"}\n`);
  process.exit(1);
});
