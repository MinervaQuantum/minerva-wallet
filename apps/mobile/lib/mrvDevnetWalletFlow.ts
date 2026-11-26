import type { Hex } from "@minerva/core";
import {
  MINERVA_DEVNET_CHAIN_ID,
  defaultMinervaFaucetUrl,
  defaultMinervaPQRelayerUrl,
  defaultMinervaRpcUrl,
  deployMinervaDevPQAccount,
  formatBalanceWei,
  generateMLDSA65KeyPair,
  isMinervaNetwork,
  readAccountSnapshot,
  readNativeBalance,
  readMinervaDevPQAccount,
  readMinervaDevPQTransferAuthorization,
  requestMinervaDevnetFaucet,
  sendMinervaDevPQTransfer,
  signMinervaPQAccountAuthorization,
  type AccountReadSnapshot,
  type EvmReadConfig,
  type MLDSA65KeyPair,
  type MinervaDevPQAccount,
  type MinervaDevPQAuthorization,
  type MinervaDevPQDeployReceipt,
  type MinervaDevPQTransferReceipt,
  type MinervaFaucetReceipt,
} from "@minerva/evm";

export interface MinervaDevnetWalletFlowProfile {
  currentKey: MLDSA65KeyPair;
  deploymentKey?: MLDSA65KeyPair;
  deploymentPublicKey: Hex;
  deploymentSalt?: Hex;
}

export interface MinervaDevnetWalletDisplayState {
  address: Hex;
  chainId: number;
  chainName: string;
  nativeCurrencySymbol: string;
  balanceLabel: string;
  deploymentLabel: "Counterfactual" | "Deployed";
  readinessLabel: string;
  latestBlock: string;
}

export interface MinervaDevnetPQTransferFlowResult {
  pqAccount: MinervaDevPQAccount;
  authorization: MinervaDevPQAuthorization;
  signature: Hex;
  receipt: MinervaDevPQTransferReceipt;
}

export interface MinervaDevnetWalletAcceptanceConfig extends EvmReadConfig {
  target?: Hex;
  valueWei?: string | bigint;
  data?: Hex;
}

export interface MinervaDevnetWalletAcceptanceResult {
  profile: MinervaDevnetWalletFlowProfile;
  accountAddress: Hex;
  initialAccount: MinervaDevPQAccount;
  initialDisplay: MinervaDevnetWalletDisplayState;
  faucetReceipt: MinervaFaucetReceipt;
  deployReceipt: MinervaDevPQDeployReceipt;
  deployedAccount: MinervaDevPQAccount;
  deployedDisplay: MinervaDevnetWalletDisplayState;
  transfer: MinervaDevnetPQTransferFlowResult;
  finalAccount: MinervaDevPQAccount;
  finalDisplay: MinervaDevnetWalletDisplayState;
  targetDeltaWei: bigint;
}

