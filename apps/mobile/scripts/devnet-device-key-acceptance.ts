// Device-key acceptance against a live Minerva devnet, through the wallet backend:
// deploy an account, enrol a scoped device key from the phone's control key, spend with
// the device key inside its scope, prove the scope and the consensus rule hold, revoke it,
// and prove the revoked key is refused before and at submission.
import { randomBytes } from "node:crypto";
import type { Hex } from "@minerva/core";
import {
  MINERVA_DEVNET_CHAIN_ID,
  defaultMinervaFaucetUrl,
  defaultMinervaPQRelayerUrl,
  defaultMinervaRpcUrl,
  enrollMinervaDeviceKey,
  generateMLDSA65KeyPair,
  isMinervaNetwork,
  readNativeBalance,
  readMinervaDeviceKey,
  readMinervaDevPQAccount,
  readMinervaPQEnrollAuthorization,
  readMinervaPQPolicyVersion,
  readMinervaPQRevokeAuthorization,
  requestMinervaDevnetFaucet,
  revokeMinervaDeviceKey,
  sendMinervaDevPQTransfer,
  sendMinervaNativeCall,
  signMinervaPQAccountAuthorization,
} from "@minerva/evm";

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
async function expectFailure(label: string, run: () => Promise<unknown>, pattern: RegExp) {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assertAcceptance(pattern.test(message), `${label}: unexpected error "${message}"`);
    console.log(`[minerva-mobile-device-acceptance] ${label}: refused as expected`);
    return;
  }
  throw new Error(`${label}: succeeded but should have been refused`);
}

