import { randomBytes } from "node:crypto";
import type { Hex } from "@minerva/core";
import {
  MINERVA_DEVNET_CHAIN_ID,
  MINERVA_ZERO_HASH,
  defaultMinervaFaucetUrl,
  defaultMinervaPQRelayerUrl,
  defaultMinervaRpcUrl,
  generateMLDSA65KeyPair,
  isMinervaNetwork,
  readNativeBalance,
  readMinervaDevPQAccount,
  readMinervaDevPQRotateAuthorization,
  readMinervaDevPQTransferAuthorization,
  requestMinervaDevnetFaucet,
  sendMinervaDevPQKeyRotation,
  sendMinervaDevPQTransfer,
  signMinervaPQAccountAuthorization,
} from "@minerva/evm";
import { verifyMLDSA65 } from "@minerva/pq-crypto";

declare const process: {
  env: Record<string, string | undefined>;
  stderr: { write(message: string): void };
  exit(code?: number): never;
};

function env(name: string, fallback: string) {
  return process.env[name] ?? fallback;
}

function bytesToHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertAcceptance(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitForAccountReady(args: {
  publicKey: Hex;
  salt: Hex;
  minimumWei: bigint;
  pqRelayerUrl: string;
}) {
  let lastBalance = "unknown";
  for (let attempt = 0; attempt < 30; attempt++) {
    const account = await readMinervaDevPQAccount(
      { publicKey: args.publicKey, salt: args.salt },
      { pqRelayerUrl: args.pqRelayerUrl },
    );
    lastBalance = account.balanceWei;
    if (account.deployed && BigInt(account.balanceWei) >= args.minimumWei) return account;
    await sleep(1000);
  }

  throw new Error(`PQ account was not ready. Last balance: ${lastBalance} wei.`);
}

async function main() {
  const chainId = Number(env("EXPO_PUBLIC_MINERVA_CHAIN_ID", String(MINERVA_DEVNET_CHAIN_ID)));
  const rpcUrl = env("EXPO_PUBLIC_MINERVA_RPC_URL", defaultMinervaRpcUrl(chainId));
  const faucetUrl = env("EXPO_PUBLIC_MINERVA_FAUCET_URL", defaultMinervaFaucetUrl(chainId));
  const pqRelayerUrl = env("EXPO_PUBLIC_MINERVA_PQ_RELAYER_URL", defaultMinervaPQRelayerUrl(chainId));
  const target = env("MINERVA_MOBILE_ROTATE_ACCEPTANCE_TARGET", "0x000000000000000000000000000000000000dEaD") as Hex;
  const valueWei = BigInt(env("MINERVA_MOBILE_ROTATE_ACCEPTANCE_VALUE_WEI", "54321"));
  const salt = bytesToHex(randomBytes(32));

  assertAcceptance(isMinervaNetwork(chainId), "Rotation acceptance requires a supported Minerva network.");

  const keyA = generateMLDSA65KeyPair(randomBytes(32));
  const keyB = generateMLDSA65KeyPair(randomBytes(32));
  const initialAccount = await readMinervaDevPQAccount({ publicKey: keyA.publicKey, salt }, { pqRelayerUrl });

  await requestMinervaDevnetFaucet(
    initialAccount.accountAddress,
    { faucetUrl },
    { publicKey: keyA.publicKey, salt, deployAccount: true },
  );

  const deployedAccount = await waitForAccountReady({
    publicKey: keyA.publicKey,
    salt,
    minimumWei: valueWei,
    pqRelayerUrl,
  });
  const startTargetBalance = await readNativeBalance(target, { chainId, rpcUrl });

  const rotationAuthorization = await readMinervaDevPQRotateAuthorization(
    { accountAddress: deployedAccount.accountAddress, newPublicKey: keyB.publicKey },
    { chainId, rpcUrl },
  );
  const rotationSignature = signMinervaPQAccountAuthorization(rotationAuthorization.message, keyA.privateKey);
  assertAcceptance(
    verifyMLDSA65(rotationSignature, rotationAuthorization.message, keyA.publicKey),
    "Initial key failed to verify the rotation authorization.",
  );

  const rotationReceipt = await sendMinervaDevPQKeyRotation(
    {
      accountAddress: deployedAccount.accountAddress,
      newPublicKey: keyB.publicKey,
      nonce: rotationAuthorization.nonce,
      signature: rotationSignature,
      publicKey: keyA.publicKey,
      privateKey: keyA.privateKey,
      salt,
    },
    { chainId, rpcUrl, pqRelayerUrl },
  );
  assertAcceptance(rotationReceipt.status === "success", "PQ key rotation did not succeed.");

  const transferAuthorization = await readMinervaDevPQTransferAuthorization(
    { accountAddress: deployedAccount.accountAddress, target, valueWei },
    { chainId, rpcUrl },
  );
  const oldKeySignature = signMinervaPQAccountAuthorization(transferAuthorization.message, keyA.privateKey);
  let oldKeyRejected = false;
  try {
    await sendMinervaDevPQTransfer(
      {
        accountAddress: deployedAccount.accountAddress,
        target,
        valueWei,
        nonce: transferAuthorization.nonce,
        signature: oldKeySignature,
        publicKey: keyA.publicKey,
        privateKey: keyA.privateKey,
        salt,
      },
      { chainId, rpcUrl, pqRelayerUrl },
    );
  } catch {
    oldKeyRejected = true;
  }
  assertAcceptance(oldKeyRejected, "Old key moved funds after rotation.");

  const newKeySignature = signMinervaPQAccountAuthorization(transferAuthorization.message, keyB.privateKey);
  assertAcceptance(
    verifyMLDSA65(newKeySignature, transferAuthorization.message, keyB.publicKey),
    "Replacement key failed to verify the transfer authorization.",
  );
  // Minerva: after rotation the native envelope is signed by the replacement key at
  // policy version 1 (the SDK reads it from minerva_getAccountControl); the account
  // address stays the one derived from the initial key.
  const transferReceipt = await sendMinervaDevPQTransfer(
    {
      accountAddress: deployedAccount.accountAddress,
      target,
      valueWei,
      nonce: transferAuthorization.nonce,
      signature: newKeySignature,
      publicKey: keyB.publicKey,
      privateKey: keyB.privateKey,
      salt,
    },
    { chainId, rpcUrl, pqRelayerUrl },
  );
  assertAcceptance(transferReceipt.status === "success", "Replacement key transfer did not succeed.");

  const finalAccount = await readMinervaDevPQAccount({ publicKey: keyA.publicKey, salt }, { pqRelayerUrl });
  const endTargetBalance = await readNativeBalance(target, { chainId, rpcUrl });
  const targetDeltaWei = endTargetBalance - startTargetBalance;

  assertAcceptance(finalAccount.nonce === "2", `Expected account nonce 2, got ${finalAccount.nonce}.`);
  assertAcceptance(targetDeltaWei >= valueWei, "Replacement key transfer did not move the requested MRV value.");
  assertAcceptance(MINERVA_ZERO_HASH !== salt, "Rotation acceptance generated an invalid salt.");

  console.log(`[minerva-mobile-rotate-acceptance] account ${finalAccount.accountAddress}`);
  console.log(`[minerva-mobile-rotate-acceptance] rotate tx ${rotationReceipt.transactionHash}`);
  console.log(`[minerva-mobile-rotate-acceptance] pq transfer tx ${transferReceipt.transactionHash}`);
  console.log(`[minerva-mobile-rotate-acceptance] nonce ${finalAccount.nonce}`);
  console.log(`[minerva-mobile-rotate-acceptance] target delta ${targetDeltaWei.toString()} wei`);
  console.log("[minerva-mobile-rotate-acceptance] ok");
}

main().catch((error) => {
  process.stderr.write(
    `[minerva-mobile-rotate-acceptance] ${
      error instanceof Error ? error.message : "mobile rotation acceptance failed"
    }\n`,
  );
  process.exit(1);
});