function randomSeed() {
  const seed = new Uint8Array(32);
  const cryptoSource = globalThis.crypto;
  if (!cryptoSource?.getRandomValues) throw new Error("Web Crypto random source is unavailable.");
  cryptoSource.getRandomValues(seed);
  return seed;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertAcceptance(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function devnetConfig(config: MinervaDevnetWalletAcceptanceConfig = {}) {
  const chainId = config.chainId ?? MINERVA_DEVNET_CHAIN_ID;
  return {
    chainId,
    rpcUrl: config.rpcUrl ?? defaultMinervaRpcUrl(chainId),
    faucetUrl: config.faucetUrl ?? defaultMinervaFaucetUrl(chainId),
    pqRelayerUrl: config.pqRelayerUrl ?? defaultMinervaPQRelayerUrl(chainId),
  };
}

export function createEphemeralMinervaDevnetWalletProfile(): MinervaDevnetWalletFlowProfile {
  const currentKey = generateMLDSA65KeyPair(randomSeed());
  return {
    currentKey,
    deploymentKey: currentKey,
    deploymentPublicKey: currentKey.publicKey,
  };
}

export function minervaDevnetPQDeploymentRequest(profile: MinervaDevnetWalletFlowProfile) {
  return {
    publicKey: profile.deploymentPublicKey,
    salt: profile.deploymentSalt,
  };
}

/**
 * The key that signs native envelopes. On Minerva that is always the current control key: the
 * node checks the account's control record, so a rotated-out deployment key would be refused.
 * Before the first rotation the current key and the deployment key are the same key, which is
 * also what the counterfactual CREATE2 binding needs.
 */
export function minervaDevnetPQNativeGasKey(profile: MinervaDevnetWalletFlowProfile): MLDSA65KeyPair {
  return profile.currentKey;
}

export function displayStateFromMinervaDevnetSnapshot(
  snapshot: AccountReadSnapshot,
): MinervaDevnetWalletDisplayState {
  const balance = formatBalanceWei(snapshot.balanceWei);
  return {
    address: snapshot.address,
    chainId: snapshot.chainId,
    chainName: snapshot.chainName,
    nativeCurrencySymbol: snapshot.nativeCurrencySymbol,
    balanceLabel: `${balance} ${snapshot.nativeCurrencySymbol}`,
    deploymentLabel: snapshot.deployed ? "Deployed" : "Counterfactual",
    readinessLabel:
      snapshot.mrv?.readiness?.securityMode ??
      snapshot.mrv?.securityMode?.mode ??
      (snapshot.deployed ? "PQ Native" : "PQ Native Pending Deployment"),
    latestBlock: snapshot.latestBlock.toString(),
  };
}

export async function readMinervaDevnetWalletDisplayState(
  address: Hex,
  config: Pick<EvmReadConfig, "chainId" | "rpcUrl"> = {},
) {
  const chainId = config.chainId ?? MINERVA_DEVNET_CHAIN_ID;
  const snapshot = await readAccountSnapshot(address, {
    chainId,
    rpcUrl: config.rpcUrl ?? defaultMinervaRpcUrl(chainId),
  });
  return displayStateFromMinervaDevnetSnapshot(snapshot);
}

export async function waitForMinervaDevnetPQBalance(
  profile: MinervaDevnetWalletFlowProfile,
  minimumWei: string | bigint,
  config: Pick<EvmReadConfig, "chainId" | "pqRelayerUrl"> = {},
): Promise<MinervaDevPQAccount> {
  const min = BigInt(minimumWei);
  const chainId = config.chainId ?? MINERVA_DEVNET_CHAIN_ID;
  let lastAccount: MinervaDevPQAccount | undefined;

  for (let attempt = 0; attempt < 30; attempt++) {
    lastAccount = await readMinervaDevPQAccount(minervaDevnetPQDeploymentRequest(profile), {
      chainId,
      pqRelayerUrl: config.pqRelayerUrl ?? defaultMinervaPQRelayerUrl(chainId),
    });
    if (BigInt(lastAccount.balanceWei) >= min) return lastAccount;
    await sleep(1000);
  }

  throw new Error(
    `MRV balance did not reach ${min.toString()} wei. Last balance: ${lastAccount?.balanceWei ?? "unknown"} wei.`,
  );
}

export async function sendMinervaDevnetWalletPQTransfer(
  profile: MinervaDevnetWalletFlowProfile,
  config: Pick<EvmReadConfig, "chainId" | "rpcUrl" | "faucetUrl" | "pqRelayerUrl"> = {},
  args: {
    target?: Hex;
    valueWei?: string | bigint;
    data?: Hex;
    fee?: { gasTipCap: string | bigint; gasFeeCap: string | bigint };
    gas?: string | bigint;
  } = {},
): Promise<MinervaDevnetPQTransferFlowResult> {
  const runtime = devnetConfig(config);
  const target = args.target ?? "0x000000000000000000000000000000000000dEaD";
  const valueWei = args.valueWei ?? "1000000000000000";
  const data = args.data ?? "0x";
  let pqAccount = await readMinervaDevPQAccount(minervaDevnetPQDeploymentRequest(profile), {
    chainId: runtime.chainId,
    pqRelayerUrl: runtime.pqRelayerUrl,
  });
  const accountAddress = pqAccount.accountAddress;

  if (!pqAccount.deployed) {
    await deployMinervaDevPQAccount(minervaDevnetPQDeploymentRequest(profile), {
      chainId: runtime.chainId,
      faucetUrl: runtime.faucetUrl,
      pqRelayerUrl: runtime.pqRelayerUrl,
    });
    pqAccount = await readMinervaDevPQAccount(minervaDevnetPQDeploymentRequest(profile), {
      chainId: runtime.chainId,
      pqRelayerUrl: runtime.pqRelayerUrl,
    });
  }

  if (BigInt(pqAccount.balanceWei) < BigInt(valueWei)) {
    throw new Error(
      `Insufficient MRV balance. Need ${BigInt(valueWei).toString()} wei, have ${pqAccount.balanceWei} wei.`,
    );
  }

  const gasKey = minervaDevnetPQNativeGasKey(profile);
  const authorization = await readMinervaDevPQTransferAuthorization(
    {
      accountAddress,
      target,
      valueWei,
      data,
    },
    { chainId: runtime.chainId, rpcUrl: runtime.rpcUrl },
  );
  const signature = signMinervaPQAccountAuthorization(authorization.message, profile.currentKey.privateKey);
  const receipt = await sendMinervaDevPQTransfer(
    {
      accountAddress,
      publicKey: gasKey.publicKey,
      privateKey: gasKey.privateKey,
      salt: pqAccount.salt,
      target,
      valueWei,
      data,
      nonce: authorization.nonce,
      signature,
      fee: args.fee,
      gas: args.gas,
    },
    { chainId: runtime.chainId, rpcUrl: runtime.rpcUrl, pqRelayerUrl: runtime.pqRelayerUrl },
  );

  return {
    pqAccount: { ...pqAccount, deployed: true },
    authorization,
    signature,
    receipt,
  };
}

export async function runMinervaDevnetWalletAcceptance(
  config: MinervaDevnetWalletAcceptanceConfig = {},
): Promise<MinervaDevnetWalletAcceptanceResult> {
  const runtime = devnetConfig(config);
  const valueWei = config.valueWei ?? "77777";
  const target = config.target ?? "0x000000000000000000000000000000000000dEaD";
  const data = config.data ?? "0x";

  assertAcceptance(isMinervaNetwork(runtime.chainId), "Mobile acceptance requires a Minerva PQ-native network.");

  const profile = createEphemeralMinervaDevnetWalletProfile();
  const initialAccount = await readMinervaDevPQAccount(minervaDevnetPQDeploymentRequest(profile), {
    chainId: runtime.chainId,
    pqRelayerUrl: runtime.pqRelayerUrl,
  });
  const initialDisplay = await readMinervaDevnetWalletDisplayState(initialAccount.accountAddress, runtime);

  assertAcceptance(
    initialAccount.chainId === runtime.chainId,
    `Wallet connected to chain ID ${initialAccount.chainId}, expected ${runtime.chainId}.`,
  );
  assertAcceptance(initialDisplay.nativeCurrencySymbol === "MRV", "Wallet did not show MRV as the gas coin.");
  assertAcceptance(
    initialDisplay.readinessLabel.includes("PQ Native"),
    `Wallet did not show PQ Native readiness before deployment: ${initialDisplay.readinessLabel}`,
  );

  const deploymentRequest = minervaDevnetPQDeploymentRequest(profile);
  const faucetReceipt = await requestMinervaDevnetFaucet(
    initialAccount.accountAddress,
    {
      chainId: runtime.chainId,
      faucetUrl: runtime.faucetUrl,
    },
    { publicKey: deploymentRequest.publicKey, salt: initialAccount.salt, deployAccount: true },
  );
  await waitForMinervaDevnetPQBalance(profile, valueWei, {
    chainId: runtime.chainId,
    pqRelayerUrl: runtime.pqRelayerUrl,
  });

  const rawDeployReceipt = await deployMinervaDevPQAccount(deploymentRequest, {
    chainId: runtime.chainId,
    faucetUrl: runtime.faucetUrl,
    pqRelayerUrl: runtime.pqRelayerUrl,
  });
  const deployReceipt: MinervaDevPQDeployReceipt = {
    ...rawDeployReceipt,
    transactionHash: rawDeployReceipt.transactionHash ?? faucetReceipt.deploymentTransactionHash,
    faucetTransactionHash: rawDeployReceipt.faucetTransactionHash ?? faucetReceipt.hash,
    deploymentBlockNumber: rawDeployReceipt.deploymentBlockNumber ?? faucetReceipt.deploymentBlockNumber,
  };
  const deployedAccount = await readMinervaDevPQAccount(minervaDevnetPQDeploymentRequest(profile), {
    chainId: runtime.chainId,
    pqRelayerUrl: runtime.pqRelayerUrl,
  });
  const deployedDisplay = await readMinervaDevnetWalletDisplayState(deployedAccount.accountAddress, runtime);

  assertAcceptance(deployedAccount.deployed, "Wallet account was not deployed.");
  assertAcceptance(deployedDisplay.deploymentLabel === "Deployed", "Wallet did not show deployed state.");
  assertAcceptance(deployedDisplay.readinessLabel === "PQ Native", "Wallet did not show PQ Native after deployment.");

  const startTargetBalance = await readNativeBalance(target, runtime);
  const transfer = await sendMinervaDevnetWalletPQTransfer(profile, runtime, { target, valueWei, data });
  const finalAccount = await readMinervaDevPQAccount(minervaDevnetPQDeploymentRequest(profile), {
    chainId: runtime.chainId,
    pqRelayerUrl: runtime.pqRelayerUrl,
  });
  const finalDisplay = await readMinervaDevnetWalletDisplayState(finalAccount.accountAddress, runtime);
  const endTargetBalance = await readNativeBalance(target, runtime);
  const targetDeltaWei = endTargetBalance - startTargetBalance;

  assertAcceptance(transfer.receipt.status === "success", "Wallet PQ transfer did not succeed.");
  assertAcceptance(finalAccount.nonce === "1", `Expected account nonce 1, got ${finalAccount.nonce}.`);
  assertAcceptance(targetDeltaWei >= BigInt(valueWei), "Wallet PQ transfer did not move the requested MRV value.");

  return {
    profile,
    accountAddress: finalAccount.accountAddress,
    initialAccount,
    initialDisplay,
    faucetReceipt,
    deployReceipt,
    deployedAccount,
    deployedDisplay,
    transfer,
    finalAccount,
    finalDisplay,
    targetDeltaWei,
  };
}