async function waitForAccountReady(args: { publicKey: Hex; salt: Hex; minimumWei: bigint; pqRelayerUrl: string }) {
  let lastBalance = "unknown";
  for (let attempt = 0; attempt < 30; attempt++) {
    const account = await readMinervaDevPQAccount({ publicKey: args.publicKey, salt: args.salt }, { pqRelayerUrl: args.pqRelayerUrl });
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
  const target = env("MINERVA_MOBILE_DEVICE_ACCEPTANCE_TARGET", "0x000000000000000000000000000000000000dEaD") as Hex;
  const otherTarget = "0x000000000000000000000000000000000000bEEF" as Hex;
  const valueLimitWei = BigInt(env("MINERVA_MOBILE_DEVICE_ACCEPTANCE_LIMIT_WEI", "100000"));
  const salt = bytesToHex(randomBytes(32));
  const sdk = { chainId, rpcUrl, pqRelayerUrl };

  assertAcceptance(isMinervaNetwork(chainId), "Device-key acceptance requires a supported Minerva network.");

  // The phone holds the control key A; a second device holds D.
  const keyA = generateMLDSA65KeyPair(randomBytes(32));
  const keyD = generateMLDSA65KeyPair(randomBytes(32));
  const initialAccount = await readMinervaDevPQAccount({ publicKey: keyA.publicKey, salt }, { pqRelayerUrl });
  await requestMinervaDevnetFaucet(initialAccount.accountAddress, { faucetUrl }, { publicKey: keyA.publicKey, salt, deployAccount: true });
  const account = await waitForAccountReady({ publicKey: keyA.publicKey, salt, minimumWei: valueLimitWei, pqRelayerUrl });
  const accountAddress = account.accountAddress;

  // Enrol D: [target], valueLimit per hour, no expiry. Inner authorization by A, envelope by A.
  const scope = { targets: [target], valueLimitWei, windowSeconds: 3600n, expiry: 0n };
  const enroll = await readMinervaPQEnrollAuthorization({ accountAddress, devicePublicKey: keyD.publicKey, scope }, sdk);
  const enrollReceipt = await enrollMinervaDeviceKey(
    {
      accountAddress,
      devicePublicKey: keyD.publicKey,
      scope,
      nonce: enroll.nonce,
      signature: signMinervaPQAccountAuthorization(enroll.message, keyA.privateKey),
      publicKey: keyA.publicKey,
      privateKey: keyA.privateKey,
      salt,
    },
    sdk,
  );
  assertAcceptance(enrollReceipt.status === "success", "Device-key enrolment did not succeed.");
  let device = await readMinervaDeviceKey({ accountAddress, devicePublicKey: keyD.publicKey }, sdk);
  assertAcceptance(device.exists && device.active && device.policyVersion === "1", `Unexpected device record after enrolment: ${JSON.stringify(device)}`);
  assertAcceptance(device.scope.active && device.scope.valueLimitWei === valueLimitWei.toString(), "Unexpected device scope after enrolment.");
  assertAcceptance((await readMinervaPQPolicyVersion({ accountAddress, publicKey: keyD.publicKey }, { chainId, rpcUrl })) === 1, "Device key should sign at policy version 1.");

  // D spends inside its scope through executeNative; the window limit and target list hold.
  const spend = valueLimitWei / 2n;
  const before = await readNativeBalance(target, { chainId, rpcUrl });
  const spendReceipt = await sendMinervaNativeCall(
    { accountAddress, target, valueWei: spend, publicKey: keyD.publicKey, privateKey: keyD.privateKey, salt },
    sdk,
  );
  assertAcceptance(spendReceipt.status === "success", "Device-key spend did not succeed.");
  assertAcceptance((await readNativeBalance(target, { chainId, rpcUrl })) - before >= spend, "Device-key spend did not move value.");
  await expectFailure(
    "D over the window limit",
    () => sendMinervaNativeCall({ accountAddress, target, valueWei: spend + 1n, publicKey: keyD.publicKey, privateKey: keyD.privateKey, salt }, sdk),
    /reverted/,
  );
  await expectFailure(
    "D outside the target list",
    () => sendMinervaNativeCall({ accountAddress, target: otherTarget, valueWei: 0n, publicKey: keyD.publicKey, privateKey: keyD.privateKey, salt }, sdk),
    /reverted/,
  );
  // Consensus: a device key cannot move value directly, whatever it puts in the call.
  await expectFailure(
    "D direct transfer (bypassing the account)",
    () =>
      sendMinervaDevPQTransfer(
        { accountAddress, target, valueWei: 1n, nonce: 0, signature: "0x", publicKey: keyD.publicKey, privateKey: keyD.privateKey, salt },
        sdk,
      ),
    /reverted|zero-value calls to the account itself|control key/,
  );

  // The phone revokes D; the registry and the node refuse it from then on.
  const revoke = await readMinervaPQRevokeAuthorization({ accountAddress, commitment: device.commitment }, sdk);
  const revokeReceipt = await revokeMinervaDeviceKey(
    {
      accountAddress,
      commitment: device.commitment,
      nonce: revoke.nonce,
      signature: signMinervaPQAccountAuthorization(revoke.message, keyA.privateKey),
      publicKey: keyA.publicKey,
      privateKey: keyA.privateKey,
      salt,
    },
    sdk,
  );
  assertAcceptance(revokeReceipt.status === "success", "Device-key revocation did not succeed.");
  device = await readMinervaDeviceKey({ accountAddress, devicePublicKey: keyD.publicKey }, sdk);
  assertAcceptance(device.exists && !device.active && device.policyVersion === "2", `Unexpected device record after revocation: ${JSON.stringify(device)}`);
  await expectFailure(
    "revoked D",
    () => sendMinervaNativeCall({ accountAddress, target, valueWei: 1n, publicKey: keyD.publicKey, privateKey: keyD.privateKey, salt }, sdk),
    /revoked device key/,
  );

  // The control key still works at the new policy version.
  const finalReceipt = await sendMinervaNativeCall(
    { accountAddress, target, valueWei: 1n, publicKey: keyA.publicKey, privateKey: keyA.privateKey, salt },
    sdk,
  );
  assertAcceptance(finalReceipt.status === "success" && finalReceipt.policyVersion === "2", "Control key transfer at policy version 2 failed.");

  console.log(`[minerva-mobile-device-acceptance] account ${accountAddress}`);
  console.log(`[minerva-mobile-device-acceptance] device key ${device.commitment}`);
  console.log(`[minerva-mobile-device-acceptance] enrol tx ${enrollReceipt.transactionHash}`);
  console.log(`[minerva-mobile-device-acceptance] device spend tx ${spendReceipt.transactionHash}`);
  console.log(`[minerva-mobile-device-acceptance] revoke tx ${revokeReceipt.transactionHash}`);
  console.log("[minerva-mobile-device-acceptance] ok");
}

main().catch((error) => {
  process.stderr.write(`[minerva-mobile-device-acceptance] ${error instanceof Error ? error.message : "mobile device-key acceptance failed"}\n`);
  process.exit(1);
});
