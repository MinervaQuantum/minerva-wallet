import { getAddress, keccak256, type Hex } from "viem";
import { sendMinervaNativeCall } from "@minerva/evm";
import {
  deployMinervaDevPQAccount,
  encodeErc20Transfer,
  formatBalanceWei,
  formatTokenUnits,
  generateMLDSA65KeyPair,
  parseNativeAmountToWei,
  parseTokenAmount,
  readAccountSnapshot,
  readMinervaDevPQRotateAuthorization,
  readMinervaDevPQTransferAuthorization,
  requestMinervaDevnetFaucet,
  sendMinervaDevPQKeyRotation,
  sendMinervaDevPQTransfer,
  signMinervaPQAccountAuthorization,
} from "@minerva/evm";
import {
  rememberExtensionAccount,
  readExtensionPQAccount,
  recordExtensionActivity,
  saveExtensionWalletProfile,
  type ExtensionPQWalletProfile,
} from "./extensionWalletVault";

/** Maps a shared-package receipt status to an activity badge. RPC submissions return "pending"
 *  until the receipt is read; the vault resolves those on the next activity read. */
function activityStatus(status: string | undefined): "pending" | "success" | "failed" {
  if (status === "success" || status === "0x1") return "success";
  if (status === "pending" || status === undefined) return "pending";
  return "failed";
}

export interface ExtensionWalletSnapshot {
  address: Hex;
  chainId: number;
  chainName: string;
  balanceWei: bigint;
  balanceLabel: string;
  deployed: boolean;
  deploymentLabel: "Undeployed" | "Deployed";
  readinessLabel: string;
  latestBlock: string;
  publicKeyCommitment?: Hex;
}

export async function readExtensionWalletSnapshot(
  profile: ExtensionPQWalletProfile,
  passcode: string,
): Promise<{ profile: ExtensionPQWalletProfile; snapshot: ExtensionWalletSnapshot }> {
  const pqAccount = await readExtensionPQAccount(profile);
  const savedProfile = await rememberExtensionAccount(profile, pqAccount, passcode);
  const accountSnapshot = await readAccountSnapshot(pqAccount.accountAddress, { chainId: pqAccount.chainId });
  return {
    profile: savedProfile,
    snapshot: {
      address: pqAccount.accountAddress,
      chainId: pqAccount.chainId,
      chainName: accountSnapshot.chainName,
      balanceWei: accountSnapshot.balanceWei,
      balanceLabel: `${formatBalanceWei(accountSnapshot.balanceWei)} ${accountSnapshot.nativeCurrencySymbol}`,
      deployed: accountSnapshot.deployed,
      deploymentLabel: accountSnapshot.deployed ? "Deployed" : "Undeployed",
      readinessLabel: accountSnapshot.mrv?.readiness?.securityMode ?? (accountSnapshot.deployed ? "PQ Native" : "PQ Native Pending Deployment"),
      latestBlock: accountSnapshot.latestBlock.toString(),
      publicKeyCommitment: savedProfile.currentPublicKeyCommitment ?? pqAccount.publicKeyCommitment,
    },
  };
}

export async function requestExtensionFaucet(profile: ExtensionPQWalletProfile, passcode: string) {
  const pqAccount = await readExtensionPQAccount(profile);
  const receipt = await requestMinervaDevnetFaucet(
    pqAccount.accountAddress,
    { chainId: pqAccount.chainId },
    { publicKey: profile.deploymentPublicKey, salt: pqAccount.salt, deployAccount: true },
  );
  await rememberExtensionAccount(profile, pqAccount, passcode);
  await recordExtensionActivity({
    type: "receive",
    title: "Faucet funded account",
    detail: `${formatBalanceWei(BigInt(receipt.amountWei))} MRV`,
    hash: receipt.hash,
    status: "success",
    account: pqAccount.accountAddress,
  });
  return receipt;
}

export async function deployExtensionAccount(profile: ExtensionPQWalletProfile, passcode: string) {
  const receipt = await deployMinervaDevPQAccount(
    { publicKey: profile.deploymentPublicKey, salt: profile.deploymentSalt },
    { chainId: profile.chainId },
  );
  const pqAccount = await readExtensionPQAccount(profile);
  await rememberExtensionAccount(profile, pqAccount, passcode);
  if (receipt.transactionHash) {
    await recordExtensionActivity({
      type: "security",
      title: "Minerva Account deployed",
      detail: "Smart account is active onchain",
      hash: receipt.transactionHash,
      status: "success",
      account: pqAccount.accountAddress,
    });
  }
  return receipt;
}

export async function sendExtensionMrv(
  profile: ExtensionPQWalletProfile,
  passcode: string,
  args: { recipient: string; amount: string },
) {
  const target = getAddress(args.recipient) as Hex;
  const valueWei = parseNativeAmountToWei(args.amount);
  return sendExtensionDappTransaction(profile, passcode, { target, valueWei });
}

/** Sends an ERC-20 `transfer` from the Minerva Account as a PQ smart-account execution. */
export async function sendExtensionToken(
  profile: ExtensionPQWalletProfile,
  passcode: string,
  args: { token: { address: Hex; symbol: string; decimals: number }; recipient: string; amount: string },
) {
  const to = getAddress(args.recipient) as Hex;
  const amount = parseTokenAmount(args.amount, args.token.decimals);
  if (amount <= 0n) throw new Error("Amount must be greater than zero.");
  return sendExtensionDappTransaction(profile, passcode, {
    target: args.token.address,
    valueWei: 0n,
    data: encodeErc20Transfer(to, amount),
    activity: {
      title: `Sent ${formatTokenUnits(amount, args.token.decimals)} ${args.token.symbol}`,
      detail: `To ${to.slice(0, 6)}...${to.slice(-4)}`,
    },
  });
}

export async function sendExtensionDappTransaction(
  profile: ExtensionPQWalletProfile,
  passcode: string,
  args: { target: Hex; valueWei: string | bigint; data?: Hex; activity?: { title: string; detail?: string } },
) {
  const target = getAddress(args.target) as Hex;
  const valueWei = BigInt(args.valueWei);
  let pqAccount = await readExtensionPQAccount(profile);
  if (!pqAccount.deployed) {
    await deployExtensionAccount(profile, passcode);
    pqAccount = await readExtensionPQAccount(profile);
  }
  const authorization = await readMinervaDevPQTransferAuthorization(
    {
      accountAddress: pqAccount.accountAddress,
      target,
      valueWei,
      data: args.data,
    },
    { chainId: pqAccount.chainId },
  );
  const signature = signMinervaPQAccountAuthorization(authorization.message, profile.currentKey.privateKey);
  const receipt = await sendMinervaDevPQTransfer(
    {
      accountAddress: pqAccount.accountAddress,
      target,
      valueWei,
      data: args.data,
      nonce: authorization.nonce,
      signature,
      publicKey: profile.currentKey.publicKey,
      privateKey: profile.currentKey.privateKey,
      salt: pqAccount.salt,
    },
    { chainId: pqAccount.chainId },
  );
  await rememberExtensionAccount(profile, pqAccount, passcode);
  await recordExtensionActivity({
    type: "send",
    title: args.activity?.title ?? (valueWei > 0n ? `Sent ${formatBalanceWei(valueWei)} MRV` : "Submitted dapp transaction"),
    detail: args.activity?.detail ?? `To ${target.slice(0, 6)}...${target.slice(-4)}`,
    hash: receipt.transactionHash,
    status: activityStatus(receipt.status),
    account: pqAccount.accountAddress,
  });
  return receipt;
}

export async function rotateExtensionPQKey(profile: ExtensionPQWalletProfile, passcode: string) {
  const pqAccount = await readExtensionPQAccount(profile);
  if (!pqAccount.deployed) throw new Error("Deploy the Minerva Account before rotating its PQ key.");
  const nextKey = generateMLDSA65KeyPair(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  const authorization = await readMinervaDevPQRotateAuthorization(
    { accountAddress: pqAccount.accountAddress, newPublicKey: nextKey.publicKey },
    { chainId: pqAccount.chainId },
  );
  const signature = signMinervaPQAccountAuthorization(authorization.message, profile.currentKey.privateKey);
  const receipt = await sendMinervaDevPQKeyRotation(
    {
      accountAddress: pqAccount.accountAddress,
      newPublicKey: nextKey.publicKey,
      nonce: authorization.nonce,
      signature,
      publicKey: profile.currentKey.publicKey,
      privateKey: profile.currentKey.privateKey,
      salt: pqAccount.salt,
    },
    { chainId: pqAccount.chainId },
  );
  const nextProfile: ExtensionPQWalletProfile = {
    ...profile,
    currentKey: nextKey,
    currentPublicKeyCommitment: receipt.newPublicKeyCommitment ?? keccak256(nextKey.publicKey),
    keyVersion: profile.keyVersion + 1,
    lastRotationAt: new Date().toISOString(),
    lastRotationTransactionHash: receipt.transactionHash,
  };
  await saveExtensionWalletProfile(nextProfile, passcode);
  await recordExtensionActivity({
    type: "security",
    title: "PQ key rotated",
    detail: `ML-DSA key v${nextProfile.keyVersion} is active`,
    hash: receipt.transactionHash,
    status: activityStatus(receipt.status),
    account: pqAccount.accountAddress,
  });
  return { receipt, profile: nextProfile };
}

/**
 * Spend from another Minerva Account that enrolled this extension's key as a device key
 * (Minerva device keys). The extension signs only the native envelope with its own key; the
 * node admits it for a zero-value self-call and the account applies the scope the phone set.
 */
export async function sendExtensionDeviceCall(
  profile: ExtensionPQWalletProfile,
  args: { accountAddress: Hex; recipient: string; amount: string },
) {
  const accountAddress = getAddress(args.accountAddress) as Hex;
  const target = getAddress(args.recipient) as Hex;
  const valueWei = parseNativeAmountToWei(args.amount);
  const receipt = await sendMinervaNativeCall(
    {
      accountAddress,
      target,
      valueWei,
      publicKey: profile.currentKey.publicKey,
      privateKey: profile.currentKey.privateKey,
      salt: profile.deploymentSalt,
    },
    { chainId: profile.chainId },
  );
  await recordExtensionActivity({
    type: "send",
    title: `Device-key spend of ${formatBalanceWei(valueWei)} MRV`,
    detail: `From ${accountAddress.slice(0, 6)}...${accountAddress.slice(-4)} to ${target.slice(0, 6)}...${target.slice(-4)} (policy v${receipt.policyVersion})`,
    hash: receipt.transactionHash,
    status: activityStatus(receipt.status),
    account: profile.accountAddress,
  });
  return receipt;
}

